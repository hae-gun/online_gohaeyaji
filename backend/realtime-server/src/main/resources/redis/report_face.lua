-- One report on a drawing (protocol section 15).
-- KEYS[1] reporters set for this drawing, KEYS[2] ban key for this drawing
-- ARGV[1] reporter session id, ARGV[2] reports needed, ARGV[3] report window (ms), ARGV[4] ban time (ms)
-- Returns: -1 already reported by this session, 0 counted, 1 counted and now banned (only once)
if redis.call('SADD', KEYS[1], ARGV[1]) == 0 then
  return -1
end
redis.call('PEXPIRE', KEYS[1], ARGV[3])
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then
  if redis.call('SET', KEYS[2], '1', 'NX', 'PX', ARGV[4]) then
    return 1
  end
end
return 0
