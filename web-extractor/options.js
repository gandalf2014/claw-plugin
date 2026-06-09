// ============================================================
// options.js — 设置页面逻辑
// ============================================================

const DOM = {
  apiKey:           document.getElementById("apiKey"),
  baseUrl:          document.getElementById("baseUrl"),
  modelName:        document.getElementById("modelName"),
  maxContentLength: document.getElementById("maxContentLength"),
  systemPrompt:     document.getElementById("systemPrompt"),
  btnSave:          document.getElementById("btnSave"),
  btnTest:          document.getElementById("btnTest"),
  btnToggleKey:     document.getElementById("btnToggleKey"),
  btnResetPrompt:   document.getElementById("btnResetPrompt"),
  saveBanner:       document.getElementById("saveBanner"),
  testResult:       document.getElementById("testResult"),
  promptCharCount:  document.getElementById("promptCharCount"),
};

// 默认 System Prompt
// ⚠️ 与 popup.js 中的 getDefaultSystemPrompt() 保持同步！
// 修改此处必须同步修改 popup.js，反之亦然。
const DEFAULT_SYSTEM_PROMPT = `You are a precise data extraction assistant. Your task is to extract structured data from web page content based on the user's extraction instruction.

The page content you receive consists of MULTIPLE SECTIONS:

SECTION 1 — Page Metadata:
- title, url, wait_result (how data was collected)
- data_sources: which sources provided data

SECTION 2 — SSR Embedded Data (if available):
- YAML-formatted server-side data from frameworks like Next.js, NFES, Nuxt, or JSON-LD
- This section contains the most reliable structured data — ALWAYS check here first
- NFES section may contain: hotelDetailResponse (hotelComment, hotelPositionInfo), pageProps, query

SECTION 3 — Flat Data List (key data items with prices):
- Each line: [N] label: "heading/label text" data: "text block with price/number data"
- The "label" is the nearest heading or description that introduces the data
- The "data" is the actual price/info text (contains currency symbols like ¥, $, 起, 元, etc.)
- Use this section to CORRELATE labels with their data — items with the same label often belong together
- Sequential items without labels in between typically belong to the same parent item

SECTION 4 — Accessibility Tree Snapshot:
- Each line: ROLE "text content" [optional link href], indentation = nesting
- Roles: banner, navigation, main, heading [h1..h6], link, list, listitem, paragraph, button, table, row, cell, image, textbox, text, group
- Links: link "text" [https://...]
- Lists: list -> listitem -> text/heading/link
- Tables: table -> row -> cell/cell [th] "content"

CRITICAL RULES:
1. Output MUST be a valid JSON object. No preamble, no markdown blocks, no explanations.
2. PRIORITIZE SSR Embedded Data (Section 2) for structured data.
3. For prices and room details, CROSS-REFERENCE the Flat Data List (Section 3) with the Accessibility Tree (Section 4).
4. If a field cannot be found, use null (not "N/A" or empty string).
5. Do NOT invent or hallucinate data — only extract what is present.
6. Keep string values clean — trim whitespace, remove extra newlines.

ROOM TYPE EXTRACTION GUIDANCE:
- In the Flat Data List, look for items where the "label" is a room name (e.g., contains Chinese characters + sometimes includes bed type like "双床" "大床")
- The associated "data" for that room typically contains the price (¥XXX), breakfast info, cancellation policy
- In the Accessibility Tree, room types appear as listitems within a list, each containing room name, price, and details
- Common price patterns: "¥688", "$99", "CNY 500", "起", "/晚", "688元"
- Extract room types as: [{ "name": "...", "price": "...", "bed_type": "...", "breakfast": "...", "cancellation_policy": "...", "area": "...", "occupancy": "..." }]

OUTPUT FORMAT: Just the JSON, nothing else.`;

// ---- 初始化 ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  bindEvents();
});

// ---- 事件绑定 ----
function bindEvents() {
  DOM.btnSave.addEventListener("click", handleSave);
  DOM.btnTest.addEventListener("click", handleTest);
  DOM.btnToggleKey.addEventListener("click", toggleApiKeyVisibility);
  DOM.btnResetPrompt.addEventListener("click", resetSystemPrompt);

  // 实时字符计数
  DOM.systemPrompt.addEventListener("input", updateCharCount);

  // Ctrl+S 快捷键保存
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
  });
}

// ---- 加载设置 ----
async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get([
      "apiKey",
      "baseUrl",
      "modelName",
      "maxContentLength",
      "systemPrompt",
    ]);

    DOM.apiKey.value           = data.apiKey           || "";
    DOM.baseUrl.value          = data.baseUrl          || "";
    DOM.modelName.value        = data.modelName        || "gpt-4o";
    DOM.maxContentLength.value = data.maxContentLength || 50000;

    const prompt = data.systemPrompt || "";
    DOM.systemPrompt.value = prompt || DEFAULT_SYSTEM_PROMPT;
    updateCharCount();
  } catch (err) {
    console.error("加载设置失败:", err);
  }
}

// ---- 保存设置 ----
async function handleSave() {
  const settings = {
    apiKey:           DOM.apiKey.value.trim(),
    baseUrl:          DOM.baseUrl.value.trim(),
    modelName:        DOM.modelName.value.trim() || "gpt-4o",
    maxContentLength: parseInt(DOM.maxContentLength.value, 10) || 50000,
    systemPrompt:     DOM.systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT,
  };

  // 基本校验
  if (!settings.apiKey) {
    showSaveBanner("请输入 API Key", "error");
    DOM.apiKey.focus();
    return;
  }
  if (!settings.baseUrl) {
    showSaveBanner("请输入 Base URL", "error");
    DOM.baseUrl.focus();
    return;
  }
  if (settings.maxContentLength < 500) {
    showSaveBanner("页面内容长度至少 500 字符", "error");
    DOM.maxContentLength.focus();
    return;
  }

  try {
    await chrome.storage.sync.set(settings);
    showSaveBanner("设置已保存", "success");
  } catch (err) {
    showSaveBanner(`保存失败：${err.message}`, "error");
  }
}

function showSaveBanner(msg, type) {
  DOM.saveBanner.textContent = "";
  DOM.saveBanner.classList.remove("hidden");

  if (type === "error") {
    DOM.saveBanner.style.background = "#fef2f2";
    DOM.saveBanner.style.borderColor = "#fecaca";
    DOM.saveBanner.style.color = "#991b1b";
  } else {
    DOM.saveBanner.style.background = "#f0fdf4";
    DOM.saveBanner.style.borderColor = "#bbf7d0";
    DOM.saveBanner.style.color = "#166534";
  }

  // 添加 SVG 图标
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("width", "16");
  icon.setAttribute("height", "16");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("fill", "none");
  icon.setAttribute("stroke", "currentColor");
  icon.setAttribute("stroke-width", "2");

  if (type === "error") {
    icon.innerHTML = `
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="15" y1="9" x2="9" y2="15"></line>
      <line x1="9" y1="9" x2="15" y2="15"></line>
    `;
  } else {
    icon.innerHTML = `
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path>
      <polyline points="22 4 12 14.01 9 11.01"></polyline>
    `;
  }

  // 先清空旧内容，防止每次调用累积 DOM 节点
  DOM.saveBanner.textContent = "";
  DOM.saveBanner.appendChild(icon);
  DOM.saveBanner.appendChild(document.createTextNode(" " + msg));

  // 3 秒后自动隐藏，清除上一次定时器防止冲突
  if (DOM._bannerTimeout) clearTimeout(DOM._bannerTimeout);
  DOM._bannerTimeout = setTimeout(() => {
    DOM.saveBanner.classList.add("hidden");
  }, 3000);
}

// ---- 测试连接 ----
async function handleTest() {
  const apiKey    = DOM.apiKey.value.trim();
  const baseUrl   = DOM.baseUrl.value.trim();
  const modelName = DOM.modelName.value.trim() || "gpt-4o";

  if (!apiKey || !baseUrl) {
    showTestResult("请先填写 API Key 和 Base URL", "error");
    return;
  }

  showTestResult("正在测试连接...", "testing");
  DOM.btnTest.disabled = true;

  try {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
    let testUrl, headers, body;

    if (normalizedBaseUrl.includes("anthropic") || normalizedBaseUrl.includes("claude")) {
      testUrl = `${normalizedBaseUrl}/messages`;
      headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      };
      body = JSON.stringify({
        model: modelName,
        max_tokens: 10,
        messages: [{ role: "user", content: "Hi" }],
      });
    } else {
      testUrl = `${normalizedBaseUrl}/chat/completions`;
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 10,
      });
    }

    const response = await fetch(testUrl, {
      method: "POST",
      headers,
      body,
    });

    if (response.ok) {
      const data = await response.json();
      showTestResult(
        `连接成功！模型 "${modelName}" 响应正常。`,
        "success"
      );
    } else {
      const errorText = await response.text();
      showTestResult(
        `连接失败 (${response.status}): ${errorText.substring(0, 200)}`,
        "error"
      );
    }
  } catch (err) {
    showTestResult(`网络错误: ${err.message}。请检查 Base URL 和网络连接。`, "error");
  } finally {
    DOM.btnTest.disabled = false;
  }
}

function showTestResult(msg, type) {
  DOM.testResult.classList.remove("hidden", "testing", "success", "error");
  DOM.testResult.classList.add(type);
  DOM.testResult.textContent = msg;
}

// ---- 切换 API Key 可见性 ----
function toggleApiKeyVisibility() {
  const isPassword = DOM.apiKey.type === "password";
  DOM.apiKey.type = isPassword ? "text" : "password";
  DOM.btnToggleKey.innerHTML = isPassword
    ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
}

// ---- 重置 System Prompt ----
function resetSystemPrompt() {
  DOM.systemPrompt.value = DEFAULT_SYSTEM_PROMPT;
  updateCharCount();
}

// ---- 字符计数 ----
function updateCharCount() {
  const count = DOM.systemPrompt.value.length;
  DOM.promptCharCount.textContent = `${count.toLocaleString()} 字符`;
}
