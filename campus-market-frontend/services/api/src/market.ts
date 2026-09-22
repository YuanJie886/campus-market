import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Database, Sql } from "./database";
import {
  parse,
  productSchema,
  querySchema,
  contentSchema,
  profileSchema,
  id,
} from "./validation";
import {
  productView,
  favoriteView,
  commentView,
  conversationView,
  messageView,
  userView,
} from "./projections";
@Injectable()
export class MarketService {
  constructor(private db: Database) {}
  async user(uid: string, own = false) {
    const r = (await this.db.query("SELECT * FROM users WHERE id=$1", [uid]))
      .rows[0];
    if (!r) throw new NotFoundException("用户不存在");
    return userView(r, own);
  }
  async profile(uid: string, body: unknown) {
    const v = parse(profileSchema, body),
      entries = Object.entries(v);
    if (entries.length)
      await this.db.query(
        `UPDATE users SET ${entries.map(([k], i) => `${k}=$${i + 2}`).join(",")} WHERE id=$1`,
        [uid, ...entries.map(([, v]) => v)],
      );
    return this.user(uid, true);
  }
  async products(query: unknown, uid?: string) {
    const v = parse(querySchema, query),
      values: any[] = [uid ?? null],
      clauses = ["(status<>'已下架' OR seller_id=$1)"];
    for (const field of ["category", "campus", "condition"] as const)
      if (v[field]) {
        values.push(v[field]);
        clauses.push(`${field}=$${values.length}`);
      }
    if (v.keyword) {
      values.push(`%${v.keyword.replace(/[\\%_]/g, "\\$&")}%`);
      clauses.push(
        `(title ILIKE $${values.length} OR description ILIKE $${values.length})`,
      );
    }
    for (const [field, op] of [
      ["minPrice", ">="],
      ["maxPrice", "<="],
    ] as const)
      if (v[field] !== undefined) {
        values.push(v[field]);
        clauses.push(`price${op}$${values.length}`);
      }
    const where = clauses.join(" AND "),
      sorts = {
        latest: "created_at DESC",
        priceAsc: "price ASC",
        priceDesc: "price DESC",
        views: "views DESC",
      };
    const count = await this.db.query(
      `SELECT count(*) FROM products WHERE ${where}`,
      values,
    );
    const { rows } = await this.db.query(
      `SELECT * FROM products WHERE ${where} ORDER BY ${sorts[v.sort]},id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, v.pageSize, (v.page - 1) * v.pageSize],
    );
    return {
      items: rows.map((r) => productView(r, r.seller_id === uid)),
      total: Number(count.rows[0].count),
      page: v.page,
      pageSize: v.pageSize,
    };
  }
  async product(pid: string, uid?: string) {
    const r = (await this.db.query("SELECT * FROM products WHERE id=$1", [pid]))
      .rows[0];
    if (!r || (r.status === "已下架" && r.seller_id !== uid)) {
      const related =
        uid &&
        (
          await this.db.query(
            "SELECT id FROM orders WHERE product_id=$1 AND (buyer_id=$2 OR seller_id=$2)",
            [pid, uid],
          )
        ).rows.length;
      if (!r || !related) throw new NotFoundException("商品不存在或已下架");
    }
    return productView(r, uid === r.seller_id);
  }
  async createProduct(uid: string, body: unknown) {
    const v = parse(productSchema, body);
    const { rows } = await this.db.query(
      `INSERT INTO products(id,seller_id,title,description,price,original_price,category,condition,campus,images,contact) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        randomUUID(),
        uid,
        v.title,
        v.description,
        v.price,
        v.originalPrice ?? null,
        v.category,
        v.condition,
        v.campus,
        JSON.stringify(v.images),
        v.contact,
      ],
    );
    return productView(rows[0], true);
  }
  async updateProduct(
    uid: string,
    pid: string,
    body: unknown,
    status?: string,
  ) {
    const v = status ? {} : parse(productSchema.partial(), body);
    if (status && !["在售", "已售出", "已下架"].includes(status))
      throw new BadRequestException("商品状态无效");
    return this.db.transaction(async (tx) => {
      const p = (
        await tx.query("SELECT * FROM products WHERE id=$1 FOR UPDATE", [pid])
      ).rows[0];
      if (!p) throw new NotFoundException("商品不存在");
      if (p.seller_id !== uid)
        throw new ForbiddenException("只能修改自己的商品");
      if (p.status === "预约中")
        throw new ConflictException("请先处理当前预约，再修改商品");
      const entries: [string, any][] = Object.entries(v).map(([key, value]) => [
        key === "originalPrice" ? "original_price" : key,
        key === "images" ? JSON.stringify(value) : value,
      ]);
      if (status)
        entries.push(
          ["status", status],
          ["sold_at", status === "已售出" ? new Date() : null],
        );
      if (entries.length)
        await tx.query(
          `UPDATE products SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(",")} WHERE id=$1`,
          [pid, ...entries.map(([, value]) => value)],
        );
      return productView(
        (await tx.query("SELECT * FROM products WHERE id=$1", [pid])).rows[0],
        true,
      );
    });
  }
  async favorites(uid: string) {
    return (
      await this.db.query(
        "SELECT * FROM favorites WHERE user_id=$1 ORDER BY created_at DESC",
        [uid],
      )
    ).rows.map(favoriteView);
  }
  async favorite(uid: string, pid: string) {
    await this.product(pid, uid);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [uid]);
      const existing = await tx.query(
        "DELETE FROM favorites WHERE user_id=$1 AND product_id=$2 RETURNING id",
        [uid, pid],
      );
      if (existing.rows.length) return { active: false };
      await tx.query(
        "INSERT INTO favorites(id,user_id,product_id) VALUES($1,$2,$3)",
        [randomUUID(), uid, pid],
      );
      return { active: true };
    });
  }
  async comments(pid: string, uid?: string) {
    await this.product(pid, uid);
    return (
      await this.db.query(
        "SELECT * FROM comments WHERE product_id=$1 ORDER BY created_at",
        [pid],
      )
    ).rows.map(commentView);
  }
  async comment(uid: string, pid: string, body: unknown) {
    await this.product(pid, uid);
    const v = parse(contentSchema, body);
    if (
      v.parentId &&
      !(
        await this.db.query(
          "SELECT id FROM comments WHERE id=$1 AND product_id=$2 AND parent_id IS NULL",
          [v.parentId, pid],
        )
      ).rows.length
    )
      throw new BadRequestException("回复对象无效");
    return commentView(
      (
        await this.db.query(
          "INSERT INTO comments(id,product_id,user_id,content,parent_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [randomUUID(), pid, uid, v.content, v.parentId ?? null],
        )
      ).rows[0],
    );
  }
  async conversations(uid: string) {
    return (
      await this.db.query(
        "SELECT * FROM conversations WHERE buyer_id=$1 OR seller_id=$1 ORDER BY updated_at DESC",
        [uid],
      )
    ).rows.map(conversationView);
  }
  async conversation(uid: string, pid: string) {
    const p = await this.product(pid, uid);
    if (p.sellerId === uid) throw new BadRequestException("不能咨询自己的商品");
    return conversationView(
      (
        await this.db.query(
          "INSERT INTO conversations(id,product_id,buyer_id,seller_id) VALUES($1,$2,$3,$4) ON CONFLICT(product_id,buyer_id) DO UPDATE SET product_id=EXCLUDED.product_id RETURNING *",
          [randomUUID(), pid, uid, p.sellerId],
        )
      ).rows[0],
    );
  }
  private async member(tx: Sql, uid: string, cid: string) {
    const c = (await tx.query("SELECT * FROM conversations WHERE id=$1", [cid]))
      .rows[0];
    if (!c || ![c.buyer_id, c.seller_id].includes(uid))
      throw new ForbiddenException("无权访问会话");
  }
  async messages(uid: string, cid: string) {
    await this.member(this.db, uid, cid);
    return (
      await this.db.query(
        "SELECT * FROM messages WHERE conversation_id=$1 ORDER BY created_at,id",
        [cid],
      )
    ).rows.map(messageView);
  }
  async message(uid: string, cid: string, body: unknown) {
    const v = parse(contentSchema, body);
    return this.db.transaction(async (tx) => {
      await this.member(tx, uid, cid);
      const { rows } = await tx.query(
        "INSERT INTO messages(id,conversation_id,sender_id,content) VALUES($1,$2,$3,$4) RETURNING *",
        [randomUUID(), cid, uid, v.content],
      );
      await tx.query("UPDATE conversations SET updated_at=now() WHERE id=$1", [
        cid,
      ]);
      return messageView(rows[0]);
    });
  }
  async read(uid: string, cid: string) {
    await this.member(this.db, uid, cid);
    await this.db.query(
      "INSERT INTO conversation_reads(conversation_id,user_id) VALUES($1,$2) ON CONFLICT(conversation_id,user_id) DO UPDATE SET read_at=now()",
      [cid, uid],
    );
  }
  async unread(uid: string) {
    const { rows } = await this.db.query(
      `SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=$1 WHERE (c.buyer_id=$1 OR c.seller_id=$1) AND m.sender_id<>$1 AND (r.read_at IS NULL OR m.created_at>r.read_at)`,
      [uid],
    );
    return { count: Number(rows[0].count) };
  }
}
