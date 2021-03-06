local ChangeHistoryService = game:GetService("ChangeHistoryService")

local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService('ReplicatedStorage')

local _terrainResolution = 4;
local _terrainHeight = 256;

local _materialLookup = {}

for _,v in ipairs(Enum.Material:GetEnumItems()) do
   _materialLookup[v.Value] = v
end

local function Log(...)
   print(string.format(...))
end

local function getWaterLevel(water, idx)
   for _, run in ipairs(water) do
      local delta = idx - run[1]
      if delta >= 0 and delta < run[3] then
         return run[2]
      end
   end

   return 0
end

local function objectCanBePositioned(obj)
   if not obj:IsA('Model') and (obj:IsA('Part') or obj:IsA('UnionObject') or obj:IsA('MeshPart')) then
      return true
   end

   return false
end

local function transformObj(obj, xform, scale)
   if obj:isA('Model') then
      local primary = obj.PrimaryPart

      if not primary then
         return;
      end
      
      obj:SetPrimaryPartCFrame(xform)
      primary.Size = primary.Size * scale
      
      for _, descendant in pairs(obj:GetDescendants()) do
         if descendant ~= primary and objectCanBePositioned(descendant) then
            -- Get position relative to primary part, scale it, and then apply that transform
            local offset = (descendant.CFrame.Position - primary.CFrame.Position)
            descendant.CFrame = descendant.CFrame * CFrame.new(offset * scale - offset)
            descendant.Size = descendant.Size * scale
         end
      end

   elseif objectCanBePositioned(obj) then
      obj.CFrame = xform
      obj.Size = obj.Size * scale
   end
end

local function offsetObjectToBottom(obj, groundOffset)
   -- Depending on type, get its size and offset up by half of that
   if obj:isA('Model') then
      if obj.PrimaryPart then
         obj:SetPrimaryPartCFrame(CFrame.new(0, obj.PrimaryPart.Size.Y * 0.5 + groundOffset, 0)
                                     * obj.PrimaryPart.CFrame)
      end
      
   elseif objectCanBePositioned(obj) then
      obj.CFrame = CFrame.new(0, obj.Size.Y * 0.5 + groundOffset, 0) * obj.CFrame
   end
end

local function buildTerrainFragment(frag)
   local verticalSliceCount = 2
   local verticalSliceSize = _terrainHeight / verticalSliceCount
      
   local material = {}
   local occupancy = {}

   -- Carve out the necessary tables
   for slice = 1, verticalSliceCount do
      material[slice] = {}
      occupancy[slice] = {}
      
      for x = 1, frag.width do
         material[slice][x] = {}
         occupancy[slice][x] = {}
         
         for y = 1, verticalSliceSize do
            material[slice][x][y] = {}
            occupancy[slice][x][y] = {}
         end
      end
   end

   local heightScale = 1 / 255 * _terrainHeight

   -- TODO:  Should take a number of passes here
   -- .Detecting whether or not it's necessary by running through all of the height values
   -- .There's another optimization there to use a smaller region, but that's easier said than done.
   -- .A basic optimization would be to limit the region size based on the max height found per slice
   -- .All of this goes away with heightmap support
   -- .Alternatively it could build each slice separately

   for i, height in ipairs(frag.heightmap) do
      local idx = i - 1
      local y = math.floor(idx / frag.width) + 1
      local x = (idx % frag.width) + 1
      local waterLevel = 0

      height = height * heightScale
      waterLevel = getWaterLevel(frag.water, idx) * heightScale

      for slice = 1, verticalSliceCount do
         
         for j = 1, verticalSliceSize do
            local sliceOffset = verticalSliceSize * (slice - 1)
            local sliceRelativeHeight = height - sliceOffset * heightScale
            local fill = math.max(0, math.min(1, sliceRelativeHeight - j - 1))
            local water = math.max(0, waterLevel - j - sliceOffset - 1)
            local mat = _materialLookup[frag.material[i]]

            if fill > 0 and fill < 1 and water > 0 then
               mat = Enum.Material.Sand
               
            elseif fill == 0 and water > 0 then
               mat = Enum.Material.Water
               fill = 1
            end
            
            occupancy[slice][x][j][y] = fill
            material[slice][x][j][y] = mat
         end
      end
   end	

   for slice = 1, verticalSliceCount do
      Log("Map: slice:%s height:%s x:%s y:%s width:%s height:%s",
          slice,
          _terrainHeight,
          frag.x, frag.y,
          frag.width, frag.height)

      -- TODO:  Modify the region
      local size = Vector3.new(frag.width, verticalSliceSize, frag.height) * _terrainResolution
      local offset = Vector3.new(frag.x, verticalSliceSize * (slice - 1), frag.y) * _terrainResolution
      local region = Region3.new(offset, offset + size)

      region = region:ExpandToGrid(_terrainResolution)

      game.Workspace.Terrain:WriteVoxels(region, _terrainResolution,
                                         material[slice], occupancy[slice])
   end
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

local function logObjectStats(stats)
   Log("Object Stats (%s instances):\n", stats.instance_total)

   Log("Count by Groups:")
   for k,v in pairs(stats.groups) do
      Log("\t%s: %s", k, v)
   end

   Log("\nCount by object:")
   for k,v in pairs(stats.instances) do
      Log("\t%s: %s", k, v)
   end
end

local function loadObjects(queryOptions)
   ChangeHistoryService:SetEnabled(false)

   local heightScale = 1 / 255 * _terrainHeight
   local collections = ReplicatedStorage.Leveler
   local container = Workspace.generated
   local groupCount = 100
   local stats = {groups = {}, instances = {}}

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

      stats.groups[k] = (stats.groups[k] or 0) + instanceCount
      stats.instance_total = (stats.instance_total or 0) + instanceCount
      
      Log("%s props found.  Generating %s instances.", propCount, instanceCount)

      for i, pos in ipairs(v) do
         local randomAmount = pos[4] or 0
         local baseScale = pos[5] or 1
         local scale = baseScale + math.random() * randomAmount
         
         if currentCount >= groupCount then
            currentCount = 0
            wait()

            Log("  %s/%s", i, instanceCount)
         end
         
         local thisProp = props[math.random(propCount)]
         stats.instances[thisProp.Name] = (stats.instances[thisProp.Name] or 0) + 1
         local propCFrame = nil
         local instancePos = Vector3.new(pos[1],
                                         pos[2] * heightScale,
                                         pos[3]) * _terrainResolution

         if thisProp:IsA('Model') then
            propCFrame = thisProp.PrimaryPart.CFrame

         elseif thisProp:IsA('MeshPart') then
            propCFrame = thisProp.CFrame
         else
            propCFrame = CFrame.new()
         end

         -- TODO:  Does this make sense anymore?
         -- .I think it should be rolled into the propCFrame
         -- local offset = thisProp:FindFirstChild('PositionOffset')
         -- if offset then
         --    instancePos = instancePos + offset.Value * scale
         -- end

         local instanceRotation = CFrame.fromEulerAnglesXYZ(propCFrame:ToOrientation())
         
         if randomAmount and randomAmount > 0 then
            instanceRotation = CFrame.Angles(0, math.rad(math.random() * 360), 0) * instanceRotation
         end

         local instanceCFrame = CFrame.new(instancePos) * instanceRotation

         local instance = thisProp:Clone()
         instance.Parent = container

         transformObj(instance, instanceCFrame, scale)
         offsetObjectToBottom(instance, -8)
         
         --
         currentCount = currentCount + 1
      end
   end

   logObjectStats(stats)
   
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

local function loadTestArea(objects, terrain)
   local fragmentsPerRow = 2450 / 49
   local area = _area or 8

   local startX = math.floor(fragmentsPerRow * 0.5 - area * 0.5)
   local startY = math.floor(fragmentsPerRow * 0.5 - area * 0.5)

   --
   if objects then
      ChangeHistoryService:SetEnabled(false)
      loadObjects({secx = startX - 1, secy = startY - 1, secw = area, sech = area})
      ChangeHistoryService:SetEnabled(true)
   end

   if not terrain then
      return
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

local function loadTestAreaTerrain()
   loadTestArea(false, true)
end

local function loadTestAreaObjects()
   loadTestArea(true, false)
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
addButton(toolbar, "Test Area (terrain)", "Generate test terrain", "rbxassetid://1507949215", loadTestAreaTerrain)
addButton(toolbar, "Test Area (objects)", "Generate test terrain", "rbxassetid://1507949215", loadTestAreaObjects)
addButton(toolbar, "Clear Terrain", "Delete all terrain", "rbxassetid://1507949215", clearTerrain)
addButton(toolbar, "Clear Objects", "Delete generated objects", "rbxassetid://1507949215", clearObjects)
addButton(toolbar, "Clear Everything", "Delete everything", "rbxassetid://1507949215", clearEverything)
