const { getProviderConfig, hasProviderConfig } = require("./lib/ai-provider");

const RESPONSES_TIMEOUT_MS = 60000;
const DEFAULT_QUERY = "得宝卷纸 618 补贴 到手价";

exports.handler = async function (event) {
  const startedAt = Date.now();
  const query = getQuery(event);
  const config = getProviderConfig();

  if (!hasProviderConfig(config)) {
    return jsonResponse(200, buildDebugResult({
      ok: false,
      query,
      source: "config_error",
      isFallback: false,
      stage: "backend_responses_request",
      status: null,
      errorName: "MissingEnvironment",
      errorMessage: "AI provider env vars are missing or incomplete.",
      timeMs: Date.now() - startedAt
    }));
  }

  try {
    const result = await callFormalSearchResponses({
      query,
      input: buildResponsesInput(query)
    });
    const timeMs = Date.now() - startedAt;

    return jsonResponse(200, buildDebugResult({
      ok: true,
      query,
      source: "real_ai",
      isFallback: false,
      stage: "success",
      status: 200,
      errorName: "",
      errorMessage: "",
      timeMs,
      parsedSample: sampleParsed(result.parsed),
      rawSample: sampleText(result.rawText)
    }));
  } catch (error) {
    return jsonResponse(200, buildDebugResult({
      ok: false,
      query,
      source: "error",
      isFallback: false,
      stage: error.stage || "backend_responses_request",
      status: error.status || null,
      errorName: error.name || "RequestError",
      errorMessage: sanitizeErrorMessage(error.message || String(error)),
      timeMs: Date.now() - startedAt,
      rawSample: sampleText(error.rawText || "")
    }));
  }
};

async function callFormalSearchResponses({ input }) {
  const config = getProviderConfig();
  const response = await fetch(buildResponsesUrl(config.baseUrl), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      input,
      tools: [{ type: "web_search" }],
      temperature: 0.15
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
    parseError.stage = "parse_response";
    parseError.status = response.status;
    parseError.rawText = text;
    throw parseError;
  }

  const rawText = extractResponsesText(payload);
  try {
    return {
      parsed: parseAiJson(rawText),
      rawText
    };
  } catch (error) {
    error.status = response.status;
    error.rawText = rawText;
    throw error;
  }
}

function getQuery(event) {
  const fromParams = event && event.queryStringParameters && event.queryStringParameters.q;
  if (fromParams) return String(fromParams).trim();

  try {
    const rawUrl = event && event.rawUrl ? event.rawUrl : "";
    const parsed = rawUrl ? new URL(rawUrl) : null;
    const q = parsed && parsed.searchParams.get("q");
    if (q) return q.trim();
  } catch (error) {
    // Netlify usually provides queryStringParameters; rawUrl parsing is only a backup.
  }

  return DEFAULT_QUERY;
}

function buildDebugResult({
  ok,
  query,
  source,
  isFallback,
  stage,
  status,
  errorName,
  errorMessage,
  timeMs,
  rawSample = "",
  parsedSample = null
}) {
  return {
    ok,
    query,
    source,
    apiMode: "responses",
    searchEnabled: true,
    extractorEnabled: false,
    isFallback,
    stage,
    status,
    errorName,
    errorMessage,
    timeoutMs: RESPONSES_TIMEOUT_MS,
    timeMs,
    rawSample,
    parsedSample
  };
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
  error.stage = "backend_responses_request";
  error.status = response.status;
  error.errorCode = details.code || String(response.status);
  error.providerErrorCode = details.code || "";
  error.providerErrorMessage = sanitizeErrorMessage(details.message || response.statusText || "");
  error.rawText = text;
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
    error.stage = "parse_response";
    throw error;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      const parseError = new Error("Parse error: AI response was not JSON");
      parseError.name = "ParseError";
      parseError.stage = "parse_response";
      throw parseError;
    }
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      const parseError = new Error("Parse error: failed to parse extracted JSON");
      parseError.name = "ParseError";
      parseError.stage = "parse_response";
      throw parseError;
    }
  }
}

function buildResponsesInput(query) {
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

function sampleText(text) {
  const safe = sanitizeErrorMessage(text || "");
  return safe.length > 1200 ? `${safe.slice(0, 1200)}...` : safe;
}

function sampleParsed(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed || null;
  const items = Array.isArray(parsed.items) ? parsed.items.slice(0, 2) : [];
  return {
    keyword: parsed.keyword || parsed.query || "",
    summary: parsed.summary || "",
    itemCount: Array.isArray(parsed.items) ? parsed.items.length : 0,
    items
  };
}

function sanitizeErrorMessage(message) {
  return String(message || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
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
