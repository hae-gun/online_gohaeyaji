package com.gohaeyaji.realtime.face;

import java.util.regex.Pattern;

/**
 * Hand-drawn faces (protocol section 15). A face is a 16x16 grid written row by row as 256 digits,
 * one per cell: 0 empty (skin shows through), 1 black, 2 red, 3 white, 4 pink.
 *
 * The palette only has what eyes, a nose, a mouth and cheeks need, and the grid only covers the
 * front of the head: people draw a face, not a picture. Hair, skin and the body are not drawable.
 */
public final class FaceRules {

    public static final int SIZE = 16;
    public static final int CELLS = SIZE * SIZE;
    private static final Pattern VALID = Pattern.compile("^[0-4]{" + CELLS + "}$");

    private FaceRules() {
    }

    /** @return true if this is a well formed face. An all-empty face means "use the default face". */
    public static boolean valid(String face) {
        return face != null && VALID.matcher(face).matches();
    }

    /** null for the default face, so an erased drawing does not travel around as 256 zeros. */
    public static String normalize(String face) {
        return face == null || face.chars().allMatch(c -> c == '0') ? null : face;
    }
}
