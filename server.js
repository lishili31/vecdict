#!/usr/bin/env node
/**
 * 墨墨查词后端（零依赖，仅使用 Node 原生模块）
 *
 * - 代理墨墨开放 API（https://open.maimemo.com/open）
 * - token 保存在 data/token.json（权限 600），可通过前端设置页写入
 * - 提供静态文件服务（public/）与 /api/search 查词接口
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3014;
const UPSTREAM_BASE = 'https://open.maimemo.com/open';
const TOKEN_FILE = path.join(__dirname, 'data', 'token.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPSTREAM_TIMEOUT = 15000; // 上游请求超时（毫秒）

/* ------------------------------------------------------------------ */
/* token 读写                                                          */
/* ------------------------------------------------------------------ */

function readToken() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    return typeof parsed.token === 'string' ? parsed.token : '';
  } catch {
    return '';
  }
}

function writeToken(token) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify({ token, updated_time: new Date().toISOString() }, null, 2)
  );
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch {}
}

/* ------------------------------------------------------------------ */
/* 简单限流：10 秒 20 次 / 60 秒 40 次（对应文档频控上限）                */
/* ------------------------------------------------------------------ */

const hitTimes = [];

function rateLimited() {
  const now = Date.now();
  while (hitTimes.length && hitTimes[0] < now - 60000) hitTimes.shift();
  const within10s = hitTimes.filter((t) => t >= now - 10000).length;
  if (within10s >= 20) return true;
  if (hitTimes.length >= 40) return true;
  hitTimes.push(now);
  return false;
}

/* ------------------------------------------------------------------ */
/* 上游请求                                                            */
/* ------------------------------------------------------------------ */

function upstream(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const token = readToken();
    const url = new URL(UPSTREAM_BASE + apiPath);
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.setTimeout(UPSTREAM_TIMEOUT, () => req.destroy(new Error('upstream timeout')));
    req.on('error', reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

function parseJsonField(raw, field) {
  try {
    const obj = JSON.parse(raw);
    // 实际响应为 { errors, data: { field: [...] }, success }，文档为顶层 { field: [...] }，两种都兼容
    const source = obj && typeof obj.data === 'object' && obj.data !== null ? obj.data : obj;
    return Array.isArray(source[field]) ? source[field] : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 有道词典兜底（公开接口，无需 token）                                    */
/* 墨墨开放 API 只返回用户自建内容；官方释义/例句由有道词典提供             */
/* ------------------------------------------------------------------ */

const YD_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function youdaoGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: 'GET', headers: { 'User-Agent': YD_UA } },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ status: res.statusCode, data }));
      }
    );
    req.setTimeout(UPSTREAM_TIMEOUT, () => req.destroy(new Error('youdao timeout')));
    req.on('error', reject);
    req.end();
  });
}

// 提取 ec 释义：trs[].tr[].l.i（i 可能为数组或字符串）
function extractYdInterps(word) {
  const out = [];
  for (const t of word.trs || []) {
    for (const tr of t.tr || []) {
      const i = tr.l && tr.l.i;
      const text = Array.isArray(i) ? i.join('；') : i;
      if (text) out.push(String(text).trim());
    }
  }
  return out.slice(0, 8);
}

async function fetchYoudao(spelling) {
  try {
    const url = new URL('https://dict.youdao.com/jsonapi');
    url.searchParams.set('q', spelling);
    const res = await youdaoGet(url);
    if (res.status !== 200) return null;
    const j = JSON.parse(res.data);
    const ecWord =
      j.ec && Array.isArray(j.ec.word) ? j.ec.word[0] : null;
    if (!ecWord) return null;
    const simple = j.simple && j.simple.word && j.simple.word[0];

    // 音标（ec 优先，simple 兜底）
    const phoneticUs = ecWord.usphone || (simple && simple.usphone) || '';
    const phoneticUk = ecWord.ukphone || (simple && simple.ukphone) || '';

    // 英汉释义
    const interps = extractYdInterps(ecWord);

    // 英英释义（ee.word 为对象，trs 为数组）
    const interpsEn = [];
    const eeWord = j.ee && j.ee.word;
    if (eeWord && Array.isArray(eeWord.trs)) {
      for (const t of eeWord.trs) {
        const pos = t.pos ? String(t.pos) + ' ' : '';
        for (const tr of t.tr || []) {
          const i = tr.l && tr.l.i;
          if (i) interpsEn.push(pos + String(i));
        }
      }
    }

    // 双语例句
    const sentences = [];
    for (const sp of (j.blng_sents_part && j.blng_sents_part['sentence-pair']) || []) {
      const en = sp.sentence || String(sp['sentence-eng'] || '').replace(/<[^>]+>/g, '');
      const zh = sp['sentence-translation'] || '';
      if (en) sentences.push({ en: String(en), zh: String(zh) });
      if (sentences.length >= 6) break;
    }

    // 词组短语
    const phrases = [];
    for (const entry of (j.phrs && j.phrs.phrs) || []) {
      const p = entry.phr || {};
      const text = p.headword && p.headword.l ? p.headword.l.i : '';
      const meaning = (p.trs || [])
        .map((t) => (t.tr && t.tr.l && t.tr.l.i) || '')
        .filter(Boolean)
        .join('；');
      if (text) phrases.push({ text: String(text), meaning: String(meaning) });
      if (phrases.length >= 8) break;
    }

    if (!interps.length && !interpsEn.length && !sentences.length && !phrases.length) {
      return null;
    }
    return {
      phoneticUs,
      phoneticUk,
      interps,
      interpsEn: interpsEn.slice(0, 6),
      sentences,
      phrases,
    };
  } catch {
    return null; // 有道不可用时降级为无
  }
}

/* ------------------------------------------------------------------ */
/* 查词流程：拼写 -> voc_id -> 释义/助记/例句 并行拉取                    */
/* ------------------------------------------------------------------ */

async function searchWord(word) {
  const spelling = word.trim();
  // 墨墨查词与有道词典并行拉取
  const [q, dict] = await Promise.all([
    upstream('POST', '/api/v1/memo/vocabulary/query', {
      spellings: [spelling],
    }),
    fetchYoudao(spelling),
  ]);
  if (q.status !== 200) {
    return { ok: false, status: q.status, body: q.data };
  }
  const vocList = parseJsonField(q.data, 'voc');
  if (!vocList.length) {
    return { ok: false, status: 404, body: JSON.stringify({ error: `未找到单词：${word}` }) };
  }
  const voc = vocList[0];
  const vocId = encodeURIComponent(voc.id);

  const [intsRes, notesRes, phrasesRes] = await Promise.all([
    upstream('GET', `/api/v1/memo/interpretations?voc_id=${vocId}`),
    upstream('GET', `/api/v1/memo/notes?voc_id=${vocId}`),
    upstream('GET', `/api/v1/memo/phrases?voc_id=${vocId}`),
  ]);

  return {
    ok: true,
    voc,
    interpretations: parseJsonField(intsRes.data, 'interpretations'),
    notes: parseJsonField(notesRes.data, 'notes'),
    phrases: parseJsonField(phrasesRes.data, 'phrases'),
    dict, // 有道词典数据（官方释义/例句/音标/短语），不可用时为 null
  };
}

/* ------------------------------------------------------------------ */
/* HTTP 服务                                                           */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  try {
    /* ---- 查词 ---- */
    if (pathname === '/api/search' && req.method === 'GET') {
      const word = (url.searchParams.get('word') || '').trim();
      if (!word) return sendJson(res, 400, { error: '缺少 word 参数' });
      if (rateLimited()) return sendJson(res, 429, { error: '请求过于频繁，请稍后再试' });

      try {
        const result = await searchWord(word);
        if (!result.ok) {
          return sendJson(res, result.status, { error: `墨墨 API 返回 ${result.status}`, detail: result.body });
        }
        return sendJson(res, 200, result);
      } catch (e) {
        return sendJson(res, 502, { error: '上游请求失败', detail: String(e.message || e) });
      }
    }

    /* ---- token 配置 ---- */
    if (pathname === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, { hasToken: !!readToken() });
    }
    if (pathname === '/api/config' && req.method === 'POST') {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return sendJson(res, 400, { error: '请求体不是合法 JSON' });
      }
      const token = typeof body.token === 'string' ? body.token.trim() : '';
      if (!token) return sendJson(res, 400, { error: 'token 不能为空' });
      writeToken(token);
      return sendJson(res, 200, { ok: true });
    }

    /* ---- 静态文件 ---- */
    if (req.method === 'GET') {
      const staticPath = pathname === '/' ? '/index.html' : pathname;
      return serveStatic(req, res, staticPath);
    }

    sendJson(res, 404, { error: 'Not Found' });
  } catch (e) {
    sendJson(res, 500, { error: '服务器内部错误', detail: String(e.message || e) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[wordsearch] listening on http://127.0.0.1:${PORT}`);
});
