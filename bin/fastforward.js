#!/usr/bin/env node
'use strict';

var fs = require('fs');

if(process.argv.length == 3) {
	if(process.argv[2].toLowerCase() == 'install') {
		var exec = '/usr/bin/fastforward',
			pidfile = '/var/run/fastforward.pid',
			lockfile = '/var/lock/subsys/fastforward',
			conf_dir = '/etc/fastforward',
			conf = conf_dir + '/conf.cjson',
			default_log_dir = '/var/log/fastforward', 
			default_log_path = default_log_dir + '/access.log';
		
		var initd = [
			'#!/bin/sh',
			'#',
			'# fastforward	The script for fastforward',
			'#',
			'# chkconfig: - 85 15',
			'# processname: fastforward',
			'# pidfile: ' + pidfile,
			'# conf: ' + conf,
			'# description: fastforward is a lightweight reverse proxy',
			'',
			'### BEGIN INIT INFO',
			'# Provides: fastforward',
			'# Required-Start: $local_fs $remote_fs $network',
			'# Required-Stop: $local_fs $remote_fs $network',
			'# Default-Start: 2 3 4 5',
			'# Default-Stop: 0 1 6',
			'# Short-Description: start and stop fastforward',
			'',
			'### END INIT INFO',
			'',
			'# Source function library.',
			'. /etc/rc.d/init.d/functions',
			'',
			'# Source networking configuration.',
			'. /etc/sysconfig/network',
			'',
			'##########',
			'',
			'exec=' + exec,
			'pidfile=' + pidfile,
			'conf=' + conf,
			'lockfile=' + lockfile,
			'',
			'start() {',
			'        status -p ${pidfile} ${exec} >/dev/null 2>&1 && exit 0',
			'',
			'        # Start daemons.',
			'        echo -n $"Starting fastforward: "',
			'',
			'        daemon --pidfile=${pidfile} ${exec} -c ${conf}',
			'        RETVAL=$?',
			'        echo',
			'        [ $RETVAL -eq 0 ] && touch ${lockfile}',
			'        return $RETVAL',
			'}',
			'',
			'stop() {',
			'        echo -n $"Shutting down fastforward: "',
			'        killproc -p ${pidfile} ${exec}',
			'        RETVAL=$?',
			'        echo',
			'        [ $RETVAL = 0 ] && rm -f ${lockfile} ${pidfile}',
			'}',
			'',
			'case "$1" in',
			'  start)',
			'        start',
			'        ;;',
			'  stop)',
			'        stop',
			'        ;;',
			'  status)',
			'        status -p ${pidfile} ${exec}',
			'        ;;',
			'  restart|force-reload)',
			'        stop',
			'        start',
			'        ;;',
			'  try-restart|condrestart|reload)',
			'        exit 3',
			'        ;;',
			'  *)',
			'        echo $"Usage: service fastforward {start|stop|status|restart}"',
			'        exit 2',
			'esac'
		].join('\r\n');

		var cjson = [
		    '{',
		    '	"Upstreams": { /* Upstream server must be specified */',
		    '		"LocalUpstreamServer": [ "localhost:8080;q=1.0" ]',
			'	},',
			'',	
			'	"Servers": [{',
			'		"Port": 80,',
			'		"AccessLog": {',
			'			"Path": "' + default_log_path + '",',
			'			"Format": "$remote_addr [$time_local] \\"$request\\" $status $bytes_sent \\"$http_referer\\" \\"$http_user_agent\\" \\"$gzip_ratio\\""',
			'		},',	
			'		"Name": "localhost",',
			'		"SetProxyHeader": {',
			'			"X-Forwarded-For": "$x_forwarded_for"',
			'		},',
			'		"Locations": {',
			'			"^/": {',
			'				"Forward": "http://LocalUpstreamServer"',
			'			}',
			'		}',
			'	}]',
			'}'
		].join('\r\n');

		try {
			fs.mkdirSync(conf_dir);
		} catch (err) {
			if(err.code != 'EEXIST') throw err;
		}
		
		try {
			fs.mkdirSync(default_log_dir);
		} catch (err) {
			if(err.code != 'EEXIST') throw err;
		}
		
		fs.writeFileSync(conf, new Buffer(cjson));
		fs.writeFileSync('/etc/init.d/fastforward', new Buffer(initd));
		
		return console.log('Fastforward is successfully installed\r\nThe configuration file is under `' + conf + '`\r\nUse `service fastforward start` to start fastforward');
	}
} else if(process.argv.length == 4) {
	if(process.argv[2] == '-c') {
		/* Ignore C-style comments included in the configuration file */
		var cjson = fs.readFileSync(process.argv[3]).toString('utf8');
			cjson = JSON.parse(cjson.replace(/\/\* [\s\S]+? \*\//g, ''));
	
		require('../index').init(cjson);
		return;
	}
} 

console.log('Usage: ' + process.argv[1] + ' install\r\n\tservice fastforward start');