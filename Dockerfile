FROM node:22-alpine

WORKDIR /app

ARG CMDB_LABELS_BUILD_VERSION=0.0.0.0
ARG CMDB_LABELS_BUILD_REVISION=unknown
ARG CMDB_LABELS_BUILD_SOURCE_STATE=unverified-local
ARG CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=unknown

ENV NODE_ENV=production \
    CMDB_LABELS_HOST=0.0.0.0 \
    CMDB_LABELS_PORT=8094 \
    CMDB_LABELS_BUILD_VERSION=${CMDB_LABELS_BUILD_VERSION} \
    CMDB_LABELS_BUILD_REVISION=${CMDB_LABELS_BUILD_REVISION} \
    CMDB_LABELS_BUILD_SOURCE_STATE=${CMDB_LABELS_BUILD_SOURCE_STATE} \
    CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=${CMDB_LABELS_RUNTIME_ARTIFACT_SHA256}

LABEL org.opencontainers.image.title="cmdb2label" \
      org.opencontainers.image.version="${CMDB_LABELS_BUILD_VERSION}" \
      org.opencontainers.image.revision="${CMDB_LABELS_BUILD_REVISION}" \
      org.opencontainers.image.source-state="${CMDB_LABELS_BUILD_SOURCE_STATE}" \
      org.opencontainers.image.runtime-artifact-sha256="${CMDB_LABELS_RUNTIME_ARTIFACT_SHA256}"

COPY package.json ./
COPY VERSION ./VERSION
COPY cmdb2label.html ./cmdb2label.html
COPY src ./src
COPY scripts ./scripts

RUN addgroup -S cmdb2label && adduser -S cmdb2label -G cmdb2label
USER cmdb2label

EXPOSE 8094

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "require('node:http').get({host:'127.0.0.1',port:8094,path:'/health/live'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
