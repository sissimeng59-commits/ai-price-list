const { analyzeShopping } = require("./mock-data");
const { getDebugInfo, requestJson } = require("./lib/ai-provider");

const ALLOWED_TYPES = new Set([
  "direct_price_search",
  "need_recommendation",
  "need_questions"
]);

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method Not Allowed" });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const text = String(body.text || body.input || "").trim();

    if (!text) {
      return jsonResponse(400, { error: "text is required" });
    }

    try {
      const aiResult = await requestJson({
        systemPrompt: buildAnalyzeSystemPrompt(),
        userPrompt: JSON.stringify({ text })
      });

      if (aiResult) {
        return jsonResponse(200, withDebug(normalizeAnalyzeResult(aiResult, text), {
          source: "real_ai",
          isFallback: false
        }));
      }
    } catch (error) {
      console.warn("AI analyze failed. Falling back to mock data:", error.message);
      return jsonResponse(200, withDebug(mockAnalyzeForApi(text), {
        source: "mock_fallback",
        isFallback: true,
        errorMessage: error.message
      }));
    }

    return jsonResponse(200, withDebug(mockAnalyzeForApi(text), {
      source: "mock_fallback",
      isFallback: true,
      errorMessage: "AI provider env vars are missing or incomplete."
    }));
  } catch (error) {
    console.warn("Analyze function failed. Falling back when possible:", error.message);
    return jsonResponse(500, { error: "Failed to analyze shopping input" });
  }
};

function buildAnalyzeSystemPrompt() {
  return [
    "你是一个中文 AI 购物任务分析器。",
    "你只输出 JSON，不要 Markdown，不要解释，不要代码块。",
    "字段必须完整。",
    "type 只能是 direct_price_search、need_recommendation、need_questions。",
    "direct_price_search 表示用户已经说清楚具体品牌、型号或规格，可以直接查价。",
    "need_recommendation 表示用户只知道品类，但不知道买哪个方向。",
    "need_questions 表示用户需求复杂，必须先问 2-3 个问题，比如婴儿车、电脑、家电。",
    "输出 JSON 结构：",
    "{",
    "  \"type\": \"need_recommendation\",",
    "  \"title\": \"用户原始需求\",",
    "  \"reply\": \"给用户的一句话回复\",",
    "  \"query\": \"可直接查价时使用的查价词，可为空字符串\",",
    "  \"options\": [{ \"id\": \"value_family_stock\", \"name\": \"家用性价比囤货装\", \"query\": \"卷纸 家用 性价比 囤货 618 补贴\" }],",
    "  \"questions\": [{ \"id\": \"budget\", \"label\": \"预算大概？\", \"options\": [\"1000以内\", \"1000-2500\", \"2500以上\"] }]",
    "}",
    "如果 type 是 direct_price_search，options 可以为空，query 必须可用于查价。",
    "如果 type 是 need_recommendation，options 必须有 2-4 个。",
    "如果 type 是 need_questions，questions 必须有 2-3 个。"
  ].join("\n");
}

function withDebug(payload, debugOptions) {
  const debug = getDebugInfo(debugOptions);
  return Object.assign(payload, debug, { debug });
}

function normalizeAnalyzeResult(result, text) {
  const type = ALLOWED_TYPES.has(result.type) ? result.type : ALLOWED_TYPES.has(result.status) ? result.status : "need_recommendation";
  const normalized = {
    type,
    title: String(result.title || text),
    reply: String(result.reply || defaultReply(type)),
    query: String(result.query || result.priceKeyword || ""),
    options: Array.isArray(result.options) ? result.options.map(normalizeOption).filter(Boolean) : [],
    questions: Array.isArray(result.questions) ? result.questions.map(normalizeQuestion).filter(Boolean) : []
  };

  if (type === "direct_price_search" && !normalized.query) {
    normalized.query = text;
  }

  if (type === "need_recommendation" && !normalized.options.length) {
    normalized.options = mockAnalyzeForApi(text).options;
  }

  if (type === "need_questions" && !normalized.questions.length) {
    normalized.questions = mockAnalyzeForApi("婴儿车").questions;
  }

  return normalized;
}

function normalizeOption(option, index) {
  if (!option) return null;
  const name = String(option.name || "").trim();
  const query = String(option.query || option.keyword || "").trim();
  if (!name || !query) return null;
  return {
    id: String(option.id || `option_${index + 1}`),
    name,
    query
  };
}

function normalizeQuestion(question, index) {
  if (!question) return null;
  const label = String(question.label || question.text || "").trim();
  const options = Array.isArray(question.options) ? question.options.map(String).filter(Boolean) : [];
  if (!label || !options.length) return null;
  return {
    id: String(question.id || `question_${index + 1}`),
    label,
    options
  };
}

function mockAnalyzeForApi(text) {
  return legacyAnalyzeToApi(analyzeShopping(text), text);
}

function legacyAnalyzeToApi(result, text) {
  const type = result.status || "need_recommendation";
  return normalizeAnalyzeResult({
    type,
    title: text,
    reply: defaultReply(type),
    query: result.priceKeyword || "",
    options: (result.recommendations || []).map((item, index) => ({
      id: item.id || slugFromName(item.name, index),
      name: item.name,
      query: item.keyword
    })),
    questions: result.questions || []
  }, text);
}

function defaultReply(type) {
  if (type === "direct_price_search") return "这个已经比较明确，可以直接帮你查各平台补贴价。";
  if (type === "need_questions") return "这个要先确认几个条件，我再推荐更合适的型号。";
  return "我先帮你缩小范围，选一个更接近你需求的方向。";
}

function slugFromName(name, index) {
  const known = {
    "家用性价比囤货装": "value_family_stock",
    "柔软厚实品质款": "soft_quality",
    "母婴家庭安心款": "baby_safe"
  };
  return known[name] || `option_${index + 1}`;
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
