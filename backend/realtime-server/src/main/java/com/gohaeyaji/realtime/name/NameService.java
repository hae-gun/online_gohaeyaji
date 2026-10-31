package com.gohaeyaji.realtime.name;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gohaeyaji.realtime.config.RealtimeProperties;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * Display names (protocol section 14). Everyone starts with a random baptismal name and may pick
 * their own. A picked name is checked here, on the server, because a modified client can send anything.
 *
 * The blocked word list is private (not in git): it is read from {@code gohaeyaji.blocked-words-file},
 * the same JSON the browser uses ({@code {"words": [...]}}). Without the file only the rules below
 * and the reserved words apply, and a warning is logged.
 */
@Service
public class NameService {

    public enum Verdict { OK, INVALID, BLOCKED, RESERVED }

    public record Check(String name, Verdict verdict) {
        public boolean ok() {
            return verdict == Verdict.OK;
        }
    }

    public static final int MIN_LENGTH = 2;
    public static final int MAX_LENGTH = 10;

    // Hangul syllables, Latin letters and digits, single spaces between words. No lone jamo (ㅋㅋ), no symbols.
    private static final Pattern ALLOWED = Pattern.compile("^[가-힣a-zA-Z0-9]+( [가-힣a-zA-Z0-9]+)*$");

    // Names that would pass for staff, clergy or something holy. Matched anywhere in the name, spaces ignored.
    private static final List<String> RESERVED = List.of(
            "신부", "사제", "주교", "교황", "추기경", "수녀", "수사", "부제",
            "하느님", "하나님", "예수", "그리스도", "성령", "성부", "성자",
            "사탄", "루시퍼", "악마",
            "관리자", "운영", "admin", "고해야지", "공지", "시스템");

    private static final Logger log = LoggerFactory.getLogger(NameService.class);

    private final List<String> saints;
    private final List<String> blocked;
    private final SecureRandom random = new SecureRandom();

    public NameService(RealtimeProperties props, ObjectMapper mapper) {
        this.saints = loadSaints();
        this.blocked = loadBlocked(props.blockedWordsFile(), mapper);
    }

    public String randomName() {
        return saints.get(random.nextInt(saints.size()));
    }

    /** Normalizes (NFC, trimmed, single spaces) and checks a name a person typed. */
    public Check check(String raw) {
        if (raw == null) {
            return new Check(null, Verdict.INVALID);
        }
        String name = Normalizer.normalize(raw, Normalizer.Form.NFC).trim().replaceAll("\\s+", " ");
        int length = name.codePointCount(0, name.length());
        if (length < MIN_LENGTH || length > MAX_LENGTH || !ALLOWED.matcher(name).matches()) {
            return new Check(name, Verdict.INVALID);
        }
        String flat = squash(name);
        for (String word : RESERVED) {
            if (flat.contains(word)) {
                return new Check(name, Verdict.RESERVED);
            }
        }
        for (String word : blocked) {
            if (flat.contains(word)) {
                return new Check(name, Verdict.BLOCKED);
            }
        }
        return new Check(name, Verdict.OK);
    }

    /** Same idea as squash() in frontend/src/answer/engine.js: no spaces or symbols, lower case. */
    static String squash(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^가-힣ㄱ-ㅎㅏ-ㅣa-z0-9]", "");
    }

    private static List<String> loadSaints() {
        List<String> names = new ArrayList<>();
        try (InputStream in = NameService.class.getResourceAsStream("/saint-names.txt")) {
            if (in == null) {
                throw new IllegalStateException("saint-names.txt is missing from the classpath");
            }
            BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim();
                if (!line.isEmpty() && !line.startsWith("#")) {
                    names.add(line);
                }
            }
        } catch (IOException e) {
            throw new IllegalStateException("cannot read saint-names.txt", e);
        }
        if (names.isEmpty()) {
            throw new IllegalStateException("saint-names.txt has no names");
        }
        return List.copyOf(names);
    }

    private static List<String> loadBlocked(String file, ObjectMapper mapper) {
        if (file == null || file.isBlank()) {
            log.warn("gohaeyaji.blocked-words-file is not set: names are checked without the blocked word list");
            return List.of();
        }
        Path path = Path.of(file);
        if (!Files.isRegularFile(path) || !Files.isReadable(path)) {
            log.warn("blocked word file {} not found: names are checked without the blocked word list", path.toAbsolutePath());
            return List.of();
        }
        try {
            JsonNode root = mapper.readTree(path.toFile());
            List<String> words = new ArrayList<>();
            for (JsonNode w : root.path("words")) {
                String s = squash(w.asText(""));
                if (!s.isEmpty()) {
                    words.add(s);
                }
            }
            log.info("loaded {} blocked words for names", words.size());
            return List.copyOf(words);
        } catch (IOException e) {
            throw new IllegalStateException("cannot read blocked word file " + path, e);
        }
    }
}
