local HttpService = game:GetService("HttpService")

local _terrainResolution = 4;
local _terrainHeight = 64;
local _heightmapFloor = 64;

local function buildTerrainFragment(frag)
   -- TODO:  Make this able to process in chunks
   -- .Currently 256x256 is known to work

   local fragFloor = frag.floor or _heightmapFloor
   local fragTerrainHeight = frag.terrain_height or _terrainHeight
   
   local size = Vector3.new(frag.width, fragTerrainHeight, frag.height) * _terrainResolution
   local offset = Vector3.new(size.x, 0, size.z) * 0.5
   local region = Region3.new(offset * -1, size - offset)

   region = region:ExpandToGrid(_terrainResolution)
   
   local material = {}
   local occupancy = {}

   -- Carve out the necessary tables
   for x = 1, frag.width do
      material[x] = {}
      occupancy[x] = {}
      
      for y = 1, fragTerrainHeight do
         material[x][y] = {}
         occupancy[x][y] = {}
      end
   end	

   local heightScale = 1 / 255 * fragTerrainHeight

   for i, height in ipairs(frag.heightmap) do
      local idx = i - 1
      local y = math.floor(idx / frag.width) + 1
      local x = (idx % frag.width) + 1

      height = math.max(0, height - fragFloor) * heightScale + 1
   
      for j = 1, fragTerrainHeight do
         local fill = math.max(0, math.min(1, height - j))

         occupancy[x][j][y] = fill
         material[x][j][y] = Enum.Material.Grass
      end
   end	

   print(string.format("Map: min:%s height:%s width:%s height:%s",
                       fragFloor, fragTerrainHeight,
                       frag.width, frag.height))
   
   game.Workspace.Terrain:WriteVoxels(region, _terrainResolution, material, occupancy)
end


--------------
local worldData = HttpService:GetAsync("http://localhost:9090")
worldData = loadstring("return " .. worldData)()
buildTerrainFragment(worldData.fragments[1])

