package com.lulu.campusmarketbackend.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.lulu.campusmarketbackend.api.ApiException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 阶段 3：AppID / AppSecret 任一缺失时微信登录视为未开通，不发出任何请求。 */
class WeChatClientTest {
    @Test void missingCredentialsMeanDisabledWithoutCallingWechat() {
        for (String[] config : new String[][]{{"", ""}, {"wx-app", ""}, {"", "secret"}, {"  ", "  "}}) {
            WeChatClient client = new WeChatClient(config[0], config[1], "http://127.0.0.1:9", new ObjectMapper());
            assertThat(client.enabled()).isFalse();
            assertThatThrownBy(() -> client.exchange("valid-code")).isInstanceOfSatisfying(ApiException.class,
                    e -> assertThat(e.status()).isEqualTo(503));
        }
        assertThat(new WeChatClient("wx-app", "secret", "http://127.0.0.1:9/", new ObjectMapper()).enabled()).isTrue();
    }

    @Test void unreachableWechatIsReportedWithoutLeakingTheSecret() {
        WeChatClient client = new WeChatClient("wx-app", "super-secret-value", "http://127.0.0.1:9", new ObjectMapper());
        assertThatThrownBy(() -> client.exchange("valid-code")).isInstanceOfSatisfying(ApiException.class, e -> {
            assertThat(e.status()).isEqualTo(503);
            assertThat(e.getMessage()).doesNotContain("super-secret-value").doesNotContain("valid-code");
        });
    }
}
