local HttpService = game:GetService("HttpService")

local _terrainResolution = 4;
local _terrainHeight = 64;
local _heightmapFloor = 64;
local _mapResolution = 5;

local function buildTerrainFragment(frag, origin)
   local fragFloor = frag.floor or _heightmapFloor
   local fragTerrainHeight = frag.terrain_height or _terrainHeight
   local material = {}
   local occupancy = {}

   -- Carve out the necessary tables
   for x = 1, _mapResolution do
      material[x] = {}
      occupancy[x] = {}
      
      for y = 1, fragTerrainHeight do
         material[x][y] = {}
         occupancy[x][y] = {}
      end
   end	

   local size = Vector3.new(_mapResolution, fragTerrainHeight, _mapResolution) * _terrainResolution
   local heightScale = 1 / 255 * fragTerrainHeight

   for i, height in ipairs(frag.heightmap) do
      local idx = i - 1
      local y = math.floor(idx / frag.width)
      local x = (idx % frag.width)

      height = math.max(0, height - fragFloor) * heightScale + 1
   
      for j = 1, fragTerrainHeight do
         local fill = math.max(0, math.min(1, height - j))

         for subY = 1, _mapResolution do
            for subX = 1, _mapResolution do
               occupancy[subX][j][subY] = fill
               material[subX][j][subY] = Enum.Material.Grass
            end
         end
      end

      -- 
      local offset = (Vector3.new(frag.x + x * _mapResolution, 0,
                                  frag.y + y * _mapResolution) + origin) * _terrainResolution
      local region = Region3.new(offset, offset + size)
      region = region:ExpandToGrid(_terrainResolution)

      game.Workspace.Terrain:WriteVoxels(region, _terrainResolution, material, occupancy)
   end	
end

--------------
local worldData = HttpService:GetAsync("http://localhost:9090")
worldData = loadstring(worldData)()

local terrainOrigin = Vector3.new(worldData.size.x, 0, worldData.size.y) * -0.5 * 4

game.Workspace.Terrain:Clear()

for i,frag in ipairs(worldData.fragments) do
   buildTerrainFragment(frag, terrainOrigin)
end
