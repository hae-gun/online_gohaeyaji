package com.gohaeyaji.realtime.face;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Hand-drawn faces (protocol section 15). A face is a 32x32 grid written row by row as 1024 digits,
 * one per cell: 0 empty (skin shows through), 1 black, 2 red, 3 white, 4 pink, 5 a colour the person
 * picked. When 5 is used, ":rrggbb" (6 hex digits) follows the grid and gives that colour (v0.8).
 * A drawing without 5 never carries a colour, so the same picture always has the same code.
 *
 * The palette only has what eyes, a nose, a mouth and cheeks need, and the grid only covers the
 * front of the head: people draw a face, not a picture. Hair, skin and the body are not drawable.
 * 32x32 is detailed enough to write a few words, which is why faces can be reported (FaceReports).
 */
public final class FaceRules {

    public static final int SIZE = 32;
    public static final int CELLS = SIZE * SIZE;
    private static final Pattern VALID = Pattern.compile("^[0-5]{" + CELLS + "}(:[0-9a-fA-F]{6})?$");
    /** Longest well formed code: grid, colon, colour. */
    public static final int MAX_LENGTH = CELLS + 7;

    private FaceRules() {
    }

    /** @return true if this is a well formed face. An all-empty face means "use the default face". */
    public static boolean valid(String face) {
        if (face == null || face.length() > MAX_LENGTH || !VALID.matcher(face).matches()) {
            return false;
        }
        // the picked colour is needed exactly when some cell uses it
        return grid(face).indexOf('5') < 0 || face.length() == MAX_LENGTH;
    }

    /** null for the default face, so an erased drawing does not travel around as 1024 zeros. */
    public static String normalize(String face) {
        if (face == null) {
            return null;
        }
        String grid = grid(face);
        if (grid.chars().allMatch(c -> c == '0')) {
            return null;
        }
        if (grid.indexOf('5') < 0) {
            return grid;                       // an unused colour is dropped
        }
        return grid + face.substring(CELLS).toLowerCase(java.util.Locale.ROOT);
    }

    private static String grid(String face) {
        return face.length() > CELLS ? face.substring(0, CELLS) : face;
    }

    /** Identifies a drawing for reports and bans. */
    public static String hash(String face) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(face.getBytes(StandardCharsets.US_ASCII));
            return HexFormat.of().formatHex(d, 0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
