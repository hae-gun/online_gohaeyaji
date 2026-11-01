package com.gohaeyaji.realtime.admin;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Guards /admin. Kept small on purpose (no Spring Security):
 *  - no password configured: the admin page does not exist (404)
 *  - HTTP Basic login, compared in constant time; meant to run behind HTTPS (Caddy)
 *  - 5 failed logins from one IP in 10 minutes: that IP waits (429)
 *  - changes (POST) need the X-Admin header: a browser only sends custom headers from our own
 *    page, so another site cannot make a logged-in admin ban something (CSRF)
 *  - nothing cached, never framed
 * Restricting /admin to known IPs in Caddy on top of this is recommended.
 */
public class AdminAuthFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AdminAuthFilter.class);
    private static final int MAX_FAILURES = 5;
    private static final long FAILURE_WINDOW_MS = 10 * 60_000;

    private final RealtimeProperties props;
    private final Map<String, long[]> failures = new ConcurrentHashMap<>();   // ip -> [count, window start]

    public AdminAuthFilter(RealtimeProperties props) {
        this.props = props;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String password = props.adminPassword();
        if (password == null || password.isBlank()) {
            res.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy",
                "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'");

        String ip = req.getRemoteAddr();
        long now = System.currentTimeMillis();
        long[] f = failures.get(ip);
        if (f != null && now - f[1] < FAILURE_WINDOW_MS && f[0] >= MAX_FAILURES) {
            res.sendError(429, "too many failed logins, try again later");
            return;
        }

        if (!authorized(req.getHeader("Authorization"), props.adminUser(), password)) {
            if (req.getHeader("Authorization") != null) {
                failures.compute(ip, (k, v) -> v == null || now - v[1] >= FAILURE_WINDOW_MS ? new long[] {1, now} : new long[] {v[0] + 1, v[1]});
                log.warn("admin login failed from {}", ip);
            }
            res.setHeader("WWW-Authenticate", "Basic realm=\"gohaeyaji admin\", charset=\"UTF-8\"");
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        failures.remove(ip);

        if (!"GET".equals(req.getMethod()) && !"1".equals(req.getHeader("X-Admin"))) {
            res.sendError(HttpServletResponse.SC_FORBIDDEN, "missing X-Admin header");
            return;
        }
        chain.doFilter(req, res);
    }

    static boolean authorized(String header, String user, String password) {
        if (header == null || !header.startsWith("Basic ")) {
            return false;
        }
        String decoded;
        try {
            decoded = new String(Base64.getDecoder().decode(header.substring(6).trim()), StandardCharsets.UTF_8);
        } catch (IllegalArgumentException e) {
            return false;
        }
        byte[] given = decoded.getBytes(StandardCharsets.UTF_8);
        byte[] expected = (user + ":" + password).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(given, expected);
    }
}
