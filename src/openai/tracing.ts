import { randomUUID } from 'node:crypto';

export function createOpenAITraceId(): string {
  return `trace_${randomUUID().replaceAll('-', '')}`;
}

export interface TraceSettings {
  enabled: boolean;
  includeSensitiveData: boolean;
  model: string;
  executionUUID: string;
  idChat: number;
  idProcessLineFlow: number;
  traceId: string;
}
