# Publicação e atualização manual

O CI de pull requests e pushes para `develop`/`main` valida o código e faz smoke test da imagem, sem publicar no Docker Hub. Uma release estável `vX.Y.Z` publicada a partir de um commit de `main` repete os gates, constrói uma imagem `linux/amd64`, testa essa imagem e publica o mesmo artefato com duas tags:

- `eduardomatuellacostaapps/ca:agent-runtime-<run_number>` identifica o run de publicação do GitHub Actions.
- `eduardomatuellacostaapps/ca:agent-runtime-<versão>` identifica a release, por exemplo `agent-runtime-0.2.0`.

As duas tags apontam para o mesmo digest. O fluxo não publica `latest`; falha se uma tag existente apontar para outra versão, commit ou imagem. Reexecutar o mesmo workflow pode reutilizar as tags somente quando os labels da imagem identificam a mesma aplicação, versão e commit.

Antes da primeira publicação, configure estes **Repository Secrets** no GitHub:

- `DOCKERHUB_USERNAME=eduardomatuellacostaapps`
- `DOCKERHUB_IMAGE=eduardomatuellacostaapps/ca`
- `DOCKERHUB_TOKEN`: token com permissão de escrita no repositório Docker Hub.

Os três são lidos apenas pelo job de publicação. Build e smoke usam uma tag local e não precisam desses secrets.

## Atualizar a VPS

O GitHub Actions não acessa nem atualiza a VPS. Faça o rollout manualmente usando uma das tags imutáveis publicadas. A tag de versão facilita escolher uma release; a tag numérica identifica o run que a publicou.

No diretório do clone, crie `deploy/.env` com a imagem escolhida e o caminho do arquivo de ambiente do Runtime:

```dotenv
AGENT_RUNTIME_IMAGE=eduardomatuellacostaapps/ca:agent-runtime-0.2.0
AGENT_RUNTIME_ENV_FILE=../agent-runtime.env
```

Mantenha `agent-runtime.env` fora do Git e configure nele as variáveis de execução descritas em `.env.example`. Então aplique a imagem:

```sh
docker compose --env-file deploy/.env -f deploy/compose.agent-runtime.yml pull
docker compose --env-file deploy/.env -f deploy/compose.agent-runtime.yml up -d
docker compose --env-file deploy/.env -f deploy/compose.agent-runtime.yml ps
```

Para voltar, altere `AGENT_RUNTIME_IMAGE` para a tag anterior e execute novamente `pull` e `up -d`. Confira antes se a imagem escolhida é compatível com o schema atual: migrations de banco não são revertidas automaticamente, e uma imagem anterior ao modo central pode não ser segura depois da reutilização de `TurnUUID` entre empresas.

## Migrations

O Compose e a inicialização do servidor não aplicam migrations. Para cada empresa, execute explicitamente o executor incluído na mesma imagem, antes do rollout que depende do schema atualizado:

```sh
set -a
. ./deploy/.env
set +a

docker run --rm \
  --env-file ./agent-runtime.env \
  --entrypoint node \
  "$AGENT_RUNTIME_IMAGE" \
  dist/src/database/migrate.js \
  --company-uuid "$COMPANY_UUID"
```

O arquivo de ambiente precisa fornecer acesso ao Registry e `MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD` com permissões administrativas na base de destino. O executor resolve a base pelo `CompanyUUID`; ele não migra o Registry nem descobre outras empresas automaticamente. Depois de concluir as migrations necessárias, atualize a imagem pelo Compose.
