var url = require('url'), 
	http = require('http'),
	https = require('https'),
	zlib = require('zlib');

var _ = require('underscore');
var SSM = require('./StreamSocketManager');
var Logger = require('./Logger');

var server_string = require('../index').server_string;

var DefaultTimeout = 30000;

var PERMANENT = 'Permanent',
	TEMPORARY = 'Temporary';

function Location(uri) {
	if(!uri) throw new Error('URI for location is not specified');
	this._uri = uri;
	this._uri_regexp = new RegExp(uri);
	this._zlib_options = null;
	this._addproxyheaders = [];
	this._rewrite = null;
	this._forward_raw = null;
	this._timeout = DefaultTimeout;
}

module.exports = Location;

Location.prototype.forwardToUpstream = function (raw) {
	this._forward_raw = raw;
	return this;
};

Location.prototype.tryResolveUpstream = function (upstream) {
	var _forward_raw_decomposed = url.parse(this._forward_raw);
	if(_forward_raw_decomposed.host == upstream.getName().toLowerCase()) {
		this._forward_to = {
			transport_name: (_forward_raw_decomposed.protocol == 'http:' ? 'http' : (_forward_raw_decomposed.protocol == 'https:' ? 'https' : 'http' )),
			transport: (_forward_raw_decomposed.protocol == 'http:' ? http : (_forward_raw_decomposed.protocol == 'https:' ? https : http )),
			upstream: upstream,
			pathname: _forward_raw_decomposed.pathname
		};
	}	
	
	return this;
};

Location.prototype.addProxyHeader = function (name, value) {
	this._addproxyheaders.push({
		name: name,
		value: value
	});
	return this;
};

Location.prototype.rewrite = function (from, to, range) {
	if(from == '^') from = '^.+$';
	if(range != TEMPORARY && range != PERMANENT) throw new Error('Unknown range "' + range + '": expected either "' + PERMANENT + '" or "' + TEMPORARY + '"');
	this._rewrite = {
		from: new RegExp(from),
		to: to,
		range: range
	};
	return this;
};

Location.prototype.getMatchScore = function (path) {
	if(this._uri_regexp.test(path))
		return this._uri.length;
	return -1;
};

Location.prototype.setZlib = function (zlib_options) {
	this._zlib_options = zlib_options;
	return this;
};

Location.prototype.getZlibType = function (acceptencoding) {
	if(!this._zlib_options || !acceptencoding) return { algorithm: 'none' };
	
	if(acceptencoding.match(/deflate/)) {
		return {
			algorithm: 'deflate',
			types: this._zlib_options.types,
			minlength: this._zlib_options.minlength
		};
	} else if(acceptencoding.match(/gzip/)) {
		return {
			algorithm: 'gzip',
			types: this._zlib_options.types,
			minlength: this._zlib_options.minlength
		};
	}
	
	return { algorithm: 'none' };
};

Location.prototype.tryRewrite = function (src_req, src_res) {
	if(this._rewrite) {
		var incoming_url = url.parse(src_req.url);
		var to = src_req.url.replace(this._rewrite.from, this._rewrite.to);
		to = to.replace('$pathname', incoming_url.pathname);
		to = to.replace('$query', incoming_url.query ? '?' + incoming_url.query : '');
		
		if(this._rewrite.range == PERMANENT) {
			src_res.writeHead(301, {
				'server': server_string,
				'location': to
			});
			src_res.end();
			return true;
		} else {
			src_res.writeHead(307, {
				'server': server_string,
				'location': to
			});
			src_res.end();
			return true;
		}
	}
	return false;
};

Location.prototype.tryForward = function (src_req, src_res, logger) {
	if(this._forward_to) {
		var _ssm = new SSM.StreamSocketManager(src_req, src_res);
		
		src_req.setTimeout(this._timeout + 1000);
			
		var log_primitives = {
			remote_addr: src_req.connection.remoteAddress,
			method: src_req.method,
			url: src_req.url,
			httpversion: src_req.httpVersionMajor + '.' + src_req.httpVersionMinor,
			bytes_sent: 0,
			bytes_received: 0,
			http_referer: src_req.headers['referer'],
			http_user_agent: src_req.headers['user-agent']
		};
		
		var options = {				
			method: src_req.method,
			path: this._forward_to.pathname + src_req.url.substring(1, src_req.url.length),
			headers: _.clone(src_req.headers)
		};

		options.headers['connection'] = 'keep-alive'; /* default connection state is keep-alive */
		
		for(var i=0; i<this._addproxyheaders.length; i++) {
			var header = this._addproxyheaders[i],
				name = header.name,
				value = header.value;
			value = value.replace('$x_forwarded_for', src_req.connection.remoteAddress);
			options.headers[name] = value;
		}
		
		_ssm.on('BadGateway', function (keepAlive) {
			log_primitives.status = 502;
			logger && logger.log(log_primitives);
			src_res.writeHead(502, {
				'server': server_string,
				'connection': keepAlive ? 'keep-alive' : 'close'
			});
			src_res.end();
		});
		
		_ssm.on('GatewayTimeout', function (keepAlive) {
			log_primitives.status = 504;
			logger && logger.log(log_primitives);
			src_res.writeHead(504, {
				'server': server_string,
				'connection': keepAlive ? 'keep-alive' : 'close'
			});
			src_res.end();
		});
		
		var zlibtype = this.getZlibType(src_req.headers['accept-encoding']);
	
		var dst_req = this._forward_to.upstream.openTransport(this._forward_to.transport, options, function (dst_res) {
			log_primitives.status = dst_res.statusCode;
			
			_ssm.destinationResponse(dst_res);
			
			var response_header = _.clone(dst_res.headers);
			
			response_header['server'] = server_string;
			response_header['connection'] = src_req.headers['connection'];
			
			switch(zlibtype.algorithm) {
			case 'deflate':
			case 'gzip':
				if(!dst_res.headers['content-encoding'] 
						&& dst_res.headers['content-type']
						&& dst_res.headers['content-length']
						&& parseInt(dst_res.headers['content-length']) > zlibtype.minlength
						&& (zlibtype.types.indexOf(dst_res.headers['content-type'].split(';')[0].toLowerCase()) >= 0)) {
					
					var _zl = ((zlibtype.algorithm == 'deflate') ? zlib.createDeflate() : zlib.createGzip());
					
					delete response_header['content-length'];
					response_header['content-encoding'] = zlibtype.algorithm;
				
					dst_res.on('data', function (chunk) { log_primitives.bytes_received += chunk.length; });
					_zl.on('data', function (chunk) { log_primitives.bytes_sent += chunk.length; });
					_zl.on('end', function () { logger && logger.log(log_primitives); });
					
					src_res.writeHead(dst_res.statusCode, response_header);
					dst_res.pipe(_zl).pipe(src_res);
					break;
				}
			default:
				src_res.writeHead(dst_res.statusCode, response_header);
			
				dst_res.on('data', function (chunk) { log_primitives.bytes_sent += chunk.length; });
				dst_res.on('end', function () { logger && logger.log(log_primitives); });
				
				dst_res.pipe(src_res);
				break;
			}
		});
		
		if(!dst_req) {
			Logger.warn('All upstreams dead');
			log_primitives.status = 503;
			logger && logger.log(log_primitives);
			src_res.writeHead(503, {
				'server': server_string,
				'connection': 'close'
			});
			src_res.end();
			return;
		}
		
		_ssm.destinationRequest(dst_req);
		
		dst_req.setTimeout(this._timeout);
		
		src_req.on('data', function (chunk) { dst_req.write(chunk); })
		src_req.on('end', function () { dst_req.end(); });
	} else {
		src_res.writeHead(404, {
			'server': server_string
		});
		src_res.end();
		return true;
	}
	
};

Location.prototype.setTimeout = function (ms) {
	this._timeout = ms;
};

Location.prototype.toString = function () {
	var retStr = ['LOCATION'];
	retStr.push(this._uri);
	
	for(var i=0; i< this._addproxyheaders.length; i++) {
		retStr.push('HEADER');
		retStr.push(this._addproxyheaders[i].name + '(' + this._addproxyheaders[i].value + ')');
	}
	if(this._rewrite) {
		retStr.push(this._rewrite.range);
		retStr.push(this._rewrite.from.toString() + ' -> ' + this._rewrite.to);
	}
	if(this._forward_raw) {
		retStr.push('FORWARD');
		retStr.push(this._forward_to.transport_name + ' ' + this._forward_to.upstream.toString());
	}
	return retStr.join(': ');
};


/**
 * ---------------------------------- Socket Status Debugger ----------------------------------
 */

Location._enableDebugging = function () {
	SSM.verbose();
};