package com.gohaeyaji.realtime.face;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.regex.Pattern;

/**
 * Hand-drawn faces (protocol section 15). A face is a 32x32 grid written row by row as 1024
 * characters, one per cell: 0 empty (skin shows through), 1 black, 2 red, 3 white, 4 pink, and
 * 5 6 7 8 9 a b c for up to eight colours the person picked (v0.12; v0.8 had only 5). When any is
 * used, ":rrggbb,rrggbb,..." follows the grid, one colour per picked slot in order.
 *
 * Codes are made canonical (normalize): colours no cell uses are dropped and the used ones
 * renumbered from 5 in order, so one picture always has one code and one hash. The browser does
 * the same (faces.js joinFace).
 *
 * The grid only covers the front of the head: people draw a face, not a picture. Hair, skin and
 * the body are not drawable. 32x32 with free colours is detailed enough to draw more than a face,
 * which is why faces can be reported (FaceReports).
 */
public final class FaceRules {

    public static final int SIZE = 32;
    public static final int CELLS = SIZE * SIZE;
    /** Grid characters of the picked colours, slot 1 first. */
    public static final String PICKED = "56789abc";
    private static final Pattern VALID = Pattern.compile(
            "^[0-9a-c]{" + CELLS + "}(:[0-9a-fA-F]{6}(,[0-9a-fA-F]{6}){0,7})?$");
    /** Longest well formed code: grid, colon, eight colours. */
    public static final int MAX_LENGTH = CELLS + 1 + 8 * 7 - 1;

    private FaceRules() {
    }

    /** @return true if this is a well formed face: every picked slot the grid uses has a colour. */
    public static boolean valid(String face) {
        if (face == null || face.length() > MAX_LENGTH || !VALID.matcher(face).matches()) {
            return false;
        }
        int max = -1;
        String grid = face.substring(0, CELLS);
        for (int i = 0; i < CELLS; i++) {
            max = Math.max(max, PICKED.indexOf(grid.charAt(i)));
        }
        return max < colours(face).size();
    }

    /**
     * The canonical code, or null for the default face (an erased drawing does not travel around
     * as 1024 zeros). Call on valid faces only.
     */
    public static String normalize(String face) {
        if (face == null) {
            return null;
        }
        String grid = face.substring(0, CELLS);
        if (grid.chars().allMatch(c -> c == '0')) {
            return null;
        }
        java.util.List<String> colours = colours(face);
        java.util.TreeSet<Integer> used = new java.util.TreeSet<>();
        for (int i = 0; i < CELLS; i++) {
            int slot = PICKED.indexOf(grid.charAt(i));
            if (slot >= 0) {
                used.add(slot);
            }
        }
        if (used.isEmpty()) {
            return grid;                                   // colours nobody uses are dropped
        }
        char[] remap = new char[PICKED.length()];
        StringBuilder tail = new StringBuilder(":");
        int k = 0;
        for (int slot : used) {
            remap[slot] = PICKED.charAt(k++);
            if (tail.length() > 1) {
                tail.append(',');
            }
            tail.append(colours.get(slot).toLowerCase(java.util.Locale.ROOT));
        }
        StringBuilder out = new StringBuilder(CELLS + tail.length());
        for (int i = 0; i < CELLS; i++) {
            char c = grid.charAt(i);
            int slot = PICKED.indexOf(c);
            out.append(slot >= 0 ? remap[slot] : c);
        }
        return out.append(tail).toString();
    }

    private static java.util.List<String> colours(String face) {
        return face.length() > CELLS ? java.util.List.of(face.substring(CELLS + 1).split(",")) : java.util.List.of();
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
