# Схема развертывания

Окружение разработки приведено справочно. По стандарту обязательными считаются контуры Test IT, Business Test и Production; конкретные hostnames, сертификаты и ingress-адреса задаются площадкой эксплуатации.

## Development / локальный стенд

```mermaid
flowchart TB
  subgraph Host["Developer/Test host"]
    Browser[Браузер]
    Nginx[Shared nginx cmdbcustompages<br/>listen 8088]
    Labels[cmdb2label Node.js<br/>listen 127.0.0.1:8094]
    LabelsOnly[optional labels-only nginx<br/>listen 8095]
    CMDB[CMDBuild upstream<br/>listen 127.0.0.1:8090]
    Logs[stdout/stderr<br/>optional syslog 514 UDP/TCP]
  end

  Browser -->|HTTP 8088 /cmdbuild/| Nginx
  Nginx -->|HTTP 8094 /cmdbuild/labels/*| Labels
  Nginx -->|HTTP 8094 /cmdbuild/custom-api/labels/*| Labels
  LabelsOnly -->|HTTP 8094 только labels routes| Labels
  Labels -->|HTTP REST 8090| CMDB
  Labels -->|JSON stdout / syslog 514| Logs
```

Примечания:

- Пользовательская точка входа dev-стенда: `http://localhost:8088/cmdbuild/`.
- Прямой CMDBuild upstream `8090` не является поддерживаемой пользовательской точкой входа для custom page routes `cmdb2label`.
- Optional overlay `8095` обслуживает только labels routes и не владеет общим `/cmdbuild/`.

## Test IT

```mermaid
flowchart TB
  User[Браузер пользователя]
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

Business Test повторяет логическую топологию Test IT. Отличия зависят от развертывания:

- ingress host, TLS certificate и CMDBuild origin предоставляются платформой;
- `CMDB_LABELS_CSRF_SECRET` должен быть стабильным и управляться вне приложения;
- customer alias config и class root должны соответствовать модели CMDBuild в Business Test;
- если используется private CA, ее нужно смонтировать read-only и задать `NODE_EXTRA_CA_CERTS`.

## Production

```mermaid
flowchart TB
  User[Браузер пользователя]
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

Требования Production:

- runtime compose использует готовый `image:`, а не `build:`;
- base compose не навязывает Docker logging driver, collector или syslog topology;
- stdout-only production требует `CMDB_LABELS_LOG_EXTERNAL_SINK=platform|collector|sidecar|docker-driver`;
- прямой syslog опционален через `CMDB_LABELS_LOG_TARGET=stdout,syslog`;
- реальные customer CA files и fingerprints остаются deployment artifacts и не коммитятся.
