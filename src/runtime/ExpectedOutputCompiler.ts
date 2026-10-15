import type { JsonSchemaDefinition } from '@openai/agents';
import { RuntimeError } from '../errors/RuntimeError.js';
import { ErrorCodes } from '../errors/errorCodes.js';
import type { ExpectedOutput } from '../api/contracts/agentRunInput.js';

type JsonSchema = Record<string, unknown>;

export interface CompiledExpectedOutput {
  outputType: JsonSchemaDefinition;
  schema: JsonSchema;
  validate(value: unknown): value is Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaError(message: string): RuntimeError {
  return new RuntimeError(ErrorCodes.SchemaInvalid, message);
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'object': return isRecord(value);
    case 'array': return Array.isArray(value);
    case 'null': return value === null;
    default: return true;
  }
}

function validateJsonSchemaShape(schema: unknown, path = '$'): JsonSchema {
  if (!isRecord(schema)) throw schemaError(`Schema inválido em ${path}: esperado objeto.`);
  const type = schema.type;
  if (typeof type !== 'string') throw schemaError(`Schema inválido em ${path}: type obrigatório.`);
  const supportedTypes = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);
  if (!supportedTypes.has(type)) throw schemaError(`Schema inválido em ${path}: type '${type}' não suportado.`);

  const result: JsonSchema = { type };
  if (typeof schema.description === 'string') result.description = schema.description;
  if (Array.isArray(schema.enum)) result.enum = [...schema.enum];

  if (type === 'object') {
    if (!isRecord(schema.properties)) throw schemaError(`Schema inválido em ${path}: properties obrigatório.`);
    if (schema.additionalProperties !== false) {
      throw schemaError(`Schema inválido em ${path}: additionalProperties deve ser false.`);
    }
    const properties: Record<string, JsonSchema> = {};
    for (const [key, child] of Object.entries(schema.properties)) {
      properties[key] = validateJsonSchemaShape(child, `${path}.properties.${key}`);
    }
    const required = schema.required ?? Object.keys(properties);
    if (!Array.isArray(required) || !required.every((entry) => typeof entry === 'string')) {
      throw schemaError(`Schema inválido em ${path}: required inválido.`);
    }
    for (const key of required) {
      if (!(key in properties)) throw schemaError(`Schema inválido em ${path}: required '${key}' não existe.`);
    }
    result.properties = properties;
    result.required = [...required];
    result.additionalProperties = false;
  } else if (type === 'array') {
    if (schema.items !== undefined) result.items = validateJsonSchemaShape(schema.items, `${path}.items`);
  }

  return result;
}

function validateValue(value: unknown, schema: JsonSchema): boolean {
  const type = schema.type;
  if (typeof type === 'string' && !typeMatches(value, type)) return false;
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) return false;

  if (type === 'object') {
    if (!isRecord(value) || !isRecord(schema.properties) || !Array.isArray(schema.required)) return false;
    const allowedKeys = new Set(Object.keys(schema.properties));
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
    if (schema.required.some((key) => !(key in value))) return false;
    return Object.entries(schema.properties).every(([key, child]) =>
      !(key in value) || (isRecord(child) && validateValue(value[key], child)),
    );
  }

  if (type === 'array' && Array.isArray(value) && isRecord(schema.items)) {
    return value.every((entry) => validateValue(entry, schema.items as JsonSchema));
  }
  return true;
}

function propertySchema(expected: ExpectedOutput): JsonSchema {
  const type = expected.Type ?? 'string';
  const property: JsonSchema = { type, description: expected.Description };
  if (expected.AllowedValues) property.enum = [...expected.AllowedValues];

  if (type === 'object') {
    property.properties = {};
    property.required = [];
    property.additionalProperties = false;
  } else if (type === 'array') {
    property.items = { type: 'string' };
  }
  return property;
}

export function compileExpectedOutput(expected: ExpectedOutput): CompiledExpectedOutput {
  let schema: JsonSchema;
  if (expected.Schema !== undefined) {
    schema = validateJsonSchemaShape(expected.Schema);
    if (schema.type !== 'object') throw schemaError('ExpectedOutput.Schema deve ter root object.');
  } else {
    const property = propertySchema(expected);
    if (expected.AllowedValues?.some((value) => !typeMatches(value, expected.Type ?? 'string'))) {
      throw schemaError(`AllowedValues incompatível com Type '${expected.Type ?? 'string'}'.`);
    }
    schema = {
      type: 'object',
      properties: { [expected.Name]: property },
      required: [expected.Name],
      additionalProperties: false,
    };
  }

  const outputType = {
    type: 'json_schema' as const,
    name: 'ca_agent_runtime_output',
    strict: true,
    schema: schema as JsonSchemaDefinition['schema'],
  };

  return {
    outputType,
    schema,
    validate(value: unknown): value is Record<string, unknown> {
      return isRecord(value) && validateValue(value, schema);
    },
  };
}
