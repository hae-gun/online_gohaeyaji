package com.gohaeyaji.realtime.admin;

import com.gohaeyaji.realtime.booth.BoothService;
import com.gohaeyaji.realtime.channel.ChannelService;
import com.gohaeyaji.realtime.face.FaceModeration;
import com.gohaeyaji.realtime.face.FaceReports;
import com.gohaeyaji.realtime.inquiry.Inquiries;
import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.RedisKeys;
import com.gohaeyaji.realtime.session.SessionRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.lang.management.ManagementFactory;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseBody;

/**
 * Admin page (/admin): a quick look at who is on, the reported drawings with their history, and the
 * messages left in the inquiry box (신께 알리기).
 * Detailed graphs belong in Grafana; this page is for decisions (ban for good, give back).
 * Login and CSRF protection: AdminAuthFilter.
 */
@Controller
public class AdminController {

    private static final Pattern HASH = Pattern.compile("^[0-9a-f]{32}$");

    private final SessionRegistry registry;
    private final ChannelService channelService;
    private final BoothService booths;
    private final FaceReports reports;
    private final FaceModeration moderation;
    private final StringRedisTemplate redis;
    private final MeterRegistry meters;
    private final Inquiries inquiries;
    private final RealtimeProperties props;

    public AdminController(SessionRegistry registry, ChannelService channelService, BoothService booths, FaceReports reports,
                           FaceModeration moderation, StringRedisTemplate redis, MeterRegistry meters,
                           Inquiries inquiries, RealtimeProperties props) {
        this.registry = registry;
        this.channelService = channelService;
        this.booths = booths;
        this.reports = reports;
        this.moderation = moderation;
        this.redis = redis;
        this.meters = meters;
        this.inquiries = inquiries;
        this.props = props;
    }

    @GetMapping({"/admin", "/admin/"})
    public String page() {
        return "forward:/admin/index.html";
    }

    @GetMapping("/admin/api/overview")
    @ResponseBody
    public Map<String, Object> overview() {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("serverTime", System.currentTimeMillis());
        out.put("uptimeMs", ManagementFactory.getRuntimeMXBean().getUptime());
        Runtime rt = Runtime.getRuntime();
        out.put("heapUsedMb", (rt.totalMemory() - rt.freeMemory()) / (1024 * 1024));
        out.put("heapMaxMb", rt.maxMemory() / (1024 * 1024));
        out.put("sessionsHere", registry.size());
        out.put("serverId", channelService.serverId());
        out.put("serversAlive", channelService.aliveServers().size());
        out.put("boothCount", props.boothCount());
        out.put("inquiriesOpen", inquiries.openCount());

        List<Map<String, Object>> channels = new ArrayList<>();
        Set<String> nos = redis.opsForZSet().range(RedisKeys.CHANNELS, 0, -1);
        if (nos != null) {
            for (String no : nos) {
                int n = Integer.parseInt(no);
                BoothService.Snapshot snap = booths.snapshot(n);
                Map<String, Object> ch = new LinkedHashMap<>();
                ch.put("channelNo", n);
                ch.put("members", channelService.members(n));
                ch.put("connectedHere", registry.channelMembers(n).size());
                ch.put("boothsOccupied", snap.occupied().size());
                channels.add(ch);
            }
        }
        out.put("channels", channels);
        out.put("faceReportsTotal", count("gohaeyaji.face.reports"));
        out.put("faceBansTotal", count("gohaeyaji.face.bans"));
        return out;
    }

    /** Reported drawings of the last 7 days, newest report first. */
    @GetMapping("/admin/api/faces")
    @ResponseBody
    public List<FaceReports.Entry> faces() {
        return reports.list(200);
    }

    public record BanRequest(boolean permanent) {
    }

    @PostMapping("/admin/api/faces/{hash}/ban")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> ban(@PathVariable String hash, @RequestBody(required = false) BanRequest body) {
        if (!HASH.matcher(hash).matches()) {
            return ResponseEntity.badRequest().build();
        }
        String face = reports.ban(hash, body != null && body.permanent());
        if (face == null) {
            return ResponseEntity.notFound().build();
        }
        int wearing = moderation.takeDown(face);
        return ResponseEntity.ok(Map.of("ok", true, "takenOffFrom", wearing, "entry", reports.entry(hash)));
    }

    @PostMapping("/admin/api/faces/{hash}/restore")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> restore(@PathVariable String hash) {
        if (!HASH.matcher(hash).matches()) {
            return ResponseEntity.badRequest().build();
        }
        if (!reports.restore(hash)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("ok", true, "entry", reports.entry(hash)));
    }

    /** Deletes the drawing and its history (IPs included). A ban stays in force; see FaceReports.delete. */
    @PostMapping("/admin/api/faces/{hash}/delete")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> delete(@PathVariable String hash) {
        if (!HASH.matcher(hash).matches()) {
            return ResponseEntity.badRequest().build();
        }
        if (!reports.delete(hash)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** Messages from the inquiry box, newest first. */
    @GetMapping("/admin/api/inquiries")
    @ResponseBody
    public List<Inquiries.Entry> inquiries() {
        return inquiries.list(500);
    }

    /** Marks a message as handled ("done") or back to open ("reopen"). */
    @PostMapping("/admin/api/inquiries/{id}/{action:done|reopen}")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> inquiryDone(@PathVariable long id, @PathVariable String action) {
        if (!inquiries.markDone(id, "done".equals(action))) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("ok", true, "entry", inquiries.entry(id)));
    }

    /** Deletes the message with the name and IP stored with it. */
    @PostMapping("/admin/api/inquiries/{id}/delete")
    @ResponseBody
    public ResponseEntity<Map<String, Object>> inquiryDelete(@PathVariable long id) {
        if (!inquiries.delete(id)) {
            return ResponseEntity.notFound().build();
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private double count(String name) {
        Counter c = meters.find(name).counter();
        return c == null ? 0 : c.count();
    }
}
