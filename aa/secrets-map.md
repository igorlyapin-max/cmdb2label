# Карта секретов

| ID | Поток | Секрет / чувствительный объект | Где хранится | Где используется | Ротация | Примечания |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | `IF0`, `OAPI0`, `OAPI1` | `CMDBuild-Authorization` cookie/header | Browser как CMDBuild `HttpOnly` cookie; память backend request | Backend извлекает server-side и пересылает как CMDBuild REST header | CMDBuild session policy | Browser JavaScript не должен читать или логировать значение |
| SEC-002 | `OAPI0` | `X-CMDB2Label-CSRF` token | Формируется backend из `CMDB_LABELS_CSRF_SECRET` и CMDBuild session | Требуется для `POST /cmdbuild/custom-api/labels/resolve` | Ротация через смену CSRF secret; текущие browser tokens становятся невалидными | Token не логируется |
| SEC-003 | `OAPI0` | `CMDB_LABELS_CSRF_SECRET` | Deployment secret/env | Генерация CSRF token | При компрометации, изменении environment или по deployment secret rotation policy | Обязателен в production; placeholder отклоняется |
| SEC-004 | `OAPI1`, `IF2` | Customer CA bundle | Runtime read-only mount или ignored `certs/customer-ca/customer-ca.crt` перед customer-specific build | Node TLS через `NODE_EXTRA_CA_CERTS`; Docker build trust store при embedded mode | Customer certificate rotation process | Реальные CA, private keys, archives и fingerprints не коммитятся |
| SEC-005 | `OAPI0`, `OAPI1` | Alias config file path/content | `/etc/cmdb2label/aliases.json` или deployment config | Attribute alias matching и lookup derivation | Изменение вместе с обновлениями модели CMDBuild | File path является config, не secret; content не должен включать credentials |
| SEC-006 | `OAPI2` | CMDBuild admin credentials/session для регистрации custom page | Operator secret source или temporary shell env | `npm run register:custompage` / загрузка через CMDBuild UI | По admin credential policy или после session expiry | Не коммитить и не вставлять live cookie/token |
| SEC-007 | `IF2` | Registry credentials | Docker host credential store / CI secret | Pull/push image | Registry policy | Docker daemon trust отделен от in-image application TLS trust |

## Правила обработки

- Не логировать `Cookie`, `Authorization`, `CMDBuild-Authorization`, `Set-Cookie`, `X-CMDB2Label-CSRF`.
- Не хранить `.env` с реальными production values в git.
- Не коммитить real customer CA, private key, certificate archive или fingerprint.
- `CMDB_LABELS_LOG_EXTERNAL_SINK` объявляет external log route и не является secret.
- `CMDB_LABELS_CUSTOM_CA_FILE` указывает на certificate artifact; он не должен указывать на private key.
