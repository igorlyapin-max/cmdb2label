# cmdb2label

`cmdb2label` генерирует печатные этикетки 6x3 см для оборудования CMDBuild.

Приложение работает как CMDBuild custom page:

- custom page `CmdbLabels` является тонким launcher'ом;
- основная UI открывается на `/cmdbuild/labels/ui`;
- backend API находится на `/cmdbuild/custom-api/labels/*`;
- CMDBuild cookie используется только server-side, browser JS ее не читает.

## Быстрый старт

```bash
npm test
npm run build:zip
npm run register:custompage:dry-run
CMDBUILD_ORIGIN=http://127.0.0.1:8090 npm start
```

Dev URL backend:

```text
http://127.0.0.1:8094/cmdbuild/labels/ui
```

Dev URL через nginx:

```text
http://localhost:8088/cmdbuild/labels/ui
```

В совместном dev-окружении используйте существующий nginx `cmdbcustompages` на `http://localhost:8088/cmdbuild/` как вход в CMDBuild. Он оставляет рабочие маршруты `cmdbcustompages` на `8093` и добавляет только labels routes к backend `cmdb2label` на `8094`. Порт `8090` - прямой CMDBuild upstream; custom page, открытая через `8090`, не является поддерживаемым входом для `cmdb2label`.

## Ввод данных

Поддерживаются три сценария:

- CSV-файл;
- copy/paste CSV;
- свободный ввод одной карточки в формате пар строк `имя атрибута` / `значение`.

Пример свободного ввода:

```text
SN
C2M-CITY-20260523-SN-300
```

Если задан `SN` или `Инв. номер`, backend дозапрашивает недостающие `Инв. номер`, `Тип/Модель`, `Тип`, `SN` через CMDBuild REST от имени текущего пользователя. `Тип` по умолчанию выводится из parent lookup значения атрибута модели.

## Основные команды

```bash
npm run check
npm test
CMDB_LABELS_PROXY=http://127.0.0.1:8088 npm run test:browser
npm run secret:scan
npm run build:zip
npm run register:custompage:dry-run
npm run register:custompage
npm start
```

`register:custompage` требует действующую CMDBuild-сессию или учетные данные администратора. Подробности: [Регистрация custom page](docs/custom-page-registration.ru.md).

Для production-like запуска задайте стабильный `CMDB_LABELS_CSRF_SECRET`; пример безопасных env-переменных находится в [.env.example](.env.example).

## Документация

- [Архитектура](docs/architecture.ru.md)
- [Тестовое окружение](docs/development-environment.ru.md)
- [Интеграция nginx](docs/nginx-integration.ru.md)
- [Регистрация custom page](docs/custom-page-registration.ru.md)
- [Runbook](docs/runbook.ru.md)
