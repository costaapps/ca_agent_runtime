# Preparação da worktree de multi-tenancy

## Base e responsabilidade

- Branch: `codex/runtime-multitenant`.
- Base: `b72f1a6c3f170b47bfc3448f5dbfd371174e05b7` (`develop`).
- Esta worktree pertence ao coordenador A: aplicação, contratos, configuração,
  isolamento, pools, migrations, lifecycle e testes semânticos.
- Manifesto/lockfile, scripts npm, Docker e CI/CD pertencem ao coordenador B.

O plano aprovado utiliza somente modo central: `CompanyUUID` obrigatório,
Registry `Company` → `Databases`, allowlist explícita, pool por `IdDatabase`
e contexto de negócio por `IdCompany`. A primeira versão possui uma réplica;
autenticação e coordenação distribuída ficam para etapas posteriores.

## Ferramentas locais

Node **24.21.0** e npm **11.19.0** estão instalados como runtime portátil em:

```text
%LOCALAPPDATA%\Codex\TaskRuntimes\node-v24.21.0-win-x64
```

O ZIP oficial foi validado com SHA-256:

```text
158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541
```

Ative essa versão somente na sessão PowerShell utilizada para desenvolver:

```powershell
$taskNodeDir = Join-Path $env:LOCALAPPDATA 'Codex\TaskRuntimes\node-v24.21.0-win-x64'
$env:PATH = $taskNodeDir + ';' + $env:PATH
node --version
npm --version
```

As dependências foram instaladas com `npm ci`, sem modificar o lockfile.

Docker Desktop está disponível com engine Linux/amd64, contexto
`desktop-linux`. A imagem de banco foi obtida pelo digest:

```text
mariadb:11.8.6@sha256:78a5047d3ba33975f183f183c2464cc7f1eab13ec8667e57cc9a5821d6da7577
```

O executável dessa imagem confirmou `11.8.6-MariaDB-ubu2404`, a referência
informada para o ambiente. A preparação não criou um banco persistente.

## Histórico de migrations preservado

O journal e os snapshots `0000`–`0004` foram recuperados de
`C:\VsCodeRepos\ca_agent_runtime\drizzle\meta` e comparados por hash,
arquivo a arquivo. Os seis arquivos foram preservados byte a byte e passam
a ser versionados. Os SQLs existentes e timestamps do journal foram mantidos.

Esse histórico deve ser usado antes de gerar a migration que substituirá
a unicidade global de `TurnUUID` por `(IdCompany, TurnUUID)`.

## Validação inicial

Executada sobre a aplicação da base, com Node 24.21.0:

- `npm run lint`: aprovado (typecheck).
- `npm run build`: aprovado.
- `npm test`: 30 arquivos aprovados, 2 ignorados; 249 testes aprovados,
  7 ignorados.
- Testes opcionais com OpenAI real foram desabilitados por
  `RUN_OPENAI_INTEGRATION_TESTS=0`.
- `git diff --check`: aprovado.

## Próxima etapa

Consolidar os tipos e interfaces comuns antes de delegar os dois blocos:

1. Registry, descriptors, allowlist, pools, leases e rotação.
2. Repositories por empresa, coordenação em memória, migration e replay.

O coordenador integra contratos HTTP, fachada de execução, servidor,
metadata MCP, healthchecks e shutdown. A alteração do Core e do MCP real
é uma dependência externa ao escopo desta worktree.
