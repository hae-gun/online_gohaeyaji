package com.gohaeyaji.realtime.channel;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import com.gohaeyaji.realtime.redis.LuaScripts;
import com.gohaeyaji.realtime.redis.RedisKeys;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * Channel assignment: fill from channel 1, move on at 80% (soft limit), open a new channel
 * when all are at the soft limit. The decision runs inside one Lua script so concurrent
 * joins on several servers never overfill a channel.
 *
 * TODO: remove channels that stayed empty for 5 minutes (protocol C1).
 * TODO: member counts drift if a server crashes without running leave(); reconcile on startup.
 */
@Service
public class ChannelService {

    private final StringRedisTemplate redis;
    private final LuaScripts scripts;
    private final RealtimeProperties props;

    public ChannelService(StringRedisTemplate redis, LuaScripts scripts, RealtimeProperties props) {
        this.redis = redis;
        this.scripts = scripts;
        this.props = props;
    }

    public int join() {
        Long no = redis.execute(scripts.assignChannel, List.of(RedisKeys.CHANNELS),
                String.valueOf(props.channelSoftLimit()), RedisKeys.CHANNEL_PREFIX);
        if (no == null) {
            throw new IllegalStateException("channel assignment returned nothing");
        }
        return no.intValue();
    }

    public void leave(int channelNo) {
        redis.execute(scripts.leaveChannel, List.of(RedisKeys.members(channelNo)));
    }
}
