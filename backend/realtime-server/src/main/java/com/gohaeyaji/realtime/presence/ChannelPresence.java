package com.gohaeyaji.realtime.presence;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Positions of the players of one channel connected to this server.
 *
 * Moves arrive from many socket threads; the broadcaster drains the changes every
 * presenceMs. Both sides go through this object's monitor, which is cheap at 100 players.
 */
final class ChannelPresence {

    private final Map<Integer, Player> players = new HashMap<>();
    private final Set<Integer> dirty = new LinkedHashSet<>();
    private final Set<Integer> left = new LinkedHashSet<>();
    private final Map<Integer, String> names = new HashMap<>();
    /** 형제님 "m" or 자매님 "f" (v0.16); sent with the name as a third element */
    private final Map<Integer, String> looks = new HashMap<>();
    private final Set<Integer> renamed = new LinkedHashSet<>();
    private final Map<Integer, String> faces = new HashMap<>();
    private final Set<Integer> refaced = new LinkedHashSet<>();
    private final List<List<Object>> emoted = new ArrayList<>();
    /** Who sits on a bench or pew right now (protocol section 16): newcomers see them seated. */
    private final Set<Integer> sitting = new LinkedHashSet<>();
    /** Moving less than this is turning on the seat, not getting up. */
    private static final double STAND_UP_DISTANCE = 0.05;

    synchronized void move(int pid, double x, double z, double ry) {
        Player p = players.computeIfAbsent(pid, Player::new);
        if (Math.hypot(x - p.x, z - p.z) > STAND_UP_DISTANCE) {
            sitting.remove(pid);    // walking away from the seat is standing up
        }
        p.x = x;
        p.z = z;
        p.ry = ry;
        left.remove(pid);
        dirty.add(pid);
    }

    synchronized void setBooth(int pid, int boothId) {
        Player p = players.get(pid);
        if (p != null) {
            p.boothId = boothId;
        }
        sitting.remove(pid);
    }

    synchronized void setName(int pid, String name) {
        names.put(pid, name);
        renamed.add(pid);
    }

    /** Clothes: goes out with the name, so a change is announced like a rename. */
    synchronized void setLook(int pid, String look) {
        looks.put(pid, look);
        renamed.add(pid);
    }

    /** face null = back to the default face; still announced so others drop the old drawing. */
    synchronized void setFace(int pid, String face) {
        if (face == null) {
            faces.remove(pid);
        } else {
            faces.put(pid, face);
        }
        refaced.add(pid);
    }

    synchronized void emote(int pid, String id) {
        emoted.add(List.of(pid, id));
    }

    /**
     * Sits down at the seat (x, z, facing ry): the position is taken as is, so the seat is right
     * even if the last move was dropped by the rate limit. Announced like an emote with a move in
     * the same batch, and remembered until the player walks away.
     */
    synchronized void sit(int pid, double x, double z, double ry) {
        Player p = players.computeIfAbsent(pid, Player::new);
        p.x = x;
        p.z = z;
        p.ry = ry;
        left.remove(pid);
        dirty.add(pid);
        sitting.add(pid);
        emoted.add(List.of(pid, Emotes.SIT));
    }

    /** Pids sitting now, for the welcome of someone joining. */
    synchronized List<Integer> sitting() {
        return new ArrayList<>(sitting);
    }

    synchronized void remove(int pid) {
        faces.remove(pid);
        refaced.remove(pid);
        sitting.remove(pid);
        dirty.remove(pid);
        renamed.remove(pid);
        names.remove(pid);
        looks.remove(pid);
        if (players.remove(pid) != null) {
            left.add(pid);
        }
    }

    /** Changes since the last call, or null if nothing changed. */
    synchronized Batch drain() {
        if (dirty.isEmpty() && left.isEmpty() && renamed.isEmpty() && refaced.isEmpty() && emoted.isEmpty()) {
            return null;
        }
        List<List<Number>> moved = new ArrayList<>(dirty.size());
        for (int pid : dirty) {
            Player p = players.get(pid);
            if (p != null) {
                moved.add(List.of(pid, p.x, p.z, p.ry));
            }
        }
        List<List<Object>> named = new ArrayList<>(renamed.size());
        for (int pid : renamed) {
            named.add(nameEntry(pid));
        }
        List<List<Object>> faced = new ArrayList<>(refaced.size());
        for (int pid : refaced) {
            // "" tells clients to go back to the default face (a List cannot hold null)
            faced.add(List.of(pid, faces.getOrDefault(pid, "")));
        }
        Batch batch = new Batch(moved, new ArrayList<>(left), named, faced, new ArrayList<>(emoted));
        emoted.clear();
        dirty.clear();
        left.clear();
        renamed.clear();
        refaced.clear();
        return batch;
    }

    /** Everyone currently visible: {@code [pid, x, z, ry, boothId or -1]}. */
    synchronized List<List<Number>> snapshot() {
        List<List<Number>> all = new ArrayList<>(players.size());
        for (Player p : players.values()) {
            all.add(List.of(p.pid, p.x, p.z, p.ry, p.boothId));
        }
        return all;
    }

    /** Every name in the channel: {@code [pid, name, look]}. */
    synchronized List<List<Object>> names() {
        List<List<Object>> all = new ArrayList<>(names.size());
        names.keySet().forEach((pid) -> all.add(nameEntry(pid)));
        return all;
    }

    /** {@code [pid, name, look]}; older clients read the first two and ignore the look. */
    private List<Object> nameEntry(int pid) {
        return List.of(pid, names.getOrDefault(pid, ""), looks.getOrDefault(pid, "m"));
    }

    /** Every drawn face in the channel: {@code [pid, face]}. */
    synchronized List<List<Object>> faces() {
        List<List<Object>> all = new ArrayList<>(faces.size());
        faces.forEach((pid, face) -> all.add(List.of(pid, face)));
        return all;
    }

    record Batch(List<List<Number>> moved, List<Integer> left, List<List<Object>> named, List<List<Object>> faced,
                 List<List<Object>> emoted) {
    }

    private static final class Player {
        final int pid;
        double x;
        double z;
        double ry;
        int boothId = -1;

        Player(int pid) {
            this.pid = pid;
        }
    }
}
