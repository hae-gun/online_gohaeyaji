-- Frees a booth, but only if it is ours. A late release from an old session can
-- never delete the lock of whoever took the booth after it.
--
-- KEYS[1]  gy:ch:{no}:booth:{id}
-- KEYS[2]  gy:ch:{no}:seq
-- ARGV[1]  sessionId
-- returns  new channel seq on success, 0 when it was not ours

if redis.call('GET', KEYS[1]) == 'occ:' .. ARGV[1] then
  redis.call('DEL', KEYS[1])
  return redis.call('INCR', KEYS[2])
end
return 0
