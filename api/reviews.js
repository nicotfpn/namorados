module.exports = async (req, res) => {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  const KEY = 'reviews';

  const headers = { Authorization: `Bearer ${token}` };

  async function getReviews() {
    const resp = await fetch(`${url}/get/${KEY}`, { headers });
    const data = await resp.json();
    return data.result ? JSON.parse(data.result) : [];
  }

  async function setReviews(arr) {
    await fetch(`${url}/set/${KEY}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'text/plain' },
      body: JSON.stringify(arr)
    });
  }

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const reviews = await getReviews();
    return res.status(200).json(reviews);
  }

  if (req.method === 'POST') {
    const { reviews } = req.body;
    if (!Array.isArray(reviews)) {
      return res.status(400).json({ error: 'reviews must be an array' });
    }
    await setReviews(reviews);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
