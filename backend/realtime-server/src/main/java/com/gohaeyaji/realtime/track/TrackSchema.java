package com.gohaeyaji.realtime.track;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Usage events the browser may send (protocol section 20, docs/analytics.md). Anything not listed
 * here is dropped: unknown types, unknown keys, values that are not short ids or small numbers.
 * So no free text (a confession, a name) can end up in the statistics, even from a modified page.
 *
 * Value kinds:
 *   ID    a short id: lowercase letters, digits, underscore, at most 24 ("nave", "jobhunt")
 *   BOOL  0 or 1
 *   SEC   a whole number 0..86400 (seconds, counts, buckets)
 *
 * Plain Java on purpose, so it can be checked without the Spring context.
 */
public final class TrackSchema {

    public enum Kind { ID, BOOL, SEC }

    private static final Pattern ID = Pattern.compile("[a-z0-9_]{1,24}");
    private static final Pattern NUM = Pattern.compile("\\d{1,5}");
    /** Random ids made by the browser (32 hex characters). */
    private static final Pattern RANDOM_ID = Pattern.compile("[0-9a-f]{16,32}");

    /** Event type -> allowed keys and their kinds. */
    static final Map<String, Map<String, Kind>> EVENTS = Map.ofEntries(
            Map.entry("session_start", Map.of("src", Kind.ID, "dev", Kind.ID, "inapp", Kind.BOOL, "first", Kind.BOOL)),
            Map.entry("intro_done", Map.of("look", Kind.ID)),
            Map.entry("enter_hall", Map.of()),
            Map.entry("first_move", Map.of("sec", Kind.SEC, "by", Kind.ID)),
            Map.entry("joystick", Map.of("on", Kind.BOOL)),
            Map.entry("place_enter", Map.of("place", Kind.ID)),
            Map.entry("travel", Map.of("to", Kind.ID)),
            Map.entry("booth_enter", Map.of("booth", Kind.SEC)),
            Map.entry("booth_full", Map.of()),
            Map.entry("go_confess", Map.of()),
            Map.entry("first_guide", Map.of("act", Kind.ID)),
            Map.entry("confess_submit", Map.of("persona", Kind.ID, "kind", Kind.ID, "cat", Kind.ID, "caution", Kind.BOOL, "len", Kind.SEC, "sample", Kind.BOOL)),
            Map.entry("answer_done", Map.of("persona", Kind.ID, "cat", Kind.ID, "grade", Kind.ID)),
            Map.entry("card_share", Map.of("persona", Kind.ID, "cat", Kind.ID, "grade", Kind.ID)),
            Map.entry("go_pray", Map.of("persona", Kind.ID, "cat", Kind.ID, "grade", Kind.ID)),
            Map.entry("history_open", Map.of("n", Kind.SEC)),
            Map.entry("history_card", Map.of("persona", Kind.ID, "cat", Kind.ID, "grade", Kind.ID)),
            Map.entry("booth_leave", Map.of("sec", Kind.SEC, "n", Kind.SEC)),
            Map.entry("emote", Map.of("id", Kind.ID)),
            Map.entry("sit", Map.of("place", Kind.ID)),
            Map.entry("candle", Map.of()),
            Map.entry("offering", Map.of()),
            Map.entry("font", Map.of()),
            Map.entry("pigeon", Map.of()),
            Map.entry("inquiry", Map.of()),
            Map.entry("face_saved", Map.of("src", Kind.ID)),
            Map.entry("face_import", Map.of()),
            Map.entry("look_change", Map.of("rgb", Kind.BOOL)),
            Map.entry("rename", Map.of()),
            Map.entry("channel_switch", Map.of()),
            Map.entry("idle_kick", Map.of("place", Kind.ID)),
            Map.entry("session_end", Map.of("sec", Kind.SEC, "place", Kind.ID)));

    /**
     * Steps of the main path, counted per person a day as well (HyperLogLog), so the admin page can
     * show where people drop off.
     */
    public static final List<String> FUNNEL = List.of(
            "session_start", "enter_hall", "first_move", "booth_enter", "confess_submit", "answer_done", "card_share");

    /** The key counted per value on the admin page for each type (place for place_enter, ...). */
    static final Map<String, String> DIMENSION = Map.ofEntries(
            Map.entry("session_start", "src"),
            Map.entry("place_enter", "place"),
            Map.entry("travel", "to"),
            Map.entry("first_guide", "act"),
            Map.entry("confess_submit", "cat"),
            Map.entry("answer_done", "persona"),
            Map.entry("card_share", "cat"),
            Map.entry("go_pray", "cat"),
            Map.entry("history_card", "cat"),
            Map.entry("emote", "id"),
            Map.entry("face_saved", "src"),
            Map.entry("idle_kick", "place"),
            Map.entry("session_end", "place"));

    /** Types that also count the device (mobile, pc) next to their own dimension. */
    static final Set<String> BY_DEVICE = Set.of("session_start");

    private TrackSchema() {
    }

    public static boolean validRandomId(String s) {
        return s != null && RANDOM_ID.matcher(s).matches();
    }

    public static boolean knownType(String type) {
        return type != null && EVENTS.containsKey(type);
    }

    /**
     * Keeps the allowed keys with valid values; drops the rest.
     * @return the cleaned values, or null when the type is unknown
     */
    public static Map<String, String> clean(String type, Map<String, String> raw) {
        Map<String, Kind> allowed = EVENTS.get(type);
        if (allowed == null) {
            return null;
        }
        Map<String, String> out = new LinkedHashMap<>();
        if (raw == null) {
            return out;
        }
        for (Map.Entry<String, Kind> e : allowed.entrySet()) {
            String v = raw.get(e.getKey());
            if (v == null) {
                continue;
            }
            boolean ok = switch (e.getValue()) {
                case ID -> ID.matcher(v).matches();
                case BOOL -> v.equals("0") || v.equals("1");
                case SEC -> NUM.matcher(v).matches() && Integer.parseInt(v) <= 86_400;
            };
            if (ok) {
                out.put(e.getKey(), v);
            }
        }
        return out;
    }

    /** The value counted on the admin page for this event, or null. */
    public static String dimension(String type, Map<String, String> p) {
        String key = DIMENSION.get(type);
        return key == null ? null : p.get(key);
    }

    /** One line of the event log (JSON). Values are ids and numbers only, so nothing needs escaping. */
    public static String line(long ts, String vid, String sid, String type, Map<String, String> p) {
        StringBuilder b = new StringBuilder(96);
        b.append("{\"ts\":").append(ts)
                .append(",\"vid\":\"").append(vid)
                .append("\",\"sid\":\"").append(sid)
                .append("\",\"type\":\"").append(type)
                .append("\",\"p\":{");
        boolean first = true;
        for (Map.Entry<String, String> e : p.entrySet()) {
            if (!first) {
                b.append(',');
            }
            first = false;
            Kind k = EVENTS.get(type).get(e.getKey());
            b.append('"').append(e.getKey()).append("\":");
            if (k == Kind.ID) {
                b.append('"').append(e.getValue()).append('"');
            } else {
                b.append(e.getValue());
            }
        }
        return b.append("}}").toString();
    }
}
