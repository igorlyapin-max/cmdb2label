# AGENTS.md

## Project Rules

- Все обсуждения с пользователем веди на русском языке, если пользователь явно не попросил другой язык.
- Для разработки этого приложения используй global skills `engineering-standards`, `cmdbuild-integration`, `embedded-ui-reverse-proxy`; для структуры знаний и документации используй `knowledge-management`.
- Custom page должна оставаться тонким launcher'ом. Реальная UI и API обслуживаются backend-owned маршрутами `/cmdbuild/labels/*` и `/cmdbuild/custom-api/labels/*`.
- Browser JavaScript не должен читать или логировать `CMDBuild-Authorization`; backend получает cookie server-side и вызывает CMDBuild REST от имени текущего пользователя.
- Не коммить локальные `.agents/` как часть приложения.

## Project-Local Knowledge

- Use `.agents/skills` as project-local knowledge.
- Do not read all skills, references, memories, or knowledge files at startup.
- First choose the smallest relevant skill by `name` and `description`.
- Read only the selected `SKILL.md`, then only directly referenced `references/*.md` needed for the task.
- Keep required project rules in this `AGENTS.md`; keep long API, architecture, runbook, and payload details in repository docs.
