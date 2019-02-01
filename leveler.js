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
var _heightmapDataCache = {}
var _jsonDataCache = {}

var server = http.createServer(async function(request, response) {
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

  try {
    var data = await loadMapFile(filename, query.type != 'obj')
    data = await parseMap(data, fragIndex);
    response.writeHead(200);
    response.write('return ', 'binary');

    switch(query.type) {
    case 'frag':
      console.log(`${requestTime} Requested: ${request.url} (${filename} @ ${fragIndex})`);
      writeMapDataToStream(response, data);
      break;

    case 'obj':
      console.log(`${requestTime} Requested: ${request.url} (${filename})`);
      writeObjectDataToStream(response, data, query);
      break;
    }

    //
    response.end();
  }
  catch(e) {
    console.log(`${requestTime} Error requesting file: ${filename}`);
    response.writeHead(404);
    response.end(e.message);

    throw(e);
  }

}).listen(9090);

console.log("Listening on 9090");

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

function writeObjectDataToStream(stream, data, queryOptions) {
  var raw = _jsonDataCache[data.filename];
  var heightmap = _imageDataCache[data.filename];
  var fragmentSize = data.frag_size;

  var mapMinX = 0;
  var mapMinY = 0;
  var mapMaxX = heightmap.width;
  var mapMaxY = heightmap.height;
  
  var out = {}

  console.log(data.filename);

  if(queryOptions) {
    if(queryOptions.secx) {
      mapMinX = parseInt(queryOptions.secx) * fragmentSize;
    }
    
    if(queryOptions.secy) {
      mapMinY = parseInt(queryOptions.secy) * fragmentSize;
    }
    
    if(queryOptions.secw) {
      mapMaxX = mapMinX + parseInt(queryOptions.secw) * fragmentSize;
    }
    
    if(queryOptions.sech) {
      mapMaxY = mapMinY + parseInt(queryOptions.secw) * fragmentSize;
    }
  }

  console.log("Limits: %s, %s, %s, %s", mapMinX, mapMinY, mapMaxX, mapMaxY);
  
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

        if(x > mapMinX && x < mapMaxX &&
           y > mapMinY && y < mapMaxY) {

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

          if(x > mapMinX && x < mapMaxX &&
             y > mapMinY && y < mapMaxY) {

            var heightIdx = (y * heightmap.width + x) * 4
            var height = heightmap.data[heightIdx]

            // Testing:  No object placement in water
            if(heightmap.data[heightIdx + 2] == 0) {
              // TODO:  Add scale
              // .Calculated from a min + variance (which can be omitted in Tiled and default to 1
              group.push([x, height, y]);
            }
          }
        }
      }
    });
  });

  writeMapDataToStream(stream, out);
}

function floodFill(data, stride, offset, x, y, w, h, threshold) {
  var queue = [[x, y]];

  console.log(`flood: ${threshold}`);
  
  while(queue.length > 0) {
    var point = queue.pop();
    var px = point[0];
    var py = point[1];
    var idx = (py * w + px) * stride;

    // Change value
    var current = data[idx + offset];
    if(data[idx] < threshold && current < threshold && current >= 0) {

      // Queue all neighbors
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
             filename: data.filename,
             frag_size: data.tilewidth}
  
  var maxFragmentSize = data.tilewidth;

  out.size = {x: data.width,
              y: data.height};

  data.layers.forEach(function(layer) {
    if(layer.type === 'imagelayer' && layer.name == 'terrain') {
      var imagePath = layer.image;

      var raw = fs.readFileSync(imagePath);
      var imageData;
      var heightmapData;

      if(fragIndex != 0) {
        imageData = _imageDataCache[data.filename];
        heightmapData = _heightmapDataCache[data.filename];
      }

      // TODO:  Process all image data and then store all of the processed results in a cache.
      // .Easy enough to just keep around both the image and the processed data.
      
      if(!imageData) {
        console.log("Loading image data");
        imageData = pngjs.PNG.sync.read(raw);

        // 2 channels of heightmap data
        heightmapData = Array(imageData.data.length >> 1);

        // Wipe out green and blue channels
        for(var i = 0; i < imageData.data.length; i+=4) {
          // HACK:  Using green channel values to specify water flood barriers
          heightmapData[(i >> 1) + 1] = (imageData.data[i + 1] - imageData.data[i] > 0) ? -1.0 : 0;

          imageData.data[i + 1] = 0;
          imageData.data[i + 2] = 0;
        }

        // Populate the calculated heightmap data (ie. with smoothing)
        for(var y = 0; y < imageData.height; ++y) {
          for(var x = 0; x < imageData.width; ++x) {

            ////
            var idx = (y * imageData.width + x)
            var val = imageData.data[idx * 4];

            var sampleCount = 0;
            var sampleTotal = 0;

            // Sample neighbors to handle the aliasing caused by 1 pixel = 4x4 studs.
            for(var nY = -1; nY <= 1; ++nY) {
              for(var nX = -1; nX <= 1; ++nX) {
                var thisY = y + nY;
                var thisX = x + nX;
            
                if(thisY >= 0 && thisY < imageData.height &&
                   thisX >= 0 && thisX < imageData.width) {
            
                  sampleTotal += imageData.data[((thisY) * imageData.width + thisX) * 4]
                  sampleCount++;
                }
              }
            }

            val = sampleTotal / sampleCount;

            if(!val) {
              val = 0;
            }

            heightmapData[idx * 2] = val;

            ////
            
          }
        } // end per-pixel loop

        _imageDataCache[data.filename] = imageData;
        _heightmapDataCache[data.filename] = heightmapData;

        
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
            
            var depth = obj.properties.find((elem) => {return elem.name == 'depth';}).value;
            var threshold = heightmapData[(y * imageData.width + x) * 2] + depth;

            floodFill(heightmapData, 2, 1, x, y, imageData.width, imageData.height, threshold);
          });
        });

        // Hack:  We update the image data to show the water generated water level (since we use that for generating a minimap)
        for(var i = 2; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.floor(heightmapData[i >> 1]);
        }

      }  // end image processing

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

      // TODO:  Look into using some form of RLE
      
      for(var y = 0; y < maxFragmentSize; ++y) {
        for(var x = 0; x < maxFragmentSize; ++x) {
          var idx = (offsetY + y) * imageData.width + (offsetX + x);
          var val = heightmapData[idx * 2];
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
            var dataIdx = ((offsetY + y) * imageData.width + (offsetX + x)) * 2 + 1;

            var thisHeight = heightmapData[dataIdx];

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

