// ============================================================
// background.js — Service Worker
// 负责 LLM API 调用（非跨域限制，Service Worker 无 CORS 限制）
// ============================================================

// 调试开关：设为 true 可启用 Service Worker 日志输出
var BG_DEBUG = false;

function _bgLog(/* ... */) {
  if (!BG_DEBUG) return;
  console.log.apply(console, arguments);
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "callLLM") {
    handleLLMCall(request, sender)
      .then((result) => sendResponse({ result }))
      .catch((err) => sendResponse({ error: err.message }));
    return true; // 保持消息通道开放
  }

  // 元素选择完成 → 打开 popup 面板
  if (request.type === "selectionComplete") {
    try {
      chrome.action.openPopup();
    } catch (_) { /* 某些浏览器/环境不支持，用户可手动点击图标 */ }
  }
});

/**
 * 调用 LLM API
 */
async function handleLLMCall(request, sender) {
  const { config, instruction, content, skipJsonFormat } = request;
  const { apiKey, baseUrl, modelName, systemPrompt } = config;

  // 获取当前页面 URL（用于上下文）
  let pageUrl = "";
  if (sender && sender.tab) {
    try {
      const tab = await chrome.tabs.get(sender.tab.id);
      pageUrl = tab.url || "";
    } catch (_) { /* 忽略 */ }
  }

  // 构建请求体
  const fullSystemPrompt = systemPrompt + "\n\n当前页面URL: " + pageUrl;

  const messages = [
    {
      role: "system",
      content: fullSystemPrompt,
    },
    {
      role: "user",
      content: `提取指令：${instruction}\n\n页面内容：\n${content}`,
    },
  ];

  // 判断 API 类型并构建请求
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  let apiUrl, headers, body;

  if (
    normalizedBaseUrl.includes("api.openai.com") ||
    normalizedBaseUrl.includes("/v1") ||
    normalizedBaseUrl.includes("openai")
  ) {
    // OpenAI 兼容 API (包括 Azure、Ollama、vLLM、LocalAI 等)
    apiUrl = `${normalizedBaseUrl}/chat/completions`;
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    body = JSON.stringify({
      model: modelName,
      messages,
      temperature: 0.1,
      max_tokens: 16384,
      ...(skipJsonFormat ? {} : { response_format: { type: "json_object" } }),
    });
  } else if (normalizedBaseUrl.includes("anthropic") || normalizedBaseUrl.includes("claude")) {
    // Anthropic API
    apiUrl = `${normalizedBaseUrl}/messages`;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    // 提取 system prompt
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages.filter((m) => m.role !== "system");
    body = JSON.stringify({
      model: modelName,
      system: systemMsg ? systemMsg.content : "",
      messages: userMsgs,
      max_tokens: 16384,
      temperature: 0.1,
    });
  } else {
    // 通用 OpenAI 兼容格式（默认）
    apiUrl = `${normalizedBaseUrl}/chat/completions`;
    headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
    body = JSON.stringify({
      model: modelName,
      messages,
      temperature: 0.1,
      max_tokens: 16384,
    });
  }

  _bgLog("[Background] Calling LLM API:", apiUrl);

  // 发送请求
  let response;
  try {
    response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (fetchErr) {
    throw new Error(`网络请求失败：${fetchErr.message}。请检查 Base URL 是否正确以及网络连接。`);
  }

  if (!response.ok) {
    let errorDetail = "";
    try {
      const errorBody = await response.text();
      errorDetail = errorBody.substring(0, 300);
    } catch (_) { /* 忽略 */ }
    throw new Error(
      `API 返回错误 (${response.status})：${errorDetail || response.statusText}`
    );
  }

  const data = await response.json();

  // 提取 content（兼容 OpenAI 和 Anthropic 格式）
  let resultText = "";

  if (data.choices && data.choices[0]) {
    // OpenAI 格式
    resultText = data.choices[0].message?.content || "";
  } else if (data.content && Array.isArray(data.content)) {
    // Anthropic 格式
    resultText = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  } else if (data.content && typeof data.content === "string") {
    resultText = data.content;
  } else if (data.message && data.message.content) {
    resultText = data.message.content;
  } else {
    // 尝试其他可能的格式
    resultText = JSON.stringify(data);
  }

  if (!resultText) {
    throw new Error("LLM 返回了空内容");
  }

  // 清理可能的 markdown 包裹
  resultText = resultText.trim();
  const mdMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (mdMatch) {
    resultText = mdMatch[1].trim();
  }

  // 验证是否为有效 JSON
  try {
    JSON.parse(resultText);
  } catch (_) {
    // 尝试修复常见问题：去掉可能的引号外文本
    const firstBrace = resultText.indexOf("{");
    const firstBracket = resultText.indexOf("[");
    const startIdx = Math.min(
      firstBrace >= 0 ? firstBrace : Infinity,
      firstBracket >= 0 ? firstBracket : Infinity
    );
    if (startIdx >= 0 && startIdx < Infinity) {
      resultText = resultText.substring(startIdx);
    }
    // 再次验证
    try {
      JSON.parse(resultText);
    } catch (e2) {
      _bgLog("[Background] LLM 返回的不是有效 JSON，将返回原始文本");
    }
  }

  return resultText;
}
