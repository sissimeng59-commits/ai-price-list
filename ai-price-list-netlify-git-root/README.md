# AI 查价清单

一个极简的 AI 购物任务推进器 v0.5。用户输入“我想买什么”，系统先判断购物阶段，再把模糊需求推进到“可以查价 / 可以下单”的状态。

第一版使用 mock 数据，前端可以直接打开预览；部署到 Netlify 后会通过 Netlify Functions 作为后端 API 预留层。

## 项目结构

```text
index.html
style.css
app.js
netlify/functions/analyze-shopping.js
netlify/functions/search-price.js
netlify/functions/mock-data.js
netlify/functions/lib/ai-provider.js
netlify.toml
README.md
```

## 本地打开

最简单方式：直接双击 `index.html`，或在浏览器打开这个文件。

这种方式不会启动 Netlify Functions，前端会自动使用本地 mock 逻辑兜底，方便快速试流程。

如需本地测试 Netlify Functions：

```bash
npx netlify dev
```

然后打开 Netlify CLI 给出的本地地址。

## 部署到 Netlify

1. 把本项目推到 Git 仓库。
2. 在 Netlify 新建站点并连接该仓库。
3. 构建设置保持简单：
   - Build command 留空
   - Publish directory 填 `.`
   - Functions directory 使用 `netlify/functions`
4. 部署后，前端会调用：
   - `/.netlify/functions/analyze-shopping`
   - `/.netlify/functions/search-price`

## Mock 规则

`analyze-shopping.js` 当前通过 `mock-data.js` 返回三种状态：

- 输入包含“得宝”：`direct_price_search`
- 输入包含“卷纸”但不包含具体品牌：`need_recommendation`
- 输入包含“婴儿车”：`need_questions`
- 其他输入默认：`need_recommendation`

查价接口会返回京东、天猫/淘宝、拼多多、线下商超等 mock 价格结果，并统一提示：

> AI 查询价仅供参考，最终以打开页面为准。

## 接入真实 AI API

不要把 API Key 写在前端，也不要放进 `app.js`、`index.html` 或任何会被浏览器下载的文件。

当前后端已预留 OpenAI-compatible provider adapter。Netlify Functions 会优先读取环境变量调用真实模型；如果环境变量缺失或调用失败，会自动回退到 mock 数据。

Netlify 后台需要添加：

- `AI_PROVIDER`：可填 `qwen`、`doubao` 或 `openai-compatible`，仅用于标识。
- `AI_API_KEY`：模型服务的 API Key。
- `AI_API_BASE_URL`：OpenAI-compatible API base URL，例如以 `/v1` 或 `/api/v3` 结尾的地址。
- `AI_MODEL`：要调用的模型名称。

当前 API 调用方式：

- `analyze-shopping`：普通 `chat_completions`，用于判断需求类型。
- `search-price`：`responses`，用于联网搜索并整理价格结果。
- `search-price` 会传入 `web_search` 和 `web_extractor` 工具。
- `model`：来自 `AI_MODEL` 环境变量，没有写死默认模型。

如果 `AI_MODEL=qwen3.6-flash` 在 Responses API + `web_search` 下不兼容，`search-price` 会 fallback 到 mock，并在 debug 里返回具体错误。可以在 Netlify 环境变量里把 `AI_MODEL` 改成支持 Responses API + 联网搜索工具的模型，例如 `qwen3.6-plus` 或百炼文档中标明支持该能力的模型。

函数入口：

- `/.netlify/functions/analyze-shopping`：判断 `direct_price_search` / `need_recommendation` / `need_questions`。
- `/.netlify/functions/search-price`：根据 query 返回结构化价格对比结果。

安全提醒：API Key 只能放在 Netlify 环境变量里，不能放进前端、localStorage 或仓库文件。

## 本地数据

购物任务保存在浏览器 `localStorage` 中。每条任务包含：

- `id`
- `createdAt`
- `originalInput`
- `status`
- `analysisResult`
- `selectedOption`
- `priceResults`
- `checklistStatus`
- `notes`

可以点击页面右上角“历史记录”，再点击“导出 JSON”备份全部任务。
