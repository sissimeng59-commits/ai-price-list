const { getProviderConfig, hasProviderConfig } = require("./lib/ai-provider");

const DEBUG_TIMEOUT_MS = 60000;

exports.handler = async function () {
  const config = getProviderConfig();
  const result = {
    chatCompletions: emptyResult(),
    responsesNoTools: emptyResult(),
    responsesWithWebSearch: emptyResult(),
    config: {
      model: config.model || "",
      baseUrl: config.baseUrl || "",
      timeoutMs: DEBUG_TIMEOUT_MS
    }
  };

  if (!hasProviderConfig(config)) {
    const missing = {
      ok: false,
      status: null,
      timeMs: 0,
      errorName: "MissingEnvironment",
      errorMessage: "AI provider env vars are missing or incomplete."
    };
    result.chatCompletions = missing;
    result.responsesNoTools = missing;
    result.responsesWithWebSearch = missing;
    return jsonResponse(200, result);
  }

  result.chatCompletions = await runTimedTest(function () {
    return callChatCompletions(config);
  });
  result.responsesNoTools = await runTimedTest(function () {
    return callResponses(config, {
      input: "只返回 JSON：{\"ok\":true}",
      tools: []
    });
  });
  result.responsesWithWebSearch = await runTimedTest(function () {
    return callResponses(config, {
      input: [
        "请使用 web_search 搜索：今天京东得宝卷纸 618 到手价。",
        "只返回简短 JSON，不要 Markdown，不要代码块。",
        "JSON 结构：{\"ok\":true,\"summary\":\"一句话搜索结论\",\"items\":[{\"platform\":\"京东\",\"price\":\"价格区间或需确认\"}]}"
      ].join("\n"),
      tools: [{ type: "web_search" }]
    });
  });

  return jsonResponse(200, result);
};

function emptyResult() {
  return {
    ok: false,
    status: null,
    timeMs: 0,
    errorName: "",
    errorMessage: ""
  };
}

async function runTimedTest(fn) {
  const startedAt = Date.now();
  try {
    const response = await fn();
    const text = await response.text();
    const timeMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        timeMs,
        errorName: "HttpError",
        errorMessage: sanitizeErrorMessage(text || response.statusText)
      };
    }

    return {
      ok: true,
      status: response.status,
      timeMs,
      errorName: "",
      errorMessage: "",
      sample: extractSample(text)
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      timeMs: Date.now() - startedAt,
      errorName: error.name || "RequestError",
      errorMessage: sanitizeErrorMessage(error.message)
    };
  }
}

function callChatCompletions(config) {
  return fetch(buildChatCompletionsUrl(config.baseUrl), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: [
        { role: "system", content: "Reply with exactly one word: pong" },
        { role: "user", content: "ping" }
      ]
    }),
    signal: timeoutSignal(DEBUG_TIMEOUT_MS)
  });
}

function callResponses(config, { input, tools }) {
  return fetch(buildResponsesUrl(config.baseUrl), {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify({
      model: config.model,
      input,
      tools,
      temperature: 0
    }),
    signal: timeoutSignal(DEBUG_TIMEOUT_MS)
  });
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

function buildChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function buildResponsesUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/responses$/.test(normalized)) return normalized;
  if (/\/chat\/completions$/.test(normalized)) {
    return normalized.replace(/\/chat\/completions$/, "/responses");
  }
  return `${normalized}/responses`;
}

function extractSample(text) {
  const safe = sanitizeErrorMessage(text || "");
  return safe.length > 500 ? `${safe.slice(0, 500)}...` : safe;
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
