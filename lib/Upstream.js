function Upstream(name, hosts) { 
	if(!name) throw new Error('Name for upstream is not specified');
	this._name = name;
	this._host = [];
	for(var i=0; i<hosts.length; i++) {
		var host = hosts[i].split(';');
		if(host.length == 1) {
			this._host.push(host[0]);
		} else if(host.length == 2) {
			//TODO: Priority must be considered
			this._host.push(host[0]);
		} else throw new Error('Unrecognizable host format for upstream "' + name + '": ' + host[i]);
	}
}

module.exports = Upstream;

Upstream.prototype.passToUpstream = function (raw) {
	this._pass_raw = raw;
	return this;
};

Upstream.prototype.getName = function () {
	return this._name;
};

Upstream.prototype.openTransport = function (transport, options, cb) {
	var hostname = this._host[parseInt(Math.random()*this._host.length)],
		port = 80,
		split = hostname.split(':');
	
	hostname = split[0]
	if(split.length == 2) port = parseInt(split[1]);
		
	options.headers.host = this._name;
	options.hostname = hostname;
	options.port = port;
	
	return transport.request(options, cb);
};

Upstream.prototype.toString = function () {
	return this._name + '[' + this._host.join(',') + ']';
};