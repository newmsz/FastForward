var http = require('http'),
	cluster = require('cluster'),
	crypto = require('crypto'),
	zlib = require('zlib'),
	_ = require('underscore');

require('longjohn');

var TestServer = require('./lib/test_server');

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

_echoServer.start();
_dnrServer.start();
_abortingServer.start();
_answer_abortingServer.start();