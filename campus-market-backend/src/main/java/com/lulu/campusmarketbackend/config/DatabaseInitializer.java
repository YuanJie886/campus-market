package com.lulu.campusmarketbackend.config;

import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Value;
import com.lulu.campusmarketbackend.mapper.SchemaMapper;
import org.springframework.core.io.ClassPathResource;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

@Component
public class DatabaseInitializer implements CommandLineRunner {
    private final SchemaMapper schemaMapper;
    private final boolean enabled;

    public DatabaseInitializer(SchemaMapper schemaMapper, @Value("${campus-market.schema-init:true}") boolean enabled) {
        this.schemaMapper = schemaMapper;
        this.enabled = enabled;
    }

    @Override
    public void run(String... args) {
        if (!enabled) return;
        try {
            String script = new String(new ClassPathResource("db/schema.sql").getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            Arrays.stream(script.split(";"))
                    .map(String::trim)
                    .filter(statement -> !statement.isBlank())
                    .forEach(schemaMapper::execute);
        } catch (Exception e) {
            throw new IllegalStateException("数据库结构初始化失败", e);
        }
    }
}
