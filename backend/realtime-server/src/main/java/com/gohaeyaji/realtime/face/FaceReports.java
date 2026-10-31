package com.gohaeyaji.realtime.face;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Reports on hand-drawn faces (protocol section 15).
 *
 * Reports count per drawing (its hash), not per person: what is judged is the picture. When
 * enough different sessions report the same drawing within the window, the drawing is banned
 * for a while: whoever wears it goes back to the default face and nobody can put it on again.
 * Kept in Redis so the count is shared once several servers run (step 6).
 */
@Service
public class FaceReports {

    public enum Result { COUNTED, ALREADY, BANNED }

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final RealtimeProperties props;
    private final Counter reports;
    private final Counter bans;

    public FaceReports(StringRedisTemplate redis, LuaScripts scripts, RealtimeProperties props, MeterRegistry meters) {
        this.redis = redis;
        this.scripts = scripts;
        this.props = props;
        this.reports = Counter.builder("gohaeyaji.face.reports").description("face reports received").register(meters);
        this.bans = Counter.builder("gohaeyaji.face.bans").description("drawings banned after reports").register(meters);
    }

    public Result report(String face, String reporterSessionId) {
        String h = FaceRules.hash(face);
        Long r = redis.execute(scripts.reportFace,
                List.of(RedisKeys.faceReports(h), RedisKeys.faceBan(h)),
                reporterSessionId,
                String.valueOf(props.faceReportThreshold()),
                String.valueOf(props.faceReportWindowMs()),
                String.valueOf(props.faceBanMs()));
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
}
