import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { hash } from "bcryptjs";
import { Database } from "./database";
function stableId(value: string) {
  const s = createHash("sha256").update(`campus-demo:${value}`).digest("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-8${s.slice(17, 20)}-${s.slice(20, 32)}`;
}
export async function seed(
  db: Pick<Database, "transaction">,
  password: string,
) {
  if (password.length < 8)
    throw new Error("SEED_PASSWORD 至少 8 位，不能使用旧演示密码");
  const data = JSON.parse(
    await readFile(
      resolve(__dirname, "../../../database/seeds/demo.json"),
      "utf8",
    ),
  );
  const passwordHash = await hash(password, 12);
  await db.transaction(async (tx) => {
    for (const u of data.users)
      await tx.query(
        "INSERT INTO users(id,account,password_hash,nickname,avatar,campus,contact,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
        [
          stableId(u.id),
          u.account,
          passwordHash,
          u.nickname,
          u.avatar,
          u.campus,
          u.contact,
          new Date(u.createdAt),
        ],
      );
    for (const p of data.products)
      await tx.query(
        "INSERT INTO products(id,seller_id,title,description,price,original_price,category,condition,campus,images,contact,status,views,created_at,sold_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING",
        [
          stableId(p.id),
          stableId(p.sellerId),
          p.title,
          p.description,
          p.price,
          p.originalPrice ?? null,
          p.category,
          p.condition,
          p.campus,
          JSON.stringify(p.images),
          p.contact,
          p.status,
          p.views,
          new Date(p.createdAt),
          p.soldAt ? new Date(p.soldAt) : null,
        ],
      );
  });
}
