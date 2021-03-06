var fs = require('fs'),
	cluster = require('cluster');

function Logger(path, format, debug) {
	this._format = format;
	
	if(!debug) {
		if(!path) throw new Error('Log path is not specified');
		
		this._fd = fs.openSync(path, 'a', 0640);
		
		var self = this;
		
		setInterval(function () {
			var date = new Date();
			
			if(date.getHours() == 0 && date.getMinutes() == 0 && date.getSeconds() == 0) {
				try {
					fs.closeSync(self._fd);
					if(cluster.isMaster) fs.renameSync(path, path.split('.')[0] + '_' + date.toISOString().split('T')[0].replace(/-/g, '') + '.' + path.split('.')[1]);
					self._fd = fs.openSync(path, 'a', 0640);
				} catch (err) { }
			}
		}, 1000);
	} else {
		this._debugMode = true;
	}
}

exports.Logger = Logger;

Logger.prototype._debugMode = false;
Logger.prototype._printLog = true;

Logger.prototype.dispose = function () {
	!this._debugMode && fs.closeSync(this._fd);
};

Logger.prototype.log = function (primitives) {
	if(!this._printLog) return;
	
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

exports.logfilepath = '/var/log/fastforward/fastforward.log';
exports._fd = null;
exports.info = function (msg) { exports._write('info:' + new Date().getTime() + ': ' + msg.toString()); };
exports.warn = function (msg) { exports._write('warning:' + new Date().getTime() + ': ' + msg.toString()); };
exports.error = function (msg) { exports._write('error:' + new Date().getTime() + ': ' + msg.toString()); };

exports._write = function (msg) {
	msg = '(' + process.pid + '):' +  msg
	if(this._debugMode) console.log(msg);
	else {
		if(!exports._fd) exports._fd = fs.openSync(exports.logfilepath, 'a', 0640);
		msg = new Buffer(msg + '\n');
		fs.write(exports._fd, msg, 0, msg.length);
	}
}

