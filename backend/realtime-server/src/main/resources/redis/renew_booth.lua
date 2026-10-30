-- Extends the lease, but only if the booth is still ours.
-- Never extends someone else's booth.
--
-- KEYS[1]  gy:ch:{no}:booth:{id}
-- ARGV[1]  sessionId
-- ARGV[2]  lease in ms
-- returns  1 renewed, 0 not ours anymore (lease expired and someone else may hold it)

if redis.call('GET', KEYS[1]) == 'occ:' .. ARGV[1] then
  redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]))
  return 1
end
return 0
