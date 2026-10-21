package com.lulu.campusmarketbackend;

import com.lulu.campusmarketbackend.registration.IssueInviteCommand;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class CampusMarketBackendApplication {

    public static void main(String[] args) {
        // 首次部署的引导命令：签发一张注册邀请码后退出，不启动 Web 服务（见 IssueInviteCommand、docs/registration-invites.md）
        if (IssueInviteCommand.requested(args)) {
            System.exit(IssueInviteCommand.run(CampusMarketBackendApplication.class, args));
        }
        SpringApplication.run(CampusMarketBackendApplication.class, args);
    }

}
