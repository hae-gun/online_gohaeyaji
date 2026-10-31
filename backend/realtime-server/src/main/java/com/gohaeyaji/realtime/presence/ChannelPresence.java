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
 * presenceMs. Both sides go through this object's monitor, which is cheap at 60 players.
 */
final class ChannelPresence {

    private final Map<Integer, Player> players = new HashMap<>();
    private final Set<Integer> dirty = new LinkedHashSet<>();
    private final Set<Integer> left = new LinkedHashSet<>();
    private final Map<Integer, String> names = new HashMap<>();
    private final Set<Integer> renamed = new LinkedHashSet<>();

    synchronized void move(int pid, double x, double z, double ry) {
        Player p = players.computeIfAbsent(pid, Player::new);
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
    }

    synchronized void setName(int pid, String name) {
        names.put(pid, name);
        renamed.add(pid);
    }

    synchronized void remove(int pid) {
        dirty.remove(pid);
        renamed.remove(pid);
        names.remove(pid);
        if (players.remove(pid) != null) {
            left.add(pid);
        }
    }

    /** Changes since the last call, or null if nothing changed. */
    synchronized Batch drain() {
        if (dirty.isEmpty() && left.isEmpty() && renamed.isEmpty()) {
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
            named.add(List.of(pid, names.get(pid)));
        }
        Batch batch = new Batch(moved, new ArrayList<>(left), named);
        dirty.clear();
        left.clear();
        renamed.clear();
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

    /** Every name in the channel: {@code [pid, name]}. */
    synchronized List<List<Object>> names() {
        List<List<Object>> all = new ArrayList<>(names.size());
        names.forEach((pid, name) -> all.add(List.of(pid, name)));
        return all;
    }

    record Batch(List<List<Number>> moved, List<Integer> left, List<List<Object>> named) {
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
