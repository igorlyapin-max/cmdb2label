FROM node:22-bookworm-slim

ARG CMDB_LABELS_EMBED_CUSTOM_CA=optional

COPY certs/customer-ca /usr/local/share/ca-certificates/cmdb2label-customer

RUN has_customer_ca=0; \
    customer_ca_files="$(find /usr/local/share/ca-certificates/cmdb2label-customer -type f \( -name '*.crt' -o -name '*.pem' \) ! -name '*.example' -print)"; \
    if [ -n "$customer_ca_files" ]; then has_customer_ca=1; fi; \
    if [ "${CMDB_LABELS_EMBED_CUSTOM_CA}" = "required" ] && [ "$has_customer_ca" -ne 1 ]; then \
      echo "CMDB_LABELS_EMBED_CUSTOM_CA=required but certs/customer-ca has no real *.crt or *.pem customer CA file." >&2; \
      exit 1; \
    fi; \
    if [ "$has_customer_ca" -eq 1 ]; then \
      mkdir -p /etc/ssl/certs; \
      touch /etc/ssl/certs/ca-certificates.crt; \
      for cert in $customer_ca_files; do cat "$cert" >> /etc/ssl/certs/ca-certificates.crt; printf '\n' >> /etc/ssl/certs/ca-certificates.crt; done; \
    fi

COPY apt/debian.sources /etc/apt/sources.list.d/debian.sources

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ARG CMDB_LABELS_BUILD_VERSION=00.00.00.00
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

RUN node -e "const fs=require('node:fs');const crypto=require('node:crypto');const version=fs.readFileSync('VERSION','utf8').trim();const html=fs.readFileSync('cmdb2label.html');const actualHash=crypto.createHash('sha256').update(html).digest('hex');const versionArg=process.env.CMDB_LABELS_BUILD_VERSION||'';const revisionArg=String(process.env.CMDB_LABELS_BUILD_REVISION||'').toLowerCase();const sourceArg=process.env.CMDB_LABELS_BUILD_SOURCE_STATE||'';const hashArg=String(process.env.CMDB_LABELS_RUNTIME_ARTIFACT_SHA256||'').toLowerCase();const mode=process.env.CMDB_LABELS_BUILD_MODE==='canonical'?'canonical':'manual';const buildVersion=/^\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d{2}$/.test(versionArg)?versionArg:version;const revision=/^[0-9a-f]{40}$/.test(revisionArg)?revisionArg:'unknown';let sourceState=sourceArg==='verified'?'verified':'unverified-local';const expectedHash=/^[0-9a-f]{64}$/.test(hashArg)?hashArg:actualHash;if(sourceState==='verified'&&(mode!=='canonical'||buildVersion!==version||revision==='unknown'||expectedHash!==actualHash)){throw new Error('verified image provenance does not match build context');}if(sourceState!=='verified')sourceState='unverified-local';fs.writeFileSync('build-identity.json',JSON.stringify({version,buildVersion,revision,sourceState,buildMode:mode,runtimeArtifact:{path:'cmdb2label.html',sha256:actualHash,expectedSha256:expectedHash,matchesExpected:actualHash===expectedHash}},null,2)+'\n');"

RUN groupadd --system cmdb2label \
 && useradd --system --gid cmdb2label --no-create-home --shell /usr/sbin/nologin cmdb2label
USER cmdb2label

EXPOSE 8094

HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD node -e "require('node:http').get({host:'127.0.0.1',port:8094,path:'/health/live'},r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "src/server.mjs"]
