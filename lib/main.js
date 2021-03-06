var widgets = require("sdk/widget");
var tabs = require("sdk/tabs");
var data = require("sdk/self").data;
var URL = require("sdk/url");
var ColorThief = require("./color-thief").ColorThief;
var filter = require("./media-parser").filter;
var parseUri = require("./parse-uri").parseUri;
var utils = require("sdk/window/utils");

var workersMap = new WeakMap();

function getContentWindow() {
  var browserWindow = utils.getMostRecentBrowserWindow();
  return browserWindow.content;
}

/**
 * Draw the current content window to a canvas, using either
 * the viewable area (viewPortOnly=true) or else the entire page.
 */
function windowToCanvas(viewPortOnly) {
  var win = getContentWindow();
  var x, y, width, height;
  if(viewPortOnly) {
    x = win.pageXOffset;
    y = win.pageYOffset;
    width = win.innerWidth;
    height = win.innerHeight;
  } else /* entire page */ {
    x = 0;
    y = 0;
    width = win.innerWidth + win.scrollMaxX;
    height = win.innerHeight + win.scrollMaxY;
  }

  var canvas = win.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  var ctx = canvas.getContext("2d");
  ctx.drawWindow(win, x, y, width, height, "rgb(255,255,255)");

  return canvas;
}

function getWindowPalette() {
  // Draw the active window's DOM to a canvas, then extract palette info
  var canvas = windowToCanvas(true);
  var colorThief = new ColorThief();

  function toHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
  }

  function rgbToHex(r, g, b) {
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }
  // TODO: also convert rgb to HEX when returning

  return colorThief.getPalette(canvas, 4);
}

function stripQuotes(s) {
  return s.replace(/"|'/g, '');
}

function resolveUrl(url) {
  // If it's a data uri, return it untouched
  if(/^\s*data:/.test(url)) {
    return url;
  }
  // Otherwise get the DOM to give us an absolute URL
  var a = getContentWindow().document.createElement('a');
  a.href = url;
  return a.href;
}

function walkCSSRules(fn) {
  // iterate over document.styleSheets applying fn() to the rules we find
  var win = getContentWindow(),
      document = win.document,
      sheet = document.styleSheets,
      rule = null,
      i = sheet.length, j;

  while( 0 <= --i ){
    rule = sheet[i].cssRules;
    j = rule.length;
    while( 0 <= --j ){
      fn(rule[j]);
    }
  }
}

function findFonts() {
  var o = {};

  // TODO: could also try and get typekit, google font, etc. info
  // https://github.com/chengyin/WhatFont-Bookmarklet/blob/master/src/js/whatfont_core.js#L244

  function getFontInfo(src) {
    // Split fontSrc into "url(...) format(...)" pair
    var rUrl = /url\("?([^)]+)"?\)/;
    var rFormat = /format\("?([^)]+)"?\)/;

    return {
      url: stripQuotes(resolveUrl(rUrl.exec(src)[1])),
      format: stripQuotes(rFormat.exec(src)[1])
    };
  }

  // iterate over document.styleSheets and look for @font-face rules
  walkCSSRules(function(rule) {
    var fontName, fontSrc, fontInfo;

    if(rule.cssText.indexOf("@font-face") === -1) {
      return;
    }

    fontName = stripQuotes(rule.style.getPropertyValue("font-family"));
    fontSrc = rule.style.getPropertyValue("src");
    fontInfo = fontSrc.split(/\s*,\s*/).map(function(details) {
      return getFontInfo(details);
    });
    o[fontName] = fontInfo;
  });

  return o;
}

function findBackgroundImages() {
  var o = [], found;
  var rUrl = /url\(([^)]+)\)/g;
  walkCSSRules(function(rule) {
    if(rule.cssText.indexOf("background:") === -1) {
      return;
    }
    while(found = rUrl.exec(rule.cssText)) {
      o.push(resolveUrl(stripQuotes(found[1])));
    }
  });
  return o;
}

function findImages() {
  var images = [];
  var win = getContentWindow();
  var document = win.document;

  // Get all <img> elements
  var list = document.querySelectorAll('img');
  for(var item of list) {
    // Add img src if it's present (ignore <img src="">).
    if(item.src.length) {
      images.push(resolveUrl(item.src));
    }
  }

  // Look for social metadata thumbnails
  var ogImages = document.querySelectorAll('meta[property="og:image"]');
  for(var ogImage of ogImages) {
    images.push(resolveUrl(ogImage.getAttribute('content')));
  }
  var twitterImage = document.querySelector('meta[name="twitter:image"]');
  if(twitterImage) {
    images.push(resolveUrl(twitterImage.getAttribute('content')));
  }

  // Look for images in the CSS
  // TODO...

  return images;
}

function makeWorker(tab) {
  return tab.attach({
    contentScriptFile: data.url("webmaker-colours.js")
  });
}

function getWorkerForTab(tab) {
  if(workersMap.has(tab)) {
    return workersMap.get(tab);
  }

  // If the tab gets recycled, and a new page loaded, invalidate
  function invalidateTab(tab) {
    workersMap.delete(tab);
  }
  tab.on("ready", invalidateTab);
  tab.on("close", invalidateTab);

  var worker = makeWorker(tab);
  workersMap.set(tab, worker);

  worker.port.on("found-elements", function(elements) {
    elements.iframe = filter(elements.iframe);

    // Parse out different aspects of URLs
    for(var name in elements) {
      elements[name] = elements[name].map(function(url) {
        return parseUri(url);
      });
    }

    worker.port.emit("render-srcs", elements);
  });

  worker.port.on("ui-ready", function() {
    var palette = getWindowPalette();
    worker.port.emit("render-palette", palette);
    worker.port.emit("find-elements");

    var fonts = findFonts();
    Object.keys(fonts).forEach(function(font) {
      console.log("Found Font:", font, fonts[font]);
    });

    var images = findImages();
    console.log("Found Images:", images);

    var backgroundImages = findBackgroundImages();
    console.log("Found Background Images:", backgroundImages);
  });

  return worker;
}

var widget = widgets.Widget({
  id: "webmaker-colours",
  label: "Webmaker Colours",
  contentURL: "https://webmaker.org/img/favicon.ico",
  onClick: function() {
    var worker = getWorkerForTab(tabs.activeTab);
    worker.port.emit("setup-ui", {
      html: data.load("webmaker-colours.html"),
      css: data.load("webmaker-colours.css")
    });
  }
});

// TODO: add a context menu for this too.