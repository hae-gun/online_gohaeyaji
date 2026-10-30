-- Atomically takes a free booth. Two sessions pressing E at the same moment:
-- exactly one SET NX succeeds, the other gets 0.
--
-- The lease (TTL) means a booth frees itself if its server dies; the owner keeps it
-- alive by renewing on every ping (renew_booth.lua).
--
-- KEYS[1]  gy:ch:{no}:booth:{id}   value "occ:{sessionId}"
-- KEYS[2]  gy:ch:{no}:seq          channel event sequence
-- ARGV[1]  sessionId
-- ARGV[2]  lease in ms
-- returns  new channel seq on success, 0 when the booth is taken

local ok = redis.call('SET', KEYS[1], 'occ:' .. ARGV[1], 'NX', 'PX', tonumber(ARGV[2]))
if not ok then
  return 0
end
return redis.call('INCR', KEYS[2])
