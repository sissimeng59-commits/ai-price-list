const { searchPrice } = require("./mock-data");
const { getDebugInfo, requestJson } = require("./lib/ai-provider");

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
      const aiResult = await requestJson({
        systemPrompt: buildSearchSystemPrompt(),
        userPrompt: JSON.stringify({
          query,
          originalInput: body.originalInput || "",
          selectedOption: body.selectedOption || null
        }),
        temperature: 0.15
      });

      if (aiResult) {
        return jsonResponse(200, withDebug(normalizeSearchResult(aiResult, query), {
          source: "real_ai",
          isFallback: false
        }));
      }
    } catch (error) {
      console.warn("AI price search failed. Falling back to mock data:", error.message);
      return jsonResponse(200, withDebug(mockSearchForApi(query, body), {
        source: "mock_fallback",
        isFallback: true,
        errorMessage: error.message
      }));
    }

    return jsonResponse(200, withDebug(mockSearchForApi(query, body), {
      source: "mock_fallback",
      isFallback: true,
      errorMessage: "AI provider env vars are missing or incomplete."
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

function buildSearchSystemPrompt() {
  return [
    "你是一个中文 AI 购物补贴价整理助手。",
    "你只输出 JSON，不要 Markdown，不要解释，不要代码块。",
    "字段必须完整。",
    "如果不确定价格，返回价格区间，并在 advice 中提醒需打开页面确认。",
    "不要编造确定商品链接。link 可以为空字符串，或提供平台搜索页 searchUrl。",
    "输出 JSON 结构：",
    "{",
    "  \"title\": \"价格对比结果\",",
    "  \"summary\": \"首选京东，物流快，售后稳；追求低价可看拼多多。\",",
    "  \"items\": [",
    "    {",
    "      \"platform\": \"京东\",",
    "      \"tag\": \"推荐\",",
    "      \"price\": \"¥74.9–¥79.9\",",
    "      \"spec\": \"27卷装\",",
    "      \"unitPrice\": \"¥2.77–¥2.96/卷\",",
    "      \"discount\": \"PLUS会员95折 + 满减 + 品牌券\",",
    "      \"advice\": \"物流快，售后好\",",
    "      \"link\": \"\",",
    "      \"searchUrl\": \"\",",
    "      \"linkText\": \"打开看看\"",
    "    }",
    "  ],",
    "  \"disclaimer\": \"AI 查询价仅供参考，最终以打开页面为准。\"",
    "}",
    "items 返回 3-4 个平台，优先包括京东、天猫/淘宝、拼多多；生活用品可以包括线下商超。"
  ].join("\n");
}

function normalizeSearchResult(result, query) {
  const items = Array.isArray(result.items) ? result.items.map(normalizeItem).filter(Boolean) : [];
  return {
    title: String(result.title || "价格对比结果"),
    summary: String(result.summary || "先看综合体验，再对比低价平台。"),
    query,
    items: items.length ? items : mockSearchForApi(query, { keyword: query }).items,
    disclaimer: String(result.disclaimer || result.notice || "AI 查询价仅供参考，最终以打开页面为准。")
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
    price: String(item.price || item.estimatedPrice || "需打开页面确认"),
    spec: String(item.spec || "需确认规格"),
    unitPrice: String(item.unitPrice || "按规格确认"),
    discount: String(item.discount || "需打开页面确认"),
    advice: String(item.advice || item.suggestion || "价格和店铺资质需打开页面确认。"),
    linkText: String(item.linkText || "打开看看"),
    link: searchUrl,
    searchUrl
  };
}

function mockSearchForApi(query, body) {
  const legacy = searchPrice(Object.assign({}, body, { keyword: query }));
  return legacySearchToApi(legacy, query);
}

function legacySearchToApi(result, query) {
  return normalizeSearchResult({
    title: "价格对比结果",
    summary: buildSummary(result.items || []),
    query,
    items: (result.items || []).map((item, index) => ({
      platform: item.platform,
      tag: index === 0 ? "推荐" : item.platform.includes("拼多多") ? "低价" : "",
      price: item.estimatedPrice,
      spec: item.spec,
      unitPrice: item.unitPrice,
      discount: item.discount,
      advice: item.suggestion,
      link: item.url,
      searchUrl: item.url,
      linkText: "打开看看"
    })),
    disclaimer: result.notice
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
