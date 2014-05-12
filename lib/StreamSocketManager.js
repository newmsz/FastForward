var colors = require('colors');

var __uid = 0,
	_rotating_color_on_verbose = true,
	_colors = ['cyan', 'grey', 'magenta', 'green'],
	_silly = false;
	
function StreamSocketManager (src_req, src_res) {
	this._method = src_req.method;
	this._url = src_req.url;
	this._httpversion = src_req.httpVersionMajor + '.' + src_req.httpVersionMinor;
	this._id = ++__uid;
	this._ts_offset = new Date().getTime();
	this._src_req = null;
	this._src_res = null;
	this._dst_req = null;
	this._dst_res = null;
	
	this._src_req_status = 0;
	this._src_res_status = 0;
	this._dst_req_status = 0;
	this._dst_res_status = 0;
	
	this._trace_stack = [];
	this._message_stack = [];
	this.sourceRequest(src_req).sourceResponse(src_res);
	
	if(!this._url.match(/^\/r0/)) this._verbose = true;
}

var STATUS_CODE = {
	OPEN: 0x1,
	ABNORMAL_FIN: 0x2, /* abnormal communication finish */
	NORMAL_FIN: 0x4, /* normal communication finish */
	CLOSED: 0x8, /* socket closed */
	
	_isOpened: function (val) { return (val & STATUS_CODE.OPEN) == STATUS_CODE.OPEN; },
	_isAbnormalFin: function (val) { return (val & STATUS_CODE.ABNORMAL_FIN) == STATUS_CODE.ABNORMAL_FIN; },
	_isNormalFin: function (val) { return (val & STATUS_CODE.NORMAL_FIN) == STATUS_CODE.NORMAL_FIN; },
	_isClosed: function (val) { return (val & STATUS_CODE.CLOSED) == STATUS_CODE.CLOSED; }
};

function stringifyStatusCode (code) {
	return (STATUS_CODE._isOpened(code) ? 'o' : '_') + 
			(STATUS_CODE._isAbnormalFin(code) ? 'a' : '_') + 
			(STATUS_CODE._isNormalFin(code) ? 'e' : '_') + 
			(STATUS_CODE._isClosed(code) ? 'c' : '_');
}

require('util').inherits(StreamSocketManager, require('events').EventEmitter);

StreamSocketManager.prototype._verbose = true;
exports.StreamSocketManager = StreamSocketManager;
exports.verbose = function () {
	StreamSocketManager.prototype._verbose = true;
};

StreamSocketManager.prototype.color = function () {
	return _rotating_color_on_verbose ? 
			_colors[this._id % _colors.length] :
			'white';
};

StreamSocketManager.prototype.sourceRequest = function (src_req) {
	if(this._src_req) this._push_msg('Unexpected source request');
	
	this._src_req = src_req;
	this._src_req_status |= STATUS_CODE.OPEN;
	
	var self = this;
	
	this._src_req.on('close', function () { self._onSourceRequestClosed(); });
	this._src_req.on('timeout', function () { self._onSourceRequestTimeOut(); });
	this._src_req.on('error', function (err) { self._onSourceRequestError(err); });
	this._src_req.on('clientError', function (err) { self._onSourceRequestError(err); });
	this._src_req.on('end', function () { self._onSourceRequestEnd(); });
	
	return this;
};

StreamSocketManager.prototype.sourceResponse = function (src_res) {
	if(this._src_res) this._push_msg('Unexpected source response');
	if(!this._src_req) this._push_msg('Unexpected source response before source request');
	
	this._src_res = src_res;
	this._src_res_status |= STATUS_CODE.OPEN;
	
	var self = this;
	
	this._src_res.on('close', function () { self._onSourceResponseClosed(); });
	this._src_res.on('timeout', function () { self._onSourceResponseTimeOut(); });
	this._src_res.on('error', function (err) { self._onSourceResponseError(err); });
	this._src_res.on('clientError', function (err) { self._onSourceResponseError(err); });
	this._src_res.on('end', function () { self._onSourceResponseEnd(); });
	
	//this.verbose();
	return this;
};

StreamSocketManager.prototype.destinationRequest = function (dst_req) {
	if(this._dst_req) this._push_msg('Unexpected destination request');
	if(!this._src_req || !this._src_res) this._push_msg('Unexpected destination request before source request/response');
	
	this._dst_req = dst_req;
	this._dst_req_status |= STATUS_CODE.OPEN;
	
	var self = this;
	
	this._dst_req.on('close', function () { self._onDestinationRequestClosed(); });
	this._dst_req.on('timeout', function () { self._onDestinationRequestTimeOut(); });
	this._dst_req.on('error', function (err) { self._onDestinationRequestError(err); });
	this._dst_req.on('clientError', function (err) { self._onDestinationRequestError(err); });
	this._dst_req.on('end', function () { self._onDestinationRequestEnd(); });
	
	return this;
};

StreamSocketManager.prototype.destinationResponse = function (dst_res) {
	if(this._dst_res) this._push_msg('Unexpected destination response');
	if(!this._dst_req) this._push_msg('Unexpected destination response before destination request');
	
	this._dst_res = dst_res;
	this._dst_res_status |= STATUS_CODE.OPEN;
	
	var self = this;
	
	this._dst_res.on('close', function () { self._onDestinationResponseClosed(); });
	this._dst_res.on('timeout', function () { self._onDestinationResponseTimeOut(); });
	this._dst_res.on('error', function (err) { self._onDestinationResponseError(err); });
	this._dst_res.on('clientError', function (err) { self._onDestinationResponseError(err); });
	this._dst_res.on('end', function () { self._onDestinationResponseEnd(); });
	
	return this;
};

/**
 * Source Request Event Handlers
 */
StreamSocketManager.prototype._onSourceRequestClosed = function () {
	this._src_req_status |= STATUS_CODE.ABNORMAL_FIN;
	
	if(STATUS_CODE._isAbnormalFin(this._dst_req_status)) {
		this._push_msg('(IGNORED) Source request has been closed due to the destination request error');
	} else {
		this._push_msg('Source request has been unexpectedly closed. Aborting destination request...');
		this._dst_req.abort();
		this.verbose();
	}
};

StreamSocketManager.prototype._onSourceRequestTimeOut = function () {
	throw new Error('source request timed out');
};

StreamSocketManager.prototype._onSourceRequestError = function (err) {
	throw new Error('source request error');
};

StreamSocketManager.prototype._onSourceRequestEnd = function () {
	this._src_req_status |= STATUS_CODE.NORMAL_FIN;
	this._push_msg('Source request end');
	return;
};

/**
 * Source Response Event Handlers
 */
StreamSocketManager.prototype._onSourceResponseClosed = function () {
	this._src_res_status |= STATUS_CODE.ABNORMAL_FIN;
	if(STATUS_CODE._isAbnormalFin(this._src_req_status))
		this._push_msg('(IGNORED) Source response has been closed');
	else {
		this._push_msg('Source response has been unexpectedly closed'); /* Source response close event must not be triggered */
		this.verbose();
	}
};

StreamSocketManager.prototype._onSourceResponseTimeOut = function () {
	this._src_res_status |= STATUS_CODE.ABNORMAL_FIN;
	this._push_msg('Source response timed out');
	this.verbose();
};

StreamSocketManager.prototype._onSourceResponseError = function (err) {
	throw new Error('source response error');
};

StreamSocketManager.prototype._onSourceResponseEnd = function () {
	this._push_msg('Source response has been unexpectedly ended'); /* Source response end event must not be triggered */
	this.verbose();
};

/**
 * Destination Request Event Handlers
 */
StreamSocketManager.prototype._onDestinationRequestClosed = function () {
	if(STATUS_CODE._isAbnormalFin(this._dst_req_status)) {
		this._push_msg('(IGNORED) Destination request closed because the destination request error occured');
		return;
	}
	
	if (STATUS_CODE._isNormalFin(this._dst_res_status)) {
		this._dst_req_status |= STATUS_CODE.NORMAL_FIN;
		this._push_msg('Destination request has been closed');
		return;
	}
	
	this._dst_req_status |= STATUS_CODE.ABNORMAL_FIN;
	
	if(STATUS_CODE._isAbnormalFin(this._src_req_status)) { 
		this._push_msg('(IGNORED) Destination request closed because the source request error occured');
	} else {
		this._push_msg('Destination request has been unexpectedly closed. Aborting source request...');
		this._src_req.connection.destroy();
		this.verbose();
	} 
};

StreamSocketManager.prototype._onDestinationRequestTimeOut = function () {
	this._push_msg('Destination request timed out');
	this.verbose();
	
	this.emit('GatewayTimeout');
};

StreamSocketManager.prototype._onDestinationRequestError = function (err) {
	this._dst_req_status |= STATUS_CODE.ABNORMAL_FIN;

	if(err.errno == 'ECONNRESET' || err.code == 'ECONNRESET') {
		if(STATUS_CODE._isAbnormalFin(this._src_req_status)) {
			this._push_msg('(IGNORED) Destination request error caused by request abortion: ' + (err.errno || err.code));
			return;
		} else {
			this._push_msg('Destination request error because the destination server destroyed the connection: ' + (err.errno || err.code || err.toString()) + ': aborting source request...'); /* always verbose */
			this._src_req.connection.destroy();
			this.verbose();
			return;
		}
	} else if(err.errno == 'ECONNREFUSED' || err.code == 'ECONNREFUSED') {
		this._push_msg('Destination request error: ' + (err.errno || err.code || err.toString())); /* always verbose */
		this.verbose();
		return this.emit('BadGateway');
	} else if(err.errno == 'ECONNABORTED' || err.code == 'ECONNABORTED') {
		/*log_primitives.status = 502;
		logger && logger.log(log_primitives);
		src_res.writeHead(502, {
			'server': server_string
		});
		return src_res.end();*/
	} else if(err.errno == 'ETIMEDOUT' || err.code == 'ETIMEDOUT') {
		/*__DBG_SSD.DST_REQ_TIMEDOUT();
		
		log_primitives.status = 504;
		logger && logger.log(log_primitives);
		src_res.writeHead(504, {
			'server': server_string
		});
		return src_res.end();*/
	}
	
	this._push_msg('Destination request error: ' + (err.errno || err.code || err.toString())); /* always verbose */
	this.verbose();
};

StreamSocketManager.prototype._onDestinationRequestEnd = function () {
	throw new Error('destination request end');
};

/**
 * Destination Response Event Handlers
 */
StreamSocketManager.prototype._onDestinationResponseClosed = function () {
	if(STATUS_CODE._isAbnormalFin(this._dst_res_status)) {
		this._push_msg('(IGNORED) Destination response closed');
	} else {
		this._push_msg('Destination response closed');
		this.verbose();
	}
};

StreamSocketManager.prototype._onDestinationResponseTimeOut = function () {
	throw new Error('destination response timed out');
};

StreamSocketManager.prototype._onDestinationResponseError = function (err) {
	throw new Error('destination response error');
};

StreamSocketManager.prototype._onDestinationResponseEnd = function () {
	if(STATUS_CODE._isAbnormalFin(this._dst_req_status)) {
		this._dst_res_status |= STATUS_CODE.ABNORMAL_FIN;
		this._push_msg('(IGNORED) Destination response ended due to the destination request error');
	} else {
		this._dst_res_status |= STATUS_CODE.NORMAL_FIN;
		this._push_msg('Destination response end');
		this.verbose();
	}
};

StreamSocketManager.prototype._push_msg = function (msg) {
	this._message_stack.push('\t' + (new Date().getTime() - this._ts_offset)  + 'ms: ' + msg);
	
	if(_silly) this.verbose();
};

StreamSocketManager.prototype.verbose = function () {
	if(this._verbose) console.log(this.toString()[this.color()]);
};

StreamSocketManager.prototype.toString = function () {
	var front = this._id + ': ' + this._method + ' ' + this._url + ' HTTP/' + this._httpversion + '\r\n' +  
			'[' + (this._src_req ? 'Sq(' + stringifyStatusCode(this._src_req_status) + ')' : '__(____)') + 
			(this._src_res ? 'Sr(' + stringifyStatusCode(this._src_res_status) + ')' : '__(____)') + 
			(this._dst_req ? 'Dq(' + stringifyStatusCode(this._dst_req_status) + ')' : '__(____)') + 
			(this._dst_res ? 'Ds(' + stringifyStatusCode(this._dst_res_status) + ')' : '__(____)') + ']\r\n';
	
	return front + this._message_stack.join('\r\n');
};

StreamSocketManager.printSourceRequest = function (src_req) { //hangup close?
	console.log('----- SOURCE REQUEST BEGIN -----');
	console.log('REQUEST ' + (src_req.complete ? 'COMPLETED' : 'NOT COMPLETED'));
	var printRequestStatus = function (name, obj) {
		try {
			if(obj._doneFlag == undefined) throw new Error(name + '\'s _doneFlag is not defined');
			if(obj._destroyed == undefined) throw new Error(name + '\'s _destroyed is not defined');
			if(obj._ended == undefined) throw new Error(name + '\'s _ended is not defined');
			if(obj._finished == undefined) throw new Error(name + '\'s _finished is not defined');
		} catch (e) {
			printSocket(name, obj);
		}
		
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

StreamSocketManager.printSourceResponse = function (src_res) {
	console.log('----- SOURCE RESPONSE BEGIN -----');
	console.log('REQUEST ' + (src_res.finished ? 'FINISHED: ' : 'NOT FINISHED: ') + (src_res._headerSent ? 'H' : '_') + (src_res._hangupClose ? 'H' : '_'));
	
	var printResponseStatus = function (name, obj) {
		try {
			if(obj._doneFlag == undefined) throw new Error(name + '\'s _doneFlag is not defined');
			if(obj._destroyed == undefined) throw new Error(name + '\'s _destroyed is not defined');
			if(obj._ended == undefined) throw new Error(name + '\'s _ended is not defined');
			if(obj._finished == undefined) throw new Error(name + '\'s _finished is not defined');
		} catch (e) {
			printSocket(name, obj);
		}
		
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

StreamSocketManager.printDestinationRequest = function (dst_req) { //hangup close?
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