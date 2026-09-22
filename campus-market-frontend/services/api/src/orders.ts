import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID, randomInt, createHash } from "node:crypto";
import { Database, Sql } from "./database";
import {
  parse,
  orderSchema,
  transitionSchema,
  reviewSchema,
} from "./validation";
import { orderView, reviewView } from "./projections";
@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  constructor(private db: Database) {}
  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.expire().catch((error) =>
          console.error("订单超时处理失败", error.message),
        ),
      60000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private async event(
    tx: Sql,
    id: string,
    actor: string | null,
    from: string | null,
    to: string,
    reason?: string,
  ) {
    await tx.query(
      "INSERT INTO order_events(id,order_id,actor_id,from_status,to_status,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, actor, from, to, reason ?? null],
    );
  }
  async expire() {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM orders WHERE expires_at<=now() AND status IN ('PENDING_SELLER_CONFIRM','PENDING_MEETING') FOR UPDATE SKIP LOCKED",
      );
      for (const o of rows) {
        await tx.query(
          "UPDATE orders SET status='EXPIRED',updated_at=now() WHERE id=$1",
          [o.id],
        );
        await tx.query(
          "UPDATE products SET status='在售' WHERE id=$1 AND status='预约中'",
          [o.product_id],
        );
        await this.event(
          tx,
          o.id,
          null,
          o.status,
          "EXPIRED",
          "预约超时自动释放",
        );
      }
    });
  }
  async create(uid: string, body: unknown) {
    const v = parse(orderSchema, body),
      meeting = new Date(v.meetingAtIso).getTime();
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(v))
      .digest("hex");
    await this.expire();
    return this.db.transaction(async (tx) => {
      // Serializes identical buyer requests before the product lock, including different products.
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [uid]);
      const duplicate = (
        await tx.query(
          "SELECT * FROM orders WHERE buyer_id=$1 AND idempotency_key=$2",
          [uid, v.idempotencyKey],
        )
      ).rows[0];
      if (duplicate) {
        if (duplicate.request_hash !== fingerprint)
          throw new ConflictException("幂等键不能用于不同预约");
        return orderView(duplicate, uid);
      }
      if (meeting <= Date.now() + 60000 || meeting > Date.now() + 30 * 86400000)
        throw new BadRequestException("请选择一分钟后至 30 天内的面交时间");
      const p = (
        await tx.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [
          v.productId,
        ])
      ).rows[0];
      if (!p) throw new NotFoundException("商品不存在");
      if (p.seller_id === uid)
        throw new ForbiddenException("不能预约自己的商品");
      if (p.status !== "在售")
        throw new ConflictException("商品已被预约或不可购买");
      const point = (
        await tx.query(
          "SELECT * FROM meeting_points WHERE id=$1 AND campus_id=$2",
          [v.meetingPointId, p.campus],
        )
      ).rows[0];
      if (!point)
        throw new BadRequestException("请选择商品所在校区的公共交易点");
      const buyer = (
        await tx.query("SELECT campus FROM users WHERE id=$1", [uid])
      ).rows[0];
      const schools = await tx.query(
        "SELECT DISTINCT school_id FROM campuses WHERE id IN ($1,$2)",
        [buyer.campus, p.campus],
      );
      if (schools.rows.length !== 1)
        throw new ForbiddenException("仅支持同校交易");
      const oid = randomUUID();
      const { rows } = await tx.query(
        `INSERT INTO orders(id,product_id,buyer_id,seller_id,price,status,meeting_point_id,meeting_at,contact,confirmation_code,idempotency_key,request_hash,expires_at)
        VALUES($1,$2,$3,$4,$5,'PENDING_SELLER_CONFIRM',$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [
          oid,
          p.id,
          uid,
          p.seller_id,
          p.price,
          v.meetingPointId,
          v.meetingAtIso,
          v.contact,
          String(randomInt(100000, 1000000)),
          v.idempotencyKey,
          fingerprint,
          new Date(Math.min(meeting, Date.now() + 24 * 3600000)),
        ],
      );
      await tx.query("UPDATE products SET status='预约中' WHERE id=$1", [p.id]);
      await this.event(tx, oid, uid, null, "PENDING_SELLER_CONFIRM");
      return orderView(rows[0], uid);
    });
  }
  async list(uid: string, role: string) {
    await this.expire();
    if (!["all", "buyer", "seller"].includes(role))
      throw new BadRequestException("订单角色无效");
    const condition =
      role === "buyer"
        ? "buyer_id=$1"
        : role === "seller"
          ? "seller_id=$1"
          : "(buyer_id=$1 OR seller_id=$1)";
    const { rows } = await this.db.query(
      `SELECT * FROM orders WHERE ${condition} ORDER BY created_at DESC`,
      [uid],
    );
    const reviews = (
      await this.db.query(
        "SELECT r.* FROM reviews r JOIN orders o ON o.id=r.order_id WHERE o.buyer_id=$1 OR o.seller_id=$1",
        [uid],
      )
    ).rows;
    return rows.map((o) =>
      orderView(
        o,
        uid,
        reviews.filter((r) => r.order_id === o.id),
      ),
    );
  }
  async transition(uid: string, oid: string, body: unknown) {
    const v = parse(transitionSchema, body);
    await this.expire();
    const result = await this.db.transaction(async (tx) => {
      const o = (
        await tx.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [oid])
      ).rows[0];
      if (!o) throw new NotFoundException("订单不存在");
      if (![o.buyer_id, o.seller_id].includes(uid))
        throw new ForbiddenException("无权操作订单");
      const buyer = uid === o.buyer_id;
      const allowed =
        (v.to === "CANCELLED" &&
          ["PENDING_SELLER_CONFIRM", "PENDING_MEETING"].includes(o.status)) ||
        (v.to === "PENDING_MEETING" &&
          !buyer &&
          o.status === "PENDING_SELLER_CONFIRM") ||
        (v.to === "BUYER_CONFIRMED" &&
          buyer &&
          o.status === "PENDING_MEETING") ||
        (v.to === "COMPLETED" && !buyer && o.status === "BUYER_CONFIRMED");
      if (!allowed)
        throw new ConflictException("当前角色或订单状态不允许此操作");
      if (
        v.to === "COMPLETED" &&
        (o.code_attempts >= 5 || v.confirmationCode !== o.confirmation_code)
      ) {
        await tx.query(
          "UPDATE orders SET code_attempts=code_attempts+1 WHERE id=$1",
          [oid],
        );
        return { invalidCode: true as const };
      }
      if (v.to === "COMPLETED")
        await this.event(tx, oid, uid, o.status, "SELLER_CONFIRMED");
      const { rows } = await tx.query(
        "UPDATE orders SET status=$1,updated_at=now(),expires_at=CASE WHEN $1='PENDING_MEETING' THEN meeting_at+interval '24 hours' ELSE expires_at END WHERE id=$2 RETURNING *",
        [v.to, oid],
      );
      if (v.to === "CANCELLED")
        await tx.query(
          "UPDATE products SET status='在售' WHERE id=$1 AND status='预约中'",
          [o.product_id],
        );
      if (v.to === "COMPLETED")
        await tx.query(
          "UPDATE products SET status='已售出',sold_at=now() WHERE id=$1",
          [o.product_id],
        );
      await this.event(
        tx,
        oid,
        uid,
        v.to === "COMPLETED" ? "SELLER_CONFIRMED" : o.status,
        v.to,
        v.reason,
      );
      return orderView(rows[0], uid);
    });
    if ("invalidCode" in result)
      throw new BadRequestException(
        "确认码错误或已达 5 次上限，请联系运营人员处理",
      );
    return result;
  }
  async review(uid: string, oid: string, body: unknown) {
    const v = parse(reviewSchema, body);
    return this.db.transaction(async (tx) => {
      const o = (
        await tx.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [oid])
      ).rows[0];
      if (!o || ![o.buyer_id, o.seller_id].includes(uid))
        throw new ForbiddenException("无权评价");
      if (o.status !== "COMPLETED")
        throw new ConflictException("完成交易后才能评价");
      const { rows } = await tx.query(
        "INSERT INTO reviews(id,order_id,reviewer_id,rating,comment) VALUES($1,$2,$3,$4,$5) RETURNING *",
        [randomUUID(), oid, uid, v.rating, v.comment],
      );
      return reviewView(rows[0]);
    });
  }
}
