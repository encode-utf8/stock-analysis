# Web 前端镜像（多阶段）。
# 只有在 Docker 构建时才打开 standalone 输出（NEXT_OUTPUT=standalone），
# 本地 next build / next start、CI 与 Playwright 端到端测试的默认行为保持不变。
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN apk add --no-cache tzdata && corepack enable
WORKDIR /app

# 依赖层：只依赖清单文件，源码改动不会让这一层缓存失效。
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# 源码层：叠加完整源码，同时作为 migrate 服务的构建目标（数据库迁移需要 drizzle-kit）。
FROM deps AS source
COPY . .

# 构建层：生成 standalone 运行产物。
FROM source AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_OUTPUT=standalone
RUN pnpm build

# 运行层：只保留 standalone 产物与静态资源，以非 root 用户启动。
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATA_ROOT=/app/data
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# 数据目录先建好并交给运行用户，命名卷首次创建时会沿用这里的归属。
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

