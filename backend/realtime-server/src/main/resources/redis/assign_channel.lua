-- Assigns a newly connected session to a channel and counts it as a member.
--
-- Policy (docs/realtime-protocol.md, section 2):
--   fill channels from the lowest number; a channel takes new sessions while it has
--   fewer than the soft limit (80% of capacity). When every channel is at or above the
--   soft limit, the lowest unused channel number is opened.
--
-- KEYS[1]  gy:channels                 ZSET, member = channel number, score = channel number
-- ARGV[1]  soft limit (e.g. 48)
-- ARGV[2]  key prefix  (e.g. "gy:ch:")
-- returns  channel number
--
-- Note: touches member-count keys not listed in KEYS. Fine on a single Redis or a
-- primary/replica setup; would need hash tags before moving to Redis Cluster.

local softLimit = tonumber(ARGV[1])
local prefix = ARGV[2]

local channels = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, no in ipairs(channels) do
  local membersKey = prefix .. no .. ':members'
  local members = tonumber(redis.call('GET', membersKey) or '0')
  if members < softLimit then
    redis.call('INCR', membersKey)
    return tonumber(no)
  end
end

local no = 1
while redis.call('ZSCORE', KEYS[1], tostring(no)) do
  no = no + 1
end
redis.call('ZADD', KEYS[1], no, tostring(no))
redis.call('SET', prefix .. no .. ':members', 1)
return no
