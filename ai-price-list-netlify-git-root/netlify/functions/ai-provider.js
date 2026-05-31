const DEFAULT_TIMEOUT_MS = 18000;

function getProviderConfig() {
  return {
    provider: process.env.AI_PROVIDER || "openai-compatible",
    apiKey: process.env.AI_API_KEY,
    baseUrl: process.env.AI_API_BASE_URL,
    model: process.env.AI_MODEL,
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  };
}

function hasProviderConfig(config = getProviderConfig()) {
  return Boolean(config.apiKey && config.baseUrl && config.model);
}

function getDebugInfo({
  source = "mock_fallback",
  isFallback = true,
  errorMessage = "",
  status = null,
  errorName = "",
  stage = "",
  errorCode = "",
  providerErrorCode = "",
  providerErrorMessage = "",
  apiMode = "chat_completions",
  searchEnabled = false,
  extractorEnabled = false,
  timeoutMs = null
} = {}) {
  const config = getProviderConfig();
  return {
    provider: config.provider,
    modelUsed: config.model || "not_configured",
    apiMode,
    searchEnabled,
    extractorEnabled,
    source,
    isFallback,
    errorMessage,
    status,
    errorName,
    stage,
    errorCode,
    providerErrorCode,
    providerErrorMessage,
    timeoutMs: timeoutMs || config.timeoutMs
  };
}

async function requestJson({ systemPrompt, userPrompt, temperature = 0.2 }) {
  const config = getProviderConfig();

  if (!hasProviderConfig(config)) {
    console.warn("AI provider env vars are missing. Falling back to mock data.");
    return null;
  }

  const endpoint = buildChatCompletionsUrl(config.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        temperature,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AI provider request failed: ${response.status} ${text.slice(0, 300)}`);
    }

    const payload = await response.json();
    const content = payload && payload.choices && payload.choices[0] && payload.choices[0].message
      ? payload.choices[0].message.content
      : "";

    return parseJsonContent(content);
  } finally {
    clearTimeout(timer);
  }
}

async function requestResponsesJson({ input, tools = [], temperature = 0.2, timeoutMs }) {
  const config = getProviderConfig();

  if (!hasProviderConfig(config)) {
    console.warn("AI provider env vars are missing. Falling back to mock data.");
    return null;
  }

  const endpoint = buildResponsesUrl(config.baseUrl);
  const controller = new AbortController();
  const effectiveTimeoutMs = timeoutMs || config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: config.model,
        input,
        tools,
        temperature
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const text = await response.text();
      throw buildProviderError({
        prefix: "AI provider responses request failed",
        status: response.status,
        statusText: response.statusText,
        bodyText: text
      });
    }

    const payload = await response.json();
    return parseJsonContent(extractResponsesText(payload));
  } finally {
    clearTimeout(timer);
  }
}

function buildProviderError({ prefix, status, statusText, bodyText }) {
  const parsed = parseProviderErrorBody(bodyText);
  const providerMessage = parsed.message || parsed.errorMessage || parsed.msg || statusText || "";
  const providerCode = parsed.code || parsed.errorCode || parsed.error_code || "";
  const details = sanitizeErrorMessage(bodyText || providerMessage || statusText || "");
  const error = new Error(`${prefix}: ${status} ${details}`);
  error.status = status;
  error.errorCode = providerCode || String(status);
  error.providerErrorCode = providerCode;
  error.providerErrorMessage = sanitizeErrorMessage(providerMessage);
  error.responseBody = details;
  return error;
}

function parseProviderErrorBody(bodyText) {
  if (!bodyText) return {};
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed.error && typeof parsed.error === "object") {
      return Object.assign({}, parsed, parsed.error);
    }
    return parsed;
  } catch (error) {
    return {};
  }
}

function sanitizeErrorMessage(message) {
  return String(message || "")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer ***");
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

function parseJsonContent(content) {
  if (!content) throw new Error("AI provider returned empty content");

  if (typeof content === "object") return content;

  const raw = String(content).trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw error;
    return JSON.parse(match[0]);
  }
}

module.exports = {
  getProviderConfig,
  getDebugInfo,
  hasProviderConfig,
  requestJson,
  requestResponsesJson
};
