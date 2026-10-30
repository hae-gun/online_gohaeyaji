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
