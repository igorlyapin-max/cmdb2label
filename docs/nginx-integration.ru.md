# Интеграция в существующий nginx

`cmdb2label` должен быть доступен под тем же origin, что и CMDBuild. Это позволяет browser автоматически отправлять `CMDBuild-Authorization` cookie на backend routes, не раскрывая cookie JavaScript-коду.

## Минимальный пример

Добавьте правила `labels` выше общего `location /cmdbuild/`. В совместном окружении общий `/cmdbuild/` остается в существующем backend `cmdbcustompages` на `8093`, а `cmdb2label` получает только свои два prefix на `8094`.

```nginx
server {
  listen 443 ssl;
  server_name cmdbuild.example.org;

  location /cmdbuild/custom-api/labels/ {
    proxy_pass http://127.0.0.1:8094/cmdbuild/custom-api/labels/;
    proxy_http_version 1.1;
    proxy_buffering off;

    proxy_set_header Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /cmdbuild/labels/ {
    proxy_pass http://127.0.0.1:8094/cmdbuild/labels/;
    proxy_http_version 1.1;
    proxy_buffering off;

    proxy_set_header Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /cmdbuild/ {
    proxy_pass http://127.0.0.1:8093/cmdbuild/;
    proxy_http_version 1.1;
    proxy_buffering off;

    proxy_set_header Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Host cmdbuild.example.org;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

## Важные правила

- `location /cmdbuild/custom-api/labels/` и `location /cmdbuild/labels/` должны стоять выше общего `/cmdbuild/`.
- Обычный `/cmdbuild/` проксируется в существующий backend/CMDBuild proxy `cmdbcustompages` на `8093`; не перехватывайте его в `cmdb2label`.
- Для общего `/cmdbuild/` передавайте фиксированный внешний host из allowlist, например `cmdbuild.example.org`. CMDBuild генерирует `/cmdbuild/ui/config.js` из этого host; если отдать upstream host, browser начнет ходить на прямой CMDBuild upstream и session flow сломается.
- Для backend-owned `labels` routes используйте тот же фиксированный внешний host, потому что backend использует внешний origin для same-origin/CSRF проверок.
- Не прокидывайте `Upgrade`/`Connection` в labels routes: WebSocket/h2c upgrade для них не требуется.
- Не включайте CORS для UI/API, если nginx обслуживает их под тем же origin.
- Не логируйте raw `Cookie`, `Authorization`, `CMDBuild-Authorization` и `X-CMDB2Label-CSRF` в access/error log с расширенными форматами.
- Не проксируйте общий `/cmdbuild/` в `cmdb2label`: этот сервис владеет только `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.
- `/metrics` публикуйте только во внутреннем контуре мониторинга или снимайте напрямую с `127.0.0.1:8094`.

## Расширенное логирование BFF

Расширенный diagnostic режим включается в BFF/backend через env, а не через nginx. Для безопасной диагностики используйте `Basic`:

```dotenv
CMDB_LABELS_DIAGNOSTIC_MODE=Basic
CMDB_LABELS_SESSION_DIAGNOSTIC_MAX_LEVEL=off
CMDB_LABELS_LOG_TARGET=stdout
CMDB_LABELS_LOG_EXTERNAL_SINK=platform
```

`Verbose` допустим только временно:

```dotenv
CMDB_LABELS_DIAGNOSTIC_MODE=Verbose
```

Для диагностики только текущей вкладки пользователя не включайте
`CMDB_LABELS_DIAGNOSTIC_MODE` на весь backend. Задайте операторский cap:

```dotenv
CMDB_LABELS_DIAGNOSTIC_MODE=off
CMDB_LABELS_SESSION_DIAGNOSTIC_MAX_LEVEL=Basic
```

После этого UI может отправлять `X-CMDB2Label-Diagnostic`, но backend не примет
уровень выше `CMDB_LABELS_SESSION_DIAGNOSTIC_MAX_LEVEL`.

Если площадка собирает только stdout/stderr через Docker logging driver, collector, sidecar, ELK/OpenSearch или аналог, оставляйте `CMDB_LABELS_LOG_TARGET=stdout` и задавайте `CMDB_LABELS_LOG_EXTERNAL_SINK=platform|collector|sidecar|docker-driver`. Если нужен прямой app-level syslog, используйте отдельный режим:

```dotenv
CMDB_LABELS_LOG_TARGET=stdout,syslog
CMDB_LABELS_SYSLOG_HOST=127.0.0.1
CMDB_LABELS_SYSLOG_PORT=514
CMDB_LABELS_SYSLOG_PROTOCOL=udp
CMDB_LABELS_SYSLOG_FACILITY=local0
```

Проверка активного режима выполняется через same-origin API и требует живую CMDBuild session cookie:

```bash
curl -i \
  -H 'Cookie: CMDBuild-Authorization=<session>' \
  https://cmdbuild.example.org/cmdbuild/custom-api/labels/logging/status
```

Не включайте в nginx access/error log значения `Cookie`, `Authorization`, `CMDBuild-Authorization`, `Set-Cookie` и `X-CMDB2Label-CSRF`. Даже в `Verbose` BFF не должен писать raw CMDBuild payloads и строки этикеток.

## Smoke checks

```bash
curl -fsS https://cmdbuild.example.org/health/live
curl -fsS https://cmdbuild.example.org/cmdbuild/custom-api/labels/health/live
curl -i https://cmdbuild.example.org/cmdbuild/ui/config.js
curl -i https://cmdbuild.example.org/cmdbuild/labels/ui
curl -i https://cmdbuild.example.org/cmdbuild/ui/app/view/custompages/CmdbLabels/CmdbLabels.js
curl -i https://cmdbuild.example.org/cmdbuild/custom-api/labels/csrf
```

`config.js` должен содержать внешний origin reverse proxy, а не внутренний CMDBuild upstream. Запрос к custom page JS должен выполняться с авторизованной CMDBuild cookie. Последний запрос без авторизованной CMDBuild cookie должен вернуть `401`.
