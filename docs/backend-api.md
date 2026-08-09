# 智能中英词典 · 后端接口文档（微信小程序版）

> 适用服务：FastAPI（`main.py`）。接口路径与现有 Web 版**完全一致，后端零改动**即可服务小程序。
> 示例数据均为真实词库（ECDICT）查询结果。

---

## 1. 服务信息

| 项目 | 说明 |
|------|------|
| 服务框架 | FastAPI + uvicorn（Python 3.10+） |
| 线上入口 | `https://www.stringandstick.cn/dict/`（nginx 剥离 `/dict/` 前缀后反代到后端） |
| 接口前缀 | `/api/...`（线上完整路径如 `https://www.stringandstick.cn/dict/api/search`） |
| 本地开发 | `http://127.0.0.1:3000/api/...`（`python main.py`，端口可用 `DICT_PORT` 覆盖） |
| 协议 | HTTPS（小程序强制要求）、GET、JSON、UTF-8 |
| 数据源 | SQLite + FTS5（77 万词条）；语义检索为 sqlite-vec 向量库 + 云端 Embedding API |

**小程序 baseUrl 建议**

- 线上：`https://www.stringandstick.cn/dict/api`（后台 request 合法域名填 `www.stringandstick.cn`，路径任意）
- 开发：`http://127.0.0.1:3000/api`（开发者工具需勾选「不校验合法域名」）

---

## 2. 通用约定

- 所有接口为 GET，参数经 URL Query 传递，值需 URL 编码（`encodeURIComponent`）。
- 成功：HTTP 200，响应体为 JSON 对象，**无外层包裹**。
- 失败：
  - `422` 参数校验失败（FastAPI 默认格式 `{"detail": [...]}`），如 `q` 为空、`limit` 越界；
  - `503` 向量服务不可用或词条不存在，响应体 `{"error": "人类可读原因"}`；
  - 网络层失败（超时/断网）无 HTTP 状态码，由小程序端统一提示。
- 分页：`limit`（每页条数）+ `offset`（偏移量）。注意 3.1 节对英文搜索 `total` 的说明。
- 编码与换行：`translation` / `definition` 由后端归一化为**行数组**（真实换行已拆分），前端可直接渲染；但语义接口的 `text` 字段为原样透传，其中换行可能以**字面 `\n`（反斜杠 + n 两个字符）**存储，渲染前必须 `replace(/\\n/g, '\n')` 再拆分。

---

## 3. 接口明细

### 3.1 `GET /api/search` 关键词搜索

**功能**：自动识别中英文并返回匹配词条。这是小程序的主查询接口。

**参数**

| 参数 | 必填 | 类型 | 默认 | 范围 | 说明 |
|------|------|------|------|------|------|
| `q` | 是 | string | - | 长度 ≥ 1 | 英文单词 / 中文释义，自动识别 |
| `limit` | 否 | int | 20 | 1 ~ 100 | 每页条数 |
| `offset` | 否 | int | 0 | ≥ 0 | 分页偏移 |

**行为细节**

- 英文查询：
  1. **精确匹配**（`sw = q` 小写），排在最前；
  2. **前缀匹配**（`sw LIKE 'q%'`），按 `(frq=0), frq, bnc` 排序（常用词优先）；
  3. **模糊纠错**：仅当精确未命中且 `q` 长度 ≥ 3 时执行，取前 3 字符前缀的至多 500 条候选做编辑距离过滤（距离 ≤ 2 者入选）；
  4. 合并排序：`(是否无词频, 编辑距离, frq, bnc)`。
- 中文查询（释义反向检索）：
  - `q` 长度 ≥ 3：FTS5 trigram 子串匹配（索引查询，快）；
  - `q` 长度 1 ~ 2：LIKE 全表扫描（77 万行，**响应相对较慢**，前端可加提示）；
  - 排序同 `(frq=0), frq, bnc`。
- **`total` 语义**：中文搜索为真实命中总数；**英文搜索为候选集大小**（受内部取数窗口限制：前缀最多 `limit+offset+50` 条 + 模糊最多 500 条），分页超出该窗口后无更多数据。
- 英文查询时 `results[0]` 即最精确匹配的词条，详情页可直接取用；`results[1:]` 为相近词条。

**请求示例**

```bash
curl -s 'https://www.stringandstick.cn/dict/api/search?q=happy&limit=2&offset=0'
```

**响应示例（真实数据）**

```json
{
  "query": "happy",
  "total": 20,
  "offset": 0,
  "results": [
    {
      "word": "happy",
      "phonetic": "'hæpi",
      "pos": "",
      "definition": [
        "a. enjoying or showing or marked by joy or pleasure",
        "s. well expressed and to the point"
      ],
      "translation": ["a. 快乐的, 幸福的, 愉快的, 恰当的"],
      "collins": 4,
      "oxford": 1,
      "tag": "zk gk",
      "bnc": 777,
      "frq": 747,
      "exchange": {"er": ["happier"], "est": ["happiest"]}
    },
    {
      "word": "happy camper",
      "phonetic": "",
      "pos": "",
      "definition": [],
      "translation": ["快乐的人；乐天派"],
      "collins": 0,
      "oxford": 0,
      "tag": "",
      "bnc": 0,
      "frq": 0,
      "exchange": {}
    }
  ]
}
```

中文查询示例（真实数据）：`/api/search?q=你好` 返回 `total: 16`，首条为 `{"word": "ciao", "phonetic": "tʃau", ..., "translation": ["int. （意）你好；再见（见面问候语或告别语）"], ...}`。

**词条字段说明（`results[]`）**

| 字段 | 类型 | 说明 |
|------|------|------|
| `word` | string | 单词（可能含空格，如 `happy camper`） |
| `phonetic` | string | 音标（可能为空字符串） |
| `pos` | string | 词性（可能为空） |
| `definition` | string[] | 英文释义，行数组 |
| `translation` | string[] | 中文释义，行数组 |
| `collins` | int | 柯林斯星级 0~5，0 = 未收录 |
| `oxford` | int | 0/1，是否牛津核心词汇 |
| `tag` | string | 空格分隔的考试标签：`zk` `gk` `cet4` `cet6` `ky` `toefl` `ielts` `gre` |
| `bnc` | int | BNC 词频排名，0 = 无 |
| `frq` | int | 词频等级（越小越常用），0 = 无 |
| `exchange` | object | 词形变化，key ∈ `pl` `third` `past` `done` `ing` `er` `est`（兼容 JSON 格式 `comparative`/`superlative`），value 为字符串数组 |

---

### 3.2 `GET /api/suggest` 自动补全

**功能**：输入联想。英文按前缀补全，中文按释义前缀补全。

**参数**

| 参数 | 必填 | 类型 | 默认 | 范围 | 说明 |
|------|------|------|------|------|------|
| `q` | 是 | string | - | 长度 ≥ 1 | 补全前缀 |
| `limit` | 否 | int | 10 | 1 ~ 20 | 返回条数（前端建议 8） |

**行为细节**：英文大小写不敏感前缀匹配；中文匹配 `translation` 以 `q` 开头的词条；均按 `(frq=0), frq, bnc` 排序。`hint` 为词条翻译首行（截断至 26 字符），用作联想预览。

**请求示例**

```bash
curl -s 'https://www.stringandstick.cn/dict/api/suggest?q=ha&limit=5'
```

**响应示例（真实数据）**

```json
{
  "prefix": "ha",
  "suggestions": [
    {"word": "have", "hint": "vt. 有, 怀有, 拿, 进行"},
    {"word": "hand", "hint": "n. 手, 爪, 指针, 掌握, 协助, 人手, 手…"},
    {"word": "happen", "hint": "vi. 发生, 发生, 恰巧"},
    {"word": "hard", "hint": "a. 坚硬的, 硬的, 难的, 艰苦的, 困难的, …"},
    {"word": "half", "hint": "n. 一半, 半场, 不完全"}
  ]
}
```

---

### 3.3 `GET /api/semantic` 语义搜索（反向词典）

**功能**：输入中文/英文描述（如「形容坚持不懈」），返回语义最接近的单词。

**参数**

| 参数 | 必填 | 类型 | 默认 | 范围 | 说明 |
|------|------|------|------|------|------|
| `q` | 是 | string | - | 长度 ≥ 1 | 描述文本 |
| `limit` | 否 | int | 10 | 1 ~ 50 | 返回条数 |

**行为细节**：查询文本经云端 Embedding API（bge-m3 / 1024 维）编码后做向量 kNN 检索。**向量库缺失或 Embedding API 未配置时返回 503** `{"error": "..."}`，前端需据此降级提示。`distance` 为向量距离（归一化余弦距离，0 ~ 2，越小越相似）；相似度百分比换算（与 Web 版一致）：

```
相似度 % = max(0, round(100 × (1 − distance / 2)))
```

**响应示例（结构示意，`distance` 为示意值）**

```json
{
  "query": "形容坚持不懈",
  "results": [
    {
      "word": "persevere",
      "text": "persevere\nvi. 坚持；不屈不挠",
      "frq": 13911,
      "collins": 1,
      "oxford": 0,
      "bnc": 12133,
      "tag": "",
      "distance": 0.83
    }
  ]
}
```

**`results[]` 字段说明**

| 字段 | 类型 | 说明 |
|------|------|------|
| `word` | string | 单词 |
| `text` | string | 词条文本：**首行为单词本身**，其后为释义；可能含字面 `\n`，渲染前需归一化 |
| `frq` / `collins` / `oxford` / `bnc` / `tag` | - | 同 3.1 词条字段 |
| `distance` | number | 向量距离，越小越相似 |

---

### 3.4 `GET /api/similar` 同近义词推荐

**功能**：与指定单词语义最相近的词条（自动排除自身），按距离升序。

**参数**

| 参数 | 必填 | 类型 | 默认 | 范围 | 说明 |
|------|------|------|------|------|------|
| `word` | 是 | string | - | 长度 ≥ 1 | 英文单词 |
| `limit` | 否 | int | 10 | 1 ~ 50 | 返回条数 |

**行为细节**：内部先从主词库取该词的释义文本构造嵌入，再向量检索。**`word` 不在词库中时返回 503** `{"error": "词库中未找到单词：xxx"}`；向量库/API 未就绪同样返回 503。详情页场景（已确认词存在）调用天然满足前置条件。

**响应示例（结构示意）**

```json
{
  "word": "happy",
  "results": [
    {
      "word": "glad",
      "text": "glad\na. 高兴的，乐意的",
      "frq": 3019,
      "collins": 3,
      "oxford": 1,
      "bnc": 2301,
      "tag": "zk gk",
      "distance": 0.42
    }
  ]
}
```

---

### 3.5 发音资源（有道公开接口，非本项目 API）

```
https://dict.youdao.com/dictvoice?audio={word}&type={1|2}
```

- `type=1` 美音，`type=2` 英音；GET 直接返回音频。
- 非本项目自有服务，不保证长期可用（Web 版同样依赖，已将其列为已知风险）。
- **小程序接入**：`dict.youdao.com` 需加入「downloadFile 合法域名」（`wx.createInnerAudioContext` 播放走 downloadFile 校验）。

---

## 4. 错误码汇总

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 200 | 成功 | 接口对应 JSON |
| 422 | 参数缺失/越界（`q` 为空、`limit` 超限等） | `{"detail": [...]}` |
| 503 | 向量库未建立 / Embedding API 未配置 / `similar` 词条不存在 | `{"error": "原因"}` |

无 HTTP 状态码的情况（超时、断网）由小程序端统一提示「网络异常，请稍后重试」。

---

## 5. 小程序接入注意事项

1. **合法域名**：request 合法域名填 `www.stringandstick.cn`（HTTPS）；downloadFile 合法域名填 `dict.youdao.com`（发音）。均在小程序后台「开发管理 → 服务器域名」配置，配置后约 5 分钟生效；开发阶段可在开发者工具勾选「不校验合法域名」。
2. **HTTPS**：小程序强制 HTTPS，现有 nginx 已配置证书，无需改动。
3. **无 CORS 限制**：小程序请求不受浏览器同源策略约束，后端无需增加跨域配置。
4. **响应体积**：`search` 每页 20 条词条含全文释义，单响应一般 < 100KB；详情页只需第一页即可。
5. **请求频率**：联想接口务必 300ms 防抖（与 Web 版一致），并做竞态防护（只采纳最后一次输入的结果）。
6. **可选缓存**：联想结果与词条详情可本地缓存 5 ~ 10 分钟，减少请求量（词库静态，数据稳定）。
7. **慢查询提示**：1 ~ 2 字中文查询走全表扫描较慢，前端可酌情提示。

---

## 6. 可选的后端增强（不阻塞改造）

| 增强 | 动机 | 工作量 |
|------|------|--------|
| 新增 `GET /api/word?word=` 精确详情接口 | 目前详情页需取 `search` 的 `results[0]`，语义不纯粹且可能带纠错结果 | 极小（约 10 行） |
| 中文 1~2 字查询性能优化 | 当前全表扫描，弱网/大库下体验差 | 中（需建冗余索引或分词方案） |
| `search` 响应缓存（内存 LRU） | 高频热词重复查询 | 小 |

以上均非必需，建议先按现有接口完成小程序，视体验再迭代。
