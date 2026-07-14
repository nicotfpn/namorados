module.exports = async (req, res) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const KEY = 'reviews';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!url || !token) {
    return res.status(500).json({ error: 'KV environment variables not configured' });
  }

  const headers = { Authorization: `Bearer ${token}` };

  async function fetchAll() {
    const resp = await fetch(`${url}/get/${KEY}`, { headers });
    if (!resp.ok) throw new Error('Failed to fetch reviews from KV');
    const data = await resp.json();
    const parsed = data.result ? JSON.parse(data.result) : [];
    return Array.isArray(parsed) ? parsed : [];
  }

  async function saveAll(reviews) {
    const resp = await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: JSON.stringify(reviews)
    });
    if (!resp.ok) throw new Error('Failed to save reviews to KV');
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
      const body = req.body;

      if (body && body.op === 'upsert' && body.review && body.review.id) {
        let reviews;
        try {
          reviews = await fetchAll();
        } catch {
          return res.status(500).json({ error: 'Error reading reviews from KV' });
        }

        const idx = reviews.findIndex(r => r.id === body.review.id);
        if (idx >= 0) {
          reviews[idx] = body.review;
        } else {
          reviews.push(body.review);
        }

        try {
          await saveAll(reviews);
          return res.status(200).json({ ok: true, reviews });
        } catch {
          return res.status(500).json({ error: 'Error writing reviews to KV' });
        }
      }

      if (body && body.op === 'delete' && body.id) {
        let reviews;
        try {
          reviews = await fetchAll();
        } catch {
          return res.status(500).json({ error: 'Error reading reviews from KV' });
        }

        reviews = reviews.filter(r => r.id !== body.id);

        try {
          await saveAll(reviews);
          return res.status(200).json({ ok: true, reviews });
        } catch {
          return res.status(500).json({ error: 'Error writing reviews to KV' });
        }
      }

      if (body && Array.isArray(body.reviews)) {
        try {
          await saveAll(body.reviews);
          return res.status(200).json({ ok: true, reviews: body.reviews });
        } catch {
          return res.status(500).json({ error: 'Error writing reviews to KV' });
        }
      }

      return res.status(400).json({ error: 'Invalid request body. Expected { op: "upsert", review: {...} }, { op: "delete", id: "..." }, or { reviews: [...] }' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
