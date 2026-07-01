# Регистрация custom page в CMDBuild

Custom page `CmdbLabels` является launcher'ом. Она не содержит бизнес-логики и не работает с cookie напрямую.

Важно: запущенный backend и nginx route `/cmdbuild/labels/ui` сами по себе не создают запись в CMDBuild. Чтобы страница появилась в разделе custom pages, нужно зарегистрировать zip-артефакт в CMDBuild через UI или REST API.

## Сборка zip

```bash
npm run build:zip
```

Launcher использует относительный путь `/cmdbuild/labels/ui`, поэтому CMDBuild UI нужно открывать через тот же reverse proxy, который обслуживает backend routes `cmdb2label`.

Артефакт:

```text
dist/cmdblabels-custompage.zip
```

Содержимое zip:

```text
CmdbLabels.js
```

JS class:

```text
CMDBuildUI.view.custompages.CmdbLabels.CmdbLabels
```

Рекомендуемый code custom page:

```text
CmdbLabels
```

Metadata регистрации:

```text
name: CmdbLabels
description: CMDB Labels
alias: widget.cmdb-labels
componentId: view.custompages.CmdbLabels.CmdbLabels
active: true
```

`componentId` указывается без префикса `CMDBuildUI`. Полное имя класса внутри JS-файла остается `CMDBuildUI.view.custompages.CmdbLabels.CmdbLabels`.

## Автоматическая регистрация

Сначала проверьте, что скрипт видит правильный CMDBuild origin и не выводит секреты:

```bash
CMDBUILD_ORIGIN=http://localhost:8088 \
CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt \
npm run register:custompage:dry-run
```

Зарегистрируйте или обновите custom page:

```bash
CMDBUILD_ORIGIN=http://localhost:8088 \
CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt \
npm run register:custompage
```

Поддерживаемые варианты авторизации:

```bash
CMDBUILD_AUTHORIZATION=<token> npm run register:custompage
CMDBUILD_COOKIE_HEADER='CMDBuild-Authorization=<token>; ...' npm run register:custompage
CMDBUILD_COOKIE_JAR=/tmp/cmdbuild-ui-cookie.txt npm run register:custompage
CMDBUILD_USERNAME=<user> CMDBUILD_PASSWORD=<password> npm run register:custompage
CMDBUILD_USERNAME=<user> CMDBUILD_PASSWORD_FILE=/run/secrets/cmdbuild-password npm run register:custompage
```

`CMDBUILD_ORIGIN` может указывать как на прямой CMDBuild upstream, например `http://127.0.0.1:8090`, так и на общий reverse proxy, например `http://localhost:8088`. Для проверки browser flow используйте общий reverse proxy. Если путь `/cmdbuild` не указан, скрипт добавит его автоматически.

Скрипт сначала ищет существующую страницу `CmdbLabels`. Если она найдена, выполняется `PUT /cmdbuild/services/rest/v3/custompages/{id}` с тем же zip. Если конкретная версия CMDBuild не поддерживает update этого ресурса, скрипт завершится ошибкой без удаления существующей страницы; в этом случае обновите zip вручную в UI или удалите/создайте страницу административно.

## REST пример

```bash
npm run build:zip

curl -b /tmp/cmdbuild-ui-cookie.txt \
  -F 'data={"name":"CmdbLabels","description":"CMDB Labels","alias":"widget.cmdb-labels","componentId":"view.custompages.CmdbLabels.CmdbLabels","active":true};type=application/json' \
  -F 'file=@dist/cmdblabels-custompage.zip;type=application/zip' \
  'http://localhost:8088/cmdbuild/services/rest/v3/custompages'
```

Вместо cookie jar можно передать заголовок:

```bash
curl -H "CMDBuild-Authorization: $CMDBUILD_AUTHORIZATION" \
  -F 'data={"name":"CmdbLabels","description":"CMDB Labels","alias":"widget.cmdb-labels","componentId":"view.custompages.CmdbLabels.CmdbLabels","active":true};type=application/json' \
  -F 'file=@dist/cmdblabels-custompage.zip;type=application/zip' \
  'http://localhost:8088/cmdbuild/services/rest/v3/custompages'
```

## Регистрация в CMDBuild UI

1. Откройте CMDBuild под тем же nginx/reverse proxy, через который будет доступен `cmdb2label`.
2. Перейдите в `Administration`.
3. Откройте раздел custom pages.
4. Создайте новую custom page или обновите существующую.
5. Укажите code/name `CmdbLabels`.
6. Укажите alias `widget.cmdb-labels`, если форма требует alias.
7. Укажите componentId `view.custompages.CmdbLabels.CmdbLabels`, если форма требует componentId.
8. Загрузите `dist/cmdblabels-custompage.zip`.
9. Назначьте страницу в меню или рабочую область, где пользователи будут печатать этикетки.
10. Выдайте пользователям права на открытие custom page и обычные права чтения на классы оборудования.
11. Сохраните изменения и обновите CMDBuild UI.

## Проверка

1. Откройте custom page `CmdbLabels`.
2. Launcher должен перевести browser на:

```text
/cmdbuild/labels/ui
```

Не используйте `http://localhost:8090/cmdbuild/ui/#custompages/CmdbLabels` для проверки `cmdb2label`: прямой `8090` не проксирует `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.

3. На странице должен быть статус `CMDBuild: сессия активна`.
4. Вставьте тестовый свободный ввод:

```text
SN
C2M-CITY-20260523-SN-300
```

5. Если карточка видима текущему пользователю и алиасы атрибутов совпали, UI заполнит недостающие поля и разрешит генерацию этикетки.

## Типовые проблемы

- Страницы нет в разделе custom pages: zip собран, но не зарегистрирован в CMDBuild; выполните `npm run register:custompage` или ручную загрузку.
- `401` при регистрации: сессия истекла, cookie jar пустой или `CMDBUILD_AUTHORIZATION` не соответствует текущему CMDBuild.
- `403` при регистрации: у пользователя нет административных прав на custom pages.
- Ошибка update существующей страницы: версия CMDBuild может не поддерживать `PUT` для custom pages; обновите zip вручную в UI.
- Страница зарегистрирована, но не видна пользователю: проверьте grants/меню CMDBuild для custom page `CmdbLabels`.
- Неверный `componentId`: должен быть `view.custompages.CmdbLabels.CmdbLabels`, без префикса `CMDBuildUI`.
- `404 /cmdbuild/labels/ui`: nginx не проксирует `/cmdbuild/labels/` в backend.
- Пустая страница при открытии через `8090`: откройте CMDBuild через `http://localhost:8088/cmdbuild/`; `8090` не проксирует backend routes `cmdb2label`.
- `401 /cmdbuild/custom-api/labels/session`: пользователь не авторизован в CMDBuild на этом же origin или cookie path/domain не совпадает.
- `403 /resolve`: отсутствует same-origin `Origin`/`Referer` или CSRF token.
- Данные не подтягиваются: у пользователя нет прав на класс/атрибут или реальные коды атрибутов нужно добавить в `CMDB_LABELS_ALIAS_CONFIG_FILE`.
