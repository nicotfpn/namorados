module.exports = async (req, res) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const APP_WRITE_SECRET = process.env.APP_WRITE_SECRET;
  const KEY = 'reviews';

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
    if (!resp.ok) throw new Error('Failed to fetch reviews from KV');
    const data = await resp.json();
    if (!data.result) return { version: 0, reviews: [] };
    const parsed = JSON.parse(data.result);
    if (Array.isArray(parsed)) return { version: 0, reviews: parsed };
    if (parsed && Array.isArray(parsed.reviews)) return { version: parsed.version || 0, reviews: parsed.reviews };
    return { version: 0, reviews: [] };
  }

  async function saveVersioned(version, reviews) {
    const body = JSON.stringify({ version, reviews });
    const resp = await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body
    });
    if (!resp.ok) throw new Error('Failed to save reviews to KV');
  }

  async function fetchAll() {
    const { reviews } = await fetchVersioned();
    return reviews;
  }

  async function saveAll(reviews) {
    await saveVersioned(0, reviews);
  }

  async function atomicUpdate(mutateFn) {
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const current = await fetchVersioned();
      const originalIds = new Set(current.reviews.map(r => r.id));
      const mutated = mutateFn([...current.reviews]);
      const newIds = new Set(mutated.map(r => r.id));
      const merged = mutated.map(r => ({ ...r }));
      for (const r of current.reviews) {
        if (!newIds.has(r.id)) merged.push({ ...r });
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
        const reviews = await fetchAll();
        return res.status(200).json(reviews);
      } catch {
        return res.status(500).json({ error: 'Error reading reviews from KV' });
      }
    }

    if (req.method === 'POST') {
      if (!(await verifySecret(req))) {
        return res.status(401).json({ error: 'Unauthorized: invalid or missing X-App-Secret' });
      }

      const body = req.body;

      if (body && body.op === 'upsert' && body.review && body.review.id) {
        try {
          const reviews = await atomicUpdate(list => {
            const idx = list.findIndex(r => r.id === body.review.id);
            if (idx >= 0) list[idx] = body.review;
            else list.push(body.review);
            return list;
          });
          return res.status(200).json({ ok: true, reviews });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      if (body && body.op === 'delete' && body.id) {
        try {
          const reviews = await atomicUpdate(list => list.filter(r => r.id !== body.id));
          return res.status(200).json({ ok: true, reviews });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      if (body && Array.isArray(body.reviews)) {
        try {
          const reviews = await atomicUpdate(() => body.reviews);
          return res.status(200).json({ ok: true, reviews });
        } catch {
          return res.status(409).json({ error: 'Conflict: could not save after retries' });
        }
      }

      return res.status(400).json({ error: 'Invalid request body. Expected { op: "upsert", review: {...} }, { op: "delete", id: "..." }, or { reviews: [...] }' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
