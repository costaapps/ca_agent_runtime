import { describe, expect, it, vi } from 'vitest';
import { ModelBehaviorError } from '@openai/agents';
import { ZodError } from 'zod';
import { AgentRegistry } from '../../src/agents/AgentRegistry.js';
import { FlowAssistRuntime } from '../../src/runtime/FlowAssistRuntime.js';
import { RuntimeError } from '../../src/errors/RuntimeError.js';
import { MemoryRepository } from '../helpers/memoryRepository.js';
import { flowAssistInput, flowAssistOutput } from '../helpers/flowAssist.js';

function setup() {
  const repository = new MemoryRepository();
  const run = vi.fn(async (..._args: Parameters<import('../../src/openai/runner.js').OpenAIRunner['run']>) => ({ finalOutput: flowAssistOutput }));
  const runtime = new FlowAssistRuntime({ repository, registry: new AgentRegistry(), runner: { run }, model: 'test-model', tracingEnabled: true, traceIncludeSensitiveData: false });
  return { runtime, repository, run };
}

describe('Flow Assist execution lifecycle', () => {
  it('persists correlated execution/output and timeline without Session/Turn or MCP', async () => {
    const { runtime, repository, run } = setup();
    const result = await runtime.runFlowAssist(flowAssistInput);
    expect(result).toMatchObject({ statusCode: 200, response: { Success: true, ...flowAssistOutput } });
    const execution = repository.executions[0]!;
    expect(execution.data).toMatchObject({ RequestedAgent: 'flow-assist-agent', IdCompany: 1003, IdChat: 123, IdProcessLine: 456, IdProcessLineFlow: 789 });
    expect(execution.data.ExecutionUUID).toBe(result.response.ExecutionUUID);
    expect(execution.data.OpenAITraceId).toMatch(/^trace_[a-f0-9]{32}$/);
    expect(execution.data.TurnUUID).toBeUndefined();
    expect(execution.data.IdAIAgentSession).toBeUndefined();
    expect(JSON.parse(execution.data.RuntimeConfigJSON!)).toMatchObject({ Mode: 'FLOW_ASSIST' });
    expect(execution.final).toMatchObject({ Success: 'Y', FinalAgent: 'FlowAssistAgent' });
    expect(JSON.parse(execution.final!.OutputJSON!)).toEqual(flowAssistOutput);
    expect(repository.logs.map(({ data }) => data.EventType)).toEqual(['RUNTIME_START', 'AGENT_START', 'AGENT_OUTPUT', 'RUNTIME_END']);
    expect(repository.logs.map(({ data }) => data.Sequence)).toEqual([1, 2, 3, 4]);
    const args = run.mock.calls[0]!;
    expect(args).toHaveLength(4); // no SDK Session argument
    expect(args[2].Execution.ExecutionUUID).toBe(result.response.ExecutionUUID);
    expect(args[2].Execution.SessionUUID).toBeUndefined();
    expect(args[2].Resolved).toEqual({});
    expect(args[3]).toMatchObject({ traceId: execution.data.OpenAITraceId, executionUUID: execution.data.ExecutionUUID, idProcessLineFlow: 789 });
  });

  it('runs repeated calls independently rather than introducing Turn/session idempotency', async () => {
    const { runtime, repository } = setup();
    const first = await runtime.runFlowAssist(flowAssistInput);
    const second = await runtime.runFlowAssist(flowAssistInput);
    expect(first.response.ExecutionUUID).not.toBe(second.response.ExecutionUUID);
    expect(repository.executions).toHaveLength(2);
  });

  it('logs an invalid Agent as a failed execution without running a Root Agent', async () => {
    const { runtime, repository, run } = setup();
    const result = await runtime.runFlowAssist({ ...flowAssistInput, Agent: 'sales-agent' });
    expect(result).toMatchObject({ statusCode: 422, response: { Success: false, Proposals: [], Error: { Code: 'AGENT_NOT_FOUND' } } });
    expect(repository.executions[0]?.final?.ErrorCode).toBe('AGENT_NOT_FOUND');
    expect(run).not.toHaveBeenCalled();
  });

  it.each([new Error('model unavailable'), new RuntimeError('MODEL_TIMEOUT', 'timeout')])('persists inference failure and returns no proposals: %s', async (error) => {
    const { runtime, repository, run } = setup();
    run.mockRejectedValueOnce(error);
    const result = await runtime.runFlowAssist(flowAssistInput);
    const code = error instanceof RuntimeError ? error.code : 'AGENT_EXECUTION_ERROR';
    expect(result).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [], Error: { Code: code } } });
    expect(repository.executions[0]?.final).toMatchObject({ Success: 'N', ErrorCode: code });
    expect(repository.logs.at(-1)?.data).toMatchObject({ EventType: 'RUNTIME_END', Status: 'FAILED' });
  });

  it('rejects invalid model proposals before success is persisted', async () => {
    const { runtime, repository, run } = setup();
    run.mockResolvedValueOnce({ finalOutput: { Proposals: [] } });
    expect(await runtime.runFlowAssist(flowAssistInput)).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [], Error: { Code: 'INVALID_AGENT_OUTPUT' } } });
    expect(repository.executions[0]?.final?.Success).toBe('N');
  });

  it.each(['', '   '])('rejects blank PROPOSED Value %j before persisting success', async (Value) => {
    const { runtime, repository, run } = setup();
    const finish = vi.spyOn(repository, 'finishExecution');
    run.mockResolvedValueOnce({ finalOutput: { Proposals: flowAssistOutput.Proposals.map((proposal, index) => index === 0 ? { ...proposal, Value } : proposal) } });
    expect(await runtime.runFlowAssist(flowAssistInput)).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [], Error: { Code: 'INVALID_AGENT_OUTPUT' } } });
    expect(finish).not.toHaveBeenCalled();
    expect(repository.executions[0]?.final).toMatchObject({ Success: 'N', ErrorCode: 'INVALID_AGENT_OUTPUT' });
    expect(repository.logs.some(({ data }) => data.EventType === 'AGENT_OUTPUT')).toBe(false);
  });

  it.each([
    new ZodError([{ code: 'custom', path: ['Proposals', 0, 'Value'], message: 'PROPOSED exige string não vazia.' }]),
    new ModelBehaviorError('Invalid output type: final assistant output did not match the expected schema.'),
  ])('maps SDK output validation errors to INVALID_AGENT_OUTPUT: %s', async (error) => {
    const { runtime, repository, run } = setup();
    const finish = vi.spyOn(repository, 'finishExecution');
    run.mockRejectedValueOnce(error);
    expect(await runtime.runFlowAssist(flowAssistInput)).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [], Error: { Code: 'INVALID_AGENT_OUTPUT' } } });
    expect(finish).not.toHaveBeenCalled();
    expect(repository.executions[0]?.final).toMatchObject({ Success: 'N', ErrorCode: 'INVALID_AGENT_OUTPUT' });
  });

  it.each(['createExecution', 'finishExecution', 'appendLog'] as const)('handles persistence failure in %s without reporting success', async (operation) => {
    const { runtime, repository, run } = setup();
    vi.spyOn(repository, operation).mockRejectedValue(new Error('database unavailable'));
    expect(await runtime.runFlowAssist(flowAssistInput)).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [], Error: { Code: 'PERSISTENCE_ERROR' } } });
    if (operation !== 'finishExecution') expect(run).not.toHaveBeenCalled();
    if (operation === 'appendLog') expect(repository.executions[0]?.final?.Success).toBe('N');
  });

  it('still returns inference failure if failure persistence/logging are unavailable', async () => {
    const { runtime, repository, run } = setup();
    run.mockRejectedValueOnce(new Error('model error'));
    vi.spyOn(repository, 'failExecution').mockRejectedValue(new Error('db error'));
    expect(await runtime.runFlowAssist(flowAssistInput)).toMatchObject({ statusCode: 500, response: { Success: false, Proposals: [] } });
    expect(repository.logs.some(({ data }) => data.EventType === 'RUNTIME_ERROR')).toBe(true);
  });
});
