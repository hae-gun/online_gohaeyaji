package com.gohaeyaji.realtime.presence;

import java.util.Map;

/**
 * Emotes (protocol section 16) and how long each one plays, in ms.
 * Must match EMOTES in frontend/src/world/emotes.js. A new emote is only accepted once the
 * previous one has finished, so nobody can spam the channel with gestures.
 */
public final class Emotes {

    public static final Map<String, Long> DURATION_MS = Map.of(
            "pray", 4_000L,
            "cross", 4_600L,
            "hooray", 3_600L,
            "doze", 5_000L);

    /** Network jitter allowance: a client finishing slightly early is not cheating. */
    public static final long SLACK_MS = 300;

    private Emotes() {
    }
}
