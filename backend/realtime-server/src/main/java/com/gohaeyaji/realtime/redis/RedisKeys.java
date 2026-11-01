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

    /** Admin index of reported drawings: member = data key, score = last report time. */
    public static final String ADMIN_FACES = "gy:admin:faces";

    public static String booth(int channelNo, int boothId) {
        return CHANNEL_PREFIX + channelNo + ":booth:" + boothId;
    }
}
