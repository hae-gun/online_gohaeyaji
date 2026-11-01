package com.gohaeyaji.realtime.face;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.presence.PresenceService;
import com.gohaeyaji.realtime.protocol.Messages;
import com.gohaeyaji.realtime.protocol.Messages.FaceRemoved;
import com.gohaeyaji.realtime.session.ClientSession;
import com.gohaeyaji.realtime.session.SessionRegistry;
import com.gohaeyaji.realtime.ws.MessageSender;
import org.springframework.stereotype.Service;

/**
 * Takes a banned drawing off everyone wearing it on this server: they go back to the default face,
 * the channel hears about it with the next batch, and they cannot set a face for faceBlockMs.
 * Used after enough reports and from the admin page.
 * TODO step 6: with several servers, publish the ban so the others take it down too.
 */
@Service
public class FaceModeration {

    private final SessionRegistry registry;
    private final PresenceService presence;
    private final MessageSender sender;
    private final RealtimeProperties props;

    public FaceModeration(SessionRegistry registry, PresenceService presence, MessageSender sender, RealtimeProperties props) {
        this.registry = registry;
        this.presence = presence;
        this.sender = sender;
        this.props = props;
    }

    /** @return how many people were wearing it */
    public int takeDown(String face) {
        long until = System.currentTimeMillis() + props.faceBlockMs();
        int n = 0;
        for (ClientSession s : registry.all()) {
            if (s.isReady() && face.equals(s.face())) {
                s.face(null);
                s.blockFace(until);
                presence.setFace(s.channelNo(), s.pid(), null);
                sender.send(s, new FaceRemoved(Messages.REMOVED_REPORTED, props.faceBlockMs()));
                n++;
            }
        }
        return n;
    }
}
