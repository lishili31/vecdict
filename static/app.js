'use strict';

/* ============================================================
   智能中英词典 · 前端逻辑
   关键词搜索 + 自动补全 + 中文反向查询
   ============================================================ */

const $ = (sel) => document.querySelector(sel);

const els = {
  form: $('#searchForm'),
  input: $('#searchInput'),
  searchBtn: $('#searchBtn'),
  suggestBox: $('#suggestBox'),
  chips: $('#chips'),
  modeHint: $('#modeHint'),
  hint: $('#hint'),
  result: $('#result'),
  empty: $('#empty'),
  emptyText: $('#emptyText'),
  wordCard: $('#wordCard'),
  wordSpelling: $('#wordSpelling'),
  wordPhonetic: $('#wordPhonetic'),
  wordTags: $('#wordTags'),
  pronounceUsBtn: $('#pronounceUsBtn'),
  pronounceUkBtn: $('#pronounceUkBtn'),
  interpCard: $('#interpCard'),
  interpList: $('#interpList'),
  defCard: $('#defCard'),
  defList: $('#defList'),
  exchangeCard: $('#exchangeCard'),
  exchangeWrap: $('#exchangeWrap'),
  semanticBtn: $('#semanticBtn'),
  similarBtn: $('#similarBtn'),
  vectorCard: $('#vectorCard'),
  vectorTitle: $('#vectorTitle'),
  vectorList: $('#vectorList'),
  pager: $('#pager'),
  prevBtn: $('#prevBtn'),
  nextBtn: $('#nextBtn'),
  pageInfo: $('#pageInfo'),
};

const PAGE_SIZE = 20;
const DEFAULT_HINT = '支持英文单词、模糊拼写与中文释义反向查询 · 回车搜索';
const CJK_RE = /[\u4e00-\u9fff]/;

const QUICK_WORDS = ['hello', '你好', 'serendipity', '坚持', 'persevere'];
const TAG_NAMES = {
  zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研',
  toefl: '托福', ielts: '雅思', gre: 'GRE',
};
const EXCHANGE_LABELS = {
  pl: '复数', third: '第三人称单数', past: '过去式', done: '过去分词',
  ing: '现在分词', er: '比较级', est: '最高级',
  comparative: '比较级', superlative: '最高级',
};

let currentQuery = '';
let currentOffset = 0;
let currentTotal = 0;
let suggestItems = [];
let suggestActive = -1;
let suggestTimer = null;
let voiceAudio = null;

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
  try {
    const res = await fetch(path);
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

function isChinese(s) {
  return CJK_RE.test(s);
}

/* ---------------- 快捷词 ---------------- */

els.chips.innerHTML = QUICK_WORDS.map(
  (w) => `<button type="button" class="chip" data-word="${w}">${w}</button>`
).join('');

els.chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  els.input.value = chip.dataset.word;
  doSearch(chip.dataset.word, 0);
});

/* ---------------- 模式提示 ---------------- */

function updateModeHint(q) {
  if (isChinese(q)) {
    els.modeHint.textContent = '反向搜索模式：在 77 万词条的中文释义中查找匹配单词';
    show(els.modeHint);
  } else {
    hide(els.modeHint);
  }
}

/* ---------------- 自动补全 ---------------- */

function renderSuggest(items) {
  els.suggestBox.innerHTML = '';
  suggestItems = items;
  suggestActive = -1;
  if (!items.length) {
    hide(els.suggestBox);
    return;
  }
  const q = els.input.value.trim();
  items.forEach((it, idx) => {
    const word = typeof it === 'string' ? it : it.word;
    const hint = typeof it === 'string' ? '' : (it.hint || '');
    const highlighted = isChinese(q)
      ? escapeHtml(word)
      : escapeHtml(word).replace(
          new RegExp(`(${escapeRegExp(q)})`, 'i'),
          '<mark>$1</mark>'
        );
    els.suggestBox.insertAdjacentHTML('beforeend', `
      <div class="suggest-item" data-index="${idx}">
        <span class="suggest-word">${highlighted}</span>
        ${hint ? `<span class="suggest-sub">${escapeHtml(hint)}</span>` : ''}
      </div>`);
  });
  show(els.suggestBox);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setSuggestActive(idx) {
  if (!suggestItems.length) return;
  suggestActive = (idx + suggestItems.length) % suggestItems.length;
  els.suggestBox.querySelectorAll('.suggest-item').forEach((el, i) => {
    el.classList.toggle('active', i === suggestActive);
  });
}

function pickSuggest(idx) {
  const it = suggestItems[idx];
  if (!it) return;
  const word = typeof it === 'string' ? it : it.word;
  els.input.value = word;
  hide(els.suggestBox);
  doSearch(word, 0);
}

els.input.addEventListener('input', () => {
  const q = els.input.value.trim();
  updateModeHint(q);
  clearTimeout(suggestTimer);
  if (!q) { hide(els.suggestBox); return; }
  suggestTimer = setTimeout(async () => {
    const { status, data } = await apiGet(`api/suggest?q=${encodeURIComponent(q)}&limit=8`);
    if (status === 200 && data && data.suggestions) {
      if (els.input.value.trim() === q) renderSuggest(data.suggestions);
    }
  }, 300);
});

els.input.addEventListener('keydown', (e) => {
  if (!suggestItems.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setSuggestActive(suggestActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setSuggestActive(suggestActive - 1); }
  else if (e.key === 'Enter' && suggestActive >= 0) { e.preventDefault(); pickSuggest(suggestActive); }
  else if (e.key === 'Escape') { hide(els.suggestBox); suggestItems = []; }
});

els.suggestBox.addEventListener('click', (e) => {
  const item = e.target.closest('.suggest-item');
  if (item) pickSuggest(Number(item.dataset.index));
});

document.addEventListener('click', (e) => {
  if (!els.suggestBox.contains(e.target) && e.target !== els.input) {
    hide(els.suggestBox);
    suggestItems = [];
  }
});

/* ---------------- 结果渲染 ---------------- */

function tagHtml(entry) {
  const tags = [];
  if (entry.collins > 0) {
    tags.push(`<span class="tag tag-stars">${'★'.repeat(Math.min(entry.collins, 5))} 柯林斯</span>`);
  }
  if (entry.oxford === 1) {
    tags.push('<span class="tag tag-oxford">牛津核心词汇</span>');
  }
  if (entry.tag) {
    entry.tag.split(/\s+/).filter(Boolean).forEach((t) => {
      tags.push(`<span class="tag tag-exam">${TAG_NAMES[t] || escapeHtml(t)}</span>`);
    });
  }
  if (entry.bnc > 0) tags.push(`<span class="tag tag-freq">BNC 排名 ${entry.bnc}</span>`);
  if (entry.frq > 0) tags.push(`<span class="tag tag-freq">词频等级 ${entry.frq}</span>`);
  return tags.join('');
}

function interpLines(arr) {
  const out = [];
  (arr || []).forEach((text) => {
    // ECDICT 数据中换行可能是真实换行，也可能是字面 "\n"（两个字符），统一归一化
    String(text).replace(/\\n/g, '\n').split('\n').forEach((line) => {
      const t = line.trim();
      if (t) out.push(t);
    });
  });
  return out;
}

/* 英文搜索：完整词条卡 */
function renderDetail(entry) {
  show(els.wordCard);
  els.interpCard.querySelector('.card-title').innerHTML = `<span class="title-ico">🀄</span>中文释义`;
  els.wordSpelling.textContent = entry.word;
  if (entry.phonetic) {
    els.wordPhonetic.textContent = `/${entry.phonetic}/`;
    show(els.wordPhonetic);
  } else {
    hide(els.wordPhonetic);
  }
  els.wordTags.innerHTML = tagHtml(entry);

  const zh = interpLines(entry.translation);
  if (zh.length) {
    show(els.interpCard);
    els.interpList.innerHTML = zh.map((line) => `
      <li class="item">
        <span class="dot"></span>
        <span>${escapeHtml(line)}</span>
      </li>`).join('');
  } else {
    hide(els.interpCard);
  }

  const en = interpLines(entry.definition);
  if (en.length) {
    show(els.defCard);
    els.defList.innerHTML = en.map((line) => `
      <li class="item">
        <span class="dot dot-en"></span>
        <span>${escapeHtml(line)}</span>
      </li>`).join('');
  } else {
    hide(els.defCard);
  }

  const ex = entry.exchange || {};
  const keys = Object.keys(ex).filter((k) => EXCHANGE_LABELS[k]);
  if (keys.length) {
    show(els.exchangeCard);
    els.exchangeWrap.innerHTML = keys.map((k) => `
      <div class="exchange-item">
        <div class="exchange-label">${EXCHANGE_LABELS[k]}</div>
        <div class="exchange-value">${escapeHtml(ex[k].join('、'))}</div>
      </div>`).join('');
  } else {
    hide(els.exchangeCard);
  }
}

/* 中文反向搜索：精简结果列表 */
function renderReverseList(entries, q) {
  hide(els.wordCard);
  hide(els.interpCard);
  hide(els.defCard);
  hide(els.exchangeCard);
  show(els.interpCard);
  els.interpCard.querySelector('.card-title').innerHTML = `<span class="title-ico">🀄</span>匹配词条（按词频排序）`;
  els.interpList.innerHTML = entries.map((e) => {
    const zhLines = interpLines(e.translation);
    const matched = zhLines.find((l) => l.includes(q)) || zhLines[0] || '';
    const highlighted = escapeHtml(matched).split(escapeHtml(q)).join(`<mark>${escapeHtml(q)}</mark>`);
    return `
      <li class="item">
        <div class="item-main">
          <button type="button" class="link-word" data-word="${escapeHtml(e.word)}">${escapeHtml(e.word)}</button>
          <span class="phonetic-mini">${e.phonetic ? '/' + escapeHtml(e.phonetic) + '/' : ''}</span>
          <div class="interp-preview">${highlighted || '—'}</div>
          <div class="mini-tags">${tagHtml(e)}</div>
        </div>
      </li>`;
  }).join('');
}

els.interpList.addEventListener('click', (e) => {
  const btn = e.target.closest('.link-word');
  if (!btn) return;
  els.input.value = btn.dataset.word;
  hide(els.suggestBox);
  doSearch(btn.dataset.word, 0);
});

/* ---------------- 搜索 ---------------- */

async function doSearch(q, offset) {
  q = q.trim();
  if (!q) return;
  currentQuery = q;
  currentOffset = offset;
  hide(els.empty);
  hide(els.result);
  hide(els.vectorCard);
  hide(els.suggestBox);
  suggestItems = [];
  els.searchBtn.classList.add('loading');
  els.searchBtn.disabled = true;
  setHint(`正在搜索 “${q}”…`);

  const { status, data } = await apiGet(
    `api/search?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`
  );

  els.searchBtn.classList.remove('loading');
  els.searchBtn.disabled = false;

  if (status !== 200 || !data) {
    setHint(status ? `查询失败（HTTP ${status}）` : '网络异常，请检查服务是否启动', 'error');
    return;
  }

  currentTotal = data.total || 0;

  if (!data.results.length) {
    els.emptyText.textContent = `未找到与 “${q}” 相关的词条`;
    show(els.empty);
    setHint(DEFAULT_HINT);
    renderPager();
    return;
  }

  show(els.result);
  if (isChinese(q)) {
    renderReverseList(data.results, q);
    setHint(`共 ${data.total} 个匹配词条，按词频排序`);
  } else {
    renderDetail(data.results[0]);
    if (data.results.length > 1) {
      setHint(`精确匹配 “${q}”，另有 ${data.total - 1} 个相近词条`);
    } else {
      setHint(DEFAULT_HINT);
    }
  }
  renderPager();
}

function renderPager() {
  if (currentTotal > PAGE_SIZE) {
    show(els.pager);
    els.prevBtn.disabled = currentOffset <= 0;
    els.nextBtn.disabled = currentOffset + PAGE_SIZE >= currentTotal;
    const from = currentOffset + 1;
    const to = Math.min(currentOffset + PAGE_SIZE, currentTotal);
    els.pageInfo.textContent = `${from}-${to} / 共 ${currentTotal} 条`;
  } else {
    hide(els.pager);
  }
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (suggestActive >= 0) {
    pickSuggest(suggestActive);
    return;
  }
  doSearch(els.input.value, 0);
});

els.prevBtn.addEventListener('click', () => {
  if (currentOffset > 0) doSearch(currentQuery, currentOffset - PAGE_SIZE);
});

els.nextBtn.addEventListener('click', () => {
  if (currentOffset + PAGE_SIZE < currentTotal) doSearch(currentQuery, currentOffset + PAGE_SIZE);
});

/* ---------------- 向量语义检索 ---------------- */

async function fetchVector(path) {
  const { status, data } = await apiGet(path);
  if (status === 503) {
    setHint('语义搜索暂不可用：向量库尚未就绪', 'error');
    return null;
  }
  if (status !== 200 || !data || !Array.isArray(data.results)) {
    setHint(status ? `语义搜索失败（HTTP ${status}）` : '网络异常，请稍后重试', 'error');
    return null;
  }
  return data.results;
}

function renderVectorList(entries, title) {
  hide(els.wordCard);
  hide(els.interpCard);
  hide(els.defCard);
  hide(els.exchangeCard);
  hide(els.pager);
  els.vectorTitle.textContent = title;
  show(els.vectorCard);
  els.vectorList.innerHTML = entries.map((e) => {
    const lines = interpLines(e.text ? [e.text] : []).slice(1); // 首行为单词本身，跳过
    const preview = lines.find((l) => !l.startsWith('[')) || lines[0] || '';
    const sim = Math.max(0, Math.round(100 * (1 - (e.distance || 0) / 2)));
    return `
      <li class="item">
        <div class="item-main">
          <button type="button" class="link-word" data-word="${escapeHtml(e.word)}">${escapeHtml(e.word)}</button>
          <div class="interp-preview">${escapeHtml(preview) || '—'}</div>
          <div class="mini-tags">${tagHtml(e)}<span class="tag tag-dist">相似度 ${sim}%</span></div>
        </div>
      </li>`;
  }).join('');
}

async function semanticSearch(q) {
  q = q.trim();
  if (!q) return;
  hide(els.empty);
  hide(els.result);
  hide(els.suggestBox);
  suggestItems = [];
  els.semanticBtn.disabled = true;
  setHint(`正在语义检索 “${q}”…`);
  const results = await fetchVector(`api/semantic?q=${encodeURIComponent(q)}&limit=10`);
  els.semanticBtn.disabled = false;
  if (!results) return;
  if (!results.length) {
    els.emptyText.textContent = `语义检索未找到与 “${q}” 相关的词条`;
    show(els.empty);
    setHint(DEFAULT_HINT);
    return;
  }
  show(els.result);
  renderVectorList(results, `语义搜索 · “${q}” 相关词条`);
  setHint('语义搜索：按向量相似度排序，点击词条查看详解');
}

els.semanticBtn.addEventListener('click', () => {
  semanticSearch(els.input.value);
});

els.similarBtn.addEventListener('click', async () => {
  const word = els.wordSpelling.textContent;
  if (!word) return;
  hide(els.empty);
  hide(els.result);
  els.similarBtn.disabled = true;
  setHint(`正在查找 “${word}” 的同近义词…`);
  const results = await fetchVector(`api/similar?word=${encodeURIComponent(word)}&limit=10`);
  els.similarBtn.disabled = false;
  if (!results) return;
  if (!results.length) {
    setHint(`未找到 “${word}” 的同近义词`, 'error');
    return;
  }
  show(els.result);
  renderVectorList(results, `同近义词 · ${word}`);
  setHint('同近义词：按向量相似度排序，点击词条查看详解');
});

els.vectorList.addEventListener('click', (e) => {
  const btn = e.target.closest('.link-word');
  if (!btn) return;
  els.input.value = btn.dataset.word;
  hide(els.suggestBox);
  doSearch(btn.dataset.word, 0);
});

/* ---------------- 发音 ---------------- */

function playVoice(word, type) {
  if (!word) return;
  if (voiceAudio) { voiceAudio.pause(); voiceAudio = null; }
  const a = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`);
  a.play().catch(() => {});
  voiceAudio = a;
}

els.pronounceUsBtn.addEventListener('click', () => playVoice(els.wordSpelling.textContent, 1));
els.pronounceUkBtn.addEventListener('click', () => playVoice(els.wordSpelling.textContent, 2));

/* ---------------- 初始化 ---------------- */

setHint(DEFAULT_HINT);
