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

const _material = {
  "Plastic": 256,
  "Wood": 512,
  "Slate": 800,
  "Concrete": 816,
  "CorrodedMetal": 1040,
  "DiamondPlate": 1056,
  "Foil": 1072,
  "Grass": 1280,
  "Ice": 1536,
  "Marble": 784,
  "Granite": 832,
  "Brick": 848,
  "Pebble": 864,
  "Sand": 1296,
  "Fabric": 1312,
  "SmoothPlastic": 272,
  "Metal": 1088,
  "WoodPlanks": 528,
  "Cobblestone": 880,
  "Air": 1792,
  "Water": 2048,
  "Rock": 896,
  "Glacier": 1552,
  "Snow": 1328,
  "Sandstone": 912,
  "Mud": 1344,
  "Basalt": 788,
  "Ground": 1360,
  "CrackedLava": 804,
  "Neon": 288,
  "Glass": 1568,
  "Asphalt": 1376,
  "LeafyGrass": 1284,
  "Salt": 1392,
  "Limestone": 820,
  "Pavement": 836 }

var _imageDataCache = {}
var _heightmapDataCache = {}
var _jsonDataCache = {}

var _biomes = {}

function registerBiome(name, handler) {
  _biomes[name] = handler;
}

function biomeDefault(height, slope) {
  if(slope > 2) {
    return _material.Rock;
  }

  if(height > 150) {
    return _material.Snow;
  }

  return _material.Grass;
}

registerBiome('desert', function(height, slope) {
  if(slope > 0.25) {
    return _material.Sandstone;
  }

  return _material.Sand;
});

function materialForBiome(name, height, slope) {
  var handler = _biomes[name];
  if(!handler) {
    handler = biomeDefault;
  }

  return handler(height, slope);
}

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

function getObjectProperty(obj, key) {
  if(obj.properties) {
    var prop = obj.properties.find((elem) => {return elem.name == key;});
    return prop ? prop.value : undefined;
  }
}

function isRegularObjectLayer(layer) {
  return layer.type == 'objectgroup' && layer.name !== 'water' && !layer.name.startsWith('ZONE:');
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
    if(!isRegularObjectLayer(layer)) {
      return;
    }

    var layerRandom = getObjectProperty(layer, 'random');
    var layerBaseSize = getObjectProperty(layer, 'base');

    layer.objects.forEach((obj) => {
      var name = obj.name || layer.name;
      var randomAmount = getObjectProperty(obj, 'random') || layerRandom;
      var baseSize = getObjectProperty(obj, 'random') || layerBaseSize;
      var group = out[name];

      if(!group) {
        group = [];
        out[name] = group;
      }

      var center = [obj.x, obj.y];

      if(obj.point) {
        var x = Math.floor(center[0])
        var y = Math.floor(center[1])

        if(x > mapMinX && x < mapMaxX &&
           y > mapMinY && y < mapMaxY) {

          var heightIdx = (y * heightmap.width + x) * 4
          var height = heightmap.data[heightIdx];
          var objData = [x, height, y];

          if(randomAmount || baseSize) {
            objData.push(randomAmount || 0);
            objData.push(baseSize || 1);
          }
          
          group.push(objData);
        }
      }
      
      if(obj.ellipse) {
        var density = parseFloat(obj.type);
        var radius = obj.width * 0.5;
        var area = radius * radius * Math.PI;
        var count = Math.floor(area * density);

        // Use center of object
        center = vector.add(center, [radius, radius]);

        // console.log(`${name} ${radius} ${area} ${count}`);

        for(var i = 0; i < count; ++i) {
          var dir = vector.normalize(vector.rotateDeg([1, 0], Math.random() * 360));
          var pos = vector.add(center, vector.scale(dir, Math.random() * radius));

          var x = Math.floor(pos[0])
          var y = Math.floor(pos[1])

          if(x > mapMinX && x < mapMaxX &&
             y > mapMinY && y < mapMaxY) {

            var heightIdx = (y * heightmap.width + x) * 4
            var height = heightmap.data[heightIdx]

            if(heightmap.data[heightIdx + 2] == 0) {
              var objData = [x, height, y];

              if(randomAmount || baseSize) {
                objData.push(randomAmount || 0);
                objData.push(baseSize || 1);
              }
              
              group.push(objData);
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

        // 4 channels of heightmap data
        heightmapData = Array(imageData.data.length);

        // Wipe out green and blue channels
        for(var i = 0; i < imageData.data.length; i+=4) {
          // HACK:  Using green channel values to specify water flood barriers
          heightmapData[i + 1] = (imageData.data[i + 1] - imageData.data[i] > 0) ? -1.0 : 0;

          imageData.data[i + 1] = 0;
          imageData.data[i + 2] = 0;
        }

        // Get the biome list
        var biomeAreas = []
        data.layers.forEach(function(otherLayer) {
          if(otherLayer.type != 'objectgroup' || !otherLayer.name.startsWith('ZONE:')) {
            return;
          }
          
          otherLayer.objects.forEach(function(obj) {
            if(!obj.ellipse) {
              return;
            }

            var biome = obj.name;

            if(!biome) {
              biome = otherLayer.name.replace('ZONE:', '');
            }

            var radius = obj.width * 0.5;
            
            biomeAreas.push({x: obj.x + radius,
                             y: obj.y + radius,
                             radius: radius,
                             biome: biome
                            });
          });
        });
        
        // Populate the calculated heightmap data (ie. with smoothing)
        for(var y = 0; y < imageData.height; ++y) {
          for(var x = 0; x < imageData.width; ++x) {

            var idx = (y * imageData.width + x)
            var val = imageData.data[idx * 4];

            var sampleCount = 0;
            var sampleTotal = 0;
            var sampleMin = val;
            var sampleMax = val;

            // Sample neighbors to handle the aliasing caused by 1 pixel = 4x4 studs.
            for(var nY = -1; nY <= 1; ++nY) {
              for(var nX = -1; nX <= 1; ++nX) {
                var thisY = y + nY;
                var thisX = x + nX;
            
                if(thisY >= 0 && thisY < imageData.height &&
                   thisX >= 0 && thisX < imageData.width) {

                  var sampleVal = imageData.data[((thisY) * imageData.width + thisX) * 4];
                  
                  sampleMin = Math.min(sampleVal, sampleMin)
                  sampleMax = Math.max(sampleVal, sampleMax)
                  
                  sampleTotal += sampleVal;
                  sampleCount++;
                }
              }
            }

            val = sampleTotal / sampleCount;

            if(!val) {
              val = 0;
            }

            // Height at 0
            heightmapData[idx * 4] = val;
            // Water at 1 (done elsewhere)
            // Slope at 2
            heightmapData[idx * 4 + 2] = sampleMax - sampleMin;

            // Biome at 3
            for(var i = 0; i < biomeAreas.length; ++i) {
              var biome = biomeAreas[i];
              
              // For now, at least, just grab the first one
              if(Math.pow(biome.x - x, 2) + Math.pow(biome.y - y, 2) < Math.pow(biome.radius, 2)) {
                heightmapData[idx * 4 + 3] = biome.biome;
                break;
              }
            }
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
            var threshold = heightmapData[(y * imageData.width + x) * 4] + depth;

            floodFill(heightmapData, 4, 1, x, y, imageData.width, imageData.height, threshold);
          });
        });

        // Hack:  We update the image data to show the water generated water level (since we use that for generating a minimap)
        for(var i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i + 2] = Math.floor(heightmapData[i + 1]);
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
      out.material = [];

      // TODO:  Look into using some form of RLE
      
      for(var y = 0; y < maxFragmentSize; ++y) {
        for(var x = 0; x < maxFragmentSize; ++x) {
          var idx = (offsetY + y) * imageData.width + (offsetX + x);
          var val = heightmapData[idx * 4];
          out.heightmap.push(val);

          var slope = heightmapData[idx * 4 + 2];
          var biome = heightmapData[idx * 4 + 3];

          out.material.push(materialForBiome(biome, val, slope));
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
            var dataIdx = ((offsetY + y) * imageData.width + (offsetX + x)) * 4 + 1;

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

