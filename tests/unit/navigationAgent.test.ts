import { describe, expect, it } from 'vitest';
import {
  NavigationAgentOutputSchema,
  normalizeNavigationAgentOutput,
  recordNavigationToolObservation,
} from '../../src/agents/aidocument/specialists/navigationAgent.js';
import { createAIDocumentRuntimeContext } from '../../src/runtime/RuntimeContext.js';

function makeContext() {
  return createAIDocumentRuntimeContext({
    TurnUUID: '14ed24ea-0000-4000-8000-000000000030',
    Agent: 'sales-agent',
    IdCompany: 1001,
    IdChat: 2001,
    IdProcessLine: 3001,
    Messages: [{ IdMessage: 1, Text: 'Quero comprar memória RAM.' }],
  }, 'execution-uuid', 'session-uuid');
}

function listResult(...destinations: Array<Record<string, unknown>>) {
  return { Destinations: destinations };
}

const salesDestination = {
  DestinationRef: 'nav1_sales_opaque',
  Kind: 'MENU',
  Description: 'Vendas',
  MenuGroup: 'Atendimento',
  Keywords: 'comprar orçamento produto',
};

describe('NavigationAgent semantic boundary', () => {
  it('returns HANDOFF_REQUESTED only after the real successful MCP contract', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination), false, listResult(salesDestination));
    recordNavigationToolObservation(context, 'request_handoff', { DestinationRef: salesDestination.DestinationRef, Reason: 'Compra', Summary: 'Cliente quer comprar.' }, {
      Accepted: true,
      Destination: 'Vendas',
      Status: 'REQUESTED',
    }, false, { Accepted: true, Destination: 'Vendas', Status: 'REQUESTED' });

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'NO_MATCH',
      Summary: 'Solicitação processada.',
      Destination: null,
      Clarification: null,
      Error: null,
    })).toMatchObject({ Status: 'HANDOFF_REQUESTED', Destination: 'Vendas', Error: null });
  });

  it('returns FAILED when MCP does not provide a functional Destination', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination), false, listResult(salesDestination));
    recordNavigationToolObservation(context, 'request_handoff', { DestinationRef: salesDestination.DestinationRef }, {
      Accepted: true,
      Status: 'REQUESTED',
    }, false, {});

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'HANDOFF_REQUESTED',
      Summary: 'Handoff solicitado.',
      Destination: 'Vendas',
      Clarification: null,
      Error: null,
    })).toMatchObject({ Status: 'FAILED', Error: { Code: 'CORE_CONTRACT_ERROR' } });
  });

  it.each([
    ['CORE_CONTRACT_ERROR', 'Contrato inválido.'],
    ['NAVIGATION_DESTINATION_NOT_AVAILABLE', 'Destino indisponível.'],
    ['CORE_TIMEOUT', 'Tempo excedido.'],
  ])('returns FAILED and preserves the MCP error code for %s', (code, message) => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination), false, listResult(salesDestination));
    recordNavigationToolObservation(context, 'request_handoff', { DestinationRef: salesDestination.DestinationRef, Reason: 'Compra', Summary: 'Cliente quer comprar.' }, { Code: code }, true, message);

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'HANDOFF_REQUESTED',
      Summary: 'Handoff realizado.',
      Destination: 'Vendas',
      Clarification: null,
      Error: null,
    })).toMatchObject({ Status: 'FAILED', Error: { Code: code, Message: message } });
  });

  it('returns NO_MATCH when the authorized destination list is empty', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(), false, listResult());

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'HANDOFF_REQUESTED',
      Summary: 'Não há destino.',
      Destination: null,
      Clarification: null,
      Error: null,
    })).toMatchObject({ Status: 'NO_MATCH', Destination: null, Error: null });
  });

  it('preserves NEEDS_CLARIFICATION for multiple plausible destinations', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination, {
      ...salesDestination,
      DestinationRef: 'nav1_support_opaque',
      Description: 'Suporte',
    }), false, {});

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'NEEDS_CLARIFICATION',
      Summary: 'Há mais de um destino possível.',
      Destination: null,
      Clarification: 'Você precisa de compra ou suporte?',
      Error: null,
    })).toMatchObject({ Status: 'NEEDS_CLARIFICATION', Clarification: 'Você precisa de compra ou suporte?' });
  });

  it('rejects a handoff reference that was not returned by the listing tool', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination), false, listResult(salesDestination));
    recordNavigationToolObservation(context, 'request_handoff', { DestinationRef: 'nav1_not_listed' }, {
      Accepted: true,
      Destination: 'Vendas',
      Status: 'REQUESTED',
    }, false, {});

    expect(normalizeNavigationAgentOutput(context, {
      Status: 'HANDOFF_REQUESTED',
      Summary: 'Handoff solicitado.',
      Destination: 'Vendas',
      Clarification: null,
      Error: null,
    })).toMatchObject({ Status: 'FAILED', Error: { Code: 'NAVIGATION_DESTINATION_NOT_AVAILABLE' } });
  });

  it('never exposes opaque refs or technical IDs to use_navigation consumers', () => {
    const context = makeContext();
    recordNavigationToolObservation(context, 'list_navigation_destinations', {}, listResult(salesDestination), false, listResult(salesDestination));
    recordNavigationToolObservation(context, 'request_handoff', { DestinationRef: salesDestination.DestinationRef }, {
      Accepted: true,
      Destination: 'Vendas',
      Status: 'REQUESTED',
    }, false, {});

    const output = normalizeNavigationAgentOutput(context, {
      Status: 'HANDOFF_REQUESTED',
      Summary: `Solicitado ${salesDestination.DestinationRef}; IdCompanyMenu=10; IdCompanyModule=20; IdModule=30; HandoffUUID=handoff-secret; RequestUUID=request-secret.`,
      Destination: salesDestination.DestinationRef,
      Clarification: `DestinationRef=${salesDestination.DestinationRef}; HandoffUUID=handoff-secret; RequestUUID=request-secret`,
      Error: null,
    });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('nav_');
    expect(serialized).not.toContain('IdCompanyMenu');
    expect(serialized).not.toContain('IdCompanyModule');
    expect(serialized).not.toContain('IdModule');
    expect(serialized).not.toContain('HandoffUUID');
    expect(serialized).not.toContain('RequestUUID');
    expect(serialized).not.toContain('handoff-secret');
    expect(serialized).not.toContain('request-secret');
    expect(serialized).not.toContain(salesDestination.DestinationRef);
    expect(output).toMatchObject({ Status: 'HANDOFF_REQUESTED', Destination: 'Vendas' });
    expect(NavigationAgentOutputSchema.safeParse(output).success).toBe(true);
  });
});
