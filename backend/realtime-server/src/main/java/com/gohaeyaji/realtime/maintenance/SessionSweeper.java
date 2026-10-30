package com.gohaeyaji.realtime.maintenance;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.protocol.CloseCodes;
import com.gohaeyaji.realtime.protocol.Messages;
import com.gohaeyaji.realtime.session.ClientSession;
import com.gohaeyaji.realtime.session.SessionRegistry;
import com.gohaeyaji.realtime.ws.RealtimeWebSocketHandler;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Every 2 seconds:
 *  - closes sockets that never said hello, or stopped pinging (4002)
 *  - server-side idle safety net: frees a booth after idle limit + grace (protocol section 7).
 *    The browser normally leaves on its own at exactly 90 s; this only catches frozen or modified clients.
 */
@Component
public class SessionSweeper {

    private final SessionRegistry registry;
    private final RealtimeWebSocketHandler handler;
    private final RealtimeProperties props;

    public SessionSweeper(SessionRegistry registry, RealtimeWebSocketHandler handler, RealtimeProperties props) {
        this.registry = registry;
        this.handler = handler;
        this.props = props;
    }

    @Scheduled(fixedDelay = 2_000)
    public void sweep() {
        long now = System.currentTimeMillis();
        for (ClientSession session : registry.all()) {
            if (!session.isReady()) {
                if (now - session.connectedAt() > props.helloTimeoutMs()) {
                    handler.close(session, CloseCodes.HEARTBEAT_TIMEOUT);
                }
                continue;
            }
            if (now - session.lastPingAt() > props.heartbeatTimeoutMs()) {
                handler.close(session, CloseCodes.HEARTBEAT_TIMEOUT);
                continue;
            }
            if (session.boothId() != null
                    && now - session.lastActivityAt() > props.idleLimitMs() + props.idleServerGraceMs()) {
                handler.releaseBooth(session, Messages.RELEASED_IDLE);
            }
        }
    }
}
