package com.gohaeyaji.realtime.ws;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.gohaeyaji.realtime.booth.BoothService;
import com.gohaeyaji.realtime.channel.ChannelService;
import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.face.FaceModeration;
import com.gohaeyaji.realtime.face.FaceReports;
import com.gohaeyaji.realtime.face.FaceRules;
import com.gohaeyaji.realtime.inquiry.Inquiries;
import com.gohaeyaji.realtime.name.NameService;
import com.gohaeyaji.realtime.presence.Emotes;
import com.gohaeyaji.realtime.presence.PresenceService;
import com.gohaeyaji.realtime.protocol.CloseCodes;
import com.gohaeyaji.realtime.protocol.Messages;
import com.gohaeyaji.realtime.protocol.Messages.BoothEvent;
import com.gohaeyaji.realtime.protocol.Messages.Booths;
import com.gohaeyaji.realtime.protocol.Messages.ClaimResult;
import com.gohaeyaji.realtime.protocol.Messages.ErrorMessage;
import com.gohaeyaji.realtime.protocol.Messages.FaceResult;
import com.gohaeyaji.realtime.protocol.Messages.ReportResult;
import com.gohaeyaji.realtime.protocol.Messages.Idle;
import com.gohaeyaji.realtime.protocol.Messages.InquiryResult;
import com.gohaeyaji.realtime.protocol.Messages.Pong;
import com.gohaeyaji.realtime.protocol.Messages.Released;
import com.gohaeyaji.realtime.protocol.Messages.RenameResult;
import com.gohaeyaji.realtime.protocol.Messages.Welcome;
import com.gohaeyaji.realtime.protocol.Messages.You;
import com.gohaeyaji.realtime.session.ClientSession;
import com.gohaeyaji.realtime.session.SessionRegistry;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Entry point for every WebSocket frame. Implements docs/realtime-protocol.md v0.10:
 * hello/welcome, ping/pong, claim/release, activity, resync, move (positions), rename (names),
 * setFace and report (hand-drawn faces), emote (gestures), inquiry (the box in the confession hall),
 * channels and switchChannel (moving to another channel).
 *
 * Not yet: queue (queueJoin/queueLeave), resume after reconnect, rate limits, confess.
 */
@Component
public class RealtimeWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(RealtimeWebSocketHandler.class);
    private static final int SEND_TIME_LIMIT_MS = 5_000;
    private static final int SEND_BUFFER_LIMIT_BYTES = 64 * 1024;

    private final RealtimeProperties props;
    private final SessionRegistry registry;
    private final ChannelService channels;
    private final BoothService booths;
    private final PresenceService presence;
    private final NameService names;
    private final FaceReports faceReports;
    private final FaceModeration moderation;
    private final Inquiries inquiries;
    private final MessageSender sender;
    private final ObjectMapper mapper;
    private final SecureRandom random = new SecureRandom();

    private final Counter claimOk;
    private final Counter claimTaken;
    private final Counter movesDropped;
    private final Counter emotesDropped;

    public RealtimeWebSocketHandler(RealtimeProperties props, SessionRegistry registry, ChannelService channels,
                                    BoothService booths, PresenceService presence, NameService names,
                                    FaceReports faceReports, FaceModeration moderation, Inquiries inquiries, MessageSender sender,
                                    ObjectMapper mapper, MeterRegistry meters) {
        this.props = props;
        this.registry = registry;
        this.channels = channels;
        this.booths = booths;
        this.presence = presence;
        this.names = names;
        this.faceReports = faceReports;
        this.moderation = moderation;
        this.inquiries = inquiries;
        this.sender = sender;
        this.mapper = mapper;
        Gauge.builder("gohaeyaji.sessions", registry, SessionRegistry::size)
                .description("open WebSocket sessions on this server")
                .register(meters);
        this.claimOk = Counter.builder("gohaeyaji.claims").tag("result", "ok").register(meters);
        this.claimTaken = Counter.builder("gohaeyaji.claims").tag("result", "occupied").register(meters);
        this.movesDropped = Counter.builder("gohaeyaji.moves.dropped")
                .description("move messages dropped for arriving faster than the allowed rate")
                .register(meters);
        this.emotesDropped = Counter.builder("gohaeyaji.emotes.dropped")
                .description("emotes dropped: unknown, inside a booth, or while another was still playing")
                .register(meters);
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) {
        WebSocketSession socket = new ConcurrentWebSocketSessionDecorator(raw, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT_BYTES);
        ClientSession session = new ClientSession(socket, remoteIp(raw), now());
        int fromSameIp = registry.add(session);
        if (fromSameIp > props.maxConnectionsPerIp()) {
            sender.close(session, CloseCodes.TOO_MANY_CONNECTIONS);
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        cleanup(raw.getId());
    }

    @Override
    public void handleTransportError(WebSocketSession raw, Throwable exception) {
        log.debug("transport error on {}: {}", raw.getId(), exception.getMessage());
    }

    // ---------------------------------------------------------------- inbound

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) {
        ClientSession session = registry.get(raw.getId());
        if (session == null) {
            return;
        }
        if (message.getPayload().getBytes(StandardCharsets.UTF_8).length > props.maxMessageBytes()) {
            sender.close(session, CloseCodes.MESSAGE_TOO_LARGE);
            return;
        }

        JsonNode msg;
        try {
            msg = mapper.readTree(message.getPayload());
        } catch (Exception e) {
            sender.send(session, new ErrorMessage(null, Messages.ERR_BAD_MESSAGE, "not JSON"));
            return;
        }
        String type = msg.path("type").asText("");
        String reqId = msg.hasNonNull("reqId") ? msg.get("reqId").asText() : null;

        if (!session.isReady() && !"hello".equals(type)) {
            sender.send(session, new ErrorMessage(reqId, Messages.ERR_NOT_READY, "send hello first"));
            return;
        }

        switch (type) {
            case "hello" -> onHello(session, msg);
            case "ping" -> onPing(session, msg);
            case "claim" -> onClaim(session, msg, reqId);
            case "release" -> onRelease(session, msg, reqId);
            case "move" -> onMove(session, msg);
            case "rename" -> onRename(session, msg, reqId);
            case "setFace" -> onSetFace(session, msg, reqId);
            case "report" -> onReport(session, msg, reqId);
            case "emote" -> onEmote(session, msg);
            case "inquiry" -> onInquiry(session, msg, reqId);
            case "channels" -> onChannels(session, reqId);
            case "switchChannel" -> onSwitchChannel(session, msg, reqId);
            case "activity" -> session.touchActivity(now());
            case "resync" -> sendSnapshot(session);
            case "queueJoin", "queueLeave", "confess" ->
                    sender.send(session, new ErrorMessage(reqId, Messages.ERR_NOT_IMPLEMENTED, type + " is not available yet"));
            default -> sender.send(session, new ErrorMessage(reqId, Messages.ERR_UNKNOWN_TYPE, "unknown type: " + type));
        }
    }

    private void onHello(ClientSession session, JsonNode msg) {
        if (session.isReady()) {
            sender.send(session, new ErrorMessage(null, Messages.ERR_BAD_MESSAGE, "hello already received"));
            return;
        }
        if (msg.path("v").asInt(-1) != props.protocolVersion()) {
            sender.close(session, CloseCodes.VERSION_MISMATCH);
            return;
        }
        // TODO: resumeToken (restore booth and queue position within the 15 s grace)
        int channelNo = channels.join();
        int pid = presence.allocatePid(channelNo);
        // the name the browser remembered; anything that fails the checks quietly becomes a random one
        NameService.Check asked = msg.hasNonNull("name") ? names.check(msg.get("name").asText()) : null;
        String name = asked != null && asked.ok() ? asked.name() : names.randomName();
        session.ready("s_" + UUID.randomUUID(), channelNo, pid, now());
        session.name(name);
        presence.setName(channelNo, pid, name);
        // the face this browser drew before; a malformed or banned one is simply ignored (default face)
        String face = msg.hasNonNull("face") && FaceRules.valid(msg.get("face").asText()) ? FaceRules.normalize(msg.get("face").asText()) : null;
        if (face != null && !faceReports.banned(face)) {
            session.face(face);
            presence.setFace(channelNo, pid, face);
        }
        // join the broadcast set before reading the snapshot, so no event can fall between them;
        // the client drops events whose seq is not above the snapshot seq
        registry.joinChannel(session);
        sendWelcome(session, "rt_" + token());
    }

    /** The full state of the session's channel: on hello, and again after switching channel. */
    private void sendWelcome(ClientSession session, String resumeToken) {
        int channelNo = session.channelNo();
        BoothService.Snapshot snap = booths.snapshot(channelNo);
        sender.send(session, new Welcome(
                props.protocolVersion(),
                session.sessionId(),
                resumeToken,
                channelNo,
                props.boothCount(),
                new Booths(snap.occupied(), snap.reserved()),
                0, // queue arrives in the next step
                snap.seq(),
                props.heartbeatMs(),
                new Idle(props.idleLimitMs(), props.idleWarnMs(), props.idleDangerMs()),
                new You(session.pid(), session.name()),
                presence.snapshot(channelNo),
                presence.names(channelNo),
                presence.faces(channelNo),
                presence.sitting(channelNo),
                props.presenceMs(),
                now()));
    }

    /** Open channels with their member counts (protocol section 18). */
    private void onChannels(ClientSession session, String reqId) {
        if (!session.acceptChannelList(now())) {
            return;   // the panel asks again when opened; nothing to answer for a burst
        }
        java.util.List<Messages.ChannelRow> rows = new java.util.ArrayList<>();
        for (ChannelService.Info c : channels.list()) {
            rows.add(new Messages.ChannelRow(c.no(), c.members()));
        }
        sender.send(session, new Messages.ChannelList(reqId, session.channelNo(), props.channelCapacity(), rows));
    }

    /**
     * Moves the person to another open channel (protocol section 18): out of the old channel's
     * presence (others see them leave), a new pid in the new one with the same name and face,
     * then a fresh welcome. Not from inside a booth.
     */
    private void onSwitchChannel(ClientSession session, JsonNode msg, String reqId) {
        int to = msg.path("channelNo").asInt(-1);
        int from = session.channelNo();
        if (to == from) {
            sender.send(session, Messages.SwitchResult.fail(reqId, Messages.SWITCH_SAME));
            return;
        }
        if (session.boothId() != null) {
            sender.send(session, Messages.SwitchResult.fail(reqId, Messages.SWITCH_IN_BOOTH));
            return;
        }
        if (!session.acceptSwitch(now(), props.channelSwitchMinGapMs())) {
            sender.send(session, Messages.SwitchResult.fail(reqId, Messages.SWITCH_TOO_SOON));
            return;
        }
        ChannelService.SwitchResult r = to > 0 ? channels.switchTo(from, to) : ChannelService.SwitchResult.NO_CHANNEL;
        if (r != ChannelService.SwitchResult.MOVED) {
            sender.send(session, Messages.SwitchResult.fail(reqId,
                    r == ChannelService.SwitchResult.FULL ? Messages.SWITCH_FULL : Messages.SWITCH_NO_CHANNEL));
            return;
        }
        synchronized (session) {
            registry.leaveChannel(session);
            presence.remove(from, session.pid());
            int pid = presence.allocatePid(to);
            session.switchChannel(to, pid);
            presence.setName(to, pid, session.name());
            if (session.face() != null) {
                presence.setFace(to, pid, session.face());
            }
            registry.joinChannel(session);
        }
        sender.send(session, Messages.SwitchResult.ok(reqId, to));
        sendWelcome(session, null);
    }

    private void onMove(ClientSession session, JsonNode msg) {
        if (session.boothId() != null) {
            return; // inside a booth the avatar is hidden; positions mean nothing
        }
        if (!session.acceptMove(now(), props.moveMinGapMs())) {
            movesDropped.increment();
            return;
        }
        presence.move(session.channelNo(), session.pid(),
                msg.path("x").asDouble(Double.NaN),
                msg.path("z").asDouble(Double.NaN),
                msg.path("ry").asDouble(0));
    }

    private void onRename(ClientSession session, JsonNode msg, String reqId) {
        NameService.Check check = names.check(msg.path("name").asText(null));
        if (!check.ok()) {
            String reason = switch (check.verdict()) {
                case BLOCKED -> Messages.NAME_BLOCKED;
                case RESERVED -> Messages.NAME_RESERVED;
                default -> Messages.NAME_INVALID;
            };
            sender.send(session, RenameResult.fail(reqId, check.name(), reason));
            return;
        }
        // only accepted changes count toward the limit, so a typo does not lock the person out
        if (!session.acceptRename(now(), props.renameMinGapMs())) {
            sender.send(session, RenameResult.fail(reqId, check.name(), Messages.NAME_TOO_SOON));
            return;
        }
        session.name(check.name());
        presence.setName(session.channelNo(), session.pid(), check.name());
        sender.send(session, RenameResult.ok(reqId, check.name()));
    }

    private void onSetFace(ClientSession session, JsonNode msg, String reqId) {
        String face = msg.path("face").isNull() ? null : msg.path("face").asText(null);
        if (face != null && !FaceRules.valid(face)) {
            sender.send(session, FaceResult.fail(reqId, Messages.FACE_INVALID));
            return;
        }
        String normalized = FaceRules.normalize(face);
        if (normalized != null && (session.faceBlocked(now()) || faceReports.banned(normalized))) {
            sender.send(session, FaceResult.fail(reqId, Messages.FACE_BLOCKED));
            return;
        }
        if (!session.acceptFace(now(), props.faceMinGapMs())) {
            sender.send(session, FaceResult.fail(reqId, Messages.FACE_TOO_SOON));
            return;
        }
        session.face(normalized);
        presence.setFace(session.channelNo(), session.pid(), normalized);
        sender.send(session, FaceResult.ok(reqId));
    }

    /**
     * Someone reports the drawing another person in the channel wears (protocol section 15).
     * The report is about the picture as it is now; changing it afterwards starts from zero.
     */
    private void onReport(ClientSession session, JsonNode msg, String reqId) {
        int pid = msg.path("pid").asInt(-1);
        if (pid == session.pid()) {
            sender.send(session, ReportResult.fail(reqId, Messages.REPORT_SELF));
            return;
        }
        ClientSession target = null;
        for (ClientSession s : registry.channelMembers(session.channelNo())) {
            if (s.pid() == pid) {
                target = s;
                break;
            }
        }
        // TODO step 6: the person may be connected to another server; look the face up in Redis
        String face = target == null ? null : target.face();
        if (face == null) {
            sender.send(session, ReportResult.fail(reqId, Messages.REPORT_NO_FACE));
            return;
        }
        if (!session.acceptReport(now(), props.maxReportsPerMinute())) {
            sender.send(session, ReportResult.fail(reqId, Messages.REPORT_TOO_MANY));
            return;
        }
        if (!session.firstReportOf(FaceRules.hash(face))) {
            sender.send(session, ReportResult.fail(reqId, Messages.REPORT_ALREADY));
            return;
        }
        FaceReports.Result result = faceReports.report(face, session.sessionId(),
                new FaceReports.Report(now(), session.channelNo(), session.name(), session.remoteIp(),
                        target.name(), target.remoteIp()));
        sender.send(session, result == FaceReports.Result.ALREADY
                ? ReportResult.fail(reqId, Messages.REPORT_ALREADY)
                : ReportResult.ok(reqId));
        if (result == FaceReports.Result.BANNED) {
            moderation.takeDown(face);
        }
    }

    /** No answer: the sender already plays it; anything not allowed is dropped and counted. */
    private void onEmote(ClientSession session, JsonNode msg) {
        String id = msg.path("id").asText("");
        if (Emotes.SIT.equals(id)) {
            if (session.boothId() != null || !session.acceptSit(now(), Emotes.DURATION_MS.get(id))) {
                emotesDropped.increment();
                return;
            }
            presence.sit(session.channelNo(), session.pid(),
                    msg.path("x").asDouble(Double.NaN), msg.path("z").asDouble(Double.NaN), msg.path("ry").asDouble(0));
            return;
        }
        Long duration = Emotes.DURATION_MS.get(id);
        if (duration == null || session.boothId() != null
                || !session.acceptEmote(now(), duration, Emotes.SLACK_MS)) {
            emotesDropped.increment();
            return;
        }
        presence.emote(session.channelNo(), session.pid(), id);
    }

    /** A message for the site's admins from the box in the confession hall (protocol section 17). */
    private void onInquiry(ClientSession session, JsonNode msg, String reqId) {
        long now = now();
        if (!session.canInquire(now, props.inquiryMinGapMs())) {
            sender.send(session, InquiryResult.fail(reqId, Messages.INQUIRY_TOO_SOON));
            return;
        }
        Inquiries.Result r = inquiries.submit(msg.path("kind").asText(null), msg.path("text").asText(null),
                session.channelNo(), session.name(), session.remoteIp(), now);
        switch (r.verdict()) {
            case OK -> {
                session.inquired(now);
                sender.send(session, InquiryResult.ok(reqId));
            }
            case TOO_MANY -> sender.send(session, InquiryResult.fail(reqId, Messages.INQUIRY_TOO_MANY));
            default -> sender.send(session, InquiryResult.fail(reqId, Messages.INQUIRY_INVALID));
        }
    }

    private void onPing(ClientSession session, JsonNode msg) {
        long now = now();
        session.touchPing(now);
        sender.send(session, new Pong(msg.path("t").asLong(0), now));

        Integer boothId = session.boothId();
        if (boothId != null && !booths.renew(session.channelNo(), boothId, session.sessionId())) {
            // lease was lost (pings stopped long enough for the TTL to run out)
            releaseBooth(session, Messages.RELEASED_LEASE_EXPIRED);
        }
    }

    private void onClaim(ClientSession session, JsonNode msg, String reqId) {
        int boothId = msg.path("boothId").asInt(-1);
        if (boothId < 0 || boothId >= props.boothCount()) {
            sender.send(session, ClaimResult.fail(reqId, boothId, Messages.REASON_INVALID_BOOTH));
            return;
        }

        long seq;
        synchronized (session) {
            if (session.boothId() != null) {
                sender.send(session, ClaimResult.fail(reqId, boothId, Messages.REASON_ALREADY_IN_BOOTH));
                return;
            }
            seq = booths.claim(session.channelNo(), boothId, session.sessionId());
            if (seq > 0) {
                session.enterBooth(boothId, now());
                presence.enterBooth(session.channelNo(), session.pid(), boothId);
            }
        }

        if (seq == 0) {
            claimTaken.increment();
            // TODO: answer RESERVED once the queue reserves booths
            sender.send(session, ClaimResult.fail(reqId, boothId, Messages.REASON_OCCUPIED));
            return;
        }
        claimOk.increment();
        sender.send(session, ClaimResult.ok(reqId, boothId, props.leaseMs()));
        sender.broadcast(session.channelNo(), new BoothEvent(session.channelNo(), boothId, Messages.OCCUPIED, seq, session.pid()));
    }

    private void onRelease(ClientSession session, JsonNode msg, String reqId) {
        Integer held = session.boothId();
        int boothId = msg.path("boothId").asInt(-1);
        if (held == null || held != boothId) {
            sender.send(session, new ErrorMessage(reqId, Messages.ERR_BAD_MESSAGE, "not in booth " + boothId));
            return;
        }
        String reason = Messages.RELEASED_IDLE.equals(msg.path("reason").asText()) ? Messages.RELEASED_IDLE : Messages.RELEASED_USER;
        releaseBooth(session, reason);
    }

    private void sendSnapshot(ClientSession session) {
        BoothService.Snapshot snap = booths.snapshot(session.channelNo());
        sender.send(session, new Messages.Snapshot(new Booths(snap.occupied(), snap.reserved()), 0, snap.seq()));
    }

    // ---------------------------------------------------------------- shared with the sweeper

    /**
     * Frees the session's booth (if any), tells the owner why, and tells the channel the LED is off.
     *
     * @param reason sent to the owner as "released"; null when the owner is already gone
     */
    public void releaseBooth(ClientSession session, String reason) {
        Integer boothId;
        synchronized (session) {
            boothId = session.leaveBooth();
        }
        if (boothId == null) {
            return;
        }
        int channelNo = session.channelNo();
        presence.leaveBooth(channelNo, session.pid());
        long seq = booths.release(channelNo, boothId, session.sessionId());
        if (seq == 0) {
            // the lock had already expired; announce "free" only if nobody took it since
            seq = booths.seqIfFree(channelNo, boothId);
        }
        if (reason != null) {
            sender.send(session, new Released(boothId, reason));
        }
        if (seq > 0) {
            sender.broadcast(channelNo, new BoothEvent(channelNo, boothId, Messages.FREE, seq, null));
        }
    }

    public void close(ClientSession session, CloseStatus status) {
        sender.close(session, status);
    }

    private void cleanup(String socketId) {
        ClientSession session = registry.remove(socketId);
        if (session == null) {
            return;
        }
        if (session.isReady()) {
            // TODO: keep the booth for the 15 s resume grace instead of releasing at once
            releaseBooth(session, null);
            presence.remove(session.channelNo(), session.pid());
            channels.leave(session.channelNo());
        }
    }

    // ---------------------------------------------------------------- helpers

    private static String remoteIp(WebSocketSession raw) {
        InetSocketAddress addr = raw.getRemoteAddress();
        if (addr == null) {
            return "unknown";
        }
        return addr.getAddress() != null ? addr.getAddress().getHostAddress() : addr.getHostString();
    }

    private String token() {
        byte[] bytes = new byte[24];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static long now() {
        return System.currentTimeMillis();
    }
}
