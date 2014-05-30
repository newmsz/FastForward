var request = require('request'),
	_ = require('underscore'),
	logger = require('./Logger');

function Upstream(name, hosts) { 
	if(!name) throw new Error('Name for upstream is not specified');
	this._name = name;
	this._host = [];
	this._reachable_hosts = [];
	this._hostpool = [];
	
	for(var i=0; i<hosts.length; i++) {		
		var host = hosts[i].split(';');
		if(host.length == 1) { 
			this._host.push(hosts[i] + ';q=1.0');
			this._reachable_hosts.push(hosts[i] + ';q=1.0');
		} else if(host.length == 2) {
			var pri = host[1].split('=');
			if(pri[0] != 'q') throw new Error('Unrecognizable host format for upstream "' + name + '": ' + hosts[i]);
			
			this._host.push(hosts[i]);
			this._reachable_hosts.push(hosts[i]);
		} else throw new Error('Unrecognizable host format for upstream "' + name + '": ' + hosts[i]);
	}
	
	if(this.checkAlive) this._checkAlive();
	this._recalculateHostPool();
}

module.exports = Upstream;

Upstream.prototype.passToUpstream = function (raw) {
	this._pass_raw = raw;
	return this;
};

Upstream.prototype.getName = function () {
	return this._name;
};

Upstream.prototype.checkAlive = true;
Upstream.prototype.PingPeriod = 1000;
Upstream.prototype._checkAlive = function () {
	var len = this._host.length;
	
	for(var i=0; i<this._host.length; i++) {
		(_.bind(function (host) {
			request('http://' + removePriorityFromHost(host), _.bind(function (err, res, body) {
				var idx = this._reachable_hosts.indexOf(host);
				
				if(!err && res && res.statusCode > 0) { //reachable
					if(idx < 0) {
						this._reachable_hosts.push(host);
						logger.info('Connection to Host "' + removePriorityFromHost(host) + '" is restored');
						this._recalculateHostPool();
					}
				} else { //unreachble
					if(idx >= 0) {
						this._reachable_hosts.splice(idx, 1);
						logger.warn('Host "' + removePriorityFromHost(host) + '" is not reachable');
						this._recalculateHostPool();
					}
				}
				
				if(--len == 0) setTimeout(_.bind(this._checkAlive, this), this.PingPeriod);
			}, this));	
		}, this))(this._host[i]);		
	}
};

Upstream.prototype._recalculateHostPool = function () {
	var newhostpool = [];
	
	for(var i=0; i<this._reachable_hosts.length; i++) {
		var host = this._reachable_hosts[i].split(';'),
			pri = host[1].split('=');
		var q = 10;
		
		if(pri[0] == 'q') q = parseInt(parseFloat(pri[1]) * 10);
		
		for(var j=0; j<q; j++)
			newhostpool.push(host[0]);
	}
	
	this._hostpool = newhostpool;
};

Upstream.prototype.openTransport = function (transport, options, cb) {
	if(this._hostpool.length == 0) return null;
	var hostname = this._hostpool[parseInt(Math.random()*this._hostpool.length)],
		port = 80,
		split = hostname.split(':');
	
	hostname = split[0];
	if(split.length == 2) port = parseInt(split[1]);
		
	options.headers.host = this._name;
	options.hostname = hostname;
	options.port = port;
	
	return transport.request(options, cb);
};

Upstream.prototype.toString = function () {
	return this._name + '[' + this._host.join(',') + ']';
};

function removePriorityFromHost (host) {
	return host.split(';')[0];
}