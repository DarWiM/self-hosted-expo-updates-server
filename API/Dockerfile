# Build dist/ without carrying the fork's build dependencies into the runtime
# image. The API installs the resulting local file: package in the next stage.
FROM oven/bun:1-alpine AS bsdiff
WORKDIR /pkg
COPY vendor/bsdiff/ ./
RUN bun install --frozen-lockfile && bun run build

FROM oven/bun:1-alpine
RUN apk update && apk add --no-cache tzdata
RUN mkdir -p /home/bun/server/vendor/bsdiff && chown -R bun:bun /home/bun/server
WORKDIR /home/bun/server
USER bun

# The local dependency must contain its compiled entry points before Bun
# installs the API. dist/ is excluded from the build context and comes only
# from the builder stage.
COPY --from=bsdiff --chown=bun:bun /pkg/dist ./vendor/bsdiff/dist
COPY --chown=bun:bun vendor/bsdiff/ ./vendor/bsdiff/

COPY --chown=bun:bun package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY --chown=bun:bun . .

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD bun run src/modules/docker/healthcheck.ts

CMD ["bun", "run", "src/index.ts"]
