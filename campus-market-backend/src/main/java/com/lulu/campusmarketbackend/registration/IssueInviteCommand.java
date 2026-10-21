package com.lulu.campusmarketbackend.registration;

import com.lulu.campusmarketbackend.api.ApiException;
import com.lulu.campusmarketbackend.school.DemoSchool;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.Banner;
import org.springframework.boot.ExitCodeGenerator;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 首次部署的引导命令：还没有任何工作人员时，第一位学校管理员也要先注册，而开启邀请制后注册需要邀请码。
 *
 * <pre>
 * docker compose run --rm api --campus-market.cli.issue-invite.school=aust \
 *     [--campus-market.cli.issue-invite.max-uses=1] [--campus-market.cli.issue-invite.days=7] [--campus-market.cli.issue-invite.note=首批管理员]
 * </pre>
 *
 * <p>与正常启动一样先执行 Flyway 迁移与学校数据包导入，然后签发一张邀请码（created_by 为空 = 命令行签发），
 * 向标准输出打印<b>唯一一行</b> {@code 邀请码：XXXX-XXXX-XXXX（N 次，至 yyyy-MM-dd HH:mm）}（北京时间）后以 0 退出；
 * 不启动 Web 服务（非 Web 应用类型），日志降到 WARN，不出现启动横幅。学校不存在、已停用（或是已隐藏的演示学校）、参数越界时
 * 向标准错误输出原因并以非 0 退出。邀请码明文只出现在这一行里，不写日志。
 */
@Component
@ConditionalOnProperty(name = IssueInviteCommand.SCHOOL)
public class IssueInviteCommand implements ApplicationRunner, ExitCodeGenerator {
    static final String PREFIX = "campus-market.cli.issue-invite.";
    static final String SCHOOL = PREFIX + "school";
    /** 签发失败（参数或学校无效）的退出码；应用本身启动失败为 1。 */
    public static final int FAILED = 2;
    private static final DateTimeFormatter EXPIRES = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Shanghai"));

    private final RegistrationInvites invites;
    private final JdbcTemplate jdbc;
    private final DemoSchool demo;
    private final Environment environment;
    private final ApplicationContext context;
    private int exitCode;

    public IssueInviteCommand(RegistrationInvites invites, JdbcTemplate jdbc, DemoSchool demo, Environment environment, ApplicationContext context) {
        this.invites = invites; this.jdbc = jdbc; this.demo = demo; this.environment = environment; this.context = context;
    }

    // ================= 入口（CampusMarketBackendApplication.main） =================

    /** 命令行参数里是否要求签发邀请码。 */
    public static boolean requested(String[] args) {
        return args != null && Arrays.stream(args).anyMatch(arg -> arg.startsWith("--" + SCHOOL + "="));
    }

    /** 非 Web 应用：不启动 Web 服务；不打印横幅（Spring 与 MyBatis-Plus），日志降到 WARN（命令行参数仍可覆盖），标准输出只剩邀请码这一行。 */
    public static SpringApplication application(Class<?> source) {
        SpringApplication app = new SpringApplication(source);
        app.setWebApplicationType(WebApplicationType.NONE);
        app.setBannerMode(Banner.Mode.OFF);
        app.setLogStartupInfo(false);
        StandardEnvironment environment = new StandardEnvironment();
        environment.getPropertySources().addFirst(new MapPropertySource("issueInviteCommand", Map.of(
                "logging.level.root", "WARN",
                "logging.level.com.lulu.campusmarketbackend", "WARN",
                // MyBatis-Plus 自己的启动横幅直接写标准输出，不受日志级别控制
                "mybatis-plus.global-config.banner", "false")));
        app.setEnvironment(environment);
        return app;
    }

    /** 运行命令并返回进程退出码（main 用它调用 System.exit；测试直接调用）。 */
    public static int run(Class<?> source, String[] args) {
        ConfigurableApplicationContext context;
        try {
            context = application(source).run(args);
        } catch (RuntimeException e) {
            System.err.println("签发邀请码失败：应用启动失败（" + rootMessage(e) + "）");
            return 1;
        }
        return SpringApplication.exit(context);
    }

    // ================= 执行 =================

    @Override
    public void run(ApplicationArguments args) {
        if (context instanceof WebServerApplicationContext) {
            throw new IllegalStateException("签发邀请码只能用命令行参数 --" + SCHOOL + "=<学校 id> 单独运行，不能与 Web 服务一起启动");
        }
        try {
            String school = environment.getProperty(SCHOOL, "").trim();
            int maxUses = integer("max-uses", 1);
            int days = integer("days", 7);
            String note = environment.getProperty(PREFIX + "note");
            note = note == null || note.isBlank() ? null : note.trim();
            RegistrationInvites.validate(maxUses, days, note);
            List<Boolean> active = jdbc.queryForList("SELECT active FROM schools WHERE id = ?", Boolean.class, school);
            if (school.isEmpty() || active.isEmpty() || !Boolean.TRUE.equals(active.get(0)) || !demo.visible(school)) {
                throw ApiException.badRequest("学校「" + school + "」不存在或已停用（学校 id 见学校数据包，例如 aust）");
            }
            RegistrationInvites.Issued issued = invites.issue(school, maxUses, days, note, null);
            System.out.println("邀请码：" + issued.code() + "（" + issued.maxUses() + " 次，至 " + EXPIRES.format(issued.expiresAt()) + "）");
            System.out.flush();
        } catch (ApiException e) {
            System.err.println("签发邀请码失败：" + e.getMessage());
            exitCode = FAILED;
        }
    }

    @Override
    public int getExitCode() {
        return exitCode;
    }

    private int integer(String name, int fallback) {
        String raw = environment.getProperty(PREFIX + name);
        if (raw == null || raw.isBlank()) return fallback;
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            throw ApiException.badRequest("--" + PREFIX + name + " 必须是整数");
        }
    }

    private static String rootMessage(Throwable e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        return root.getMessage() == null ? root.getClass().getSimpleName() : root.getMessage();
    }
}
