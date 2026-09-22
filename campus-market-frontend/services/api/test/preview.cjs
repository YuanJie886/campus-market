// Local UI verification only. Never used by the production start command.
const { PGlite } = require("@electric-sql/pglite");
const { readFile, mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomBytes } = require("node:crypto");
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = randomBytes(32).toString("hex");
const { createApp } = require("../dist/app");
const { seed } = require("../dist/seed-data");
(async () => {
  const data = await mkdtemp(join(tmpdir(), "campus-preview-"));
  const pg = new PGlite(data);
  await pg.exec(
    await readFile("../../database/migrations/001_initial.sql", "utf8"),
  );
  let queue = Promise.resolve();
  const serial = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  const db = {
    query: (q, v) => serial(() => pg.query(q, v)),
    transaction: (fn) =>
      serial(() =>
        pg.transaction((tx) => fn({ query: (q, v) => tx.query(q, v) })),
      ),
  };
  await seed(db, "preview-password-2026");
  const app = await createApp(db);
  await app.listen(3000, "127.0.0.1");
  console.log("UI test API on 127.0.0.1:3000; temporary database:", data);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      await pg.close();
      process.exit(0);
    });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
