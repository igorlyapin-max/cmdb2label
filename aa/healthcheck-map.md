# Карта HealthCheck

| ID | Поток | Endpoint | Caller | Status | Dependencies checked | Exposed data | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| HC-001 | `IF-005` | `GET /health/live` | Docker healthcheck, LB, operator | `200` alive | Backend process only | service, `live`, safe build identity | No CMDBuild data |
| HC-002 | `IF-005` | `GET /health/ready` | LB, monitoring, operator | `200` ready, `503` not ready | Runtime config and CMDBuild upstream reachability | service, `ready`, status, safe build identity | Does not expose `CMDBUILD_ORIGIN` or raw error |
| HC-003 | `IF-005` | `GET /cmdbuild/custom-api/labels/health/live` | Same-origin proxy/monitoring | `200` alive | Backend process only | Same as liveness | API-prefixed alias for proxy integration |
| HC-004 | `IF-005` | `GET /cmdbuild/custom-api/labels/health/ready` | Same-origin proxy/monitoring | `200` ready, `503` not ready | Runtime config and CMDBuild upstream reachability | Same as readiness | API-prefixed alias for proxy integration |
| HC-005 | `IF-005` | Docker `HEALTHCHECK` | Docker engine | Exit `0` or `1` | `GET /health/live` on container port `8094` | Exit code only | Uses `127.0.0.1:8094` inside container |
| HC-006 | `IF-005` | `GET /about` and `GET /cmdbuild/custom-api/labels/about` | Operator, support UI | `200` | Build identity file/env only | version, buildVersion, revision, sourceState, runtimeArtifact SHA256 | No CMDBuild origin, cookies, or secrets |
| HC-007 | `IF-003` | `GET /cmdbuild/custom-api/labels/logging/status` | Authenticated browser/operator | `200`, `401` | Valid CMDBuild session cookie | log level, format, targets, diagnostic mode, redaction headers | Diagnostic endpoint, not readiness |

## Readiness failure classes

| Failure | Expected status | Operator action |
| --- | --- | --- |
| Invalid runtime config | `503` | Fix env/config, check startup `app.config_invalid` event |
| CMDBuild upstream unavailable | `503` | Check `CMDBUILD_ORIGIN`, network, TLS/CA, CMDBuild status |
| Missing optional custom CA while mode `none` | Ready can still pass | No action unless private TLS dependency is enabled |
| Missing custom CA while mode `mount`/`embedded` | startup/readiness config error | Mount readable CA and align `NODE_EXTRA_CA_CERTS` |
