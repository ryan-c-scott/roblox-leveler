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

  if(mapUrl.query === 'cache') {
    response.writeHead(200);
    var imgData = _imageDataCache[Object.keys(_imageDataCache)[0]];
    response.write(pngjs.PNG.sync.write(imgData), 'binary');
    response.end();
    return;
  }
  
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

function floodFill(data, offset, x, y, w, h, threshold) {
  var queue = [[x, y]];

  console.log(`flood: ${threshold}`);
  
  while(queue.length > 0) {
    var point = queue.pop();
    var px = point[0];
    var py = point[1];
    var idx = (py * w + px) * 4;

    // Change value
    if(data[idx] < threshold) {
      var current = data[idx + offset];

      // Queue all neighbors
      if(current != threshold) {
        data[idx + offset] = threshold;
        
        for(var ny = py - 1; ny <= py + 1; ++ny) {
          for(var nx = px - 1; nx <= px + 1; ++nx) {
            if((ny != py || nx != px) &&
               (ny < h && ny >= 0 &&
                nx < w && nx >= 0)){

              queue.push([nx, ny]);
            }
          }
        }
      }
    }
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

        // Wipe out green and blue channels
        for(var i = 0; i < imageData.data.length; ++i) {
          imageData.data[i * 4 + 1] = 0;
          imageData.data[i * 4 + 2] = 0;
        }
        
        // Blue channel as water level
        // .Iterate through all objects of type 'point' and flood to the depth specified
        data.layers.forEach(function(otherLayer) {
          if(otherLayer.type != 'objectgroup') {
            return;
          }
          
          otherLayer.objects.forEach(function(obj) {
            if(!obj.point) {
              return;
            }

            var x = Math.floor(obj.x);
            var y = Math.floor(obj.y);
            
            var depth = obj.properties.depth;
            var threshold = imageData.data[(y * imageData.width + x) * 4] + depth;
            
            floodFill(imageData.data, 2, x, y, imageData.width, imageData.height, threshold);
          });
        });
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

      out.x = offsetX;
      out.y = offsetY;
      
      out.width = maxFragmentSize;
      out.height = maxFragmentSize;
      out.heightmap = [];
      out.water = [];

      if(layer.properties && layer.properties.floor) {
        out.floor = layer.properties.floor;
      }
      
      if(layer.properties && layer.properties.height) {
        out.terrain_height = layer.properties.height;
      }
      
      // Return chunks no larger than maxFragmentSize * maxFragmentSize.
      var fragHasData = false;
      var dataOffset = fragIndex * maxFragmentSize;

      // TODO:  Look into using some form of RLE
      
      for(var y = 0; y < maxFragmentSize; ++y) {
        for(var x = 0; x < maxFragmentSize; ++x) {

          var val = imageData.data[((offsetY + y) * imageData.width + (offsetX + x)) * 4];
          out.heightmap.push(val);

          fragHasData = fragHasData || val != 0;
        }
      }

      if(!fragHasData) {
        out.heightmap = []
      }

      // Water from blue channel
      {
        var startIdx = 0;
        var on = false;
        var height = 0;

        for(var y = 0; y < maxFragmentSize; ++y) {
          for(var x = 0; x < maxFragmentSize; ++x) {
            var i = y * maxFragmentSize + x;
            var dataIdx = ((offsetY + y) * imageData.width + (offsetX + x)) * 4 + 2;

            var thisHeight = imageData.data[dataIdx];

            if(thisHeight > 0) {
              if(!on) {
                on = true;
                startIdx = i;
                height = thisHeight;
              }
            }
            else {
              if(on) {
                out.water.push([startIdx, height, i - startIdx]);
              }

              on = false;
              height = 0;
            }
          }
        }

        //
        if(on) {
          out.water.push([startIdx, height, maxFragmentSize * maxFragmentSize - 1 - startIdx]);
        }
      }
    }
  });

  return out;
}

