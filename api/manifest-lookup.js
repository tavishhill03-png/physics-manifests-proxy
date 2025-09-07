// api/manifest-lookup.js
// Vercel serverless function: POST { chapter, manifest_id, size }
// Returns JSON with either { items: [...] } (compact) or a single item object

const CHAPTER_MAP = {
  ch2: 'https://gist.githubusercontent.com/tavishhill03-png/58d6f124dee022d6bfc5978bcff1eeba/raw/8b19ba4ee20c5f9de8a435812010d2c0e7db48ab/manifest_ch2.json'
  // add more chapters here if needed
};

const CACHE_TTL = Number(process.env.CACHE_TTL || 300); // seconds
const cache = new Map();

function parseTSV(tsvText) {
  const lines = tsvText.split(/\r?\n/).map(l => l.replace(/\uFEFF/g,'').trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split('\t').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split('\t');
    const obj = {};
    headers.forEach((h,i) => obj[h] = (cols[i]||'').trim());
    return obj;
  });
}

async function fetchWithCache(url) {
  const now = Date.now()/1000;
  const entry = cache.get(url);
  if (entry && (now - entry.ts) < CACHE_TTL) return entry.data;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch_failed:${r.status}`);
  const contentType = r.headers.get('content-type') || '';
  const txt = await r.text();
  let parsed;
  if (contentType.includes('application/json') || txt.trim().startsWith('{')) {
    try { parsed = JSON.parse(txt); }
    catch(e) { throw new Error('json_parse_failed'); }
    if (Array.isArray(parsed)) return parsed;
    if (parsed.items && Array.isArray(parsed.items)) return parsed.items;
    return parsed.items || [];
  } else {
    parsed = parseTSV(txt);
  }
  cache.set(url, { ts: now, data: parsed });
  return parsed;
}

function compactItem(row) {
  return {
    id: row.id || row.ID || row.Id || '',
    title: row.title || row.name || '',
    difficulty: row.difficulty ? Number(row.difficulty) || row.difficulty : '',
    image_url: row.gif_url || row.image_url || row.url || ''
  };
}

export default async function handler(req, res) {
  // CORS + preflight
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','Content-Type,x-api-key');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS,GET');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    // simple auth
    const key = req.headers['x-api-key'] || req.query['x-api-key'];
    if (process.env.WEBHOOK_KEY && process.env.WEBHOOK_KEY !== '') {
      if (!key || key !== process.env.WEBHOOK_KEY) return res.status(401).json({ error:'unauthorized' });
    }

    const body = req.method === 'POST' ? req.body : req.query;
    const chapter = (body.chapter || body.ch || '').toString().trim() || null;
    const manifest_id = (body.manifest_id || body.id || '').toString().trim() || null;

    if (!chapter || !CHAPTER_MAP[chapter]) {
      return res.status(400).json({ error:'invalid_chapter', text:'Invalid or missing chapter parameter (e.g., ch2).' });
    }

    const rows = await fetchWithCache(CHAPTER_MAP[chapter]);
    if (!Array.isArray(rows)) return res.status(500).json({ error:'bad_manifest_format' });

    if (!manifest_id) {
      const list = rows.slice(0, 50).map(compactItem);
      return res.json({ text:`Manifest ${chapter} — returning ${list.length} items.`, items: list });
    }

    const found = rows.find(r => (String(r.id||r.ID||'').toLowerCase() === manifest_id.toLowerCase()));
    if (!found) return res.status(404).json({ error:'not_found', text:'No item with that id.' });

    const imageUrl = found.gif_url || found.image_url || found.url || '';
    const imageMarkdown = imageUrl ? `![${(found.title||found.id||'image')}](${imageUrl})` : '';

    const payload = {
      text: `Found: ${found.title || found.id} (Difficulty: ${found.difficulty || 'N/A'})`,
      id: found.id || '',
      title: found.title || '',
      caption: found.caption || found.description || '',
      image_url: imageUrl,
      image_markdown: imageMarkdown,
      solution: found.solution || '',
      difficulty: found.difficulty || '',
      tags: (found.tags || '').toString().split(',').map(t=>t.trim()).filter(Boolean)
    };

    return res.json(payload);
  } catch (err) {
    console.error('manifest-lookup error', err);
    return res.status(500).json({ error:'server_error', text: err.message || 'Server error' });
  }
}
