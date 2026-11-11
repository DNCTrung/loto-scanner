// Cloudflare Worker: serves the static app + one API route for card OCR.
// Deploy: `npx wrangler deploy`  (needs an [ai] binding, see wrangler.jsonc)

const DEFAULT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

const PROMPT = `You are a precise OCR engine reading a printed 75-ball bingo card.
Return ONLY minified JSON, no markdown, no commentary, matching exactly:
{"rows":[[5 numbers],[5 numbers],[5 numbers],[5 numbers],[5 numbers]]}

How to read it:
- The card has a header row with the letters B I N G O above five columns.
- Read the five number rows from TOP to BOTTOM. Each row has exactly 5 numbers, left to right.
- The photo may be rotated or skewed. First rotate it mentally so B I N G O reads left to right, then read.
- The centre cell is a free space: put "FREE" for it, never a number.
- Column ranges: B=1-15, I=16-30, N=31-45, G=46-60, O=61-75. Use these to correct misread digits
  (e.g. a "1" read as "7" in column B becomes 1..15 only if it still fits the range).
- If a digit is genuinely unreadable, use null for that cell rather than guessing.
- Ignore card serial numbers, barcodes, logos and text outside the 5x5 grid.

Example shape of the answer:
{"rows":[[2,17,31,46,63],[3,18,32,48,65],[4,24,"FREE",49,67],[12,26,41,59,68],[13,30,44,60,73]]}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, ai: Boolean(env.AI), model: env.VISION_MODEL || DEFAULT_MODEL });
    }
    if (url.pathname === '/api/ocr') {
      if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
      return handleOcr(request, env);
    }
    // Anything else: static assets (handled by the platform when run_worker_first is scoped to /api/*)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};

async function handleOcr(request, env) {
  if (!env.AI) {
    return json(
      {
        error: 'Chưa cấu hình Workers AI binding. Thêm [ai] binding = "AI" vào wrangler.jsonc rồi deploy lại.',
        code: 'NO_AI_BINDING',
      },
      503,
    );
  }

  let bytes;
  let mime = 'image/jpeg';
  try {
    const parsed = await readImage(request);
    bytes = parsed.bytes;
    mime = parsed.mime;
  } catch (err) {
    return json({ error: String(err.message || err), code: 'BAD_IMAGE' }, 400);
  }
  if (!bytes || bytes.length < 512) return json({ error: 'Ảnh quá nhỏ hoặc rỗng', code: 'BAD_IMAGE' }, 400);
  if (bytes.length > 6 * 1024 * 1024) return json({ error: 'Ảnh quá lớn (giới hạn 6MB)', code: 'TOO_BIG' }, 413);

  const model = env.VISION_MODEL || DEFAULT_MODEL;
  const attempts = [
    // standard Workers AI vision shape
    { label: 'prompt+image', input: { prompt: PROMPT, image: [...bytes], max_tokens: 700, temperature: 0 } },
    // OpenAI-ish chat shape, data url
    {
      label: 'chat+image_url',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${base64(bytes)}` } },
            ],
          },
        ],
        max_tokens: 700,
        temperature: 0,
      },
    },
    // chat shape with raw image block
    {
      label: 'chat+image',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image', image: [...bytes] },
            ],
          },
        ],
        max_tokens: 700,
      },
    },
  ];

  const failures = [];
  for (const attempt of attempts) {
    try {
      const res = await env.AI.run(model, attempt.input);
      const text = extractText(res);
      const rows = extractRows(text);
      if (!rows) {
        failures.push(`${attempt.label}: không tìm thấy JSON trong trả lời`);
        continue;
      }
      return json({ ok: true, rows, model, format: attempt.label, raw: text.slice(0, 1200) });
    } catch (err) {
      failures.push(`${attempt.label}: ${String(err.message || err).slice(0, 300)}`);
    }
  }

  return json(
    {
      error: 'Không đọc được vé. Chụp lại rõ hơn hoặc nhập tay.',
      code: 'OCR_FAILED',
      details: failures,
      model,
    },
    502,
  );
}

async function readImage(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const body = await request.json();
    const dataUrl = body.image || body.dataUrl;
    if (!dataUrl || typeof dataUrl !== 'string') throw new Error('Thiếu trường image');
    const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
    const mime = m ? m[1] : 'image/jpeg';
    const b64 = m ? m[2] : dataUrl;
    return { bytes: fromBase64(b64), mime };
  }
  // Accept both multipart uploads (the browser UI uses this) and raw image bodies.
  // Some mobile browsers omit or mangle the file MIME type when sending a raw Blob.
  if (type.startsWith('image/') || type === 'application/octet-stream') {
    return { bytes: new Uint8Array(await request.arrayBuffer()), mime: type.startsWith('image/') ? type : 'image/jpeg' };
  }
  if (!type.includes('multipart/form-data') && !type.includes('application/x-www-form-urlencoded')) {
    throw new Error(`Content-Type không hỗ trợ: ${type || '(trống)'}`);
  }
  const form = await request.formData();
  const file = form.get('image') || form.get('file');
  if (!file || typeof file === 'string') throw new Error('Thiếu file ảnh');
  return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'image/jpeg' };
}

function extractText(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (typeof res.response === 'string') return res.response;
  if (Array.isArray(res.response)) return res.response.map((x) => (typeof x === 'string' ? x : x?.response ?? '')).join('');
  const choice = res.choices?.[0];
  if (typeof choice?.message?.content === 'string') return choice.message.content;
  if (Array.isArray(choice?.message?.content)) {
    return choice.message.content.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  }
  return JSON.stringify(res).slice(0, 4000);
}

/** Pull the first {...} block out of a model answer and normalise it to 5x5. */
export function extractRows(text) {
  if (!text) return null;
  let cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  cleaned = cleaned.slice(start, end + 1);

  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    try {
      obj = JSON.parse(cleaned.replace(/,\s*([}\]])/g, '$1').replace(/'/g, '"'));
    } catch {
      return null;
    }
  }

  const source = obj.rows || obj.grid || obj.card || obj;
  if (!Array.isArray(source)) return null;

  const rows = [];
  for (let r = 0; r < 5; r++) {
    const row = Array.isArray(source[r]) ? source[r] : [];
    const out = [];
    for (let c = 0; c < 5; c++) out.push(toCell(row[c]));
    rows.push(out);
  }
  rows[2][2] = 'FREE';
  return rows;
}

function toCell(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
  const s = String(v).trim().toUpperCase();
  if (!s || s === 'FREE' || s === '-') return null;
  const digits = s.replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

function base64(bytes) {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function fromBase64(b64) {
  const clean = b64.replace(/\s/g, '');
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
