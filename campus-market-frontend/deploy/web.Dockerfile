FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
COPY packages ./packages
RUN npm run build:rest
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
# .inc 后缀：nginx 只自动加载 conf.d/*.conf，这个文件由 default.conf 显式 include
COPY deploy/nginx/security-headers.conf /etc/nginx/conf.d/security-headers.conf.inc
