# Costa Apps Agent Runtime

PoC OpenAI-only que recebe execuções do CoreAPI em `POST /v1/agent-runs`, executa o grafo `ChatOrchestrator -> SalesAgent/SupportAgent` e devolve `Output` estruturado conforme `ExpectedOutput`.

## Executar localmente

```powershell
npm install
Copy-Item .env.example .env
npm run db:migrate
npm run dev
```

O processo exige `OPENAI_API_KEY`, `OPENAI_MODEL`, as variáveis do MySQL de homologação e um MCP Server Streamable HTTP em `MCP_SERVER_URL`. Os testes padrão não usam OpenAI, banco ou MCP real.

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

`POST /v1/agent-runs`:

```json
{
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
{ "IdCompany": 1003, "IdProcessLine": 456, "Reason": "PROCESS_LINE_CLOSED" }
```

## Arquitetura operacional

### Agent Assist no Flow determinístico — V1

`Messages`/`Known` são a fonte exclusiva de fatos sobre a solicitação e o usuário. `Instructions`, `Description` e `ObjectDescription` definem a interpretação e transformação desses fatos. `Value` não precisa aparecer literalmente na conversa: pode ser sintetizado, formatado, convertido ou gerado, inclusive como SQL/SELECT/HTML textual, quando as regras fornecidas sustentarem sua construção. Gerar esse texto não autoriza executá-lo nem comprova resultados de consultas. Não inventar empresa, parceiro, banco, período, ano ou schemas/filtros não fornecidos. `UNKNOWN` corresponde à falta de informação factual necessária, não à mera necessidade de gerar conteúdo novo. Por exemplo, converter “12 de dezembro” para uma data completa exige que o ano esteja determinado pelo contexto fornecido, não pela suposição do modelo. Testes com modelo determinístico verificam transporte e instruções, não garantem adesão linguística do modelo real.

`POST /v1/flow-assist` é uma execução curta e **stateless**, separada de `/v1/agent-turns` e do FlowAgent agentic. O Core monta a conversa cronológica e seleciona as linhas elegíveis; o `flow-assist-agent` interpreta somente esse snapshot, sem Session, tools, MCP, Navigation, Knowledge ou handoffs.

Contrato de entrada (IDs numéricos inteiros positivos):

```json
{
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

`Instructions` pode ser vazia. `Messages` admite `USER`/`ASSISTANT` e preserva a ordem recebida. `Targets` suporta somente `PROMPT`, `CFL`, `CFL_SELREQ`; `Step` é inteiro não negativo, `ObjectDescription` é opcional/string/null e `Known` é opcional. Snapshots vazios são permitidos (sem evidência, usar UNKNOWN; sem Targets, retornar Proposals vazio). IDs duplicados de mensagens/Targets/Known e campos estranhos ao manifesto são rejeitados. Não enviar Query, SQL, DestinationTable, DestinationField, CFL.Key/Search ou configuração de Session/Knowledge.

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
