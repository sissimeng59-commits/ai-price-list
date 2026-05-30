const { getProviderConfig, hasProviderConfig } = require("./lib/ai-provider");

exports.handler = async function () {
  const config = getProviderConfig();
  const env = buildEnvInfo(config);

  if (!hasProviderConfig(config)) {
    return jsonResponse(200, {
      env,
      aiTest: {
        ok: false,
        source: "error",
        modelUsed: config.model || "not_configured",
        errorMessage: "AI provider env vars are missing or incomplete.",
        status: null
      }
    });
  }

  const aiTest = await runMinimalAiTest(config);
  return jsonResponse(200, { env, aiTest });
};

function buildEnvInfo(config) {
  return {
    hasProvider: Boolean(process.env.AI_PROVIDER),
    provider: config.provider,
    hasBaseUrl: Boolean(config.baseUrl),
    baseUrl: config.baseUrl || "",
    hasModel: Boolean(config.model),
    model: config.model || "",
    hasApiKey: Boolean(config.apiKey),
    apiKeyMasked: maskApiKey(config.apiKey)
  };
}

async function runMinimalAiTest(config) {
  const endpoint = buildChatCompletionsUrl(config.baseUrl);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: "Reply with exactly one word: pong"
          },
          {
            role: "user",
            content: "ping"
          }
        ]
      })
    });

    const text = await response.text();

    if (!response.ok) {
      return {
        ok: false,
        source: "error",
        modelUsed: config.model,
        errorType: "http_error",
        errorMessage: sanitizeErrorMessage(text || response.statusText),
        status: response.status
      };
    }

    const payload = JSON.parse(text);
    const sample = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? String(payload.choices[0].message.content || "").trim()
      : "";

    return {
      ok: true,
      source: "real_ai",
      modelUsed: config.model,
      sample: sample || "empty_response"
    };
  } catch (error) {
    return {
      ok: false,
      source: "error",
      modelUsed: config.model,
      errorType: error.name || "request_error",
      errorMessage: sanitizeErrorMessage(error.message),
      status: null
    };
  }
}

function buildChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

function maskApiKey(apiKey) {
  if (!apiKey) return "";
  const text = String(apiKey);
  if (text.length <= 9) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 5)}***${text.slice(-4)}`;
}

function sanitizeErrorMessage(message) {
  return String(message || "").replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
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
