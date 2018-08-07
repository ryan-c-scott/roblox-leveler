"use strict";

process.title = 'royale-leveler';

const Promise = require('bluebird');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = Promise.promisifyAll(require('fs'));
const pngjs = Promise.promisifyAll(require('pngjs'));
const xmlToJs = Promise.promisify(require('xml2js').parseString);

var server = http.createServer(function(request, response) {
  var filename = path.normalize(request.url);
  var requestTime = new Date();

  if(filename === '/') {
    filename = '/map.json';
  }
  
  console.log(`${requestTime} Requested: ${request.url} (${filename})`);

  fs.readFileAsync(process.cwd() + filename, "binary")
    .then(JSON.parse)
    .then(parseMap)
    .then(function(test) {
      console.log("DATA: " + JSON.stringify(test));
      return test;
    })
    .then(jsMapToLua)
    .then(function(data) {
      response.writeHead(200);
      response.write(data, "binary");
      response.end();
    })
    .catch(function(e) {
      console.log(`${requestTime} Error requesting file: ${filename}`);
      response.writeHead(404);
      response.end(e.message);

      throw(e);
    });

}).listen(9090);

///////////
function jsMapToLua(data) {
  // TODO:  Convert the provided map data into a lua table that can be evaled directly on the client side.
  return JSON.stringify(data);
}

function parseMap(data) {
  return loadTilemaps(data)
    .then(function(tilesets) {
      var out = []

      data.layers.forEach(function(layer) {
        layer.objects.forEach(function(frag) {
          // TODO:  switch on layer type
          var map = tilesets[frag.gid];
          var imageName = map.tileset["$"].name;
          out.push(imageName);
        });
      });

      return out;
    });
}

function loadTilemaps(data) {
  // Return a promise for all maps
  return Promise.reduce(data.tilesets, function(tilesets, mapEntry) {
    return fs.readFileAsync(process.cwd() + "/" + mapEntry.source)
      .then(xmlToJs)
      .then(function(entry) {
        entry.id = mapEntry.firstgid;
        tilesets[entry.id] = entry;
        return tilesets;
      });
  }, {});
}
