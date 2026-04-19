export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { phone, email } = await request.json();
    if (!phone || phone.trim().length < 7) {
      return new Response(JSON.stringify({ error: 'Valid phone number required' }), { status: 400, headers });
    }

    const key = 'user:' + phone.replace(/\D/g, '');
    const existing = await env.FOCOBOT_KV.get(key);

    if (existing) {
      const user = JSON.parse(existing);
      // Return existing session token so they can continue
      return new Response(JSON.stringify({ token: user.token, remaining: Math.max(0, 10 - (user.count || 0)) }), { headers });
    }

    const token = crypto.randomUUID();
    const user = { phone: phone.trim(), email: email?.trim() || null, token, count: 0, createdAt: Date.now() };
    await env.FOCOBOT_KV.put(key, JSON.stringify(user));
    await env.FOCOBOT_KV.put('token:' + token, key);

    return new Response(JSON.stringify({ token, remaining: 10 }), { headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
