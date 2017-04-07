ya-js-crawler
==========

Web crawler for Node.JS, both HTTP and HTTPS are supported.
Yet another js-crawler, a highly customized js-crawler (https://github.com/antivanov/js-crawler) for advanced usage, featuring: 1. priority request queue; 1. opt-in retry when error happens; 2. submit requests manually; 3. oblivious (no trail) and timeout support;

## Installation

```
npm install ya-js-crawler
```

## Usage
Please refer to https://github.com/antivanov/js-crawler/blob/master/README.md for most use cases.

Meanwhile, it has serveral advanced features:

#### Submit request mannually

```javascript
crawler.enqueueRequest({
    url: `https://en.wikipedia.org/wiki/List_of_railway_stations_in_Japan:_${postfix}`
  });
```

This function has 3 arguments: 
* `options` - the "options" used by request, that means you can enqueue HTTP/HTTPS command more than GET, e.g., POST with request body is also supported
* `depth` - depth from this start page, optional
* `immediate` - optional, when it's set to true means the enqueued request will be issued in a higher priority, but still follows "first come, first serve" policy

#### More setting for .configure

* `oblivious` - when it's set to true, no trail will be recorded, thus the memory space will be saved. In this case, you might need to handle duplication in program logic
* `enableTimeout` - when it's set to true, crawler will add a default timeout (30s) to your request options when there's no timeout set

Credits
---------------

Special thanks to antivanov and his js-crawler

The crawler depends on the following Node.JS modules:

* [Underscore.js]
* [Request]

[Underscore.js]: http://underscorejs.org/
[Request]: https://github.com/mikeal/request