const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://smart-bike-taxi-platform.vercel.app,http://localhost:5173').split(',').map(v => v.trim()).filter(Boolean));

function makeHeaders(origin) {
  const headers = new Headers({
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  if (origin && allowedOrigins.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Headers', 'authorization,content-type,idempotency-key');
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  }
  return headers;
}

function json(body, status, origin) {
  const headers = makeHeaders(origin);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('origin');
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: makeHeaders(origin) });
    }
    if (origin && !allowedOrigins.has(origin)) {
      return json({ error: 'Origin not allowed' }, 403, null);
    }

    if (request.method === 'GET' && ['/health', '/api/v1/health'].includes(url.pathname)) {
      return json({
        status: 'ok',
        backend: 'neon',
        service: 'rideforge-api',
        database: 'not_checked',
      }, 200, origin);
    }

    if (request.method === 'GET' && ['/ready', '/api/v1/ready'].includes(url.pathname)) {
      return json({
        status: 'not_ready',
        backend: 'neon',
        reason: 'Database adapter, authentication middleware, and application routes are not yet implemented.',
      }, 503, origin);
    }

    return json({ error: 'Not found' }, 404, origin);
  },
};
