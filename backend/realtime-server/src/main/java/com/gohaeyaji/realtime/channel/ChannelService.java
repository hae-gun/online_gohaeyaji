package com.gohaeyaji.realtime.channel;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import com.gohaeyaji.realtime.session.ClientSession;
import com.gohaeyaji.realtime.session.SessionRegistry;
import jakarta.annotation.PreDestroy;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Channel assignment: fill from channel 1, move on at 80% (soft limit), open a new channel
 * when all are at the soft limit. The decision runs inside one Lua script so concurrent
 * joins on several servers never overfill a channel.
 *
 * Member counts are kept per server (protocol section 12). Each server has a random id for its
 * lifetime and sends a heartbeat every serverHeartbeatMs, which also overwrites its counts with
 * the sessions it really holds. A server that dies without leaving (kill, crash, out of memory)
 * stops counting once its heartbeat is older than serverDeadMs, and the next heartbeat of any
 * server removes its numbers. A restarted server comes back with a new id, so it never inherits
 * the stale count of its previous life.
 *
 * TODO: remove channels that stayed empty for 5 minutes (protocol C1).
 */
@Service
public class ChannelService {

    private static final Logger log = LoggerFactory.getLogger(ChannelService.class);

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final RealtimeProperties props;
    private final SessionRegistry registry;
    private final String serverId;

    public ChannelService(StringRedisTemplate redis, LuaScripts scripts, RealtimeProperties props, SessionRegistry registry) {
        this.redis = redis;
        this.scripts = scripts;
        this.props = props;
        this.registry = registry;
        byte[] b = new byte[4];
        new SecureRandom().nextBytes(b);
        this.serverId = "srv-" + HexFormat.of().formatHex(b);
        log.info("server id {}", serverId);
    }

    public String serverId() {
        return serverId;
    }

    public int join() {
        Long no = redis.execute(scripts.assignChannel, List.of(RedisKeys.CHANNELS, RedisKeys.SERVERS),
                String.valueOf(props.channelSoftLimit()), RedisKeys.CHANNEL_PREFIX, serverId,
                String.valueOf(System.currentTimeMillis()), String.valueOf(props.serverDeadMs()));
        if (no == null) {
            throw new IllegalStateException("channel assignment returned nothing");
        }
        return no.intValue();
    }

    public void leave(int channelNo) {
        redis.execute(scripts.leaveChannel, List.of(RedisKeys.members(channelNo)), serverId);
    }

    @Scheduled(fixedRateString = "${gohaeyaji.server-heartbeat-ms}")
    public void heartbeat() {
        Map<Integer, Integer> mine = new HashMap<>();
        for (ClientSession s : registry.all()) {
            if (s.isReady()) {
                mine.merge(s.channelNo(), 1, Integer::sum);
            }
        }
        List<String> args = new ArrayList<>(List.of(serverId, String.valueOf(System.currentTimeMillis()),
                String.valueOf(props.serverDeadMs()), RedisKeys.CHANNEL_PREFIX));
        mine.forEach((no, n) -> {
            args.add(String.valueOf(no));
            args.add(String.valueOf(n));
        });
        try {
            Long reaped = redis.execute(scripts.serverHeartbeat, List.of(RedisKeys.SERVERS, RedisKeys.CHANNELS),
                    args.toArray());
            if (reaped != null && reaped > 0) {
                log.warn("removed member counts of {} server(s) that stopped sending heartbeats", reaped);
            }
        } catch (RuntimeException e) {
            log.warn("heartbeat failed: {}", e.getMessage());
        }
    }

    /** Members of a channel across every live server. */
    public long members(int channelNo) {
        Set<String> alive = aliveServers();
        long sum = 0;
        try {
            for (Map.Entry<Object, Object> e : redis.opsForHash().entries(RedisKeys.members(channelNo)).entrySet()) {
                if (alive.contains(e.getKey().toString()) || serverId.equals(e.getKey().toString())) {
                    sum += Long.parseLong(e.getValue().toString());
                }
            }
        } catch (RuntimeException e) {
            return 0;   // an old plain-string counter; the next heartbeat replaces it
        }
        return sum;
    }

    public Set<String> aliveServers() {
        long since = System.currentTimeMillis() - props.serverDeadMs();
        Set<String> alive = redis.opsForZSet().rangeByScore(RedisKeys.SERVERS, since, Double.POSITIVE_INFINITY);
        return alive == null ? Set.of() : alive;
    }

    /** Clean goodbye: take this server's counts out right away instead of waiting to be found dead. */
    @PreDestroy
    public void shutdown() {
        try {
            Set<String> nos = redis.opsForZSet().range(RedisKeys.CHANNELS, 0, -1);
            if (nos != null) {
                for (String no : nos) {
                    redis.opsForHash().delete(RedisKeys.members(Integer.parseInt(no)), serverId);
                }
            }
            redis.opsForZSet().remove(RedisKeys.SERVERS, serverId);
        } catch (RuntimeException e) {
            log.debug("could not clear counts on shutdown: {}", e.getMessage());
        }
    }
}
