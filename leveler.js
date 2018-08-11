"use strict";

process.title = 'royale-leveler';

const Promise = require('bluebird');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = Promise.promisifyAll(require('fs'));
const pngjs = Promise.promisifyAll(require('pngjs'));
const xmlToJs = Promise.promisify(require('xml2js').parseString);

var _imageDataCache = {}

var server = http.createServer(function(request, response) {
  var mapUrl = url.parse(request.url);
  var filename = path.normalize(mapUrl.pathname);
  var fragIndex = parseInt(mapUrl.query);
  var requestTime = new Date();

  console.log(`${requestTime} Requested: ${request.url} (${filename} @ ${fragIndex})`);

  fs.readFileAsync(process.cwd() + filename, "binary")
    .then(JSON.parse)
    .then((data) => {return parseMap(data, fragIndex);})
    .then(function(data) {
      response.writeHead(200);
      response.write('return ', 'binary');
      writeMapDataToStream(response, data);
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
function writeMapDataToStream(stream, data) {
  switch(typeof data) {
  case 'string':
  case 'number':
    stream.write(data.toString(), 'binary');
    break;

  case 'object':
    stream.write('{', 'binary');

    if(Array.isArray(data)) {
      data.forEach((item) => {
        writeMapDataToStream(stream, item);
        stream.write(',', 'binary');
      });
    }
    else {
      for(var k in data) {
        stream.write(k + '=', 'binary');
        writeMapDataToStream(stream, data[k]);
        stream.write(',', 'binary');
      }
    }
    
    stream.write('}', 'binary');
    break;
  }
}

function parseMap(data, fragIndex) {
  var out = {fragments: []}
  var maxFragmentSize = data.tilewidth;

  out.size = {x: data.width,
              y: data.height};

  data.layers.forEach(function(layer) {
    if(layer.type === 'imagelayer') {
      var imagePath = layer.image;

      var raw = fs.readFileSync(imagePath);
      var imageData;

      if(fragIndex != 0) {
        imageData = _imageDataCache[imagePath];
      }

      if(!imageData) {
        console.log("Loading image data");
        imageData = pngjs.PNG.sync.read(raw);
      }

      _imageDataCache[imagePath] = imageData;
      
      var heightmapWidth = imageData.width;
      var heightmapHeight = imageData.height;

      var fragmentsPerRow = imageData.width / maxFragmentSize;
      var fragmentRow = Math.floor(fragIndex / fragmentsPerRow);
      var fragmentCol = (fragIndex % fragmentsPerRow);
      
      var offsetX = fragmentCol * maxFragmentSize;
      var offsetY = fragmentRow * maxFragmentSize;
      
      var dataSize = imageData.data.length;

      //
      out.total = fragmentsPerRow * fragmentsPerRow;
      out.remaining = out.total - fragIndex - 1;  // -1 because we're already loading this index

      var fragOutput = {}
      fragOutput.x = offsetX;
      fragOutput.y = offsetY;
      
      fragOutput.width = maxFragmentSize;
      fragOutput.height = maxFragmentSize;
      fragOutput.heightmap = [];

      if(layer.properties && layer.properties.floor) {
        fragOutput.floor = layer.properties.floor;
      }
      
      if(layer.properties && layer.properties.height) {
        fragOutput.terrain_height = layer.properties.height;
      }
      
      // Return chunks no larger than maxFragmentSize * maxFragmentSize.
      var fragHasData = false;
      var dataOffset = fragIndex * maxFragmentSize;

      // TODO:  Look into using some form of RLE
      
      for(var y = 0; y < maxFragmentSize; ++y) {
        for(var x = 0; x < maxFragmentSize; ++x) {

          var val = imageData.data[((offsetY + y) * imageData.width + (offsetX + x)) * 4];
          fragOutput.heightmap.push(val);

          fragHasData = fragHasData || val != 0;
        }
      }

      if(fragHasData) {
        out.fragments.push(fragOutput);
      }
    }
  });

  return out;
}

