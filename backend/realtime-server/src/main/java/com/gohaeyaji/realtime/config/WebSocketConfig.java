package com.gohaeyaji.realtime.config;

import com.gohaeyaji.realtime.ws.RealtimeWebSocketHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * Plain WebSocket (no STOMP) on /ws. Browsers from origins outside the allow list are
 * rejected at the handshake. Clients that send no Origin header (load test tools) are allowed.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final RealtimeWebSocketHandler handler;
    private final RealtimeProperties props;

    public WebSocketConfig(RealtimeWebSocketHandler handler, RealtimeProperties props) {
        this.handler = handler;
        this.props = props;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws")
                .setAllowedOrigins(props.allowedOrigins().toArray(String[]::new));
    }

    @Bean
    public ServletServerContainerFactoryBean createWebSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        // the container drops frames above this with 1009; the protocol limit (2 KB) is checked in the handler
        container.setMaxTextMessageBufferSize(8 * 1024);
        container.setMaxBinaryMessageBufferSize(1024);
        // last-resort cleanup for sockets that stop sending entirely
        container.setMaxSessionIdleTimeout(props.heartbeatTimeoutMs() * 2);
        return container;
    }
}
