-- One report on a drawing (protocol section 15).
-- KEYS[1] reporters set for this drawing (window), KEYS[2] ban key for this drawing,
-- KEYS[3] the drawing itself, KEYS[4] its record for the admin page (hash), KEYS[5] admin index (zset)
-- ARGV[1] reporter session id, ARGV[2] reports needed, ARGV[3] report window (ms), ARGV[4] ban time (ms),
-- ARGV[5] the drawing (1024 digits), ARGV[6] now (ms), ARGV[7] how long the admin page keeps records (ms)
-- Returns: -1 already reported by this session, 0 counted, 1 counted and now banned (only once)
if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then
  return -1
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])

-- keep what was reported so a person can look at it later
redis.call('SET', KEYS[3], ARGV[5], 'PX', ARGV[7])
redis.call('HINCRBY', KEYS[4], 'reports', 1)
redis.call('HSETNX', KEYS[4], 'firstAt', ARGV[6])
redis.call('HSET', KEYS[4], 'lastAt', ARGV[6])
redis.call('PEXPIRE', KEYS[4], ARGV[7])
redis.call('ZADD', KEYS[5], ARGV[6], KEYS[3])
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', tonumber(ARGV[6]) - tonumber(ARGV[7]))

if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  if redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[4]) then
    redis.call('HSET', KEYS[4], 'bannedAt', ARGV[6], 'bannedBy', 'reports')
    return 1
  end
end
return 0
