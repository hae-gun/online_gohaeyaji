package com.gohaeyaji.realtime.redis;

/** Redis key layout. See docs/realtime-protocol.md section 12. */
public final class RedisKeys {

    public static final String CHANNEL_PREFIX = "gy:ch:";
    public static final String CHANNELS = "gy:channels";
    /** Live servers: member = server id, score = last heartbeat (ms). */
    public static final String SERVERS = "gy:servers";

    private RedisKeys() {
    }

    /** HASH: server id -> sessions that server holds in this channel. */
    public static String members(int channelNo) {
        return CHANNEL_PREFIX + channelNo + ":members";
    }

    public static String seq(int channelNo) {
        return CHANNEL_PREFIX + channelNo + ":seq";
    }

    public static String pidSeq(int channelNo) {
        return CHANNEL_PREFIX + channelNo + ":pid";
    }

    /** Sessions that reported this drawing (protocol section 15). */
    public static String faceReports(String faceHash) {
        return "gy:face:" + faceHash + ":reports";
    }

    /** Present while this drawing is banned. */
    public static String faceBan(String faceHash) {
        return "gy:face:" + faceHash + ":ban";
    }

    /** The reported drawing itself, kept for the admin page. */
    public static String faceData(String faceHash) {
        return "gy:face:" + faceHash + ":data";
    }

    /** What happened to a reported drawing: reports, firstAt, lastAt, bannedAt, bannedBy. */
    public static String faceRecord(String faceHash) {
        return "gy:face:" + faceHash + ":record";
    }

    /** Report log of a drawing: newest first, at most 50, JSON per report (time, names, IPs). */
    public static String faceLog(String faceHash) {
        return "gy:face:" + faceHash + ":log";
    }

    /** Admin index of reported drawings: member = data key, score = last report time. */
    public static final String ADMIN_FACES = "gy:admin:faces";

    /** Inquiry box (protocol section 17): id counter, one HASH per message, list by time, ids not done yet. */
    public static final String INQUIRY_SEQ = "gy:inquiry:seq";
    public static final String INQUIRIES = "gy:inquiries";
    public static final String INQUIRIES_OPEN = "gy:inquiries:open";

    public static String inquiry(long id) {
        return "gy:inquiry:" + id;
    }

    /** Messages sent from one IP in the last hour; the key holds a hash of the IP, not the IP. */
    public static String inquiryIp(String ipHash) {
        return "gy:inquiry:ip:" + ipHash;
    }

    /** Answer improvement box (protocol section 19): only confessions people chose to send. */
    public static final String FEEDBACK_SEQ = "gy:feedback:seq";
    public static final String FEEDBACKS = "gy:feedbacks";
    public static final String FEEDBACKS_TODO = "gy:feedbacks:todo";

    public static String feedback(long id) {
        return "gy:feedback:" + id;
    }

    /** Sent from one IP in the last hour; the key holds a hash of the IP, not the IP. */
    public static String feedbackIp(String ipHash) {
        return "gy:feedback:ip:" + ipHash;
    }

    /** Visit counts for the admin page (stats/VisitStats): entries, per day, the most at once. */
    public static final String STATS_VISITS = "gy:stats:visits";
    public static final String STATS_PEAK = "gy:stats:peak";

    /** HASH visits, peak of one day (yyyy-MM-dd, Korean time). */
    public static String statsDay(String date) {
        return "gy:stats:day:" + date;
    }

    /** HyperLogLog of one day's visitors (hashes of IP and date, never the IP). */
    public static String statsVisitors(String date) {
        return "gy:stats:uv:" + date;
    }

    public static String booth(int channelNo, int boothId) {
        return CHANNEL_PREFIX + channelNo + ":booth:" + boothId;
    }
}
