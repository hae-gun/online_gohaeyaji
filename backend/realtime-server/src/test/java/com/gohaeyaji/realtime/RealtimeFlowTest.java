package com.gohaeyaji.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import com.gohaeyaji.realtime.session.SessionRegistry;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.data.redis.core.RedisCallback;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * End-to-end over real WebSockets and a real Redis (Docker required).
 * Covers the guarantees that matter most: only one person gets a booth, and everyone sees the LED change.
 */
// every test client connects from 127.0.0.1, so lift the per-IP limit (20) for the 49-client test
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"gohaeyaji.max-connections-per-ip=500",
                // a fake blocked word list, so the real (private) one is never needed for tests
                "gohaeyaji.blocked-words-file=src/test/resources/blocked-test.json"})
@Testcontainers
class RealtimeFlowTest {

    @Container
    @ServiceConnection(name = "redis")
    static GenericContainer<?> redis = new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    @LocalServerPort
    int port;

    @Autowired
    StringRedisTemplate redisTemplate;

    @Autowired
    SessionRegistry registry;

    @BeforeEach
    void cleanState() throws InterruptedException {
        // wait until the previous test's sockets are fully cleaned up on the server,
        // otherwise their late "leave channel" calls would change this test's member counts
        long deadline = System.currentTimeMillis() + 5_000;
        while (registry.size() > 0 && System.currentTimeMillis() < deadline) {
            Thread.sleep(20);
        }
        redisTemplate.execute((RedisCallback<Void>) connection -> {
            connection.serverCommands().flushAll();
            return null;
        });
    }

    @Test
    void helloAssignsChannelOneWithAllBoothsFree() throws Exception {
        try (TestClient c = TestClient.connect(port)) {
            JsonNode welcome = c.hello();
            assertThat(welcome.path("channelNo").asInt()).isEqualTo(1);
            assertThat(welcome.path("boothCount").asInt()).isEqualTo(20);
            assertThat(welcome.path("booths").path("occupied")).isEmpty();
            assertThat(welcome.path("sessionId").asText()).startsWith("s_");
            assertThat(welcome.path("idle").path("limitMs").asLong()).isEqualTo(90_000);
        }
    }

    @Test
    void messagesBeforeHelloAreRejected() throws Exception {
        try (TestClient c = TestClient.connect(port)) {
            c.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":0}");
            assertThat(c.await("error").path("code").asText()).isEqualTo("NOT_READY");
        }
    }

    @Test
    void wrongProtocolVersionClosesWith4001() throws Exception {
        try (TestClient c = TestClient.connect(port)) {
            c.send("{\"type\":\"hello\",\"v\":999}");
            assertThat(c.awaitClose().getCode()).isEqualTo(4001);
        }
    }

    @Test
    void simultaneousClaimsOnOneBoothHaveExactlyOneWinner() throws Exception {
        int players = 10;
        List<TestClient> clients = new ArrayList<>();
        try {
            for (int i = 0; i < players; i++) {
                TestClient c = TestClient.connect(port);
                c.hello();
                clients.add(c);
            }

            CountDownLatch go = new CountDownLatch(1);
            ExecutorService pool = Executors.newFixedThreadPool(players);
            List<Future<JsonNode>> results = new ArrayList<>();
            for (TestClient c : clients) {
                results.add(pool.submit(() -> {
                    go.await();
                    c.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":3}");
                    return c.await("claimResult");
                }));
            }
            go.countDown();

            int winners = 0;
            for (Future<JsonNode> f : results) {
                JsonNode r = f.get();
                if (r.path("ok").asBoolean()) {
                    winners++;
                } else {
                    assertThat(r.path("reason").asText()).isEqualTo("OCCUPIED");
                }
            }
            pool.shutdown();
            assertThat(winners).isEqualTo(1);

            // everyone in the channel sees booth 3 turn occupied
            for (TestClient c : clients) {
                c.await("booth", m -> m.path("boothId").asInt() == 3 && "occupied".equals(m.path("state").asText()));
            }
        } finally {
            for (TestClient c : clients) {
                c.close();
            }
        }
    }

    @Test
    void releaseFreesTheBoothForEveryone() throws Exception {
        try (TestClient owner = TestClient.connect(port); TestClient other = TestClient.connect(port)) {
            owner.hello();
            other.hello();
            owner.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":5}");
            assertThat(owner.await("claimResult").path("ok").asBoolean()).isTrue();

            owner.send("{\"type\":\"release\",\"reqId\":\"r2\",\"boothId\":5}");
            assertThat(owner.await("released").path("reason").asText()).isEqualTo("USER");
            other.await("booth", m -> m.path("boothId").asInt() == 5 && "free".equals(m.path("state").asText()));

            other.send("{\"type\":\"claim\",\"reqId\":\"r3\",\"boothId\":5}");
            assertThat(other.await("claimResult").path("ok").asBoolean()).isTrue();
        }
    }

    @Test
    void disconnectingOwnerFreesTheBooth() throws Exception {
        try (TestClient other = TestClient.connect(port)) {
            other.hello();
            TestClient owner = TestClient.connect(port);
            owner.hello();
            owner.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":7}");
            assertThat(owner.await("claimResult").path("ok").asBoolean()).isTrue();

            owner.close(); // closing the tab
            other.await("booth", m -> m.path("boothId").asInt() == 7 && "free".equals(m.path("state").asText()));
        }
    }

    @Test
    void oneSessionHoldsOnlyOneBooth() throws Exception {
        try (TestClient c = TestClient.connect(port)) {
            c.hello();
            c.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":1}");
            assertThat(c.await("claimResult").path("ok").asBoolean()).isTrue();
            c.send("{\"type\":\"claim\",\"reqId\":\"r2\",\"boothId\":2}");
            JsonNode second = c.await("claimResult", m -> "r2".equals(m.path("reqId").asText()));
            assertThat(second.path("ok").asBoolean()).isFalse();
            assertThat(second.path("reason").asText()).isEqualTo("ALREADY_IN_BOOTH");
        }
    }

    @Test
    void newChannelOpensAtEightyPercent() throws Exception {
        List<TestClient> clients = new ArrayList<>();
        try {
            for (int i = 0; i < 48; i++) {
                TestClient c = TestClient.connect(port);
                assertThat(c.hello().path("channelNo").asInt()).isEqualTo(1);
                clients.add(c);
            }
            TestClient next = TestClient.connect(port);
            clients.add(next);
            assertThat(next.hello().path("channelNo").asInt()).isEqualTo(2);
        } finally {
            for (TestClient c : clients) {
                c.close();
            }
        }
    }

    @Test
    void pingIsAnsweredWithPong() throws Exception {
        try (TestClient c = TestClient.connect(port)) {
            c.hello();
            c.send("{\"type\":\"ping\",\"t\":12345}");
            assertThat(c.await("pong").path("t").asLong()).isEqualTo(12345);
        }
    }

    // ------------------------------------------------------------ presence (protocol v0.3)

    @Test
    void movesReachOthersInABatch() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"move\",\"x\":1.234,\"z\":20.5,\"ry\":3.14}");
            JsonNode p = b.await("presence", m -> containsPid(m.path("moved"), pidA));
            JsonNode entry = findPid(p.path("moved"), pidA);
            assertThat(entry.get(1).asDouble()).isEqualTo(1.23);   // rounded to 2 decimals
            assertThat(entry.get(2).asDouble()).isEqualTo(20.5);
        }
    }

    @Test
    void fastMovesAreThrottledAndBatched() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            // 20 moves in ~1 s: the server keeps at most one per 150 ms and sends one batch per 200 ms
            for (int i = 0; i < 20; i++) {
                a.send("{\"type\":\"move\",\"x\":0,\"z\":" + (30 - i * 0.1) + ",\"ry\":0}");
                Thread.sleep(50);
            }
            Thread.sleep(500);
            long batchesWithA = b.all("presence").stream().filter(m -> containsPid(m.path("moved"), pidA)).count();
            assertThat(batchesWithA).isBetween(1L, 8L);
        }
    }

    @Test
    void welcomeListsPlayersAlreadyWalking() throws Exception {
        try (TestClient a = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            a.send("{\"type\":\"move\",\"x\":-1,\"z\":12,\"ry\":0}");
            Thread.sleep(300);
            try (TestClient b = TestClient.connect(port)) {
                JsonNode welcome = b.hello();
                assertThat(containsPid(welcome.path("players"), pidA)).isTrue();
                assertThat(welcome.path("you").path("pid").asInt()).isNotEqualTo(pidA);
            }
        }
    }

    @Test
    void notVisibleBeforeFirstMove() throws Exception {
        try (TestClient a = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            try (TestClient b = TestClient.connect(port)) {
                assertThat(containsPid(b.hello().path("players"), pidA)).isFalse();
            }
        }
    }

    @Test
    void leavingIsAnnounced() throws Exception {
        try (TestClient b = TestClient.connect(port)) {
            b.hello();
            TestClient a = TestClient.connect(port);
            int pidA = a.hello().path("you").path("pid").asInt();
            a.send("{\"type\":\"move\",\"x\":0,\"z\":25,\"ry\":0}");
            b.await("presence", m -> containsPid(m.path("moved"), pidA));
            a.close();
            b.await("presence", m -> {
                for (JsonNode left : m.path("left")) {
                    if (left.asInt() == pidA) {
                        return true;
                    }
                }
                return false;
            });
        }
    }

    @Test
    void boothEventCarriesWhoEntered() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":4}");
            JsonNode event = b.await("booth", m -> m.path("boothId").asInt() == 4 && "occupied".equals(m.path("state").asText()));
            assertThat(event.path("pid").asInt()).isEqualTo(pidA);
        }
    }

    // ------------------------------------------------------------ names (protocol v0.4)

    @Test
    void everyoneGetsARandomBaptismalName() throws Exception {
        try (TestClient a = TestClient.connect(port)) {
            JsonNode you = a.hello().path("you");
            assertThat(you.path("name").asText()).isNotBlank();
            try (TestClient b = TestClient.connect(port)) {
                JsonNode names = b.hello().path("names");
                assertThat(nameOf(names, you.path("pid").asInt())).isEqualTo(you.path("name").asText());
            }
        }
    }

    @Test
    void helloKeepsARememberedNameAndReplacesABadOne() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            a.send("{\"type\":\"hello\",\"v\":1,\"name\":\"  성실한   토마스 \"}");
            assertThat(a.await("welcome").path("you").path("name").asText()).isEqualTo("성실한 토마스");
            b.send("{\"type\":\"hello\",\"v\":1,\"name\":\"진 신부님\"}");
            String given = b.await("welcome").path("you").path("name").asText();
            assertThat(given).isNotBlank().doesNotContain("신부");
        }
    }

    @Test
    void renameReachesTheChannel() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"rename\",\"reqId\":\"n1\",\"name\":\"새벽기도 요한\"}");
            JsonNode r = a.await("renameResult");
            assertThat(r.path("ok").asBoolean()).isTrue();
            assertThat(r.path("name").asText()).isEqualTo("새벽기도 요한");
            b.await("presence", m -> "새벽기도 요한".equals(nameOf(m.path("named"), pidA)));
        }
    }

    @Test
    void badNamesAreRefusedWithAReason() throws Exception {
        try (TestClient a = TestClient.connect(port)) {
            a.hello();
            assertThat(rename(a, "r1", "ㅋㅋㅋ")).isEqualTo("INVALID");
            assertThat(rename(a, "r2", "가")).isEqualTo("INVALID");
            assertThat(rename(a, "r3", "엄 신 부")).isEqualTo("RESERVED");     // spaces do not hide it
            assertThat(rename(a, "r4", "나 쁜 말쟁이")).isEqualTo("BLOCKED");
            assertThat(rename(a, "r5", "BadWord")).isEqualTo("BLOCKED");
            assertThat(rename(a, "r6", "아녜스")).isEqualTo("OK");
            assertThat(rename(a, "r7", "루치아")).isEqualTo("TOO_SOON");      // 10 s between changes
        }
    }

    // ------------------------------------------------------------ hand-drawn faces (protocol v0.5)

    private static final String SMILE = "0".repeat(80) + "0010000000010000" + "0".repeat(48) + "0001111111100000" + "0".repeat(96);

    @Test
    void drawnFaceReachesTheChannelAndNewcomers() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"setFace\",\"reqId\":\"f1\",\"face\":\"" + SMILE + "\"}");
            assertThat(a.await("faceResult").path("ok").asBoolean()).isTrue();
            b.await("presence", m -> SMILE.equals(pairValue(m.path("faced"), pidA)));
            try (TestClient c = TestClient.connect(port)) {
                assertThat(pairValue(c.hello().path("faces"), pidA)).isEqualTo(SMILE);
            }
        }
    }

    @Test
    void helloCarriesARememberedFace() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            a.send("{\"type\":\"hello\",\"v\":1,\"face\":\"" + SMILE + "\"}");
            int pidA = a.await("welcome").path("you").path("pid").asInt();
            assertThat(pairValue(b.hello().path("faces"), pidA)).isEqualTo(SMILE);
        }
    }

    @Test
    void badFacesAreRefusedAndErasingGoesBackToDefault() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"setFace\",\"reqId\":\"f1\",\"face\":\"" + "5".repeat(256) + "\"}");   // colour 5 does not exist
            assertThat(a.await("faceResult", m -> "f1".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"setFace\",\"reqId\":\"f2\",\"face\":\"0123\"}");                    // wrong size
            assertThat(a.await("faceResult", m -> "f2".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"setFace\",\"reqId\":\"f3\",\"face\":null}");                           // back to default
            assertThat(a.await("faceResult", m -> "f3".equals(m.path("reqId").asText())).path("ok").asBoolean()).isTrue();
            b.await("presence", m -> "".equals(pairValue(m.path("faced"), pidA)));
            a.send("{\"type\":\"setFace\",\"reqId\":\"f4\",\"face\":\"" + SMILE + "\"}");             // within 5 s
            assertThat(a.await("faceResult", m -> "f4".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("TOO_SOON");
        }
    }

    private static String pairValue(JsonNode pairs, int pid) {
        for (JsonNode pair : pairs) {
            if (pair.get(0).asInt() == pid) {
                return pair.get(1).asText();
            }
        }
        return null;
    }

    private static String rename(TestClient c, String reqId, String name) throws Exception {
        c.send("{\"type\":\"rename\",\"reqId\":\"" + reqId + "\",\"name\":\"" + name + "\"}");
        JsonNode r = c.await("renameResult", m -> reqId.equals(m.path("reqId").asText()));
        return r.path("ok").asBoolean() ? "OK" : r.path("reason").asText();
    }

    private static String nameOf(JsonNode pairs, int pid) {
        for (JsonNode pair : pairs) {
            if (pair.get(0).asInt() == pid) {
                return pair.get(1).asText();
            }
        }
        return null;
    }

    private static boolean containsPid(JsonNode rows, int pid) {
        return findPid(rows, pid) != null;
    }

    private static JsonNode findPid(JsonNode rows, int pid) {
        for (JsonNode row : rows) {
            if (row.get(0).asInt() == pid) {
                return row;
            }
        }
        return null;
    }
}
