# Разбор ASPM findings

Документ фиксирует обработку actual findings из отчета `../aspm/1l.csv` для `cmdb2label`.

| ASPM ID | Класс | Статус | Решение |
| --- | --- | --- | --- |
| `103412`, `103706` | SECRET в unit tests | Исправлено | Test fixtures используют не production credentials, а безопасные `test-fixture-*` маркеры; `npm run secret:scan` проверяет tracked files. |
| `103709` | `$host` в `nginx/cmdb2label-dev.conf` | Accepted false-positive | `$host` используется только в dev-only listener для allowlist+reject. Downstream `Host` и `X-Forwarded-Host` заданы статически как `localhost:8095`; пользовательский host header не прокидывается. |
| `106322` | Ручная HTML-очистка | Исправлено | Footer config больше не встраивает пользовательские значения через HTML interpolation. Backend кладет base64url JSON, UI применяет значения через DOM APIs (`textContent`, `href`, `hidden`). |
| `106594`, `106628` | `security: []` в OpenAPI | Accepted risk | Только operational endpoints (`/health/*`, `/about`, `/metrics`, UI route) остаются открытыми. Они не отдают business data, cookies или secrets и должны публиковаться через internal/protected route. В `aa/openapi.yaml` добавлен `x-aspm-risk-accepted: true`. |
| `106595`, `106596` | Массивы без `maxItems` | Исправлено | `ResolveResponse.devices` и `ResolveResponse.errors` ограничены `maxItems: 100`, как и входной batch. |
| `106599` | Строки без `pattern` | Исправлено | В OpenAPI добавлены `maxLength` и `pattern` для строк labels API, CSRF, identity и diagnostic параметров. |
| `106600`-`106605` | Ответы OpenAPI без content/schema | Исправлено | Ошибочные ответы описаны inline через `application/json` + `ErrorResponse`, чтобы scanner не зависел от dereference `components.responses`. |

## Acceptance

- `npm run secret:scan`
- `npm test`
- `git diff --check`
- Focused contract tests: `tests/unit/openapi-contract.test.mjs`, `tests/unit/nginx-contract.test.mjs`, `tests/unit/runtime-config.test.mjs`.
