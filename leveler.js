"use strict";

process.title = 'royale-leveler';

const http = require('http');
const path = require('path');
const url = require('url');
const fs = require('fs');
const pngjs = require('pngjs');

var server = http.createServer(function(request, response) {
  var filename = path.normalize(request.url);
  var requestTime = new Date();

  if(filename === '/') {
    filename = '/map.json';
  }
  
  console.log(`${requestTime} Requested: ${request.url} (${filename})`);

  fs.readFile(process.cwd() + filename, "binary", function(err, file) {
    if(err) {
      console.log(`${requestTime} Request for missing file: ${filename}`);
      response.write(err + "\n");

      response.writeHead(404);
      response.end("<h2>nope</h2>");
      return;
    }

    var mapData = parseMap(JSON.parse(file));
    
    response.writeHead(200);
    response.write(mapData, "binary");
    response.end();
  });
  
}).listen(9090);

///////////
function parseMap(data) {
  var out;

  console.log(JSON.stringify(data));
  
  // TODO:  Process any heightmaps
  // .Process object placement layers
  // .Convert data into a lua formatted table that can be directly evaled
  
  return "";
}
