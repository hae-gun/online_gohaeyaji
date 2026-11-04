package com.gohaeyaji.realtime.track;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The schema keeps text out of the statistics; the file log rolls by day and forgets old days. */
class TrackSchemaTest {

    @Test
    void unknownTypesAndKeysAndTextAreDropped() {
        assertNull(TrackSchema.clean("nope", Map.of()));
        Map<String, String> p = TrackSchema.clean("confess_submit",
                Map.of("cat", "jobhunt", "persona", "yu", "kind", "answer", "caution", "1", "len", "42", "text", "비밀 고해"));
        assertFalse(p.containsKey("text"));
        assertEquals(5, p.size());
        assertTrue(TrackSchema.clean("place_enter", Map.of("place", "나 여기")).isEmpty());
        assertTrue(TrackSchema.clean("session_end", Map.of("sec", "999999")).isEmpty());
        assertTrue(TrackSchema.clean("session_start", Map.of("inapp", "2")).isEmpty());
    }

    @Test
    void randomIdsOnly() {
        assertTrue(TrackSchema.validRandomId("0123456789abcdef0123456789abcdef"));
        assertFalse(TrackSchema.validRandomId("hello"));
        assertFalse(TrackSchema.validRandomId(null));
    }

    @Test
    void lineIsJson() {
        String line = TrackSchema.line(1, "aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "travel", Map.of("to", "nave"));
        assertEquals("{\"ts\":1,\"vid\":\"aaaaaaaaaaaaaaaa\",\"sid\":\"bbbbbbbbbbbbbbbb\",\"type\":\"travel\",\"p\":{\"to\":\"nave\"}}", line);
    }

    @Test
    void fileLogAppendsAndDeletesOldDays(@TempDir Path dir) throws Exception {
        TrackLog log = new TrackLog(dir.toString(), 90);
        log.append("2026-11-04", List.of("{}", "{}"));
        log.append("2026-07-01", List.of("{}"));
        assertEquals(2, Files.readAllLines(dir.resolve("2026-11-04.jsonl")).size());
        assertEquals(1, log.deleteOld(LocalDate.parse("2026-11-04")));
        assertFalse(Files.exists(dir.resolve("2026-07-01.jsonl")));
        log.close();
    }
}
