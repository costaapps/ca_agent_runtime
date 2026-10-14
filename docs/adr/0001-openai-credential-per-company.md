# ADR 0001: OpenAI credential per company

- Status: Accepted and implemented
- Date: 2026-10-14

## Context

AgentRuntime serves companies whose data may live in separate customer databases, and multiple companies may share one database. A process-wide `OPENAI_API_KEY` would make every company's inference cost use the same credential and would not follow the Runtime's existing Registry routing boundary. The model choice remains an operational default shared by this service.

## Decision

- Resolve `CompanyUUID` through the central Registry and acquire the tenant database lease as the Runtime already does.
- When an actual model run begins, read exactly one non-empty `GeneralSettings.Value` using `IdCompany` from the validated Registry descriptor and `UPPER(Param) = 'OPENAIKEY'`.
- Use a parameterized query with a two-row limit so missing, empty, or duplicate settings fail safely. Do not fall back to an environment API key.
- Cache the lookup only for the current HTTP operation. The next operation reads the current database value.
- Create an OpenAI model provider per run with that credential. Pass the same credential to SDK trace export and to Knowledge connections that retain the existing `RUNTIME_ENV/OPENAI_API_KEY` descriptor.
- Keep `OPENAI_MODEL` as a required global environment setting, such as `gpt-6-luna`; it is neither fixed in code nor tenant-specific in this change.
- Do not change HTTP payloads, add AI configuration tables, alter database schema, or introduce usage/billing management.

## Consequences

- Each tenant database must contain exactly one valid `OPENAIKEY` setting for the Registry's `IdCompany`, and the Runtime's business database user needs `SELECT` permission on `GeneralSettings`.
- Startup, readiness, migrations, Session Close, and idempotent Turn replay do not need an OpenAI key. A missing or duplicate key affects only an execution that needs inference and returns a sanitized configuration error.
- The credential is never part of Runtime configuration JSON, model context, trace metadata, or application log payloads. The OpenAI SDK receives it only through per-run provider and trace configuration.
- Live OpenAI tests may still use `OPENAI_API_KEY` as an explicit test-only credential. It is no longer a server configuration requirement or a production fallback.
- Vitest does not load a developer's `.env` implicitly; deterministic tests use fixtures, while live tests require explicitly inherited variables.
- This does not provide usage accounting or billing attribution beyond having each company supply its own OpenAI credential.

## Operational notes

No migration is required. Populate or verify `GeneralSettings` for each Registry company before its first inference. Rolling back to a Runtime version that requires the process-wide key requires restoring that previous version's environment configuration separately.
