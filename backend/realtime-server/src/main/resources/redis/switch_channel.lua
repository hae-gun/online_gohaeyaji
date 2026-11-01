-- Moves a session from one channel to another chosen by the person (protocol section 18).
--
-- The target must be an open channel with fewer members than the limit (the hard capacity,
-- 60: someone joining a friend may go past the 80% that automatic assignment stops at).
-- Only live servers count, as in assign_channel.lua. Both counts change in one step, so two
-- people switching into the last free place at the same moment cannot both get it.
--
-- KEYS[1]  gy:channels             ZSET of open channel numbers
-- KEYS[2]  gy:servers              ZSET, server id -> last heartbeat (ms)
-- KEYS[3]  gy:ch:{from}:members    HASH, server id -> count
-- KEYS[4]  gy:ch:{to}:members      HASH, server id -> count
-- ARGV[1]  this server's id
-- ARGV[2]  now (ms)
-- ARGV[3]  a server is dead after this many ms without a heartbeat
-- ARGV[4]  the target channel number
-- ARGV[5]  limit (members)
-- returns  1 moved, 0 the target is full, -1 no such channel

local me = ARGV[1]
local aliveSince = tonumber(ARGV[2]) - tonumber(ARGV[3])

if not redis.call('ZSCORE', KEYS[1], ARGV[4]) then
  return -1
end

local sum = 0
local flat = redis.call('HGETALL', KEYS[4])
for i = 1, #flat, 2 do
  local server, n = flat[i], tonumber(flat[i + 1])
  local seen = redis.call('ZSCORE', KEYS[2], server)
  if server == me or (seen and tonumber(seen) >= aliveSince) then
    sum = sum + n
  end
end
if sum >= tonumber(ARGV[5]) then
  return 0
end

redis.call('HINCRBY', KEYS[4], me, 1)
local n = tonumber(redis.call('HGET', KEYS[3], me) or '0')
if n <= 1 then
  redis.call('HDEL', KEYS[3], me)
else
  redis.call('HINCRBY', KEYS[3], me, -1)
end
return 1
