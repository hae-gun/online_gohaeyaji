package com.gohaeyaji.realtime.track;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Usage statistics (protocol section 20). Bound from {@code gohaeyaji.track.*} in application.yml.
 *
 * @param enabled      false: every track message is ignored
 * @param dir          where the daily event files go; blank = Redis counters only
 * @param keepDays     event files and Redis counters older than this are deleted
 * @param maxBatch     events in one message or one beacon
 * @param perMinute    events one connection may send in a minute; the rest are dropped
 * @param beaconPerMinute beacons (/api/track) one server takes in a minute, all senders together
 * @param minFreeMb    below this much free disk the event files stop growing (Redis counting goes on)
 */
@ConfigurationProperties("gohaeyaji.track")
public record TrackProperties(
        boolean enabled,
        String dir,
        int keepDays,
        int maxBatch,
        int perMinute,
        int beaconPerMinute,
        int minFreeMb
) {
}
