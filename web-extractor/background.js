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

// ---- 重试配置 ----
var RETRY_MAX = 3;
var RETRY_BASE_DELAY_MS = 1000;

// ---- 常量 ----
var MAX_INSTRUCTION_LENGTH = 2000;
var MAX_CONTENT_LENGTH = 500000;

// ---- Service Worker 保活 ----
// 监听长连接以保持 SW 在长时间 LLM 调用期间不被终止
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === "keepalive") {
    var keepAliveInterval = setInterval(function() {
      try { port.postMessage({ type: "ping" }); } catch(e) {
        clearInterval(keepAliveInterval);
      }
    }, 20000);

    port.onDisconnect.addListener(function() {
      clearInterval(keepAliveInterval);
      _bgLog("[Background] keepalive port disconnected");
    });

    _bgLog("[Background] keepalive port connected");
  }
});

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

  // 翻页按钮指定完成 → 存储 XPath 并打开 popup
  if (request.type === "nextPageSelected") {
    chrome.storage.local.set({ pendingNextPageXPath: request.xpath || "" }).catch(() => {});
    try {
      chrome.action.openPopup();
    } catch (_) {}
  }
});

/**
 * 净化用户输入，防止异常字符影响 prompt 结构
 */
function sanitizeInput(str, maxLen) {
  if (!str) return "";
  // 移除 null 字节和控制字符（除了常见的换行/制表）
  var cleaned = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  if (cleaned.length > maxLen) cleaned = cleaned.substring(0, maxLen - 3) + "...";
  return cleaned;
}

/**
 * 判断 API 是否为 OpenAI 兼容格式
 * 精确匹配 OpenAI 官方域名和常见兼容路径
 */
function isOpenAICompatible(baseUrl) {
  var u = baseUrl.toLowerCase();
  // 精确匹配 OpenAI 官方域名
  if (u.includes("api.openai.com")) return true;
  // Azure OpenAI
  if (u.includes("openai.azure.com")) return true;
  // 常见兼容代理（路径以 /v1 结尾或包含 /v1/）
  if (/\/v1\/?$/.test(u) || u.includes("/v1/")) return true;
  // DeepSeek API
  if (u.includes("api.deepseek.com")) return true;
  // Ollama / vLLM / LocalAI 等常见本地模型服务
  if (/:\d{4,5}\/v1/.test(u)) return true;
  return false;
}

/**
 * 判断 API 是否为 Anthropic 格式
 */
function isAnthropicCompatible(baseUrl) {
  var u = baseUrl.toLowerCase();
  if (u.includes("api.anthropic.com")) return true;
  return false;
}

/**
 * 判断错误是否可重试
 */
function isRetryableError(status) {
  // 429 (Rate Limit), 500-599 (Server Error), 408 (Timeout) 可重试
  return status === 429 || status === 408 || (status >= 500 && status < 600);
}

/**
 * 调用 LLM API（带重试机制）
 */
async function handleLLMCall(request, sender) {
  var config = request.config;
  var instruction = sanitizeInput(request.instruction, MAX_INSTRUCTION_LENGTH);
  var content = sanitizeInput(request.content, MAX_CONTENT_LENGTH);
  var skipJsonFormat = request.skipJsonFormat;
  var apiKey = config.apiKey;
  var baseUrl = config.baseUrl;
  var modelName = config.modelName;
  var systemPrompt = config.systemPrompt;

  // 获取当前页面 URL（用于上下文）
  var pageUrl = "";
  if (sender && sender.tab) {
    try {
      var tab = await chrome.tabs.get(sender.tab.id);
      pageUrl = tab.url || "";
    } catch (_) { /* 忽略 */ }
  }

  // 构建请求体
  var fullSystemPrompt = systemPrompt + "\n\n当前页面URL: " + pageUrl;

  var messages = [
    {
      role: "system",
      content: fullSystemPrompt,
    },
    {
      role: "user",
      content: "提取指令：" + instruction + "\n\n页面内容：\n" + content,
    },
  ];

  // 判断 API 类型并构建请求
  var normalizedBaseUrl = baseUrl.replace(/\/+$/, "");

  var apiUrl, headers, body;

  if (isOpenAICompatible(normalizedBaseUrl)) {
    // OpenAI 兼容 API (包括 Azure、Ollama、vLLM、LocalAI、DeepSeek 等)
    apiUrl = normalizedBaseUrl.endsWith("/chat/completions")
      ? normalizedBaseUrl
      : normalizedBaseUrl + "/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    };
    body = JSON.stringify({
      model: modelName,
      messages: messages,
      temperature: 0.1,
      max_tokens: 16384,
    });
    // 仅为真正的 OpenAI 端点添加 response_format
    if (normalizedBaseUrl.includes("api.openai.com") && !skipJsonFormat) {
      body = JSON.stringify({
        model: modelName,
        messages: messages,
        temperature: 0.1,
        max_tokens: 16384,
        response_format: { type: "json_object" },
      });
    }
  } else if (isAnthropicCompatible(normalizedBaseUrl)) {
    // Anthropic API
    apiUrl = normalizedBaseUrl + "/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
    var systemMsg = messages.find(function(m) { return m.role === "system"; });
    var userMsgs = messages.filter(function(m) { return m.role !== "system"; });
    body = JSON.stringify({
      model: modelName,
      system: systemMsg ? systemMsg.content : "",
      messages: userMsgs,
      max_tokens: 16384,
      temperature: 0.1,
    });
  } else {
    // 通用 OpenAI 兼容格式（默认）- 保守处理未知 URL
    apiUrl = normalizedBaseUrl + "/chat/completions";
    headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
    };
    body = JSON.stringify({
      model: modelName,
      messages: messages,
      temperature: 0.1,
      max_tokens: 16384,
    });
  }

  _bgLog("[Background] Calling LLM API:", apiUrl);

  // 带重试的 API 调用
  var lastError = null;
  for (var attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      var response = await fetch(apiUrl, {
        method: "POST",
        headers: headers,
        body: body,
      });

      if (response.ok) {
        var data = await response.json();
        return extractContent(data);
      }

      // 处理非 OK 响应
      var errorBody = "";
      try {
        errorBody = await response.text();
        errorBody = errorBody.substring(0, 300);
      } catch (_) { /* 忽略 */ }

      if (isRetryableError(response.status) && attempt < RETRY_MAX - 1) {
        // 可重试错误：等待后重试
        var delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        _bgLog("[Background] Retry attempt " + (attempt + 1) + " after " + delay + "ms, status: " + response.status);
        await sleep(delay);
        continue;
      }

      throw new Error(
        "API 返回错误 (" + response.status + ")：" + (errorBody || response.statusText)
      );
    } catch (fetchErr) {
      lastError = fetchErr;
      if (attempt < RETRY_MAX - 1 && fetchErr.message && fetchErr.message.indexOf("网络请求失败") >= 0) {
        var delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        _bgLog("[Background] Network retry attempt " + (attempt + 1) + " after " + delay + "ms");
        await sleep(delay);
        continue;
      }
      throw fetchErr;
    }
  }

  throw lastError || new Error("LLM API 调用失败，已重试 " + RETRY_MAX + " 次");
}

/**
 * 从 API 响应中提取文本内容
 */
function extractContent(data) {
  var resultText = "";

  if (data.choices && data.choices[0]) {
    // OpenAI 格式
    resultText = data.choices[0].message ? (data.choices[0].message.content || "") : "";
  } else if (data.content && Array.isArray(data.content)) {
    // Anthropic 格式
    resultText = data.content
      .filter(function(block) { return block.type === "text"; })
      .map(function(block) { return block.text; })
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
  var mdMatch = resultText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (mdMatch) {
    resultText = mdMatch[1].trim();
  }

  // 验证是否为有效 JSON
  try {
    JSON.parse(resultText);
  } catch (_) {
    // 尝试修复常见问题：去掉可能的引号外文本
    var firstBrace = resultText.indexOf("{");
    var firstBracket = resultText.indexOf("[");
    var startIdx = Math.min(
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

// ---- 工具函数 ----
function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}
