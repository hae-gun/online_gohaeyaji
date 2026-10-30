-- A booth lock may vanish without a release (lease expired after heartbeats stopped).
-- Other players still see the LED on until someone tells them. This issues a fresh
-- channel seq for a "free" event, but only if the booth is still free at this moment,
-- so it can never announce "free" right after someone else took the booth.
--
-- KEYS[1]  gy:ch:{no}:booth:{id}
-- KEYS[2]  gy:ch:{no}:seq
-- returns  new seq if the booth is free, 0 if someone holds it

if redis.call('EXISTS', KEYS[1]) == 0 then
  return redis.call('INCR', KEYS[2])
end
return 0
