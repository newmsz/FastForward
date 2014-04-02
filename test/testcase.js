var http = require('http'),
	cluster = require('cluster'),
	crypto = require('crypto'),
	zlib = require('zlib'),
	_ = require('underscore');

require('longjohn');

var TestServer = require('./lib/test_server'),
	TestSuite = require('./lib/test_suite');

var hostname = 'localhost',
	ports = {
		ff: 5900,
		echo: 5910,
		dnr: 5920,
		aborting: 5930,
		aaaborting: 5940
	},
	ff_timeout = 3000;

var _echoServer = TestServer.createServer(ports.echo).echoMode(),
	_dnrServer = TestServer.createServer(ports.dnr).notRespondingMode(),
	_abortingServer = TestServer.createServer(ports.aborting).abortingMode(),
	_answer_abortingServer = TestServer.createServer(ports.aaaborting).answerAndAbortingMode();

var fastforward = require('../index');
fastforward._enableDebugging();
fastforward.init({
	"Settings": {
    	"Workers": 1
    },
	"Upstreams": {
		"EchoServer": ['localhost:' + ports.echo + ';q=1.0'],
		"DoNotRespondServer": ['localhost:' + ports.dnr + ';q=1.0'],
		"AbortingServer": ['localhost:' + ports.aborting + ';q=1.0'],
		"AnswerAndAbortingServer": ['localhost:' + ports.aaaborting + ';q=1.0']
    },
    "Servers": [{
    	"Port": ports.ff,
    	"Name": "localhost",
        "SetProxyHeader": {
            "X-Forwarded-For": "$x_forwarded_for"
        },
        "Gzip": {
            "Vary": true,
            "CompressionLevel": 6,
            "MinLength": 1024,
            "Types": ["text/plain", "text/html", "text/css", "application/json", "application/javascript"]
        },
        "Timeout": ff_timeout,
        "Locations": {
            "^/echo": {
                "Forward": "http://EchoServer"
            },
            "^/do_not_respond": {
            	"Forward": "http://DoNotRespondServer"
            },
            "^/aborting": {
            	"Forward": "http://AbortingServer"
            },
            "^/aaaborting": {
            	"Forward": "http://AnswerAndAbortingServer"
            }
        }
    }]
});

TestSuite.newSuite('Request to the upstream which is not running', function (it) {
	it('and specified in locations should fail with 404 and closed connection', function () {
		var req = http.request({
			hostname:  hostname,
			port: ports.ff,
			method: 'GET',
			path: '/not_specified_in_location'
		}, _.bind(function (res) {
			this.expect(404, res.statusCode);
			this.expect('close', res.headers['connection']); /* the connection must be closed for wrong requset */
			this.done();
		}, this));
			
		req.setTimeout(ff_timeout - 1000, _.bind(function () {
			this.fail('request timed out');
		}, this));
		
		req.end();	
	});
	
	it('should fail with the closed connection', function () {
		var req = http.request({
			hostname:  hostname,
			port: ports.ff,
			method: 'GET',
			path: '/echo'
		}, _.bind(function (res) {
			this.expect(502, res.statusCode);
			this.expect('close', res.headers['connection']);
			this.done();
		}, this));
			
		req.setTimeout(ff_timeout - 1000, _.bind(function () {
			this.fail('request timed out');
		}, this));
		
		req.end();	
	});
});

TestSuite.newSuite('NormalRequest', {
	setup: function () {
		_echoServer.start();
	},
	run: function (it) {
		it('"GET /echo" must success', function () {
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'GET',
				path: '/echo'
			}, _.bind(function (res) {
				this.expect(200, res.statusCode);
				this.expect('keep-alive', res.headers['connection']);
				
				var body = [], body_len = 0;
				res.on('data', function (chunk) {
					body.push(chunk);
					body_len += chunk.length;
				});
				
				res.on('end', _.bind(function () {
					body = Buffer.concat(body, body_len).toString().split('\r\n');

					this.expect('GET /echo HTTP/1.1', body[0]);
					for(var i=0; i<body.length; i++) {
						if(body[i].match(/^host/)) this.expect('host: EchoServer', body[i]);
						if(body[i].match(/^connection/)) this.expect('connection: keep-alive', body[i]);
					}
					
					this.exist('x-forwarded-for: 127.0.0.1', body);
					this.expect('', body[body.length - 1]);
					this.done();	
				}, this));
			}, this));
				
			req.setTimeout(ff_timeout - 1000, _.bind(function () {
				this.fail('request timed out');
			}, this));
			
			req.end();	
		});
		
		it('"POST /echo" must success', function () {
			var randomBytes = crypto.randomBytes(1048576);
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'POST',
				path: '/echo',
				headers: {
					'connection': 'close',
					'content-type': 'text/plain'
				}
			}, _.bind(function (res) {
				this.expect(201, res.statusCode);
				this.expect('close', res.headers['connection']);
				
				var body = [], body_len = 0;
				res.on('data', function (chunk) {
					body.push(chunk);
					body_len += chunk.length;
				});
				
				res.on('end', _.bind(function () {
					body = Buffer.concat(body, body_len);

					var _recv_request = body.slice(0, body.length - randomBytes.length);
						_recv_randomBytes = body.slice(body.length - randomBytes.length, body.length);
					
					body = _recv_request.toString().split('\r\n');
				
					this.expect('POST /echo HTTP/1.1', body[0]);
					for(var i=0; i<body.length; i++) {
						if(body[i].match(/^host/)) this.expect('host: EchoServer', body[i]);
						if(body[i].match(/^connection/)) this.expect('connection: keep-alive', body[i]);
					}
					
					this.exist('x-forwarded-for: 127.0.0.1', body);
					this.expect(randomBytes, _recv_randomBytes);
					this.done();	
				}, this));
			}, this));
				
			req.setTimeout(ff_timeout - 1000, _.bind(function () {
				this.fail('request timed out');
			}, this));
			
			req.write(randomBytes);
			req.end();	
		});
		
		it('"POST /echo" with deflate algorithm must success', function () {
			var randomBytes = crypto.randomBytes(1048576);
			var gzip = zlib.createGzip();
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'POST',
				path: '/echo',
				headers: {
					'content-type': 'text/plain',
					'accept-encoding': 'deflate'
				}
			}, _.bind(function (res) {
				this.expect(201, res.statusCode);
				this.expect('keep-alive', res.headers['connection']);
				
				var inflate = zlib.createInflate();
				res.pipe(inflate);
				
				var body = [], body_len = 0;
				inflate.on('data', function (chunk) {
					body.push(chunk);
					body_len += chunk.length;
				});
				
				inflate.on('end', _.bind(function () {
					body = Buffer.concat(body, body_len);

					var _recv_request = body.slice(0, body.length - randomBytes.length);
						_recv_randomBytes = body.slice(body.length - randomBytes.length, body.length);
					
					body = _recv_request.toString().split('\r\n');
				
					this.expect('POST /echo HTTP/1.1', body[0]);
					for(var i=0; i<body.length; i++) {
						if(body[i].match(/^host/)) this.expect('host: EchoServer', body[i]);
						if(body[i].match(/^connection/)) this.expect('connection: keep-alive', body[i]);
					}
					
					this.exist('x-forwarded-for: 127.0.0.1', body);
					this.expect(randomBytes, _recv_randomBytes);
					this.done();	
				}, this));
			}, this));
				
			req.setTimeout(ff_timeout - 1000, _.bind(function () {
				this.fail('request timed out');
			}, this));
			
			req.write(randomBytes);
			req.end();	
		});
		
		it('"POST /echo" with gzip algorithm must success', function () {
			var randomBytes = crypto.randomBytes(1048576);
			var gzip = zlib.createGzip();
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'POST',
				path: '/echo',
				headers: {
					'connection': 'close',
					'content-type': 'text/plain',
					'accept-encoding': 'gzip'
				}
			}, _.bind(function (res) {
				this.expect(201, res.statusCode);
				this.expect('close', res.headers['connection']);
				
				var gzip = zlib.createGunzip();
				res.pipe(gzip);
				
				var body = [], body_len = 0;
				gzip.on('data', function (chunk) {
					body.push(chunk);
					body_len += chunk.length;
				});
				
				gzip.on('end', _.bind(function () {
					body = Buffer.concat(body, body_len);

					var _recv_request = body.slice(0, body.length - randomBytes.length);
						_recv_randomBytes = body.slice(body.length - randomBytes.length, body.length);
					
					body = _recv_request.toString().split('\r\n');
				
					this.expect('POST /echo HTTP/1.1', body[0]);
					for(var i=0; i<body.length; i++) {
						if(body[i].match(/^host/)) this.expect('host: EchoServer', body[i]);
						if(body[i].match(/^connection/)) this.expect('connection: keep-alive', body[i]);
					}
					
					this.exist('x-forwarded-for: 127.0.0.1', body);
					this.expect(randomBytes, _recv_randomBytes);
					this.done();	
				}, this));
			}, this));
				
			req.setTimeout(ff_timeout - 1000, _.bind(function () {
				this.fail('request timed out');
			}, this));
			
			req.write(randomBytes);
			req.end();	
		});
		
		it('"PUT /echo must not be timed out because it sends the data periodically within timeout limit', function () {
			/* REQ 6 */
			var self = this,
				timedout = false,
				kbytesToSend = [crypto.randomBytes(1024), crypto.randomBytes(1024), crypto.randomBytes(1024)];
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'PUT',
				path: '/echo',
				headers: {
					'content-length': kbytesToSend.length * 1024
				}
			}, function (res) {
				self.expect(200, res.statusCode);
				self.expect('keep-alive', res.headers['connection']);
				
				var body = [], body_len = 0;
				res.on('data', function (chunk) {
					body.push(chunk);
					body_len += chunk.length;
				});
				
				res.on('end', function () {
					body = Buffer.concat(body, body_len);
					var randomBytes = Buffer.concat(kbytesToSend, 1024 * kbytesToSend.length);

					var _recv_request = body.slice(0, body.length - randomBytes.length);
						_recv_randomBytes = body.slice(body.length - randomBytes.length, body.length);
					
					body = _recv_request.toString().split('\r\n');
				
					self.expect('PUT /echo HTTP/1.1', body[0]);
					for(var i=0; i<body.length; i++) {
						if(body[i].match(/^host/)) self.expect('host: EchoServer', body[i]);
						if(body[i].match(/^connection/)) self.expect('connection: keep-alive', body[i]);
					}
					
					self.exist('x-forwarded-for: 127.0.0.1', body);
					
					self.expect(randomBytes, _recv_randomBytes);
					self.done();	
				});
			});
			
			req.on('error', function (err) {
				if(err.code == 'ECONNRESET') return;
				self.fail(err);
			});
			
			var i=0;
			var intv = setInterval(function () {
				req.write(kbytesToSend[i++]);
				
				if(i==kbytesToSend.length) {
					req.end();
					clearInterval(intv);
				}
			}, ff_timeout - 500)
			
			req.setTimeout(ff_timeout, function () {
				req.abort();
				self.fail(' client timed out');
			});	
		});
	}, 
	teardown: function () {
		_echoServer.close();
	}
});

TestSuite.newSuite('Request to "Not responding" server', {
	setup: function () {
		_dnrServer.start();
	},
	run: function (it) {
		it('"GET /do_not_respond" must be client timed out after ' + parseInt((ff_timeout - 1000) / 1000) + ' seconds', function () {
			/* REQ 7 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'GET',
				path: '/do_not_respond'
			}, function (res) {
				self.fail('response occured');
			});
			
			req.on('error', function (err) {
				if(err.code == 'ECONNRESET') return;
				self.fail(err);
			});
				
			req.setTimeout(ff_timeout - 1000, function () {
				req.abort();
				self.expect(true, true);
				self.done();
			});
			
			req.end();	
		});
				
		it('"GET /do_not_respond" must be server timed out after ' + parseInt((ff_timeout) / 1000) + ' seconds', function () {
			/* REQ 8 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'GET',
				path: '/do_not_respond'
			}, function (res) {
				self.expect(504, res.statusCode);
				self.expect('close', res.headers['connection']);
				self.done();
			});
			
			req.on('error', function (err) {
				if(err.code == 'ECONNRESET') return;
				self.fail(err);
			});
				
			req.setTimeout(ff_timeout + 1000, function () {
				req.abort();
				self.fail(' client timed out');
			});
			
			req.end();	
		});
	}, 
	teardown: function () {
		_dnrServer.close();
	}
});

TestSuite.newSuite('Unfinished request to "Not responding" server', {
	setup: function () {
		_dnrServer.start();
	},
	run: function (it) {
		it('"POST /do_not_respond" must be server timed out after ' + parseInt((ff_timeout) / 1000) + ' seconds', function () {
			/* REQ 9 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'POST',
				path: '/do_not_respond'
			}, function (res) {
				self.expect(504, res.statusCode);
				self.expect('close', res.headers['connection']);
				self.done();
			});
			
			req.on('error', function (err) {
				if(err.code == 'ECONNRESET') return;
				self.fail(err);
			});
			
			req.setTimeout(ff_timeout + 1000, function () {
				req.abort();
				self.fail(' client timed out');
			});
			
			req.write(new Buffer('Message to flush the request'));
		});
		
		it('that will be aborted while sending must be handled', function () {
			/* REQ 10 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'PATCH',
				path: '/do_not_respond'
			}, function (res) {
				self.fail('response occured');
			});
			
			req.on('error', function (err) {
				if(err.code == 'ECONNRESET') return;
				self.fail(err);
			});
			
			req.setTimeout(ff_timeout + 1000, function () {
				req.abort();
				self.fail(' client timed out');
			});
			
			req.write(new Buffer('Message to flush the request'));
			
			setTimeout(function () {
				self.expect(true, true);
				self.done();
				req.abort();
			}, ff_timeout / 2);
		});
	}, 
	teardown: function () {
		_dnrServer.close();
	}
});

TestSuite.newSuite('Request to "Aborting" server', {
	setup: function () {
		_abortingServer.start();
	},
	run: function (it) {
		it('must emit an error that reset the connection', function () {
			/* REQ 11 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'POST',
				path: '/aborting'
			}, function (res) {
				self.fail('response occured');
			});
			
			req.on('error', function (err) {
				if(err && err.code == 'ECONNRESET') {
					self.expect(true, true);
					self.done();
				} else
					self.fail(err.code);
			});
			
			req.setTimeout(ff_timeout + 1000, function () {
				req.abort();
				self.fail(' client timed out');
			});
			
			req.write(new Buffer('Message to flush the request'));
			
			setTimeout(function () {
				req.write(new Buffer('Message to flush the request'));
				req.end();
			}, ff_timeout / 2);
		});
	}, 
	teardown: function () {
		_abortingServer.close();
	}
});


TestSuite.newSuite('Request to "AnswerAndAborting" server', {
	setup: function () {
		_answer_abortingServer.start();
	},
	run: function (it) {
		it('it must be handled properly', function () {
			/* REQ 12 */
			var self = this,
				timedout = false;
			
			var req = http.request({
				hostname:  hostname,
				port: ports.ff,
				method: 'PATCH',
				path: '/aaaborting'
			}, function (res) {
				self.expect(200, res.statusCode);
				self.expect('keep-alive', res.headers['connection']);
				
				res.on('error', function (err) {
					console.error(err);
					self.fail(err);
				});
				
				res.on('close', function () {
					console.log('sudden closed');
				});
			});
			
			req.on('error', function (err) {
				console.error(err);
				self.fail(err);
			});
			
			req.setTimeout(ff_timeout + 1000, function () {
				req.abort();
				self.fail(' client timed out');
			});
			
			req.write(new Buffer('Message to flush the request'));
			
			setTimeout(function () {
				req.write(new Buffer('Message to flush the request'));
				req.end();
			}, ff_timeout / 2);
		});
	}, 
	teardown: function () {
		_answer_abortingServer.close();
	}
});
TestSuite.run();