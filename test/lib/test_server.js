var http = require('http');

var _default_port = 5910;

function TestServer(port) {
	this._server = null;
	this._port = port || _default_port;
	this._onRequest = null;
}

TestServer.prototype.start = function () {
	if(this._server) throw new Error('Trial to start a running server');
	this._server = http.createServer()
	this._server.on('request', this._onRequest);
	this._server.listen(this._port);
	return true;
};

TestServer.prototype.close = function () {
	if(!this._server) throw new Error('Trial to close a stopped server');
	this._server.close();
	this._server = null;
	return true;
};

TestServer.prototype.echoMode = function () {
	this._onRequest = function (req, res) {
		var _reqline = [
		    new Buffer(req.method + ' ' + req.url + ' HTTP/' + req.httpVersionMajor + '.' + req.httpVersionMinor + '\r\n'),
		];
		
		for(var key in req.headers)
			_reqline.push(new Buffer(key + ': ' + req.headers[key] + '\r\n'));
		_reqline.push(new Buffer('\r\n'));
		
		var body = [], body_len = 0;
		
		req.on('data', function (chunk) {
			body.push(chunk);
			body_len += chunk.length;
		});
		
		req.on('end', function () {
			_reqline.push(Buffer.concat(body, body_len));
			
			var content_length = 0;
			
			for(var i=0; i<_reqline.length; i++)
				content_length += _reqline[i].length;
			
			if(req.method == 'POST') {
				res.writeHead(201, { 'content-type': 'text/plain', 'content-length': content_length });
			} else {
				res.writeHead(200, { 'content-type': 'text/plain', 'content-length': content_length });
			}
			
			for(var i=0; i<_reqline.length; i++)
				res.write(_reqline[i]);
			
			res.end();			
		});
	};
	return this;
};

TestServer.prototype.notRespondingMode = function () {
	this._onRequest = function (req, res) {
	};
	return this;
};

TestServer.prototype.abortingMode = function () {
	this._onRequest = function (req, res) {
		setTimeout(function () {
			req.connection.destroy();
		}, 1200);
	};
	return this;
};

TestServer.prototype.answerAndAbortingMode = function () {
	this._onRequest = function (req, res) {
		res.writeHead(200, { 'content-length': 1024 });
		res.write(new Buffer('Dummy Body'));
		res.write(new Buffer('Dummy Body2'));
		res.write(new Buffer('Dummy Body3'));
		
		setTimeout(function () {
			res.write(new Buffer('Dummy Body4'));
			res.write(new Buffer('Dummy Body5'));
			res.write(new Buffer('Dummy Body6'));
		}, 500);
		
		setTimeout(function () {
			res.write(new Buffer('Dummy Body7'));
			req.connection.destroy();
		}, 1200);
	};
	return this;
};

TestServer.prototype.closeConnectionMode = function () {
	this._onRequest = function (req, res) {
		res.writeHead(200, { 
			'connection': 'close'
		});
		res.write(new Buffer('connection closed successfully'));
		res.end();
	};
	return this;
};

exports.createServer = function (port) {
	return new TestServer(port);
};