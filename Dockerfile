# App shell + media origin. The shell is built here from git-tracked sources;
# catalog/ and media/ are not in the image. They are mounted at /srv/data
# (rsynced by deploy/sync.sh on the server, or ./release locally).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Same-origin build: catalog and media resolve against the page (./catalog, ./media).
RUN npx tsc -p . && npx vite build

FROM nginx:1.31-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
