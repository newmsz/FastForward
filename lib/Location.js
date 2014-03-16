var url = require('url'), 
	http = require('http'),
	https = require('https'),
	zlib = require('zlib');

var server_string = require('../index').server_string;

var DefaultTimeout = 60000;

var PERMANENT = 'Permanent',
	TEMPORARY = 'Temporary';

var DEBUG_SOCKET_STATUS = false, FORCE_DONE_LOG = false;

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
		var __DBG_SSD = null;
		if(DEBUG_SOCKET_STATUS) __DBG_SSD = new SSD(src_req.method, src_req.url).SRC(); 
		
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
			headers: src_req.headers
		};
		
		options.headers['connection'] = 'keep-alive';
		
		for(var i=0; i<this._addproxyheaders.length; i++) {
			var header = this._addproxyheaders[i],
				name = header.name,
				value = header.value;
			value = value.replace('$x_forwarded_for', src_req.connection.remoteAddress);
			options.headers[name] = value;
		}
		
		var zlibtype = this.getZlibType(src_req.headers['accept-encoding']);
		
		if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ();
		var dst_req = this._forward_to.upstream.openTransport(this._forward_to.transport, options, function (dst_res) {
			log_primitives.status = dst_res.statusCode;
		
			if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_RES();
			
			dst_res.on('close', function () { console.log('destination response closed'); });
			
			dst_res.on('error', function (err) { console.error('Unhandled destination response error: '); console.error(err); });
			dst_res.on('clientError', function (err) { console.error('Unhandled destination response client error: '); console.error(err); });
			
			src_req.on('error', function (err) { console.error('Unhandled source request error: '); console.error(err); });
			src_req.on('clientError', function (err) { console.error('Unhandled source request client error: '); console.error(err); });
			
			src_res.on('error', function (err) { console.error('Unhandled source response error: '); console.error(err); });
			src_res.on('clientError', function (err) { console.error('Unhandled source response client error: '); console.error(err); });
			
			dst_res.headers['server'] = server_string;
			
			switch(zlibtype.algorithm) {
			case 'deflate':
			case 'gzip':
				if(!dst_res.headers['content-encoding'] 
						&& dst_res.headers['content-type']
						&& dst_res.headers['content-length']
						&& parseInt(dst_res.headers['content-length']) > zlibtype.minlength
						&& (zlibtype.types.indexOf(dst_res.headers['content-type'].split(';')[0].toLowerCase()) >= 0)) {
					
					var _zl = ((zlibtype.algorithm == 'deflate') ? zlib.createDeflate() : zlib.createGzip());
					delete dst_res.headers['content-length'];
					dst_res.headers['content-encoding'] = zlibtype.algorithm;
				
					dst_res.on('data', function (chunk) { log_primitives.bytes_received += chunk.length; });
					_zl.on('data', function (chunk) { log_primitives.bytes_sent += chunk.length; });
					_zl.on('end', function () { if(DEBUG_SOCKET_STATUS) __DBG_SSD.RES_END(); logger && logger.log(log_primitives); });
					
					src_res.writeHead(dst_res.statusCode, dst_res.headers);
					dst_res.pipe(_zl).pipe(src_res);
					break;
				}
			default:
				src_res.writeHead(dst_res.statusCode, dst_res.headers);
			
				dst_res.on('data', function (chunk) { log_primitives.bytes_sent += chunk.length; });
				dst_res.on('end', function () { if(DEBUG_SOCKET_STATUS) __DBG_SSD.RES_END(); logger && logger.log(log_primitives); });
				
				dst_res.pipe(src_res);
				break;
			}
		});
		
		dst_req.on('clientError', function (err) { console.error('ce Destination request error: '); console.error(err); });

		src_req.on('close', function() {
			if(src_res.finished) {
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.SRC_REQ_CLOSED();
			} else {
				//SSD.printSourceRequest(src_req);
				//SSD.printSourceResponse(src_res);
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.SRC_REQ_CLOSED_U();			
				dst_req.abort();	
			}
		});
		
		dst_req.on('close', function () {
			//SSD.printSourceRequest(src_req);
			//SSD.printSourceResponse(src_res);
			//SSD.printDestinationRequest(dst_req);
			
			if(src_req.complete && !src_res.socket && !dst_req.socket._writableState.ended) {
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_CLOSED_U();
				src_req.socket.destroy();	
				return;
			}
			
			if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_CLOSED();
		});
		
		src_req.setTimeout(this._timeout, function () {
			if(DEBUG_SOCKET_STATUS) __DBG_SSD.SRC_REQ_TIMEDOUT();
			
			log_primitives.status = 504;
			logger && logger.log(log_primitives);
			src_res.writeHead(504, {
				'server': server_string
			});
			
			src_res.end();
			dst_req.abort();
		});
		
		dst_req.setTimeout(this._timeout, function () {
			if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_TIMEDOUT();
			
			//SSD.printSourceRequest(src_req);
			//SSD.printSourceResponse(src_res);
			
			if(!src_res._headerSent) {
				log_primitives.status = 504;
				logger && logger.log(log_primitives);
				src_res.writeHead(504, {
					'server': server_string
				});
				
				src_res.end();
			} else
				src_req.socket.destroy();
			
			dst_req.abort();
		});
		
		dst_req.on('error', function (err) {
			if(err.errno == 'ECONNRESET' || err.code == 'ECONNRESET') {
				log_primitives.status = 502;
				logger && logger.log(log_primitives);
				src_res.writeHead(502, {
					'server': server_string
				});
				return src_res.end();
			} else if(err.errno == 'ECONNREFUSED' || err.code == 'ECONNREFUSED') {
				log_primitives.status = 502;
				logger && logger.log(log_primitives);
				src_res.writeHead(502, {
					'server': server_string
				});
				return src_res.end();
			} else if(err.errno == 'ECONNABORTED' || err.code == 'ECONNABORTED') {
				log_primitives.status = 502;
				logger && logger.log(log_primitives);
				src_res.writeHead(502, {
					'server': server_string
				});
				return src_res.end();
			} else if(err.errno == 'ETIMEDOUT' || err.code == 'ETIMEDOUT') {
				__DBG_SSD.DST_REQ_TIMEDOUT();
				
				log_primitives.status = 504;
				logger && logger.log(log_primitives);
				src_res.writeHead(504, {
					'server': server_string
				});
				return src_res.end();
			}
			
			__DBG_SSD.DST_REQ_ERROR();
			console.error('Destination request error: '); console.error( err);
		});

		src_req.on('data', function (chunk) { dst_req.write(chunk); })
		src_req.on('end', function () { if(DEBUG_SOCKET_STATUS) __DBG_SSD.REQ_END(); dst_req.end(); });
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

function SSD (method, url) {
	this._method = method;
	this._url = url;
	this._trace_stack = [];
	this._message_stack = [];
}

SSD.prototype.SRC = function () { /* Incoming Source Request & Source Response */
	if(this._trace_stack.length != 0) this._message_stack 
	this._push_code('SRC');
	return this;
};

SSD.prototype.DST_REQ = function () { /* Creation of Destination Request */
	if(!this._expect_before('SRC')) {
		console.error(this.toString('Source request and response do not appear before destination request creation'));
	}
	this._push_code('DST_REQ');
	return this;
};

SSD.prototype.REQ_END = function () { /* Source Request Ends & Destination Ends */
	if(!this._expect_before('DST_REQ')) {
		this._push_msg('Source request ends before destination request creation');
		console.error(this.toString());
	}
	this._push_code('REQ_END');
	return this;
};

SSD.prototype.DST_RES = function () { /* Incoming Destination Request */
	if(!this._expect_before('REQ_END')) {
		if(this._expect_before('SRC_REQ_CLOSED')) { this._push_msg('(IGNORED) Closed source may cause end of response'); } 
		else if(!this._expect_before('DST_REQ')) {
			console.error(this.toString('Incoming destination request before end of destination request and destination request creation'));
		}
	} 
	this._push_code('DST_RES');
	return this;
};

SSD.prototype.RES_END = function () { /* Destination Response & Source Response Ends */
	if(!this._expect_before('DST_RES') && !this._expect_before('DST_RES', 2)) {
		if(this._expect_before('SRC_REQ_CLOSED_U')) { this._push_msg('(IGNORED) Unexpectedly closed source may cause end of response'); }
		else console.error(this.toString('Destination request ends before incoming of destination request'));
	}
	this._push_code('RES_END');
	if(this._message_stack.length > 0 || FORCE_DONE_LOG) {
		this._push_msg('Done');
		console.error(this.toString());
	}
	return this;
};

SSD.prototype.SRC_REQ_CLOSED = function () { /* Source Request Closed */
	this._push_msg('Source request closed');
	console.error(this.toString());
	this._push_code('SRC_REQ_CLOSED');
	return this;
};

SSD.prototype.SRC_REQ_CLOSED_U = function () { /* Unexpected Source Request Closed */
	if(this._expect_before('DST_REQ_TIMEDOUT')) {
		this._push_msg('(IGNORED) Destination request timeout may close source request');
	} else {
		this._push_msg('Unexpected source request close');
		console.error(this.toString());
	}
	
	this._push_code('SRC_REQ_CLOSED_U');
	return this;
};

SSD.prototype.SRC_REQ_TIMEDOUT = function () { /* Destination request timed out */
	if(!this._expect_before('DST_REQ')) {
		this._push_msg('Source request timed out before start of destination request');
	} else {
		console.error(this.toString('Source request timed out'));
		this._push_code('SRC_REQ_TIMEDOUT');
	}
	
	return this;
};

SSD.prototype.DST_REQ_CLOSED = function () { /* Destination Request Closed */
	if(!this._expect_before('RES_END') && !this._expect_before('DST_RES')) {
		this._push_msg('Destination request closed');
		console.error(this.toString());
	}
	
	this._push_code('DST_REQ_CLOSED');
	return this;
};

SSD.prototype.DST_REQ_CLOSED_U = function () { /* Unexpected Destination Request Closed */
	this._push_msg('Unexpected destination request close');
	console.error(this.toString());
	this._push_code('DST_REQ_CLOSED_U');
	return this;
};

SSD.prototype.DST_REQ_TIMEDOUT = function () { /* Destination request timed out */
	if(!this._expect_before('REQ_END')) {
		console.error(this.toString('Destination request timed out before end of destination request'));
		this._push_code('DST_REQ_TIMEDOUT');
	}
	else {
		console.error(this.toString('Destination request timed out'));
		this._push_code('DST_REQ_TIMEDOUT');
	}
	return this;
};

SSD.prototype.DST_REQ_ERROR = function (err) { /* Destination request error */
	this._push_msg('Unexpected destination request error: ' + (err.errno || err.code));
	console.error(this.toString());
	this._push_code('DST_REQ_ERROR');
};

SSD.prototype._expect_before = function (code, step) {
	step = step || 1;
	
	if(this._trace_stack.length < step) {
		return false;
	} else if(this._trace_stack[this._trace_stack.length - step] != code) {
		return false;
	}
	return true;
};

SSD.prototype._push_code = function (code) {
	this._trace_stack.push(code);
};

SSD.prototype._push_msg = function (msg) {
	this._message_stack.push('\t-> ' + msg);
};

SSD.prototype.toString = function (msg) {
	if(msg) this._push_msg(msg);
	return this._method + ' ' + this._url + ': ' + this._trace_stack.join(',') + '\r\n' + this._message_stack.join('\r\n');
};

SSD.printSourceRequest = function (src_req) { //hangup close?
	console.log('----- SOURCE REQUEST BEGIN -----');
	console.log('REQUEST ' + (src_req.complete ? 'COMPLETED' : 'NOT COMPLETED'));
	var printRequestStatus = function (name, obj) {
		if(obj._doneFlag == undefined) throw new Error(name + '\'s _doneFlag is not defined');
		if(obj._destroyed == undefined) throw new Error(name + '\'s _destroyed is not defined');
		if(obj._ended == undefined) throw new Error(name + '\'s _ended is not defined');
		if(obj._finished == undefined) throw new Error(name + '\'s _finished is not defined');
		
		console.log(name + ': ' + (obj._doneFlag ? 'D' : '_') + (obj._destroyed ? 'D' : '_') + (obj._ended ? 'E' : '_') + (obj._finished ? 'F' : '_'));
	}, printReadableState = function (name, obj) {
		if(obj._readableState) {
			if(obj._readableState.ended == undefined) throw new Error(name + '\'s _readableState.ended is not defined');
			if(obj._readableState.endEmitted == undefined) throw new Error(name + '\'s _readableState.endEmitted is not defined');
			
			console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): ' + (obj._readableState.ended ? 'E' : '_') + (obj._readableState.endEmitted ? 'E' : '_'));
		} else console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): not exist');
		
	}, printWritableState = function (name, obj) {
		if(obj._writableState) {
			if(obj._writableState.ended == undefined) throw new Error(name + '\'s _writableState.ended is not defined');
			if(obj._writableState.finished == undefined) throw new Error(name + '\'s _writableState.finished is not defined');
			
			console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): ' + (obj._writableState.ended ? 'E' : '_') + (obj._writableState.finished ? 'F' : '_'));
		} else console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): not exist');
	}, printSocket = function (name, obj) {
		if(obj.destroyed == undefined) throw new Error(name + '\'s destroyed is not defined');
		
		console.log(name + '.socket: ' + (obj.destroyed ? 'D' : '_'));
	};
	
	printReadableState('', src_req);
	printWritableState('', src_req);
	
	if(src_req.socket) {
		printRequestStatus('socket', src_req.socket);
		printReadableState('socket', src_req.socket);
		printWritableState('socket', src_req.socket);
			
		if(src_req.socket._opposite) {
			printRequestStatus('socket._opposite', src_req.socket._opposite);
			printReadableState('socket._opposite', src_req.socket._opposite);
			printWritableState('socket._opposite', src_req.socket._opposite);
		}
		
		if(src_req.socket.socket) {
			printSocket('socket.socket', src_req.socket.socket);
			printReadableState('socket.socket', src_req.socket.socket);
			printWritableState('socket.socket', src_req.socket.socket);
		}
	} else console.log('socket is not found');
	
	if(src_req.connection) {
		printRequestStatus('connection', src_req.connection);
		printReadableState('connection', src_req.connection);
		printWritableState('connection', src_req.connection);
			
		if(src_req.connection._opposite) {
			printRequestStatus('connection._opposite', src_req.connection._opposite);
			printReadableState('connection._opposite', src_req.connection._opposite);
			printWritableState('connection._opposite', src_req.connection._opposite);
		}
		
		if(src_req.connection.socket) {
			printSocket('connection.socket', src_req.connection.socket);
			printReadableState('connection.socket', src_req.connection.socket);
			printWritableState('connection.socket', src_req.connection.socket);
		}
	} else console.log('connection is not found');
	
	if(src_req.client) {
		printRequestStatus('client', src_req.client);
		printReadableState('client', src_req.client);
		printWritableState('client', src_req.client);
			
		if(src_req.client._opposite) {
			printRequestStatus('client._opposite', src_req.client._opposite);
			printReadableState('client._opposite', src_req.client._opposite);
			printWritableState('client._opposite', src_req.client._opposite);
		}
		
		if(src_req.client.socket) {
			printSocket('client.socket', src_req.client.socket);
			printReadableState('client.socket', src_req.client.socket);
			printWritableState('client.socket', src_req.client.socket);
		}
	} else console.log('client is not found');
	
	console.log('----- SOURCE REQUEST  END  -----');	
};

SSD.printSourceResponse = function (src_res) {
	console.log('----- SOURCE RESPONSE BEGIN -----');
	console.log('REQUEST ' + (src_res.finished ? 'FINISHED: ' : 'NOT FINISHED: ') + (src_res._headerSent ? 'H' : '_') + (src_res._hangupClose ? 'H' : '_'));
	
	var printResponseStatus = function (name, obj) {
		if(obj._doneFlag == undefined) throw new Error(name + '\'s _doneFlag is not defined');
		if(obj._destroyed == undefined) throw new Error(name + '\'s _destroyed is not defined');
		if(obj._ended == undefined) throw new Error(name + '\'s _ended is not defined');
		if(obj._finished == undefined) throw new Error(name + '\'s _finished is not defined');
		
		console.log(name + ': ' + (obj._doneFlag ? 'D' : '_') + (obj._destroyed ? 'D' : '_') + (obj._ended ? 'E' : '_') + (obj._finished ? 'F' : '_'));
	}, printReadableState = function (name, obj) {
		if(obj._readableState) {
			if(obj._readableState.ended == undefined) throw new Error(name + '\'s _readableState.ended is not defined');
			if(obj._readableState.endEmitted == undefined) throw new Error(name + '\'s _readableState.endEmitted is not defined');
			
			console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): ' + (obj._readableState.ended ? 'E' : '_') + (obj._readableState.endEmitted ? 'E' : '_'));
		} else console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): not exist');
		
	}, printWritableState = function (name, obj) {
		if(obj._writableState) {
			if(obj._writableState.ended == undefined) throw new Error(name + '\'s _writableState.ended is not defined');
			if(obj._writableState.finished == undefined) throw new Error(name + '\'s _writableState.finished is not defined');
			
			console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): ' + (obj._writableState.ended ? 'E' : '_') + (obj._writableState.finished ? 'F' : '_'));
		} else console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): not exist');
	}, printSocket = function (name, obj) {
		if(obj.destroyed == undefined) throw new Error(name + '\'s destroyed is not defined');
		
		console.log(name + '.socket: ' + (obj.destroyed ? 'D' : '_'));
	};
	
	printReadableState('', src_res);
	printWritableState('', src_res);
	
	if(src_res.socket) {
		printResponseStatus('socket', src_res.socket);
		printReadableState('socket', src_res.socket);
		printWritableState('socket', src_res.socket);
			
		if(src_res.socket._opposite) {
			printResponseStatus('socket._opposite', src_res.socket._opposite);
			printReadableState('socket._opposite', src_res.socket._opposite);
			printWritableState('socket._opposite', src_res.socket._opposite);
		}
		
		if(src_res.socket.socket) {
			printSocket('socket.socket', src_res.socket.socket);
			printReadableState('socket.socket', src_res.socket.socket);
			printWritableState('socket.socket', src_res.socket.socket);
		}
	} else console.log('socket is not found');
	
	if(src_res.connection) {
		printResponseStatus('connection', src_res.connection);
		printReadableState('connection', src_res.connection);
		printWritableState('connection', src_res.connection);
			
		if(src_res.connection._opposite) {
			printResponseStatus('connection._opposite', src_res.connection._opposite);
			printReadableState('connection._opposite', src_res.connection._opposite);
			printWritableState('connection._opposite', src_res.connection._opposite);
		}
		
		if(src_res.connection.socket) {
			printSocket('connection.socket', src_res.connection.socket);
			printReadableState('connection.socket', src_res.connection.socket);
			printWritableState('connection.socket', src_res.connection.socket);
		}
	} else console.log('connection is not found');
	
	console.log('----- SOURCE RESPONSE  END  -----');
};

SSD.printDestinationRequest = function (dst_req) { //hangup close?
	console.log('----- DESTINATION REQUEST BEGIN -----');
	console.log('REQUEST ' + (dst_req.finished ? 'FINISHED: ' : 'NOT FINISHED: ') + (dst_req._headerSent ? 'H' : '_') + (dst_req._hangupClose ? 'H' : '_'));
	
	var printReadableState = function (name, obj) {
		if(obj._readableState) {
			if(obj._readableState.ended == undefined) throw new Error(name + '\'s _readableState.ended is not defined');
			if(obj._readableState.endEmitted == undefined) throw new Error(name + '\'s _readableState.endEmitted is not defined');
			
			console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): ' + (obj._readableState.ended ? 'E' : '_') + (obj._readableState.endEmitted ? 'E' : '_'));
		} else console.log(name + '._readableState(' + (obj.readable ? 'R' : '_') + '): not exist');
		
	}, printWritableState = function (name, obj) {
		if(obj._writableState) {
			if(obj._writableState.ended == undefined) throw new Error(name + '\'s _writableState.ended is not defined');
			if(obj._writableState.finished == undefined) throw new Error(name + '\'s _writableState.finished is not defined');
			
			console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): ' + (obj._writableState.ended ? 'E' : '_') + (obj._writableState.finished ? 'F' : '_'));
		} else console.log(name + '._writableState(' + (obj.writable ? 'W' : '_') + '): not exist');
	}, printSocket = function (name, obj) {
		if(obj.destroyed == undefined) throw new Error(name + '\'s destroyed is not defined');
		
		console.log(name + '.socket: ' + (obj.destroyed ? 'D' : '_'));
	};
	
	printReadableState('', dst_req);
	printWritableState('', dst_req);
	
	if(dst_req.socket) {
		printSocket('socket', dst_req.socket);
		printReadableState('socket', dst_req.socket);
		printWritableState('socket', dst_req.socket);
	} else console.log('socket is not found');
	
	if(dst_req.connection) {
		printSocket('connection', dst_req.connection);
		printReadableState('connection', dst_req.connection);
		printWritableState('connection', dst_req.connection);
	} else console.log('connection is not found');
	console.log('----- DESTINATION REQUEST  END  -----');
};