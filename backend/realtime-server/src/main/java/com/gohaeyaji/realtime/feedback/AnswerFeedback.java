package com.gohaeyaji.realtime.feedback;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.RedisKeys;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;

/**
 * "답변 개선함" (protocol section 19): confessions people chose to send after an answer that
 * missed, so the operator can improve the answer data.
 *
 * Confessions are otherwise never stored. Only what a person explicitly sends after a consent
 * step arrives here, without name or IP, with phone numbers, e-mail addresses and long digit
 * runs masked, and it disappears after feedbackKeepMs (30 days) or when the admin deletes it.
 *
 *   gy:feedback:seq         INCR, the id
 *   gy:feedback:{id}        HASH at, reason, text, persona, category, answer, status; TTL 30 days
 *   gy:feedbacks            ZSET id by time (the admin list; expired ids are dropped when listed)
 *   gy:feedbacks:todo       SET ids not looked at yet
 *   gy:feedback:ip:{hash}   INCR with a 1 h TTL, the per-IP limit (a hash, never the address)
 */
@Service
public class AnswerFeedback {

    /** Why the answer missed: misunderstood the topic, or too bland. */
    public static final Set<String> REASONS = Set.of("wrong", "bland");
    /** What the admin decided: not looked at, wrong category, new topic needed, nothing to do. */
    public static final Set<String> STATUSES = Set.of("todo", "wrong", "new", "ignore");
    private static final Set<String> PERSONAS = Set.of("jin", "eom", "yu", "baek");
    private static final Pattern CATEGORY = Pattern.compile("^[a-z0-9_-]{1,32}$");

    private static final Pattern EMAIL = Pattern.compile("[\\w.+-]+@[\\w-]+(\\.[\\w-]+)+");
    private static final Pattern PHONE = Pattern.compile("(?<!\\d)0\\d{1,2}[ .-]?\\d{3,4}[ .-]?\\d{4}(?!\\d)");
    private static final Pattern DIGITS = Pattern.compile("\\d[\\d .-]{5,}\\d");

    public enum Verdict { OK, INVALID, TOO_MANY }

    public record Entry(long id, long at, String reason, String text, String persona, String category,
                        String answer, String status) {
    }

    private final StringRedisTemplate redis;
    private final RealtimeProperties props;
    private final Counter received;

    public AnswerFeedback(StringRedisTemplate redis, RealtimeProperties props, MeterRegistry meters) {
        this.redis = redis;
        this.props = props;
        this.received = Counter.builder("gohaeyaji.answer.feedback")
                .description("confessions sent to the answer improvement box (with consent)").register(meters);
    }

    /** Masks what looks like contact details or ID numbers. Same rules as the browser shows before sending. */
    public static String mask(String s) {
        String t = EMAIL.matcher(s).replaceAll("[이메일]");
        t = PHONE.matcher(t).replaceAll("[전화번호]");
        return DIGITS.matcher(t).replaceAll("[숫자]");
    }

    private static String clean(String s, int max) {
        if (s == null) {
            return null;
        }
        StringBuilder b = new StringBuilder();
        s.codePoints().forEach(c -> {
            if (!Character.isISOControl(c)) {
                b.appendCodePoint(c);
            }
        });
        String t = b.toString().strip();
        int n = t.codePointCount(0, t.length());
        return n == 0 || n > max ? null : t;
    }

    public Verdict submit(String reason, String text, String persona, String category, String answer,
                          String ip, long now) {
        String q = clean(text, 200);
        String a = clean(answer, 800);
        if (q == null || a == null || reason == null || !REASONS.contains(reason)
                || persona == null || !PERSONAS.contains(persona)
                || category == null || !CATEGORY.matcher(category).matches()) {
            return Verdict.INVALID;
        }
        String ipKey = RedisKeys.feedbackIp(Ips.hash("feedback", ip));
        Long sent = redis.opsForValue().increment(ipKey);
        if (sent != null && sent == 1) {
            redis.expire(ipKey, Duration.ofHours(1));
        }
        if (sent != null && sent > props.feedbackPerIpPerHour()) {
            return Verdict.TOO_MANY;
        }
        Long id = redis.opsForValue().increment(RedisKeys.FEEDBACK_SEQ);
        String key = RedisKeys.feedback(id);
        Map<String, String> h = new HashMap<>();
        h.put("at", String.valueOf(now));
        h.put("reason", reason);
        h.put("text", mask(q));
        h.put("persona", persona);
        h.put("category", category);
        h.put("answer", a);
        h.put("status", "todo");
        redis.opsForHash().putAll(key, h);
        redis.expire(key, Duration.ofMillis(props.feedbackKeepMs()));
        redis.opsForZSet().add(RedisKeys.FEEDBACKS, String.valueOf(id), now);
        redis.opsForSet().add(RedisKeys.FEEDBACKS_TODO, String.valueOf(id));
        received.increment();
        trim(now);
        return Verdict.OK;
    }

    /** Drops ids older than the keep time (their hashes already expired) and beyond 5000. */
    private void trim(long now) {
        Set<String> old = redis.opsForZSet().rangeByScore(RedisKeys.FEEDBACKS, 0, now - props.feedbackKeepMs());
        if (old != null && !old.isEmpty()) {
            redis.opsForZSet().remove(RedisKeys.FEEDBACKS, old.toArray());
            redis.opsForSet().remove(RedisKeys.FEEDBACKS_TODO, old.toArray());
        }
        Long size = redis.opsForZSet().size(RedisKeys.FEEDBACKS);
        if (size != null && size > 5000) {
            Set<ZSetOperations.TypedTuple<String>> extra = redis.opsForZSet().popMin(RedisKeys.FEEDBACKS, size - 5000);
            if (extra != null) {
                for (ZSetOperations.TypedTuple<String> t : extra) {
                    redis.delete(RedisKeys.feedback(Long.parseLong(t.getValue())));
                    redis.opsForSet().remove(RedisKeys.FEEDBACKS_TODO, t.getValue());
                }
            }
        }
    }

    /** Newest first. */
    public List<Entry> list(int limit) {
        trim(System.currentTimeMillis());
        Set<String> ids = redis.opsForZSet().reverseRange(RedisKeys.FEEDBACKS, 0, limit - 1L);
        List<Entry> out = new ArrayList<>();
        if (ids == null) {
            return out;
        }
        for (String id : ids) {
            Entry e = entry(Long.parseLong(id));
            if (e == null) {
                // expired on its own
                redis.opsForZSet().remove(RedisKeys.FEEDBACKS, id);
                redis.opsForSet().remove(RedisKeys.FEEDBACKS_TODO, id);
            } else {
                out.add(e);
            }
        }
        return out;
    }

    public Entry entry(long id) {
        Map<Object, Object> h = redis.opsForHash().entries(RedisKeys.feedback(id));
        if (h.isEmpty()) {
            return null;
        }
        return new Entry(id, num(h.get("at")), str(h.get("reason")), str(h.get("text")), str(h.get("persona")),
                str(h.get("category")), str(h.get("answer")), str(h.get("status")));
    }

    public long todoCount() {
        Long n = redis.opsForSet().size(RedisKeys.FEEDBACKS_TODO);
        return n == null ? 0 : n;
    }

    /** @return false if there is no such entry or the status is unknown */
    public boolean mark(long id, String status) {
        String key = RedisKeys.feedback(id);
        if (!STATUSES.contains(status) || !Boolean.TRUE.equals(redis.hasKey(key))) {
            return false;
        }
        redis.opsForHash().put(key, "status", status);
        if ("todo".equals(status)) {
            redis.opsForSet().add(RedisKeys.FEEDBACKS_TODO, String.valueOf(id));
        } else {
            redis.opsForSet().remove(RedisKeys.FEEDBACKS_TODO, String.valueOf(id));
        }
        return true;
    }

    public boolean delete(long id) {
        boolean existed = Boolean.TRUE.equals(redis.delete(RedisKeys.feedback(id)));
        redis.opsForZSet().remove(RedisKeys.FEEDBACKS, String.valueOf(id));
        redis.opsForSet().remove(RedisKeys.FEEDBACKS_TODO, String.valueOf(id));
        return existed;
    }

    private static long num(Object o) {
        try {
            return o == null ? 0 : Long.parseLong(o.toString());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String str(Object o) {
        return o == null ? "" : o.toString();
    }
}
