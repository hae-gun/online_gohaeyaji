-- Every few seconds from each server (ChannelService.heartbeat).
--  1. marks this server alive
--  2. overwrites this server's member counts with the sessions it really holds, so a missed
--     leave (crash, kill) can never leave the numbers wrong for longer than one heartbeat
--  3. removes the counts of servers that stopped sending heartbeats
--
-- KEYS[1]  gy:servers    ZSET, member = server id, score = last heartbeat (ms)
-- KEYS[2]  gy:channels   ZSET of channel numbers
-- ARGV[1]  this server's id
-- ARGV[2]  now (ms)
-- ARGV[3]  dead after (ms)
-- ARGV[4]  key prefix (gy:ch:)
-- ARGV[5..] pairs: channel number, sessions this server holds in it
-- returns  number of dead servers removed

local me, now, dead, prefix = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), ARGV[4]
redis.call('ZADD', KEYS[1], now, me)

local mine = {}
for i = 5, #ARGV, 2 do
  mine[ARGV[i]] = tonumber(ARGV[i + 1])
end

local channels = redis.call('ZRANGE', KEYS[2], 0, -1)
local deadServers = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', '(' .. (now - dead))
for _, no in ipairs(channels) do
  local key = prefix .. no .. ':members'
  if redis.call('TYPE', key).ok == 'string' then
    redis.call('DEL', key)
  end
  local n = mine[no] or 0
  if n > 0 then
    redis.call('HSET', key, me, n)
  else
    redis.call('HDEL', key, me)
  end
  for _, s in ipairs(deadServers) do
    redis.call('HDEL', key, s)
  end
end
for _, s in ipairs(deadServers) do
  redis.call('ZREM', KEYS[1], s)
end
return #deadServers
