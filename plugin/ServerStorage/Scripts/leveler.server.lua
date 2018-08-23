local ChangeHistoryService = game:GetService("ChangeHistoryService")

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

-- NOTE:  Don't call this from inside functions that have disabled ChangeHistoryService as it will reset the flag to true at the end
local function clearObjects()
   ChangeHistoryService:SetEnabled(false)
   local container = Workspace.generated
   container:ClearAllChildren()
   ChangeHistoryService:SetEnabled(true)
end

-- NOTE:  Don't call this from inside functions that have disabled ChangeHistoryService as it will reset the flag to true at the end
local function clearTerrain()
   ChangeHistoryService:SetEnabled(false)
   game.Workspace.Terrain:Clear()
   ChangeHistoryService:SetEnabled(true)
end

-- NOTE:  Don't call this from inside functions that have disabled ChangeHistoryService as it will reset the flag to true at the end
local function clearEverything()
   clearObjects();
   clearTerrain();
end

local function loadObjects(queryOptions)
   ChangeHistoryService:SetEnabled(false)

   local heightScale = 1 / 255 * _terrainHeight
   local collections = ReplicatedStorage.Leveler
   local container = Workspace.generated
   local groupCount = 100

   container:ClearAllChildren()

   local url = "http://localhost:9090/map.json?type=obj"

   if queryOptions then
      for k,v in pairs(queryOptions) do
         url = string.format('%s&%s=%s', url, k, v)
      end
   end
      
   local objData = HttpService:GetAsync(url)
   objData = loadstring(objData)()

   local currentCount = 0
   
   for k,v in pairs(objData) do
      local props = collections[k]:GetChildren()
      local propCount = table.getn(props)
      local instanceCount = table.getn(v)

      Log("%s props found.  Generating %s instances.", propCount, instanceCount)

      for i, pos in ipairs(v) do
         if currentCount >= groupCount then
            currentCount = 0
            wait()

            Log("  %s/%s", i, instanceCount)
         end
         
         local thisProp = props[math.random(propCount)]

         local instancePos = Vector3.new(pos[1],
                                         (pos[2] - 3) * heightScale,
                                         pos[3]) * _terrainResolution
         local instanceCFrame =
            CFrame.new(instancePos) *
            CFrame.Angles(0, math.rad(math.random() * 360), 0)

         local instance = thisProp:Clone()
         instance.Parent = container

         -- Set position
         if instance.ClassName == 'SpawnLocation' then
            instance.CFrame = instanceCFrame
            
         else
            instance:SetPrimaryPartCFrame(instanceCFrame)
         end
         
         --
         currentCount = currentCount + 1
      end
   end

   Log("Object loading completed")

   ChangeHistoryService:SetEnabled(true)
end

local function loadAllFragments()
   ChangeHistoryService:SetEnabled(false)

   game.Workspace.Terrain:Clear()

   local current = 0
   local total = 0

   while current == 0 or current < total do
      Log("Loading %s/%s (%s%%)", current, total, (current / total) * 100)
      total = loadFragmentFromService(current)
      
      current = current + 1
   end

   Log("Completed")

   ChangeHistoryService:SetEnabled(true)
end

local function loadTestArea(objOnly)
   local fragmentsPerRow = 3000 / 150
   local area = _area or 4

   local startX = math.floor(fragmentsPerRow * 0.5 - area * 0.5)
   local startY = math.floor(fragmentsPerRow * 0.5 - area * 0.5)

   --
   loadObjects({secx = startX - 1, secy = startY - 1, secw = area, sech = area})

   if objOnly then
      return;
   end
   
   ChangeHistoryService:SetEnabled(false)

   game.Workspace.Terrain:Clear()

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

   ChangeHistoryService:SetEnabled(true)
end

local function loadEverything()
   loadObjects()
   loadAllFragments()
end

local function addButton(toolbar, label, tooltip, icon, callback)
   local button = toolbar:CreateButton(label, tooltip, icon)
   button.Click:Connect(callback)
end

--------------
local toolbar = plugin:CreateToolbar("ROyale Leveler")
addButton(toolbar, "Terrain", "Generate full terrain", "rbxassetid://1507949215", loadAllFragments)
addButton(toolbar, "Objects", "Generate objects", "rbxassetid://1507949215", loadObjects)
addButton(toolbar, "Test Area", "Generate test terrain", "rbxassetid://1507949215", loadTestArea)
addButton(toolbar, "Test Area (objects)", "Generate test terrain", "rbxassetid://1507949215", function() loadTestArea(true) end)
addButton(toolbar, "Everything", "Generate everything", "rbxassetid://1507949215", loadEverything)

addButton(toolbar, "Clear Terrain", "Delete all terrain", "rbxassetid://1507949215", clearTerrain)
addButton(toolbar, "Clear Objects", "Delete generated objects", "rbxassetid://1507949215", clearObjects)
addButton(toolbar, "Clear Everything", "Delete everything", "rbxassetid://1507949215", clearEverything)
