var request = require('request');
var _ = require('underscore');
var url = require('url');
var querystring = require('querystring');

var DEFAULT_DEPTH = 2;
var DEFAULT_MAX_CONCURRENT_REQUESTS = 10;
var DEFAULT_MAX_REQUESTS_PER_SECOND = 100;
var DEFAULT_REQUEST_TIMEOUT = 30 * 1000;
var DEFAULT_MAX_IDLE_TIME = 120 * 1000;
var DEFAULT_USERAGENT = 'crawler/js-crawler';

/*
 * Executor that handles throttling and task processing rate.
 */
function Executor(opts) {
	this.maxRatePerSecond = opts.maxRatePerSecond;
	this.onFinished = opts.finished || function() {};
	this.canProceed = opts.canProceed || function() {return true;};
	this.priorityQueue = [];
	this.queue = [];
	this.isStopped = false;
	this.timeoutMs = (1 / this.maxRatePerSecond) * 1000;
	// for exception handling
	this.idleSince = null;
	this.maxIdleTime = opts.maxIdleTime;
	this.crawler = opts.crawler;
	this.exceptionalIdlenessHandler = opts.exceptionalIdlenessHandler;
}

Executor.prototype.dump = function() {
	console.log('-------- Executor State --------');
	console.log('.timeoutMs: %s ms', this.timeoutMs);
	console.log('.idleSince: %s', this.idleSince? new Date(this.idleSince).toUTCString() : null);
	console.log('.maxIdleTime: %s ms', this.maxIdleTime);
	console.log('.priorityQueue.length: %d', this.priorityQueue.length);
	console.log('.queue.length: %d', this.queue.length);
};

Executor.prototype.submit = function(func, context, args, shouldSkip, immediate) {
	if (immediate) {
		this.priorityQueue.push({
			func: func,
			context: context,
			args: args,
			shouldSkip: shouldSkip
		});
	} else {
		this.queue.push({
			func: func,
			context: context,
			args: args,
			shouldSkip: shouldSkip
		});
	}
};

Executor.prototype.start = function() {
	this._processQueueItem();
};

Executor.prototype.stop = function() {
	this.isStopped = true;
	this.priorityQueue = [];
	this.queue = [];
};

Executor.prototype._exceptionalIdlenessHandler = function() {
	console.log('----- Executor\'s Idleness Exceeds Threshold -----');
	// this.stop();
	// this.start();
	if (this.exceptionalIdlenessHandler && this.crawler) {
		this.exceptionalIdlenessHandler.apply(this.crawler);
	}
};

Executor.prototype._processQueueItem = function() {
	var self = this;

	if (this.canProceed()) {
		var nextExecution = null;
		if (this.priorityQueue.length !== 0) {
			nextExecution = this.priorityQueue.shift();
		}
		else if (this.queue.length !== 0) {
			nextExecution = this.queue.shift();
		}
		if (nextExecution) {
			this.idleSince = null;
			var shouldSkipNext = (nextExecution.shouldSkip && nextExecution.shouldSkip.call(nextExecution.context));

			if (shouldSkipNext) {
				setTimeout(function() {
					self._processQueueItem();
				});
				return;
			} else {
				nextExecution.func.apply(nextExecution.context, nextExecution.args);
			}
		} 
		else {
			if (!this.idleSince) {
				this.idleSince = new Date().getTime();
			} else {
				if (new Date().getTime() - this.idleSince >= this.maxIdleTime) {
					this.idleSince = null;
					this._exceptionalIdlenessHandler();
				}
			}
		}
	}
	if (this.isStopped) {
		return;
  	}

  	setTimeout(function() {
		self._processQueueItem();
	}, this.timeoutMs);
};

/*
 * Main crawler functionality.
 */
function Crawler() {
	/*
	* Urls that the Crawler has visited, as some pages may be in the middle of a redirect chain, not all the _respondedList will be actually
	* reported in the onSuccess or onFailure callbacks, only the final urls in the corresponding redirect chains
	*/
	this._respondedList = [];

	/*
	* Urls that were reported in the onSuccess or onFailure callbacks. this._requestedList is a subset of this._respondedList, and matches it
	* iff there were no redirects while crawling.
	*/
	this.oblivious = false;
	this._requestedList = [];
	this._failedList = [];
	this.depth = DEFAULT_DEPTH;
	this.ignoreRelative = false;
	this.userAgent = DEFAULT_USERAGENT;
	this.maxConcurrentRequests = DEFAULT_MAX_CONCURRENT_REQUESTS;
	this.maxRequestsPerSecond = DEFAULT_MAX_REQUESTS_PER_SECOND;
	this.shouldCrawl = function() {
		return true;
	};
	this._concurrentRequestNumber = 0;
	// Urls that are queued for crawling, for some of them HTTP requests may not yet have been issued
	this._lastRequestId = 0;
	this._enqueuedRequestIds = [];
}

Crawler.prototype.configure = function(options) {
	this.depth = (options && options.depth) || this.depth;
	this.depth = Math.max(this.depth, 0);
	this.ignoreRelative = (options && options.ignoreRelative) || this.ignoreRelative;
	this.userAgent = (options && options.userAgent) || this.userAgent;
	this.maxConcurrentRequests = (options && options.maxConcurrentRequests) || this.maxConcurrentRequests;
	this.maxRequestsPerSecond = (options && options.maxRequestsPerSecond) || this.maxRequestsPerSecond;
	this.shouldCrawl = (options && options.shouldCrawl) || this.shouldCrawl;
	this.oblivious = options.oblivious;
	this.enableTimeOut = options.enableTimeOut || false;
	this.onSuccess = (options && options.onSuccess) || _.noop;
	this.onFailure = (options && options.onFailure) || _.noop;
	this.onAllFinished = (options && options.onAllFinished) || _.noop;

	return this;
};

/*
Crawler.prototype._exceptionalIdlenessHandler = function() {
	console.log('%d urls have not been responded yet', this._enqueuedRequestIds.length);
	var notResponded = this._enqueuedRequestIds;
	this._enqueuedRequestIds = [];
	for (var req of notResponded) {
		console.log('...reissuing %s', req);
		this.enqueueRequest(this._reconstructRequest(req), 1, true);
	}
};
*/

Crawler.prototype.dump = function() {
	console.log('-------- Crawler State --------');
	console.log('.depth: %s', this.depth);
	console.log('.ignoreRelative: %s', this.ignoreRelative);
	console.log('.oblivious: %s', this.oblivious);
	console.log('.maxConcurrentRequests: %s', this.maxConcurrentRequests);
	console.log('.maxRequestsPerSecond: %s', this.maxRequestsPerSecond);
	console.log('._enqueuedRequestIds.length: %d', this._enqueuedRequestIds.length);
	/*
	for (var req of this._enqueuedRequestIds) {
		console.log('\t%s', req);
	}
	*/
	this.workExecutor.dump();
};

Crawler.prototype.crawl = function(url, onSuccess, onFailure, onAllFinished) {
	var self = this;
	
	this.workExecutor = new Executor({
		maxRatePerSecond: this.maxRequestsPerSecond,
		canProceed: function() {
			var shouldProceed = (self._concurrentRequestNumber < self.maxConcurrentRequests);
			return shouldProceed;
		},
		// for exception handling
		maxIdleTime: DEFAULT_MAX_IDLE_TIME,
		crawler: this,
		exceptionalIdlenessHandler: this.dump
	});
	this.workExecutor.start();
	
	if (url) {
		if (!(typeof url === 'string')) {
			var options = url;
			this.enqueueRequest(options, this.depth);
		} else {
			if (onSuccess) this.onSuccess = onSuccess;
			if (onFailure) this.onFailure = onFailure;
			if (onAllFinished) this.onAllFinished = onAllFinished;
			this._crawlUrl(url, this.depth);
		}
	}
	return this;
};

Crawler.prototype._compress = function(options) {
	return this._stringify(options);
};

Crawler.prototype._reconstructRequest = function(s) {
	var options = {};
	var matches = /^(.+?)\?(.+)$/g.exec(s);
	if (!matches) {
		options.url = s;
	}
	else {
		var urlStem = matches[1];
		var qs = matches[2];
		matches = /^(.+?)\[(.+?)\]$/g.exec(urlStem);
		if (!matches) {
			options.url = s;
		} else {
			options.url = matches[1];
			var parts = matches[2].split('-');
			options.method = parts[0];
			if (parts[1] === 'f') {
				options.form = querystring.parse(qs);
			} else if (parts[1] === 'fd') {
				options.formData = querystring.parse(qs);
			}
		}
	}
	return options;
};

Crawler.prototype._stringify = function(options) {
	var url = options.url;
	if (options.method && options.method.toUpperCase != 'GET') {
		if (options.form) url += '[' + options.method.toLowerCase() + '-f]?' + querystring.stringify(options.form);
		else if (options.formData) url += '[' + options.method.toLowerCase() + '-fd]?' + querystring.stringify(options.formData);
	}
	return url;
};

Crawler.prototype._startedCrawling = function(options) {
	this._enqueuedRequestIds.push(options['!@#id#@!']);
};

Crawler.prototype.forgetCrawled = function() {
	this._respondedList = [];
	this._requestedList = [];
	this._failedList = [];
	return this;
};

Crawler.prototype._finishedCrawling = function(options) {
	var idx = this._enqueuedRequestIds.indexOf(options['!@#id#@!']);

	this._enqueuedRequestIds.splice(idx, 1);
	if (this._enqueuedRequestIds.length === 0) {
		this.workExecutor && this.workExecutor.stop();
		this.onAllFinished && this.onAllFinished(this._requestedList, this.__failedList);
	}
};

Crawler.prototype._hasResponded = function(options) {
	return _.contains(this._respondedList, this._stringify(options));
};

Crawler.prototype._request = function(options, callback, immediate) {
	var self = this;
	
	this.workExecutor.submit(function(options, callback) {
		self._concurrentRequestNumber++;
		request(options, callback);
	}, null, [options, callback], function shouldSkip() {
		var req = self._stringify(options);
		var willSkip = false;
		if (!self.oblivious) {
			var willSkip = _.contains(self._respondedList, req);
		}
		willSkip = willSkip || !self.shouldCrawl(options.url);
		if (willSkip && _.contains(self._enqueuedRequestIds, options['!@#id#@!'])) {
			self._finishedCrawling(options);
    	}
    	
    	return willSkip;
	}, immediate);
};

Crawler.prototype.__lzw_encode = function(s) {
	var dict = {};
    var data = (s + '').split('');
    var out = [];
    var currChar;
    var phrase = data[0];
    var code = 256;
    for (var i = 1; i < data.length; i++) {
        currChar = data[i];
        if (dict[phrase + currChar] != null) {
            phrase += currChar;
        }
        else {
            out.push(phrase.length > 1? dict[phrase] : phrase.charCodeAt(0));
            dict[phrase + currChar] = code;
            code++;
            phrase = currChar;
        }
    }
    out.push(phrase.length > 1? dict[phrase] : phrase.charCodeAt(0));
    for (var i = 0; i < out.length; i++) {
        out[i] = String.fromCharCode(out[i]);
    }
    return out.join('');
};

Crawler.prototype.__lzw_decode = function(s) {
    var dict = {};
    var data = (s + '').split('');
    var currChar = data[0];
    var oldPhrase = currChar;
    var out = [currChar];
    var code = 256;
    var phrase;
    for (var i = 1; i < data.length; i++) {
        var currCode = data[i].charCodeAt(0);
        if (currCode < 256) {
            phrase = data[i];
        }
        else {
           phrase = dict[currCode]? dict[currCode] : (oldPhrase + currChar);
        }
        out.push(phrase);
        currChar = phrase.charAt(0);
        dict[code] = oldPhrase + currChar;
        code++;
        oldPhrase = phrase;
    }
    return out.join('');
};

Crawler.prototype._briefRequest = function(options) {
	return this.__lzw_encode(this._stringify(options));
};

Crawler.prototype._doPostmortem = function(options, errCode) {
	return this.__lzw_encode(this._stringify(options) + '=>' + errCode);
};

Crawler.prototype.explain = function(s) {
	return this.__lzw_decode(s);
};

Crawler.prototype._parseType = function(response) {
	var result = null;
	
	var match = /^(.+?)(;.+)?$/gi.exec(response.headers['content-type']);
	if (match && match[1]) result = match[1];
	
	return result;
};

Crawler.prototype._parseEncoding = function(response) {
	var result = 'UTF-8';
	
	var match = /charset=(.+)$/gi.exec(response.headers['content-type']);
	if (match && match[1]) result = match[1]; 
	else if (response.headers['content-encoding']) result = response.headers['content-encoding'];

	return result;
};

Crawler.prototype._genRequestId = function(options) {
	if (options['!@#id#@!']) return options['!@#id#@!'];
	return this._lastRequestId++;
};

Crawler.prototype.enqueueRequest = function(options, depth, immediate) {
	var self = this;
	if (!options.encoding) options.encoding = null;		// Added by @tibetty so as to avoid request treating body as a string by default
	if (!options.rejectUnauthorized) options.rejectUnauthorized = false;
	if (options.headers) options.headers['User-Agent'] = this.userAgent;
	else options.headers = {'User-Agent': this.userAgent};
	if (!options.headers['Referer']) options.headers['Referer'] = null;
	if (this.enableTimeOut && !options.timeout) options.timeout = DEFAULT_REQUEST_TIMEOUT;
	options['!@#id#@!'] = this._genRequestId(options);
	
	if (depth === 0 || !this.oblivious && this._hasResponded(options))
		return;
		
	this._startedCrawling(options);
	this._request(options, function(error, response, body) {
		if (!error && (response.statusCode === 200)) {
			if (!self.oblivious) {
				self._respondedList.push(self._stringify(options));
			}
	      	// if no redirects, then response.request.uri.href === url, otherwise last url
			var lastUrlInRedirectChain = response.request.uri.href;
			if (self.shouldCrawl(lastUrlInRedirectChain)) {
				var type = self._parseType(response);
				var encoding = self._parseEncoding(response);
      			if (type === 'text/html') body = body.toString(encoding);
      			
        		self.onSuccess({
          			url: options.url,
          			actualUrl: lastUrlInRedirectChain,
          			options: options,
          			status: response.statusCode,
          			error: error,
          			response: response,
          			type: type,
          			encoding: encoding,
		  			body: body        
        		}, depth);
        		
        		if (!self.oblivious) {
        			self._requestedList.push(self._briefRequest(options));
        		}
		        /*
		        	Some minor changes made by @tibetty to:
		        	1. ensure further link analysis only make upon html content;
		        	2. convert binary buffer to properly an encoded string to facilitate analysis.
		        */
		        if (depth > 1 && type === 'text/html') {
					self._crawlUrls(self._getAllUrls(lastUrlInRedirectChain, body), depth - 1);
		        }
		     }
		} else {
			if (self.enableTimeOut && error && error.code === 'ESOCKETTIMEDOUT') {
				self.enqueueRequest(options, depth, true);		// automatically retry when socket timeout happens
			} else if (self.onFailure) {
				if (self.onFailure({
					url: options.url,
					options: options,
				    status: response? response.statusCode : undefined,
				    error: error,
				    response: response,
				    body: body
				})) {
					self.enqueueRequest(options, depth, true);
				}
			}
			if (!self.oblivious) {
				self._requestedList.push(self._briefRequest(options));
				self._failedList.push(self._doPostmortem(options, response? 'HTTP: ' + response.statusCode : 'OTHER: ' + error.code));
			}
		}
	    self._concurrentRequestNumber--;
	    self._finishedCrawling(options);
  	}, immediate);
};

Crawler.prototype._crawlUrl = function(url, depth) {
	this.enqueueRequest({url: url}, depth);
};

Crawler.prototype._stripComments = function(str) {
	return str.replace(/<!--.*?-->/g, '');
};

Crawler.prototype._getAllUrls = function(baseUrl, body) {
	var self = this;
	body = this._stripComments(body);
	var linksRegex = self.ignoreRelative? /<a[^>]+?href=".*?:\/\/.*?"/gmi : /<a[^>]+?href=".*?"/gmi;
	var links = body.match(linksRegex) || [];

	links = _.map(links, function(link) {
	    var match = /href=\"(.*?)[#\"]/i.exec(link);
	
	    link = match[1];
	    link = url.resolve(baseUrl, link);
	    return link;
  	});
  	
  	return _.chain(links)
    	.uniq()
    	.filter(this.shouldCrawl)
    	.value();
};

Crawler.prototype._crawlUrls = function(urls, depth) {
	var self = this;

	_.each(urls, function(url) {
		self._crawlUrl(url, depth);
	});
};

module.exports = Crawler;