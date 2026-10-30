package com.gohaeyaji.realtime.protocol;

import org.springframework.web.socket.CloseStatus;

/** WebSocket close codes from docs/realtime-protocol.md section 9. */
public final class CloseCodes {

    public static final CloseStatus VERSION_MISMATCH = new CloseStatus(4001, "VERSION_MISMATCH");
    public static final CloseStatus HEARTBEAT_TIMEOUT = new CloseStatus(4002, "HEARTBEAT_TIMEOUT");
    public static final CloseStatus TOO_MANY_CONNECTIONS = new CloseStatus(4004, "TOO_MANY_CONNECTIONS");
    public static final CloseStatus MESSAGE_TOO_LARGE = new CloseStatus(4005, "MESSAGE_TOO_LARGE");

    private CloseCodes() {
    }
}
