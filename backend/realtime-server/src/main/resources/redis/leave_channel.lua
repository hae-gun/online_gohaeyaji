-- A session left its channel. Decrements this server's member count, never below zero.
--
-- KEYS[1]  gy:ch:{no}:members   HASH, server id -> count
-- ARGV[1]  this server's id
-- returns  this server's count after leaving

if redis.call('TYPE', KEYS[1]).ok ~= 'hash' then
  return 0
end
local n = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if n <= 1 then
  redis.call('HDEL', KEYS[1], ARGV[1])
  return 0
end
return redis.call('HINCRBY', KEYS[1], ARGV[1], -1)
