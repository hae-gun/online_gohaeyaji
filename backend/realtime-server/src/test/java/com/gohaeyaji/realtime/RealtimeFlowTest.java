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
                "gohaeyaji.blocked-words-file=src/test/resources/blocked-test.json",
                "gohaeyaji.admin-password=test-secret"})
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

    @Autowired
    com.gohaeyaji.realtime.channel.ChannelService channelService;

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
            assertThat(welcome.path("boothCount").asInt()).isEqualTo(21);
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

    // ------------------------------------------------------------ channels (protocol v0.10)

    @Test
    void peopleCanSwitchToAnotherOpenChannel() throws Exception {
        // channel 2 exists (opened earlier, now quiet); channel 9 does not
        redisTemplate.opsForZSet().add("gy:channels", "1", 1);
        redisTemplate.opsForZSet().add("gy:channels", "2", 2);
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port); TestClient c = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            c.hello();
            a.send("{\"type\":\"move\",\"x\":1,\"z\":5,\"ry\":0}");
            b.await("presence", m -> containsPid(m.path("moved"), pidA));

            a.send("{\"type\":\"channels\",\"reqId\":\"l1\"}");
            JsonNode list = a.await("channelList");
            assertThat(list.path("current").asInt()).isEqualTo(1);
            assertThat(list.path("capacity").asInt()).isEqualTo(60);
            assertThat(list.path("channels").toString()).contains("\"no\":2");

            a.send("{\"type\":\"switchChannel\",\"reqId\":\"s0\",\"channelNo\":9}");
            assertThat(a.await("switchResult", m -> "s0".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("NO_CHANNEL");
            a.send("{\"type\":\"switchChannel\",\"reqId\":\"s1\",\"channelNo\":2}");
            assertThat(a.await("switchResult", m -> "s1".equals(m.path("reqId").asText())).path("ok").asBoolean()).isTrue();
            JsonNode welcome = a.await("welcome", m -> m.path("channelNo").asInt() == 2);
            String name = welcome.path("you").path("name").asText();
            assertThat(name).isNotEmpty();                                           // same name in the new channel
            b.await("presence", m -> m.path("left").toString().contains(String.valueOf(pidA)));   // gone from channel 1
            assertThat(channelService.members(1)).isEqualTo(2);
            assertThat(channelService.members(2)).isEqualTo(1);

            // c follows a into channel 2 and sees them there
            c.send("{\"type\":\"switchChannel\",\"reqId\":\"s2\",\"channelNo\":2}");
            c.await("switchResult");
            int pidA2 = welcome.path("you").path("pid").asInt();
            a.send("{\"type\":\"move\",\"x\":2,\"z\":5,\"ry\":0}");
            c.await("presence", m -> m.path("ch").asInt() == 2 && containsPid(m.path("moved"), pidA2));

            a.send("{\"type\":\"switchChannel\",\"reqId\":\"s3\",\"channelNo\":1}");             // within 3 s
            assertThat(a.await("switchResult", m -> "s3".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("TOO_SOON");
        }
    }

    @Test
    void aFullChannelCannotBeJoinedBySwitching() throws Exception {
        redisTemplate.opsForZSet().add("gy:channels", "1", 1);
        redisTemplate.opsForZSet().add("gy:channels", "2", 2);
        redisTemplate.opsForZSet().add("gy:servers", "srv-other", System.currentTimeMillis() + 60_000);
        redisTemplate.opsForHash().put("gy:ch:2:members", "srv-other", "60");
        try (TestClient a = TestClient.connect(port)) {
            a.hello();
            a.send("{\"type\":\"switchChannel\",\"reqId\":\"s1\",\"channelNo\":2}");
            assertThat(a.await("switchResult").path("reason").asText()).isEqualTo("FULL");
        }
    }

    @Test
    void channelsLeftEmptyAreClosedAndTheirNumbersReused() throws Exception {
        redisTemplate.opsForZSet().add("gy:channels", "1", 1);
        redisTemplate.opsForZSet().add("gy:channels", "2", 2);
        redisTemplate.opsForZSet().add("gy:channels", "3", 3);
        // channel 2 empty for 10 minutes, channel 3 empty just now
        redisTemplate.opsForValue().set("gy:ch:2:emptySince", String.valueOf(System.currentTimeMillis() - 600_000));
        channelService.heartbeat();
        assertThat(redisTemplate.opsForZSet().range("gy:channels", 0, -1)).containsExactly("1", "3");
        assertThat(redisTemplate.hasKey("gy:ch:3:emptySince")).isTrue();
        // channel 1 is never closed, even empty
        redisTemplate.opsForValue().set("gy:ch:1:emptySince", "0");
        channelService.heartbeat();
        assertThat(redisTemplate.opsForZSet().range("gy:channels", 0, -1)).contains("1");
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

    // 32x32: two eyes on row 10, a mouth on row 20
    private static final String SMILE = "0".repeat(32 * 10) + "00000000110000000000110000000000" + "0".repeat(32 * 9)
            + "00000000002222222222220000000000" + "0".repeat(32 * 11);
    private static final String FROWN = SMILE.replace('2', '1');

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
            a.send("{\"type\":\"setFace\",\"reqId\":\"f1\",\"face\":\"" + "5".repeat(1024) + "\"}");   // colour 5 does not exist
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

    @Test
    void aPickedColourTravelsWithTheDrawing() throws Exception {
        String picked = SMILE.replace('2', '5');
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"setFace\",\"reqId\":\"c1\",\"face\":\"" + picked + "\"}");          // 5 without its colour
            assertThat(a.await("faceResult", m -> "c1".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"setFace\",\"reqId\":\"c2\",\"face\":\"" + picked + ":3A7BFF\"}");
            assertThat(a.await("faceResult", m -> "c2".equals(m.path("reqId").asText())).path("ok").asBoolean()).isTrue();
            b.await("presence", m -> (picked + ":3a7bff").equals(pairValue(m.path("faced"), pidA)));   // stored in lower case
        }
    }

    @Test
    void threeReportsTakeADrawingDown() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient r1 = TestClient.connect(port);
             TestClient r2 = TestClient.connect(port); TestClient r3 = TestClient.connect(port)) {
            a.send("{\"type\":\"hello\",\"v\":1,\"face\":\"" + SMILE + "\"}");
            int pidA = a.await("welcome").path("you").path("pid").asInt();
            r1.hello();
            r2.hello();
            r3.hello();
            String report = "{\"type\":\"report\",\"reqId\":\"x\",\"pid\":" + pidA + "}";

            r1.send(report);
            assertThat(r1.await("reportResult").path("ok").asBoolean()).isTrue();
            r1.send(report.replace("\"x\"", "\"y\""));                 // the same person twice counts once
            assertThat(r1.await("reportResult", m -> "y".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("ALREADY");
            r2.send(report);
            assertThat(r2.await("reportResult").path("ok").asBoolean()).isTrue();
            assertThat(a.all("faceRemoved")).isEmpty();                     // two is not enough
            r3.send(report);
            assertThat(r3.await("reportResult").path("ok").asBoolean()).isTrue();

            assertThat(a.await("faceRemoved").path("reason").asText()).isEqualTo("REPORTED");
            r1.await("presence", m -> "".equals(pairValue(m.path("faced"), pidA)));
            // the banned drawing cannot come back, and its owner cannot draw anything for a while
            try (TestClient again = TestClient.connect(port)) {
                again.send("{\"type\":\"hello\",\"v\":1,\"face\":\"" + SMILE + "\"}");
                int pidAgain = again.await("welcome").path("you").path("pid").asInt();
                try (TestClient watcher = TestClient.connect(port)) {
                    assertThat(pairValue(watcher.hello().path("faces"), pidAgain)).isNull();
                }
            }
            a.send("{\"type\":\"setFace\",\"reqId\":\"f9\",\"face\":\"" + FROWN + "\"}");
            assertThat(a.await("faceResult").path("reason").asText()).isEqualTo("BLOCKED");
        }
    }

    @Test
    void reportsNeedSomeoneElseWearingADrawing() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            int pidB = b.hello().path("you").path("pid").asInt();
            a.send("{\"type\":\"report\",\"reqId\":\"s\",\"pid\":" + pidA + "}");
            assertThat(a.await("reportResult").path("reason").asText()).isEqualTo("SELF");
            a.send("{\"type\":\"report\",\"reqId\":\"n\",\"pid\":" + pidB + "}");   // b has the default face
            assertThat(a.await("reportResult", m -> "n".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("NO_FACE");
        }
    }

    // ------------------------------------------------------------ emotes (protocol v0.7)

    @Test
    void emotesReachTheChannelOneAtATime() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"emote\",\"id\":\"hooray\"}");
            b.await("presence", m -> "hooray".equals(pairValue(m.path("emoted"), pidA)));
            a.send("{\"type\":\"emote\",\"id\":\"pray\"}");      // hooray is still playing: dropped
            a.send("{\"type\":\"emote\",\"id\":\"dance\"}");     // not an emote: dropped
            Thread.sleep(600);
            assertThat(b.all("presence").stream().filter(m -> pairValue(m.path("emoted"), pidA) != null).count()).isEqualTo(1);
        }
    }

    @Test
    void sittingIsRememberedForNewcomersAndGesturesPlaySeated() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            // the seat comes with the sit, so a dropped move cannot put the sitter in the wrong place
            a.send("{\"type\":\"emote\",\"id\":\"sit\",\"x\":3.95,\"z\":1.48,\"ry\":3.14}");
            JsonNode batch = b.await("presence", m -> "sit".equals(pairValue(m.path("emoted"), pidA)));
            assertThat(containsPid(batch.path("moved"), pidA)).isTrue();
            a.send("{\"type\":\"emote\",\"id\":\"pray\"}");                // right away: sitting has its own gate
            b.await("presence", m -> "pray".equals(pairValue(m.path("emoted"), pidA)));
            try (TestClient c = TestClient.connect(port)) {
                JsonNode welcome = c.hello();
                assertThat(welcome.path("sitting").toString()).contains(String.valueOf(pidA));
            }
            a.send("{\"type\":\"move\",\"x\":3.95,\"z\":1.48,\"ry\":0.5}");   // turning on the seat
            Thread.sleep(400);
            try (TestClient c = TestClient.connect(port)) {
                assertThat(c.hello().path("sitting").toString()).contains(String.valueOf(pidA));
            }
            a.send("{\"type\":\"move\",\"x\":5.2,\"z\":1.48,\"ry\":0.5}");    // walking away
            Thread.sleep(400);
            try (TestClient c = TestClient.connect(port)) {
                assertThat(c.hello().path("sitting")).isEmpty();
            }
        }
    }

    @Test
    void noEmotesFromInsideABooth() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient b = TestClient.connect(port)) {
            int pidA = a.hello().path("you").path("pid").asInt();
            b.hello();
            a.send("{\"type\":\"claim\",\"reqId\":\"r1\",\"boothId\":2}");
            a.await("claimResult");
            a.send("{\"type\":\"emote\",\"id\":\"pray\"}");
            Thread.sleep(500);
            assertThat(b.all("presence").stream().filter(m -> pairValue(m.path("emoted"), pidA) != null).count()).isZero();
        }
    }

    // ------------------------------------------------------------ admin page

    private java.net.http.HttpResponse<String> admin(String method, String path, String password, boolean xAdmin) throws Exception {
        var b = java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://localhost:" + port + path));
        if (password != null) {
            b.header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString(("admin:" + password).getBytes()));
        }
        if (xAdmin) {
            b.header("X-Admin", "1");
        }
        b.header("Content-Type", "application/json");
        b.method(method, "POST".equals(method) ? java.net.http.HttpRequest.BodyPublishers.ofString("{\"permanent\":true}") : java.net.http.HttpRequest.BodyPublishers.noBody());
        return java.net.http.HttpClient.newHttpClient().send(b.build(), java.net.http.HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void adminPageNeedsTheRightPassword() throws Exception {
        assertThat(admin("GET", "/admin/api/overview", null, false).statusCode()).isEqualTo(401);
        assertThat(admin("GET", "/admin/api/overview", "wrong", false).statusCode()).isEqualTo(401);
        var ok = admin("GET", "/admin/api/overview", "test-secret", false);
        assertThat(ok.statusCode()).isEqualTo(200);
        assertThat(ok.body()).contains("channels");
        assertThat(admin("GET", "/admin/", "test-secret", false).statusCode()).isEqualTo(200);
    }

    @Test
    void adminSeesReportedDrawingsAndCanRestoreOrBanForGood() throws Exception {
        try (TestClient a = TestClient.connect(port); TestClient r1 = TestClient.connect(port);
             TestClient r2 = TestClient.connect(port); TestClient r3 = TestClient.connect(port)) {
            a.send("{\"type\":\"hello\",\"v\":1,\"face\":\"" + SMILE + "\"}");
            int pidA = a.await("welcome").path("you").path("pid").asInt();
            for (TestClient r : List.of(r1, r2, r3)) {
                r.hello();
                r.send("{\"type\":\"report\",\"reqId\":\"x\",\"pid\":" + pidA + "}");
                r.await("reportResult");
            }
            a.await("faceRemoved");

            JsonNode list = new com.fasterxml.jackson.databind.ObjectMapper().readTree(admin("GET", "/admin/api/faces", "test-secret", false).body());
            assertThat(list).hasSize(1);
            JsonNode entry = list.get(0);
            assertThat(entry.path("face").asText()).isEqualTo(SMILE);
            assertThat(entry.path("reports").asLong()).isEqualTo(3);
            assertThat(entry.path("bannedBy").asText()).isEqualTo("reports");
            // every report is logged with who reported whom, and from where
            assertThat(entry.path("log")).hasSize(3);
            assertThat(entry.path("log").get(0).path("targetIp").asText()).isNotBlank();
            assertThat(entry.path("log").get(0).path("reporterIp").asText()).isNotBlank();
            assertThat(entry.path("log").get(0).path("targetName").asText()).isNotBlank();
            String hash = entry.path("hash").asText();

            // changes need the X-Admin header (CSRF)
            assertThat(admin("POST", "/admin/api/faces/" + hash + "/restore", "test-secret", false).statusCode()).isEqualTo(403);
            assertThat(admin("POST", "/admin/api/faces/" + hash + "/restore", "test-secret", true).statusCode()).isEqualTo(200);

            // given back: it can be worn again
            try (TestClient again = TestClient.connect(port)) {
                again.hello();
                again.send("{\"type\":\"setFace\",\"reqId\":\"f\",\"face\":\"" + SMILE + "\"}");
                assertThat(again.await("faceResult").path("ok").asBoolean()).isTrue();

                // banned for good: whoever wears it loses it at once, and it never expires
                var res = admin("POST", "/admin/api/faces/" + hash + "/ban", "test-secret", true);
                assertThat(res.statusCode()).isEqualTo(200);
                again.await("faceRemoved");
                JsonNode after = new com.fasterxml.jackson.databind.ObjectMapper().readTree(res.body()).path("entry");
                assertThat(after.path("banTtlMs").asLong()).isEqualTo(-1);
                assertThat(after.path("bannedBy").asText()).isEqualTo("admin-permanent");
            }

            // deleting removes the drawing and its log from the admin page, the ban stays
            assertThat(admin("POST", "/admin/api/faces/" + hash + "/delete", "test-secret", true).statusCode()).isEqualTo(200);
            assertThat(admin("GET", "/admin/api/faces", "test-secret", false).body()).isEqualTo("[]");
            assertThat(redisTemplate.hasKey("gy:face:" + hash + ":log")).isFalse();
            try (TestClient later = TestClient.connect(port)) {
                later.hello();
                later.send("{\"type\":\"setFace\",\"reqId\":\"g\",\"face\":\"" + SMILE + "\"}");
                assertThat(later.await("faceResult").path("reason").asText()).isEqualTo("BLOCKED");
            }
        }
    }

    // ------------------------------------------------------------ inquiry box (protocol v0.8)

    @Test
    void inquiriesReachTheAdminPageOnePerMinute() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        try (TestClient a = TestClient.connect(port)) {
            a.hello();
            a.send("{\"type\":\"inquiry\",\"reqId\":\"q0\",\"kind\":\"question\",\"text\":\"hi\"}");      // too short
            assertThat(a.await("inquiryResult", m -> "q0".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"inquiry\",\"reqId\":\"q1\",\"kind\":\"spam\",\"text\":\"hello there\"}"); // unknown kind
            assertThat(a.await("inquiryResult", m -> "q1".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"inquiry\",\"reqId\":\"q2\",\"kind\":\"bug\",\"text\":\"  the door\\u0007 sticks\\n\\n\\n\\nplease  \"}");
            assertThat(a.await("inquiryResult", m -> "q2".equals(m.path("reqId").asText())).path("ok").asBoolean()).isTrue();
            a.send("{\"type\":\"inquiry\",\"reqId\":\"q3\",\"kind\":\"idea\",\"text\":\"one more thing\"}");
            assertThat(a.await("inquiryResult", m -> "q3".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("TOO_SOON");
        }
        JsonNode list = json.readTree(admin("GET", "/admin/api/inquiries", "test-secret", false).body());
        assertThat(list).hasSize(1);
        JsonNode e = list.get(0);
        assertThat(e.path("text").asText()).isEqualTo("the door sticks\n\nplease");
        assertThat(e.path("kind").asText()).isEqualTo("bug");
        assertThat(e.has("ip")).isFalse();                                   // the IP is never kept with a message
        assertThat(e.path("done").asBoolean()).isFalse();
        long id = e.path("id").asLong();
        assertThat(json.readTree(admin("GET", "/admin/api/overview", "test-secret", false).body()).path("inquiriesOpen").asLong()).isEqualTo(1);

        assertThat(admin("POST", "/admin/api/inquiries/" + id + "/done", "test-secret", false).statusCode()).isEqualTo(403);   // CSRF
        assertThat(admin("POST", "/admin/api/inquiries/" + id + "/done", "test-secret", true).statusCode()).isEqualTo(200);
        assertThat(json.readTree(admin("GET", "/admin/api/overview", "test-secret", false).body()).path("inquiriesOpen").asLong()).isZero();
        assertThat(admin("POST", "/admin/api/inquiries/" + id + "/delete", "test-secret", true).statusCode()).isEqualTo(200);
        assertThat(admin("GET", "/admin/api/inquiries", "test-secret", false).body()).isEqualTo("[]");
        assertThat(admin("POST", "/admin/api/inquiries/" + id + "/delete", "test-secret", true).statusCode()).isEqualTo(404);
    }

    // ------------------------------------------------------------ answer improvement box (protocol v0.11)

    @Test
    void consentedConfessionsReachTheAdminPageMaskedAndWithoutIp() throws Exception {
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        String fb = "{\"type\":\"feedback\",\"reqId\":\"%s\",\"reason\":\"wrong\",\"persona\":\"eom\",\"category\":\"generic\","
                + "\"text\":\"연락은 010-1234-5678로 주세요\",\"answer\":\"그 마음은 압니다.\"}";
        try (TestClient a = TestClient.connect(port)) {
            a.hello();
            a.send(String.format(fb, "f0"));                                        // outside a booth: no
            assertThat(a.await("feedbackResult", m -> "f0".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("INVALID");
            a.send("{\"type\":\"claim\",\"reqId\":\"c1\",\"boothId\":4}");
            a.await("claimResult");
            a.send(String.format(fb, "f1"));
            assertThat(a.await("feedbackResult", m -> "f1".equals(m.path("reqId").asText())).path("ok").asBoolean()).isTrue();
            a.send(String.format(fb, "f2"));                                        // within 10 s
            assertThat(a.await("feedbackResult", m -> "f2".equals(m.path("reqId").asText())).path("reason").asText()).isEqualTo("TOO_SOON");
        }
        JsonNode list = json.readTree(admin("GET", "/admin/api/feedback", "test-secret", false).body());
        assertThat(list).hasSize(1);
        JsonNode e = list.get(0);
        assertThat(e.path("text").asText()).isEqualTo("연락은 [전화번호]로 주세요");
        assertThat(e.path("persona").asText()).isEqualTo("eom");
        assertThat(e.path("status").asText()).isEqualTo("todo");
        assertThat(e.has("ip")).isFalse();
        long id = e.path("id").asLong();
        assertThat(redisTemplate.getExpire("gy:feedback:" + id)).isPositive();      // gone after 30 days
        assertThat(json.readTree(admin("GET", "/admin/api/overview", "test-secret", false).body()).path("feedbackTodo").asLong()).isEqualTo(1);
        assertThat(admin("POST", "/admin/api/feedback/" + id + "/mark/new", "test-secret", true).statusCode()).isEqualTo(200);
        assertThat(json.readTree(admin("GET", "/admin/api/overview", "test-secret", false).body()).path("feedbackTodo").asLong()).isZero();
        assertThat(admin("POST", "/admin/api/feedback/" + id + "/mark/bogus", "test-secret", true).statusCode()).isEqualTo(404);
        assertThat(admin("POST", "/admin/api/feedback/" + id + "/delete", "test-secret", true).statusCode()).isEqualTo(200);
        assertThat(admin("GET", "/admin/api/feedback", "test-secret", false).body()).isEqualTo("[]");
    }

    @Test
    void countsOfADeadServerDoNotFillChannels() throws Exception {
        // a server that crashed with 48 people in channel 1 and never came back
        redisTemplate.opsForZSet().add("gy:channels", "1", 1);
        redisTemplate.opsForHash().put("gy:ch:1:members", "srv-dead", "48");
        redisTemplate.opsForZSet().add("gy:servers", "srv-dead", System.currentTimeMillis() - 60_000);
        try (TestClient c = TestClient.connect(port)) {
            assertThat(c.hello().path("channelNo").asInt()).isEqualTo(1);   // not pushed to channel 2
            JsonNode overview = new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                    admin("GET", "/admin/api/overview", "test-secret", false).body());
            assertThat(overview.path("channels").get(0).path("members").asLong()).isEqualTo(1);
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
