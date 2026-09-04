# Карта регистрации событий

Логи приложения пишутся как structured JSON в stdout/stderr. Опциональная прямая отправка в syslog включается через `CMDB_LABELS_LOG_TARGET=stdout,syslog`; иначе production должен объявить внешний platform/collector/sidecar/docker-driver sink через `CMDB_LABELS_LOG_EXTERNAL_SINK`.

| Событие | Уровень | Поток | Триггер | Обязательные поля | Политика чувствительных данных |
| --- | --- | --- | --- | --- | --- |
| `app.started` | info | `L0` | Успешный startup | listen address, prefixes, runtimeConfig summary, logging status | Без cookies/tokens/raw payloads |
| `app.config_invalid` | error | `L0` | Ошибка валидации startup config | nodeEnv, diagnosticMode, logTargets, externalSink, error codes, safe errorDetails | Error details не должны включать raw filesystem exception paths |
| `http.request.finish` | info/warn/error | `IF1`, `OAPI0`, `H0`, `M0` | HTTP response завершен | requestId, method, path, route, statusCode, durationMs, hasCmdbuildCookie boolean | Без headers, query values, cookie values, payloads |
| `diagnostic.http.request.finish` | info | `L0` | `CMDB_LABELS_DIAGNOSTIC_MODE=Basic|Verbose` | Тот же safe request summary | Diagnostic mode временный; raw payloads не логируются |
| `labels.resolve` | info diagnostic | `OAPI0`, `OAPI1` | `/resolve` завершен в diagnostic mode | inputCount, outputCount, errorCount, cmdbuildRestCalls | Без inventory, serial, model, type values |
| `client.event` | info diagnostic | `OAPI0`, `L0` | Browser вызывает `/client-log` | sanitized stage/message с ограниченной длиной | Требует CMDBuild session; без free-form secrets |
| `cmdbuild.proxy_target_rejected` | warn | Отключенный generic proxy | Небезопасный proxy request target | method, path | Generic proxy по умолчанию отключен |
| `cmdbuild.proxy_path_rejected` | warn | Отключенный generic proxy | Proxy path отсутствует в allowlist | method, path | Generic proxy по умолчанию отключен |
| `health.check_failed` | error | `H0` | Исключение health handler | path, safe message | Без origin URL/query/header data |
| `labels.api_failed` | warn/error | `OAPI0` | Исключение обработчика Labels API | path, statusCode, safe message | Пользовательское сообщение очищается |
| `app.shutdown_failed` | error | `L0` | Ошибка graceful shutdown | signal, safe error message | Без secrets |

## События безопасности

| Сценарий | Event/status | Поток |
| --- | --- | --- |
| Отсутствующая/истекшая CMDBuild session | `http.request.finish` со статусом `401` | `OAPI0` |
| Same-origin validation отклонена | `http.request.finish` со статусом `403` | `OAPI0` |
| Невалидный CSRF token | `http.request.finish` со статусом `403` | `OAPI0` |
| Невалидный content type | `http.request.finish` со статусом `415` | `OAPI0` |
| Превышен размер resolve batch/body | `http.request.finish` со статусом `413` | `OAPI0` |
| Невалидный runtime logging sink | `app.config_invalid` / `external_log_sink_required` | `L0` |

## Базовая маскировка

Маскируемые headers включают `authorization`, `cmdbuild-authorization`, `cookie`, `set-cookie` и `x-cmdb2label-csrf`. `Verbose` diagnostics должен включаться только временно и не должен логировать raw CMDBuild payloads или label rows.
