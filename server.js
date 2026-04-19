import express from 'express';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// CORS headers
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// In-memory KV store (replaces Cloudflare KV)
// NOTE: data resets on server restart — add Railway Redis for persistence
const store = new Map();

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

app.post('/api/signup', async (req, res) => {
  try {
    const { phone, email } = req.body;
    if (!phone || phone.trim().length < 7) {
      return res.status(400).json({ error: 'Valid phone number required' });
    }

    const key = 'user:' + phone.replace(/\D/g, '');
    const existing = store.get(key);

    if (existing) {
      return res.json({ token: existing.token, remaining: Math.max(0, 10 - (existing.count || 0)) });
    }

    const token = randomUUID();
    const user = { phone: phone.trim(), email: email?.trim() || null, token, count: 0, createdAt: Date.now() };
    store.set(key, user);
    store.set('token:' + token, key);

    return res.json({ token, remaining: 10 });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { token, message, bizType, lang } = req.body;

    if (!token || !message) {
      return res.status(400).json({ error: 'Missing token or message' });
    }

    const userKey = store.get('token:' + token);
    if (!userKey) {
      return res.status(401).json({ error: 'Invalid session. Please sign up again.' });
    }

    const user = store.get(userKey);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.count >= 10) {
      return res.status(429).json({ error: 'limit_reached', remaining: 0 });
    }

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
        'x-api-key': process.env.CLAUDE_API_KEY,
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
      return res.status(502).json({ error: 'AI error' });
    }

    const claudeData = await claudeRes.json();
    const reply = claudeData.content?.[0]?.text || '...';

    user.count = (user.count || 0) + 1;
    store.set(userKey, user);

    return res.json({ reply, remaining: 10 - user.count });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Focobot running on port ${PORT}`);
});
