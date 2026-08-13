# Карта регистрации событий

Application logs are structured JSON to stdout/stderr. Optional direct syslog is enabled with `CMDB_LABELS_LOG_TARGET=stdout,syslog`; otherwise production must declare an external platform/collector/sidecar/docker-driver sink through `CMDB_LABELS_LOG_EXTERNAL_SINK`.

| Event | Level | Flow | Trigger | Required fields | Sensitive data policy |
| --- | --- | --- | --- | --- | --- |
| `app.started` | info | `IF-006` | Successful startup | listen address, prefixes, runtimeConfig summary, logging status | No cookies/tokens/raw payloads |
| `app.config_invalid` | error | `IF-006` | Startup config validation failed | nodeEnv, diagnosticMode, logTargets, externalSink, error codes, safe errorDetails | Error details must not include raw filesystem exception paths |
| `http.request.finish` | info/warn/error | `IF-002`, `IF-003`, `IF-005` | HTTP response finished | requestId, method, path, route, statusCode, durationMs, hasCmdbuildCookie boolean | No headers, query values, cookie values, payloads |
| `diagnostic.http.request.finish` | info | `IF-006` | `CMDB_LABELS_DIAGNOSTIC_MODE=Basic|Verbose` | Same safe request summary | Diagnostic mode temporary; still no raw payloads |
| `labels.resolve` | info diagnostic | `IF-003`, `IF-004` | `/resolve` completed in diagnostic mode | inputCount, outputCount, errorCount, cmdbuildRestCalls | No inventory, serial, model, type values |
| `client.event` | info diagnostic | `IF-003`, `IF-006` | Browser calls `/client-log` | sanitized stage/message length limited | Requires CMDBuild session; no free-form secrets |
| `cmdbuild.proxy_target_rejected` | warn | Disabled generic proxy | Unsafe proxy request target | method, path | Generic proxy disabled by default |
| `cmdbuild.proxy_path_rejected` | warn | Disabled generic proxy | Proxy path not allowlisted | method, path | Generic proxy disabled by default |
| `health.check_failed` | error | `IF-005` | Health handler exception | path, safe message | No origin URL/query/header data |
| `labels.api_failed` | warn/error | `IF-003` | Labels API handler exception | path, statusCode, safe message | User-facing message sanitized |
| `app.shutdown_failed` | error | `IF-006` | Graceful shutdown error | signal, safe error message | No secrets |

## Security-relevant events

| Scenario | Event/status | Flow |
| --- | --- | --- |
| Missing/expired CMDBuild session | `http.request.finish` with `401` | `IF-003` |
| Same-origin validation rejected | `http.request.finish` with `403` | `IF-003` |
| Invalid CSRF token | `http.request.finish` with `403` | `IF-003` |
| Invalid content type | `http.request.finish` with `415` | `IF-003` |
| Oversized resolve batch/body | `http.request.finish` with `413` | `IF-003` |
| Invalid runtime logging sink | `app.config_invalid` / `external_log_sink_required` | `IF-006` |

## Redaction baseline

Redacted headers include `authorization`, `cmdbuild-authorization`, `cookie`, `set-cookie`, and `x-cmdb2label-csrf`. `Verbose` diagnostics must be enabled only temporarily and must not log raw CMDBuild payloads or label rows.
