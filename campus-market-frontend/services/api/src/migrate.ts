import { Database, migrate } from "./database";
const db = new Database();
migrate(db)
  .then(() => console.log("数据库迁移完成"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.onModuleDestroy());
