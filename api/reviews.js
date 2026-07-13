module.exports = async (req, res) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const KEY = 'reviews';

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!url || !token) {
    return res.status(500).json({ error: 'KV environment variables not configured' });
  }

  const headers = { Authorization: `Bearer ${token}` };

  try {
    if (req.method === 'GET') {
      const resp = await fetch(`${url}/get/${KEY}`, { headers });
      if (!resp.ok) return res.status(502).json({ error: 'Failed to fetch reviews' });
      const data = await resp.json();
      return res.status(200).json(data.result ? JSON.parse(data.result) : []);
    }

    if (req.method === 'POST') {
      const { reviews } = req.body;
      if (!Array.isArray(reviews)) {
        return res.status(400).json({ error: 'reviews must be an array' });
      }
      const resp = await fetch(`${url}/set/${KEY}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'text/plain' },
        body: JSON.stringify(reviews)
      });
      if (!resp.ok) return res.status(502).json({ error: 'Failed to save reviews' });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
};
