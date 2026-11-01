package com.gohaeyaji.realtime.feedback;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/** A short one-way hash of an IP for rate-limit keys, so the address itself is never stored. */
final class Ips {

    private Ips() {
    }

    static String hash(String purpose, String ip) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256")
                    .digest(("gohaeyaji-" + purpose + ":" + ip).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d, 0, 12);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
