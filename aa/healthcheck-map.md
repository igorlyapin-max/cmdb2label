# Карта HealthCheck

| ID | Поток | Endpoint | Вызывающая сторона | Статус | Проверяемые зависимости | Открываемые данные | Примечания |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HC-001 | `IF-005` | `GET /health/live` | Docker healthcheck, LB, operator | `200` alive | Только процесс backend | service, `live`, safe build identity | Без данных CMDBuild |
| HC-002 | `IF-005` | `GET /health/ready` | LB, monitoring, operator | `200` ready, `503` not ready | Runtime config и доступность CMDBuild upstream | service, `ready`, status, safe build identity | Не раскрывает `CMDBUILD_ORIGIN` или raw error |
| HC-003 | `IF-005` | `GET /cmdbuild/custom-api/labels/health/live` | Same-origin proxy/monitoring | `200` alive | Только процесс backend | Как liveness | API-prefixed alias для proxy integration |
| HC-004 | `IF-005` | `GET /cmdbuild/custom-api/labels/health/ready` | Same-origin proxy/monitoring | `200` ready, `503` not ready | Runtime config и доступность CMDBuild upstream | Как readiness | API-prefixed alias для proxy integration |
| HC-005 | `IF-005` | Docker `HEALTHCHECK` | Docker engine | Exit `0` или `1` | `GET /health/live` на container port `8094` | Только exit code | Использует `127.0.0.1:8094` внутри container |
| HC-006 | `IF-005` | `GET /about` и `GET /cmdbuild/custom-api/labels/about` | Operator, support UI | `200` | Только build identity file/env | version, buildVersion, revision, sourceState, runtimeArtifact SHA256 | Без CMDBuild origin, cookies или secrets |
| HC-007 | `IF-003` | `GET /cmdbuild/custom-api/labels/logging/status` | Authenticated browser/operator | `200`, `401` | Валидная CMDBuild session cookie | log level, format, targets, diagnostic mode, redaction headers | Diagnostic endpoint, не readiness |

## Классы отказа readiness

| Отказ | Ожидаемый статус | Действие оператора |
| --- | --- | --- |
| Невалидный runtime config | `503` | Исправить env/config, проверить startup event `app.config_invalid` |
| CMDBuild upstream недоступен | `503` | Проверить `CMDBUILD_ORIGIN`, сеть, TLS/CA, статус CMDBuild |
| Нет optional custom CA при mode `none` | Ready может проходить | Действие не требуется, пока не включена private TLS dependency |
| Нет custom CA при mode `mount`/`embedded` | startup/readiness config error | Смонтировать читаемый CA и согласовать `NODE_EXTRA_CA_CERTS` |
