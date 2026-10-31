package com.gohaeyaji.realtime.presence;

import com.gohaeyaji.realtime.protocol.Messages.Presence;
import com.gohaeyaji.realtime.ws.MessageSender;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Batching: instead of forwarding every move to everyone at once
 * (60 players x 5 moves/s x 59 receivers = 17,700 messages/s per channel),
 * send one message per channel per tick with everyone who moved (300 messages/s).
 */
@Component
public class PresenceBroadcaster {

    private final PresenceService presence;
    private final MessageSender sender;
    private final Counter batches;
    private final Counter entries;

    public PresenceBroadcaster(PresenceService presence, MessageSender sender, MeterRegistry meters) {
        this.presence = presence;
        this.sender = sender;
        this.batches = Counter.builder("gohaeyaji.presence.batches")
                .description("presence messages broadcast (one per channel per tick with changes)")
                .register(meters);
        this.entries = Counter.builder("gohaeyaji.presence.entries")
                .description("player positions carried inside those batches")
                .register(meters);
    }

    @Scheduled(fixedRateString = "${gohaeyaji.presence-ms}")
    public void tick() {
        long now = System.currentTimeMillis();
        presence.drainAll((channelNo, batch) -> {
            sender.broadcast(channelNo, new Presence(now, batch.moved(), batch.left(), batch.named(), batch.faced(), batch.emoted()));
            batches.increment();
            entries.increment(batch.moved().size());
        });
    }
}
