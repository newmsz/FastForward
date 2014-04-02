var _ = require('underscore'),
	colors = require('colors');

colors.setTheme({
	info: 'white',
	error: 'red'
});

function TestSuite (number, description, target) {
	this._suite_no = number;
	this._description = description;
	this._testcases = [];
	this._completed = 0;
	
	this._setup_f = null;
	this._run_f = null;
	this._teardown_f = null;
	
	if(typeof target == 'function') {
		this._run_f = target;
	} else if(typeof target == 'object') {
		if(!target.run) throw new Error('Test suite target function is not specified');
		
		this._setup_f = target.setup;
		this._run_f = target.run;
		this._teardown_f = target.teardown;
	} else throw new Error('Unknown test suite target type: ' + (typeof target));
}

TestSuite.prototype.run = function () {
	if(this._setup_f) this._setup_f();
	this._run_f(_.bind(this._it, this));
};

TestSuite.prototype._it = function (text, func) {
	var tc = new TestCase(this._suite_no + ') ' + this._description + ' ' + text, func);
	tc._done = _.bind(this._testcase_done, this);
	this._testcases.push(tc);
	
	setTimeout(function () {
		tc._run();	
	}, 1);
};

TestSuite.prototype._testcase_done = function () {
	if(++this._completed == this._testcases.length) {
		if(this._teardown_f) this._teardown_f();
		_next();
	}
};

function TestCase (text, func) {
	this._text = text;
	this._function = func;
	this._assert_count = 0;
	this._failed_assert_count = 0;
	this._error_messages = [];
}

TestCase.prototype._run = function () {
	this._function();
};

TestCase.prototype.log = function (msg) {
	process.stdout.write(msg);
};

TestCase.prototype.setTimeout = function (name, cb, sec) {
	this.log(name + ' for `' + sec + '`s.');
	
	var self = this;
	var printTimeout = function (sec) {
		setTimeout(function () {
			if(sec > 1) {
				self.log('.');
				printTimeout(sec - 1);
			} else cb && cb();
		}, 1000);	
	};
	
	printTimeout(sec);
};

TestCase.prototype.expect = function (expect, actual) {
	this._assert_count++;
	
	if(Buffer.isBuffer(expect)) {
		if(!Buffer.isBuffer(actual)) {
			this._failed_assert_count++;
			this._error_messages.push('expected `buffer` type but `' + (typeof actual) + '` type');
			return;
		}
		
		if(expect.length != actual.length) {
			this._failed_assert_count++;
			this._error_messages.push('buffer length difference');
			return;
		}
		
		for(var i=0; i<expect.length; i++) {
			if(expect[i] != actual[i]) {
				this._failed_assert_count++;
				this._error_messages.push('buffer content difference');
				return;		
			}
		}
	} else if(expect != actual) {
		this._failed_assert_count++;
		this._error_messages.push('expected `' + expect + '` but `' + actual + '`');
	}
};

TestCase.prototype.expectUndefined = function (actual) {
	this._assert_count++;
	
	if(actual !== undefined) {
		this._failed_assert_count++;
		this._error_messages.push('expected undefined value but `' + typeof actual + '`');
	}
};

TestCase.prototype.exist = function (value, array) {
	this._assert_count++;
	
	for(var i=0; i<array.length; i++) {
		if(array[i] == value) return;
	}
	
	this._failed_assert_count++;
	this._error_messages.push('value `' + value + '` is not found');
};

TestCase.prototype.fail = function (message) {
	this._assert_count++;
	this._failed_assert_count++;
	this._error_messages.push(message);
	this.done();
};

TestCase.prototype.done = function () {
	if(this._failed_assert_count == 0) {
		console.log(this._text + ': PASS (' + (this._assert_count - this._failed_assert_count) + '/' + this._assert_count + ')');	
	} else {
		console.log(this._text + ': ' + ('FAIL (' + (this._assert_count - this._failed_assert_count) + '/' + this._assert_count + ')').error);
		for(var i=0; i<this._error_messages.length; i++)
			console.log('\t' + this._error_messages[i].error);
	}
	
	this._done();
};

var SuiteSeries = [], current_suite_pos = -1;
exports.newSuite = function (description, func) {
	var suite = new TestSuite(SuiteSeries.length + 1, description, func);
	SuiteSeries.push(suite);
	return suite;
};

function _next() {
	if(SuiteSeries[++current_suite_pos])
		SuiteSeries[current_suite_pos].run();
	else {
		console.log('Waiting 8 seconds for unchecked errors...');
		setTimeout(function () {
			process.exit(0);
		}, 12000);
	}
}

exports.run = function () {
	_next();
};
