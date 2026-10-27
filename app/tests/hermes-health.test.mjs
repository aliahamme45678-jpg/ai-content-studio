import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { hermesHealth } from '../src/integrations/hermes-client.mjs';

test('Hermes health checks a configured local service without generation', async () => {
  const server = createServer((req, res) => { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({service:'hermes-fixture'})); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const old = {...process.env};
  try {
    process.env.HERMES_API_URL = `http://127.0.0.1:${server.address().port}/api/chat/completions`;
    process.env.HERMES_MODEL = 'fixture'; process.env.HERMES_API_KEY = 'fixture';
    const result = await hermesHealth();
    assert.equal(result.health, 'ok'); assert.equal(result.connected, true); assert.equal(result.service, 'hermes-fixture');
  } finally { for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key]; Object.assign(process.env, old); await new Promise(resolve => server.close(resolve)); }
});
