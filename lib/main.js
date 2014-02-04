var widgets = require("sdk/widget");
var tabs = require("sdk/tabs");
var data = require("sdk/self").data;
var URL = require("sdk/url");
var ColorThief = require("./color-thief").ColorThief;
var filters = require("./media-parser").filters;
var parseUri = require("./parse-uri").parseUri;
var utils = require("sdk/window/utils");

var workersMap = new WeakMap();

function getContentWindow() {
  var browserWindow = utils.getMostRecentBrowserWindow();
  return browserWindow.content;
}

function unique(array) {
  var o = {};
  array.forEach(function(item) {
    o[item] = 1;
  });
  return Object.keys(o);
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
    return toHex(r) + toHex(g) + toHex(b);
  }

  var palette = colorThief.getPalette(canvas, 4);
  return palette.map(function(rgb) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    return {
      r: r,
      g: g,
      b: b,
      hex: rgbToHex(r, g, b)
    };
  });
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
  var o = [];

  // TODO: could also try and get typekit, google font, etc. info
  // https://github.com/chengyin/WhatFont-Bookmarklet/blob/master/src/js/whatfont_core.js#L244

  function getFontInfo(src) {
    // Split fontSrc into "url(...) format(...)" pair
    var rUrl = /url\("?([^)]+)"?\)/;
    var rFormat = /format\("?([^)]+)"?\)/;

    try {
      return {
        url: stripQuotes(resolveUrl(rUrl.exec(src)[1])),
        format: stripQuotes(rFormat.exec(src)[1])
      };
    } catch(e) {
      console.log("Error in getFontInfo, src=", src, e);
      return null;
    }
  }

  // iterate over document.styleSheets and look for @font-face rules
  walkCSSRules(function(rule) {
    var fontName, fontSrc, fontInfo;

    if(rule.cssText.indexOf("@font-face") === -1) {
      return;
    }

    fontName = stripQuotes(rule.style.getPropertyValue("font-family"));
    fontSrc = rule.style.getPropertyValue("src");
    fontInfo = [];
    fontSrc.split(/\s*,\s*/).forEach(function(details) {
      // Don't bother with local(..) font decls.
      if(details.indexOf("local(") > -1) {
        return;
      }
      var info = getFontInfo(details);
      if(info) {
        fontInfo.push(info);
      }
    });
    o.push({
      name: fontName,
      resources: fontInfo
    });
  });

  return o;
}

function findBackgroundImages(o) {
  o = o || [];
  var found;
  var rUrl = /url\(([^)]+)\)/g;
  var seen = {};
  var src;

  walkCSSRules(function(rule) {
    if(rule.cssText.indexOf("background:") === -1) {
      return;
    }
    while(found = rUrl.exec(rule.cssText)) {
      src = resolveUrl(stripQuotes(found[1]));
      if(!seen[src]) {
        o.push({
          src: src,
          type: "css"
        });
        seen[src] = 1;
      }
    }
  });
  return o;
}

function findImages() {
  var images = [];
  var win = getContentWindow();
  var document = win.document;
  var seen = {};
  var src;

  // Get all <img> elements
  var list = document.querySelectorAll('img');
  for(var item of list) {
    // Add img src if it's present (ignore <img src="">).
    if(item.src.length) {
      src = resolveUrl(item.src);
      if(!seen[src]) {
        images.push({
          src: src,
          type: "inline"
        });
        seen[src] = 1;
      }
    }
  }
  seen = {};

  // Look for social metadata thumbnails
  var ogImages = document.querySelectorAll('meta[property="og:image"]');
  for(var ogImage of ogImages) {
    src = resolveUrl(ogImage.getAttribute('content'));
    if(!seen[src]) {
      images.push({
        src: src,
        type: "thumb"
      });
      seen[src] = 1;
    }
  }
  var twitterImage = document.querySelector('meta[name="twitter:image"]');
  if(twitterImage) {
    src = resolveUrl(twitterImage.getAttribute('content'));
    if(!seen[src]) {
      images.push({
        src: src,
        type: "thumb"
      });
    }
  }

  // Look for images in the CSS
  findBackgroundImages(images);

  return images;
}

function findMedia(elemType) {
  var o = [];
  var win = getContentWindow();
  var document = win.document;

  // Get all <elemType> elements (video or autio)
  var videos = document.querySelectorAll(elemType);
  for(var video of videos) {
    var v = { format: "inline" };
    if(video.poster && video.poster.length) {
      v.poster = resolveUrl(video.poster);
    }

    // Deal with <video src="...">
    if(video.src && video.src.length) {
      v.src = [{ src: resolveUrl(video.src) }];
      o.push(v);
    } else {
      var sources = video.querySelectorAll('source');
      var src = [];
      for(var source of sources) {
        if(source.src && source.src.length) {
          var s = { src: resolveUrl(source.src) };
          if(source.type && source.type.length) {
            s.type = source.type;
          }
          src.push(s);
        }
      }
      if(src.length) {
        v.src = src;
        o.push(v);
      }
    }
  }

  return o;
}

function findIFrameMedia(type) {
  var o = [];
  var win = getContentWindow();
  var document = win.document;

  // Get all <iframe>
  var iframes = document.querySelectorAll('iframe');
  for(var iframe of iframes) {
console.log("Found iframe url=", iframe.src);
    if(iframe.src.length) {
      o.push(resolveUrl(iframe.src));
    }
  }

  // Look for interesting video/audio embeds
  o = filters[type](o);

  return o.map(function(embedUrl) {
    return {
      src: [{
        url: embedUrl,
        format: "iframe"
      }],
      type: "embed"
    };
  });
}

function findVideo() {
  var videos = findMedia("video");
  var iframeVideos = findIFrameMedia("video");
  if(iframeVideos.length) {
    videos = videos.concat(iframeVideos);
  }
  return videos;
}

function findAudio() {
  var audio = findMedia("audio");
  var iframeAudio = findIFrameMedia("audio");
  if(iframeAudio.length) {
    audio = audio.concat(iframeAudio);
  }
  return audio;
}

var sidebar;

var widget = widgets.Widget({
  id: "webmaker-colours",
  label: "Webmaker Colours",
  contentURL: "https://webmaker.org/img/favicon.ico",
  onClick: function() {
    if(!sidebar) {
      sidebar = require("sdk/ui/sidebar").Sidebar({
        id: 'collector-sidebar',
        title: ' ',
        url: require("sdk/self").data.url("app.html"),
        onAttach: function (worker) {

          function getData() {
            var colours = getWindowPalette();
            var fonts = findFonts();
            var images = findImages();
            var video = findVideo();
            var audio = findAudio();

            var pageData = {
              colours: colours,
              fonts: fonts,
              media: {
                images: images,
                audio: audio,
                video: video
              }
            };

            worker.port.emit("render-data", pageData);
          }

          worker.port.on("ui-ready", function() {
            console.log("got ui-ready");

            tabs.activeTab.on("ready", function() {
              console.log("got ready");
              getData();
            });

            getData();
          });
        }
      });
    }
    sidebar.show();
  }

});

// TODO: add a context menu for this too.
