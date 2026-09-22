const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { PGlite } = require("@electric-sql/pglite");
process.env.JWT_SECRET = "test-only-secret-at-least-thirty-two-characters";
process.env.NODE_ENV = "test";
const { createApp } = require("../dist/app");
let pg,
  app,
  base,
  queue = Promise.resolve();
const serial = (work) => {
  const next = queue.then(work);
  queue = next.catch(() => {});
  return next;
};
before(async () => {
  pg = new PGlite();
  await pg.exec(
    await readFile("../../database/migrations/001_initial.sql", "utf8"),
  );
  const db = {
    query: (sql, values) => serial(() => pg.query(sql, values)),
    transaction: (fn) =>
      serial(() =>
        pg.transaction((tx) =>
          fn({ query: (sql, values) => tx.query(sql, values) }),
        ),
      ),
  };
  app = await createApp(db);
  await app.listen(0, "127.0.0.1");
  base = await app.getUrl();
});
after(async () => {
  await app?.close();
  await pg?.close();
});
async function call(path, { method = "GET", token, body, cookie } = {}) {
  const response = await fetch(base + "/v1" + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  return {
    status: response.status,
    ...result,
    cookie: response.headers.get("set-cookie"),
  };
}
const listing = {
  title: "高等数学教材",
  description: "干净整洁，可以图书馆面交",
  price: 25,
  category: "教材书籍",
  condition: "轻微使用痕迹",
  campus: "东校区",
  images: [],
  contact: "13800000001",
};
async function register(name) {
  const r = await call("/auth/register", {
    method: "POST",
    body: {
      account: name,
      password: "StrongPass123",
      nickname: name,
      campus: "东校区",
      contact: "13800000001",
    },
  });
  assert.equal(r.code, 0, r.message);
  return r;
}
test("数据库/API 完整交易、隔离与持久化", async () => {
  const seller = await register("seller"),
    buyer = await register("buyer"),
    stranger = await register("stranger");
  const st = seller.data.accessToken,
    bt = buyer.data.accessToken,
    xt = stranger.data.accessToken;
  assert.equal(seller.data.user.password, undefined);
  assert.equal(seller.data.user.password_hash, undefined);
  const hashes = await pg.query("SELECT password_hash FROM users");
  assert.ok(hashes.rows.every((u) => u.password_hash.startsWith("$2")));
  assert.equal(
    (
      await call("/auth/login", {
        method: "POST",
        body: { account: "seller", password: "wrong" },
      })
    ).status,
    401,
  );
  assert.equal(
    (await call("/products", { method: "POST", body: listing })).status,
    401,
  );
  const created = await call("/products", {
    method: "POST",
    token: st,
    body: listing,
  });
  assert.equal(created.code, 0, created.message);
  const pid = created.data.id;
  assert.equal(
    (
      await call("/products/" + pid, {
        method: "PATCH",
        token: xt,
        body: { price: 1 },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call("/products/" + pid, {
        method: "PATCH",
        token: st,
        body: { sellerId: stranger.data.user.id },
      })
    ).status,
    400,
  );
  assert.equal((await call("/products/" + pid)).data.contact, "");
  const publicUser = (await call("/users/" + seller.data.user.id)).data;
  assert.equal(publicUser.account, undefined);
  assert.equal(publicUser.contact, undefined);
  assert.equal((await call("/products?keyword=高等&pageSize=1")).data.total, 1);
  assert.equal((await call("/products?minPrice=26")).data.total, 0);
  await call("/products/" + pid + "/favorite", { method: "PUT", token: bt });
  assert.equal((await call("/favorites", { token: bt })).data.length, 1);
  assert.equal((await call("/favorites", { token: xt })).data.length, 0);
  const reservation = {
    productId: pid,
    meetingPointId: "东校区-library",
    meetingAtIso: new Date(Date.now() + 3600000).toISOString(),
    contact: "13800000002",
    idempotencyKey: "booking-1",
  };
  assert.equal(
    (await call("/orders", { method: "POST", token: st, body: reservation }))
      .status,
    403,
  );
  assert.equal(
    (
      await call("/orders", {
        method: "POST",
        token: bt,
        body: { ...reservation, meetingPointId: "西校区-library" },
      })
    ).status,
    400,
  );
  const order = await call("/orders", {
    method: "POST",
    token: bt,
    body: reservation,
  });
  assert.equal(order.code, 0, order.message);
  const oid = order.data.id;
  const retry = await call("/orders", {
    method: "POST",
    token: bt,
    body: reservation,
  });
  assert.equal(retry.data.id, oid);
  assert.equal(
    (
      await call("/orders", {
        method: "POST",
        token: bt,
        body: { ...reservation, contact: "different" },
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("/orders", {
        method: "POST",
        token: xt,
        body: { ...reservation, idempotencyKey: "other" },
      })
    ).status,
    409,
  );
  assert.equal((await call("/orders?role=all", { token: xt })).data.length, 0);
  assert.equal(
    (await call("/orders?role=all", { token: st })).data[0].confirmationCode,
    undefined,
  );
  const transition = (token, to, code) =>
    call("/orders/" + oid + "/transitions", {
      method: "POST",
      token,
      body: { to, ...(code ? { confirmationCode: code } : {}) },
    });
  assert.equal((await transition(xt, "CANCELLED")).status, 403);
  assert.equal((await transition(bt, "PENDING_MEETING")).status, 409);
  assert.equal(
    (await transition(st, "COMPLETED", order.data.confirmationCode)).status,
    409,
  );
  assert.equal(
    (
      await call("/orders/" + oid + "/reviews", {
        method: "POST",
        token: bt,
        body: { rating: 5, comment: "很好" },
      })
    ).status,
    409,
  );
  assert.equal((await transition(st, "PENDING_MEETING")).code, 0);
  assert.equal((await transition(bt, "BUYER_CONFIRMED")).code, 0);
  assert.equal((await transition(st, "COMPLETED", "000000")).status, 400);
  assert.equal(
    (await transition(st, "COMPLETED", order.data.confirmationCode)).data
      .status,
    "已完成",
  );
  assert.equal((await call("/products/" + pid)).data.status, "已售出");
  assert.equal((await transition(bt, "CANCELLED")).status, 409);
  assert.equal(
    (
      await call("/orders/" + oid + "/reviews", {
        method: "POST",
        token: bt,
        body: { rating: 5, comment: "很好" },
      })
    ).code,
    0,
  );
  assert.equal(
    (
      await call("/orders/" + oid + "/reviews", {
        method: "POST",
        token: bt,
        body: { rating: 5, comment: "重复" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await call("/orders?role=buyer", { token: bt })).data[0].buyerReview
      .rating,
    5,
  );
  const events = await pg.query(
    "SELECT to_status FROM order_events WHERE order_id=$1 ORDER BY created_at",
    [oid],
  );
  assert.deepEqual(
    events.rows.map((e) => e.to_status),
    [
      "PENDING_SELLER_CONFIRM",
      "PENDING_MEETING",
      "BUYER_CONFIRMED",
      "SELLER_CONFIRMED",
      "COMPLETED",
    ],
  );
  const conversation = await call("/conversations", {
    method: "POST",
    token: bt,
    body: { productId: pid },
  });
  const cid = conversation.data.id;
  assert.equal(
    (await call("/conversations/" + cid + "/messages", { token: xt })).status,
    403,
  );
  await call("/conversations/" + cid + "/messages", {
    method: "POST",
    token: bt,
    body: { content: "你好" },
  });
  assert.equal((await call("/messages/unread", { token: st })).data.count, 1);
  await call("/conversations/" + cid + "/read", { method: "POST", token: st });
  assert.equal((await call("/messages/unread", { token: st })).data.count, 0);
  const refreshed = await call("/auth/refresh", {
    method: "POST",
    cookie: buyer.cookie.split(";")[0],
  });
  assert.equal(refreshed.code, 0, refreshed.message);
  assert.equal(
    (
      await call("/auth/refresh", {
        method: "POST",
        cookie: buyer.cookie.split(";")[0],
      })
    ).status,
    401,
  );
  await call("/auth/logout", {
    method: "POST",
    cookie: refreshed.cookie.split(";")[0],
  });
  assert.equal(
    (await call("/auth/me", { token: refreshed.data.accessToken })).status,
    401,
  );
});
test("取消和超时释放，重复竞争只能成功一次", async () => {
  const seller = await register("seller2"),
    buyer = await register("buyer2"),
    other = await register("other2"),
    st = seller.data.accessToken,
    bt = buyer.data.accessToken;
  const p = await call("/products", {
    method: "POST",
    token: st,
    body: listing,
  });
  const pid = p.data.id;
  const body = {
    productId: pid,
    meetingPointId: "东校区-library",
    meetingAtIso: new Date(Date.now() + 3600000).toISOString(),
    contact: "13800000002",
    idempotencyKey: "race",
  };
  const results = await Promise.all(
    [bt, other.data.accessToken].map((token) =>
      call("/orders", { method: "POST", token, body }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.code).sort((a, b) => a - b),
    [0, 409],
  );
  const winner = results.findIndex((r) => r.code === 0),
    token = winner === 0 ? bt : other.data.accessToken,
    oid = results[winner].data.id;
  assert.equal(
    (
      await call("/products/" + pid + "/status", {
        method: "POST",
        token: st,
        body: { status: "在售" },
      })
    ).status,
    409,
  );
  await call("/orders/" + oid + "/transitions", {
    method: "POST",
    token,
    body: { to: "CANCELLED" },
  });
  assert.equal((await call("/products/" + pid)).data.status, "在售");
  const order = await call("/orders", {
    method: "POST",
    token: bt,
    body: { ...body, idempotencyKey: "timeout" },
  });
  await pg.query(
    "UPDATE orders SET expires_at=now()-interval '1 second' WHERE id=$1",
    [order.data.id],
  );
  const list = await call("/orders?role=buyer", { token: bt });
  assert.equal(
    list.data.find((o) => o.id === order.data.id).canonicalStatus,
    "EXPIRED",
  );
  assert.equal((await call("/products/" + pid)).data.status, "在售");
});
