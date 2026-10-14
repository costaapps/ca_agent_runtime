# Preparação da worktree de Docker e CI/CD

## Base e responsabilidade

- Worktree: `C:\Users\user\.codex\worktrees\a710\ca_agent_runtime`.
- Branch: `codex/runtime-dockerhub`.
- Base aprovada: `b72f1a6c3f170b47bfc3448f5dbfd371174e05b7`.
- Esta frente implementará Docker, empacotamento, CI/CD e integração final.
- A frente de multi-tenancy está em `codex/runtime-multitenant`.

O plano aceito nesta conversa é a referência de execução. Esta preparação
não implementa a feature nem modifica o código de multi-tenancy.

## Decisões do plano

- Imagem Linux `amd64`; Node `24.21.0-bookworm-slim` fixado por digest.
- Validação de banco em MariaDB `11.8.6` efêmero.
- Docker Hub: `eduardomatuellacostaapps/ca`.
- Publicação somente em releases estáveis `vX.Y.Z`, sobre commit de `main`.
- Tags: `agent-runtime-X.Y.Z` e `agent-runtime-sha-<SHA completo>`.
- Primeira versão planejada: `0.2.0`.
- Construir, testar e publicar a mesma imagem, sem reconstrução após o smoke.
- Nenhuma release, publicação manual ou implantação em VPS nesta preparação.

## Ownership

Esta worktree possui o manifesto e lockfile, scripts npm, configuração de
build de produção, Dockerfile, dockerignore, Compose de referência, workflows,
harness de banco, smoke da imagem e documentação de CI/CD.

A outra frente possui `src`, configuração da aplicação e exemplo de ambiente,
schema, SQLs, metadados Drizzle, executor administrativo de migrations,
regra de ignore das migrations, testes semânticos e fixtures de tenants.
Solicitações de mudança nessa área devem ser coordenadas com seu responsável.

## Ambiente local

O Node global identificado é `22.17.0`. O Node `24.21.0` foi instalado
isoladamente em `.codex/tools/node-v24.21.0-win-x64`, com o SHA-256 do ZIP
comparado ao arquivo oficial `SHASUMS256.txt`.

Ative-o na sessão PowerShell antes de executar os comandos:

```powershell
. .\.codex\tools\use-node.ps1
node --version
npm.cmd --version
npm.cmd ci --no-fund --no-audit
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

As ferramentas locais são excluídas pelo arquivo local `info/exclude` do Git;
a regra versionada de ignore da aplicação não foi alterada. O arquivo
autogerado `.codex/environments/environment.toml` foi preservado.

Docker Desktop usa o engine Linux `amd64`, contexto `desktop-linux`.
Verifique sua disponibilidade com `docker version` e `docker buildx version`.

As imagens de referência foram baixadas por digest e executadas somente
para conferir versões, sem iniciar um serviço de banco:

```text
node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577
```

## Validação da base em 13/10/2026

- Instalação limpa pelo lockfile com Node `24.21.0`: aprovada.
- `npm run lint` (typecheck): aprovado.
- `npm run build`: aprovado; gerou `dist/src/server.js`.
- `npm test`: 249 testes aprovados e 7 opcionais ignorados;
  30 arquivos aprovados e 2 arquivos opcionais ignorados.
- Docker Engine Linux `28.3.0` e Buildx `0.25.0`: disponíveis.
- Execução das imagens oficiais confirmou Node `24.21.0` e MariaDB `11.8.6`.

Esses resultados validam a base anterior às features; não substituem os
gates futuros de empacotamento e multi-tenancy integrada.

## Sequência de desenvolvimento

1. Alinhar contratos de env, health, migration compilada e fixtures com a frente A.
2. Separar build de produção do typecheck completo e preparar a imagem multistage.
3. Preparar CI reutilizável, MariaDB efêmero e smoke com MCP HTTP fake.
4. Preparar publicação por release, isolamento de credenciais e proteção de tags.
5. Revisar a feature e incorporar os commits revisados de multi-tenancy.
6. Executar os gates completos no código integrado antes de qualquer publicação.

Na implementação, dois subagentes trabalharão em áreas exclusivas:
empacotamento/smoke e infraestrutura CI/publicação. O coordenador manterá
os arquivos compartilhados e fará a integração; a revisão acontecerá depois.

## Dependências da frente A

- `CompanyUUID` obrigatório e allowlist explícita no modo central.
- Healthchecks `/health/live`, `/health/ready` e `/health/dependencies`.
- Executor compilado para `db:migrate:prod -- --company-uuid <UUID>`.
- Fixtures e testes de isolamento, incluindo duas empresas na mesma base.
- Histórico Drizzle `0000`–`0004` preservado e versionado pela frente A.

O histórico ignorado ainda existe no checkout original e não foi copiado ou
alterado por esta preparação. O smoke central final depende da integração de A.

## Gates previstos

Typecheck, build, suíte determinística, migrations em MariaDB efêmero,
isolamento, reaplicação/upgrade, smoke da imagem, shutdown, auditoria de
dependências e varredura da imagem. Nenhum serviço ou banco real será necessário.

Os gates finais ainda não foram implementados. A homologação com Core/MCP
multi-tenant reais e o deploy nas VPS pertencem a etapas externas.
