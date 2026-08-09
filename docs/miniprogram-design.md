# 智能中英词典 · 微信小程序前端设计

> 目标：将 Web 版（`static/`）全部功能平移到微信小程序，后端接口完全复用（见 `docs/backend-api.md`），后端零改动。

---

## 1. 目标与范围

**功能清单（与 Web 版对齐）**

| # | 功能 | 说明 |
|---|------|------|
| 1 | 关键词搜索 | 英文精确 / 前缀 / 编辑距离 ≤ 2 拼写纠错 |
| 2 | 中文反向查询 | 在 77 万词条中文释义中检索，命中高亮 |
| 3 | 自动补全 | 输入联想（英文前缀 / 中文释义前缀），300ms 防抖 |
| 4 | 语义搜索 | 描述 → 单词（`/api/semantic`） |
| 5 | 同近义词推荐 | 详情页内推荐（`/api/similar`） |
| 6 | 发音 | 美音 / 英音（有道公开接口） |
| 7 | 深色模式 | 跟随系统 |

**不做**（Web 版也没有，避免范围膨胀）：收藏、历史记录、生词本、登录。

**运行要求**：基础库 ≥ 2.11.0（深色模式 `darkmode` 所需），建议 2.30.0+。

---

## 2. 总体设计

### 2.1 页面划分

Web 版是单页内联展示；小程序拆为两个页面：

```
pages/index/index    搜索首页：搜索 + 联想 + 快捷词 + 结果区（列表 / 主词条内联卡）
pages/detail/detail  词条详情：发音、音标、标签、释义、词形变化、同近义词
```

- 首页英文查询命中主词条时，**内联展示详情卡**（与 Web 一致，减少一次跳转）；列表点击 → 跳详情页。
- 详情页接收 `word` 参数，独立拉取数据，天然支持分享（`onShareAppMessage` 带 `word`）。

### 2.2 目录结构

```
miniprogram/
├── app.js                    # 全局逻辑（本项目无本地数据，仅简单启动日志）
├── app.json                  # 页面注册、window 配置、darkmode
├── app.wxss                  # 全局样式与主题变量
├── theme.json                # 深色模式变量（light / dark）
├── sitemap.json
├── project.config.json       # 开发者工具项目配置（appid 占位）
├── config/
│   └── index.js              # BASE_URL、分页大小、联想条数、发音 URL 模板
├── utils/
│   ├── request.js            # wx.request Promise 封装 + 统一错误处理
│   └── dict.js               # 数据归一化与展示映射（标签、词形、相似度、字面 \n）
├── components/
│   ├── entry-item/           # 列表词条行：词 + 音标 + 释义预览 + 标签
│   └── word-card/            # 详情卡：发音按钮、音标、标签、中文/英文释义、词形变化
└── pages/
    ├── index/                # 首页（index.wxml / index.js / index.wxss / index.json）
    └── detail/               # 详情页（同上）
```

### 2.3 数据流

```
输入 → (防抖 300ms + 序号防竞态) → /api/suggest → 联想列表
确认 / 点联想 / 点快捷词 → /api/search?q=&limit=20&offset=
  ├─ 英文 → results[0] 内联详情卡 + results[1:] 相近词条列表
  ├─ 中文 → 匹配词条列表（命中行高亮）
  └─ 上滑到底 → offset 递增加载更多
点列表词条 → navigateTo /pages/detail/detail?word=xxx
详情页 onLoad(word) → /api/search?q=word → 详情卡
  └─ 「同近义词」→ /api/similar?word= → 列表，点击 → 页内切换词条
语义按钮 → /api/semantic?q=&limit=10 → 结果列表（复用 entry-item）
```

### 2.4 关键常量

| 常量 | 值 | 出处 |
|------|-----|------|
| `PAGE_SIZE` | 20 | 与 Web 版一致 |
| `SUGGEST_LIMIT` | 8 | Web 版联想用 8 |
| `SEMANTIC_LIMIT` / `SIMILAR_LIMIT` | 10 | 与 Web 版一致 |
| 联想防抖 | 300ms | 与 Web 版一致 |
| 快捷词 | `['hello', '你好', 'serendipity', '坚持', 'persevere']` | 与 Web 版一致 |

---

## 3. 页面设计

### 3.1 首页 `pages/index/index`

**页面结构（自上而下）**

```
搜索区：输入框 + 「搜索」按钮 + 「🧠 语义」按钮
联想浮层：suggest-list（词 + hint，覆盖在搜索区下方）
快捷词：chips 横向滚动
模式提示：中文输入时提示「反向搜索模式…」
结果区（按 mode 切换）：
  - search-en：主词条详情卡（word-card）+ 相近词条列表（entry-item）
  - search-zh：匹配词条列表（entry-item，命中行高亮）
  - semantic：语义结果列表（entry-item，含相似度标签）
  - 空态 / 错误提示
底部：加载更多（上滑自动触发）
```

**data 模型**

```js
data: {
  input: '',          // 搜索框当前值
  suggest: [],        // 联想 [{word, hint}]
  showSuggest: false,
  mode: 'idle',       // 'idle' | 'search-en' | 'search-zh' | 'semantic'
  detail: null,       // search-en 模式的主词条（word-card 数据）
  list: [],           // 列表数据（相近词条 / 中文结果 / 语义结果）
  total: 0,
  offset: 0,          // 已加载列表条数（见下方分页规则）
  loading: false,
  finished: false,    // 无更多数据
  hintText: '',       // 结果提示语
  quickWords: ['hello', '你好', 'serendipity', '坚持', 'persevere']
}
```

**交互规则**

1. **输入联想**：`bindinput` → 防抖 300ms 后请求 `/api/suggest`；每次输入自增请求序号 `_seq`，响应返回时若序号已过期则丢弃（防竞态）。输入为空时清空联想。
2. **搜索**：`confirm`（键盘搜索键）、点击联想项、点击快捷词 → `search(q)`。
3. **搜索结果分流**：
   - 中文输入（`/[\u4e00-\u9fff]/` 判定）→ `mode='search-zh'`，整页列表；命中行用 `<mark>` 样式高亮查询词；
   - 英文输入 → `mode='search-en'`，`results[0]` 渲染 word-card，`results.slice(1)` 作为「相近词条」列表。
4. **分页（onReachBottom 自动加载）**：
   - 中文 / 语义模式：`offset = 已加载条数`，直接追加；
   - 英文模式：**主词条不占分页位**，下一页请求 `offset = 已加载列表条数`（即第一页展示 19 条后，下一页从第 20 条开始），避免重复或漏条；
   - `total` 无增量或 `list.length >= total` 时置 `finished=true` 停止加载（英文模式 total 为候选窗口大小，见后端文档 3.1）。
5. **语义搜索**：点「🧠 语义」→ 以当前输入请求 `/api/semantic`，结果列表标题「语义搜索 · q」，每项带相似度标签（`max(0, round(100 * (1 - d / 2)))`）。
6. **错误与降级**：
   - HTTP 非 200 / 网络失败 → 顶部提示「网络异常，请稍后重试」；
   - 语义 / 同近义词返回 503 → 提示「语义搜索暂不可用：向量库尚未就绪」；
   - 空结果 → 空态插画 + 「未找到与 xx 相关的词条」。
7. **列表点击** → `navigateTo` 详情页。

### 3.2 详情页 `pages/detail/detail`

**页面结构**

```
导航栏：返回（默认），标题「智能中英词典」
词头：单词 + 音标 + 美音/英音按钮
标签行：柯林斯星级 / 牛津核心 / 考试标签 / BNC / 词频
中文释义列表
英文释义列表
词形变化（label: 值，如 复数: cats）
同近义词区：按钮触发 → 列表（entry-item + 相似度标签）
```

**data 模型**

```js
data: {
  word: '',            // 当前词
  entry: null,         // 词条详情（/api/search 的 results[0]）
  exchange: [],        // [{label, value}] 词形变化，已映射中文标签
  similar: [],         // 同近义词结果
  loading: true,
  similarLoading: false
}
```

**交互规则**

1. `onLoad({word})` → `/api/search?q=word&limit=20`，取 `results[0]` 渲染详情。词不存在（空数组）→ 空态提示。
2. **发音**：美/英按钮 → `wx.createInnerAudioContext`，`src = https://dict.youdao.com/dictvoice?audio={word}&type={1|2}`；再次点击先 `stop()`；`onUnload` 时 `destroy()`。
3. **同近义词**：点按钮 → `/api/similar?word=&limit=10`；列表项点击 → **页内切换词条**（重新拉取详情 + 同近义词，替换当前内容），避免页面栈无限堆积。
4. **分享**：`onShareAppMessage` 返回 `{ title: word, path: '/pages/detail/detail?word=' + word }`。
5. 503 / 网络错误降级与首页一致。

---

## 4. 模块设计

### 4.1 `config/index.js`

```js
// 线上：https://www.stringandstick.cn/dict/api
// 本地开发：http://127.0.0.1:3000/api（工具需勾选「不校验合法域名」）
const BASE_URL = 'https://www.stringandstick.cn/dict/api'

module.exports = {
  BASE_URL,
  PAGE_SIZE: 20,
  SUGGEST_LIMIT: 8,
  SEMANTIC_LIMIT: 10,
  SIMILAR_LIMIT: 10,
  SUGGEST_DEBOUNCE: 300,
  VOICE_URL: (word, type) =>
    `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${type}`
}
```

### 4.2 `utils/request.js`（统一请求层）

```js
const { BASE_URL } = require('../config/index')

const ERR = { NETWORK: 'network', HTTP: 'http', SERVICE: 'service' }

function request(path, data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      data,
      method: 'GET',
      timeout: 10000, // 语义接口含云端编码，预留余量
      success(res) {
        if (res.statusCode === 200) resolve(res.data)
        else if (res.statusCode === 503)
          reject({ type: ERR.SERVICE, message: res.data && res.data.error })
        else reject({ type: ERR.HTTP, status: res.statusCode })
      },
      fail() { reject({ type: ERR.NETWORK }) }
    })
  })
}

module.exports = { request, ERR }
```

调用方统一处理：`ERR.SERVICE` → 「语义搜索暂不可用」；`ERR.NETWORK` / `ERR.HTTP` → 「网络异常，请稍后重试」。

### 4.3 `utils/dict.js`（数据归一化与映射）

Web 版 `app.js` 的既有逻辑原样迁移，重点是**字面 `\n` 归一化**（历史坑，见 AGENT.md）：

```js
// ECDICT 换行可能是字面 "\n"（两个字符），渲染前必须先归一化
function normalizeLines(text) {
  return String(text || '')
    .replace(/\\n/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
}

// 向量接口 text 字段：首行为单词本身，预览取其后的首个非 "[...]" 行
function buildPreview(text) {
  const lines = normalizeLines(text).slice(1)
  return lines.find(l => !l.startsWith('[')) || lines[0] || ''
}

function similarity(distance) {
  return Math.max(0, Math.round(100 * (1 - (distance || 0) / 2)))
}

const TAG_NAMES = {
  zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研',
  toefl: '托福', ielts: '雅思', gre: 'GRE'
}
const EXCHANGE_LABELS = {
  pl: '复数', third: '第三人称单数', past: '过去式', done: '过去分词',
  ing: '现在分词', er: '比较级', est: '最高级',
  comparative: '比较级', superlative: '最高级'
}

// entry.tag 如 "zk gk" → [{key:'zk', label:'中考'}, ...]
function parseTags(tagStr) {
  return String(tagStr || '').split(/\s+/).filter(Boolean)
    .map(key => ({ key, label: TAG_NAMES[key] || key }))
}

// entry.exchange → [{label, value}]，value 为数组 join('、')
function parseExchange(exchange) {
  return Object.keys(exchange || {})
    .filter(k => EXCHANGE_LABELS[k])
    .map(k => ({ label: EXCHANGE_LABELS[k], value: exchange[k].join('、') }))
}

module.exports = { normalizeLines, buildPreview, similarity, parseTags, parseExchange }
```

---

## 5. 组件设计

### 5.1 `components/word-card`（详情卡）

props：`entry`（3.1 节词条字段）、`showVoice`（布尔）。

- 词头：`word`、`phonetic`（`/xx/` 包裹，空则不显示）、美音/英音按钮（emit 事件由页面调发音，便于音频生命周期管理）。
- 标签：柯林斯 `★×n 柯林斯`、`牛津核心词汇`、考试标签、`BNC 排名 x`、`词频等级 x`（逻辑同 Web `tagHtml`）。
- 释义：`translation` / `definition` 行数组逐行渲染；空数组不渲染该区块。
- 词形变化：`exchange` 渲染 label-value 网格。

### 5.2 `components/entry-item`（列表词条行）

props：`word`、`phonetic`、`preview`、`tags`（已映射数组）、`highlight`（高亮词，中文搜索命中行用）、`sim`（相似度百分比，可选）。

点击行为由页面监听 `bindtap` 处理（跳详情页）。

---

## 6. 主题与样式

- 布局单位统一 `rpx`；主色沿用 Web 版视觉风格（品牌绿渐变 + 卡片式布局）。
- **深色模式**：官方 `darkmode` 方案（基础库 ≥ 2.11.0）：

`app.json` 声明：

```json
{
  "darkmode": true,
  "themeLocation": "theme.json"
}
```

`theme.json`：

```json
{
  "light": {
    "bgColor": "#f6f7fb",
    "cardBg": "#ffffff",
    "textColor": "#1f2329",
    "subTextColor": "#86909c"
  },
  "dark": {
    "bgColor": "#111111",
    "cardBg": "#1d1d1d",
    "textColor": "#e5e6eb",
    "subTextColor": "#8a8f99"
  }
}
```

`app.wxss` 与组件 wxss 中引用变量：

```css
page { background: var(--bgColor); color: var(--textColor); }
.card { background: var(--cardBg); }
```

> 说明：系统导航栏颜色不随主题自动变化（`navigationBarTextStyle` 仅支持 black/white）。首版使用默认导航栏（浅色下黑字、深色下可接受），如需导航栏也跟随主题，可改为 `"navigationStyle": "custom"` 自绘，列为可选优化。

---

## 7. 发音实现

```js
playVoice(type) { // type: 1 美音 / 2 英音
  const { word } = this.data
  if (!word) return
  this._audio && this._audio.destroy()
  const audio = wx.createInnerAudioContext()
  audio.src = VOICE_URL(word, type)
  audio.play()
  this._audio = audio
},
onUnload() { this._audio && this._audio.destroy() }
```

注意：`dict.youdao.com` 需加入 **downloadFile 合法域名**；有道接口为第三方公开服务，播放失败时静默降级（不弹错）。

---

## 8. 项目配置与上线

### 8.1 `app.json`

```json
{
  "pages": ["pages/index/index", "pages/detail/detail"],
  "window": {
    "navigationBarTitleText": "智能中英词典",
    "navigationBarBackgroundColor": "#ffffff",
    "navigationBarTextStyle": "black",
    "backgroundColor": "#f6f7fb",
    "backgroundTextStyle": "light"
  },
  "darkmode": true,
  "themeLocation": "theme.json",
  "style": "v2",
  "lazyCodeLoading": "requiredComponents",
  "sitemapLocation": "sitemap.json"
}
```

### 8.2 域名配置（小程序后台）

| 类别 | 域名 | 用途 |
|------|------|------|
| request 合法域名 | `https://www.stringandstick.cn` | 全部业务接口（路径 `/dict/api/...`） |
| downloadFile 合法域名 | `https://dict.youdao.com` | 发音音频 |

开发阶段：开发者工具勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」，并确认后端服务已启动（本地 3000 端口或线上）。

### 8.3 上线 checklist

1. `project.config.json` 填入真实 appid；工具中完成真机预览测试；
2. 后台配置上述两个合法域名（配置后约 5 分钟生效）；
3. 提交体验版 → 真机走查（见第 9 节）→ 提交审核；
4. 注意：小程序审核与发布与后端无关，后端已在线，无发布联动。

---

## 9. 测试与验收清单

| # | 用例 | 操作 | 预期 |
|---|------|------|------|
| 1 | 精确搜索 | 输入 `happy` 回车 | 详情卡：音标、柯林斯星级、牛津、标签、中英文释义、词形变化 |
| 2 | 前缀搜索 | 输入 `hap` 回车 | 主词条 + 相近词条列表，常用词在前 |
| 3 | 拼写纠错 | 输入 `happpy`（多一个 p） | 提示并返回 happy（编辑距离 ≤ 2） |
| 4 | 中文反向 | 输入 `你好` 回车 | 列表命中行高亮「你好」，点击进入详情 |
| 5 | 中文短词 | 输入 `好` 回车 | 正常返回（后端走全表扫描，稍慢可接受） |
| 6 | 联想 | 输入 `ha` 停 300ms | 联想浮层：have/hand/happen…，点击联想直接搜索 |
| 7 | 联想竞态 | 快速连续输入 `h`→`he`→`hel` | 联想结果始终对应最后一次输入 |
| 8 | 语义搜索 | 输入 `形容坚持不懈` 点「语义」 | 结果列表带相似度标签；向量库缺失时提示不可用 |
| 9 | 同近义词 | 详情页点「同近义词」 | 返回近义词列表，点击页内切换词条 |
| 10 | 发音 | 详情页点美音/英音 | 播放对应口音音频；快速连点不叠加 |
| 11 | 分页 | 中文搜索大词条（如 `的`）上滑 | 列表持续加载至 `total`，末尾停止 |
| 12 | 深色模式 | 系统切换深色 | 页面背景/卡片/文字跟随变化 |
| 13 | 错误态 | 断网 / 后端停止 | 提示「网络异常，请稍后重试」，不白屏 |
| 14 | 分享 | 详情页右上角分享 | 分享卡片打开后直达该词详情 |

---

## 10. 待确认事项

1. **线上域名**：小程序正式版请求地址沿用 `www.stringandstick.cn/dict/api` 即可（域名已备案、已上 HTTPS），无需为小程序单独开新域名。
2. **收藏/生词本**：本期不做；若后续需要，可加本地 `wx.storage` 实现，无需后端改动。
