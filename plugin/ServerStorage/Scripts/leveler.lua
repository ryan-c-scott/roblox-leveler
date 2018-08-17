local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService('ReplicatedStorage')

local _terrainResolution = 4;
local _terrainHeight = 128;

local function Log(...)
   print(string.format(...))
end

local function getWaterLevel(water, idx)
   for i, run in ipairs(water) do
      local delta = idx - run[1]
      if delta >= 0 and delta < run[3] then
         return run[2]
      end
   end

   return 0
end

local function buildTerrainFragment(frag)
   local size = Vector3.new(frag.width, _terrainHeight, frag.height) * _terrainResolution
   local offset = Vector3.new(frag.x, 0, frag.y) * _terrainResolution
   local region = Region3.new(offset, offset + size)

   region = region:ExpandToGrid(_terrainResolution)
   
   local material = {}
   local occupancy = {}

   -- Carve out the necessary tables
   for x = 1, frag.width do
      material[x] = {}
      occupancy[x] = {}
      
      for y = 1, _terrainHeight do
         material[x][y] = {}
         occupancy[x][y] = {}
      end
   end	

   local heightScale = 1 / 255 * _terrainHeight

   for i, height in ipairs(frag.heightmap) do
      local idx = i - 1
      local y = math.floor(idx / frag.width) + 1
      local x = (idx % frag.width) + 1
      local waterLevel = 0

      height = height * heightScale
      waterLevel = getWaterLevel(frag.water, idx) * heightScale
      
      for j = 1, _terrainHeight do
         local fill = math.max(0, math.min(1, height - j - 1))
         local water = math.max(0, waterLevel - j - 1)
         local mat = Enum.Material.Grass

         if fill > 0 and fill < 1 and water > 0 then
            mat = Enum.Material.Sand
            
         elseif fill == 0 and water > 0 then
            mat = Enum.Material.Water
            fill = 1
         end
         
         occupancy[x][j][y] = fill
         material[x][j][y] = mat
      end
   end	

   Log("Map: height:%s x:%s y:%s width:%s height:%s",
       _terrainHeight,
       frag.x, frag.y,
       frag.width, frag.height)
   
   game.Workspace.Terrain:WriteVoxels(region, _terrainResolution, material, occupancy)
end

local function loadFragmentFromService(id)
   local worldData = HttpService:GetAsync("http://localhost:9090/map.json?type=frag&id=" .. id)
   worldData = loadstring(worldData)()

   buildTerrainFragment(worldData)
   
   return worldData.total, worldData.remaining
end

local function loadObjects()
   local heightScale = 1 / 255 * _terrainHeight
   local collections = ReplicatedStorage.Leveler
   local container = Workspace.generated
   local groupCount = 100

   container:ClearAllChildren()

   local objData = HttpService:GetAsync("http://localhost:9090/map.json?type=obj")
   objData = loadstring(objData)()

   local currentCount = 0
   
   for k,v in pairs(objData) do
      local props = collections[k]:GetChildren()
      local propCount = table.getn(props)

      Log("%s props found.  Generating %s instances.", propCount, table.getn(v))

      for i, pos in ipairs(v) do
         if currentCount >= groupCount then
            currentCount = 0
            wait()
         end
         
         local thisProp = props[math.random(propCount)]

         local instancePos = Vector3.new(pos[1],
                                         pos[2] * heightScale,
                                         pos[3]) * _terrainResolution
         local instanceCFrame =
            CFrame.Angles(0, math.rad(math.random() * 360), 0) *
            CFrame.new(instancePos)

         local instance = thisProp:Clone()
         instance.Parent = container
         instance:SetPrimaryPartCFrame(instanceCFrame)

         --
         currentCount = currentCount + 1
      end
   end

   Log("Object loading completed")
end

local function loadAllFragments()
   game.Workspace.Terrain:Clear()

   local current = 0
   local total = 0

   while current == 0 or current < total do
      Log("Loading %s/%s (%s%%)", current, total, (current / total) * 100)
      total = loadFragmentFromService(current)
      
      current = current + 1
   end

   Log("Completed")
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
         Log("Loading %sx%s (frag: %s).  %s/%s", x, y, idx, step, area*area)
         loadFragmentFromService(idx)

         step = step + 1
      end
   end

   Log("Completed")
end

--------------
loadObjects()

if not _objectOnly then
   if _full then
      loadAllFragments()
   else
      loadTestArea()
   end
end

