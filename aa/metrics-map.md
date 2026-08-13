# Карта метрик

`cmdb2label` exposes Prometheus text format at `GET /metrics`. The endpoint should be scraped through an internal/protected route, not published as an unauthenticated internet-facing endpoint.

| Metric | Type | Flow | Labels | Purpose | Sensitive data |
| --- | --- | --- | --- | --- | --- |
| `cmdb2label_http_requests_total` | counter | `IF-005`, `IF-003`, `IF-002` | `route`, `status` | Count completed HTTP requests by route class and status class | No path query, cookies, tokens, payloads |
| `cmdb2label_cmdbuild_requests_total` | counter | `IF-004` | `method`, `status` | Count direct CMDBuild REST calls by method and status class | No CMDBuild URL query or payload |
| `cmdb2label_cmdbuild_proxy_requests_total` | counter | Disabled generic proxy path | `method`, `status` | Count generic CMDBuild proxy calls when explicitly enabled | Generic proxy is disabled by default |

## Scrape contract

| Endpoint | Port | Format | Auth |
| --- | --- | --- | --- |
| `GET /metrics` | HTTP `8094` or protected platform route | `text/plain; version=0.0.4` | Deployment must protect route if exposed outside internal monitoring |

## Notes

- Metrics are in-memory process counters and reset on process restart.
- Metrics do not contain CMDBuild session identifiers, labels, serial numbers, inventory numbers, user names, or raw CMDBuild payloads.
- `cmdb2label_cmdbuild_proxy_requests_total` is present only if the disabled generic proxy is explicitly enabled and used.
