var bouncy = require('bouncy'),
	fs = require('fs'),
	cluster = require('cluster'),
	debug = exports.debug = true,
	v = JSON.parse(fs.readFileSync('package.json').toString('utf8')).version,
	server_string = exports.server_string = 'FastForward/' + v,
	Upstream = require('./lib/Upstream'),
	Server = require('./lib/Server'),
	Location = require('./lib/Location'),
	Logger = require('./lib/Logger');

exports.init = function (cjson) {
	var upstreams = [ ],
		portmap = { },
		servers = [ ],
		workers = require('os').cpus().length;  

	// ------------------------------------ PARSE CONF ------------------------------------
	if(cjson.Settings) {
		if(cjson.Settings.Workers && (typeof cjson.Settings.Workers === 'number')) workers = cjson.Settings.Workers;
	}

	if(cjson.Upstreams) {
		for(var name in cjson.Upstreams) {
			var hosts = cjson.Upstreams[name];
			if(hosts.length == 0) throw new Error('No host is specified for upstream "' + name + '"');
			upstreams.push(new Upstream(name, hosts));			
		}
	} else throw new Error('No upstream is specified');

	if(cjson.Servers) {
		for(var i=0; i<cjson.Servers.length; i++) {
			var server_conf = cjson.Servers[i];
			var server = new Server(server_conf.Name),
				port = server_conf.Port || 80;
			
			if(!portmap[port]) portmap[port] = [];
			
			if(server_conf.SSL) {
				var sslconf = { 
					cert: fs.readFileSync(server_conf.SSL.Cert),
					key: fs.readFileSync(server_conf.SSL.Key),
					ca: []
				};
				
				if(server_conf.SSL.CA) {
					for(var j=0; j<server_conf.SSL.CA.length; j++)
						sslconf.ca.push(fs.readFileSync(server_conf.SSL.CA[j]));
				}
			
				server.setSSL(sslconf);
				
				for(var j=0; j<portmap[port].length; j++)
					if(portmap[port][j].isSSL()) throw new Error('Cannot bind more than two SSL server at the same port');
			}
			
			portmap[port].push(server);
			
			if(server_conf.Locations) {
				for(var uri in server_conf.Locations) {
					var location = new Location(uri);
					
					if(server_conf.Locations[uri].Forward) {
						location.forwardToUpstream(server_conf.Locations[uri].Forward);
						for(var j=0; j<upstreams.length; j++)
							location.tryResolveUpstream(upstreams[j]);
					}
					
					server.addLocation(location);
				}
			}
			
			if(server.getNumberOfLocations() == 0) server.addLocation(new Location('^/'));
			
			if(server_conf['SetProxyHeader']) {
				for(var headername in server_conf['SetProxyHeader']) {
					server.addProxyHeader(headername, server_conf['SetProxyHeader'][headername]);
				}
			}
			
			if(server_conf['Rewrite']) {
				server.rewrite(server_conf.Rewrite.From, server_conf.Rewrite.To, server_conf.Rewrite.Range);
			}
			
			var default_log_format = '$remote_addr [$time_local] "$request" $status $bytes_sent "$http_referer" "$http_user_agent" "$gzip_ratio"';
			if(server_conf['AccessLog']) {
				server.setLogger(new Logger(server_conf['AccessLog'].Path, server_conf['AccessLog'].Format || default_log_format));
			}
			
			if(server_conf['Gzip']) {
				server.enableZlib(server_conf['Gzip'].Types, server_conf['Gzip'].Vary, server_conf['Gzip'].CompressionLevel, server_conf['Gzip'].MinLength);				
			}
			
			servers.push(server);
		}
	} else throw new Error('No server is specified');

	//------------------------------------ RESOLVE ------------------------------------
	var _prtasn = 8000;

	for(var port in portmap) {
		if(portmap[port].length > 1) {
			var bouncy_map = { };
			
			for(var i=0; i<portmap[port].length; i++) {
				var server = portmap[port][i]; 
				portmap[port][i].setListenPort(_prtasn);
				bouncy_map[server.getName()] = _prtasn++;
			}
				
			portmap[port] = bouncy(function (req, res, bounce) {
				if(bouncy_map[req.headers.host]) 
					bounce(bouncy_map[req.headers.host]);
				else {
					return NotFound(res);
				}
			});
		} else {
			portmap[port][0].setListenPort(parseInt(port));
			portmap[port] = { listen: function () { } };
		}
	}

	//------------------------------------ FORK & LISTEN ------------------------------------
	if (cluster.isMaster && !debug) {
		for (var i = 0; i < workers; i++)
			cluster.fork();
		
		cluster.on('exit', function(worker, code, signal) {
			console.log('worker ' + worker.process.pid + ' died');
		});
	} else {
		for(var i=0; i<servers.length; i++) {
			servers[i].listen();
		}
		
		for(var port in portmap) {
			portmap[port].listen(parseInt(port));
		}
	}

	if(debug) {
		for(var i=0; i<servers.length; i++)
			console.log(servers[i].toString());
	}
	
	process.on('uncaughtException', function (err) {
		console.error(err);
	});

	// GATEWAY RESPONSES
	function NotFound(response) {
		response.writeHead(404, {
			'server': server_string,
			'connection': 'close'
		});
		response.end();
	}
};