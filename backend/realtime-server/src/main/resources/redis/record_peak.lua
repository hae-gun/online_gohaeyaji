-- The highest number of people on at once: for the day and of all time (admin page, VisitStats).
-- KEYS[1] day HASH (field "peak"), KEYS[2] all-time peak HASH (fields "count", "at")
-- ARGV[1] people on now, ARGV[2] now (ms), ARGV[3] TTL of the day key (seconds)
-- Returns 1 when a new all-time peak was set, else 0.
local n = tonumber(ARGV[1])
local day = tonumber(redis.call('HGET', KEYS[1], 'peak') or '0')
if n > day then
  redis.call('HSET', KEYS[1], 'peak', n)
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
end
local ever = tonumber(redis.call('HGET', KEYS[2], 'count') or '0')
if n > ever then
  redis.call('HSET', KEYS[2], 'count', n, 'at', ARGV[2])
  return 1
end
return 0
