<h2 align="center">Deployment & Reverse Proxy — Self Hosted Expo Updates Server</h2>

## Contents

- [Important](#important)
- [Reverse proxy](#reverse-proxy)
  - [Example parameters](#example-parameters)
- [Apache](#apache)
  - [Apache proxy config for API](#apache-proxy-config-for-api)
  - [Apache proxy config for web interface](#apache-proxy-config-for-web-interface)
- [Nginx](#nginx)
  - [Nginx server block for API](#nginx-server-block-for-api)
  - [Nginx server block for web interface](#nginx-server-block-for-web-interface)
- [Example docker-compose (behind your own proxy)](#example-docker-compose-behind-your-own-proxy)
- [Example docker-compose (automatic TLS with nginx-proxy + acme-companion)](#example-docker-compose-automatic-tls-with-nginx-proxy--acme-companion)

# Important

- Double check parameters in your docker compose file
- If using portainer, you must indicate absolute volume paths. Ie:
  - **/host/absolute/path/to/updates:/updates**
  - **/host/absolute/path/to/uploads:/uploads**
- **FEATHERS_AUTH_SECRET** Can be created here https://jwtsecret.com/generate
- **TRIPLE CHECK** `MONGO_CONN` `PUBLIC_URL` `API_BASE_URL` `MONGO_INITDB_ROOT_PASSWORD`
- If you changed `MONGO_INITDB_ROOT_PASSWORD` or ANY parameter of the mongo DB connection string in `MONGO_CONN` remember to update it in _mongoinit/init.js_

# Reverse proxy

The server is **proxy-agnostic**: it serves manifests, bundles, assets and bsdiff patches over plain HTTP, and the API streams asset/bundle/patch files chunk by chunk (no whole-file buffering). Any reverse proxy works — examples for **Apache** and **Nginx** are below. Pick one; you do not need both.

Two things every proxy must get right for this stack:

- **WebSocket upgrade** on `/socket.io` — the dashboard uses Feathers realtime. Note the SPA is served from the admin domain but opens its realtime socket to `API_BASE_URL` (the **API** domain), using WebSocket-only transport (no polling fallback). So `/socket.io` must be proxied with upgrade support on the **API** vhost only — not on the admin vhost. If the upgrade is dropped, realtime silently stops while REST keeps working.
- **Upload size limit** — publishing an update POSTs the bundle archive, which can be tens of MB. Raise the proxy body-size limit or large publishes fail.

## Example parameters

- Docker api server ports `4300:3000`
- Docker front end port `4080:8080`
- `PUBLIC_URL`: https://updates.testdomain.com
- `API_BASE_URL`: https://updates.testdomain.com
- Frontend url https://webadmin.testdomain.com

You have to configure your host to resolve https://webadmin.testdomain.com and https://updates.testdomain.com

---

## Apache

These configs assume that your docker stack and the web server are on the same host; if not, change the `localhost` occurrences.

### Apache proxy config for API

```
<Proxy />
    Allow from localhost
</Proxy>

ProxyPreserveHost On
ProxyPass /.well-known/ !
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"

ProxyPass "/socket.io" "ws://localhost:4300/socket.io"
ProxyPassReverse "/socket.io" "ws://localhost:4300/socket.io"

ProxyPass "/" "http://localhost:4300/"
ProxyPassReverse "/" "http://localhost:4300/"
```

Raise the upload limit in the same vhost (default is unlimited on most builds, but some distros cap it):

```
LimitRequestBody 134217728   # 128 MB
```

### Apache proxy config for web interface

```
<Proxy />
    Allow from localhost
</Proxy>

ProxyPreserveHost On
ProxyPass /.well-known/ !
RequestHeader set X-Forwarded-Proto "https"
RequestHeader set X-Forwarded-Port "443"

ProxyPass "/" "http://localhost:4080/"
ProxyPassReverse "/" "http://localhost:4080/"
```

---

## Nginx

Equivalent setup for Nginx. Same assumptions as the Apache example (proxy and docker stack on the same host; adjust `localhost` otherwise). TLS / `listen 443` is omitted here — terminate it however you already do (certbot, a TLS-terminating load balancer, etc.).

### Nginx server block for API

```nginx
server {
    server_name updates.testdomain.com;

    # Publishing an update uploads the bundle archive — keep this generous.
    client_max_body_size 128m;

    location / {
        proxy_pass http://localhost:4300;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Port  443;
    }

    # Feathers realtime (dashboard) — WebSocket upgrade.
    location /socket.io {
        proxy_pass http://localhost:4300/socket.io;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
    }
}
```

### Nginx server block for web interface

```nginx
server {
    server_name webadmin.testdomain.com;

    location / {
        proxy_pass http://localhost:4080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

> Note on caching: with no CDN in front, HTTP `Cache-Control` on `/api/assets` is effectively inert — the native Expo client keeps its own asset store keyed by hash and will not re-request an asset it already has. Manifests (`/api/manifest`) must **never** be cached: they are signed, content-negotiated, and have a metrics side effect. Only introduce a proxy cache if you add a real CDN, and even then exclude the manifest and the bsdiff-negotiated bundle.

---

## Example docker-compose (behind your own proxy)

The reverse proxy (Apache or Nginx above) sits in front of this stack and terminates TLS. The containers themselves only expose plain HTTP on the host ports from the parameters above (`4300` → API, `4080` → dashboard). Replace every secret/credential before deploying.

```yaml
services:
  updates_api:
    image: ghcr.io/umbertoghio/self-hosted-expo-updates-server-api:latest
    container_name: updates_api
    restart: unless-stopped
    depends_on:
      - updates_db
    volumes:
      - ./updates:/updates # unzipped updates served to clients
      - ./uploads:/uploads # original publish archives
    ports:
      - "4300:3000"
    environment:
      TZ: Europe/Rome
      NODE_ENV: production
      FEATHERS_AUTH_SECRET: __CHANGE_ME_AUTH_SECRET__ # https://jwtsecret.com/generate
      MONGO_CONN: mongodb://expo:__CHANGE_ME_DB_PASSWORD__@updates_db:27017/expo # must match mongoinit/init.js
      ADMIN_PASSWORD: __CHANGE_ME_ADMIN_PASSWORD__
      UPLOAD_KEY: __CHANGE_ME_UPLOAD_KEY__ # used by the expo publish script
      PUBLIC_URL: https://updates.testdomain.com

  updates_front:
    image: ghcr.io/umbertoghio/self-hosted-expo-updates-server-web:latest
    container_name: updates_front
    restart: unless-stopped
    depends_on:
      - updates_api
    ports:
      - "4080:8080"
    environment:
      API_BASE_URL: https://updates.testdomain.com

  updates_db:
    image: mongo:4.4.25
    container_name: updates_db
    restart: unless-stopped
    volumes:
      - ./db/mongo_data:/data/db
      - ./mongoinit:/docker-entrypoint-initdb.d/ # set DB user in mongoinit/init.js
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: __CHANGE_ME_ROOT_PASSWORD__
      MONGO_INITDB_DATABASE: expo
    command: mongod --bind_ip=0.0.0.0
```

## Example docker-compose (automatic TLS with nginx-proxy + acme-companion)

This variant needs **no separate Apache/Nginx vhost and no manual certificates**: `nginx-proxy` watches Docker and routes by the `VIRTUAL_HOST` of each container, while `acme-companion` issues and renews Let's Encrypt certs for every `LETSENCRYPT_HOST`. The app containers no longer publish host ports — only `nginx-proxy` binds `80`/`443`. Replace every secret/credential before deploying.

```yaml
services:
  nginx-proxy:
    image: jwilder/nginx-proxy:latest
    container_name: nginx-proxy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/certs:/etc/nginx/certs:ro
      - ./nginx/vhost.d:/etc/nginx/vhost.d
      - ./nginx/html:/usr/share/nginx/html
      - ./nginx/conf.d/uploads.conf:/etc/nginx/conf.d/uploads.conf:ro # see note below
      - /var/run/docker.sock:/tmp/docker.sock:ro
    labels:
      com.github.nginx-proxy.nginx: "true"

  acme-companion:
    image: nginxproxy/acme-companion:latest
    container_name: acme-companion
    restart: unless-stopped
    environment:
      DEFAULT_EMAIL: you@example.com
      NGINX_PROXY_CONTAINER: nginx-proxy
    volumes:
      - ./nginx/certs:/etc/nginx/certs:rw
      - ./nginx/vhost.d:/etc/nginx/vhost.d
      - ./nginx/html:/usr/share/nginx/html
      - ./nginx/acme:/etc/acme.sh
      - /var/run/docker.sock:/var/run/docker.sock:ro

  updates_api:
    image: ghcr.io/umbertoghio/self-hosted-expo-updates-server-api:latest
    container_name: updates_api
    restart: unless-stopped
    depends_on:
      - updates_db
    volumes:
      - ./updates:/updates # unzipped updates served to clients
      - ./uploads:/uploads # original publish archives
    environment:
      TZ: Europe/Rome
      NODE_ENV: production
      FEATHERS_AUTH_SECRET: __CHANGE_ME_AUTH_SECRET__ # https://jwtsecret.com/generate
      MONGO_CONN: mongodb://expo:__CHANGE_ME_DB_PASSWORD__@updates_db:27017/expo # must match mongoinit/init.js
      ADMIN_PASSWORD: __CHANGE_ME_ADMIN_PASSWORD__
      UPLOAD_KEY: __CHANGE_ME_UPLOAD_KEY__ # used by the expo publish script
      PUBLIC_URL: https://updates.testdomain.com
      VIRTUAL_HOST: updates.testdomain.com
      VIRTUAL_PORT: 3000
      LETSENCRYPT_HOST: updates.testdomain.com

  updates_front:
    image: ghcr.io/umbertoghio/self-hosted-expo-updates-server-web:latest
    container_name: updates_front
    restart: unless-stopped
    depends_on:
      - updates_api
    environment:
      API_BASE_URL: https://updates.testdomain.com
      VIRTUAL_HOST: webadmin.testdomain.com
      VIRTUAL_PORT: 8080
      LETSENCRYPT_HOST: webadmin.testdomain.com

  updates_db:
    image: mongo:4.4.25
    container_name: updates_db
    restart: unless-stopped
    volumes:
      - ./db/mongo_data:/data/db
      - ./mongoinit:/docker-entrypoint-initdb.d/ # set DB user in mongoinit/init.js
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: __CHANGE_ME_ROOT_PASSWORD__
      MONGO_INITDB_DATABASE: expo
    command: mongod --bind_ip=0.0.0.0
```

> **Upload size:** `nginx-proxy` defaults to a small `client_max_body_size`, so large publishes return `413`. Create `./nginx/conf.d/uploads.conf` with a single line — `client_max_body_size 128m;` — which the mount above loads into the proxy. WebSocket upgrade for `/socket.io` works out of the box with `nginx-proxy`, no extra config needed.
