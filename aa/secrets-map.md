# Карта секретов

| ID | Flow | Secret / sensitive item | Where stored | Where used | Rotation | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SEC-001 | `IF-001`, `IF-003`, `IF-004` | `CMDBuild-Authorization` cookie/header | Browser as CMDBuild `HttpOnly` cookie; backend request memory | Backend extracts server-side and forwards as CMDBuild REST header | CMDBuild session policy | Browser JavaScript must not read or log it |
| SEC-002 | `IF-003` | `X-CMDB2Label-CSRF` token | Derived by backend from `CMDB_LABELS_CSRF_SECRET` and CMDBuild session | Required for `POST /cmdbuild/custom-api/labels/resolve` | Rotate by changing CSRF secret; current browser tokens become invalid | Token not logged |
| SEC-003 | `IF-003` | `CMDB_LABELS_CSRF_SECRET` | Deployment secret/env | CSRF token generation | On compromise, environment change, or deployment secret rotation policy | Required in production; placeholder rejected |
| SEC-004 | `IF-004`, `IF-008` | Customer CA bundle | Runtime read-only mount or ignored `certs/customer-ca/customer-ca.crt` before customer-specific build | Node TLS via `NODE_EXTRA_CA_CERTS`; Docker build trust store when embedded | Customer certificate rotation process | Real CA, private keys, archives and fingerprints are not committed |
| SEC-005 | `IF-003`, `IF-004` | Alias config file path/content | `/etc/cmdb2label/aliases.json` or deployment config | Attribute alias matching and lookup derivation | Change with CMDBuild model updates | File path is config, not secret; content must not include credentials |
| SEC-006 | `IF-007` | CMDBuild admin credentials/session for custom page registration | Operator secret source or temporary shell env | `npm run register:custompage` / CMDBuild UI upload | After admin credential policy or session expiry | Do not commit or paste live cookie/token |
| SEC-007 | `IF-008` | Registry credentials | Docker host credential store / CI secret | Pull/push image | Registry policy | Docker daemon trust is separate from in-image application TLS trust |

## Handling rules

- Do not log `Cookie`, `Authorization`, `CMDBuild-Authorization`, `Set-Cookie`, `X-CMDB2Label-CSRF`.
- Do not store `.env` with real production values in git.
- Do not commit real customer CA, private key, certificate archive, or fingerprint.
- `CMDB_LABELS_LOG_EXTERNAL_SINK` declares external log route and is not a secret.
- `CMDB_LABELS_CUSTOM_CA_FILE` points to a certificate artifact; it must not point to a private key.
