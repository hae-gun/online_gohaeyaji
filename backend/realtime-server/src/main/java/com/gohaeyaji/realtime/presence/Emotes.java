package com.gohaeyaji.realtime.presence;

import java.util.Map;

/**
 * Emotes (protocol section 16) and how long each one plays, in ms.
 * Must match EMOTES in frontend/src/world/emotes.js. A new emote is only accepted once the
 * previous one has finished, so nobody can spam the channel with gestures.
 *
 * "sit" (sitting on a bench or a pew) has no fixed end: it lasts until the person walks away, and
 * gestures can be played while seated. Its value is only its own gate (sitting down once a second).
 * The server remembers who sits, so people joining later see them seated (welcome.sitting).
 */
public final class Emotes {

    public static final Map<String, Long> DURATION_MS = Map.of(
            "pray", 4_000L,
            "cross", 4_600L,
            "hooray", 3_600L,
            "doze", 5_000L,
            "praise", 4_800L,
            "sit", 1_000L);

    /** Sitting: a state rather than a gesture. Its own gate, so a gesture can start right after sitting down. */
    public static final String SIT = "sit";

    /** Network jitter allowance: a client finishing slightly early is not cheating. */
    public static final long SLACK_MS = 300;

    private Emotes() {
    }
}
