"use strict";

process.title = 'royale-leveler';

const Promise = require('bluebird');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = Promise.promisifyAll(require('fs'));
const pngjs = Promise.promisifyAll(require('pngjs'));
const xmlToJs = Promise.promisify(require('xml2js').parseString);

const _maxFragmentSize = 9999999999999999999999999;

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

function parseMap(data) {
  return loadTilemaps(data)
    .then(function(tilesets) {
      var out = {fragments: []}

      out.size = {x: data.width,
                  y: data.height};

      data.layers.forEach(function(layer) {
        layer.objects.forEach(function(frag) {

          // TODO:  switch on layer type

          var map = tilesets[frag.gid];
          var imageName = map.tileset.image[0].$.source;
          var imagePath = path.dirname(map.path) + '/' + imageName;

          var raw = fs.readFileSync(imagePath);
          var imageData = pngjs.PNG.sync.read(raw);

          var heightmapWidth = imageData.width;
          var heightmapHeight = imageData.height;
          var dataSize = imageData.data.length;

          // Return chunks no larger than _maxFragmentSize * _maxFragmentSize.
          for(var offsetY = 0; offsetY < heightmapWidth; offsetY += _maxFragmentSize) {
            for(var offsetX = 0; offsetX < heightmapWidth; offsetX += _maxFragmentSize) {

              var fragWidth = Math.min(_maxFragmentSize, heightmapWidth - offsetX);
              var fragHeight = Math.min(_maxFragmentSize, heightmapHeight - offsetY);
              
              var fragOutput = {}
              fragOutput.x = offsetX;
              fragOutput.y = offsetY;
              fragOutput.width = fragWidth;
              fragOutput.height = fragHeight;
              fragOutput.resolution = frag.width / imageData.width;
              fragOutput.heightmap = [];

              if(frag.properties && frag.properties.floor) {
                fragOutput.floor = frag.properties.floor;
              }
              
              if(frag.properties && frag.properties.height) {
                fragOutput.terrain_height = frag.properties.height;
              }
              
              // TODO:  Look into using some form of RLE

              for(var y = 0; y < fragHeight; ++y) {
                for(var x = 0; x < fragWidth; ++x) {
                  var idx = ((offsetY + y) * heightmapWidth + (offsetX + x)) * 4;
                  fragOutput.heightmap.push(imageData.data[idx]);
                }
              }
              
              out.fragments.push(fragOutput);
            }
          }
        });
      });

      return out;
    });
}

function loadTilemaps(data) {
  // Return a promise for all maps
  return Promise.reduce(data.tilesets, function(tilesets, mapEntry) {
    var filePath = process.cwd() + "/" + mapEntry.source;
    
    return fs.readFileAsync(filePath)
      .then(xmlToJs)
      .then(function(entry) {
        entry.id = mapEntry.firstgid;
        entry.path = filePath;
        tilesets[entry.id] = entry;
        return tilesets;
      });
  }, {});
}
