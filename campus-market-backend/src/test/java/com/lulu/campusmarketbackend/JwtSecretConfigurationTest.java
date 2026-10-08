package com.lulu.campusmarketbackend;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.security.JwtService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * JWT 签名密钥的配置安全测试（R-03）。
 *
 * <p>背景：生产 {@code application.yaml} 曾经为 {@code campus-market.jwt-secret} 提供
 * 仓库内公开的默认值，使得 {@code JWT_SECRET} 环境变量缺失时，应用会静默使用
 * 一个所有人都能从 Git 读到的密钥启动。本类从两个角度守住修复：
 *
 * <ol>
 *   <li><b>资源级断言</b>：直接读取生产 {@code application.yaml}，确认 jwt-secret
 *       是无 fallback 的 {@code ${JWT_SECRET}}。这是唯一能证明「生产配置里没有兜底值」
 *       的检查——上下文测试用的是自己注入的属性，看不到 YAML 里写了什么。</li>
 *   <li><b>上下文与构造断言</b>：属性缺失 / 空白 / 强度不足时必须启动失败，
 *       合法密钥才能创建 {@link JwtService}。</li>
 * </ol>
 *
 * <p>本类是普通单元测试（Surefire 执行），<b>不需要 Docker</b>，也<b>不读取</b>
 * 执行者 shell 中的 {@code JWT_SECRET}：所有属性都在测试内显式注入，结果确定。
 *
 * <p>测试全程不打印任何密钥值。
 */
class JwtSecretConfigurationTest {

    /** 生产配置中 jwt-secret 唯一允许的写法：无默认值的必填占位符。 */
    private static final Pattern JWT_SECRET_LINE =
            Pattern.compile("^\\s*jwt-secret:\\s*(\\S+)\\s*$", Pattern.MULTILINE);

    private static final String VALID_SECRET = "jwt-secret-config-test-value-0123456789";
    private static final String ISSUER = "campus-market";
    private static final String AUDIENCE = "campus-market-web";

    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(JwtServiceTestConfiguration.class)
            .withPropertyValues(
                    "campus-market.jwt-issuer=" + ISSUER,
                    "campus-market.jwt-audience=" + AUDIENCE,
                    "campus-market.access-token-minutes=15");

    // ------------------------------------------------------------------
    // 1. 生产配置中不得存在任何兜底密钥
    // ------------------------------------------------------------------

    @Test
    @DisplayName("1. 生产 application.yaml 的 jwt-secret 必须是无默认值的 ${JWT_SECRET}")
    void productionConfigHasNoJwtSecretFallback() throws IOException {
        String yaml = readProductionApplicationYaml();

        Matcher matcher = JWT_SECRET_LINE.matcher(yaml);
        assertThat(matcher.find()).as("生产 application.yaml 应包含 jwt-secret 配置").isTrue();

        String value = matcher.group(1);

        assertThat(value)
                .as("jwt-secret 必须是无 fallback 的必填占位符，"
                        + "写成 ${JWT_SECRET:xxx} 会让缺少环境变量时静默使用仓库内公开密钥启动")
                .isEqualTo("${JWT_SECRET}");

        // 双保险：即便未来占位符写法变化，也不允许出现 ":" 形式的默认值
        assertThat(value)
                .as("jwt-secret 不得带有 ${VAR:default} 形式的兜底值")
                .doesNotContain(":");

        assertThat(matcher.find())
                .as("生产 application.yaml 中不应出现第二处 jwt-secret 配置")
                .isFalse();
    }

    @Test
    @DisplayName("2. 生产配置与生产源码中不得残留任何形如 ${JWT_SECRET:...} 的兜底写法")
    void productionConfigContainsNoDefaultedSecretPlaceholder() throws IOException {
        String yaml = readProductionApplicationYaml();
        assertThat(yaml)
                .as("不得存在 ${JWT_SECRET:...} 这种带默认值的占位符")
                .doesNotContain("${JWT_SECRET:");
    }

    // ------------------------------------------------------------------
    // 2. 缺失 / 空白 / 强度不足必须启动失败
    // ------------------------------------------------------------------

    @Test
    @DisplayName("3. 未提供 campus-market.jwt-secret 时上下文必须启动失败")
    void contextFailsWhenSecretIsMissing() {
        contextRunner.run(context -> assertThat(context)
                .as("占位符无法解析时必须启动失败，不能静默降级")
                .hasFailed());
    }

    @Test
    @DisplayName("4. 空字符串与纯空白密钥必须启动失败")
    void contextFailsWhenSecretIsBlank() {
        for (String blank : List.of("", "   ", "\t  \n ")) {
            contextRunner.withPropertyValues("campus-market.jwt-secret=" + blank)
                    .run(context -> assertThat(context).hasFailed());
        }
    }

    @Test
    @DisplayName("5. UTF-8 字节长度不足 32 的密钥必须被拒绝")
    void shortSecretIsRejected() {
        // 31 个 ASCII 字符 = 31 字节，刚好不足
        String thirtyOneBytes = "a".repeat(31);
        assertThat(thirtyOneBytes.getBytes(StandardCharsets.UTF_8)).hasSize(31);
        assertThatThrownBy(() -> newJwtService(thirtyOneBytes))
                .isInstanceOf(IllegalStateException.class);

        // 11 个中文字符 = 11 个 Java char，但 UTF-8 是 33 字节：
        // 用字符数判断会误拒，用字节数判断才正确
        String elevenChineseChars = "校园集市密钥测试样例值";
        assertThat(elevenChineseChars).hasSize(11);
        assertThat(elevenChineseChars.getBytes(StandardCharsets.UTF_8)).hasSizeGreaterThanOrEqualTo(32);
        newJwtService(elevenChineseChars);   // 不应抛异常

        // 10 个中文字符 = 30 字节，真正不足
        String tenChineseChars = "校园集市密钥测试样例";
        assertThat(tenChineseChars.getBytes(StandardCharsets.UTF_8)).hasSize(30);
        assertThatThrownBy(() -> newJwtService(tenChineseChars))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("6. 合法密钥可以创建 JwtService，且上下文启动成功")
    void validSecretIsAccepted() {
        assertThat(VALID_SECRET.getBytes(StandardCharsets.UTF_8).length).isGreaterThanOrEqualTo(32);

        JwtService service = newJwtService(VALID_SECRET);
        assertThat(service).isNotNull();

        contextRunner.withPropertyValues("campus-market.jwt-secret=" + VALID_SECRET)
                .run(context -> assertThat(context).hasNotFailed().hasSingleBean(JwtService.class));
    }

    // ------------------------------------------------------------------
    // 辅助
    // ------------------------------------------------------------------

    private static String readProductionApplicationYaml() throws IOException {
        // 生产 application.yaml 随 main resources 一起进入测试 classpath
        ClassPathResource resource = new ClassPathResource("application.yaml");
        assertThat(resource.exists()).as("应能在 classpath 上找到生产 application.yaml").isTrue();
        return new String(resource.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    }

    /** 直接构造，绕开 Spring，专门验证 JwtService 自身的密钥强度校验。 */
    private static JwtService newJwtService(String secret) {
        return new JwtService(new ObjectMapper(), secret, ISSUER, AUDIENCE, 15);
    }

    /** 最小配置：只注册 JwtService，属性由各测试显式注入。 */
    @Configuration(proxyBeanMethods = false)
    static class JwtServiceTestConfiguration {
        @Bean
        JwtService jwtService(@Value("${campus-market.jwt-secret}") String secret,
                              @Value("${campus-market.jwt-issuer}") String issuer,
                              @Value("${campus-market.jwt-audience}") String audience,
                              @Value("${campus-market.access-token-minutes}") long accessTokenMinutes) {
            return new JwtService(new ObjectMapper(), secret, issuer, audience, accessTokenMinutes);
        }
    }
}
