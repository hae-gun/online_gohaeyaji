package com.gohaeyaji.realtime.session;

import org.springframework.web.socket.WebSocketSession;

/**
 * One WebSocket connection (one browser tab = one session, protocol D8).
 *
 * The socket is wrapped in a ConcurrentWebSocketSessionDecorator, so broadcasts from other
 * threads can send safely. Booth state changes are guarded by synchronizing on this object,
 * because the client's own messages and the sweeper thread can both release a booth.
 */
public final class ClientSession {

    private final WebSocketSession socket;
    private final String remoteIp;
    private final long connectedAt;

    private volatile boolean ready;
    private volatile String sessionId;
    private volatile int channelNo;
    private volatile Integer boothId;
    private volatile int pid;
    private volatile long lastMoveAt;
    private volatile long lastRenameAt;
    private volatile long lastFaceAt;
    private volatile long emoteUntil;
    private volatile String face;
    private volatile long faceBlockedUntil;
    private final java.util.Set<String> reported = java.util.concurrent.ConcurrentHashMap.newKeySet();
    private final java.util.ArrayDeque<Long> reportTimes = new java.util.ArrayDeque<>();
    private volatile String name;
    private volatile long lastPingAt;
    private volatile long lastActivityAt;

    public ClientSession(WebSocketSession socket, String remoteIp, long now) {
        this.socket = socket;
        this.remoteIp = remoteIp;
        this.connectedAt = now;
        this.lastPingAt = now;
    }

    /** Called once, when hello succeeds. */
    public void ready(String sessionId, int channelNo, int pid, long now) {
        this.sessionId = sessionId;
        this.channelNo = channelNo;
        this.pid = pid;
        this.lastPingAt = now;
        this.ready = true;
    }

    /** The person moved to another channel (protocol section 18): new channel, new pid there. */
    public synchronized void switchChannel(int channelNo, int pid) {
        this.channelNo = channelNo;
        this.pid = pid;
    }

    private long lastSwitchAt;
    private long lastChannelListAt;

    /** One channel switch per gapMs. */
    public synchronized boolean acceptSwitch(long now, long gapMs) {
        if (lastSwitchAt != 0 && now - lastSwitchAt < gapMs) {
            return false;
        }
        lastSwitchAt = now;
        return true;
    }

    /** The channel list at most once a second; it costs a few Redis reads per channel. */
    public synchronized boolean acceptChannelList(long now) {
        if (lastChannelListAt != 0 && now - lastChannelListAt < 1_000) {
            return false;
        }
        lastChannelListAt = now;
        return true;
    }

    public void enterBooth(int boothId, long now) {
        this.boothId = boothId;
        this.lastActivityAt = now;
    }

    /** @return the booth that was held, or null */
    public Integer leaveBooth() {
        Integer held = this.boothId;
        this.boothId = null;
        return held;
    }

    public void touchPing(long now) {
        this.lastPingAt = now;
    }

    public void touchActivity(long now) {
        this.lastActivityAt = now;
    }

    /** @return true if this move is far enough from the previous accepted one (rate limit) */
    public boolean acceptMove(long now, long minGapMs) {
        if (now - lastMoveAt < minGapMs) {
            return false;
        }
        lastMoveAt = now;
        return true;
    }

    /** @return true if enough time has passed since the last accepted name change */
    public boolean acceptRename(long now, long minGapMs) {
        if (lastRenameAt != 0 && now - lastRenameAt < minGapMs) {
            return false;
        }
        lastRenameAt = now;
        return true;
    }

    /** @return true if enough time has passed since the last accepted face change */
    /** Whether the inquiry box takes another message from this person yet (protocol section 17). */
    public synchronized boolean canInquire(long now, long minGapMs) {
        return lastInquiryAt == 0 || now - lastInquiryAt >= minGapMs;
    }

    public synchronized void inquired(long now) {
        lastInquiryAt = now;
    }

    private long lastInquiryAt;
    private long lastFeedbackAt;

    /** One answer feedback per gapMs (protocol section 19). */
    public synchronized boolean acceptFeedback(long now, long gapMs) {
        if (lastFeedbackAt != 0 && now - lastFeedbackAt < gapMs) {
            return false;
        }
        lastFeedbackAt = now;
        return true;
    }

    public boolean acceptFace(long now, long minGapMs) {
        if (lastFaceAt != 0 && now - lastFaceAt < minGapMs) {
            return false;
        }
        lastFaceAt = now;
        return true;
    }

    private long lastSitAt;

    /** Sitting down at most once per gapMs; separate from gestures, which can play while seated. */
    public synchronized boolean acceptSit(long now, long gapMs) {
        if (lastSitAt != 0 && now - lastSitAt < gapMs) {
            return false;
        }
        lastSitAt = now;
        return true;
    }

    /** @return true if no emote is playing now; then this one runs until now + durationMs */
    public boolean acceptEmote(long now, long durationMs, long slackMs) {
        if (now < emoteUntil - slackMs) {
            return false;
        }
        emoteUntil = now + durationMs;
        return true;
    }

    public void face(String face) {
        this.face = face;
    }

    /** The drawing this session wears, or null for the default face. */
    public String face() {
        return face;
    }

    public void blockFace(long until) {
        this.faceBlockedUntil = until;
    }

    public boolean faceBlocked(long now) {
        return now < faceBlockedUntil;
    }

    /** @return false if this session already reported this drawing */
    public boolean firstReportOf(String faceHash) {
        return reported.add(faceHash);
    }

    /** Sliding one-minute window. @return true if another report is allowed now */
    public synchronized boolean acceptReport(long now, int perMinute) {
        while (!reportTimes.isEmpty() && now - reportTimes.peekFirst() > 60_000) {
            reportTimes.pollFirst();
        }
        if (reportTimes.size() >= perMinute) {
            return false;
        }
        reportTimes.addLast(now);
        return true;
    }

    public void name(String name) {
        this.name = name;
    }

    public String name() {
        return name;
    }

    public int pid() {
        return pid;
    }

    public WebSocketSession socket() {
        return socket;
    }

    public String id() {
        return socket.getId();
    }

    public String remoteIp() {
        return remoteIp;
    }

    public long connectedAt() {
        return connectedAt;
    }

    public boolean isReady() {
        return ready;
    }

    public boolean isOpen() {
        return socket.isOpen();
    }

    public String sessionId() {
        return sessionId;
    }

    public int channelNo() {
        return channelNo;
    }

    public Integer boothId() {
        return boothId;
    }

    public long lastPingAt() {
        return lastPingAt;
    }

    public long lastActivityAt() {
        return lastActivityAt;
    }
}
