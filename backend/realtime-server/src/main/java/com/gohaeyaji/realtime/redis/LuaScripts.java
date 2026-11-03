package com.gohaeyaji.realtime.redis;

import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

/**
 * Lua scripts under resources/redis. Every state change that must be atomic
 * (taking a booth, renewing it, releasing it, assigning a channel) runs as one script.
 */
@Component
public class LuaScripts {

    public final RedisScript<Long> assignChannel = load("assign_channel");
    public final RedisScript<Long> leaveChannel = load("leave_channel");
    public final RedisScript<Long> claimBooth = load("claim_booth");
    public final RedisScript<Long> renewBooth = load("renew_booth");
    public final RedisScript<Long> releaseBooth = load("release_booth");
    public final RedisScript<Long> notifyIfFree = load("notify_if_free");
    public final RedisScript<Long> reportFace = load("report_face");
    public final RedisScript<Long> serverHeartbeat = load("server_heartbeat");
    public final RedisScript<Long> switchChannel = load("switch_channel");
    public final RedisScript<Long> recordPeak = load("record_peak");

    private static RedisScript<Long> load(String name) {
        return RedisScript.of(new ClassPathResource("redis/" + name + ".lua"), Long.class);
    }
}
