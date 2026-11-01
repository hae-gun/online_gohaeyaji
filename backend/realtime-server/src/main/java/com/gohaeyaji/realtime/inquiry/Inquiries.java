package com.gohaeyaji.realtime.inquiry;

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
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations;
import org.springframework.stereotype.Service;

/**
 * "신께 알리기" (protocol section 17): the box in the middle of the confession hall where people
 * leave questions, requests and bug reports about the site. Only the admin page reads them.
 *
 * Kept in Redis until an admin deletes them, at most inquiryKeep (oldest dropped first):
 *   gy:inquiry:seq          INCR, the id
 *   gy:inquiry:{id}         HASH at, kind, text, channelNo, name, done
 *   gy:inquiries            ZSET id by time (the admin list)
 *   gy:inquiries:open       SET ids not marked done yet (the count on the admin page)
 *   gy:inquiry:ip:{hash}    INCR with a 1 h TTL, the per-IP limit. Only a hash of the IP, and
 *                           only for that hour: the IP is never stored with the message.
 *
 * Redis must persist (appendonly) in production, or the box empties on a restart.
 */
@Service
public class Inquiries {

    /** What people can pick in the form. */
    public static final Set<String> KINDS = Set.of("question", "request", "idea", "bug");

    public enum Verdict { OK, INVALID, TOO_MANY }

    public record Result(Verdict verdict, long id) {
    }

    /** One message as the admin page shows it. */
    public record Entry(long id, long at, String kind, String text, int channelNo, String name, boolean done) {
    }

    private final StringRedisTemplate redis;
    private final RealtimeProperties props;
    private final Counter received;

    public Inquiries(StringRedisTemplate redis, RealtimeProperties props, MeterRegistry meters) {
        this.redis = redis;
        this.props = props;
        this.received = Counter.builder("gohaeyaji.inquiries").description("messages left in the inquiry box")
                .register(meters);
    }

    /**
     * Cleans the text: control characters out (line breaks stay), no more than two empty lines in a
     * row, trimmed. @return null if what is left is too short or too long
     */
    public String clean(String text) {
        if (text == null) {
            return null;
        }
        StringBuilder b = new StringBuilder();
        text.codePoints().forEach(c -> {
            if (c == '\n' || !Character.isISOControl(c)) {
                b.appendCodePoint(c);
            }
        });
        String t = b.toString().replaceAll("\n{3,}", "\n\n").strip();
        int n = t.codePointCount(0, t.length());
        return n < props.inquiryMinChars() || n > props.inquiryMaxChars() ? null : t;
    }

    public Result submit(String kind, String text, int channelNo, String name, String ip, long now) {
        String clean = clean(text);
        if (clean == null || kind == null || !KINDS.contains(kind)) {
            return new Result(Verdict.INVALID, 0);
        }
        String ipKey = RedisKeys.inquiryIp(ipHash(ip));
        Long sent = redis.opsForValue().increment(ipKey);
        if (sent != null && sent == 1) {
            redis.expire(ipKey, Duration.ofHours(1));
        }
        if (sent != null && sent > props.inquiryPerIpPerHour()) {
            return new Result(Verdict.TOO_MANY, 0);
        }
        Long id = redis.opsForValue().increment(RedisKeys.INQUIRY_SEQ);
        Map<String, String> h = new HashMap<>();
        h.put("at", String.valueOf(now));
        h.put("kind", kind);
        h.put("text", clean);
        h.put("channelNo", String.valueOf(channelNo));
        h.put("name", name == null ? "" : name);
        h.put("done", "0");
        redis.opsForHash().putAll(RedisKeys.inquiry(id), h);
        redis.opsForZSet().add(RedisKeys.INQUIRIES, String.valueOf(id), now);
        redis.opsForSet().add(RedisKeys.INQUIRIES_OPEN, String.valueOf(id));
        received.increment();
        trim();
        return new Result(Verdict.OK, id);
    }

    /** Drops the oldest messages beyond inquiryKeep. */
    private void trim() {
        Long size = redis.opsForZSet().size(RedisKeys.INQUIRIES);
        if (size == null || size <= props.inquiryKeep()) {
            return;
        }
        Set<ZSetOperations.TypedTuple<String>> old = redis.opsForZSet().popMin(RedisKeys.INQUIRIES, size - props.inquiryKeep());
        if (old == null) {
            return;
        }
        for (ZSetOperations.TypedTuple<String> t : old) {
            redis.delete(RedisKeys.inquiry(Long.parseLong(t.getValue())));
            redis.opsForSet().remove(RedisKeys.INQUIRIES_OPEN, t.getValue());
        }
    }

    /** Newest first. */
    public List<Entry> list(int limit) {
        Set<String> ids = redis.opsForZSet().reverseRange(RedisKeys.INQUIRIES, 0, limit - 1L);
        List<Entry> out = new ArrayList<>();
        if (ids == null) {
            return out;
        }
        for (String id : ids) {
            Entry e = entry(Long.parseLong(id));
            if (e != null) {
                out.add(e);
            }
        }
        return out;
    }

    public Entry entry(long id) {
        Map<Object, Object> h = redis.opsForHash().entries(RedisKeys.inquiry(id));
        if (h.isEmpty()) {
            return null;
        }
        return new Entry(id, num(h.get("at")), str(h.get("kind")), str(h.get("text")), (int) num(h.get("channelNo")),
                str(h.get("name")), "1".equals(h.get("done")));
    }

    public long openCount() {
        Long n = redis.opsForSet().size(RedisKeys.INQUIRIES_OPEN);
        return n == null ? 0 : n;
    }

    /** @return false if there is no such message */
    public boolean markDone(long id, boolean done) {
        String key = RedisKeys.inquiry(id);
        if (!Boolean.TRUE.equals(redis.hasKey(key))) {
            return false;
        }
        redis.opsForHash().put(key, "done", done ? "1" : "0");
        if (done) {
            redis.opsForSet().remove(RedisKeys.INQUIRIES_OPEN, String.valueOf(id));
        } else {
            redis.opsForSet().add(RedisKeys.INQUIRIES_OPEN, String.valueOf(id));
        }
        return true;
    }

    /** Deletes the message with its name and IP. @return false if there is no such message */
    public boolean delete(long id) {
        boolean existed = Boolean.TRUE.equals(redis.delete(RedisKeys.inquiry(id)));
        redis.opsForZSet().remove(RedisKeys.INQUIRIES, String.valueOf(id));
        redis.opsForSet().remove(RedisKeys.INQUIRIES_OPEN, String.valueOf(id));
        return existed;
    }

    /** A short one-way hash, so the rate-limit key does not hold the address itself. */
    private static String ipHash(String ip) {
        try {
            byte[] d = java.security.MessageDigest.getInstance("SHA-256")
                    .digest(("gohaeyaji-inquiry:" + ip).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(d, 0, 12);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
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
