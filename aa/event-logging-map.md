# Карта регистрации событий

Логи приложения пишутся как structured JSON в stdout/stderr. Опциональная прямая отправка в syslog включается через `CMDB_LABELS_LOG_TARGET=stdout,syslog`; иначе production должен объявить внешний platform/collector/sidecar/docker-driver sink через `CMDB_LABELS_LOG_EXTERNAL_SINK`.

| Событие | Уровень | Поток | Триггер | Обязательные поля | Политика чувствительных данных |
| --- | --- | --- | --- | --- | --- |
| `app.started` | info | `IF-006` | Успешный startup | listen address, prefixes, runtimeConfig summary, logging status | Без cookies/tokens/raw payloads |
| `app.config_invalid` | error | `IF-006` | Ошибка валидации startup config | nodeEnv, diagnosticMode, logTargets, externalSink, error codes, safe errorDetails | Error details не должны включать raw filesystem exception paths |
| `http.request.finish` | info/warn/error | `IF-002`, `IF-003`, `IF-005` | HTTP response завершен | requestId, method, path, route, statusCode, durationMs, hasCmdbuildCookie boolean | Без headers, query values, cookie values, payloads |
| `diagnostic.http.request.finish` | info | `IF-006` | `CMDB_LABELS_DIAGNOSTIC_MODE=Basic|Verbose` | Тот же safe request summary | Diagnostic mode временный; raw payloads не логируются |
| `labels.resolve` | info diagnostic | `IF-003`, `IF-004` | `/resolve` завершен в diagnostic mode | inputCount, outputCount, errorCount, cmdbuildRestCalls | Без inventory, serial, model, type values |
| `client.event` | info diagnostic | `IF-003`, `IF-006` | Browser вызывает `/client-log` | sanitized stage/message с ограниченной длиной | Требует CMDBuild session; без free-form secrets |
| `cmdbuild.proxy_target_rejected` | warn | Отключенный generic proxy | Небезопасный proxy request target | method, path | Generic proxy по умолчанию отключен |
| `cmdbuild.proxy_path_rejected` | warn | Отключенный generic proxy | Proxy path отсутствует в allowlist | method, path | Generic proxy по умолчанию отключен |
| `health.check_failed` | error | `IF-005` | Исключение health handler | path, safe message | Без origin URL/query/header data |
| `labels.api_failed` | warn/error | `IF-003` | Исключение обработчика Labels API | path, statusCode, safe message | Пользовательское сообщение очищается |
| `app.shutdown_failed` | error | `IF-006` | Ошибка graceful shutdown | signal, safe error message | Без secrets |

## События безопасности

| Сценарий | Event/status | Поток |
| --- | --- | --- |
| Отсутствующая/истекшая CMDBuild session | `http.request.finish` со статусом `401` | `IF-003` |
| Same-origin validation отклонена | `http.request.finish` со статусом `403` | `IF-003` |
| Невалидный CSRF token | `http.request.finish` со статусом `403` | `IF-003` |
| Невалидный content type | `http.request.finish` со статусом `415` | `IF-003` |
| Превышен размер resolve batch/body | `http.request.finish` со статусом `413` | `IF-003` |
| Невалидный runtime logging sink | `app.config_invalid` / `external_log_sink_required` | `IF-006` |

## Базовая маскировка

Маскируемые headers включают `authorization`, `cmdbuild-authorization`, `cookie`, `set-cookie` и `x-cmdb2label-csrf`. `Verbose` diagnostics должен включаться только временно и не должен логировать raw CMDBuild payloads или label rows.
