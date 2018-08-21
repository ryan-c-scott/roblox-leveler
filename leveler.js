"use strict";

process.title = 'royale-leveler';

const Promise = require('bluebird');
const http = require('http');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const fs = Promise.promisifyAll(require('fs'));
const pngjs = Promise.promisifyAll(require('pngjs'));
const xmlToJs = Promise.promisify(require('xml2js').parseString);
const kmath = require('kmath');
const vector = kmath.vector;

var _imageDataCache = {}
var _jsonDataCache = {}

var server = http.createServer(function(request, response) {
  var mapUrl = url.parse(request.url);
  var filename = path.normalize(mapUrl.pathname);
  var query = querystring.parse(mapUrl.query);
  var requestTime = new Date();
  var fragIndex = parseInt(query.id);
  
  if(query.type === 'cached') {
    response.writeHead(200);

    var imgData = _imageDataCache[Object.keys(_imageDataCache)[0]];

    if(imgData) {
      response.write(pngjs.PNG.sync.write(imgData), 'binary');
    }

    response.end();
    return;
  }

  if(query.type === 'clear') {
    _jsonDataCache = {}
    _imageDataCache = {}
    
    response.writeHead(200);
    response.end();
    return;
  }

  loadMapFile(filename, query.type != 'obj')
    .then((data) => {return parseMap(data, fragIndex);})
    .then(function(data) {
      response.writeHead(200);
      response.write('return ', 'binary');

      switch(query.type) {
      case 'frag':
        console.log(`${requestTime} Requested: ${request.url} (${filename} @ ${fragIndex})`);
        writeMapDataToStream(response, data);
        break;

      case 'obj':
        console.log(`${requestTime} Requested: ${request.url} (${filename})`);
        writeObjectDataToStream(response, data);
        break;
      }

      //
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
    stream.write(`'${data}'`);
    break;
    
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

function writeObjectDataToStream(stream, data) {
  var raw = _jsonDataCache[data.filename];
  var heightmap = _imageDataCache[data.filename];

  var out = {}

  console.log(data.filename);
  
  raw.layers.forEach((layer) => {
    if(layer.type != 'objectgroup' || layer.name === 'water') {
      return;
    }

    layer.objects.forEach((obj) => {
      var group = out[obj.name];
  
      if(!group) {
        group = [];
        out[obj.name] = group;
      }

      var center = [obj.x, obj.y];

      if(obj.point) {
        var x = Math.floor(center[0])
        var y = Math.floor(center[1])

        if(x > 0 && x < heightmap.width &&
           y > 0 && y < heightmap.height) {

          var heightIdx = (y * heightmap.width + x) * 4
          var height = heightmap.data[heightIdx]

          group.push([x, height, y]);
        }
      }
      
      if(obj.ellipse) {
        var density = parseFloat(obj.type);
        var radius = obj.width * 0.5;
        var area = radius * radius * Math.PI;
        var count = Math.floor(area * density);

        // Use center of object
        center = vector.add(center, [radius, radius]);

        // console.log(`${obj.name} ${radius} ${area} ${count}`);

        for(var i = 0; i < count; ++i) {
          var dir = vector.normalize(vector.rotateDeg([1, 0], Math.random() * 360));
          var pos = vector.add(center, vector.scale(dir, Math.random() * radius));

          var x = Math.floor(pos[0])
          var y = Math.floor(pos[1])

          if(x > 0 && x < heightmap.width &&
             y > 0 && y < heightmap.height) {

            var heightIdx = (y * heightmap.width + x) * 4
            var height = heightmap.data[heightIdx]

            // Testing:  No object placement in water
            if(heightmap.data[heightIdx + 2] == 0) {
              group.push([x, height, y]);
            }
          }
        }
      }
    });
  });

  writeMapDataToStream(stream, out);
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

function loadMapFile(filename, enableCaching) {
  var cached = _jsonDataCache[filename];

  if(enableCaching && cached) {
    return Promise.resolve(cached);
  }

  return fs.readFileAsync(process.cwd() + filename, "binary")
    .then(JSON.parse)
    .then((data) => {
      data.filename = filename;
      console.log(`caching ${filename}`);
      _jsonDataCache[filename] = data;
      return data;});
}

function parseMap(data, fragIndex) {
  var out = {fragments: [],
             filename: data.filename}
  var maxFragmentSize = data.tilewidth;

  out.size = {x: data.width,
              y: data.height};

  data.layers.forEach(function(layer) {
    if(layer.type === 'imagelayer') {
      var imagePath = layer.image;

      var raw = fs.readFileSync(imagePath);
      var imageData;

      if(fragIndex != 0) {
        imageData = _imageDataCache[data.filename];
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
          if(otherLayer.type != 'objectgroup' || otherLayer.name != 'water') {
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

      _imageDataCache[data.filename] = imageData;
      
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
      
      // TODO:  Look into using some form of RLE
      
      for(var y = 0; y < maxFragmentSize; ++y) {
        for(var x = 0; x < maxFragmentSize; ++x) {

          var val = imageData.data[((offsetY + y) * imageData.width + (offsetX + x)) * 4];
          out.heightmap.push(val);
        }
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

