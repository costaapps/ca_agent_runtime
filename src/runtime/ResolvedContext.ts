import { RuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import type { RuntimeContextData } from './RuntimeContext.js';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function getContextPath(context: RuntimeContextData, path: string): unknown {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = context;
  for (const segment of segments) {
    if (!isObject(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function hasContextPath(context: RuntimeContextData, path: string): boolean {
  const value = getContextPath(context, path);
  return value !== undefined && value !== null;
}

function assignPath(target: Record<string, unknown>, segments: string[], value: unknown): void {
  const [segment, ...rest] = segments;
  if (!segment) return;
  if (rest.length === 0) {
    target[segment] = value;
    return;
  }
  const child = isObject(target[segment]) ? target[segment] as Record<string, unknown> : {};
  target[segment] = child;
  assignPath(child, rest, value);
}

export function pickContextPaths(context: RuntimeContextData, paths: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const path of paths) {
    const value = getContextPath(context, path);
    if (value !== undefined && value !== null) assignPath(result, path.split('.'), value);
  }
  return result;
}

export function mergeResolved(context: RuntimeContextData, patch: Record<string, unknown>): void {
  for (const [key, incoming] of Object.entries(patch)) {
    if (incoming === undefined) continue;
    const existing = context.Resolved[key];
    if (existing === undefined || existing === null) {
      context.Resolved[key] = incoming;
      continue;
    }
    if (incoming === null || valuesEqual(existing, incoming)) continue;
    throw new RuntimeError(
      ErrorCodes.ResolvedContextConflict,
      `Resolved context key '${key}' já possui valor incompatível.`,
    );
  }
}
