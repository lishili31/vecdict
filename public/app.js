'use strict';

/* ============================================================
   墨墨查词 · 前端逻辑
   所有资源与 API 均使用相对路径，适配 /word/ 子目录部署
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#searchForm'),
  input: $('#searchInput'),
  searchBtn: $('#searchBtn'),
  chips: $('#chips'),
  hint: $('#hint'),
  result: $('#result'),
  empty: $('#empty'),
  emptyText: $('#emptyText'),
  wordCard: $('#wordCard'),
  wordSpelling: $('#wordSpelling'),
  wordPhonetic: $('#wordPhonetic'),
  pronounceUsBtn: $('#pronounceUsBtn'),
  pronounceUkBtn: $('#pronounceUkBtn'),
  dictCard: $('#dictCard'),
  dictCount: $('#dictCount'),
  dictList: $('#dictList'),
  dictEnBlock: $('#dictEnBlock'),
  dictEnList: $('#dictEnList'),
  sentenceCard: $('#sentenceCard'),
  sentenceCount: $('#sentenceCount'),
  sentenceList: $('#sentenceList'),
  ydPhraseCard: $('#ydPhraseCard'),
  ydPhraseCount: $('#ydPhraseCount'),
  ydPhraseList: $('#ydPhraseList'),
  interpretationCard: $('#interpretationCard'),
  intCount: $('#intCount'),
  interpretationList: $('#interpretationList'),
  noteCard: $('#noteCard'),
  noteCount: $('#noteCount'),
  noteList: $('#noteList'),
  phraseCard: $('#phraseCard'),
  phraseCount: $('#phraseCount'),
  phraseList: $('#phraseList'),
  settingsBtn: $('#settingsBtn'),
  settingsModal: $('#settingsModal'),
  tokenInput: $('#tokenInput'),
  tokenStatus: $('#tokenStatus'),
  saveTokenBtn: $('#saveTokenBtn'),
  closeModalBtn: $('#closeModalBtn'),
};

const QUICK_WORDS = ['apple', 'hello', 'persevere', 'serendipity', 'ubiquitous'];
const DEFAULT_HINT = '词典释义 · 双语例句 · 你的墨墨沉淀 · 一键发音';

let pronounceVoice = null;

/* ---------------- 通用 ---------------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

function setHint(text, type) {
  els.hint.textContent = text;
  els.hint.className = 'hint' + (type ? ' ' + type : '');
}

async function apiGet(path) {
  const res = await fetch(path);
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

function stagger(el, index) {
  el.classList.add('reveal');
  el.style.animationDelay = `${index * 0.07}s`;
}

/* ---------------- 快捷词 ---------------- */

els.chips.innerHTML = QUICK_WORDS.map(
  (w) => `<button type="button" class="chip" data-word="${w}">${w}</button>`
).join('');

els.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  els.input.value = chip.dataset.word;
  doSearch(chip.dataset.word);
});

/* ---------------- 查词 ---------------- */

function makeTagList(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  return tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
}

/* 助记类型徽章：稳定散列到 5 种配色 */
function badgeClass(name) {
  let hash = 0;
  const s = String(name);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return `badge-${hash % 5}`;
}

function highlightPhrase(phrase, highlights) {
  // highlight 实际返回二维数组；兼容两种形态
  let ranges = null;
  if (Array.isArray(highlights)) {
    if (highlights.length && Array.isArray(highlights[0])) ranges = highlights[0];
    else if (highlights.length && typeof highlights[0] === 'object' && 'start' in highlights[0]) ranges = highlights;
  }
  if (!ranges || !ranges.length) return escapeHtml(phrase);
  let out = '';
  let pos = 0;
  for (const r of ranges) {
    const s = Math.max(0, Number(r.start) || 0);
    const e = Math.max(s, Number(r.end) || s);
    out += escapeHtml(phrase.slice(pos, s)) + '<mark>' + escapeHtml(phrase.slice(s, e)) + '</mark>';
    pos = e;
  }
  out += escapeHtml(phrase.slice(pos));
  return out;
}

function renderSearchResult(data) {
  let delay = 0;
  const dict = data.dict;

  // 单词卡
  show(els.wordCard);
  els.wordCard.classList.add('reveal');
  els.wordCard.style.animationDelay = '0s';
  els.wordSpelling.textContent = data.voc.spelling;
  if (dict && (dict.phoneticUs || dict.phoneticUk)) {
    const parts = [];
    if (dict.phoneticUs) parts.push(`美 /${dict.phoneticUs}/`);
    if (dict.phoneticUk) parts.push(`英 /${dict.phoneticUk}/`);
    els.wordPhonetic.textContent = parts.join('  ');
    show(els.wordPhonetic);
  } else {
    hide(els.wordPhonetic);
  }

  // 词典释义（有道）
  if (dict && (dict.interps.length || dict.interpsEn.length)) {
    show(els.dictCard);
    stagger(els.dictCard, ++delay);
    els.dictCount.textContent = dict.interps.length;
    els.dictList.innerHTML = dict.interps.map((it, i) => `
      <li class="item">
        <span class="dot"></span>
        <div class="item-main dict-interp">${escapeHtml(it)}</div>
      </li>`).join('');
    if (dict.interpsEn.length) {
      show(els.dictEnBlock);
      els.dictEnList.innerHTML = dict.interpsEn.map((it) => `
        <li class="item">
          <span class="dot dot-en"></span>
          <div class="item-main item-en">${escapeHtml(it)}</div>
        </li>`).join('');
    } else {
      hide(els.dictEnBlock);
    }
  } else {
    hide(els.dictCard);
  }

  // 双语例句（有道）
  if (dict && dict.sentences.length) {
    show(els.sentenceCard);
    stagger(els.sentenceCard, ++delay);
    els.sentenceCount.textContent = dict.sentences.length;
    els.sentenceList.innerHTML = dict.sentences.map((s) => `
      <li class="item">
        <div class="phrase-en">${escapeHtml(s.en)}</div>
        <div class="item-sub">${escapeHtml(s.zh)}</div>
      </li>`).join('');
  } else {
    hide(els.sentenceCard);
  }

  // 词组短语（有道）
  if (dict && dict.phrases.length) {
    show(els.ydPhraseCard);
    stagger(els.ydPhraseCard, ++delay);
    els.ydPhraseCount.textContent = dict.phrases.length;
    els.ydPhraseList.innerHTML = dict.phrases.map((p) => `
      <li class="item">
        <div class="item-main">${escapeHtml(p.text)}</div>
        ${p.meaning ? `<div class="item-sub">${escapeHtml(p.meaning)}</div>` : ''}
      </li>`).join('');
  } else {
    hide(els.ydPhraseCard);
  }

  // 释义（墨墨自建）
  if (data.interpretations.length) {
    show(els.interpretationCard);
    stagger(els.interpretationCard, ++delay);
    els.intCount.textContent = data.interpretations.length;
    els.interpretationList.innerHTML = data.interpretations.map((it) => `
      <li class="item">
        <span class="dot"></span>
        <div>
          <div class="item-main">${escapeHtml(it.interpretation)}</div>
          <div class="item-meta" style="padding-left:0">${makeTagList(it.tags)}</div>
        </div>
      </li>`).join('');
  } else {
    hide(els.interpretationCard);
  }

  // 助记（墨墨自建）
  if (data.notes.length) {
    show(els.noteCard);
    stagger(els.noteCard, ++delay);
    els.noteCount.textContent = data.notes.length;
    els.noteList.innerHTML = data.notes.map((n) => `
      <li class="item">
        <div class="item-main">${escapeHtml(n.note)}</div>
        <div class="item-meta" style="padding-left:0">
          <span class="badge-note ${badgeClass(n.note_type)}">${escapeHtml(n.note_type || '助记')}</span>
        </div>
      </li>`).join('');
  } else {
    hide(els.noteCard);
  }

  // 例句（墨墨自建）
  if (data.phrases.length) {
    show(els.phraseCard);
    stagger(els.phraseCard, ++delay);
    els.phraseCount.textContent = data.phrases.length;
    els.phraseList.innerHTML = data.phrases.map((p) => `
      <li class="item">
        <div class="phrase-en">${highlightPhrase(p.phrase, p.highlight)}</div>
        <div class="item-sub">${escapeHtml(p.interpretation || '')}</div>
        <div class="item-meta">
          ${p.origin ? `<span class="tag">${escapeHtml(p.origin)}</span>` : ''}
          ${makeTagList(p.tags)}
        </div>
      </li>`).join('');
  } else {
    hide(els.phraseCard);
  }

  // 全部为空（词典与墨墨都无内容）
  const userEmpty = !data.interpretations.length && !data.notes.length && !data.phrases.length;
  const dictEmpty = !dict || (!dict.interps.length && !dict.interpsEn.length && !dict.sentences.length && !dict.phrases.length);
  if (userEmpty && dictEmpty) {
    els.emptyText.textContent = '未找到该单词的释义与例句';
    show(els.empty);
  } else {
    hide(els.empty);
  }
}

async function doSearch(word) {
  if (!word) return;
  hide(els.empty);
  hide(els.result);
  els.searchBtn.classList.add('loading');
  els.searchBtn.disabled = true;
  setHint(`正在查询 “${word}”…`);

  const { status, data } = await apiGet(`api/search?word=${encodeURIComponent(word)}`);

  els.searchBtn.classList.remove('loading');
  els.searchBtn.disabled = false;

  if (status === 200) {
    show(els.result);
    renderSearchResult(data);
    setHint(DEFAULT_HINT);
    speak(word);
  } else if (status === 429) {
    setHint('请求过于频繁，请稍后再试（墨墨 API 频控限制）', 'error');
  } else if (status === 404) {
    setHint(data && data.error ? data.error : '未找到该单词', 'error');
  } else if (status === 401 || status === 403) {
    setHint('Token 无效或已过期，请到右上角设置中更新', 'error');
    openSettings();
  } else {
    setHint(`查询失败（HTTP ${status}）${data && data.detail ? '：' + data.detail : ''}`, 'error');
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  doSearch(els.input.value.trim());
});

/* ---------------- 发音 ---------------- */

// 有道词典真人发音：type=1 美音 / type=2 英音
let voiceAudio = null;
function playVoice(word, type) {
  if (!word) return;
  if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; }
  const a = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`);
  a.play().catch(() => {});
  voiceAudio = a;
}

function speak(text) {
  // 优先有道真人发音，不可用时退回浏览器 TTS
  if (text) playVoice(text, 1);
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (pronounceVoice) u.voice = pronounceVoice;
  u.rate = 0.9;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

if ('speechSynthesis' in window) {
  speechSynthesis.onvoiceschanged = () => {
    const voices = speechSynthesis.getVoices();
    pronounceVoice = voices.find((v) => v.lang === 'en-US') || voices.find((v) => v.lang.startsWith('en')) || null;
  };
}

els.pronounceUsBtn.addEventListener('click', () => playVoice(els.wordSpelling.textContent, 1));
els.pronounceUkBtn.addEventListener('click', () => playVoice(els.wordSpelling.textContent, 2));

/* ---------------- 设置 ---------------- */

function openSettings() {
  hide(els.tokenStatus);
  apiGet('api/config').then(({ status, data }) => {
    els.tokenInput.placeholder = status === 200 && data.hasToken ? '已配置 Token（留空则保持不变）' : '粘贴 Token';
    els.settingsModal.classList.remove('hidden');
    els.tokenInput.focus();
  });
}

function closeSettings() {
  els.settingsModal.classList.add('hidden');
  els.tokenInput.value = '';
}

els.settingsBtn.addEventListener('click', openSettings);
els.closeModalBtn.addEventListener('click', closeSettings);
els.settingsModal.addEventListener('click', (e) => {
  if (e.target === els.settingsModal) closeSettings();
});

els.saveTokenBtn.addEventListener('click', async () => {
  const token = els.tokenInput.value.trim();
  if (!token) {
    els.tokenStatus.textContent = '请输入 Token';
    els.tokenStatus.className = 'token-status error';
    return;
  }
  els.saveTokenBtn.disabled = true;
  try {
    const res = await fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      els.tokenStatus.textContent = '已保存 ✓';
      els.tokenStatus.className = 'token-status ok';
      els.tokenInput.value = '';
      setTimeout(closeSettings, 800);
    } else {
      els.tokenStatus.textContent = '保存失败，请重试';
      els.tokenStatus.className = 'token-status error';
    }
  } catch {
    els.tokenStatus.textContent = '保存失败，请重试';
    els.tokenStatus.className = 'token-status error';
  }
  els.saveTokenBtn.disabled = false;
});

/* ---------------- 初始化 ---------------- */

apiGet('api/config').then(({ status, data }) => {
  if (status === 200 && !data.hasToken) {
    setHint('尚未配置 Token，点击右上角 ⚙ 设置', 'error');
  }
});
