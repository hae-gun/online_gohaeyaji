package com.gohaeyaji.realtime.presence;

import com.gohaeyaji.realtime.redis.RedisKeys;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.BiConsumer;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Player positions, kept in memory only (protocol section 13).
 *
 * Positions change many times per second and are worthless a moment later, so they never go
 * to Redis. Only the pid counter does, so pids stay unique once several servers share a channel.
 * Until step 6 (Redis Pub/Sub) players only see others connected to the same server.
 */
@Service
public class PresenceService {

    // world bounds, a little larger than the walkable area so clamping never fights the client
    // the yard and the nave, the confession hall to the right (x up to 37), the path round the
    // buildings (x -18..42.5, z from -27), the trails and the event field (x -36..36, z up to 108)
    private static final double MIN_X = -40, MAX_X = 45, MIN_Z = -45, MAX_Z = 112;

    private final StringRedisTemplate redis;
    private final Map<Integer, ChannelPresence> channels = new ConcurrentHashMap<>();

    public PresenceService(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public int allocatePid(int channelNo) {
        Long pid = redis.opsForValue().increment(RedisKeys.pidSeq(channelNo));
        if (pid == null) {
            throw new IllegalStateException("pid allocation returned nothing");
        }
        return pid.intValue();
    }

    /** Ignores non-finite numbers; clamps to the world. */
    public void move(int channelNo, int pid, double x, double z, double ry) {
        if (!Double.isFinite(x) || !Double.isFinite(z) || !Double.isFinite(ry)) {
            return;
        }
        channel(channelNo).move(pid,
                round(clamp(x, MIN_X, MAX_X)),
                round(clamp(z, MIN_Z, MAX_Z)),
                round(ry % (Math.PI * 2)));
    }

    public void enterBooth(int channelNo, int pid, int boothId) {
        channel(channelNo).setBooth(pid, boothId);
    }

    public void leaveBooth(int channelNo, int pid) {
        channel(channelNo).setBooth(pid, -1);
    }

    /** The name reaches the channel with the next batch (protocol section 14). */
    public void setName(int channelNo, int pid, String name) {
        channel(channelNo).setName(pid, name);
    }

    /** Hand-drawn face (protocol section 15); null = default face. Goes out with the next batch. */
    public void setFace(int channelNo, int pid, String face) {
        channel(channelNo).setFace(pid, face);
    }

    /** An emote (protocol section 16); goes out with the next batch, then is forgotten. */
    public void emote(int channelNo, int pid, String id) {
        channel(channelNo).emote(pid, id);
    }

    /** Sitting on a bench or pew (protocol section 16): kept until the player moves away. */
    public void sit(int channelNo, int pid, double x, double z, double ry) {
        if (!Double.isFinite(x) || !Double.isFinite(z) || !Double.isFinite(ry)) {
            return;
        }
        channel(channelNo).sit(pid, round(clamp(x, MIN_X, MAX_X)), round(clamp(z, MIN_Z, MAX_Z)), round(ry % (Math.PI * 2)));
    }

    /** Pids sitting now; sent in the welcome so newcomers see them seated. */
    public List<Integer> sitting(int channelNo) {
        ChannelPresence presence = channels.get(channelNo);
        return presence == null ? List.of() : presence.sitting();
    }

    public List<List<Object>> faces(int channelNo) {
        ChannelPresence presence = channels.get(channelNo);
        return presence == null ? List.of() : presence.faces();
    }

    public List<List<Object>> names(int channelNo) {
        ChannelPresence presence = channels.get(channelNo);
        return presence == null ? List.of() : presence.names();
    }

    public void remove(int channelNo, int pid) {
        ChannelPresence presence = channels.get(channelNo);
        if (presence != null) {
            presence.remove(pid);
        }
    }

    public List<List<Number>> snapshot(int channelNo) {
        ChannelPresence presence = channels.get(channelNo);
        return presence == null ? List.of() : presence.snapshot();
    }

    /**
     * Hands each channel's changes since the last call to the consumer.
     * Empty channels are kept on purpose: removing one could race with the first move of someone
     * joining at that moment, and there are only a handful of channels.
     */
    public void drainAll(BiConsumer<Integer, ChannelPresence.Batch> consumer) {
        channels.forEach((channelNo, presence) -> {
            ChannelPresence.Batch batch = presence.drain();
            if (batch != null) {
                consumer.accept(channelNo, batch);
            }
        });
    }

    private ChannelPresence channel(int channelNo) {
        return channels.computeIfAbsent(channelNo, no -> new ChannelPresence());
    }

    private static double clamp(double v, double lo, double hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
