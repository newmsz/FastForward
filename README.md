FastForward
===========

Lightweight Reverse Proxy

Install
-------
```
npm install -g fastforward
```

Usage
-----
```
fastforward [conf.cjson]
```

Example Configuration
---------------------
```
{
	"Upstreams": {
		"UpstreamServer1": [ "10.0.0.28:8080;q=1.0" ],
		"UpstreamServer2": [ "10.0.0.28:8080;q=1.0" ],
	},
	
	"Settings": {
		"Workers": 4
	},
	
	"Servers": [{
		"Port": 443,
		"AccessLog": {
			"Path": "access.log",
			"Format": "$remote_addr [$time_local] \"$request\" $status $bytes_sent \"$http_referer\" \"$http_user_agent\" \"$gzip_ratio\""
		},
		"Gzip": {
			"Vary": true,
			"CompressionLevel": 6,
			"MinLength": 1024, /* Response body length less than MinLength will not be compressed */
			"Types": ["text/plain", "text/html", "text/css", "application/json", "application/javascript"]
		},
		"Name": "myownurl.com",
		"SSL": {
			"Cert": "./certificate/certificate.crt",
			"Key": "./certificate/private.key",
			"CA": ["./certificate/bundle.crt"],
			"Protocols": "SSLv3 TLSv1",
			"Ciphers": "ALL:!aNULL:!ADH:!eNULL:!LOW:!EXP:RC4+RSA:+HIGH:+MEDIUM"
		},
		"SetProxyHeader": {
			"X-Forwarded-For": "$x_forwarded_for"
		},
		"Locations": {
			"^/": {
				"Forward": "http://UpstreamServer"
			},
			"^/specific/url": {
				"Forward": "http://UpstreamServer2"
			}
		}
	}, {
		"Port": 80,
		"Name": "myownurl.com",
		"Rewrite": {
			"From": "^.+$",
			"To": "https://$server_name$pathname$query",
			"Range": "Temporary"
		}
	}]
}
```