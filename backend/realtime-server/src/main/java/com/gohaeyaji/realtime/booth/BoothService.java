package com.gohaeyaji.realtime.booth;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import java.util.ArrayList;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Booth locks in Redis. A lock value is "occ:{sessionId}" with a TTL (lease).
 * Renew and release only act when the lock is still ours, so a late message from an
 * old session can never touch the lock of whoever took the booth next.
 */
@Service
public class BoothService {

    private static final String OCCUPIED = "occ:";
    private static final String RESERVED = "res:";

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final RealtimeProperties props;

    public BoothService(StringRedisTemplate redis, LuaScripts scripts, RealtimeProperties props) {
        this.redis = redis;
        this.scripts = scripts;
        this.props = props;
    }

    /** @return new channel seq when taken, 0 when someone else holds the booth */
    public long claim(int channelNo, int boothId, String sessionId) {
        Long seq = redis.execute(scripts.claimBooth,
                List.of(RedisKeys.booth(channelNo, boothId), RedisKeys.seq(channelNo)),
                sessionId, String.valueOf(props.leaseMs()));
        return seq == null ? 0 : seq;
    }

    /** @return false when the lease was lost (expired, maybe taken by someone else) */
    public boolean renew(int channelNo, int boothId, String sessionId) {
        Long ok = redis.execute(scripts.renewBooth,
                List.of(RedisKeys.booth(channelNo, boothId)),
                sessionId, String.valueOf(props.leaseMs()));
        return ok != null && ok == 1L;
    }

    /** @return new channel seq when released, 0 when it was not ours anymore */
    public long release(int channelNo, int boothId, String sessionId) {
        Long seq = redis.execute(scripts.releaseBooth,
                List.of(RedisKeys.booth(channelNo, boothId), RedisKeys.seq(channelNo)),
                sessionId);
        return seq == null ? 0 : seq;
    }

    /**
     * For a lock that disappeared without a release (lease expiry): returns a fresh seq for a
     * "free" event if the booth is still free, or 0 if someone already took it.
     */
    public long seqIfFree(int channelNo, int boothId) {
        Long seq = redis.execute(scripts.notifyIfFree,
                List.of(RedisKeys.booth(channelNo, boothId), RedisKeys.seq(channelNo)));
        return seq == null ? 0 : seq;
    }

    /** Full state of one channel. seq is read first, so later events always carry a higher seq. */
    public Snapshot snapshot(int channelNo) {
        String seqValue = redis.opsForValue().get(RedisKeys.seq(channelNo));
        long seq = seqValue == null ? 0 : Long.parseLong(seqValue);

        List<String> keys = new ArrayList<>(props.boothCount());
        for (int i = 0; i < props.boothCount(); i++) {
            keys.add(RedisKeys.booth(channelNo, i));
        }
        List<String> values = redis.opsForValue().multiGet(keys);

        List<Integer> occupied = new ArrayList<>();
        List<Integer> reserved = new ArrayList<>();
        if (values != null) {
            for (int i = 0; i < values.size(); i++) {
                String v = values.get(i);
                if (v == null) {
                    continue;
                }
                if (v.startsWith(OCCUPIED)) {
                    occupied.add(i);
                } else if (v.startsWith(RESERVED)) {
                    reserved.add(i);
                }
            }
        }
        return new Snapshot(occupied, reserved, seq);
    }

    public record Snapshot(List<Integer> occupied, List<Integer> reserved, long seq) {
    }
}
