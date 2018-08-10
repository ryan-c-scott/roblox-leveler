"use strict";

process.title = 'royale-leveler';

const Promise = require('bluebird');
const http = require('http');
const path = require('path');
const url = require('url');
const fs = Promise.promisifyAll(require('fs'));
const pngjs = Promise.promisifyAll(require('pngjs'));
const xmlToJs = Promise.promisify(require('xml2js').parseString);

const _maxFragmentSize = 128;

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
          var imageData;

          if(fragIndex != 0) {
            imageData = _imageDataCache[imagePath];
          }

          if(!imageData) {
            imageData = pngjs.PNG.sync.read(raw);
          }
          
          var heightmapWidth = imageData.width;
          var heightmapHeight = imageData.height;

          var fragmentsPerRow = imageData.width / _maxFragmentSize;
          var fragmentRow = Math.floor(fragIndex / fragmentsPerRow);
          var fragmentCol = (fragIndex % fragmentsPerRow);
      
          var offsetX = fragmentCol * _maxFragmentSize;
          var offsetY = fragmentRow * _maxFragmentSize;
          
          var dataSize = imageData.data.length;

          //
          out.total = fragmentsPerRow * fragmentsPerRow;
          out.remaining = out.total - fragIndex - 1;  // -1 because we're already loading this index

          var fragOutput = {}
          fragOutput.x = offsetX;
          fragOutput.y = offsetY;
          
          fragOutput.width = _maxFragmentSize;
          fragOutput.height = _maxFragmentSize;
          fragOutput.resolution = frag.width / imageData.width;
          fragOutput.heightmap = [];

          if(frag.properties && frag.properties.floor) {
            fragOutput.floor = frag.properties.floor;
          }
          
          if(frag.properties && frag.properties.height) {
            fragOutput.terrain_height = frag.properties.height;
          }
          
          // Return chunks no larger than _maxFragmentSize * _maxFragmentSize.
          var dataOffset = fragIndex * _maxFragmentSize;
          for(var y = 0; y < _maxFragmentSize; ++y) {
            for(var x = 0; x < _maxFragmentSize; ++x) {

              // TODO:  Look into using some form of RLE

              // fragOutput.heightmap.push(imageData.data[(dataOffset + x) * 4]);
              fragOutput.heightmap.push(imageData.data[((offsetY + y) * imageData.width + (offsetX + x)) * 4]);
            }
          }

          out.fragments.push(fragOutput);
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
