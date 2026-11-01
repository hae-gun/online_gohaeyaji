package com.gohaeyaji.realtime.admin;

import com.gohaeyaji.realtime.config.RealtimeProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AdminConfig {

    /** Everything under /admin (the page and its API) goes through the login filter. */
    @Bean
    public FilterRegistrationBean<AdminAuthFilter> adminAuthFilter(RealtimeProperties props) {
        FilterRegistrationBean<AdminAuthFilter> bean = new FilterRegistrationBean<>(new AdminAuthFilter(props));
        bean.addUrlPatterns("/admin", "/admin/*");
        bean.setOrder(1);
        return bean;
    }
}
