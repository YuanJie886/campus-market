import "reflect-metadata";
import {
  Module,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { map } from "rxjs";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { Database } from "./database";
import { AuthService } from "./auth";
import { MarketService } from "./market";
import { OrdersService } from "./orders";
import { ApiController } from "./controller";
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(e: any, host: ArgumentsHost) {
    const status =
      e instanceof HttpException
        ? e.getStatus()
        : e.code === "23505"
          ? 409
          : e.code === "23503"
            ? 400
            : 500;
    const message =
      e instanceof HttpException
        ? e.message
        : status === 409
          ? "记录已存在，请勿重复操作"
          : status === 400
            ? "关联记录无效"
            : "服务暂时不可用";
    if (status === 500) console.error(e);
    host
      .switchToHttp()
      .getResponse()
      .status(status)
      .json({ code: status, data: null, message, requestId: randomUUID() });
  }
}
@Module({
  controllers: [ApiController],
  providers: [Database, AuthService, MarketService, OrdersService],
})
export class AppModule {}
export async function createApp(database?: Database) {
  // A separate module allows integration tests to exercise the same HTTP controller and SQL services.
  @Module({
    controllers: [ApiController],
    providers: [
      { provide: Database, useValue: database },
      AuthService,
      MarketService,
      OrdersService,
    ],
  })
  class TestModule {}
  const app = await NestFactory.create(database ? TestModule : AppModule, {
    logger: process.env.NODE_ENV === "test" ? false : undefined,
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    credentials: true,
  });
  app.use(
    "/v1",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { code: 429, data: null, message: "请求过于频繁，请稍后重试" },
    }),
  );
  app.use(
    "/v1/auth/login",
    rateLimit({
      windowMs: 15 * 60000,
      limit: 20,
      skipSuccessfulRequests: true,
      message: { code: 429, data: null, message: "登录尝试过多，请稍后重试" },
    }),
  );
  app.use(
    "/v1/auth/register",
    rateLimit({
      windowMs: 3600000,
      limit: 10,
      message: { code: 429, data: null, message: "注册过于频繁" },
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  app.useGlobalInterceptors({
    intercept(_ctx, next) {
      return next
        .handle()
        .pipe(map((data) => ({ code: 0, data: data ?? null, message: "ok" })));
    },
  });
  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("校园集市 API")
      .setDescription(
        "第一阶段：账号、商品、收藏、面交预约、评价与站内消息。详见 docs/backend.md 的请求示例。",
      )
      .setVersion("1.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("docs", app, doc);
  app.enableShutdownHooks();
  return app;
}
