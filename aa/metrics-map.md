# Карта метрик

`cmdb2label` отдает Prometheus text format на `GET /metrics`. Endpoint должен опрашиваться через внутренний или защищенный маршрут и не должен публиковаться как неаутентифицированный internet-facing endpoint.

| Метрика | Тип | Поток | Labels | Назначение | Чувствительные данные |
| --- | --- | --- | --- | --- | --- |
| `cmdb2label_http_requests_total` | counter | `IF-005`, `IF-003`, `IF-002` | `route`, `status` | Считает завершенные HTTP requests по классу route и классу status | Нет path query, cookies, tokens, payloads |
| `cmdb2label_cmdbuild_requests_total` | counter | `IF-004` | `method`, `status` | Считает прямые CMDBuild REST calls по method и классу status | Нет CMDBuild URL query или payload |
| `cmdb2label_cmdbuild_proxy_requests_total` | counter | Отключенный generic proxy path | `method`, `status` | Считает generic CMDBuild proxy calls, когда proxy явно включен | Generic proxy по умолчанию отключен |

## Контракт scrape

| Endpoint | Порт | Формат | Авторизация |
| --- | --- | --- | --- |
| `GET /metrics` | HTTP `8094` или protected platform route | `text/plain; version=0.0.4` | Deployment обязан защитить route при публикации вне internal monitoring |

## Примечания

- Metrics являются in-memory process counters и сбрасываются при restart процесса.
- Metrics не содержат CMDBuild session identifiers, label values, serial numbers, inventory numbers, user names или raw CMDBuild payloads.
- `cmdb2label_cmdbuild_proxy_requests_total` присутствует только если отключенный generic proxy явно включен и используется.
