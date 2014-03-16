var url = require('url'), 
	http = require('http'),
	https = require('https'),
	zlib = require('zlib');

var server_string = require('../index').server_string;

var DefaultTimeout = 60000;

var PERMANENT = 'Permanent',
	TEMPORARY = 'Temporary';

var DEBUG_SOCKET_STATUS = false;

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
				/*SSD.printSourceRequest(src_req);
				SSD.printSourceResponse(src_res);*/
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.SRC_REQ_CLOSED_U();			
				dst_req.abort();	
			}
		});
		
		dst_req.on('close', function () {
			if(dst_req.finished) {
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_CLOSED();
			} else {
				//SSD.printDestinationRequest(dst_req);
				if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_CLOSED_U();
				src_req.socket.destroy();	
			}
		});
		
		src_req.setTimeout(5000, function () {
			log_primitives.status = 504;
			logger && logger.log(log_primitives);
			src_res.writeHead(504, {
				'server': server_string
			});
			return src_res.end();			
		});
		
		dst_req.setTimeout(5000 /*this._timeout*/, function () {
			if(DEBUG_SOCKET_STATUS) __DBG_SSD.DST_REQ_TIMEDOUT();
			
			if(!src_res._headerSent) {
				log_primitives.status = 504;
				logger && logger.log(log_primitives);
				src_res.writeHead(504, {
					'server': server_string
				});
				return src_res.end();	
			}
			
			src_req.socket.destroy();
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
			}
			
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
	if(this._message_stack.length > 0) {
		console.log(this.toString('done'));
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

SSD.prototype.DST_REQ_CLOSED = function () { /* Destination Request Closed */
	if(!this._expect_before('RES_END') && !this._expect_before('DST_RES')) {
		this._push_msg('Destination request closed');
		console.error(this.toString());
	}
	
	this._push_code('DST_REQ_CLOSED');
	return this;
};

SSD.prototype.DST_REQ_CLOSED_U = function () { /* Unexpected Destination Request Closed */
	console.error(this.toString('Unexpected destination request close'));
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
	if(src_req.socket && src_req.connection && src_req.client) {
		console.log('----- SOURCE REQUEST BEGIN -----');
		if(!((src_req.socket._doneFlag == src_req.connection._doneFlag) && (src_req.connection._doneFlag == src_req.client._doneFlag))) console.log('_doneFlag state difference');
		if(!((src_req.socket._destroyed == src_req.connection._destroyed) && (src_req.connection._destroyed == src_req.client._destroyed))) console.log('_destroyed state difference');
		if(!((src_req.socket._ended == src_req.connection._ended) && (src_req.connection._ended == src_req.client._ended))) console.log('_ended state difference');
		if(!((src_req.socket._finished == src_req.connection._finished) && (src_req.connection._finished == src_req.client._finished))) console.log('_finished state difference');
		
		if(!((src_req.socket._opposite._doneFlag == src_req.connection._opposite._doneFlag) && (src_req.connection._opposite._doneFlag == src_req.client._opposite._doneFlag))) console.log('_opposite._doneFlag state difference');
		if(!((src_req.socket._opposite._destroyed == src_req.connection._opposite._destroyed) && (src_req.connection._opposite._destroyed == src_req.client._opposite._destroyed))) console.log('_opposite._destroyed state difference');
		if(!((src_req.socket._opposite._ended == src_req.connection._opposite._ended) && (src_req.connection._opposite._ended == src_req.client._opposite._ended))) console.log('_opposite._ended state difference');
		if(!((src_req.socket._opposite._finished == src_req.connection._opposite._finished) && (src_req.connection._opposite._finished == src_req.client._opposite._finished))) console.log('_opposite._finished state difference');
		
		if(!((src_req.socket._httpMessage.finished == src_req.connection._httpMessage.finished) && (src_req.connection._httpMessage.finished == src_req.client._httpMessage.finished))) console.log('_httpMessage.finished state difference');
		
		if(!(src_req.socket._destroyed == src_req.client.socket.destroyed)) console.log('socket.destroyed state difference: ' + src_req.client.socket.destroyed);
		
		console.log({
			complete: src_req.complete,
			_doneFlag: src_req.socket._doneFlag,
			_destroyed: src_req.socket._destroyed,
			_ended: src_req.socket._ended,
			_finished: src_req.socket._finished,
			_opposite: {
				_doneFlag: src_req.socket._opposite._doneFlag,
				_destroyed: src_req.socket._opposite._destroyed,
				_ended: src_req.socket._opposite._ended,
				_finished: src_req.socket._opposite._finished,
			},
			_httpMessage: {
				finished: src_req.socket._httpMessage.finished
			}
		});
		console.log('----- SOURCE REQUEST  END  -----');
	} else {
		console.log('something lost');
		/*console.log({
			readable: src_req.readable,
			complete: src_req.complete,
			socket: {
				readable: src_req.socket.readable,
				writable: src_req.socket.writable,
				_doneFlag: src_req.socket._doneFlag,
				_destroyed: src_req.socket._destroyed,
				_ended: src_req.socket._ended,
				_finished: src_req.socket._finished,
				_opposite: {
					readable: src_req.socket._opposite.readable,
					writable: src_req.socket._opposite.writable,
					_doneFlag: src_req.socket._opposite._doneFlag,
					_destroyed: src_req.socket._opposite._destroyed,
					_ended: src_req.socket._opposite._ended,
					_finished: src_req.socket._opposite._finished,
				},
				_httpMessage: {
					writable: src_req.socket._httpMessage.writable,
					finished: src_req.socket._httpMessage.finished
				}
			},
			connection: {
				readable: src_req.connection.readable,
				writable: src_req.connection.writable,
				_doneFlag: src_req.connection._doneFlag,
				_destroyed: src_req.connection._destroyed,
				_ended: src_req.connection._ended,
				_finished: src_req.connection._finished,
				_opposite: {
					readable: src_req.connection._opposite.readable,
					writable: src_req.connection._opposite.writable,
					_doneFlag: src_req.connection._opposite._doneFlag,
					_destroyed: src_req.connection._opposite._destroyed,
					_ended: src_req.connection._opposite._ended,
					_finished: src_req.connection._opposite._finished,
				},
				_httpMessage: {
					writable: src_req.connection._httpMessage.writable,
					finished: src_req.connection._httpMessage.finished
				}
			},
			client: {
				readable: src_req.client.readable,
				writable: src_req.client.writable,
				_doneFlag: src_req.client._doneFlag,
				_destroyed: src_req.client._destroyed,
				_ended: src_req.client._ended,
				_finished: src_req.client._finished,
				_opposite: {
					readable: src_req.client._opposite.readable,
					writable: src_req.client._opposite.writable,
					_doneFlag: src_req.client._opposite._doneFlag,
					_destroyed: src_req.client._opposite._destroyed,
					_ended: src_req.client._opposite._ended,
					_finished: src_req.client._opposite._finished,
				},
				socket: {
					writable: src_req.client.socket.readable,
					finished: src_req.client.socket.writable,
					finished: src_req.client.socket.destroyed
				},
				_httpMessage: {
					writable: src_req.client._httpMessage.writable,
					finished: src_req.client._httpMessage.finished
				}
			}
		});*/
	}	
};

SSD.printSourceResponse = function (src_res) { //hangup close?
	if(src_res.socket && src_res.connection) {
		console.log('----- SOURCE RESPONSE BEGIN -----');
		if(!(src_res.socket._doneFlag == src_res.connection._doneFlag)) console.log('_doneFlag state difference');
		if(!(src_res.socket._destroyed == src_res.connection._destroyed)) console.log('_destroyed state difference');
		if(!(src_res.socket._ended == src_res.connection._ended)) console.log('_ended state difference');
		if(!(src_res.socket._finished == src_res.connection._finished)) console.log('_finished state difference');
		
		if(!(src_res.socket._opposite._doneFlag == src_res.connection._opposite._doneFlag)) console.log('_opposite._doneFlag state difference');
		if(!(src_res.socket._opposite._destroyed == src_res.connection._opposite._destroyed)) console.log('_opposite._destroyed state difference');
		if(!(src_res.socket._opposite._ended == src_res.connection._opposite._ended)) console.log('_opposite._ended state difference');
		if(!(src_res.socket._opposite._finished == src_res.connection._opposite._finished)) console.log('_opposite._finished state difference');
		
		console.log({
			finished: src_res.finished,
			_doneFlag: src_res.socket._doneFlag,
			_destroyed: src_res.socket._destroyed,
			_ended: src_res.socket._ended,
			_finished: src_res.socket._finished,
			_opposite: {
				_doneFlag: src_res.socket._opposite._doneFlag,
				_destroyed: src_res.socket._opposite._destroyed,
				_ended: src_res.socket._opposite._ended,
				_finished: src_res.connection._opposite._finished
			},
			_httpMessage: {
				finished: src_res.socket._httpMessage.finished
			}
		});
		console.log('----- SOURCE RESPONSE  END  -----');
	} else {
		console.log('something lost');
		
		console.log({
			finished: src_res.finished,
			socket: {
				_doneFlag: src_res.socket._doneFlag,
				_destroyed: src_res.socket._destroyed,
				_ended: src_res.socket._ended,
				_finished: src_res.socket._finished,
				_opposite: {
					_doneFlag: src_res.socket._opposite._doneFlag,
					_destroyed: src_res.socket._opposite._destroyed,
					_ended: src_res.socket._opposite._ended,
					_finished: src_res.connection._opposite._finished
				},
				_httpMessage: {
					finished: src_res.socket._httpMessage.finished
				}
			},
			connection: {
				_doneFlag: src_res.connection._doneFlag,
				_destroyed: src_res.connection._destroyed,
				_ended: src_res.connection._ended,
				_finished: src_res.connection._finished,
				_opposite: {
					_doneFlag: src_res.connection._opposite._doneFlag,
					_destroyed: src_res.connection._opposite._destroyed,
					_ended: src_res.connection._opposite._ended,
					_finished: src_res.connection._opposite._finished,
				},
			}
		});
	}	
};

SSD.printDestinationRequest = function (dst_req) { //hangup close?
	if(dst_req.socket && dst_req.connection && dst_req.res) {
		console.log('----- DESTINATION REQUEST BEGIN -----');
		console.log({
			finished: dst_req.finished,
			socket: {
				destroyed: dst_req.socket.destroyed,
			},
			connection: {
				destroyed: dst_req.connection.destroyed
			},
			res: {
				socket: {
					destroyed: dst_req.res.socket.destroyed,	
				},
				connection: {
					destroyed: dst_req.res.connection.destroyed,	
				},
				complete: dst_req.res.complete,
				statusCode: dst_req.res.statusCode,
				client: {
					destroyed: dst_req.res.client.destroyed,
				}
			}
		});
		console.log('----- DESTINATION REQUEST  END  -----');
	} else if(!dst_req.res) {
		console.log('----- DESTINATION REQUEST BEGIN -----');
		console.log({
			finished: dst_req.finished,
			socket: {
				destroyed: dst_req.socket.destroyed,
			},
			connection: {
				destroyed: dst_req.connection.destroyed
			},
			res: dst_req.res
		});
		console.log('----- DESTINATION REQUEST  END  -----');
	} else {
		console.log('something lost');
		console.log({
			finished: dst_req.finished,
			socket: {
				destroyed: dst_req.socket.destroyed,
			},
			connection: {
				destroyed: dst_req.connection.destroyed
			},
			res: {
				socket: {
					destroyed: dst_req.res.socket.destroyed,	
				},
				connection: {
					destroyed: dst_req.res.connection.destroyed,	
				},
				complete: dst_req.res.complete,
				statusCode: dst_req.res.statusCode,
				client: {
					destroyed: dst_req.res.client.destroyed,
				}
			}
		});
	}	
};



// ---------------------------------------- situations
/*
 * destination 타임아웃때문에 src request 터질때


socket.destroyed state difference: false
{ complete: true,
  _doneFlag: true,
  _destroyed: true,
  _ended: false,
  _finished: false,
  _opposite:
   { _doneFlag: true,
     _destroyed: true,
     _ended: false,
     _finished: false },
  _httpMessage: { finished: false } }
----- SOURCE REQUEST  END  -----
----- SOURCE RESPONSE BEGIN -----
{ finished: false,
  _doneFlag: true,
  _destroyed: true,
  _ended: false,
  _finished: false,
  _opposite:
   { _doneFlag: true,
     _destroyed: true,
     _ended: false,
     _finished: false },
  _httpMessage: { finished: false } }
----- SOURCE RESPONSE  END  -----

 */

/*
 * 서버 태부팅으로 source req 터질때 
----- SOURCE REQUEST BEGIN -----
{ complete: true,
_doneFlag: true,
_destroyed: true,
_ended: false,
_finished: false,
_opposite:
 { _doneFlag: true,
   _destroyed: true,
   _ended: false,
   _finished: true },
_httpMessage: { finished: false } }
----- SOURCE REQUEST  END  -----
----- SOURCE RESPONSE BEGIN -----
{ finished: false,
_doneFlag: true,
_destroyed: true,
_ended: false,
_finished: false,
_opposite:
 { _doneFlag: true,
   _destroyed: true,
   _ended: false,
   _finished: true },
_httpMessage: { finished: false } }
----- SOURCE RESPONSE  END  -----
*/


/*
 * 사용자가 눌러서 터질때
----- SOURCE REQUEST BEGIN -----
socket.destroyed state difference: false
{ complete: true,
  _doneFlag: true,
  _destroyed: true,
  _ended: false,
  _finished: false,
  _opposite:
   { _doneFlag: true,
     _destroyed: true,
     _ended: false,
     _finished: false },
  _httpMessage: { finished: false } }
----- SOURCE REQUEST  END  -----
----- SOURCE RESPONSE BEGIN -----
{ finished: false,
  _doneFlag: true,
  _destroyed: true,
  _ended: false,
  _finished: false,
  _opposite:
   { _doneFlag: true,
     _destroyed: true,
     _ended: false,
     _finished: false },
  _httpMessage: { finished: false } }
----- SOURCE RESPONSE  END  -----
*/