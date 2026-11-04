package com.gohaeyaji.realtime.track;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gohaeyaji.realtime.config.RealtimeProperties;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * POST /api/track: the last usage events of a visit, sent with navigator.sendBeacon when the page
 * closes (the WebSocket is already gone by then). Same body as the track message:
 * { vid, sid, events: [{ type, p }] }, sent as text/plain so the browser needs no CORS preflight.
 *
 * Only pages of our own origins count (the Origin header), at most maxBatch events per beacon and
 * beaconPerMinute beacons a minute per server. Always answers 204: a beacon never reads the answer.
 */
@RestController
public class TrackController {

    private static final int MAX_BODY = 4096;

    private final TrackService track;
    private final RealtimeProperties props;
    private final ObjectMapper mapper;

    public TrackController(TrackService track, RealtimeProperties props, ObjectMapper mapper) {
        this.track = track;
        this.props = props;
        this.mapper = mapper;
    }

    @PostMapping("/api/track")
    public ResponseEntity<Void> beacon(@RequestHeader(value = "Origin", required = false) String origin,
                                       @RequestBody(required = false) String body) {
        long now = System.currentTimeMillis();
        if (!track.enabled() || origin == null || !props.allowedOrigins().contains(origin)
                || body == null || body.length() > MAX_BODY || !track.acceptBeacon(now)) {
            return ResponseEntity.noContent().build();
        }
        try {
            JsonNode msg = mapper.readTree(body);
            track.record(msg.path("vid").asText(""), msg.path("sid").asText(""), msg.path("events"), track.maxBatch(), now);
        } catch (Exception ignored) {
            // not JSON: nothing to count
        }
        return ResponseEntity.noContent().build();
    }
}
