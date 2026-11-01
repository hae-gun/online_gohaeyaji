-- Assigns a newly connected session to a channel and counts it as a member.
--
-- Policy (docs/realtime-protocol.md, section 2):
--   fill channels from the lowest number; a channel takes new sessions while it has
--   fewer than the soft limit (80% of capacity). When every channel is at or above the
--   soft limit, the lowest unused channel number is opened.
--
-- Members are counted per server (section 12): gy:ch:{no}:members is a HASH of server id -> count.
-- Only servers that sent a heartbeat recently count, so a server that died without saying
-- goodbye stops inflating the numbers by itself. The calling server always counts.
--
-- KEYS[1]  gy:channels   ZSET, member = channel number, score = channel number
-- KEYS[2]  gy:servers    ZSET, member = server id, score = last heartbeat (ms)
-- ARGV[1]  soft limit (e.g. 48)
-- ARGV[2]  key prefix  (e.g. "gy:ch:")
-- ARGV[3]  this server's id
-- ARGV[4]  now (ms)
-- ARGV[5]  a server is dead after this many ms without a heartbeat
-- returns  channel number
--
-- Note: touches member keys not listed in KEYS. Fine on a single Redis or a
-- primary/replica setup; would need hash tags before moving to Redis Cluster.

local softLimit = tonumber(ARGV[1])
local prefix = ARGV[2]
local me = ARGV[3]
local aliveSince = tonumber(ARGV[4]) - tonumber(ARGV[5])

local function total(key)
  -- members keys from before per-server counting were plain strings: start over
  if redis.call('TYPE', key).ok == 'string' then
    redis.call('DEL', key)
    return 0
  end
  local sum = 0
  local flat = redis.call('HGETALL', key)
  for i = 1, #flat, 2 do
    local server, n = flat[i], tonumber(flat[i + 1])
    local seen = redis.call('ZSCORE', KEYS[2], server)
    if server == me or (seen and tonumber(seen) >= aliveSince) then
      sum = sum + n
    end
  end
  return sum
end

local channels = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, no in ipairs(channels) do
  local membersKey = prefix .. no .. ':members'
  if total(membersKey) < softLimit then
    redis.call('HINCRBY', membersKey, me, 1)
    return tonumber(no)
  end
end

local no = 1
while redis.call('ZSCORE', KEYS[1], tostring(no)) do
  no = no + 1
end
redis.call('ZADD', KEYS[1], no, tostring(no))
redis.call('DEL', prefix .. no .. ':members')
redis.call('HSET', prefix .. no .. ':members', me, 1)
return no
