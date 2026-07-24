module.exports = async (req, res) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const APP_WRITE_SECRET = process.env.APP_WRITE_SECRET;
  const KEY = 'momentos';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-App-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!url || !token) {
    return res.status(500).json({ error: 'KV environment variables not configured' });
  }

  const headers = { Authorization: `Bearer ${token}` };

  async function fetchVersioned() {
    const resp = await fetch(`${url}/get/${KEY}`, { headers });
    if (!resp.ok) throw new Error('Failed to fetch momentos from KV');
    const data = await resp.json();
    if (!data.result) return { version: 0, momentos: [] };
    const parsed = JSON.parse(data.result);
    if (Array.isArray(parsed)) return { version: 0, momentos: parsed };
    if (parsed && Array.isArray(parsed.momentos)) return { version: parsed.version || 0, momentos: parsed.momentos };
    return { version: 0, momentos: [] };
  }

  async function saveVersioned(version, momentos) {
    const body = JSON.stringify({ version, momentos });
    const resp = await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body
    });
    if (!resp.ok) throw new Error('Failed to save momentos to KV');
  }

  async function fetchAll() {
    const { momentos } = await fetchVersioned();
    return momentos;
  }

  async function saveAll(momentos) {
    await saveVersioned(0, momentos);
  }

  async function atomicUpdate(mutateFn) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await fetchVersioned();
      const originalIds = new Set(current.momentos.map(m => m.id));
      const mutated = mutateFn([...current.momentos]);
      const newIds = new Set(mutated.map(m => m.id));
      const merged = mutated.map(m => ({ ...m }));
      for (const m of current.momentos) {
        if (!newIds.has(m.id)) merged.push({ ...m });
      }
      const nextVersion = (current.version || 0) + 1;
      try {
        await saveVersioned(nextVersion, merged);
        return merged;
      } catch (e) {
        if (attempt === MAX_RETRIES - 1) throw e;
      }
    }
    throw new Error('Conflict after max retries');
  }

  async function verifySecret(req) {
    if (!APP_WRITE_SECRET) return true;
    const secret = req.headers['x-app-secret'];
    return secret === APP_WRITE_SECRET;
  }

  try {
    if (req.method === 'GET') {
      try {
        const momentos = await fetchAll();
        return res.status(200).json(momentos);
      } catch {
        return res.status(500).json({ error: 'Error reading momentos from KV' });
      }
    }

    if (req.method === 'POST') {
      if (!(await verifySecret(req))) {
        return res.status(401).json({ error: 'Unauthorized: invalid or missing X-App-Secret' });
      }

      const body = req.body;

      if (body && body.op === 'upsert' && body.momento && body.momento.id) {
        try {
          const momentos = await atomicUpdate(list => {
            const idx = list.findIndex(m => m.id === body.momento.id);
            if (idx >= 0) list[idx] = body.momento;
            else list.push(body.momento);
            return list;
          });
          return res.status(200).json({ ok: true, momentos });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      if (body && body.op === 'delete' && body.id) {
        try {
          const momentos = await atomicUpdate(list => list.filter(m => m.id !== body.id));
          return res.status(200).json({ ok: true, momentos });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      if (body && Array.isArray(body.momentos)) {
        try {
          const momentos = await atomicUpdate(() => body.momentos);
          return res.status(200).json({ ok: true, momentos });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      return res.status(400).json({ error: 'Invalid request body. Expected { op: "upsert", momento: {...} }, { op: "delete", id: "..." }, or { momentos: [...] }' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
