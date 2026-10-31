package com.gohaeyaji.realtime.protocol;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * Server to client messages. Field names match docs/realtime-protocol.md exactly;
 * change the document first, then these records.
 */
public final class Messages {

    private Messages() {
    }

    public record Booths(List<Integer> occupied, List<Integer> reserved) {
    }

    public record Idle(long limitMs, long warnMs, long dangerMs) {
    }

    /** name: my display name; the one I asked for in hello, or a random baptismal name. */
    public record You(int pid, String name) {
    }

    /**
     * @param players visible players in the channel, each {@code [pid, x, z, ry, boothId or -1]}
     * @param names   display names in the channel, each {@code [pid, name]} (also for players not yet visible)
     */
    public record Welcome(String type, int v, String sessionId, String resumeToken, int channelNo,
                          int boothCount, Booths booths, int queueSize, long seq, long heartbeatMs,
                          Idle idle, You you, List<List<Number>> players, List<List<Object>> names,
                          long presenceMs, long serverTime) {
        public Welcome(int v, String sessionId, String resumeToken, int channelNo, int boothCount,
                       Booths booths, int queueSize, long seq, long heartbeatMs, Idle idle,
                       You you, List<List<Number>> players, List<List<Object>> names,
                       long presenceMs, long serverTime) {
            this("welcome", v, sessionId, resumeToken, channelNo, boothCount, booths, queueSize, seq,
                    heartbeatMs, idle, you, players, names, presenceMs, serverTime);
        }
    }

    public record Pong(String type, long t, long serverTime) {
        public Pong(long t, long serverTime) {
            this("pong", t, serverTime);
        }
    }

    /** pid: who entered (occupied). Null for "free". */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record BoothEvent(String type, int boothId, String state, long seq, Integer pid) {
        public BoothEvent(int boothId, String state, long seq, Integer pid) {
            this("booth", boothId, state, seq, pid);
        }
    }

    /**
     * One batch of position changes in a channel, sent every presenceMs.
     *
     * @param moved {@code [pid, x, z, ry]} for everyone who moved since the last batch
     * @param left  pids that left the channel
     * @param named {@code [pid, name]} for everyone who joined or changed name since the last batch;
     *              left out when empty
     */
    public record Presence(String type, long t, List<List<Number>> moved, List<Integer> left,
                           @JsonInclude(JsonInclude.Include.NON_EMPTY) List<List<Object>> named) {
        public Presence(long t, List<List<Number>> moved, List<Integer> left, List<List<Object>> named) {
            this("presence", t, moved, left, named);
        }
    }

    /** Answer to "rename". On failure name is what the server read, reason says why. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record RenameResult(String type, String reqId, boolean ok, String name, String reason) {
        public static RenameResult ok(String reqId, String name) {
            return new RenameResult("renameResult", reqId, true, name, null);
        }

        public static RenameResult fail(String reqId, String name, String reason) {
            return new RenameResult("renameResult", reqId, false, name, reason);
        }
    }

    public record Snapshot(String type, Booths booths, int queueSize, long seq) {
        public Snapshot(Booths booths, int queueSize, long seq) {
            this("snapshot", booths, queueSize, seq);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ClaimResult(String type, String reqId, int boothId, boolean ok, Long leaseMs, String reason) {
        public static ClaimResult ok(String reqId, int boothId, long leaseMs) {
            return new ClaimResult("claimResult", reqId, boothId, true, leaseMs, null);
        }

        public static ClaimResult fail(String reqId, int boothId, String reason) {
            return new ClaimResult("claimResult", reqId, boothId, false, null, reason);
        }
    }

    public record Released(String type, int boothId, String reason) {
        public Released(int boothId, String reason) {
            this("released", boothId, reason);
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ErrorMessage(String type, String reqId, String code, String message) {
        public ErrorMessage(String reqId, String code, String message) {
            this("error", reqId, code, message);
        }
    }

    /** Booth states on the wire. */
    public static final String FREE = "free";
    public static final String OCCUPIED = "occupied";

    /** claimResult reasons. */
    public static final String REASON_OCCUPIED = "OCCUPIED";
    public static final String REASON_ALREADY_IN_BOOTH = "ALREADY_IN_BOOTH";
    public static final String REASON_INVALID_BOOTH = "INVALID_BOOTH";

    /** released reasons. */
    public static final String RELEASED_USER = "USER";
    public static final String RELEASED_IDLE = "IDLE";
    public static final String RELEASED_LEASE_EXPIRED = "LEASE_EXPIRED";

    /** renameResult reasons. */
    public static final String NAME_INVALID = "INVALID";
    public static final String NAME_BLOCKED = "BLOCKED";
    public static final String NAME_RESERVED = "RESERVED";
    public static final String NAME_TOO_SOON = "TOO_SOON";

    /** error codes. */
    public static final String ERR_BAD_MESSAGE = "BAD_MESSAGE";
    public static final String ERR_NOT_READY = "NOT_READY";
    public static final String ERR_UNKNOWN_TYPE = "UNKNOWN_TYPE";
    public static final String ERR_NOT_IMPLEMENTED = "NOT_IMPLEMENTED";
}
