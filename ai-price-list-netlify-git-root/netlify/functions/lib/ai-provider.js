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

function getDebugInfo({ source = "mock_fallback", isFallback = true, errorMessage = "" } = {}) {
  const config = getProviderConfig();
  return {
    provider: config.provider,
    modelUsed: config.model || "not_configured",
    apiMode: "chat_completions",
    searchEnabled: false,
    source,
    isFallback,
    errorMessage
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

function buildChatCompletionsUrl(baseUrl) {
  const normalized = String(baseUrl || "").replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
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
  requestJson
};
