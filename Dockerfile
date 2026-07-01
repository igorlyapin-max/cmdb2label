FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    CMDB_LABELS_HOST=0.0.0.0 \
    CMDB_LABELS_PORT=8094

COPY package.json ./
COPY cmdb2label.html ./cmdb2label.html
COPY src ./src
COPY scripts ./scripts

RUN addgroup -S cmdb2label && adduser -S cmdb2label -G cmdb2label
USER cmdb2label

EXPOSE 8094

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8094/health/live || exit 1

CMD ["node", "src/server.mjs"]
