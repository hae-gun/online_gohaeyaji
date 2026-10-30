package com.gohaeyaji.realtime.ws;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gohaeyaji.realtime.session.ClientSession;
import com.gohaeyaji.realtime.session.SessionRegistry;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;

/** Serializes outbound messages. A broadcast serializes once and sends the same frame to everyone. */
@Component
public class MessageSender {

    private static final Logger log = LoggerFactory.getLogger(MessageSender.class);

    private final ObjectMapper mapper;
    private final SessionRegistry registry;

    public MessageSender(ObjectMapper mapper, SessionRegistry registry) {
        this.mapper = mapper;
        this.registry = registry;
    }

    public void send(ClientSession session, Object message) {
        sendRaw(session, toFrame(message));
    }

    /** To every ready session in the channel on this server. */
    public void broadcast(int channelNo, Object message) {
        TextMessage frame = toFrame(message);
        for (ClientSession member : registry.channelMembers(channelNo)) {
            sendRaw(member, frame);
        }
    }

    public void close(ClientSession session, CloseStatus status) {
        try {
            session.socket().close(status);
        } catch (IOException e) {
            log.debug("close failed for {}: {}", session.id(), e.getMessage());
        }
    }

    private void sendRaw(ClientSession session, TextMessage frame) {
        if (!session.isOpen()) {
            return;
        }
        try {
            session.socket().sendMessage(frame);
        } catch (IOException | IllegalStateException e) {
            // slow or broken client; the decorator closes it when its buffer or time limit is exceeded
            log.debug("send failed for {}: {}", session.id(), e.getMessage());
        }
    }

    private TextMessage toFrame(Object message) {
        try {
            return new TextMessage(mapper.writeValueAsString(message));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("cannot serialize " + message.getClass().getSimpleName(), e);
        }
    }
}
