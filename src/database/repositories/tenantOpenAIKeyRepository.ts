import { sql, type SQL } from 'drizzle-orm';
import type { RuntimeDatabase } from '../connection.js';
import { ErrorCodes } from '../../errors/errorCodes.js';
import { RuntimeError } from '../../errors/RuntimeError.js';

export interface TenantOpenAIKeyQuery {
  execute(statement: SQL): Promise<unknown>;
}

/** Reads the existing per-company OpenAI key from the lease-bound customer database. */
export class TenantOpenAIKeyRepository {
  constructor(private readonly database: TenantOpenAIKeyQuery, private readonly idCompany: number) {
    if (!Number.isSafeInteger(idCompany) || idCompany <= 0) {
      throw new Error('IdCompany do repository deve ser um inteiro positivo.');
    }
  }

  async findOpenAIKey(): Promise<string> {
    let raw: unknown;
    try {
      raw = await this.database.execute(sql`
        SELECT \`Value\`
        FROM \`GeneralSettings\`
        WHERE \`IdCompany\` = ${this.idCompany}
          AND UPPER(\`Param\`) = 'OPENAIKEY'
        LIMIT 2
      `);
    } catch (error) {
      // Preserve the driver cause for the Runtime's database-availability classifier.
      throw error;
    }

    const rows = unwrapRows(raw);
    if (rows.length !== 1 || typeof rows[0]?.Value !== 'string' || rows[0].Value.trim().length === 0) {
      throw new RuntimeError(ErrorCodes.OpenAICredentialNotConfigured, 'A credencial OpenAI da empresa não está configurada corretamente.');
    }
    return rows[0].Value.trim();
  }
}

/** A request-local memoized resolver: changes apply to the next HTTP execution. */
export function createTenantOpenAIKeyResolver(database: RuntimeDatabase, idCompany: number): () => Promise<string> {
  const repository = new TenantOpenAIKeyRepository(database, idCompany);
  let pending: Promise<string> | undefined;
  return () => pending ??= repository.findOpenAIKey();
}

function unwrapRows(raw: unknown): Array<Record<string, unknown>> {
  const candidate = Array.isArray(raw) && raw.length === 2 && Array.isArray(raw[0]) ? raw[0] : raw;
  if (!Array.isArray(candidate)) {
    throw new RuntimeError(ErrorCodes.PersistenceError, 'Não foi possível ler a configuração OpenAI da empresa.');
  }
  return candidate as Array<Record<string, unknown>>;
}
