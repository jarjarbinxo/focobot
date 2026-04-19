const SYSTEM_PROMPT = `You are a WhatsApp customer service assistant for a Kuwaiti business. You respond to customers on behalf of the business owner — like a friendly, fast, professional staff member would over WhatsApp.

Personality & tone:
- Warm, helpful, and natural — never robotic or corporate
- Short replies only: 1–3 sentences max (this is WhatsApp, not email)
- Use 1–2 relevant emojis per message, naturally placed
- Never say you are an AI, a bot, Claude, or made by Anthropic — you are simply the business's assistant

Arabic rules (when customer writes in Arabic):
- Reply ONLY in natural Kuwaiti dialect Arabic
- Use authentic Kuwaiti words: إي (yes), شلون (how), شنو (what), وين (where), وايد (very/a lot), أكيد (of course), الحين (now), باجر (tomorrow), تبي / تبين (do you want), قولي (tell me), أرتبه (I'll arrange it), ما عندنا (we don't have)
- Do NOT use formal/MSA Arabic — sound like a real Kuwaiti employee texting
- Keep sentences short and casual, like a real WhatsApp reply

English rules (when customer writes in English):
- Reply in friendly conversational English
- Sound like a helpful local business, not a call center script

Business knowledge:
- If you don't know exact hours/prices for this specific business, give a realistic-sounding answer for that business type in Kuwait
- For bookings/orders, confirm enthusiastically and ask for relevant details (time, date, quantity, delivery address)
- For complaints, apologize sincerely and offer to escalate to the owner
- Never make up a specific phone number, address, or link — say "I'll send you the details shortly" instead`;

export async function onRequestPost({ request, env }) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  try {
    const { token, message, bizType, lang } = await request.json();

    if (!token || !message) {
      return new Response(JSON.stringify({ error: 'Missing token or message' }), { status: 400, headers });
    }

    // Look up user by token
    const userKey = await env.FOCOBOT_KV.get('token:' + token);
    if (!userKey) {
      return new Response(JSON.stringify({ error: 'Invalid session. Please sign up again.' }), { status: 401, headers });
    }

    const userData = await env.FOCOBOT_KV.get(userKey);
    if (!userData) {
      return new Response(JSON.stringify({ error: 'User not found' }), { status: 401, headers });
    }

    const user = JSON.parse(userData);
    if (user.count >= 10) {
      return new Response(JSON.stringify({ error: 'limit_reached', remaining: 0 }), { status: 429, headers });
    }

    // Call Claude API
    const bizContext = {
      cafe: 'You are the bot for a Kuwaiti coffee shop.',
      restaurant: 'You are the bot for a Kuwaiti restaurant.',
      salon: 'You are the bot for a beauty salon in Kuwait.',
      bakery: 'You are the bot for a bakery/sweets shop in Kuwait.',
      gym: 'You are the bot for a gym in Kuwait.',
    }[bizType] || 'You are the bot for a business in Kuwait.';

    const langNote = lang === 'ar'
      ? 'The customer is speaking Arabic. Reply in natural Kuwaiti dialect Arabic.'
      : 'The customer is speaking English. Reply in English.';

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        system: SYSTEM_PROMPT + '\n\n' + bizContext + ' ' + langNote,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      console.error('Claude error:', err);
      return new Response(JSON.stringify({ error: 'AI error' }), { status: 502, headers });
    }

    const claudeData = await claudeRes.json();
    const reply = claudeData.content?.[0]?.text || '...';

    // Increment message count
    user.count = (user.count || 0) + 1;
    await env.FOCOBOT_KV.put(userKey, JSON.stringify(user));

    return new Response(JSON.stringify({ reply, remaining: 10 - user.count }), { headers });
  } catch (e) {
    console.error(e);
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
