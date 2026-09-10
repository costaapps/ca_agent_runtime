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

Sucesso:

```json
{
  "Success": true,
  "ExecutionUUID": "uuid-v4",
  "Output": { "Intent": "SALES" }
}
```

## Arquitetura operacional

- `AgentRegistry` monta agents por execução; `ExpectedOutput` não fica preso em singleton.
- O handoff nativo do SDK usa `Reason` estruturado e grava somente justificativa operacional.
- `RuntimeContext.Execution` contém os IDs vindos do Core; `Resolved` recebe apenas dados técnicos descobertos.
- `ToolPolicies` declara `requires` e `meta`; o MCP recebe apenas os paths necessários.
- `AIAgentExecution` e `AIAgentExecutionLog` são persistidos através de `ExecutionLogger` e repository Drizzle.
- `OpenAITraceId` é definido antes do runner e correlacionado com `ExecutionUUID` e `IdProcessLineFlow`.

O fake em `src/mcp/fakeMcpServer.ts` existe para testes locais independentes do MCP real. O smoke test com OpenAI pode ser adicionado separadamente com `RUN_OPENAI_INTEGRATION_TESTS=1`.
