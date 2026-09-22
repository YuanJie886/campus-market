package com.lulu.campusmarketbackend.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class JacksonConfig {
    @Bean
    ObjectMapper campusMarketObjectMapper() {
        return new ObjectMapper();
    }
}
