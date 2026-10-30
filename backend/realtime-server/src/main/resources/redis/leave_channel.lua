-- A session left its channel. Decrements the member count, never below zero.
--
-- KEYS[1]  gy:ch:{no}:members
-- returns  member count after leaving

local n = tonumber(redis.call('GET', KEYS[1]) or '0')
if n <= 1 then
  redis.call('SET', KEYS[1], 0)
  return 0
end
return redis.call('DECR', KEYS[1])
