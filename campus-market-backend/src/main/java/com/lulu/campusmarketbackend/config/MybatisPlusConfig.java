package com.lulu.campusmarketbackend.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan("com.lulu.campusmarketbackend.mapper")
public class MybatisPlusConfig {
}
