local HttpService = game:GetService("HttpService")

local _terrainResolution = 4;
local _terrainHeight = 64;
local _heightmapFloor = 64;

local function getWaterLevel(water, idx)
   for i, run in ipairs(water) do
      local delta = idx - run[1]
      if delta >= 0 and delta < run[3] then
         return run[2]
      end
   end

   return 0
end

local function buildTerrainFragment(frag, origin)
   local fragFloor = frag.floor or _heightmapFloor
   local fragTerrainHeight = frag.terrain_height or _terrainHeight
   
   local size = Vector3.new(frag.width, fragTerrainHeight, frag.height) * _terrainResolution
   local offset = (Vector3.new(frag.x, 0, frag.y) + origin) * _terrainResolution
   local region = Region3.new(offset, offset + size)

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
      local waterLevel = 0

      height = math.max(0, height - fragFloor) * heightScale + 1
      waterLevel = math.max(0, getWaterLevel(frag.water, idx) - fragFloor) * heightScale + 1
         
      for j = 1, fragTerrainHeight do
         local fill = math.max(0, math.min(1, height - j - 1))
         local water = math.max(0, waterLevel - j - 1)
         local mat = Enum.Material.Grass

         if fill > 0 and fill < 1 and water > 0 then
            mat = Enum.Material.Sand
            
         elseif fill == 0 and water > 0 then
            mat = Enum.Material.Water

            if water > 1 then
               fill = 1
            end
         end
         
         occupancy[x][j][y] = fill
         material[x][j][y] = mat
      end
   end	

   print(string.format("Map: min:%s height:%s x:%s y:%s width:%s height:%s",
                       fragFloor, fragTerrainHeight,
                       frag.x, frag.y,
                       frag.width, frag.height))
   
   game.Workspace.Terrain:WriteVoxels(region, _terrainResolution, material, occupancy)
end

local function loadFragmentFromService(id)
   local worldData = HttpService:GetAsync("http://localhost:9090/map.json?" .. id)
   worldData = loadstring(worldData)()

   local terrainOrigin = Vector3.new(worldData.size.x, 0, worldData.size.y) * -0.5 * 4
   buildTerrainFragment(worldData, terrainOrigin)
      
   return worldData.total, worldData.remaining
end

local function loadAllFragments()
   game.Workspace.Terrain:Clear()

   local current = 0
   local total = 0

   while current == 0 or current < total do
      print(string.format("Loading %s/%s (%s%%)", current, total, (current / total) * 100))
      total = loadFragmentFromService(current)
      
      current = current + 1
   end

   print("Completed")
end

local function loadTestArea()
   game.Workspace.Terrain:Clear()

   local fragmentsPerRow = 3000 / 150
   local area = _area or 4

   local startX = math.floor(fragmentsPerRow * 0.5 - area * 0.5)
   local startY = math.floor(fragmentsPerRow * 0.5 - area * 0.5)

   local step = 1
   
   for y = startY, math.min(fragmentsPerRow, startY + area - 1)  do
      for x = startX, math.min(fragmentsPerRow, startX + area - 1) do
         local idx = (y - 1) * fragmentsPerRow + (x - 1)
         print(string.format("Loading %sx%s (frag: %s).  %s/%s", x, y, idx, step, area*area))
         loadFragmentFromService(idx)

         step = step + 1
      end
   end

   print("Completed")
end

--------------
if _full then
   loadAllFragments()
else
   loadTestArea()
end

