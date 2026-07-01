# Тестовое окружение

Документ описывает локальную разработку рядом с существующим тестовым CMDBuild и nginx.

## Ожидаемые сервисы

```text
CMDBuild upstream: http://127.0.0.1:8090/cmdbuild/
cmdbcustompages backend: http://127.0.0.1:8093/
cmdb2label backend: http://127.0.0.1:8094/
shared dev nginx: http://localhost:8088/
```

Рабочий вход для `cmdb2label` в dev - `http://localhost:8088/cmdbuild/`. Порт `8090` является прямым CMDBuild upstream; на нем нет маршрутов backend UI/API `cmdb2label`.

В совместном dev-окружении общий `/cmdbuild/` остается за существующим `cmdbcustompages` backend на `8093`. `cmdb2label` получает только маршруты `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*` через тот же nginx на `8088`, чтобы cookie CMDBuild и labels API оставались на одном browser origin.

Если CMDBuild доступен на другом адресе, задайте:

```bash
CMDBUILD_ORIGIN=http://127.0.0.1:<port> npm start
```

## Запуск backend

```bash
npm test
CMDBUILD_ORIGIN=http://127.0.0.1:8090 \
CMDB_LABELS_DIAGNOSTIC_MODE=Basic \
npm start
```

Production-like запуск должен задавать стабильный CSRF secret:

```bash
NODE_ENV=production \
CMDB_LABELS_CSRF_SECRET=<stable-secret-from-secret-store> \
CMDB_LABELS_LOG_TARGET=stdout,syslog \
CMDB_LABELS_SYSLOG_HOST=127.0.0.1 \
CMDBUILD_ORIGIN=http://127.0.0.1:8090 \
npm start
```

Для примера полного набора переменных используйте [.env.example](../.env.example). Значение `CMDB_LABELS_CSRF_SECRET` в примере обязательно заменяется на секрет из хранилища.

## Shared dev nginx

Используйте существующий nginx проекта `cmdbcustompages` на `8088`. Не запускайте второй front nginx на этом же порту. В его конфиг должны быть добавлены labels routes из [инструкции интеграции nginx](nginx-integration.ru.md).

Файл `nginx/cmdb2label-dev.conf` из этого репозитория слушает `8095` только как optional labels-only overlay для локальных smoke checks. Он не проксирует общий `/cmdbuild/` и не является пользовательским входом в CMDBuild.

Проверка:

```bash
curl -fsS http://127.0.0.1:8094/health/live
curl -i http://127.0.0.1:8094/health/ready
curl -fsS http://localhost:8088/health/live
curl -i http://localhost:8088/cmdbuild/ui/config.js
curl -i http://localhost:8088/cmdbuild/custom-api/labels/health/live
curl -i http://localhost:8088/cmdbuild/labels/ui
curl -fsS http://127.0.0.1:8094/metrics
```

`/health/live` на `8088` проверяет `cmdbcustompages`, а `/cmdbuild/custom-api/labels/health/live` проверяет `cmdb2label`.

В `config.js` должны быть URL вида `http://localhost:8088/cmdbuild/services/rest/v3`, не `http://127.0.0.1:8090/...`.

`/health/ready` возвращает `503`, если CMDBuild upstream недоступен. Это корректное поведение readiness.

## Проверка с реальной сессией CMDBuild

1. Откройте `http://localhost:8088/cmdbuild/`.
2. Авторизуйтесь в CMDBuild.
3. Зарегистрируйте custom page по [инструкции](custom-page-registration.ru.md), например:

```bash
CMDBUILD_ORIGIN=http://localhost:8088 \
CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt \
npm run register:custompage
```

4. Если cookie jar не используется, передайте `CMDBUILD_AUTHORIZATION`, `CMDBUILD_COOKIE_HEADER` или `CMDBUILD_USERNAME` + `CMDBUILD_PASSWORD`.
5. Откройте custom page `CmdbLabels`.
6. Вставьте:

```text
Code;Description;zabbix_main_hostid;hostname;ipaddress;mgmt;serialnum;Модель
C2M-CITY-20260523-ARM-001-01;АРМ 01 для Test City 001;13734;c2m-arm-city-001-01;192.168.202.35;;C2M-CITY-20260523-ARM-SN-001-01;HP 1111
```

Ожидаемый результат: UI дозапрашивает недостающую `Группа модели` через `/cmdbuild/custom-api/labels/resolve`; генерация этикеток активна только когда заполнены `Инв. номер`, `Тип/Модель`, `Группа модели`, `SN`.

Не используйте `http://localhost:8090/cmdbuild/ui/#custompages/CmdbLabels` как рабочий вход: `8090` не обслуживает `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`. Открывайте CMDBuild через `http://localhost:8088/cmdbuild/`, затем custom page `CmdbLabels`.
