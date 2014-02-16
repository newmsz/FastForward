var http = require('http'),
	https = require('https'),
	url = require('url'),
	_ = require('underscore');

var server_string = require('../index').server_string;

function Server(name) {
	if(!name) throw new Error('A server does not have name');
	
	this._name = name;
	this._transport = http;
	this._transport_options = null;
	this._listen_port = undefined;
	this._logger = null;
	this._locations = [ ];
}

module.exports = Server;

Server.prototype.getName = function () { 
	return this._name; 
};

Server.prototype.isSSL = function () {
	return !!this._transport_options;
};

Server.prototype.setSSL = function (sslconf) {
	this._transport = https;
	this._transport_options = {
		cert: sslconf.cert,
		key: sslconf.key,
		ca: sslconf.ca
	};
	return this;
};

Server.prototype.setListenPort = function (port) {
	this._listen_port = port;
	return this;
};

Server.prototype.listen = function () {
	this._server = this._transport.createServer(this._transport_options);
	this._server.on('request', _.bind(this._onrequest, this));
	this._server.listen(this._listen_port);
};

Server.prototype.addLocation = function (location) {
	this._locations.push(location);
	return this;
};

Server.prototype.addProxyHeader = function (name, value) {
	for(var i=0; i<this._locations.length; i++)
		this._locations[i].addProxyHeader(name, value);
};

Server.prototype.rewrite = function (from, to, range) {
	to = to.replace('$server_name', this._name)
	for(var i=0; i<this._locations.length; i++)
		this._locations[i].rewrite(from, to, range);
};

Server.prototype.getNumberOfLocations = function () {
	return this._locations.length;
};

Server.prototype.setLogger = function (logger) {
	this._logger = logger;
	return this;
};

Server.prototype.enableZlib = function (types, vary, compressionlevel, minlength) {
	this._zlib = {
		types: types,
		vary: vary,
		minlength: minlength || 0,
		options: { }	
	};
	
	for(var i=0; i<this._locations.length; i++)
		this._locations[i].setZlib(this._zlib);
	
	return this;
};

Server.prototype.toString = function () {
	var retStr = ['----- [SERVER OBJECT] -----'];
	retStr.push((this.isSSL() ? 'HTTPS' : 'HTTP') + '[' + this._listen_port + '] ' + this._name + ' ' + (this._zlib ? 'ZLIB' : ''));
	for(var i=0; i<this._locations.length; i++)
		retStr.push(this._locations[i].toString());
	return retStr.join('\n');
};

Server.prototype._onrequest = function (src_req, src_res) {
	var best = -1, location = null;
	var incoming_url = url.parse(src_req.url);
	for(var i=0; i<this._locations.length; i++) {
		var score = this._locations[i].getMatchScore(incoming_url.pathname);
		if(score > best) {
			best = score;
			location = this._locations[i];
		}
	}
	
	if(location) {
		if(location.tryRewrite(src_req, src_res))
			return;
		if(location.tryForward(src_req, src_res, this._logger))
			return;
	} else {
		src_res.writeHead(404, {
			'server': server_string,
			'connection': 'close'
		});
		src_res.end();
	}
};