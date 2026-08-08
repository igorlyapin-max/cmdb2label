FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG CMDB_LABELS_BUILD_VERSION=0.0.0.0
ARG CMDB_LABELS_BUILD_REVISION=unknown
ARG CMDB_LABELS_BUILD_SOURCE_STATE=unverified-local
ARG CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=unknown
ARG CMDB_LABELS_BUILD_MODE=manual

ENV NODE_ENV=production \
    CMDB_LABELS_HOST=0.0.0.0 \
    CMDB_LABELS_PORT=8094 \
    CMDB_LABELS_BUILD_VERSION=${CMDB_LABELS_BUILD_VERSION} \
    CMDB_LABELS_BUILD_REVISION=${CMDB_LABELS_BUILD_REVISION} \
    CMDB_LABELS_BUILD_SOURCE_STATE=${CMDB_LABELS_BUILD_SOURCE_STATE} \
    CMDB_LABELS_RUNTIME_ARTIFACT_SHA256=${CMDB_LABELS_RUNTIME_ARTIFACT_SHA256} \
    CMDB_LABELS_BUILD_MODE=${CMDB_LABELS_BUILD_MODE}

LABEL org.opencontainers.image.title="cmdb2label" \
      org.opencontainers.image.version="${CMDB_LABELS_BUILD_VERSION}" \
      org.opencontainers.image.revision="${CMDB_LABELS_BUILD_REVISION}" \
      org.opencontainers.image.source-state="${CMDB_LABELS_BUILD_SOURCE_STATE}" \
      org.opencontainers.image.runtime-artifact-sha256="${CMDB_LABELS_RUNTIME_ARTIFACT_SHA256}" \
      org.opencontainers.image.build-mode="${CMDB_LABELS_BUILD_MODE}"

COPY package.json ./
COPY VERSION ./VERSION
COPY cmdb2label.html ./cmdb2label.html
COPY src ./src
COPY scripts ./scripts
COPY certs/customer-ca /usr/local/share/ca-certificates/cmdb2label-customer

RUN node -e "const fs=require('node:fs');const crypto=require('node:crypto');const version=fs.readFileSync('VERSION','utf8').trim();const html=fs.readFileSync('cmdb2label.html');const actualHash=crypto.createHash('sha256').update(html).digest('hex');const versionArg=process.env.CMDB_LABELS_BUILD_VERSION||'';const revisionArg=String(process.env.CMDB_LABELS_BUILD_REVISION||'').toLowerCase();const sourceArg=process.env.CMDB_LABELS_BUILD_SOURCE_STATE||'';const hashArg=String(process.env.CMDB_LABELS_RUNTIME_ARTIFACT_SHA256||'').toLowerCase();const mode=process.env.CMDB_LABELS_BUILD_MODE==='canonical'?'canonical':'manual';const buildVersion=/^\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{2}$/.test(versionArg)?versionArg:version;const revision=/^[0-9a-f]{40}$/.test(revisionArg)?revisionArg:'unknown';let sourceState=sourceArg==='verified'?'verified':'unverified-local';const expectedHash=/^[0-9a-f]{64}$/.test(hashArg)?hashArg:actualHash;if(sourceState==='verified'&&(mode!=='canonical'||buildVersion!==version||revision==='unknown'||expectedHash!==actualHash)){throw new Error('verified image provenance does not match build context');}if(sourceState!=='verified')sourceState='unverified-local';fs.writeFileSync('build-identity.json',JSON.stringify({version,buildVersion,revision,sourceState,buildMode:mode,runtimeArtifact:{path:'cmdb2label.html',sha256:actualHash,expectedSha256:expectedHash,matchesExpected:actualHash===expectedHash}},null,2)+'\n');"
RUN if find /usr/local/share/ca-certificates/cmdb2label-customer -type f \( -name '*.crt' -o -name '*.pem' \) -print -quit | grep -q .; then update-ca-certificates; fi

RUN groupadd --system cmdb2label \
 && useradd --system --gid cmdb2label --no-create-home --shell /usr/sbin/nologin cmdb2label
USER cmdb2label

EXPOSE 8094

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "require('node:http').get({host:'127.0.0.1',port:8094,path:'/health/live'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
