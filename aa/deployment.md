# Схема развертывания

Окружение разработки приведено справочно. По стандарту обязательными считаются контуры Test IT, Business Test и Production; конкретные hostnames, сертификаты и ingress-адреса задаются площадкой эксплуатации.

## Development / локальный стенд

```mermaid
flowchart TB
  subgraph Host["Developer/Test host"]
    Browser[Browser]
    Nginx[Shared nginx cmdbcustompages<br/>listen 8088]
    Labels[cmdb2label Node.js<br/>listen 127.0.0.1:8094]
    LabelsOnly[optional labels-only nginx<br/>listen 8095]
    CMDB[CMDBuild upstream<br/>listen 127.0.0.1:8090]
    Logs[stdout/stderr<br/>optional syslog 514 UDP/TCP]
  end

  Browser -->|HTTP 8088 /cmdbuild/| Nginx
  Nginx -->|HTTP 8094 /cmdbuild/labels/*| Labels
  Nginx -->|HTTP 8094 /cmdbuild/custom-api/labels/*| Labels
  LabelsOnly -->|HTTP 8094 labels routes only| Labels
  Labels -->|HTTP REST 8090| CMDB
  Labels -->|JSON stdout / syslog 514| Logs
```

Notes:

- User-facing dev entrypoint is `http://localhost:8088/cmdbuild/`.
- Direct CMDBuild upstream `8090` is not a supported user entrypoint for `cmdb2label` custom page routes.
- Optional `8095` overlay is labels-only and does not own general `/cmdbuild/`.

## Test IT

```mermaid
flowchart TB
  User[User browser]
  Ingress[Reverse proxy / ingress<br/>HTTPS 443]
  App[cmdb2label container<br/>HTTP 8094]
  CMDB[CMDBuild REST<br/>HTTP 8090 or HTTPS 443]
  Mon[Monitoring / LB probe]
  LogCollector[Platform log collector<br/>stdout/stderr]
  Syslog[Optional syslog/SIEM<br/>514 UDP/TCP]
  Secret[Deployment secrets/env]

  User -->|HTTPS 443 same-origin /cmdbuild/| Ingress
  Ingress -->|HTTP 8094 labels UI/API| App
  App -->|HTTP 8090 or HTTPS 443 REST| CMDB
  Mon -->|HTTP 8094 /health/live,/health/ready,/metrics| App
  App -->|JSON stdout/stderr| LogCollector
  App -->|optional syslog 514 UDP/TCP| Syslog
  App -->|read at startup| Secret
```

## Business Test

Business Test repeats the Test IT logical topology. Differences are deployment-specific:

- ingress host, TLS certificate, and CMDBuild origin are provided by the platform;
- `CMDB_LABELS_CSRF_SECRET` must be stable and externally managed;
- customer alias config and class root must match the Business Test CMDBuild model;
- if private CA is used, mount it read-only and set `NODE_EXTRA_CA_CERTS`.

## Production

```mermaid
flowchart TB
  User[User browser]
  LB[Ingress / Load balancer<br/>HTTPS 443]
  App[cmdb2label image<br/>HTTP 8094 or platform port]
  CMDB[CMDBuild REST<br/>HTTPS 443 or platform port]
  Mon[Monitoring<br/>HTTP app port or protected HTTPS 443]
  Collector[Collector/agent/sidecar<br/>platform port]
  Syslog[Optional syslog/SIEM<br/>514 UDP/TCP]
  Registry[Container registry<br/>HTTPS 443]
  Apt[OS package repo / proxy<br/>HTTP 80 or HTTPS 443]
  Secret[Secret store / deployment env]

  User -->|HTTPS 443 same-origin| LB
  LB -->|HTTP app port /cmdbuild/labels/*| App
  LB -->|HTTP app port /cmdbuild/custom-api/labels/*| App
  App -->|HTTPS 443 REST| CMDB
  Mon -->|HTTP app port /health,/metrics| App
  App -->|JSON stdout/stderr| Collector
  App -->|optional syslog 514 UDP/TCP| Syslog
  App -->|read secrets/env| Secret
  Registry -->|HTTPS 443 image pull| App
  Apt -->|HTTP 80 / HTTPS 443 during build| Registry
```

Production requirements:

- runtime compose uses prebuilt `image:`, not `build:`;
- base compose does not force a Docker logging driver, collector, or syslog topology;
- stdout-only production requires `CMDB_LABELS_LOG_EXTERNAL_SINK=platform|collector|sidecar|docker-driver`;
- direct syslog is optional through `CMDB_LABELS_LOG_TARGET=stdout,syslog`;
- real customer CA files and fingerprints remain deployment artifacts and are not committed.
