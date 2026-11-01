package com.gohaeyaji.realtime.face;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Reports on hand-drawn faces (protocol section 15) and what the admin page does with them.
 *
 * Reports count per drawing (its hash), not per person: what is judged is the picture. When
 * enough different sessions report the same drawing within the window, the drawing is banned
 * for a while: whoever wears it goes back to the default face and nobody can put it on again.
 *
 * Every reported drawing is also kept for adminKeepMs (7 days) with its history, so a person can
 * look at it on the admin page, ban it for good, give it back or delete it. The history includes
 * each report's time and the names and IP addresses of who reported and who was reported; it is
 * deleted with the drawing or after 7 days, whichever comes first. All of it lives in Redis, so the
 * numbers are shared once several servers run (step 6).
 */
@Service
public class FaceReports {

    public enum Result { COUNTED, ALREADY, BANNED }

    /** One reported drawing as the admin page shows it. banTtlMs: -1 permanent, 0 not banned. */
    public record Entry(String hash, String face, long reports, long firstAt, long lastAt,
                        long bannedAt, String bannedBy, long restoredAt, long banTtlMs, List<Report> log) {
    }

    /** One report, as kept in the log. */
    public record Report(long at, int channelNo, String reporterName, String reporterIp,
                         String targetName, String targetIp) {
    }

    private static final String DATA_PREFIX = "gy:face:";
    private static final String DATA_SUFFIX = ":data";

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final RealtimeProperties props;
    private final Counter reports;
    private final Counter bans;

    private final ObjectMapper mapper;

    public FaceReports(StringRedisTemplate redis, LuaScripts scripts, RealtimeProperties props, MeterRegistry meters,
                       ObjectMapper mapper) {
        this.redis = redis;
        this.mapper = mapper;
        this.scripts = scripts;
        this.props = props;
        this.reports = Counter.builder("gohaeyaji.face.reports").description("face reports received").register(meters);
        this.bans = Counter.builder("gohaeyaji.face.bans").description("drawings banned after reports").register(meters);
    }

    /** @param report time, names and IPs for the admin page's report log */
    public Result report(String face, String reporterSessionId, Report report) {
        String h = FaceRules.hash(face);
        String logEntry;
        try {
            logEntry = mapper.writeValueAsString(report);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
        Long r = redis.execute(scripts.reportFace,
                List.of(RedisKeys.faceReports(h), RedisKeys.faceBan(h), RedisKeys.faceData(h),
                        RedisKeys.faceRecord(h), RedisKeys.ADMIN_FACES, RedisKeys.faceLog(h)),
                reporterSessionId,
                String.valueOf(props.faceReportThreshold()),
                String.valueOf(props.faceReportWindowMs()),
                String.valueOf(props.faceBanMs()),
                face,
                String.valueOf(System.currentTimeMillis()),
                String.valueOf(props.adminKeepMs()),
                logEntry);
        if (r == null || r < 0) {
            return Result.ALREADY;
        }
        reports.increment();
        if (r == 1) {
            bans.increment();
            return Result.BANNED;
        }
        return Result.COUNTED;
    }

    public boolean banned(String face) {
        return face != null && Boolean.TRUE.equals(redis.hasKey(RedisKeys.faceBan(FaceRules.hash(face))));
    }

    // ------------------------------------------------------------------ admin page

    /** Reported drawings of the last adminKeepMs, newest report first. */
    public List<Entry> list(int limit) {
        long since = System.currentTimeMillis() - props.adminKeepMs();
        redis.opsForZSet().removeRangeByScore(RedisKeys.ADMIN_FACES, Double.NEGATIVE_INFINITY, since);
        Set<String> keys = redis.opsForZSet().reverseRange(RedisKeys.ADMIN_FACES, 0, limit - 1);
        List<Entry> out = new ArrayList<>();
        if (keys == null) {
            return out;
        }
        for (String dataKey : keys) {
            String h = dataKey.substring(DATA_PREFIX.length(), dataKey.length() - DATA_SUFFIX.length());
            Entry e = entry(h);
            if (e != null) {
                out.add(e);
            }
        }
        return out;
    }

    public Entry entry(String h) {
        String face = redis.opsForValue().get(RedisKeys.faceData(h));
        if (face == null) {
            return null;
        }
        Map<Object, Object> rec = redis.opsForHash().entries(RedisKeys.faceRecord(h));
        Long ttl = redis.getExpire(RedisKeys.faceBan(h), java.util.concurrent.TimeUnit.MILLISECONDS);
        // getExpire: -2 no key, -1 no expiry (permanent)
        long banTtl = ttl == null || ttl == -2 ? 0 : (ttl == -1 ? -1 : ttl);
        List<Report> log = new ArrayList<>();
        List<String> raw = redis.opsForList().range(RedisKeys.faceLog(h), 0, -1);
        if (raw != null) {
            for (String json : raw) {
                try {
                    log.add(mapper.readValue(json, Report.class));
                } catch (JsonProcessingException e) {
                    // a malformed line is skipped, the rest still shows
                }
            }
        }
        return new Entry(h, face, num(rec.get("reports")), num(rec.get("firstAt")), num(rec.get("lastAt")),
                num(rec.get("bannedAt")), (String) rec.get("bannedBy"), num(rec.get("restoredAt")), banTtl, log);
    }

    /**
     * Bans a reported drawing by hand. Permanent bans have no expiry and the record is kept as
     * long as the ban lasts. @return the drawing, so the caller can take it off whoever wears it
     */
    public String ban(String h, boolean permanent) {
        String face = redis.opsForValue().get(RedisKeys.faceData(h));
        if (face == null) {
            return null;
        }
        if (permanent) {
            redis.opsForValue().set(RedisKeys.faceBan(h), "1");
            redis.persist(RedisKeys.faceData(h));
            redis.persist(RedisKeys.faceRecord(h));
            redis.persist(RedisKeys.faceLog(h));
        } else {
            redis.opsForValue().set(RedisKeys.faceBan(h), "1", java.time.Duration.ofMillis(props.faceBanMs()));
        }
        redis.opsForHash().put(RedisKeys.faceRecord(h), "bannedAt", String.valueOf(System.currentTimeMillis()));
        redis.opsForHash().put(RedisKeys.faceRecord(h), "bannedBy", permanent ? "admin-permanent" : "admin");
        redis.opsForHash().delete(RedisKeys.faceRecord(h), "restoredAt");
        bans.increment();
        return face;
    }

    /** Lifts the ban and forgets the reports, so the drawing can be worn again. */
    public boolean restore(String h) {
        if (redis.opsForValue().get(RedisKeys.faceData(h)) == null) {
            return false;
        }
        redis.delete(List.of(RedisKeys.faceBan(h), RedisKeys.faceReports(h)));
        redis.opsForHash().delete(RedisKeys.faceRecord(h), "bannedAt", "bannedBy");
        redis.opsForHash().put(RedisKeys.faceRecord(h), "restoredAt", String.valueOf(System.currentTimeMillis()));
        // back to the normal retention, in case it had been made permanent
        redis.expire(RedisKeys.faceData(h), java.time.Duration.ofMillis(props.adminKeepMs()));
        redis.expire(RedisKeys.faceRecord(h), java.time.Duration.ofMillis(props.adminKeepMs()));
        redis.expire(RedisKeys.faceLog(h), java.time.Duration.ofMillis(props.adminKeepMs()));
        return true;
    }

    /**
     * Deletes the drawing and its whole history (report log with IPs included) from the admin page.
     * A ban on it stays in force: a 24 hour ban runs out by itself, a permanent one keeps the drawing
     * blocked even though nobody can see it any more. Lift a ban first (restore) to clear everything.
     */
    public boolean delete(String h) {
        Long removed = redis.opsForZSet().remove(RedisKeys.ADMIN_FACES, RedisKeys.faceData(h));
        Long deleted = redis.delete(List.of(RedisKeys.faceData(h), RedisKeys.faceRecord(h),
                RedisKeys.faceLog(h), RedisKeys.faceReports(h)));
        return (removed != null && removed > 0) || (deleted != null && deleted > 0);
    }

    private static long num(Object v) {
        try {
            return v == null ? 0 : Long.parseLong(v.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
