import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { AgentRuntime } from '../../src/runtime/AgentRuntime.js';
import { createOpenAIRunner } from '../../src/openai/runner.js';
import { createFakeMcpServer } from '../../src/mcp/fakeMcpServer.js';
import { McpObservabilityRegistry } from '../../src/mcp/observability.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { MemorySessionRepository } from '../helpers/memorySessionRepository.js';
import { normalizeVectorStoreIds } from '../../src/config/env.js';

const vectorStoreIds = normalizeVectorStoreIds(process.env.RECEPTION_AGENT_VECTOR_STORE_IDS);
const enabled = process.env.RUN_OPENAI_INTEGRATION_TESTS === '1'
  && Boolean(process.env.OPENAI_API_KEY)
  && Boolean(process.env.OPENAI_MODEL)
  && vectorStoreIds.length > 0;

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

describe.skipIf(!enabled)('ReceptionAgent live Knowledge PoC', () => {
  it('answers the planned knowledge scenarios using one persistent Session', async () => {
    const repository = new MemoryRepository();
    const sessionRepository = new MemorySessionRepository(repository);
    const runtime = new AgentRuntime({
      repository,
      sessionRepository,
      registry: new AgentRegistry(undefined, undefined, { receptionAgentVectorStoreIds: vectorStoreIds }),
      runner: createOpenAIRunner(),
      mcpServer: createFakeMcpServer(),
      observability: new McpObservabilityRegistry(),
      model: process.env.OPENAI_MODEL!,
      tracingEnabled: true,
      traceIncludeSensitiveData: false,
    });

    const prompts = [
      'Oi',
      'Onde fica a empresa?',
      'Posso trocar um produto?',
      'Vocês aceitam boleto?',
      'Qual é a política de devolução?',
      'Quero falar sobre compra.',
      'Qual é o CNPJ?',
      'Quero saber sobre formas de pagamento.',
      'E sobre trocas?',
    ];
    const responses: string[] = [];
    for (const [index, prompt] of prompts.entries()) {
      const result = await runtime.runTurn({
        TurnUUID: `14ed24ea-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
        Agent: 'reception-agent',
        IdCompany: 1003,
        IdChat: 123,
        IdProcessLine: 9000,
        Messages: [{ IdMessage: 2000 + index, Text: prompt }],
      });
      expect(result.statusCode).toBe(200);
      if (result.response.Success) responses.push(result.response.Response);
    }

    expect(responses).toHaveLength(prompts.length);
    expect(normalize(responses[1]!)).toContain('porto alegre');
    expect(normalize(responses[2]!)).toContain('nao aceita');
    expect(normalize(responses[3]!)).toMatch(/cartao|pix/);
    expect(normalize(responses[4]!)).toMatch(/nao.*(inform|especific|encontr)|nao poss|base/);
    expect(normalize(responses[5]!)).toContain('venda');
    expect(normalize(responses[6]!)).toMatch(/nao.*(poss|encontr|inform)|nao tenho/);
    expect(normalize(responses[8]!)).toContain('troca');
    expect(sessionRepository.sessions[0]?.RootAgent).toBe('reception-agent');
  }, 300_000);
});
