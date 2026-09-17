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
  idProcessLine: number;
  idProcessLineFlow: number | null;
  sessionUUID?: string;
  turnUUID?: string;
  rootAgent?: string;
  traceId: string;
}
