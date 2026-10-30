package com.gohaeyaji.realtime.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Policy values from docs/realtime-protocol.md. Bound from the {@code gohaeyaji.*} keys in application.yml.
 */
@ConfigurationProperties("gohaeyaji")
public record RealtimeProperties(
        int protocolVersion,
        int boothCount,
        int channelCapacity,
        int channelSoftLimit,
        long heartbeatMs,
        long heartbeatTimeoutMs,
        long helloTimeoutMs,
        long leaseMs,
        long idleLimitMs,
        long idleServerGraceMs,
        long idleWarnMs,
        long idleDangerMs,
        int maxMessageBytes,
        int maxConnectionsPerIp,
        long presenceMs,
        long moveMinGapMs,
        List<String> allowedOrigins
) {
}
