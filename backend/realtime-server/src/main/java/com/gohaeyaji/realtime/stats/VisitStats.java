package com.gohaeyaji.realtime.stats;

import com.gohaeyaji.realtime.channel.ChannelService;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Visit counts for the admin page: how many came in, how many different people, and the most at
 * once. Counted in Redis, so they add up across servers and survive restarts.
 *
 *   gy:stats:visits         INCR, every entry since counting began (a hello; a reconnect counts again)
 *   gy:stats:day:{date}     HASH visits, peak (most people on at once that day). Kept 400 days
 *   gy:stats:uv:{date}      HyperLogLog of the day's visitors, about 0.8% off. Kept 400 days
 *   gy:stats:peak           HASH count, at: the most people on at once ever
 *
 * Days are in Korean time. Different people are told apart by a hash of the IP and the date, put
 * into a HyperLogLog: the IP is never stored, the hash is not either (a HyperLogLog only keeps
 * counters), and the same person on two days cannot be linked. People behind one IP (a school,
 * a phone network) count as one, so the visitor number is a lower estimate.
 */
@Service
public class VisitStats {

    private static final Logger log = LoggerFactory.getLogger(VisitStats.class);
    public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    private static final Duration KEEP = Duration.ofDays(400);

    /** One day on the admin page. */
    public record Day(String date, long visits, long visitors, long peak) {
    }

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final ChannelService channels;

    public VisitStats(StringRedisTemplate redis, LuaScripts scripts, ChannelService channels) {
        this.redis = redis;
        this.scripts = scripts;
        this.channels = channels;
    }

    /** Someone came in (a successful hello). Never fails the hello: counting is best effort. */
    public void recordVisit(String ip, long now) {
        String date = date(now);
        try {
            redis.opsForValue().increment(RedisKeys.STATS_VISITS);
            String day = RedisKeys.statsDay(date);
            redis.opsForHash().increment(day, "visits", 1);
            redis.expire(day, KEEP);
            String uv = RedisKeys.statsVisitors(date);
            redis.opsForHyperLogLog().add(uv, visitor(ip, date));
            redis.expire(uv, KEEP);
        } catch (RuntimeException e) {
            log.debug("visit not counted: {}", e.getMessage());
        }
    }

    /** People on right now across live servers, written down when it is a new high. */
    @Scheduled(fixedDelay = 10_000, initialDelay = 10_000)
    public void samplePeak() {
        try {
            long on = channels.list().stream().mapToLong(ChannelService.Info::members).sum();
            if (on <= 0) {
                return;
            }
            long now = System.currentTimeMillis();
            redis.execute(scripts.recordPeak, List.of(RedisKeys.statsDay(date(now)), RedisKeys.STATS_PEAK),
                    String.valueOf(on), String.valueOf(now), String.valueOf(KEEP.toSeconds()));
        } catch (RuntimeException e) {
            log.debug("peak not sampled: {}", e.getMessage());
        }
    }

    /** Totals and the last `days` days, today first. */
    public Map<String, Object> summary(int days, long now) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("total", number(redis.opsForValue().get(RedisKeys.STATS_VISITS)));
        Map<Object, Object> peak = redis.opsForHash().entries(RedisKeys.STATS_PEAK);
        out.put("peakEver", number(peak.get("count")));
        out.put("peakEverAt", number(peak.get("at")));
        LocalDate today = LocalDate.ofInstant(Instant.ofEpochMilli(now), ZONE);
        List<Day> list = new ArrayList<>();
        for (int i = 0; i < days; i++) {
            String date = today.minusDays(i).toString();
            Map<Object, Object> d = redis.opsForHash().entries(RedisKeys.statsDay(date));
            Long uv = redis.opsForHyperLogLog().size(RedisKeys.statsVisitors(date));
            list.add(new Day(date, number(d.get("visits")), uv == null ? 0 : uv, number(d.get("peak"))));
        }
        out.put("days", list);
        return out;
    }

    private static String date(long now) {
        return LocalDate.ofInstant(Instant.ofEpochMilli(now), ZONE).toString();
    }

    private static long number(Object v) {
        if (v == null) {
            return 0;
        }
        try {
            return Long.parseLong(v.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    /** A one-way hash of the IP for one day only. */
    static String visitor(String ip, String date) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256")
                    .digest(("gohaeyaji-visit:" + date + ":" + (ip == null ? "" : ip)).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
