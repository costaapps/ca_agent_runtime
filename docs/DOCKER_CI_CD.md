# Docker, CI/CD e releases

## Imagem

A imagem é Linux `amd64`, roda como usuário `node` e usa Node `24.21.0` sobre
`bookworm-slim`. A imagem base deve ser referenciada pelo digest aprovado no
Dockerfile. O build de produção mantém `dist/src/server.js` e instala as
dependências de produção pelo lockfile, incluindo dependências opcionais
necessárias ao cliente MCP.

A mesma imagem serve a API e o executor administrativo de migrations:

```sh
npm run db:migrate:prod -- --company-uuid <UUID>
```

Esse comando escolhe uma única base pelo Registry e usa
`MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD`. O entrypoint do container não
executa migrations. A imagem também não recebe `.env`, credenciais, checkout
Git, testes ou ferramentas de desenvolvimento.

O Compose de referência consome uma imagem por digest, mantém uma instância,
recebe configuração de fora do container, limita a rotação de logs e concede
130 segundos para encerramento gracioso.

## Gates de CI

Pull requests e pushes para `develop` e `main` executam typecheck, build de
produção e testes determinísticos. A suíte de banco sobe MariaDB `11.8.6`
efêmero com um Registry e duas bases de tenant, incluindo duas empresas que
compartilham uma base. Ela aplica migrations em base vazia, reaplica o journal,
atualiza o schema anterior e executa os testes de isolamento.

O pipeline constrói uma imagem `linux/amd64`, executa o smoke contra MariaDB e
um MCP HTTP fake e verifica readiness, validação do tenant, fechamento de
Session no destino correto, usuário do container, conteúdo final, migrations e
SIGTERM. OpenAI, Core e MCP reais não são dependências do gate.

Auditoria de dependências de produção e varredura da imagem bloqueiam
vulnerabilidades HIGH ou CRITICAL que tenham correção disponível. O gate não
publica imagens em pushes e pull requests.

## Configuração do GitHub

No repositório, configure:

| Tipo | Nome | Valor |
|---|---|---|
| Variable | `DOCKERHUB_USERNAME` | `eduardomatuellacostaapps` |
| Variable | `DOCKERHUB_IMAGE` | `eduardomatuellacostaapps/ca` |
| Secret | `DOCKERHUB_TOKEN` | Token de acesso do Docker Hub com permissão de escrita no repositório `ca` |

O token fica disponível somente no job de publicação. Workflows usam permissões
mínimas, Actions fixadas por SHA e concorrência para serializar releases.

Configure uma regra de proteção para `main` que exija pull request e a
conclusão dos gates de CI. Proteja tags `v*` contra exclusão e alteração depois
da criação, para que uma release publicada continue apontando ao commit
validado.

## Publicar uma release

O workflow aceita somente `release.published` estável com tag `vX.Y.Z`. Ele
resolve o commit exato indicado pela tag, exige que esse commit pertença a
`main` e confere que `X.Y.Z` coincide com `package.json`. O workflow executa os
gates novamente nesse commit, testa uma imagem `linux/amd64` e envia ao Docker
Hub os mesmos bytes que passaram no smoke.

Para a versão planejada `0.2.0`, as tags são:

```text
docker.io/eduardomatuellacostaapps/ca:agent-runtime-0.2.0
docker.io/eduardomatuellacostaapps/ca:agent-runtime-sha-<SHA completo>
```

Não são atualizadas tags genéricas como `latest` ou `0.2.0`. Uma tag de versão
existente nunca é sobrescrita. Em uma nova execução, uma imagem já publicada só
pode ser reutilizada quando os labels indicam esta aplicação e o mesmo commit;
conflitos falham. O resumo do workflow informa versão, commit e digest. A
implantação deve referenciar o digest, por exemplo:

```text
docker.io/eduardomatuellacostaapps/ca@sha256:<digest aprovado>
```

## Migrations e rollback

Migrations são uma operação administrativa separada, executada explicitamente
por empresa antes de disponibilizar a aplicação compatível com o schema. O
workflow de release não conecta a bancos reais nem executa migrations.

Após a migration que permite `TurnUUID` repetido entre empresas, uma versão
antiga que consulta `TurnUUID` globalmente não é um rollback seguro. Rollback
exige uma imagem central que entenda o schema e preserve o escopo composto de
empresa e Turn.

## Limites desta entrega

O pipeline publica imagens após uma release aprovada; ele não cria a primeira
release, executa deploy nas VPS ou configura Swarm. A validação multi-tenant
usa Registry e MCP fakes; habilitar tráfego com Core e MCP reais depende da
evolução externa desses serviços.
