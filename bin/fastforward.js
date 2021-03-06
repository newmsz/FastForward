#!/usr/bin/env node
'use strict';

var fs = require('fs'),
	child_process = require('child_process');

if(process.argv.length == 3) {
	if(process.argv[2].toLowerCase() == 'install') {
		var exec = '/usr/bin/fastforward',
			pidfile = '/var/run/fastforward.pid',
			lockfile = '/var/lock/subsys/fastforward',
			conf_dir = '/etc/fastforward',
			conf = conf_dir + '/conf.cjson',
			default_log_dir = '/var/log/fastforward', 
			default_log_path = default_log_dir + '/access.log';
		
		var initd;
		if(fs.existsSync('/etc/os-release')) { // Ubuntu
			exec = '/usr/local/bin/fastforward';
			
			initd = [
				'#!/bin/sh',
				'#',
				'# fastforward	The script for fastforward',
				'#',
				'# chkconfig: - 85 15',
				'# processname: fastforward',
				'# pidfile: /var/run/fastforward.pid',
				'# conf: /etc/fastforward/conf.cjson',
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
				'. /lib/init/vars.sh',
				'. /lib/lsb/init-functions',
				'',
				'##########',
				'',
				'exec=' + exec,
				'pidfile=' + pidfile,
				'conf=' + conf,
				'',
				'test -x $exec || exit 0',
				'',
				'start() {',
				'    if pidofproc $exec > /dev/null; then',
				'      status_of_proc -p $pidfile $exec fastforward && exit 0 || exit $?',
				'    else',
				'      log_daemon_msg "Starting fastforward: "',
				'    fi',
				'',
				'    if ! start-stop-daemon --start --quiet --oknodo --exec $exec -- -t $conf; then',
			    '      log_end_msg 1',
			    '      exit 1',
			    '    fi',
			    '',
				'    if start-stop-daemon --start --quiet --oknodo --make-pidfile --background --pidfile $pidfile --exec $exec -- -c $conf; then',
				'      log_end_msg 0',
				'    else',
				'      log_end_msg 1',
				'    fi',
				'}',
				'',
				'stop() {',
				'    if pidofproc $exec > /dev/null; then',
				'      log_daemon_msg "Shutting down fastforward: "',
				'    else',
				'      status_of_proc -p $pidfile $exec fastforward && exit 0 || exit $?',
				'    fi',
				'',
				'    if start-stop-daemon --stop --quiet --oknodo --pidfile $pidfile; then',
				'      log_end_msg 0',
				'    else',
				'      log_end_msg 1',
				'    fi',
				'}',
				'',
				'update() {',
				'    if pidofproc $exec > /dev/null; then',
				'      stop',
				'    fi',
				'',
				'    log_daemon_msg "Updating fastforward: "',
				'',
				'    npm update -g fastforward >/dev/null 2>&1',
				'    fastforward install >/dev/null 2>&1',
				'',
				'    log_end_msg 0',
				'}',
				'',
				'case "$1" in',
				'  start)',
				'    start',
				'    ;;',
				'  stop)',
				'    stop',
				'    ;;',
				'  status)',
				'    status_of_proc -p $pidfile $exec fastforward && exit 0 || exit $?',
				'    ;;',
				'  update)',
				'    update',
				'    ;;',
				'  restart|force-reload)',
				'    stop',
				'    start',
				'    ;;',
				'  try-restart|condrestart|reload)',
				'    exit 3',
				'    ;;',
				'  *)',
				'    log_action_msg "Usage: service fastforward {start|stop|status|restart|update}"',
				'    exit 2',
				'esac'
			].join('\n');
		} else { // CentOS
			initd = [
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
				'    status -p ${pidfile} ${exec} >/dev/null 2>&1 && exit 0',
				'',
				'    echo -n $"Starting fastforward: "',
				'',
				'    nohup ${exec} -c ${conf} >/dev/null 2>&1 &',
				'    RETVAL=$?',
				'    PID=$!',
				'    echo $PID > ${pidfile}',
				'    [ $RETVAL -eq 0 ] && touch ${lockfile} && success || failure',
				'    echo',
				'    return $RETVAL',
				'}',
				'',
				'stop() {',
				'    echo -n $"Shutting down fastforward: "',
				'    killproc -p ${pidfile} ${exec}',
				'    RETVAL=$?',
				'    echo',
				'    [ $RETVAL = 0 ] && rm -f ${lockfile} ${pidfile}',
				'}',
				'',
				'update() {',
				'    status -p ${pidfile} ${exec} >/dev/null 2>&1 && stop',
				'    echo -n $"Updating fastforward: "',
				'    npm update -g fastforward >/dev/null 2>&1',
				'    fastforward install >/dev/null 2>&1',
				'    success',
				'    echo',
				'}',
				'',
				'case "$1" in',
				'  start)',
				'    start',
				'    ;;',
				'  stop)',
				'    stop',
				'    ;;',
				'  status)',
				'    status -p ${pidfile} ${exec}',
				'    ;;',
				'  update)',
				'    update',
				'    ;;',
				'  restart|force-reload)',
				'    stop',
				'    start',
				'    ;;',
				'  try-restart|condrestart|reload)',
				'    exit 3',
				'    ;;',
				'  *)',
				'    echo $"Usage: service fastforward {start|stop|status|restart|update}"',
				'    exit 2',
				'esac'
			].join('\n');
		}
		 

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
		].join('\n');

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
		
		if(!fs.existsSync(conf)) fs.writeFileSync(conf, new Buffer(cjson));
		if(!fs.existsSync('/etc/init.d/fastforward')) {
			fs.writeFileSync('/etc/init.d/fastforward', new Buffer(initd));
			fs.chmodSync('/etc/init.d/fastforward', 0x755);
		}
		
		child_process.exec('chkconfig --add fastforward', function () {
			console.log('Fastforward is successfully installed\r\nThe configuration file is under `' + conf + '`\r\nUse `service fastforward start` to start fastforward');	
		});
		return;
	}
} else if(process.argv.length >= 4) {
	if(process.argv.indexOf('--debug') > 0) {
		require('../index').enableDebugging();
	} 
	if(process.argv.indexOf('--silly') > 0) {
		require('../index').enableSillyMode();
	}
	
	if(process.argv.indexOf('-t') > 0 && process.argv.indexOf('-c') < 0) {
		var cjson;
		
		try {
			cjson =  fs.readFileSync(process.argv[process.argv.indexOf('-t') + 1]).toString('utf8');
		} catch (err) {
			if(err && err.code == 'ENOENT') console.error(err.toString());
			else console.error(err);
			process.exit(1);
		}
		
		try {
			/* Ignore C-style comments included in the configuration file */
			cjson = JSON.parse(cjson.replace(/\/\* [\s\S]+? \*\//g, ''));
		} catch (err) {
			console.error('Error: CONFIGURATION, is the configuration file JSON formatted?', err);
			console.error(err);
			process.exit(1);
		}
	
		try {
			require('../index').setConfiguration(cjson);
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
		
		process.exit(0);
	} else if (process.argv.indexOf('-t') < 0 && process.argv.indexOf('-c') > 0) {
		/* Ignore C-style comments included in the configuration file */
		var cjson = fs.readFileSync(process.argv[process.argv.indexOf('-c') + 1]).toString('utf8');
			cjson = JSON.parse(cjson.replace(/\/\* [\s\S]+? \*\//g, ''));
	
		try {
			require('../index').setConfiguration(cjson);
		} catch (err) {
			console.error(err);
			process.exit(1);
		}

		require('../index').start(cjson);
		return;
	}
} 

console.log('Usage: ' + process.argv[1] + ' install\r\n\tservice fastforward start');