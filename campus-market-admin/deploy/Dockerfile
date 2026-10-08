FROM node:24-alpine AS build
WORKDIR /app
COPY campus-market-admin/package*.json ./
RUN npm ci
COPY campus-market-admin/ ./
RUN npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html/admin
COPY campus-market-admin/deploy/nginx.conf /etc/nginx/conf.d/default.conf
