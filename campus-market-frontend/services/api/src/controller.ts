import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Param,
  Body,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags, ApiBody } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuthService } from "./auth";
import { MarketService } from "./market";
import { OrdersService } from "./orders";
import { Database } from "./database";
import {
  id,
  registerSchema,
  loginSchema,
  profileSchema,
  productSchema,
  orderSchema,
  transitionSchema,
  reviewSchema,
  contentSchema,
} from "./validation";
import { z } from "zod";
const schemaBody = (schema: z.ZodType) =>
  ApiBody({
    schema: z.toJSONSchema(schema, { unrepresentable: "any" }) as any,
  });
@ApiTags("校园集市")
@ApiBearerAuth()
@Controller("v1")
export class ApiController {
  constructor(
    private auth: AuthService,
    private market: MarketService,
    private orders: OrdersService,
    private db: Database,
  ) {}
  private async uid(req: Request) {
    return (await this.auth.authenticate(req))!;
  }
  @Get("health") async health() {
    await this.db.query("SELECT 1");
    return { status: "ok" };
  }
  @Post("auth/register")
  @schemaBody(registerSchema)
  @ApiOperation({ summary: "注册账号（至少 8 位密码）" })
  register(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.auth.register(body, res);
  }
  @Post("auth/login") @schemaBody(loginSchema) login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, res);
  }
  @Post("auth/refresh") refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.refresh(req, res);
  }
  @Post("auth/logout") logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.logout(req, res);
  }
  @Get("auth/me") async me(@Req() req: Request) {
    return this.market.user(await this.uid(req), true);
  }
  @Patch("auth/me") @schemaBody(profileSchema) async profile(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.market.profile(await this.uid(req), body);
  }
  @Get("users/:id") user(@Param("id") uid: string) {
    return this.market.user(id(uid));
  }
  @Get("meeting-points") async points() {
    return (
      await this.db.query(
        "SELECT id,campus_id AS campus,name FROM meeting_points ORDER BY id",
      )
    ).rows;
  }
  @Get("products") async products(
    @Query() query: unknown,
    @Req() req: Request,
  ) {
    return this.market.products(query, await this.auth.authenticate(req, true));
  }
  @Get("products/:id") async product(
    @Param("id") pid: string,
    @Req() req: Request,
  ) {
    return this.market.product(
      id(pid),
      await this.auth.authenticate(req, true),
    );
  }
  @Post("products") @schemaBody(productSchema) async createProduct(
    @Req() req: Request,
    @Body() body: unknown,
  ) {
    return this.market.createProduct(await this.uid(req), body);
  }
  @Patch("products/:id")
  @schemaBody(productSchema.partial())
  async updateProduct(
    @Req() req: Request,
    @Param("id") pid: string,
    @Body() body: unknown,
  ) {
    return this.market.updateProduct(await this.uid(req), id(pid), body);
  }
  @Post("products/:id/status") async status(
    @Req() req: Request,
    @Param("id") pid: string,
    @Body() body: any,
  ) {
    return this.market.updateProduct(
      await this.uid(req),
      id(pid),
      {},
      String(body?.status),
    );
  }
  @Post("products/:id/view") async view(
    @Param("id") pid: string,
    @Req() req: Request,
  ) {
    await this.market.product(id(pid), await this.auth.authenticate(req, true));
    await this.db.query("UPDATE products SET views=views+1 WHERE id=$1", [pid]);
  }
  @Get("favorites") async favorites(@Req() req: Request) {
    return this.market.favorites(await this.uid(req));
  }
  @Put("products/:id/favorite") async favorite(
    @Req() req: Request,
    @Param("id") pid: string,
  ) {
    return this.market.favorite(await this.uid(req), id(pid));
  }
  @Post("orders")
  @schemaBody(orderSchema)
  @ApiOperation({ summary: "预约面交：服务端锁定商品，按买家与幂等键去重" })
  async createOrder(@Req() req: Request, @Body() body: unknown) {
    return this.orders.create(await this.uid(req), body);
  }
  @Get("orders") async ordersList(
    @Req() req: Request,
    @Query("role") role = "all",
  ) {
    return this.orders.list(await this.uid(req), role);
  }
  @Post("orders/:id/transitions")
  @schemaBody(transitionSchema)
  @ApiOperation({ summary: "卖家接单 → 买家确认 → 卖家凭六位码完成" })
  async transition(
    @Req() req: Request,
    @Param("id") oid: string,
    @Body() body: unknown,
  ) {
    return this.orders.transition(await this.uid(req), id(oid), body);
  }
  @Post("orders/:id/reviews") @schemaBody(reviewSchema) async review(
    @Req() req: Request,
    @Param("id") oid: string,
    @Body() body: unknown,
  ) {
    return this.orders.review(await this.uid(req), id(oid), body);
  }
  @Get("products/:id/comments") async comments(
    @Param("id") pid: string,
    @Req() req: Request,
  ) {
    return this.market.comments(
      id(pid),
      await this.auth.authenticate(req, true),
    );
  }
  @Post("products/:id/comments") @schemaBody(contentSchema) async comment(
    @Req() req: Request,
    @Param("id") pid: string,
    @Body() body: unknown,
  ) {
    return this.market.comment(await this.uid(req), id(pid), body);
  }
  @Get("conversations") async conversations(@Req() req: Request) {
    return this.market.conversations(await this.uid(req));
  }
  @Post("conversations") async conversation(
    @Req() req: Request,
    @Body() body: any,
  ) {
    return this.market.conversation(await this.uid(req), id(body?.productId));
  }
  @Get("conversations/:id/messages") async messages(
    @Req() req: Request,
    @Param("id") cid: string,
  ) {
    return this.market.messages(await this.uid(req), id(cid));
  }
  @Post("conversations/:id/messages") @schemaBody(contentSchema) async message(
    @Req() req: Request,
    @Param("id") cid: string,
    @Body() body: unknown,
  ) {
    return this.market.message(await this.uid(req), id(cid), body);
  }
  @Post("conversations/:id/read") async read(
    @Req() req: Request,
    @Param("id") cid: string,
  ) {
    return this.market.read(await this.uid(req), id(cid));
  }
  @Get("messages/unread") async unread(@Req() req: Request) {
    return this.market.unread(await this.uid(req));
  }
}
