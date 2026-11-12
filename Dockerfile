FROM node:20-alpine

LABEL org.opencontainers.image.title="xiaoxiao-ai-gateway" \
      org.opencontainers.image.description="OpenAI 兼容 AI 网关 / API 中转平台" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /app

# 运行时不依赖任何 npm 包，直接拷贝源码
COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8848 \
    USER_PORT=8849 \
    TZ=Asia/Shanghai

RUN mkdir -p data logs backups && node -e "require('./server/platform.js'); console.log('modules ok')"

EXPOSE 8848 8849

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8848/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/server.js"]
