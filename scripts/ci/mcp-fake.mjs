import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 4318);
const sessionId = 'agent-runtime-ci-mcp-session';

function sendJson(response, body) {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'mcp-session-id': sessionId,
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('MCP request exceeded 1 MiB.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function respondTo(message) {
  if (!message || typeof message !== 'object' || !('id' in message)) return null;
  const id = message.id;
  switch (message.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'agent-runtime-ci-fake-mcp', version: '1.0.0' },
        },
      };
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: [] } };
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unsupported fake MCP method: ${String(message.method)}` },
      };
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }
  if (request.method === 'DELETE') {
    response.writeHead(200, { 'mcp-session-id': sessionId });
    response.end();
    return;
  }
  if (request.method !== 'POST') {
    response.writeHead(405, { allow: 'GET, POST' });
    response.end();
    return;
  }

  try {
    const message = await readJson(request);
    const messages = Array.isArray(message) ? message : [message];
    const replies = messages.map(respondTo).filter(Boolean);
    if (replies.length === 0) {
      response.writeHead(202, { 'mcp-session-id': sessionId });
      response.end();
    } else {
      sendJson(response, Array.isArray(message) ? replies : replies[0]);
    }
  } catch (error) {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ error: 'Invalid fake MCP request.' }));
  }
});

server.listen(port, '0.0.0.0', () => {
  process.stdout.write(`Fake MCP HTTP server listening on ${port}.\n`);
});

function close() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
