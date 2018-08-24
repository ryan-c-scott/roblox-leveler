# Roblox Leveler
A tool for generating level data from specially formatted [Tiled](https://www.mapeditor.org/) files.

## Requirements
* Nodejs
* Roblox Studio
* Tiled (for editing files)
* Rojo (optional for getting plugin code into Roblox Studio)

## Setup
Copy in [](plugin/ServerStorage/Scripts/leveler.server.lua) as a local Plugin in Roblox Studio or running Rojo in [](plugin/).

## Running
The service component, [](leveler.js), serves up files from the current directory, so change to the directory where your files are stored (eg. [](test/)`).

``` shell
cd test
node ../leveler.js
```

# Tiled Usage
Tiled serves as a simple, abstract level editor.

## Tile Width
In order to deal with large terrains, the service can operate on pieces of terrain one by one.
`Map/Map Properties/[TileWidth|TileHeight]` should be set to the same value at a reasonable size that is a factor of the overall image size.  Values around 100 to 150 work well for Roblox Studio.

## Heightmaps
A single `Image Layer` should be used to represent the heightmap.
Each pixel maps to a single voxel in the smooth terrain system.

One voxel is 4 studs wide.
To convert that to a meters for the default Roblox scale, which is 3 studs to a meter:

``` lua
local m = pixels * 4 / 3
```

### Custom Properties
* height - The height of the terrain to generate.

## Water
Areas of water are specified using `Point` objects on an `Object Layer`.  The specified `depth` is used to flood fill the heightmap at the specified position.

### Custom Properties
* depth - The surface of the water _above_ the height at the specified point.

## Object Areas
Object areas are circles (`Ellipses` with the uniform `height` and `width`).
The property `type` is read by the service as a float representing the density of the placement of objects in that area.

A density of 1 would mean 1 object for every surface voxel of generated terrain.

From the density the number of objects to place is calculated and then each placed randomly.

## Individual Objects
Individual object placements are specified using `Point` objects on an `Object Layer`.

# Roblox Place Setup
Tiled object names should match `Folders` under `ReplicatedStorage/Leveler/` containing one or more objects to randomly choose between for placement.

## Running
The `Leveler` plugin exposes a series of buttons.
* Terrain - Generates all smooth terrain
* Objects - Generates all object placements
* Test Area - Generates everything in a 4x4 chunk area in the center of the map
* Test Area (objects) - Generates only the objects from a 4x4 chunk area in the center of the map
* Everything - Generates all terrain and objects in the map (this can take a long time with large maps)
* Clear Terrain/Objects/Everything - Destroys generated terrain or objects as you might expect
