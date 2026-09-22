import { Database } from "./database";
import { seed } from "./seed-data";
const db = new Database();
if (process.env.NODE_ENV === "production")
  throw new Error("生产环境禁止导入演示账号");
seed(db, process.env.SEED_PASSWORD ?? "")
  .then(() => console.log("演示用户和商品已导入（不覆盖现有数据）"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.onModuleDestroy());
