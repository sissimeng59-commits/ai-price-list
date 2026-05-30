const { searchPrice } = require("./mock-data");
const { getDebugInfo, getProviderConfig, hasProviderConfig } = require("./lib/ai-provider");

const RESPONSES_TIMEOUT_MS = 60000;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const query = String(body.query || body.keyword || "").trim();

    if (!query) {
      return jsonResponse(400, { error: "query is required" });
    }

    try {
      const aiResult = await callSearchResponses({
        input: buildResponsesInput({
          query,
          originalInput: body.originalInput || "",
          selectedOption: body.selectedOption || null
        }),
        tools: [
          { type: "web_search" }
        ],
        temperature: 0.15,
        timeoutMs: RESPONSES_TIMEOUT_MS
      });

      if (aiResult) {
        return jsonResponse(200, withDebug(normalizeSearchResult(aiResult, query), {
          source: "real_ai",
          isFallback: false,
          apiMode: "responses",
          searchEnabled: true,
          extractorEnabled: false,
          timeoutMs: RESPONSES_TIMEOUT_MS
        }));
      }
    } catch (error) {
      const errorDebug = buildErrorDebug(error);
      console.error("AI price search failed. Falling back to mock data:", errorDebug);
      return jsonResponse(200, withDebug(mockSearchForApi(query, body), {
        source: "mock_fallback",
        isFallback: true,
        apiMode: "responses",
        searchEnabled: true,
        extractorEnabled: false,
        timeoutMs: RESPONSES_TIMEOUT_MS,
        errorMessage: errorDebug.errorMessage,
        status: errorDebug.status,
        errorName: errorDebug.errorName,
        errorCode: errorDebug.errorCode,
        providerErrorCode: errorDebug.providerErrorCode,
        providerErrorMessage: errorDebug.providerErrorMessage
      }));
    }

    return jsonResponse(200, withDebug(mockSearchForApi(query, body), {
      source: "mock_fallback",
      isFallback: true,
      apiMode: "responses",
      searchEnabled: false,
      extractorEnabled: false,
      timeoutMs: RESPONSES_TIMEOUT_MS,
      errorMessage: "AI provider env vars are missing or incomplete.",
      status: null
    }));
  } catch (error) {
    console.warn("Search function failed. Falling back when possible:", error.message);
    return jsonResponse(500, { error: "Failed to search price" });
  }
};

function withDebug(payload, debugOptions) {
  const debug = getDebugInfo(debugOptions);
  return Object.assign(payload, debug, { debug });
}

function buildErrorDebug(error) {
  return {
    status: error.status || null,
    errorName: error.name || "",
    errorCode: error.errorCode || "",
    providerErrorCode: error.providerErrorCode || "",
    providerErrorMessage: sanitizeErrorMessage(error.providerErrorMessage || ""),
    errorMessage: sanitizeErrorMessage(error.message || String(error))
  };
}

async function callSearchResponses({ input, tools, temperature }) {
  const config = getProviderConfig();
  if (!hasProviderConfig(config)) return null;

  const response = await fetch(buildResponsesUrl(config.baseUrl), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      input,
      tools,
      temperature
    }),
    signal: timeoutSignal(RESPONSES_TIMEOUT_MS)
  });

  const text = await response.text();
  if (!response.ok) {
    throw buildHttpError(response, text);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    const parseError = new Error("Parse error: Responses API returned non-JSON payload");
    parseError.name = "ParseError";
    throw parseError;
  }

  return parseAiJson(extractResponsesText(payload));
}

function buildHeaders(config) {
  return {
    "Authorization": `Bearer ${config.apiKey}`,
    "Content-Type": "application/json"
  };
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController();
  setTimeout(function () {
    controller.abort();
  }, timeoutMs);
  return controller.signal;
}

function buildResponsesUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/responses$/.test(normalized)) return normalized;
  if (/\/chat\/completions$/.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/, "/responses");
  }
  return `${normalized}/responses`;
}

function buildHttpError(response, text) {
  const details = parseProviderError(text);
  const error = new Error(sanitizeErrorMessage(details.message || text || response.statusText));
  error.name = "HttpError";
  error.status = response.status;
  error.errorCode = details.code || String(response.status);
  error.providerErrorCode = details.code || "";
  error.providerErrorMessage = sanitizeErrorMessage(details.message || response.statusText || "");
  return error;
}

function parseProviderError(text) {
  try {
    const payload = JSON.parse(text || "{}");
    const error = payload.error && typeof payload.error === "object" ? payload.error : payload;
    return {
      code: error.code || error.errorCode || error.error_code || "",
      message: error.message || error.errorMessage || error.msg || text || ""
    };
  } catch (error) {
    return { code: "", message: text || "" };
  }
}

function extractResponsesText(payload) {
  if (!payload) return "";
  if (payload.output_text) return payload.output_text;
  if (payload.text && typeof payload.text === "string") return payload.text;
  if (payload.output && Array.isArray(payload.output)) {
    return payload.output.map((item) => {
      if (item.type === "message" && Array.isArray(item.content)) {
        return item.content.map((content) => content.text || content.output_text || "").join("");
      }
      if (Array.isArray(item.content)) {
        return item.content.map((content) => content.text || content.output_text || "").join("");
      }
      return item.text || item.output_text || "";
    }).join("");
  }
  if (payload.choices && payload.choices[0] && payload.choices[0].message) {
    return payload.choices[0].message.content || "";
  }
  return "";
}

function parseAiJson(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    const error = new Error("Parse error: empty AI response text");
    error.name = "ParseError";
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      const parseError = new Error("Parse error: AI response was not JSON");
      parseError.name = "ParseError";
      throw parseError;
    }
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      const parseError = new Error("Parse error: failed to parse extracted JSON");
      parseError.name = "ParseError";
      throw parseError;
    }
  }
}

function sanitizeErrorMessage(message) {
  return String(message || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
}

function buildResponsesInput({ query, originalInput, selectedOption }) {
  const searchQuery = `${query} 京东 天猫 淘宝 拼多多 到手价 618 补贴`;
  return [
    "你是一个中文 AI 购物补贴价联网搜索整理助手。",
    "请使用 web_search 搜索最新公开网页信息。本轮不要使用 web_extractor。",
    "搜索重点平台：京东、天猫/淘宝、拼多多；线下商超如有参考价值再返回。",
    "不要编造确定价格。搜索结果不确定时使用价格区间，并在 discount 或 suggestion 中说明券、会员、地区、活动变化会影响价格。",
    "不要编造确定商品链接。拿不到具体商品链接时，返回平台搜索页或平台首页搜索 URL。",
    "只输出 JSON，不要 Markdown，不要解释，不要代码块。",
    `用户查价 query：${query}`,
    `建议搜索词：${searchQuery}`,
    `用户原始需求：${originalInput || ""}`,
    `用户已选方向：${JSON.stringify(selectedOption || {})}`,
    "必须返回以下 JSON 结构，字段名不要改变：",
    "{",
    "  \"keyword\": \"用户查价 query\",",
    "  \"notice\": \"AI 查询价仅供参考，最终以打开页面为准。\",",
    "  \"summary\": \"首选京东，物流快，售后稳；追求低价可看拼多多。\",",
    "  \"items\": [",
    "    {",
    "      \"platform\": \"京东\",",
    "      \"tag\": \"推荐\",",
    "      \"spec\": \"27卷装\",",
    "      \"estimatedPrice\": \"¥74.9–¥79.9\",",
    "      \"unitPrice\": \"¥2.77–¥2.96/卷 或 按规格确认\",",
    "      \"discount\": \"PLUS会员95折 + 满减 + 品牌券\",",
    "      \"suggestion\": \"物流快，售后好；需打开页面确认最终券后价。\",",
    "      \"url\": \"https://...\",",
    "      \"linkText\": \"打开看看\",",
    "      \"needManualConfirm\": true",
    "    }",
    "  ],",
    "  \"debug\": {}",
    "}",
    "items 返回 3-4 个平台。每个平台只返回一行摘要，不要输出长段说明。"
  ].join("\n");
}

function normalizeSearchResult(result, query) {
  const items = Array.isArray(result.items) ? result.items.map(normalizeItem).filter(Boolean) : [];
  return {
    keyword: String(result.keyword || result.query || query),
    notice: String(result.notice || result.disclaimer || "AI 查询价仅供参考，最终以打开页面为准。"),
    summary: String(result.summary || "先看综合体验，再对比低价平台。"),
    items: items.length ? items : mockSearchForApi(query, { keyword: query }).items,
  };
}

function normalizeItem(item) {
  if (!item) return null;
  const platform = String(item.platform || "").trim();
  if (!platform) return null;
  const searchUrl = String(item.searchUrl || item.link || item.url || platformSearchUrl(platform));
  return {
    platform,
    tag: String(item.tag || ""),
    spec: String(item.spec || "需确认规格"),
    estimatedPrice: String(item.estimatedPrice || item.price || "需打开页面确认"),
    unitPrice: String(item.unitPrice || "按规格确认"),
    discount: String(item.discount || "需打开页面确认"),
    suggestion: String(item.suggestion || item.advice || "价格和店铺资质需打开页面确认。"),
    url: searchUrl,
    linkText: String(item.linkText || "打开看看"),
    needManualConfirm: item.needManualConfirm === undefined ? true : Boolean(item.needManualConfirm)
  };
}

function mockSearchForApi(query, body) {
  const legacy = searchPrice(Object.assign({}, body, { keyword: query }));
  return legacySearchToApi(legacy, query);
}

function legacySearchToApi(result, query) {
  return normalizeSearchResult({
    keyword: query,
    notice: result.notice,
    summary: buildSummary(result.items || []),
    items: (result.items || []).map((item, index) => ({
      platform: item.platform,
      tag: index === 0 ? "推荐" : item.platform.includes("拼多多") ? "低价" : "",
      estimatedPrice: item.estimatedPrice,
      spec: item.spec,
      unitPrice: item.unitPrice,
      discount: item.discount,
      suggestion: item.suggestion,
      url: item.url,
      linkText: "打开看看",
      needManualConfirm: true
    }))
  }, query);
}

function buildSummary(items) {
  const top = items[0];
  const pdd = items.find((item) => String(item.platform || "").includes("拼多多"));
  if (top && String(top.platform || "").includes("京东") && pdd) {
    return "首选京东，物流快，售后稳；追求低价可看拼多多。";
  }
  if (top) return `首选${top.platform}，下单前确认规格、券后价和店铺资质。`;
  return "先看综合体验，再对比低价平台。";
}

function platformSearchUrl(platform) {
  if (platform.includes("京东")) return "https://www.jd.com/";
  if (platform.includes("天猫") || platform.includes("淘宝")) return "https://www.taobao.com/";
  if (platform.includes("拼多多")) return "https://www.pinduoduo.com/";
  return "https://www.baidu.com/";
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}
