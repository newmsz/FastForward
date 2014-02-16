#!/usr/bin/env node
'use strict';

if(process.argv.length != 3)
	return console.log('Usage: fastforward [conf.cjson]');

/* Ignore C-style comments included in the configuration file */
var cjson = require('fs').readFileSync(process.argv[2]).toString('utf8');
	cjson = JSON.parse(cjson.replace(/\/\* [\s\S]+? \*\//g, ''));

require('../index').init(cjson);
