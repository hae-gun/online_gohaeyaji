package com.gohaeyaji.realtime.track;

import com.fasterxml.jackson.databind.JsonNode;
import com.gohaeyaji.realtime.redis.RedisKeys;
import com.gohaeyaji.realtime.stats.VisitStats;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Usage statistics (protocol section 20, docs/analytics.md).
 *
 * The browser sends small events ("entered a booth", "travelled to the nave") with a random visitor
 * id kept in that browser and a random id for this visit. No IP, no confession text, no name: the
 * schema (TrackSchema) only lets short ids and numbers through.
 *
 * Each accepted event goes to three places:
 *   Redis    gy:track:day:{date}            HASH type -> count
 *            gy:track:uv:{date}:{type}      HyperLogLog of visitor ids, funnel steps only
 *            gy:track:dim:{date}:{type}     HASH value -> count (place for place_enter, ...)
 *            all kept keepDays (Redis persists with AOF, the redis-data volume)
 *   Disk     {dir}/{date}.jsonl             every event, the record to analyse (TrackLog)
 *   Metrics  gohaeyaji.track.events{type}   for Grafana
 *
 * Best effort everywhere: a failure here never disturbs the visit itself.
 */
@Service
public class TrackService {

    private static final Logger log = LoggerFactory.getLogger(TrackService.class);

    private final TrackProperties props;
    private final StringRedisTemplate redis;
    private final MeterRegistry meters;
    private final TrackLog file;
    private final Duration keep;
    private final Map<String, Counter> counters = new HashMap<>();
    private final AtomicLong beaconMinute = new AtomicLong();
    private final AtomicInteger beaconCount = new AtomicInteger();
    private final java.util.concurrent.atomic.AtomicBoolean diskWarned = new java.util.concurrent.atomic.AtomicBoolean();

    public TrackService(TrackProperties props, StringRedisTemplate redis, MeterRegistry meters) {
        this.props = props;
        this.redis = redis;
        this.meters = meters;
        this.file = new TrackLog(props.dir(), props.keepDays(), Math.max(0, props.minFreeMb()) * 1024L * 1024L);
        this.keep = Duration.ofDays(Math.max(1, props.keepDays()));
    }

    public boolean enabled() {
        return props.enabled();
    }

    public int maxBatch() {
        return props.maxBatch();
    }

    public int perMinute() {
        return props.perMinute();
    }

    /** One more beacon this minute, if the server-wide budget allows. */
    public boolean acceptBeacon(long now) {
        long minute = now / 60_000;
        if (beaconMinute.getAndSet(minute) != minute) {
            beaconCount.set(0);
        }
        return beaconCount.incrementAndGet() <= props.beaconPerMinute();
    }

    /**
     * Records a batch: {@code [{ "type": "travel", "p": { "to": "nave" } }, ...]}.
     * @param limit at most this many events are taken from the batch
     * @return how many were accepted
     */
    public int record(String vid, String sid, JsonNode events, int limit, long now) {
        if (!props.enabled() || !TrackSchema.validRandomId(vid) || !TrackSchema.validRandomId(sid)
                || events == null || !events.isArray()) {
            return 0;
        }
        String date = LocalDate.ofInstant(Instant.ofEpochMilli(now), VisitStats.ZONE).toString();
        List<String> lines = new ArrayList<>();
        Map<String, Long> byType = new LinkedHashMap<>();
        Map<String, Map<String, Long>> byDim = new LinkedHashMap<>();
        List<String> funnelSeen = new ArrayList<>();
        int taken = 0;
        for (JsonNode e : events) {
            if (taken >= Math.min(limit, props.maxBatch())) {
                break;
            }
            String type = e.path("type").asText(null);
            if (!TrackSchema.knownType(type)) {
                continue;
            }
            Map<String, String> p = TrackSchema.clean(type, raw(e.path("p")));
            taken++;
            lines.add(TrackSchema.line(now, vid, sid, type, p));
            byType.merge(type, 1L, Long::sum);
            String dim = TrackSchema.dimension(type, p);
            if (dim != null) {
                byDim.computeIfAbsent(type, k -> new LinkedHashMap<>()).merge(dim, 1L, Long::sum);
            }
            if (TrackSchema.BY_DEVICE.contains(type) && p.get("dev") != null) {
                byDim.computeIfAbsent(type + "_dev", k -> new LinkedHashMap<>()).merge(p.get("dev"), 1L, Long::sum);
            }
            if (TrackSchema.FUNNEL.contains(type) && !funnelSeen.contains(type)) {
                funnelSeen.add(type);
            }
            counter(type).increment();
        }
        if (taken == 0) {
            return 0;
        }
        try {
            if (!file.append(date, lines) && file.diskLow() && diskWarned.compareAndSet(false, true)) {
                log.warn("disk nearly full: track events are counted in Redis only until space is freed");
            } else if (!file.diskLow()) {
                diskWarned.set(false);
            }
        } catch (IOException | RuntimeException ex) {
            log.warn("track log not written: {}", ex.getMessage());
        }
        try {
            String dayKey = RedisKeys.trackDay(date);
            redis.executePipelined((org.springframework.data.redis.core.RedisCallback<Object>) conn -> {
                var s = redis.getStringSerializer();
                for (Map.Entry<String, Long> t : byType.entrySet()) {
                    conn.hashCommands().hIncrBy(s.serialize(dayKey), s.serialize(t.getKey()), t.getValue());
                }
                conn.keyCommands().expire(s.serialize(dayKey), keep.toSeconds());
                for (String type : funnelSeen) {
                    byte[] k = s.serialize(RedisKeys.trackVisitors(date, type));
                    conn.hyperLogLogCommands().pfAdd(k, s.serialize(vid));
                    conn.keyCommands().expire(k, keep.toSeconds());
                }
                for (Map.Entry<String, Map<String, Long>> d : byDim.entrySet()) {
                    byte[] k = s.serialize(RedisKeys.trackDimension(date, d.getKey()));
                    for (Map.Entry<String, Long> v : d.getValue().entrySet()) {
                        conn.hashCommands().hIncrBy(k, s.serialize(v.getKey()), v.getValue());
                    }
                    conn.keyCommands().expire(k, keep.toSeconds());
                }
                return null;
            });
        } catch (RuntimeException ex) {
            log.debug("track counters not updated: {}", ex.getMessage());
        }
        return taken;
    }

    /** Every 6 hours (and a minute after start): days before today gzipped, days past keepDays deleted. */
    @Scheduled(initialDelay = 60_000, fixedDelay = 6 * 60 * 60 * 1000)
    public void deleteOldFiles() {
        try {
            LocalDate today = LocalDate.now(VisitStats.ZONE);
            int z = file.compressOld(today);
            int n = file.deleteOld(today);
            if (z > 0 || n > 0) {
                log.info("track files: {} gzipped, {} deleted", z, n);
            }
        } catch (IOException | RuntimeException e) {
            log.warn("old track files not deleted: {}", e.getMessage());
        }
    }

    /**
     * For the admin page: the funnel per day (events and different visitors per step) and, over the
     * whole range, the top values of each dimension.
     */
    public Map<String, Object> summary(int days, long now) {
        Map<String, Object> out = new LinkedHashMap<>();
        LocalDate today = LocalDate.ofInstant(Instant.ofEpochMilli(now), VisitStats.ZONE);
        List<Map<String, Object>> list = new ArrayList<>();
        Map<String, Map<String, Long>> dims = new LinkedHashMap<>();
        List<String> uvKeysAll = new ArrayList<>();
        for (int i = 0; i < days; i++) {
            String date = today.minusDays(i).toString();
            Map<Object, Object> counts = redis.opsForHash().entries(RedisKeys.trackDay(date));
            Map<String, Object> day = new LinkedHashMap<>();
            day.put("date", date);
            List<Map<String, Object>> steps = new ArrayList<>();
            for (String type : TrackSchema.FUNNEL) {
                String uvKey = RedisKeys.trackVisitors(date, type);
                Long uv = redis.opsForHyperLogLog().size(uvKey);
                Map<String, Object> st = new LinkedHashMap<>();
                st.put("type", type);
                st.put("events", number(counts.get(type)));
                st.put("visitors", uv == null ? 0 : uv);
                steps.add(st);
            }
            day.put("funnel", steps);
            Map<String, Long> other = new LinkedHashMap<>();
            for (Map.Entry<Object, Object> c : counts.entrySet()) {
                if (!TrackSchema.FUNNEL.contains(c.getKey().toString())) {
                    other.put(c.getKey().toString(), number(c.getValue()));
                }
            }
            day.put("other", other);
            list.add(day);
            for (String type : dimensionKeys()) {
                Map<Object, Object> d = redis.opsForHash().entries(RedisKeys.trackDimension(date, type));
                Map<String, Long> acc = dims.computeIfAbsent(type, k -> new HashMap<>());
                for (Map.Entry<Object, Object> v : d.entrySet()) {
                    acc.merge(v.getKey().toString(), number(v.getValue()), Long::sum);
                }
            }
        }
        out.put("days", list);
        // the whole range: different visitors per funnel step (a HyperLogLog union, no ids stored)
        Map<String, Long> rangeVisitors = new LinkedHashMap<>();
        for (String type : TrackSchema.FUNNEL) {
            uvKeysAll.clear();
            for (int i = 0; i < days; i++) {
                uvKeysAll.add(RedisKeys.trackVisitors(today.minusDays(i).toString(), type));
            }
            Long u = redis.opsForHyperLogLog().size(uvKeysAll.toArray(new String[0]));
            rangeVisitors.put(type, u == null ? 0 : u);
        }
        out.put("rangeVisitors", rangeVisitors);
        Map<String, List<Map<String, Object>>> top = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Long>> d : dims.entrySet()) {
            List<Map<String, Object>> rows = new ArrayList<>();
            d.getValue().entrySet().stream()
                    .sorted((a, b) -> Long.compare(b.getValue(), a.getValue()))
                    .limit(15)
                    .forEach(v -> {
                        Map<String, Object> r = new LinkedHashMap<>();
                        r.put("value", v.getKey());
                        r.put("count", v.getValue());
                        rows.add(r);
                    });
            top.put(d.getKey(), rows);
        }
        out.put("top", top);
        out.put("fileLog", file.enabled());
        out.put("diskLow", file.diskLow());
        out.put("keepDays", props.keepDays());
        return out;
    }

    private static List<String> dimensionKeys() {
        List<String> keys = new ArrayList<>(TrackSchema.DIMENSION.keySet());
        for (String t : TrackSchema.BY_DEVICE) {
            keys.add(t + "_dev");
        }
        return keys;
    }

    private Counter counter(String type) {
        synchronized (counters) {
            return counters.computeIfAbsent(type, t -> Counter.builder("gohaeyaji.track.events")
                    .description("usage events accepted, by type (protocol section 20)")
                    .tag("type", t)
                    .register(meters));
        }
    }

    /** The p object as strings: ids stay text, numbers and booleans become text too. */
    private static Map<String, String> raw(JsonNode p) {
        Map<String, String> m = new HashMap<>();
        if (p == null || !p.isObject()) {
            return m;
        }
        Iterator<Map.Entry<String, JsonNode>> it = p.fields();
        int n = 0;
        while (it.hasNext() && n++ < 12) {
            Map.Entry<String, JsonNode> f = it.next();
            JsonNode v = f.getValue();
            if (v.isTextual()) {
                m.put(f.getKey(), v.asText());
            } else if (v.isIntegralNumber()) {
                m.put(f.getKey(), Long.toString(v.asLong()));
            } else if (v.isBoolean()) {
                m.put(f.getKey(), v.asBoolean() ? "1" : "0");
            }
        }
        return m;
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
}
