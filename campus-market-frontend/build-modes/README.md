# build-modes

`npm run build:rest` / `npm run build:mock` 把 Vite 的 `envDir` 指向这个目录。这里**刻意不放任何 `.env` 文件**：
显式模式的构建结果只由命令决定，不受开发者本机 `.env`（例如 `VITE_API_MODE=mock`）影响。
REST 构建使用同源 `/v1` 与默认超时；需要不同的 API 地址时请在部署层（Nginx 反向代理）处理，而不是在这里加 `.env`。
