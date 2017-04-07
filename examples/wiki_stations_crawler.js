#!/usr/bin/env node
'use strict';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.2623.112 Safari/537.36';

	
const Crawler = require('ya-js-crawler');

function parseStationNames(content, link) {
	const accentedCharMap = {
		'Ā': 'A',
		'ā': 'a',
		'Ē': 'E',
		'ē': 'e',
		'Ī': 'I',
		'ī': 'i',
		'Ō': 'O',
		'ō': 'o',
		'Ū': 'U',
		'ū': 'u'
	};
	let narrowed = content.substring(content.indexOf('<h2><span class="mw-headline" id="Station_List">'));
	narrowed = narrowed.substring(narrowed.indexOf('<table>'));
	narrowed = narrowed.substring(0, narrowed.indexOf('</table>'));
	let stationRegEx = /<a href=[^>]+?>(.+?)<\/a>/mg;

	let count = 0;	
	let isEnglish = true;
	let matches = null;
	let enName = null;
	while (matches = stationRegEx.exec(narrowed)) {
		if (isEnglish) {
			enName = matches[1].replace(/[ĀĒĪŌŪāēīōū]/g, function(m) {
				return accentedCharMap[m];
			});
		} else {
			count++;
			let jpName = matches[1];
			let jpkNameRegEx = /（(.+?)）<\/td>/mg;
			jpkNameRegEx.lastIndex = stationRegEx.lastIndex;
			let jpkName = jpkNameRegEx.exec(narrowed)[1];
			console.log(`${enName} (${jpName} - ${jpkName})`);
		}
		isEnglish = !isEnglish;
	}
	console.log(`---- ${count} stations have been parsed out from ${link} ----`);
}

var crawler = new Crawler()
.configure({
	depth: 1,
	// to mimic a brower, as we all know that many websites will check this and DoS when it's not from a browser
	userAgent: userAgent,
	maxConcurrentRequests: 10,
	// that means you don't need crawler to record trail, which will save a lot of memory space when you crawl tons of web urls
	oblivious: true,
	shouldCrawl: function(url) {
		return true;
	},
	onSuccess: function(page) {
		parseStationNames(page.body, page.actualUrl);
	},
	onFailure: function(postmortem) {
    	console.log('Failed to crawl %s', postmortem.url);
    	console.log('...Ask for re-crawling when any expected error happens');
    	// return true means that you need crawler to retry this request again
    	return true;
  	},
	onAllFinished: function() {
		console.log('All japanese station names have been crawled');
 	}
})
.crawl();
for (let postfix of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K-L', 'M', 'N', 'O-P', 'R', 'S', 'T', 'U', 'W', 'Y', 'Z']) {
	crawler.enqueueRequest({
		url: `https://en.wikipedia.org/wiki/List_of_railway_stations_in_Japan:_${postfix}`
	});
}