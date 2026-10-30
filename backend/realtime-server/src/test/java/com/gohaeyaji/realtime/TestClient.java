package com.gohaeyaji.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Minimal protocol client for tests. Every received message is kept, and await() searches the
 * whole history, so a message that arrived while waiting for another one is never lost.
 */
final class TestClient implements AutoCloseable {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final List<JsonNode> received = new CopyOnWriteArrayList<>();
    private final WebSocketSession session;
    private volatile CloseStatus closeStatus;

    private TestClient(WebSocketSession session) {
        this.session = session;
    }

    static TestClient connect(int port) throws Exception {
        WebSocketHttpHeaders headers = new WebSocketHttpHeaders();
        headers.setOrigin("http://localhost:5173");
        Holder holder = new Holder();
        WebSocketSession session = new StandardWebSocketClient()
                .execute(holder, headers, URI.create("ws://localhost:" + port + "/ws"))
                .get(5, TimeUnit.SECONDS);
        TestClient client = new TestClient(session);
        client.received.addAll(holder.early);
        holder.early.clear();
        holder.client = client;
        return client;
    }

    void send(String json) throws Exception {
        synchronized (session) {
            session.sendMessage(new TextMessage(json));
        }
    }

    JsonNode hello() throws Exception {
        send("{\"type\":\"hello\",\"v\":1}");
        return await("welcome");
    }

    JsonNode await(String type) throws InterruptedException {
        return await(type, m -> true);
    }

    /** Waits up to 5 s until a message of this type matching the predicate has been received. */
    JsonNode await(String type, Predicate<JsonNode> match) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline) {
            for (JsonNode m : received) {
                if (type.equals(m.path("type").asText()) && match.test(m)) {
                    return m;
                }
            }
            Thread.sleep(20);
        }
        throw new AssertionError("no '" + type + "' message within 5 s, received: " + received);
    }

    /** Every message of this type received so far. */
    List<JsonNode> all(String type) {
        return received.stream().filter(m -> type.equals(m.path("type").asText())).toList();
    }

    CloseStatus awaitClose() throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(5).toNanos();
        while (System.nanoTime() < deadline && closeStatus == null) {
            Thread.sleep(50);
        }
        return closeStatus;
    }

    @Override
    public void close() throws Exception {
        if (session.isOpen()) {
            session.close();
        }
    }

    private static final class Holder extends TextWebSocketHandler {
        volatile TestClient client;
        private final List<JsonNode> early = new CopyOnWriteArrayList<>();

        @Override
        protected void handleTextMessage(WebSocketSession s, TextMessage message) throws Exception {
            JsonNode m = MAPPER.readTree(message.getPayload());
            TestClient c = client;
            if (c == null) {
                early.add(m);
            } else {
                if (!early.isEmpty()) {
                    c.received.addAll(early);
                    early.clear();
                }
                c.received.add(m);
            }
        }

        @Override
        public void afterConnectionClosed(WebSocketSession s, CloseStatus status) {
            if (client != null) {
                client.closeStatus = status;
            }
        }
    }
}
