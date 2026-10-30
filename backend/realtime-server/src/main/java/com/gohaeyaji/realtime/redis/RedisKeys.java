package com.gohaeyaji.realtime.redis;

/** Redis key layout. See docs/realtime-protocol.md section 12. */
public final class RedisKeys {

    public static final String CHANNEL_PREFIX = "gy:ch:";
    public static final String CHANNELS = "gy:channels";

    private RedisKeys() {
    }

    public static String members(int channelNo) {
        return CHANNEL_PREFIX + channelNo + ":members";
    }

    public static String seq(int channelNo) {
        return CHANNEL_PREFIX + channelNo + ":seq";
    }

    public static String booth(int channelNo, int boothId) {
        return CHANNEL_PREFIX + channelNo + ":booth:" + boothId;
    }
}
