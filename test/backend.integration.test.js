import http from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpBackend } from '../src/backend.js';

test('real local HTTP round trip uses public backend interface', async () => {
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ text: `received:${JSON.parse(body).message_id}` }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const backend = createHttpBackend({ url: `http://127.0.0.1:${port}`, token: 'test-token' });
    assert.equal(await backend({ message_id: 'live-local-m1' }), 'received:live-local-m1');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
