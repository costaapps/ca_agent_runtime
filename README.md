# Costa Apps Agent Runtime

PoC OpenAI-only que recebe execuções do CoreAPI em `POST /v1/agent-runs`, executa o grafo `ChatOrchestrator -> SalesAgent/SupportAgent` e devolve `Output` estruturado conforme `ExpectedOutput`.

## Executar localmente

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate -- --company-uuid 00000000-0000-4000-8000-000000000001
npm run dev
```

O comando de migration recebe um `CompanyUUID` cadastrado no Registry e usa `MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD`. O processo exige `OPENAI_API_KEY`, `OPENAI_MODEL`, acesso ao Registry central MariaDB, a allowlist `AGENT_RUNTIME_TENANT_ALLOWLIST` e um MCP Server Streamable HTTP em `MCP_SERVER_URL`. Os pools das bases de empresa são criados sob demanda a partir do cadastro central. Os testes padrão não usam OpenAI, banco ou MCP real.

Comandos disponíveis:

```text
npm test
npm run lint
npm run build
npm run db:generate
npm run db:migrate
```

## Endpoints

`GET /health` retorna `{ "status": "ok" }`.

`GET /health/live` verifica se o processo responde. `GET /health/ready` verifica Registry central e MCP (timeout/cache de 5 segundos). `GET /health/dependencies` retorna os estados dessas dependências e contadores agregados dos pools, sem endereços ou credenciais.

`POST /v1/agent-runs`:

```json
{
  "CompanyUUID": "00000000-0000-4000-8000-000000000001",
  "Agent": "chat-orchestrator-poc",
  "IdCompany": 1003,
  "IdChat": 123,
  "IdProcessLine": 456,
  "IdProcessLineFlow": 789,
  "Message": "Oi, quero comprar um carro.",
  "ExpectedOutput": {
    "Name": "Intent",
    "Description": "Identifique a intenção principal do usuário.",
    "AllowedValues": ["SALES", "SUPPORT", "OTHER"]
  }
}
```

Sucesso legado:

```json
{
  "Success": true,
  "ExecutionUUID": "uuid-v4",
  "Output": { "Intent": "SALES" }
}
```

`POST /v1/agent-turns` inicia um turno AIDocument e reutiliza a Session persistida por `IdCompany + IdProcessLine`:

```json
{
  "CompanyUUID": "00000000-0000-4000-8000-000000000001",
  "TurnUUID": "14ed24ea-0000-4000-8000-000000000001",
  "Agent": "sales-agent",
  "IdCompany": 1003,
  "IdChat": 123,
  "IdProcessLine": 456,
  "TurnSource": "MESSAGE",
  "ProcessContextRevision": 4,
  "ProcessContext": {
    "System": {},
    "Facts": {},
    "BusinessReferences": {},
    "CurrentIntent": {}
  },
  "AgentContext": {
    "Name": "Pedido de Venda",
    "Objective": "Montar um pedido de venda.",
    "Instructions": "Use as capabilities disponíveis para cumprir a missão.",
    "CompletionCriteria": ["Cliente definido", "Pedido criado"]
  },
  "Messages": [{ "IdMessage": 1001, "Text": "Quero comprar uma impressora" }]
}
```

`TurnSource` pode ser `MESSAGE` (compatibilidade: ausência equivale a `MESSAGE`) ou `ACTIVATION`. A ativação aceita `Messages: []` e exige `ActivationContext`; o Runtime usa um item interno de sistema, nunca uma fala de usuário artificial.

O Runtime cria `ExecutionUUID`, mantém a memória nativa do Agents SDK em `AIAgentSessionItem`, e devolve `Response` + `Control`. `Control.ContextUpdates` pode propor somente alterações em `Facts` e `CurrentIntent`; o Core valida e persiste o ProcessContext. Repetições do mesmo `TurnUUID` são idempotentes, inclusive quando o payload contém Activation ou uma revisão de contexto diferente.

`AgentContext` é opcional e define a missão do módulo nesta ProcessLine; não identifica o Agent nem autoriza tools. Quando enviado, participa do hash de idempotência do Turn e aparece na seção `[MODULE AGENT CONTEXT]` do Root, depois das instruções técnicas, guardrails, configuração empresarial e Knowledge, antes do Runtime Context. A configuração empresarial e Knowledge continuam congelados por Session. O contexto do módulo vem do Core no Turn atual; o Runtime não consulta nem executa `CompanyModule.Params`.

No `sales-agent`, as instruções técnicas e guardrails são fixos em código. O Root usa `use_flow_capabilities` para delegar ao FlowAgent, único Agent que acessa `list_flow_actions`, `describe_flow_action` e `execute_flow_action`. O FlowAgent interpreta `Effect`, `Available`, `RequiredInputs` e produz seu próprio status: `COMPLETED`, `NEEDS_INPUT`, `NOT_AVAILABLE` ou `FAILED`. `NEEDS_INPUT` mantém `MissingInformation` e o `Output` original em `Results[].OutputJSON` (incluindo `Candidates`), sem ser tratado como erro MCP; o Root pergunta ao cliente e continua em um novo Turn. AUTO, PROMPT, CFL e capabilities globais são executadas e persistidas pelo Core, não por este Runtime.

No contrato de `execute_flow_action`, sucesso funcional (`Success=true`, `isError=false`) retorna `Status=COMPLETED` ou `Status=NEEDS_INPUT`. Uma falha da execução retorna `Success=false`, `isError=true` e `Error.Code/Message`; o FlowAgent interpreta essa falha e produz `FlowAgent.Status=FAILED`, preservando `Results[].Error.Code/Message` e `Results[].OutputJSON=null`. Não existe resposta funcional `Success=true / Status=FAILED`. A falha da capability permanece disponível ao Root através de `use_flow_capabilities`, sem abortar automaticamente o Turn.

Ao formar o `Input` de uma capability, o FlowAgent considera `Description`, `ObjectDescription` e `RequiredInputs` retornados por `describe_flow_action`. `ObjectDescription` é orientação semântica específica da etapa (por exemplo, a forma textual de `Input.Value`), não um schema nem uma validação determinística no Runtime. Sua ausência, valor nulo ou vazio mantém o fluxo compatível. A orientação não pode substituir regras técnicas, tools autorizadas ou contratos da plataforma. A resolução canônica, validação e persistência do PROMPT pertencem exclusivamente ao Core; o Runtime não implementa `DataType`, `InputSchema`, `ResolutionSchema` ou `ExpectedFormat` para isso.

Os testes de `flowObjectDescription` percorrem Root → FlowAgent → MCP fake com o Agents SDK real, verificando a entrega integral da orientação ao modelo e o envio do `Input` sem normalização pelo Runtime. O modelo determinístico comprova esse encadeamento, não a interpretação linguística de um modelo real. Os dois cenários semânticos opcionais (maiúsculas e formato textual) usam OpenAI real somente com `RUN_OPENAI_INTEGRATION_TESTS=1`, `OPENAI_MODEL` e `OPENAI_API_KEY` explicitamente configurados; podem ser executados com `npm test -- tests/integration/flowObjectDescription.test.ts`. A suíte padrão não depende de OpenAI, MCP ou Core reais. A paridade persistente entre Flow Robô e Agentic exige validação no Core e E2E inter-repo separado.

`KnowledgeConfiguration` é opcional em `/v1/agent-turns` e, quando ausente, equivale a `{ "Version": 1, "Connections": [], "References": [] }`. O Core envia conexões lógicas (`Code`, `Provider`, `CredentialSource`, `CredentialReference`, `ExternalOrganizationId?`, `ExternalProjectId?`) e referências resolvidas (`Reference`, `Kind`, `Name`, `Description?`, `ConnectionCode`, `ExternalStoreId`, `ExternalFileId?`, `Filter?`, `SearchOptions?`). O Runtime congela esse payload em `AIAgentSession.KnowledgeConfigurationJSON`. `SearchOptions` aceita `MaxResults` (1–50), `ScoreThreshold` (0–1) e `RewriteQuery`. Referências de documento exigem `Filter`; referências de base pesquisam toda a base.

Com referências autorizadas, qualquer Root Agent recebe a tool local `search_knowledge({ "Reference": "document:commercial/refund-policy", "Query": "Qual é o prazo?" })`. O modelo nunca fornece credenciais, IDs externos, filtro ou opções. A resposta funcional é `FOUND` ou `NO_RESULTS` com `Knowledge: { Kind, Name }` e `Results: [{ SourceName, Content }]`. A busca usa diretamente OpenAI Vector Store Search; não envolve MCP. O teste live opcional requer `RUN_OPENAI_INTEGRATION_TESTS=1` e `OPENAI_TEST_VECTOR_STORE_ID`; o cenário de documento também usa `OPENAI_TEST_DOCUMENT_FILTER_KEY` e `OPENAI_TEST_DOCUMENT_FILTER_VALUE`.

`POST /v1/agent-sessions/close` fecha a Session após confirmação do Core:

```json
{ "CompanyUUID": "00000000-0000-4000-8000-000000000001", "IdCompany": 1003, "IdProcessLine": 456, "Reason": "PROCESS_LINE_CLOSED" }
```

### Multi-tenancy central

As quatro rotas (`agent-runs`, `agent-turns`, `flow-assist` e `agent-sessions/close`) exigem `CompanyUUID`. O Runtime normaliza o UUID, consulta primeiro a allowlist local e resolve `Company` → `Databases` no Registry central. O `IdCompany` do corpo precisa corresponder ao cadastro. O payload não escolhe host, schema ou usuário de banco.

Configure `CENTRAL_DB_HOST`, `CENTRAL_DB_PORT`, `CENTRAL_DB_NAME`, `CENTRAL_DB_USER` e `CENTRAL_DB_PASS` para o Registry, junto a `AGENT_RUNTIME_TENANT_ALLOWLIST` como array JSON não vazio de UUIDs distintos. `CENTRAL_DB_CONNECTION_LIMIT` usa 4 conexões e `CENTRAL_REGISTRY_CACHE_MS` usa TTL de 60 segundos. `TENANT_DB_CONNECTION_LIMIT=8`, `TENANT_DB_MAX_POOLS=32` e `TENANT_DB_IDLE_TIMEOUT_MS=300000` controlam pools das bases empresariais. Não existe fallback para banco padrão.

O descriptor resolvido congela `CompanyUUID`, `IdDatabase` e `IdCompany` para a execução. A fronteira de identidade usa hoje o `CompanyUUID` da requisição por meio de `RequestTenantIdentityResolver`, que pode ser substituído por uma integração de autenticação futura. Cada operação mantém um lease de pool durante espera por Session, inferência, ferramentas, persistência e logs. Empresas na mesma base compartilham pool por `IdDatabase`, enquanto repositories filtram pelo `IdCompany`. A coordenação de Session e Turn é compartilhada dentro do processo Node; esta versão pressupõe uma instância do Runtime.

As gravações de lifecycle iniciadas pelos eventos do Agents SDK são rastreadas e concluídas antes de o Runtime responder e liberar o lease; falhas geram somente um diagnóstico sanitizado. Falhas de conectividade em operações de persistência retornam HTTP 503 com `TENANT_DATABASE_UNAVAILABLE`; erros de schema ou integridade mantêm `PERSISTENCE_ERROR`/500, sem expor SQL, parâmetros ou credenciais. Versões internas das resoluções do Registry impedem consultas antigas de promover uma geração obsoleta: a execução já aceita pode terminar com seu descriptor congelado enquanto novas chamadas continuam na geração atual.

O MCP segue como endpoint compartilhado. Chamadas habilitadas recebem `CompanyUUID` e `IdDatabase` em `_meta.ca.Execution`; o MCP real precisa adotar o roteamento por esses campos, e o Core precisa enviar `CompanyUUID`. A resolução de identidade ainda usa o UUID do corpo e a allowlist configurada; autenticação fica para uma etapa posterior.

Executar migration em uma empresa específica usa credenciais administrativas fornecidas apenas para o comando:

```text
npm run db:migrate:prod -- --company-uuid <CompanyUUID>
```

O executor resolve uma base pelo Registry, usa `MIGRATION_DB_USER` e `MIGRATION_DB_PASSWORD`, e não roda no startup. A migration de Turn substitui unicidade global de `TurnUUID` por `(IdCompany, TurnUUID)`. Depois que empresas distintas reutilizarem o mesmo `TurnUUID`, rollback para a imagem anterior ao modo central não é seguro; use uma imagem central compatível com o schema.

## Arquitetura operacional

### Agent Assist PREFILL no Flow determinístico — V1

`Messages`/`Known` são a fonte exclusiva de fatos sobre a solicitação e o usuário. `Instructions`, `Description` e `ObjectDescription` definem a interpretação e transformação desses fatos. `Value` não precisa aparecer literalmente na conversa: pode ser sintetizado, formatado, convertido ou gerado, inclusive como SQL/SELECT/HTML textual, quando as regras fornecidas sustentarem sua construção. Gerar esse texto não autoriza executá-lo nem comprova resultados de consultas. Não inventar empresa, parceiro, banco, período, ano ou schemas/filtros não fornecidos. `UNKNOWN` corresponde à falta de informação factual necessária, não à mera necessidade de gerar conteúdo novo. Por exemplo, converter “12 de dezembro” para uma data completa exige que o ano esteja determinado pelo contexto fornecido, não pela suposição do modelo. Testes com modelo determinístico verificam transporte e instruções, não garantem adesão linguística do modelo real.

`POST /v1/flow-assist` é uma execução curta e **stateless**, separada de `/v1/agent-turns` e do FlowAgent agentic. O Core monta a conversa cronológica e seleciona as linhas elegíveis; o `flow-assist-agent` interpreta somente esse snapshot. PREFILL e CHECK não usam Session, MCP, Navigation ou handoffs. Em ambos os modos, a única tool possível é `search_knowledge` quando o Core envia referências autorizadas; sem elas, `tools=[]`.

Contrato de entrada (IDs numéricos inteiros positivos):

```json
{
  "CompanyUUID": "00000000-0000-4000-8000-000000000001",
  "Agent": "flow-assist-agent",
  "IdCompany": 1003,
  "IdChat": 123,
  "IdProcessLine": 456,
  "IdProcessLineFlow": 789,
  "Instructions": "Utilize somente informações conhecidas com segurança.",
  "Messages": [
    { "IdMessage": 1001, "Role": "USER", "Text": "Pode mandar pela Jadlog." }
  ],
  "Targets": [
    {
      "IdProcessLineFlow": 81231,
      "Step": 11,
      "ObjectType": "CFL",
      "Description": "Transportadora",
      "ObjectDescription": "Identifique a transportadora mencionada pelo usuário."
    },
    {
      "IdProcessLineFlow": 81232,
      "Step": 12,
      "ObjectType": "PROMPT",
      "Description": "Data de entrega",
      "ObjectDescription": "Retorne a data no formato AAAA-MM-DD."
    }
  ],
  "Known": [
    { "IdProcessLineFlow": 81230, "Step": 10, "Description": "Cliente", "Value": "Café do Mercado" }
  ]
}
```

`Instructions` pode ser vazia. `Messages` admite `USER`/`ASSISTANT` e preserva a ordem recebida. `Targets` suporta somente `PROMPT`, `CFL`, `CFL_SELREQ`; `Step` é inteiro não negativo, `ObjectDescription` é opcional/string/null e `Known` é opcional. Snapshots vazios são permitidos (sem evidência, usar UNKNOWN; sem Targets, retornar Proposals vazio). IDs duplicados de mensagens/Targets/Known e campos estranhos ao manifesto são rejeitados. Não enviar Query, SQL, DestinationTable, DestinationField, CFL.Key/Search ou configuração de Session. `KnowledgeConfiguration` é opcional no PREFILL e no CHECK; macros em `Instructions` exigem a respectiva Reference autorizada no snapshot enviado pelo Core.

Sucesso HTTP 200:

```json
{
  "Success": true,
  "ExecutionUUID": "14ed24ea-0000-4000-8000-000000000001",
  "Proposals": [
    { "IdProcessLineFlow": 81231, "Status": "PROPOSED", "Value": "Jadlog" },
    { "IdProcessLineFlow": 81232, "Status": "UNKNOWN", "Value": null }
  ]
}
```

O schema de transporte é fixo: `PROPOSED` exige string não vazia (`Value.trim().length > 0`), `UNKNOWN` exige null. String vazia ou somente espaços resulta em `INVALID_AGENT_OUTPUT` antes de persistir sucesso, inclusive quando rejeitada pelo `outputType` no SDK. O trim é usado somente na validação; o valor original não é modificado. Há exatamente uma proposta por Target: IDs desconhecidos, duplicados ou omitidos tornam a execução inválida, sem corrigir/preencher silenciosamente o output. O Runtime não normaliza nem valida valores de negócio. `Description` informa a necessidade da etapa, `ObjectDescription` orienta semanticamente o texto proposto; nenhuma regra específica de datas ou maiúsculas é implementada no Runtime. Instruções fornecidas não substituem as invariantes do Agent. CFL recebe texto semântico, nunca uma chave técnica escolhida pela IA.

Falha:

```json
{
  "Success": false,
  "ExecutionUUID": "14ed24ea-0000-4000-8000-000000000002",
  "Proposals": [],
  "Error": { "Code": "INVALID_AGENT_OUTPUT", "Message": "Não foi possível concluir o Agent Assist." }
}
```

Payload inválido retorna 400/INVALID_REQUEST antes da execução, sem ExecutionUUID; Agent não registrado para Assist retorna 422/AGENT_NOT_FOUND; erros de inferência/output/persistência retornam 500. Nunca são retornadas propostas parciais em falha. O Core continua responsável pelo **fail-open**: registrar a falha assistiva e continuar o Flow determinístico. PROPOSED não significa que a linha foi resolvida: somente os resolvers canônicos do Core validam e persistem PROMPT/CFL e decidem seu estado. O Runtime não atualiza ProcessLineFlow, não avança Step nem envia mensagem ao cliente.

Cada chamada gera ExecutionUUID/OpenAITraceId e registra `AIAgentExecution` + timeline, inclusive falhas, usando o repository/ExecutionLogger existente. `IdProcessLineFlow` identifica a linha **AGENTASSIST**, não um Target; `RuntimeConfigJSON.Mode=FLOW_ASSIST`. Não há Session, TurnUUID, snapshot de Knowledge ou migration nova. Reexecuções são inferências independentes; a recuperação por exclusão das linhas já resolvidas pertence ao Core.

Testes: `flowAssistContracts`, `flowAssistAgent`, `flowAssistRuntime` e integração `flowAssist` percorrem HTTP → controller → Runtime → Agent → Runner real com modelo determinístico, sem serviços externos. O modelo fake comprova transporte/schema/fronteiras, não a interpretação linguística. Dois testes semânticos live opcionais (cliente/transportadora/data/UNKNOWN e maiúsculas) exigem `RUN_OPENAI_INTEGRATION_TESTS=1`, `OPENAI_MODEL` e `OPENAI_API_KEY`, executados com `npm test -- tests/integration/flowAssist.test.ts`. O E2E de pré-resolução, skip canônico e fail-open do DocumentService exige o Core e não é simulado como implementação deste repositório.

### Agent Assist CHECK + Knowledge

O mesmo endpoint aceita `Mode: "CHECK"`. O manifesto CHECK inclui `Targets[].Resolved` e `Targets[].CurrentValue` (string ou null), além de `Check.Repair`. `Check.RequireAll`, `OnRuntimeFailure` e `BlockMessage` podem vir no request para o Core coordenar o bloqueio e a reentrada; o Runtime não decide PASS/BLOCK, não avança Step e não aplica SET/REPLACE. O contrato PREFILL acima continua válido sem `Mode`; `Mode: "PREFILL"` explícito também é aceito.

```json
{
  "CompanyUUID": "00000000-0000-4000-8000-000000000001",
  "Agent": "flow-assist-agent",
  "IdCompany": 1003,
  "IdChat": 123,
  "IdProcessLine": 456,
  "IdProcessLineFlow": 789,
  "Mode": "CHECK",
  "Instructions": "Valide conforme {{knowledge:base:commercial}}.",
  "Messages": [{ "IdMessage": 1001, "Role": "USER", "Text": "Prefiro Jadlog." }],
  "Targets": [{ "IdProcessLineFlow": 81231, "Step": 11, "ObjectType": "CFL", "Description": "Transportadora", "ObjectDescription": "Considere a política comercial.", "Resolved": true, "CurrentValue": "Transportadora anterior" }],
  "Known": [],
  "Check": { "Repair": true, "RequireAll": true, "OnRuntimeFailure": "BLOCK", "BlockMessage": "Preciso revisar os dados." },
  "KnowledgeConfiguration": { "Version": 1, "Connections": [{ "Code": "openai-default", "Provider": "OPENAI", "CredentialSource": "RUNTIME_ENV", "CredentialReference": "OPENAI_API_KEY" }], "References": [{ "Reference": "base:commercial", "Kind": "BASE", "Name": "Política comercial", "ConnectionCode": "openai-default", "ExternalStoreId": "vs_authorized" }] }
}
```

O Core resolve as macros e autoriza `KnowledgeConfiguration` por empresa em qualquer Mode. O Runtime rejeita macros não presentes no snapshot recebido e a tool recusa References ausentes desse snapshot. O Flow Assist recebe somente `search_knowledge` quando há References; sem elas, `tools=[]`. A pesquisa usa o `KnowledgeSearchService` já existente e registra `KNOWLEDGE_SEARCH`, inclusive `NO_RESULTS` e erros. Falha da pesquisa impede sucesso tanto no PREFILL quanto no CHECK; o Core mantém suas respectivas políticas de falha. Credenciais, IDs externos, filtros e opções de busca ficam fora dos argumentos do modelo. Knowledge recuperada é dado, não instrução de sistema. A configuração vale somente para a execução atual; nenhuma Session é criada.

Sucesso CHECK:

```json
{
  "Success": true,
  "ExecutionUUID": "14ed24ea-0000-4000-8000-000000000003",
  "Mode": "CHECK",
  "Results": [{ "IdProcessLineFlow": 81231, "Action": "REPLACE", "Value": "Jadlog", "Reason": null }]
}
```

`KEEP` exige Target resolvido; `SET` exige não resolvido; `REPLACE` exige resolvido. `SET`/`REPLACE` exigem `Repair=true` e Value textual não vazio. `KEEP`/`MISSING`/`INVALID` exigem `Value=null`; Reason é null quando não se aplica e pode trazer uma explicação operacional curta para MISSING/INVALID. Há exatamente um Result por Target, sem IDs omitidos, repetidos ou inventados. Em falha, o Runtime retorna `Success=false`, `Mode=CHECK`, `Results=[]` e `Error`; o Core decide sua política BLOCK/CONTINUE e os resolvers aplicam reparos. `AIAgentExecution.RuntimeConfigJSON.AssistMode=CHECK` registra o modo; não há migration nova. MCP, Navigation, handoffs, AUTO, replay e mensagens ao cliente permanecem fora deste Runtime.

### Fluxos existentes

- `AgentRegistry` monta agents por execução; `ExpectedOutput` não fica preso em singleton.
- Root Agents usam as capabilities locais `use_flow_capabilities` e `use_navigation`; somente `FlowAgent` recebe MCP Flow e somente `NavigationAgent` recebe MCP Navigation.
- `ReceptionAgent` usa `use_navigation` para destinos/Handoff e não recebe Flow. Knowledge V1 é opcional para todos os Root Agents: o Core envia `KnowledgeConfiguration`, congelada por Session, e o Runtime oferece a tool local `search_knowledge` apenas quando há referências autorizadas. A busca usa diretamente OpenAI Vector Store Search, sem MCP ou `file_search` bruto.
- Sales e Support continuam com Flow e Navigation para suas operações e continuidade de ownership.
- O handoff nativo do SDK usa `Reason` estruturado e grava somente justificativa operacional.
- `RuntimeContext.Execution` contém os IDs, `TurnSource`, Activation e revisão vindos do Core; `ProcessContext` é readonly e `Resolved` recebe apenas dados técnicos descobertos.
- `ToolPolicies` declara `requires` e `meta`; o MCP recebe apenas os paths necessários.
- `AIAgentExecution` e `AIAgentExecutionLog` são persistidos através de `ExecutionLogger` e repository Drizzle.
- `OpenAITraceId` é definido antes do runner e correlacionado com `ExecutionUUID` e `IdProcessLineFlow`.

O fake em `src/mcp/fakeMcpServer.ts` existe para testes locais independentes do MCP real. O smoke test com OpenAI pode ser adicionado separadamente com `RUN_OPENAI_INTEGRATION_TESTS=1`.
