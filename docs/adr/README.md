# Architecture Decision Records

ADRs record implemented architectural decisions and their consequences. Each file covers one decision; future changes should add the next numbered record and link it from this index.

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-openai-credential-per-company.md) | Read the OpenAI API key from each routed company's `GeneralSettings`; keep `OPENAI_MODEL` global | Accepted and implemented |
