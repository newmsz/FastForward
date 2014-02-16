var fs = require('fs');
var debug = require('../index.js').debug;

function Logger(path, format) {
	if(!path) throw new Error('Log path is not specified');
	
	if(!debug) this._fd = fs.openSync(path, 'a', 0640);
	this._format = format;
}

module.exports = Logger;

Logger.prototype.dispose = function () {
	!debug && fs.closeSync(this._fd);
};

Logger.prototype.log = function (primitives) {
	var ct = this._format + '\r\n';
	ct = ct.replace('$remote_addr', primitives.remote_addr || '-');
	ct = ct.replace('$time_local', new Date().toUTCString());
	ct = ct.replace('$request', (primitives.method + ' ' + primitives.url + ' HTTP/' + primitives.httpversion) || '-');
	ct = ct.replace('$status', primitives.status || '-');
	ct = ct.replace('$bytes_sent', primitives.bytes_sent || '-');
	ct = ct.replace('$http_referer', primitives.http_referer || '-');
	ct = ct.replace('$http_user_agent', primitives.http_user_agent || '-');
	ct = ct.replace('$bytes_received', primitives.bytes_received || '-');
	ct = ct.replace('$gzip_ratio', (primitives.bytes_received > 0 && primitives.bytes_sent > 0) ? parseInt(100 * primitives.bytes_sent / primitives.bytes_received) + '%' : '-');
	ct = new Buffer(ct);
	
	if(debug) process.stdout.write(ct.toString());
	else fs.write(this._fd, ct, 0, ct.length);
};