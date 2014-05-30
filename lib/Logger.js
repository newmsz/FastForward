var fs = require('fs'); 

function Logger(path, format, debug) {
	if(!debug) {
		this._fd = fs.openSync(path, 'a', 0640);
		if(!path) throw new Error('Log path is not specified');
	} else {
		this._debugMode = true;
	}
	
	this._format = format;
}

exports.Logger = Logger;

Logger.prototype._debugMode = false;
Logger.prototype.dispose = function () {
	!this._debugMode && fs.closeSync(this._fd);
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
	
	if(this._debugMode) process.stdout.write(ct.toString());
	else fs.write(this._fd, ct, 0, ct.length);
};

exports.info = function (msg) {
	console.log('info:', msg);
};

exports.warn = function (msg) {
	console.warn('warning:', msg);
};

