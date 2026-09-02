const { test } = require('node:test');
const assert = require('node:assert/strict');

for (const [key, singular] of [['reviews', 'review']]) {
  test(`${key}: adicionar, editar e excluir preserva os demais registros`, async () => {
    const originalFetch = global.fetch;
    const originalEnv = { ...process.env };
    process.env.KV_REST_API_URL = 'https://storage.example';
    process.env.KV_REST_API_TOKEN = 'test-token';
    delete process.env.APP_WRITE_SECRET;
    let saved = { version: 1, [key]: [{ id: 'a', message: 'primeiro' }, { id: 'b', message: 'segundo' }] };
    global.fetch = async (_url, options = {}) => {
      if (options.method === 'POST') {
        saved = JSON.parse(options.body);
        return { ok: true };
      }
      return { ok: true, json: async () => ({ result: JSON.stringify(saved) }) };
    };
    const handler = require(`../api/${key}.js`);
    const request = async body => {
      const response = { setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
      await handler({ method: 'POST', headers: {}, body }, response);
      assert.equal(response.code, 200);
      return response.body[key];
    };
    try {
      const added = await request({ op: 'upsert', [singular]: { id: 'c', message: 'terceiro' } });
      assert.deepEqual(added.map(item => item.id), ['a', 'b', 'c']);
      const edited = await request({ op: 'upsert', [singular]: { id: 'b', message: 'editado' } });
      assert.equal(edited.find(item => item.id === 'b').message, 'editado');
      const deleted = await request({ op: 'delete', id: 'b' });
      assert.deepEqual(deleted.map(item => item.id), ['a', 'c']);
      assert.deepEqual(saved[key].map(item => item.id), ['a', 'c']);
      const repeated = await request({ op: 'delete', id: 'b' });
      assert.deepEqual(repeated.map(item => item.id), ['a', 'c']);
    } finally {
      global.fetch = originalFetch;
      for (const name of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'APP_WRITE_SECRET']) {
        if (originalEnv[name] === undefined) delete process.env[name];
        else process.env[name] = originalEnv[name];
      }
    }
  });
}
