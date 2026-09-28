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
  "Messages": [{ "IdMessage": 1001, "Text": "Quero comprar uma impressora" }]
}
```

`TurnSource` pode ser `MESSAGE` (compatibilidade: ausência equivale a `MESSAGE`) ou `ACTIVATION`. A ativação aceita `Messages: []` e exige `ActivationContext`; o Runtime usa um item interno de sistema, nunca uma fala de usuário artificial.

O Runtime cria `ExecutionUUID`, mantém a memória nativa do Agents SDK em `AIAgentSessionItem`, e devolve `Response` + `Control`. `Control.ContextUpdates` pode propor somente alterações em `Facts` e `CurrentIntent`; o Core valida e persiste o ProcessContext. Repetições do mesmo `TurnUUID` são idempotentes, inclusive quando o payload contém Activation ou uma revisão de contexto diferente.

`POST /v1/agent-sessions/close` fecha a Session após confirmação do Core:

```json
{ "IdCompany": 1003, "IdProcessLine": 456, "Reason": "PROCESS_LINE_CLOSED" }
```

## Arquitetura operacional

- `AgentRegistry` monta agents por execução; `ExpectedOutput` não fica preso em singleton.
- Root Agents usam as capabilities locais `use_flow_capabilities` e `use_navigation`; somente `FlowAgent` recebe MCP Flow e somente `NavigationAgent` recebe MCP Navigation.
- `ReceptionAgent` mantém `file_search` nos Vector Stores configurados e usa `use_navigation` para destinos/Handoff; não recebe Flow. Suas instruções são compostas na ordem: regras técnicas, guardrails, instruções empresariais congeladas na Session, seção reservada para instruções de Knowledge e contexto autoritativo do Turn. A configuração dinâmica de bases de conhecimento ainda não faz parte desta PoC.
- Sales e Support continuam com Flow e Navigation para suas operações e continuidade de ownership.
- O handoff nativo do SDK usa `Reason` estruturado e grava somente justificativa operacional.
- `RuntimeContext.Execution` contém os IDs, `TurnSource`, Activation e revisão vindos do Core; `ProcessContext` é readonly e `Resolved` recebe apenas dados técnicos descobertos.
- `ToolPolicies` declara `requires` e `meta`; o MCP recebe apenas os paths necessários.
- `AIAgentExecution` e `AIAgentExecutionLog` são persistidos através de `ExecutionLogger` e repository Drizzle.
- `OpenAITraceId` é definido antes do runner e correlacionado com `ExecutionUUID` e `IdProcessLineFlow`.

O fake em `src/mcp/fakeMcpServer.ts` existe para testes locais independentes do MCP real. O smoke test com OpenAI pode ser adicionado separadamente com `RUN_OPENAI_INTEGRATION_TESTS=1`.
