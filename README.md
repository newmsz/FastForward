FastForward
===========

Lightweight Reverse Proxy

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
		"Access Log": {
			"Path": "/var/log/revx/access.log",
			"Format": ""
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