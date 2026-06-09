// ============================================================
// popup.js — 弹窗主逻辑
// ============================================================

const DOM = {
  btnSettings:    document.getElementById("btnSettings"),
  txtInstruction: document.getElementById("txtInstruction"),
  btnSelect:      document.getElementById("btnSelect"),
  btnExtract:     document.getElementById("btnExtract"),
  btnScrollHint:  document.getElementById("btnScrollHint"),
  btnCopy:        document.getElementById("btnCopy"),
  btnDownload:    document.getElementById("btnDownload"),
  btnSaveRule:    document.getElementById("btnSaveRule"),
  statusBar:      document.getElementById("statusBar"),
  statusText:     document.getElementById("statusText"),
  progressBar:    document.getElementById("progressBar"),
  progressFill:   document.getElementById("progressFill"),
  resultSection:  document.getElementById("resultSection"),
  jsonOutput:     document.getElementById("jsonOutput"),
  emptyState:     document.getElementById("emptyState"),
  errorBanner:    document.getElementById("errorBanner"),
  errorText:      document.getElementById("errorText"),
  contentLimit:   document.getElementById("contentLimit"),
  quickBtns:      document.querySelectorAll(".btn-quick"),
  // 历史记录
  historySection: document.getElementById("historySection"),
  historyToggle:  document.getElementById("historyToggle"),
  historyList:    document.getElementById("historyList"),
  historyItems:   document.getElementById("historyItems"),
  historyEmpty:   document.getElementById("historyEmpty"),
  historyCount:   document.getElementById("historyCount"),
  btnClearHistory:document.getElementById("btnClearHistory"),
  // 区域选择器
  areaPicker:     document.getElementById("areaPicker"),
  areaPickerList: document.getElementById("areaPickerList"),
  areaCount:      document.getElementById("areaCount"),
};

// ---- 选择模式状态 ----
let isSelecting = false;
let selectedCount = 0;

// ---- 历史记录状态 ----
let historyItems = [];
let historyOpen = false;
let lastSavedInstruction = null;   // 记录本次提取的指令（用于去重保存）
let lastSavedSystemPrompt = null;  // 记录本次提取的 systemPrompt

// ---- 标记：当前文本框内容是否来自 storage（用于自动生成时覆盖旧指令） ----
let instructionFromStorage = false;

// ---- 标记：本次会话是否已完成自动检测 ----
let autoDetectionDone = false;

// ---- 区域选择器状态 ----
let areaSections = [];     // 所有检测到的内容区域
let currentAreaIndex = 0;  // 当前选中的区域索引（0 = 最大面积）

// ---- 初始化 ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadSavedInstruction();
  await loadMaxContentLength();
  await loadHistory();
  bindEvents();
  listenForSelectionComplete();
  await checkSelectedElements();
});

// ---- 事件绑定 ----
function bindEvents() {
  DOM.btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // 快捷指令
  DOM.quickBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      DOM.txtInstruction.value = btn.dataset.prompt;
      DOM.txtInstruction.focus();
      instructionFromStorage = false;  // 用户点击快捷指令，标记为非存储内容
    });
  });

  // 用户手动编辑指令时，清除存储标记（防止后续自动生成误覆盖）
  DOM.txtInstruction.addEventListener("input", () => {
    instructionFromStorage = false;
  });

  // 元素选择
  DOM.btnSelect.addEventListener("click", toggleSelectionMode);

  // 开始提取
  DOM.btnExtract.addEventListener("click", handleExtract);

  // 复制
  DOM.btnCopy.addEventListener("click", handleCopy);

  // 下载
  DOM.btnDownload.addEventListener("click", handleDownload);

  // 保存提取规则
  DOM.btnSaveRule.addEventListener("click", handleSaveRule);

  // 历史记录
  DOM.historyToggle.addEventListener("click", toggleHistory);
  DOM.btnClearHistory.addEventListener("click", handleClearHistory);

  // Enter 也可触发提取（Ctrl/Cmd + Enter）
  DOM.txtInstruction.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleExtract();
    }
  });
}

// ---- 加载保存的指令 ----
async function loadSavedInstruction() {
  try {
    const data = await chrome.storage.local.get("lastInstruction");
    if (data.lastInstruction) {
      DOM.txtInstruction.value = data.lastInstruction;
      instructionFromStorage = true;
    }
  } catch (_) { /* 忽略 */ }
}

// ---- 加载最大内容长度配置 ----
async function loadMaxContentLength() {
  try {
    const data = await chrome.storage.sync.get("maxContentLength");
    const limit = data.maxContentLength || 50000;
    DOM.contentLimit.textContent = limit.toLocaleString();
  } catch (_) { /* 忽略 */ }
}

// ---- 状态管理 ----
function setStatus(msg, type = "info") {
  DOM.statusBar.classList.remove("hidden", "success", "error");
  if (type === "success") DOM.statusBar.classList.add("success");
  if (type === "error")   DOM.statusBar.classList.add("error");
  DOM.statusText.textContent = msg;
}

function hideStatus() {
  DOM.statusBar.classList.add("hidden");
}

function setProgress(percent) {
  DOM.progressBar.classList.remove("hidden");
  DOM.progressFill.style.width = `${Math.min(percent, 100)}%`;
}

function hideProgress() {
  DOM.progressBar.classList.add("hidden");
  DOM.progressFill.style.width = "0%";
}

function showError(msg) {
  DOM.errorBanner.classList.remove("hidden");
  DOM.errorText.textContent = msg;
}

function hideError() {
  DOM.errorBanner.classList.add("hidden");
}

function showResult(jsonText) {
  DOM.emptyState.classList.add("hidden");
  DOM.resultSection.classList.remove("hidden");
  DOM.jsonOutput.textContent = jsonText;
}

function hideResult() {
  DOM.resultSection.classList.add("hidden");
  DOM.emptyState.classList.remove("hidden");
  DOM.jsonOutput.textContent = "";
}

// ---- 选择模式 ----
function listenForSelectionComplete() {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "selectionComplete") {
      // 工具栏"完成选择"按钮被点击
      isSelecting = false;
      updateSelectButton();
      checkSelectedElements();
    }
    if (request.type === "selectionCancelled") {
      isSelecting = false;
      updateSelectButton();
      selectedCount = 0;
    }
  });
}

async function checkSelectedElements() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    // 检查页面是否处于选择模式 + 获取选中元素的文本内容
    const selStatusResults = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        var tb = document.getElementById('we-extractor-toolbar');
        var els = document.querySelectorAll('[data-we-selected="true"]');
        var texts = [];
        for (var i = 0; i < els.length; i++) {
          var t = (els[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length > 0) texts.push(t.length > 300 ? t.substring(0, 297) + '...' : t);
        }
        return { toolbarActive: !!tb, selectedCount: els.length, selectedTexts: texts };
      },
    });
    if (selStatusResults && selStatusResults[0] && selStatusResults[0].result) {
      var status = selStatusResults[0].result;
      if (status.toolbarActive) {
        isSelecting = true;
        updateSelectButton();
        return;
      }
      if (status.selectedCount > 0) {
        selectedCount = status.selectedCount;

        // 手动选择的元素 — 隐藏自动检测的区域选择器
        clearAreaPicker();

        DOM.btnSelect.innerHTML =
          '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' +
          '已选 ' + selectedCount + ' 个';
        DOM.btnSelect.style.borderColor = "#16a34a";
        DOM.btnSelect.style.color = "#16a34a";
        DOM.btnExtract.textContent = "提取选中";
        DOM.btnExtract.style.background = "#16a34a";

        // 如果指令为空或是上次遗留的存储指令，根据选中元素自动生成提取指令
        if (status.selectedTexts && status.selectedTexts.length > 0) {
          if (!DOM.txtInstruction.value.trim() || instructionFromStorage) {
            autoGenerateInstruction(status.selectedTexts);
          }
        }
      } else if (!autoDetectionDone) {
        // 无选中元素 → 尝试自动检测主要内容区域
        autoDetectionDone = true;  // 先标记，避免重复触发
        setStatus("AI 正在分析页面结构，识别主要内容区域...", "info");
        try {
          await autoDetectAndSelectContent(tabs[0].id);
        } catch (autoErr) {
          // 自动检测失败不影响正常使用，用户可以手动选择
          hideStatus();
        }
      }
    }
  } catch (e) {
    // 忽略
  }
}

// ---- 根据选中元素自动生成提取指令 ----
async function autoGenerateInstruction(elementTexts) {
  try {
    // 显示生成中状态
    DOM.txtInstruction.value = "";
    DOM.txtInstruction.placeholder = "AI 正在根据选中元素生成提取指令...";
    DOM.txtInstruction.style.color = "#94a3b8";

    // 获取配置，使用简洁的纯文本 system prompt
    const config = await getConfig();
    if (!config.apiKey || !config.baseUrl) {
      // 未配置 API，用规则生成简单指令
      fallbackGenerateInstruction(elementTexts);
      return;
    }
    // 替换为纯文本指令生成的 system prompt（不要 JSON 约束）
    config.systemPrompt = "你是一个数据提取指令生成助手。根据用户提供的网页元素内容，生成简洁的数据提取指令。只输出指令文本。";

    // 构建元素文本摘要（最多 20 个元素，每个最多 300 字）
    var samples = elementTexts.slice(0, 20);
    var elementSample = "";
    for (var i = 0; i < samples.length; i++) {
      elementSample += "- " + samples[i] + "\n";
    }
    if (elementTexts.length > 20) {
      elementSample += "... (共 " + elementTexts.length + " 个元素)\n";
    }

    // 生成指令的 prompt
    var genPrompt =
      "根据以下用户选中的网页元素内容，生成一条简洁的中文数据提取指令。" +
      "指令应描述从类似页面中要提取哪些字段（如名称、价格、评分等）。" +
      "只输出指令文本，不要解释或标点包裹。\n\n" +
      "选中元素内容：\n" + elementSample;

    // 调用 LLM（纯文本输出，不加 JSON 格式约束）
    const rawResult = await callLLM(config, genPrompt, "", { skipJsonFormat: true });
    var instruction = (rawResult || "").trim();

    // 清理：去掉 LLM 可能添加的引号包裹
    instruction = instruction.replace(/^["'""\u201c\u201d](.*)["'""\u201c\u201d]$/, "$1").trim();

    if (instruction && instruction.length > 5) {
      DOM.txtInstruction.value = instruction;
      instructionFromStorage = false;  // AI 生成的内容，不属于旧存储
      setStatus("AI 已根据选中元素自动生成提取指令", "success");
      setTimeout(hideStatus, 3000);
    } else {
      fallbackGenerateInstruction(elementTexts);
    }
  } catch (e) {
    console.warn("Auto-generate instruction failed:", e);
    fallbackGenerateInstruction(elementTexts);
  } finally {
    DOM.txtInstruction.placeholder = "描述你需要提取的数据，例如：\n提取页面上所有酒店的名称、价格、评分、评价数量和是否包含早餐";
    DOM.txtInstruction.style.color = "";
  }
}

// ---- 规则兜底：根据元素文本关键词生成简单指令 ----
function fallbackGenerateInstruction(elementTexts) {
  var allText = elementTexts.join(" ");
  var fields = [];

  // 检测价格
  if (/[¥￥$€£]\s*\d|[\d.]+\s*元|[\d.]+\s*起/.test(allText)) fields.push("价格");
  // 检测日期
  if (/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(allText)) fields.push("日期");
  // 检测评分
  if (/[\d.]+分|[\d.]+条|评分/.test(allText)) fields.push("评分");
  // 检测数量/销量
  if (/(已售|销量|成交|订单)\s*[\d.]+万?/.test(allText)) fields.push("销量");
  // 检测中文名称（含常见模式）
  if (/[大中小双单家豪标经].*[床房间型]|房型|酒店|商品|产品/.test(allText)) fields.push("名称");
  // 检测数字百分比
  if (/\d+%/.test(allText)) fields.push("百分比");

  if (fields.length === 0) {
    // 无匹配特征，根据元素数量判断
    fields.push("名称", "主要内容");
    if (elementTexts.length > 3) fields.push("详细信息");
  }

  // 去重
  fields = fields.filter(function(v, i, arr) { return arr.indexOf(v) === i; });

  var instruction = "提取页面中被选中元素的" + fields.join("、") + "信息";

  DOM.txtInstruction.value = instruction;
  instructionFromStorage = false;  // 规则生成的内容，不属于旧存储
  setStatus("已根据元素内容自动填写提取指令（可自行修改）", "info");
  setTimeout(hideStatus, 3000);
}

function toggleSelectionMode() {
  if (isSelecting) {
    // 停止选择：同时尝试消息通知 + executeScript 清理
    isSelecting = false;
    updateSelectButton();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      // 尝试消息通知（兼容 content.js 方式启动的场景）
      try { chrome.tabs.sendMessage(tabs[0].id, { type: "stopSelection" }); } catch(e) {}
      // 直接注入清理代码（兼容 executeScript 方式启动的场景）
      chrome.scripting.executeScript(
        { target: { tabId: tabs[0].id }, func: cleanupSelectionMode },
        () => { /* 忽略结果 */ }
      );
    });
  } else {
    // 启动选择模式前，先清除自动检测的区域选择器
    clearAreaPicker();

    // 启动选择模式：直接通过 executeScript 注入（injectSelectionMode 内部会清理旧状态）
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        showError("无法获取当前标签页");
        return;
      }
      var tabId = tabs[0].id;

      chrome.scripting.executeScript(
        {
          target: { tabId: tabId },
          func: injectSelectionMode,
        },
        (results) => {
          if (chrome.runtime.lastError) {
            console.error('[WebExtractor] executeScript failed:', chrome.runtime.lastError.message);
            showError("注入失败：" + chrome.runtime.lastError.message + "。请刷新页面后重试。");
            return;
          }
          if (results && results[0] && results[0].result) {
            isSelecting = true;
            updateSelectButton();
            // 关闭 popup，让用户在页面上操作
            window.close();
          } else {
            showError("无法启动选择模式，请刷新页面后重试");
          }
        }
      );
    });
  }
}

/**
 * 通过 chrome.scripting.executeScript 注入页面的选择模式初始化函数
 * 必须完全自包含（不能引用外部变量）
 * @returns {boolean} 是否成功启动
 */
function injectSelectionMode() {
  // ============================================================
  // 全部内联，不依赖 content.js
  // 调试：将下方 false 改为 true 可查看选择模式控制台日志
  // ============================================================
  var _DBG = false;
  function _dbgLog(/*...*/) { if (_DBG) console.log.apply(console, arguments); }
  var SEL_ATTR = 'data-we-selected';
  var SEL_STYLE_ID = 'we-extractor-selection-style';
  var SEL_TOOLBAR_ID = 'we-extractor-toolbar';

  // 状态变量（闭包内）
  var _selActive = false;
  var _selHoverEl = null;
  var _selCountEl = null;
  var _selToolbar = null;

  try {
    // 安全检查
    if (!document.body || !document.head) {
      _dbgLog('[WebExtractor:inject] document.body or head is null');
      return false;
    }

    // 如果已经有一个工具栏，先移除
    var existing = document.getElementById(SEL_TOOLBAR_ID);
    if (existing) existing.remove();
    var existingStyle = document.getElementById(SEL_STYLE_ID);
    if (existingStyle) existingStyle.remove();
    document.body.classList.remove('we-selecting');
    var oldHover = document.querySelectorAll('.we-sel-hover');
    for (var i = 0; i < oldHover.length; i++) oldHover[i].classList.remove('we-sel-hover');

    // ---- 注入样式 ----
    var s = document.createElement('style');
    s.id = SEL_STYLE_ID;
    s.textContent = [
      'body.we-selecting, body.we-selecting * { cursor: crosshair !important; }',
      '.we-sel-hover { outline: 2px dashed #3b82f6 !important; outline-offset: -2px !important; background-color: rgba(59,130,246,0.08) !important; }',
      '[' + SEL_ATTR + '="true"] { outline: 3px solid #16a34a !important; outline-offset: -3px !important; background-color: rgba(22,163,74,0.1) !important; box-shadow: 0 0 0 6px rgba(22,163,74,0.08) !important; }',
      '[' + SEL_ATTR + '="true"].we-sel-hover { outline-color: #22c55e !important; }',
      '.we-sel-toolbar { position:fixed !important; bottom:20px !important; left:50% !important; transform:translateX(-50%) !important; z-index:2147483647 !important; background:#1e293b !important; color:#f1f5f9 !important; border-radius:12px !important; padding:10px 18px !important; display:flex !important; align-items:center !important; gap:10px !important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important; font-size:14px !important; box-shadow:0 4px 24px rgba(0,0,0,0.35) !important; pointer-events:auto !important; user-select:none !important; }',
      '.we-sel-toolbar .we-count { font-weight:700 !important; color:#22c55e !important; min-width:20px !important; text-align:center !important; }',
      '.we-sel-toolbar button { background:#334155 !important; color:#e2e8f0 !important; border:none !important; border-radius:8px !important; padding:7px 14px !important; cursor:pointer !important; font-size:13px !important; font-weight:500 !important; transition:background .15s !important; white-space:nowrap !important; }',
      '.we-sel-toolbar button:hover { background:#475569 !important; }',
      '.we-sel-toolbar .we-btn-done { background:#16a34a !important; color:#fff !important; }',
      '.we-sel-toolbar .we-btn-done:hover { background:#15803d !important; }',
      '.we-sel-toolbar .we-btn-clear { background:#b91c1c !important; }',
      '.we-sel-toolbar .we-btn-clear:hover { background:#991b1b !important; }',
    ].join('\n');
    document.head.appendChild(s);
    _dbgLog('[WebExtractor:inject] styles injected');

    // ---- 辅助函数 ----
    function _selIsSelectable(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') return false;
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') return false;
      if (el.closest('#' + SEL_STYLE_ID + ', #' + SEL_TOOLBAR_ID)) return false;
      return true;
    }

    function _selUpdateCount() {
      if (_selCountEl) {
        var n = document.querySelectorAll('[' + SEL_ATTR + '="true"]').length;
        _selCountEl.textContent = n;
      }
    }

    function _selClearAll() {
      var els = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
      for (var i = 0; i < els.length; i++) els[i].removeAttribute(SEL_ATTR);
      _selUpdateCount();
    }

    function _selCancel() {
      _selClearAll();
      _selActive = false;
      document.removeEventListener('mousemove', _selOnMouseMove, true);
      document.removeEventListener('click', _selOnClick, true);
      document.removeEventListener('mouseout', _selOnMouseOut, true);
      document.removeEventListener('keydown', _selOnKeyDown, true);
      if (_selToolbar) { _selToolbar.remove(); _selToolbar = null; }
      if (_selHoverEl) { try { _selHoverEl.classList.remove('we-sel-hover'); } catch(ee) {} _selHoverEl = null; }
      var hs = document.querySelectorAll('.we-sel-hover');
      for (var i = 0; i < hs.length; i++) hs[i].classList.remove('we-sel-hover');
      document.body.classList.remove('we-selecting');
      var s = document.getElementById(SEL_STYLE_ID);
      if (s) s.remove();
      // 通知 background 打开 popup 面板
      try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {}
    }

    function _selComplete() {
      _selActive = false;
      document.removeEventListener('mousemove', _selOnMouseMove, true);
      document.removeEventListener('click', _selOnClick, true);
      document.removeEventListener('mouseout', _selOnMouseOut, true);
      document.removeEventListener('keydown', _selOnKeyDown, true);
      if (_selToolbar) { _selToolbar.remove(); _selToolbar = null; }
      if (_selHoverEl) { try { _selHoverEl.classList.remove('we-sel-hover'); } catch(ee) {} _selHoverEl = null; }
      var hs = document.querySelectorAll('.we-sel-hover');
      for (var i = 0; i < hs.length; i++) hs[i].classList.remove('we-sel-hover');
      document.body.classList.remove('we-selecting');
      var s = document.getElementById(SEL_STYLE_ID);
      if (s) s.remove();
      // 通知 background 打开 popup 面板
      try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {}
    }

    function _selOnMouseMove(e) {
      if (!_selActive) return;
      var target = e.target;
      if (!_selIsSelectable(target)) return;
      if (_selHoverEl !== target) {
        if (_selHoverEl) { try { _selHoverEl.classList.remove('we-sel-hover'); } catch(ee) {} }
        _selHoverEl = target;
        try { target.classList.add('we-sel-hover'); } catch(ee) {}
      }
    }

    function _selOnClick(e) {
      if (!_selActive) return;
      var target = e.target;
      if (!_selIsSelectable(target)) return;
      e.preventDefault();
      e.stopPropagation();
      try { target.classList.remove('we-sel-hover'); } catch(ee) {}
      if (target.getAttribute(SEL_ATTR) === 'true') {
        target.removeAttribute(SEL_ATTR);
      } else {
        target.setAttribute(SEL_ATTR, 'true');
      }
      _selUpdateCount();
    }

    function _selOnMouseOut(e) {
      try { var el = e.target; if (el && el.nodeType === 1) el.classList.remove('we-sel-hover'); } catch(ee) {}
    }

    function _selOnKeyDown(e) {
      if (!_selActive) return;
      if (e.key === 'Escape') { e.preventDefault(); _selCancel(); }
    }

    // ---- 创建工具栏 ----
    var tb = document.createElement('div');
    tb.id = SEL_TOOLBAR_ID;
    tb.className = 'we-sel-toolbar';
    tb.setAttribute('data-we-extension', 'true');
    tb.innerHTML =
      '<span>已选: <span class="we-count" id="we-sel-count">0</span> 个元素</span>' +
      '<button class="we-btn-clear" id="we-btn-clear">清除</button>' +
      '<button id="we-btn-cancel">取消</button>' +
      '<button class="we-btn-done" id="we-btn-done">完成选择</button>';
    document.body.appendChild(tb);
    _dbgLog('[WebExtractor:inject] toolbar appended to body');

    document.getElementById('we-btn-done').addEventListener('click', _selComplete);
    document.getElementById('we-btn-cancel').addEventListener('click', _selCancel);
    document.getElementById('we-btn-clear').addEventListener('click', _selClearAll);
    _selCountEl = document.getElementById('we-sel-count');
    _selToolbar = tb;

    // ---- 激活 ----
    _selActive = true;
    document.body.classList.add('we-selecting');
    document.addEventListener('mousemove', _selOnMouseMove, true);
    document.addEventListener('click', _selOnClick, true);
    document.addEventListener('mouseout', _selOnMouseOut, true);
    document.addEventListener('keydown', _selOnKeyDown, true);
    _selUpdateCount();

    _dbgLog('[WebExtractor:inject] selection mode started successfully, toolbar visible');
    return true;
  } catch(e) {
    _dbgLog('[WebExtractor:inject] error:', e);
    return false;
  }
}

/**
 * 清理选择模式 UI（注入执行，兼容两种启动方式）
 */
function cleanupSelectionMode() {
  try {
    var SEL_ATTR = 'data-we-selected';
    var SEL_STYLE_ID = 'we-extractor-selection-style';
    var SEL_TOOLBAR_ID = 'we-extractor-toolbar';
    var AUTO_STYLE_ID = 'we-auto-select-style';

    // 移除工具栏
    var tb = document.getElementById(SEL_TOOLBAR_ID);
    if (tb) tb.remove();

    // 移除样式
    var s = document.getElementById(SEL_STYLE_ID);
    if (s) s.remove();

    // 移除自动选择样式
    var as = document.getElementById(AUTO_STYLE_ID);
    if (as) as.remove();

    // 移除 body class
    document.body.classList.remove('we-selecting');

    // 移除所有 hover 样式
    var hs = document.querySelectorAll('.we-sel-hover');
    for (var i = 0; i < hs.length; i++) hs[i].classList.remove('we-sel-hover');

    // 清理自动选中元素的样式
    var selected = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
    for (var j = 0; j < selected.length; j++) {
      selected[j].removeAttribute(SEL_ATTR);
      selected[j].style.outline = '';
      selected[j].style.boxShadow = '';
      selected[j].style.backgroundColor = '';
      selected[j].style.borderRadius = '';
    }

    _dbgLog('[WebExtractor:cleanup] selection mode cleaned up');
  } catch(e) {
    _dbgLog('[WebExtractor:cleanup] error:', e);
  }
}

function updateSelectButton() {
  if (isSelecting) {
    DOM.btnSelect.innerHTML =
      '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '退出选择';
    DOM.btnSelect.style.borderColor = "#dc2626";
    DOM.btnSelect.style.color = "#dc2626";
  } else if (selectedCount > 0) {
    DOM.btnSelect.innerHTML =
      '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' +
      '已选 ' + selectedCount + ' 个';
    DOM.btnSelect.style.borderColor = "#16a34a";
    DOM.btnSelect.style.color = "#16a34a";
    DOM.btnExtract.textContent = "提取选中";
    DOM.btnExtract.style.background = "#16a34a";
  } else {
    DOM.btnSelect.innerHTML =
      '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' +
      '选择元素';
    DOM.btnSelect.style.borderColor = "";
    DOM.btnSelect.style.color = "";
    DOM.btnExtract.textContent = "开始提取";
    DOM.btnExtract.style.background = "";
  }
}

// ---- 提取历史管理 ----
const HISTORY_KEY = "extractionHistory";
const MAX_HISTORY = 50;

async function loadHistory() {
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    historyItems = data[HISTORY_KEY] || [];
  } catch (_) {
    historyItems = [];
  }
  renderHistory();
}

async function saveHistory() {
  try {
    await chrome.storage.local.set({ [HISTORY_KEY]: historyItems });
  } catch (_) { /* 存储满时静默忽略 */ }
}

function renderHistory() {
  DOM.historyCount.textContent = historyItems.length > 0 ? `(${historyItems.length})` : "";
  DOM.btnClearHistory.classList.toggle("hidden", historyItems.length === 0);

  if (historyItems.length === 0) {
    DOM.historyEmpty.classList.remove("hidden");
    DOM.historyItems.innerHTML = "";
    return;
  }

  DOM.historyEmpty.classList.add("hidden");
  var html = "";
  for (var i = historyItems.length - 1; i >= 0; i--) {
    var item = historyItems[i];
    var name = escapeHTML(item.name || "未命名规则");
    var inst = escapeHTML(truncate(item.instruction, 60));
    var date = formatDate(item.createdAt);
    var useInfo = item.useCount > 1 ? " | 使用 " + item.useCount + " 次" : "";

    html +=
      '<div class="history-item" data-id="' + item.id + '">' +
        '<div class="history-item-info">' +
          '<div class="history-item-name" title="' + escapeHTML(item.instruction) + '">' + name + '</div>' +
          '<div class="history-item-meta">' +
            '<span title="' + escapeHTML(item.instruction) + '">' + inst + '</span>' +
            '<span>' + date + useInfo + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="history-item-actions">' +
          '<button class="h-btn-apply" data-action="apply" data-id="' + item.id + '">应用</button>' +
          '<button class="h-btn-delete" data-action="delete" data-id="' + item.id + '">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<polyline points="3 6 5 6 21 6"></polyline>' +
              '<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>';
  }
  DOM.historyItems.innerHTML = html;

  // 事件委托：避免为每个按钮单独绑定
  DOM.historyItems.querySelectorAll("[data-action]").forEach(function(btn) {
    btn.addEventListener("click", function(e) {
      e.stopPropagation();
      var id = parseInt(this.dataset.id, 10);
      if (this.dataset.action === "apply") applyHistoryItem(id);
      else if (this.dataset.action === "delete") deleteHistoryItem(id);
    });
  });
}

function toggleHistory() {
  historyOpen = !historyOpen;
  DOM.historyList.classList.toggle("hidden", !historyOpen);
  DOM.historyToggle.querySelector(".history-chevron").classList.toggle("open", historyOpen);
}

async function applyHistoryItem(id) {
  var item = historyItems.find(function(it) { return it.id === id; });
  if (!item) return;

  DOM.txtInstruction.value = item.instruction;
  DOM.txtInstruction.focus();

  // 更新使用次数
  item.useCount = (item.useCount || 0) + 1;
  item.lastUsed = new Date().toISOString();
  await saveHistory();
  renderHistory();

  // 短暂高亮提示
  flashElement(DOM.txtInstruction);
}

async function deleteHistoryItem(id) {
  historyItems = historyItems.filter(function(it) { return it.id !== id; });
  await saveHistory();
  renderHistory();
}

async function handleClearHistory() {
  if (!confirm("确定要清除全部提取历史吗？此操作不可撤销。")) return;
  historyItems = [];
  await saveHistory();
  renderHistory();
}

async function handleSaveRule() {
  if (!lastSavedInstruction) return;

  var instruction = lastSavedInstruction;

  // 去重：相同指令不重复保存
  var existing = historyItems.find(function(it) {
    return it.instruction === instruction;
  });
  if (existing) {
    // 已有相同规则，更新最后使用时间
    existing.useCount = (existing.useCount || 0) + 1;
    existing.lastUsed = new Date().toISOString();
    await saveHistory();
    renderHistory();
    showSaveRuleFeedback("规则已更新");
    return;
  }

  // 截取指令前 40 字符作为名称
  var name = instruction.length > 40
    ? instruction.substring(0, 40).replace(/\n/g, " ") + "..."
    : instruction.replace(/\n/g, " ");

  historyItems.push({
    id: Date.now(),
    name: name,
    instruction: instruction,
    systemPrompt: lastSavedSystemPrompt || null,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    useCount: 1,
  });

  // 限制历史数量
  if (historyItems.length > MAX_HISTORY) {
    historyItems = historyItems.slice(-MAX_HISTORY);
  }

  await saveHistory();
  renderHistory();
  showSaveRuleFeedback("规则已保存");
}

function showSaveRuleFeedback(msg) {
  var origHTML = DOM.btnSaveRule.innerHTML;
  DOM.btnSaveRule.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg> ' + msg;
  DOM.btnSaveRule.style.color = "#16a34a";
  DOM.btnSaveRule.style.borderColor = "#16a34a";
  setTimeout(function() {
    DOM.btnSaveRule.innerHTML = origHTML;
    DOM.btnSaveRule.style.color = "";
    DOM.btnSaveRule.style.borderColor = "";
  }, 2000);
}

function updateSaveRuleButton() {
  if (lastSavedInstruction) {
    DOM.btnSaveRule.classList.remove("hidden");
  }
}

// ---- 工具函数 ----
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(str, max) {
  if (!str) return "";
  str = str.replace(/\n/g, " ");
  return str.length > max ? str.substring(0, max) + "..." : str;
}

function formatDate(iso) {
  if (!iso) return "";
  var d = new Date(iso);
  var now = new Date();
  var diffMs = now - d;
  var diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "刚刚";
  if (diffMin < 60) return diffMin + " 分钟前";
  var diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return diffHour + " 小时前";
  var diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return diffDay + " 天前";
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return m + "/" + day;
}

function flashElement(el) {
  el.style.transition = "background 0.15s";
  el.style.background = "#eef2ff";
  setTimeout(function() { el.style.background = ""; }, 400);
}

// ---- 核心流程：提取 ----
async function handleExtract() {
  const instruction = DOM.txtInstruction.value.trim();
  if (!instruction) {
    DOM.txtInstruction.focus();
    showError("请输入提取指令");
    return;
  }

  // 保存指令
  chrome.storage.local.set({ lastInstruction: instruction }).catch(() => {});

  // 重置 UI
  hideError();
  hideResult();
  hideProgress();
  DOM.btnExtract.disabled = true;
  DOM.btnScrollHint.classList.remove("hidden");

  try {
    // 1. 获取配置
    setStatus("正在读取配置...", "info");
    const config = await getConfig();
    if (!config.apiKey) {
      showError("请先在设置页面配置 API Key");
      setStatus("未配置 API Key", "error");
      return;
    }
    if (!config.baseUrl) {
      showError("请先在设置页面配置 Base URL");
      setStatus("未配置 Base URL", "error");
      return;
    }

    // 2. 注入 content script 提取页面内容
    var isSelectedExtract = (selectedCount > 0);
    setStatus(isSelectedExtract ? `正在提取 ${selectedCount} 个选中元素的快照...` : "正在生成页面快照...", "info");
    setProgress(10);

    const maxContentLength = await getMaxContentLength();
    const content = await extractPageContent(maxContentLength, isSelectedExtract);

    if (!content || content.trim().length === 0) {
      showError("未能生成有效快照，请确认页面已加载完成");
      setStatus("快照为空", "error");
      return;
    }

    setProgress(30);
    setStatus(`快照 ${content.length.toLocaleString()} 字符，正在调用 LLM 分析...`, "info");

    // 3. 调用 LLM
    setProgress(40);
    const result = await callLLM(config, instruction, content);
    setProgress(90);

    // 4. 解析并展示结果
    const jsonText = formatJSON(result);
    showResult(jsonText);
    setStatus("提取完成", "success");
    setProgress(100);

    // 记录本次提取的规则（供保存按钮使用）
    lastSavedInstruction = instruction;
    lastSavedSystemPrompt = config.systemPrompt;
    updateSaveRuleButton();

    // 5. 提取完成后清除选中标记
    if (isSelectedExtract) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, { type: "clearSelection" });
      } catch(e) {}
      selectedCount = 0;
      updateSelectButton();
    }

  } catch (err) {
    console.error("Extraction error:", err);
    showError(`提取失败：${err.message}`);
    setStatus("提取失败", "error");
  } finally {
    DOM.btnExtract.disabled = false;
    DOM.btnScrollHint.classList.add("hidden");
    setTimeout(() => {
      hideStatus();
      hideProgress();
    }, 3000);
  }
}

// ---- 获取配置 ----
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      ["apiKey", "baseUrl", "modelName", "systemPrompt", "maxContentLength"],
      (data) => {
        resolve({
          apiKey:          data.apiKey          || "",
          baseUrl:         data.baseUrl         || "",
          modelName:       data.modelName       || "gpt-4o",
          systemPrompt:    data.systemPrompt    || getDefaultSystemPrompt(),
          maxContentLength: data.maxContentLength || 50000,
        });
      }
    );
  });
}

async function getMaxContentLength() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("maxContentLength", (data) => {
      resolve(data.maxContentLength || 50000);
    });
  });
}

// ---- 提取页面内容 ----
async function extractPageContent(maxLength, _selectedOnly) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        return reject(new Error("无法获取当前标签页"));
      }

      const tabId = tabs[0].id;

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: extractContentFromDOM,
          args: [maxLength],
        },
        (results) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!results || results.length === 0 || !results[0].result) {
            return reject(new Error("内容提取返回为空"));
          }
          resolve(results[0].result);
        }
      );
    });
  });
}

/**
 * 此函数会被注入到目标页面执行
 * 因此必须完全自包含（不能引用外部变量）
 *
 * 增强版方案：
 *   1. 智能等待动态内容加载（SPA/SSR 页面）
 *   2. 提取 SSR 内嵌数据（__NEXT_DATA__、__NFES_DATA__、JSON-LD 等）
 *   3. 仿 Playwright Accessibility Snapshot，输出 YAML 风格的可访问性树
 *
 * 每行格式：缩进 + 角色 + "文本内容"
 *   容器节点：  - banner / - main / - navigation / - list / - listitem / - group
 *   内容节点：  - heading [h1] "标题" / - link "文本" [url] / - text "纯文本"
 *   表格节点：  - table / - row / - cell "内容" / - cell [th] "表头"
 */
async function extractContentFromDOM(maxLength) {
  // ================================================================
  // 所有辅助函数全部内嵌在此，确保 executeScript 注入后可用
  //
  // 编码规范说明：
  //  - 使用 var 而非 let/const：executeScript 注入代码需兼容旧版浏览器引擎（如部分 WebView）
  //  - 空 catch(e) {} 是有意的：DOM 提取逻辑运行在不可控的外部页面中，
  //    访问跨域 iframe、被 CORS/CSP 阻止的属性、已移除或权限受限的 DOM 节点
  //    都会触发预期内的异常，这些错误不影响数据提取，无需上报
  // ================================================================

  // ---- 缩进工具 ----
  function $sp(n) { var s = ""; for (var j = 0; j < n; j++) s += "  "; return s; }

  // ---- 字符串工具 ----
  function $esc(s, limit) {
    if (!s) return "";
    limit = limit || 800;
    s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
    if (s.length > limit) s = s.substring(0, limit - 3) + "...";
    return s;
  }

  // ---- YAML 化 JS 对象 ----
  function $yaml(obj, depth, maxDepth, maxStrLen) {
    maxStrLen = maxStrLen || 300;
    if (depth > maxDepth) return $sp(depth) + "...";
    var indent = $sp(depth);
    if (obj === null || obj === undefined) return indent + "null";
    if (typeof obj === "string") return indent + '"' + $esc(obj, maxStrLen) + '"';
    if (typeof obj === "number" || typeof obj === "boolean") return indent + String(obj);
    if (Array.isArray(obj)) {
      if (obj.length === 0) return indent + "[]";
      var allSimple = true;
      for (var ai = 0; ai < obj.length; ai++) { if (typeof obj[ai] === "object" && obj[ai] !== null) { allSimple = false; break; } }
      if (allSimple) {
        var vals = [];
        for (var ai = 0; ai < Math.min(obj.length, 20); ai++) { vals.push(typeof obj[ai] === "string" ? '"' + $esc(obj[ai], 50) + '"' : String(obj[ai])); }
        return indent + "[ " + vals.join(", ") + (obj.length > 20 ? " ... (" + (obj.length - 20) + " more)" : "") + " ]";
      }
      var lns = [indent + "-"];
      var lim = Math.min(obj.length, 50);
      for (var ai = 0; ai < lim; ai++) { lns.push($yaml(obj[ai], depth + 1, maxDepth, maxStrLen)); }
      if (obj.length > lim) lns.push($sp(depth + 1) + "... (" + (obj.length - lim) + " more items)");
      return lns.join("\n");
    }
    if (typeof obj === "object") {
      var keys = Object.keys(obj);
      if (keys.length === 0) return indent + "{}";
      var lns = []; var lim = Math.min(keys.length, 30);
      for (var i = 0; i < lim; i++) {
        var k = keys[i], v = obj[k];
        if (typeof v === "object" && v !== null) { lns.push(indent + k + ":"); lns.push($yaml(v, depth + 1, maxDepth, maxStrLen)); }
        else if (typeof v === "string") { lns.push(indent + k + ': "' + $esc(v, maxStrLen) + '"'); }
        else { lns.push(indent + k + ": " + String(v)); }
      }
      if (keys.length > lim) lns.push(indent + "... (" + (keys.length - lim) + " more keys)");
      return lns.join("\n");
    }
    return indent + String(obj);
  }

  // ---- 元素可见性检测（轻量版） ----
  function $isVis(el) {
    if (!el) return false;
    try { var r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) return false;
      var s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false; return true; }
    catch(e) { return false; }
  }

  // ---- SSR 数据检测 ----
  function $detectSSR() {
    try {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
        var pp = window.__NEXT_DATA__.props.pageProps || {};
        var dk = Object.keys(pp).filter(function(k) { return k !== "pathname" && k !== "asPath" && k !== "query"; });
        if (dk.length > 0) return { found: true, type: "nextjs", keys: dk };
      }
      if (window.__NUXT__) return { found: true, type: "nuxt" };
      var jld = document.querySelectorAll('script[type="application/ld+json"]');
      if (jld.length > 0) { var cnt = 0; for (var i = 0; i < jld.length; i++) { try { JSON.parse(jld[i].textContent); cnt++; } catch(e) {} } if (cnt > 0) return { found: true, type: "jsonld", count: cnt }; }
      if (window.__NFES_DATA__) return { found: true, type: "nfes_data" };
    } catch(e) {}
    return { found: false };
  }

  // ---- 扫描包含特定数据的元素（更宽松的匹配） ----
  function $scanDataElements() {
    var result = { textBlocks: 0, dataCount: 0 };
    try {
      // 扫描所有可见的 div/section 中文字较多的元素（数据内容的通用特征）
      var allDivs = document.querySelectorAll("div, section");
      for (var i = 0; i < allDivs.length; i++) {
        if (!$isVis(allDivs[i])) continue;
        var txt = (allDivs[i].textContent || "").trim();
        if (txt.length > 80) result.textBlocks++;
        // 检测数字 + 文本（价格/数据特征）
        if (txt.length > 30 && /[¥￥$]\s*\d/.test(txt)) result.dataCount++;
        if (result.textBlocks > 10) break;
      }
    } catch(e) {}
    return result;
  }

  // ---- 快速内容检查（修复：SSR 数据不再独占高分，需要实际可见内容）----
  function $quickCheck() {
    var sources = []; var score = 0;
    var ssr = $detectSSR();
    if (ssr.found) { sources.push("ssr_embedded_data(" + ssr.type + ")"); score += 2; }
    // 扫描数据元素（可见的、文本较多的 div/section）
    var scan = $scanDataElements();
    if (scan.dataCount > 0) { sources.push("price_text_found:" + scan.dataCount); score += 2; }
    if (scan.textBlocks > 5) { sources.push("dense_content:" + scan.textBlocks); score += 1; }
    // 列表/卡片选择器（更宽泛的匹配，覆盖 CSS Modules 的散列类名）
    var listSels = [
      ".room-list", ".room-item", ".room-type", "[data-room-id]",
      ".product-list", ".product-item", ".item-list",
      ".search-result", ".result-item",
      ".comment-list", ".review-list", ".review-item",
      "table tbody tr", ".data-table tr",
      ".price-item", ".rate-item", "[data-price]",
      ".hotel-info", ".hotel-detail",
      // 匹配 class 名包含 room/price/hotel/detail/product 的元素
      '[class*="roomItem"]', '[class*="RoomItem"]', '[class*="room-item"]',
      '[class*="priceRow"]', '[class*="PriceRow"]', '[class*="price-row"]',
      '[class*="hotelDetail"]', '[class*="HotelDetail"]',
      '[class*="productCard"]', '[class*="ProductCard"]', '[class*="product-card"]',
      // 携程常见特征
      '[class*="tableList"]', '[class*="TableList"]',
      '[class*="listItem"]', '[class*="ListItem"]',
      '[class*="cardBox"]', '[class*="CardBox"]',
    ];
    for (var si = 0; si < listSels.length && score < 5; si++) {
      try { var els = document.querySelectorAll(listSels[si]); for (var ej = 0; ej < els.length; ej++) { if ($isVis(els[ej])) { sources.push("selector:" + listSels[si]); score += 3; break; } } } catch(e) {}
    }
    var keySels = [".score", ".rating", ".star", "[data-score]", ".price", ".amount", ".cost", "[data-price]", ".address", ".location", ".facility", ".amenity", ".review-score", ".review-count"];
    for (var ki = 0; ki < keySels.length; ki++) {
      try { var el = document.querySelector(keySels[ki]); if (el && $isVis(el) && (el.textContent || "").trim().length > 0) { sources.push("keydata:" + keySels[ki]); score += 1; } } catch(e) {}
    }
    try { if ((document.body ? document.body.innerText || "" : "").trim().length > 500) score += 1; } catch(e) {}
    // 需要 score >= 5 才认为就绪（SSR 仅 2 分，必须等客户端数据）
    return { ready: score >= 5, score: score, sources: sources };
  }

  // ---- 判断是否动态页面 ----
  function $isDynamicPage() {
    try {
      if (document.getElementById("__next") || window.__NEXT_DATA__) return true;
      if (document.getElementById("__nuxt") || window.__NUXT__) return true;
      var root = document.getElementById("root") || document.getElementById("app");
      if (root && root.children.length > 0 && (root.innerText || "").trim().length < 100) return true;
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__) return true;
      var sc = document.querySelectorAll('script[src*="_next/"], script[src*="chunk"], script[src*="bundle"]');
      if (sc.length > 2) return true;
    } catch(e) {}
    return false;
  }

  // ---- 恢复网络监听器 ----
  function $restoreMonitors(f, xo, xs) { try { if (f) window.fetch = f; } catch(e) {} try { if (xo) XMLHttpRequest.prototype.open = xo; } catch(e) {} try { if (xs) XMLHttpRequest.prototype.send = xs; } catch(e) {} }

  // ---- Promise-based sleep (不阻塞主线程) ----
  function $sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // ---- 选中元素检测 ----
  var SEL_ATTR = 'data-we-selected';
  var selectedEls = [];
  var selectedOnly = false;
  try {
    var allSel = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
    if (allSel.length > 0) {
      selectedOnly = true;
      for (var si = 0; si < allSel.length; si++) {
        if ($isVis(allSel[si])) selectedEls.push(allSel[si]);
      }
    }
  } catch(e) {}

  // ---- 受限扫描（仅在指定根元素内查找） ----
  function $scanDataInRoots(roots) {
    var lines = []; var MAX_ITEMS = 40; var count = 0;
    var pp = /[¥￥$€£]\s*\d[\d,.]*|(\d[\d,.]*)\s*(起|元|晚|起\/晚|元起|元\/晚)/;
    for (var ri = 0; ri < roots.length && count < MAX_ITEMS; ri++) {
      try {
        var allEls = roots[ri].querySelectorAll("div, h3, h4, p, span, li, dt, dd, td, th");
        var cands = [];
        for (var ei = 0; ei < allEls.length; ei++) {
          var el = allEls[ei];
          if (!$isVis(el)) continue;
          var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (txt.length < 8 || txt.length > 300) continue;
          cands.push({ el: el, text: txt });
        }
        for (var ci = 0; ci < cands.length && count < MAX_ITEMS; ci++) {
          var c = cands[ci];
          if (!pp.test(c.text)) continue;
          var label = "";
          var el = c.el;
          var prev = el.previousElementSibling;
          for (var pi = 0; pi < 3 && prev; pi++) {
            var pTag = prev.tagName.toLowerCase();
            var pText = (prev.textContent || "").replace(/\s+/g, " ").trim();
            if (pTag.match(/^h[1-6]$/) && pText.length > 0) { label = pText; break; }
            if (pText.length > 0 && pText.length <= 100 && !pp.test(pText)) { label = pText; break; }
            prev = prev.previousElementSibling;
          }
          var item = "  [" + (count + 1) + "]";
          if (label) item += ' label: "' + $esc(label, 300) + '"';
          item += ' data: "' + $esc(c.text, 600) + '"';
          lines.push(item); count++;
        }
      } catch(e) {}
    }
    return lines.join("\n");
  }

  // ---- 受限树遍历（仅遍历指定根元素） ----
  function $walkRoots(roots, remaining) {
    var tLines = []; var tTotal = 0; var hit = false;
    function tSp(n) { var s = ""; for (var j = 0; j < n; j++) s += "  "; return s; }
    function tEmit(depth, text) { if (hit) return false; var line = tSp(depth) + text; if (tTotal + line.length + 1 > remaining) { hit = true; return false; } tLines.push(line); tTotal += line.length + 1; return true; }
    function tVisible(el) {
      if (!el || el.nodeType !== 1) return false; var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      if (el !== document.body && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      if (el.getAttribute("aria-hidden") === "true") return false; if (el.hasAttribute("hidden")) return false; return true;
    }
    var T_LANDMARK = { header: "banner", main: "main", nav: "navigation", footer: "contentinfo", aside: "complementary", form: "form" };
    var T_SKIP = { script: 1, style: 1, svg: 1, noscript: 1, iframe: 1, canvas: 1, video: 1, audio: 1, template: 1, link: 1, meta: 1, br: 1, hr: 1, wbr: 1 };
    var T_LEAF = { button: 1, input: 1, textarea: 1, select: 1, img: 1, label: 1 };
    function tRoleOf(el) {
      var tag = el.tagName.toLowerCase(); var explicit = el.getAttribute("role"); if (explicit) return explicit;
      if (T_LANDMARK.hasOwnProperty(tag)) return T_LANDMARK[tag];
      var h = tag.match(/^h([1-6])$/); if (h) return "heading [h" + h[1] + "]";
      switch (tag) { case "a": return "link"; case "ul": case "ol": return "list"; case "li": return "listitem"; case "button": return "button"; case "table": return "table"; case "tr": return "row"; case "td": return "cell"; case "th": return "cell [th]"; case "img": return "image"; case "input": return "textbox"; case "textarea": return "textbox"; case "select": return "combobox"; case "p": return "paragraph"; case "label": return "label"; default: return ""; }
    }
    function tDirectText(el) { var t = ""; for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent; } return t.replace(/\s+/g, " ").trim(); }
    function tEsc(s, limit) { if (!s) return ""; limit = limit || 500; s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t"); if (s.length > limit) s = s.substring(0, limit - 3) + "..."; return s; }
    function tLinkHref(el) { var h = (el.getAttribute("href") || "").trim(); if (!h || h.toLowerCase().startsWith("javascript:")) return ""; if (h.length > 500) h = h.substring(0, 497) + "..."; return h; }
    function tWalk(node, depth) {
      if (hit || depth > 12) return;
      if (node.nodeType === 3) { var t = node.textContent.replace(/\s+/g, " ").trim(); if (t) tEmit(depth, 'text "' + tEsc(t) + '"'); return; }
      if (node.nodeType !== 1) return; if (!tVisible(node)) return;
      var tag = node.tagName.toLowerCase(); if (T_SKIP.hasOwnProperty(tag)) return;
      var role = tRoleOf(node); var isLeaf = T_LEAF.hasOwnProperty(tag);
      var hasVisChildren = false;
      if (!isLeaf) { for (var i = 0; i < node.children.length; i++) { var c = node.children[i]; if (tVisible(c) && !T_SKIP.hasOwnProperty(c.tagName.toLowerCase())) { hasVisChildren = true; break; } } }
      if (!hasVisChildren || isLeaf) {
        var text = "", href = "";
        if (tag === "img") { text = (node.getAttribute("alt") || node.getAttribute("title") || "").trim(); }
        else if (tag === "a") { text = tDirectText(node); href = tLinkHref(node); }
        else if (tag === "input") { text = (node.getAttribute("placeholder") || node.getAttribute("value") || node.getAttribute("name") || "").trim(); }
        else { text = tDirectText(node); }
        if (text) { if (!role) role = "text"; var line = role; if (tag === "a" && href) { line += ' "' + tEsc(text) + '" [' + tEsc(href, 500) + ']'; } else { line += ' "' + tEsc(text) + '"'; } tEmit(depth, line); }
      } else {
        if (!role) role = "group"; if (!tEmit(depth, role)) return;
        for (var i = 0; i < node.childNodes.length; i++) { tWalk(node.childNodes[i], depth + 1); if (hit) return; }
      }
    }
    for (var ri = 0; ri < roots.length; ri++) {
      if (ri > 0) tEmit(0, "---");
      tWalk(roots[ri], 1);
      if (hit) break;
    }
    var snap = tLines.join("\n");
    if (hit) snap += "\n... (snapshot truncated at length limit)";
    return snap;
  }

  // ================================================================
  // Phase 0: 智能等待动态内容加载（非阻塞版本）
  // 选中模式下跳过等待——用户已主动选择了渲染完成的元素
  // ================================================================
  var timeoutMs = 15000;
  var waitResult;

  if (selectedOnly) {
    waitResult = { ready: true, waited: 0, dataSources: ["user_selected_elements"], reason: "user_selected" };
  } else {
  var qc = $quickCheck();
  if (qc.ready) {
    waitResult = { ready: true, waited: 0, dataSources: qc.sources, reason: "content_already_loaded" };
  } else if (!$isDynamicPage()) {
    waitResult = { ready: true, waited: 0, dataSources: [], reason: "static_page" };
  } else {
    var pendingRequests = 0;
    var apiUrls = [];
    var origFetch = null, origXOpen = null, origXSend = null;
    try {
      origFetch = window.fetch;
      window.fetch = function() { pendingRequests++; var p = origFetch.apply(this, arguments); p.finally(function() { pendingRequests = Math.max(0, pendingRequests - 1); }); return p; };
    } catch(e) {}
    try {
      origXOpen = XMLHttpRequest.prototype.open;
      origXSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(_m, url) { this.__xUrl = url; return origXOpen.apply(this, arguments); };
      XMLHttpRequest.prototype.send = function() { var s = this; pendingRequests++; s.addEventListener("loadend", function() { pendingRequests = Math.max(0, pendingRequests - 1); if (s.__xUrl) apiUrls.push(s.__xUrl); }); return origXSend.apply(this, arguments); };
    } catch(e) {}

    var startTime = Date.now();
    var lastLen = 0, stableCount = 0;
    // 非阻塞轮询（每次等待 400ms，给浏览器渲染线程时间）
    while (Date.now() - startTime < timeoutMs) {
      var ck = $quickCheck();
      var curLen = document.body ? document.body.innerHTML.length : 0;
      if (ck.ready) { $restoreMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: Date.now() - startTime, dataSources: ck.sources.concat(apiUrls), reason: "content_detected" }; break; }
      if (curLen === lastLen) { stableCount++; if (stableCount >= 5 && pendingRequests === 0) { $restoreMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: Date.now() - startTime, dataSources: apiUrls, reason: "content_stable" }; break; } }
      else { stableCount = 0; lastLen = curLen; }
      // 非阻塞等待：释放主线程让 React 渲染
      await $sleep(400);
    }
    if (!waitResult) { $restoreMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: timeoutMs, dataSources: apiUrls, reason: "timeout" }; }
  }
  } // end else (selectedOnly)

  // ================================================================
  // Phase 1: 提取 SSR 内嵌数据（选中模式下跳过——用户自己选了元素）
  // ================================================================
  var ssrLines = [];
  if (!selectedOnly) {
    try {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
        ssrLines.push("=== SSR Data: Next.js (__NEXT_DATA__.props.pageProps) ===");
        ssrLines.push($yaml(window.__NEXT_DATA__.props.pageProps, 0, 8, 500));
      }
    } catch(e) {}
    try {
      if (window.__NFES_DATA__) {
        var nd = window.__NFES_DATA__; var rel = {};
        if (nd.hotelDetailResponse) rel.hotelDetailResponse = nd.hotelDetailResponse;
        if (nd.props && nd.props.pageProps) rel.pageProps = nd.props.pageProps;
        if (nd.query) rel.query = nd.query;
        if (Object.keys(rel).length > 0) { ssrLines.push("=== SSR Data: NFES (__NFES_DATA__) ==="); ssrLines.push($yaml(rel, 0, 6, 500)); }
      }
    } catch(e) {}
    try {
      var jldEls = document.querySelectorAll('script[type="application/ld+json"]');
      if (jldEls.length > 0) { ssrLines.push("=== SSR Data: JSON-LD ==="); for (var i = 0; i < jldEls.length; i++) { try { ssrLines.push("# Item " + (i + 1)); ssrLines.push($yaml(JSON.parse(jldEls[i].textContent), 0, 5, 500)); } catch(e) { ssrLines.push("# Item " + (i + 1) + " (parse error)"); } } }
    } catch(e) {}
    try { if (window.__NUXT__) { ssrLines.push("=== SSR Data: Nuxt (__NUXT__) ==="); ssrLines.push($yaml(window.__NUXT__, 0, 5, 500)); } } catch(e) {}
  }
  var ssrSection = ssrLines.join("\n");

  // ================================================================
  // Phase 2: 生成可访问性树快照
  // ================================================================
  var ssrLen = ssrSection.length;
  var remaining = maxLength - ssrLen - 500;
  if (remaining < 5000) remaining = 5000;

  // ---- 角色映射 ----
  var T_LANDMARK = { header: "banner", main: "main", nav: "navigation", footer: "contentinfo", aside: "complementary", form: "form" };
  var T_SKIP = { script: 1, style: 1, svg: 1, noscript: 1, iframe: 1, canvas: 1, video: 1, audio: 1, template: 1, link: 1, meta: 1, br: 1, hr: 1, wbr: 1 };
  var T_LEAF = { button: 1, input: 1, textarea: 1, select: 1, img: 1, label: 1 };

  function tVisible(el) {
    if (!el || el.nodeType !== 1) return false; var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    if (el !== document.body && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false; if (el.hasAttribute("hidden")) return false; return true;
  }

  function tRoleOf(el) {
    var tag = el.tagName.toLowerCase(); var explicit = el.getAttribute("role"); if (explicit) return explicit;
    if (T_LANDMARK.hasOwnProperty(tag)) return T_LANDMARK[tag];
    var h = tag.match(/^h([1-6])$/); if (h) return "heading [h" + h[1] + "]";
    switch (tag) { case "a": return "link"; case "ul": case "ol": return "list"; case "li": return "listitem"; case "button": return "button"; case "table": return "table"; case "tr": return "row"; case "td": return "cell"; case "th": return "cell [th]"; case "img": return "image"; case "input": return "textbox"; case "textarea": return "textbox"; case "select": return "combobox"; case "p": return "paragraph"; case "label": return "label"; default: return ""; }
  }

  function tDirectText(el) { var t = ""; for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent; } return t.replace(/\s+/g, " ").trim(); }

  function tEsc(s, limit) { if (!s) return ""; limit = limit || 500; s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t"); if (s.length > limit) s = s.substring(0, limit - 3) + "..."; return s; }

  function tLinkHref(el) { var h = (el.getAttribute("href") || "").trim(); if (!h || h.toLowerCase().startsWith("javascript:")) return ""; if (h.length > 500) h = h.substring(0, 497) + "..."; return h; }

  function tSp(n) { var s = ""; for (var j = 0; j < n; j++) s += "  "; return s; }

  var tLines = []; var tTotal = 0; var HIT_LIMIT = false;

  function tEmit(depth, text) { if (HIT_LIMIT) return false; var line = tSp(depth) + text; if (tTotal + line.length + 1 > remaining) { HIT_LIMIT = true; return false; } tLines.push(line); tTotal += line.length + 1; return true; }

  function tWalk(node, depth) {
    if (HIT_LIMIT || depth > 12) return;
    if (node.nodeType === 3) { var t = node.textContent.replace(/\s+/g, " ").trim(); if (t) tEmit(depth, 'text "' + tEsc(t) + '"'); return; }
    if (node.nodeType !== 1) return; if (!tVisible(node)) return;
    var tag = node.tagName.toLowerCase(); if (T_SKIP.hasOwnProperty(tag)) return;
    var role = tRoleOf(node); var isLeaf = T_LEAF.hasOwnProperty(tag);
    var hasVisChildren = false;
    if (!isLeaf) { for (var i = 0; i < node.children.length; i++) { var c = node.children[i]; if (tVisible(c) && !T_SKIP.hasOwnProperty(c.tagName.toLowerCase())) { hasVisChildren = true; break; } } }
    if (!hasVisChildren || isLeaf) {
      var text = "", href = "";
      if (tag === "img") { text = (node.getAttribute("alt") || node.getAttribute("title") || "").trim(); }
      else if (tag === "a") { text = tDirectText(node); href = tLinkHref(node); }
      else if (tag === "input") { text = (node.getAttribute("placeholder") || node.getAttribute("value") || node.getAttribute("name") || "").trim(); }
      else { text = tDirectText(node); }
      if (text) { if (!role) role = "text"; var line = role; if (tag === "a" && href) { line += ' "' + tEsc(text) + '" [' + tEsc(href, 500) + ']'; } else { line += ' "' + tEsc(text) + '"'; } tEmit(depth, line); }
    } else {
      if (!role) role = "group"; if (!tEmit(depth, role)) return;
      for (var i = 0; i < node.childNodes.length; i++) { tWalk(node.childNodes[i], depth + 1); if (HIT_LIMIT) return; }
    }
  }

  // ================================================================
  // Phase 2: 树快照（选中模式下仅遍历选中元素）
  // ================================================================
  var snapshot = "";
  if (selectedOnly && selectedEls.length > 0) {
    try {
      snapshot = $walkRoots(selectedEls, remaining);
    } catch (e) { snapshot = "Snapshot error: " + e.message; }
  } else {
    try {
      var body = document.body; if (!body) snapshot = "";
      else {
        var mainSelectors = ["main", '[role="main"]', "article", ".main-content", "#main-content", ".content", "#content", ".post-content", ".article-content", ".search-result-list", ".list-container", ".hotel-list"];
        var mainEl = null;
        for (var i = 0; i < mainSelectors.length; i++) { var el = document.querySelector(mainSelectors[i]); if (el && tVisible(el)) { mainEl = el; break; } }
        tWalk(mainEl || body, 0);
        snapshot = tLines.join("\n");
        if (HIT_LIMIT) snapshot += "\n... (snapshot truncated at length limit)";
      }
    } catch (e) { snapshot = "Snapshot error: " + e.message; }
  }

  // ================================================================
  // Phase 2.5: 扁平数据列表（专门提取价格/数值相关的文本块）
  // ================================================================
  function $extractFlatData() {
    var lines = [];
    var MAX_ITEMS = 40;
    var count = 0;
    try {
      // 在所有可见元素中寻找包含价格的文本块
      // pricePattern: 包含 ¥/$ + 数字 或 数字 + 起/晚/元 等模式
      var pricePattern = /[¥￥$€£]\s*\d[\d,.]*|(\d[\d,.]*)\s*(起|元|晚|起\/晚|元起|元\/晚)/;

      // 收集候选标签：可见的 div/h3/h4/p/span/li 且文本 20-200 字符
      var candidates = [];
      var allEls = document.querySelectorAll("div, h3, h4, p, span, li, dt, dd, td, th");
      for (var ei = 0; ei < allEls.length; ei++) {
        var el = allEls[ei];
        if (!$isVis(el)) continue;
        var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length < 8 || txt.length > 300) continue;
        candidates.push({ el: el, text: txt });
      }

      // 筛选包含价格信息的，并为每个找到最近的标签
      for (var ci = 0; ci < candidates.length && count < MAX_ITEMS; ci++) {
        var c = candidates[ci];
        if (!pricePattern.test(c.text)) continue;

        // 寻找最近的"标签"（前面的 heading 或比自己短的兄弟元素）
        var label = "";
        var el = c.el;
        // 先找同级的 heading
        var prev = el.previousElementSibling;
        for (var pi = 0; pi < 3 && prev; pi++) {
          var pTag = prev.tagName.toLowerCase();
          var pText = (prev.textContent || "").replace(/\s+/g, " ").trim();
          if (pTag.match(/^h[1-6]$/) && pText.length > 0) { label = pText; break; }
          if (pText.length > 0 && pText.length <= 100 && !pricePattern.test(pText)) {
            label = pText; break;
          }
          prev = prev.previousElementSibling;
        }
        // 如果没找到同级标签，看父元素里的直接文本
        if (!label && el.parentElement) {
          var dt = "";
          for (var j = 0; j < el.parentElement.childNodes.length; j++) {
            if (el.parentElement.childNodes[j] === el) break;
            if (el.parentElement.childNodes[j].nodeType === 3) {
              dt += el.parentElement.childNodes[j].textContent;
            }
          }
          dt = dt.replace(/\s+/g, " ").trim();
          if (dt.length > 0 && dt.length <= 100) label = dt;
        }

        var item = "  [" + (count + 1) + "]";
        if (label) item += ' label: "' + $esc(label, 300) + '"';
        item += ' data: "' + $esc(c.text, 600) + '"';
        lines.push(item);
        count++;
      }
    } catch(e) {}
    return lines.join("\n");
  }
  // Phase 2.5: 选中模式下仅扫描选中元素
  var flatDataSection;
  if (selectedOnly && selectedEls.length > 0) {
    flatDataSection = $scanDataInRoots(selectedEls);
  } else {
    flatDataSection = $extractFlatData();
  }

  // ================================================================
  // Phase 3: 组合输出
  // ================================================================
  var result = "";
  result += "=== Page Metadata ===\n";
  result += "title: \"" + (document.title || "") + "\"\n";
  result += "url: \"" + (window.location.href || "") + "\"\n";
  result += "wait_result: " + waitResult.reason + " (waited " + waitResult.waited + "ms)\n";
  if (waitResult.dataSources.length > 0) { result += "data_sources: " + waitResult.dataSources.slice(0, 10).join(", ") + "\n"; }
  if (selectedOnly) { result += "selected_mode: true (" + selectedEls.length + " user-selected elements)\n"; }
  result += "\n";
  if (ssrSection.trim().length > 0) { result += ssrSection + "\n"; }
  if (flatDataSection.trim().length > 0) {
    result += "=== Flat Data List (key data items with prices) ===\n";
    result += "format: [N] label: \"...\" data: \"...\"\n";
    result += flatDataSection + "\n\n";
  }
  result += "=== Accessibility Tree Snapshot ===\n";
  result += snapshot;
  return result;
}

// ---- 调用 LLM API (通过 background) ----
async function callLLM(config, instruction, content, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "callLLM",
        config: {
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          modelName: config.modelName,
          systemPrompt: config.systemPrompt,
        },
        instruction,
        content,
        pageUrl: "", // 将由 background 填充
        skipJsonFormat: !!options.skipJsonFormat,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!response) {
          return reject(new Error("Background 未响应"));
        }
        if (response.error) {
          return reject(new Error(response.error));
        }
        resolve(response.result);
      }
    );
  });
}

// ---- JSON 格式化 ----
function formatJSON(raw) {
  // raw 可能是字符串或对象
  try {
    let obj;
    if (typeof raw === "string") {
      // 尝试去除可能的 markdown 代码块标记
      let cleaned = raw.trim();
      // 去掉 ```json ... ``` 包裹
      const mdMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (mdMatch) cleaned = mdMatch[1].trim();
      obj = JSON.parse(cleaned);
    } else {
      obj = raw;
    }
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    // 如果已经是格式良好的字符串
    return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  }
}

// ---- 复制到剪贴板 ----
async function handleCopy() {
  const text = DOM.jsonOutput.textContent;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    const origHTML = DOM.btnCopy.innerHTML;
    DOM.btnCopy.innerHTML = "✓ 已复制";
    DOM.btnCopy.style.color = "#16a34a";
    DOM.btnCopy.style.borderColor = "#16a34a";
    setTimeout(() => {
      DOM.btnCopy.innerHTML = origHTML;
      DOM.btnCopy.style.color = "";
      DOM.btnCopy.style.borderColor = "";
    }, 2000);
  } catch (err) {
    // Fallback: execCommand（Clipboard API 在扩展 popup 中可能因权限不足而失败）
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);

    const origHTML = DOM.btnCopy.innerHTML;
    DOM.btnCopy.innerHTML = "✓ 已复制";
    setTimeout(() => { DOM.btnCopy.innerHTML = origHTML; }, 2000);
  }
}

// ---- 下载 JSON 文件 ----
function handleDownload() {
  const text = DOM.jsonOutput.textContent;
  if (!text) return;

  // 获取选择的格式
  const format = document.getElementById("selDownloadFormat").value;

  // 生成文件基础名
  const baseName = (document.title || "extracted-data")
    .replace(/[\\/:*?"<>|]/g, "_")
    .substring(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const namePrefix = baseName + "-" + timestamp;

  try {
    let blob, filename;

    switch (format) {
      case "csv":
        var csvText = jsonToCsv(text);
        blob = new Blob(["\uFEFF" + csvText], { type: "text/csv;charset=utf-8" });
        filename = namePrefix + ".csv";
        break;

      case "xlsx":
        blob = jsonToXlsxBlob(text);
        filename = namePrefix + ".xlsx";
        break;

      case "json":
      default:
        blob = new Blob([text], { type: "application/json" });
        filename = namePrefix + ".json";
        break;
    }

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setStatus("已下载 " + format.toUpperCase() + " 文件", "success");
    setTimeout(hideStatus, 2000);
  } catch (e) {
    showError("下载失败：" + e.message);
  }
}

// ================================================================
// JSON → CSV 转换
// ================================================================

function jsonToCsv(jsonText) {
  var data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON 解析失败，无法转换为 CSV");
  }

  // 标准化为数组
  var rows = normalizeToRows(data);
  if (rows.length === 0) return "";

  // 收集所有列名
  var columns = [];
  var colSet = {};
  for (var i = 0; i < rows.length; i++) {
    var keys = Object.keys(rows[i]);
    for (var j = 0; j < keys.length; j++) {
      if (!colSet[keys[j]]) {
        colSet[keys[j]] = true;
        columns.push(keys[j]);
      }
    }
  }

  // 构建 CSV
  var lines = [];
  // 表头
  lines.push(columns.map(function(c) { return csvEscape(c); }).join(","));
  // 数据行
  for (var r = 0; r < rows.length; r++) {
    var line = [];
    for (var c = 0; c < columns.length; c++) {
      var val = rows[r][columns[c]];
      line.push(csvEscape(val));
    }
    lines.push(line.join(","));
  }

  return lines.join("\n");
}

function normalizeToRows(data) {
  if (Array.isArray(data)) {
    return data.filter(function(item) { return typeof item === "object" && item !== null; });
  }
  if (typeof data === "object" && data !== null) {
    // 尝试找到数组字段
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]]) && data[keys[i]].length > 0 &&
          typeof data[keys[i]][0] === "object") {
        return data[keys[i]];
      }
    }
    // 没有数组 → 整个对象作为一行
    return [flattenObject(data)];
  }
  return [];
}

function flattenObject(obj, prefix) {
  prefix = prefix || "";
  var result = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = obj[k];
    var fullKey = prefix ? prefix + "." + k : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      var flattened = flattenObject(v, fullKey);
      var fk = Object.keys(flattened);
      for (var j = 0; j < fk.length; j++) {
        result[fk[j]] = flattened[fk[j]];
      }
    } else if (Array.isArray(v)) {
      result[fullKey] = JSON.stringify(v);
    } else {
      result[fullKey] = v;
    }
  }
  return result;
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  var s = String(val);
  if (s.indexOf(",") >= 0 || s.indexOf("\n") >= 0 || s.indexOf('"') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// ================================================================
// JSON → XLSX 转换（内联 mini-ZIP + OOXML，无外部依赖）
// ================================================================

function jsonToXlsxBlob(jsonText) {
  var data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON 解析失败，无法转换为 XLSX");
  }

  var rows = normalizeToRows(data);
  if (rows.length === 0) {
    throw new Error("无可转换为表格的数据");
  }

  // 收集列名
  var columns = [];
  var colSet = {};
  for (var i = 0; i < rows.length; i++) {
    var keys = Object.keys(rows[i]);
    for (var j = 0; j < keys.length; j++) {
      if (!colSet[keys[j]]) {
        colSet[keys[j]] = true;
        columns.push(keys[j]);
      }
    }
  }

  // 构建共享字符串表
  var sst = [];
  var sstMap = {};
  function getSstIndex(str) {
    var s = str === null || str === undefined ? "" : String(str);
    if (sstMap.hasOwnProperty(s)) return sstMap[s];
    var idx = sst.length;
    sst.push(s);
    sstMap[s] = idx;
    return idx;
  }

  // 预登记所有字符串
  // 表头
  for (var hi = 0; hi < columns.length; hi++) getSstIndex(columns[hi]);
  // 数据
  for (var ri = 0; ri < rows.length; ri++) {
    for (var ci = 0; ci < columns.length; ci++) {
      getSstIndex(rows[ri][columns[ci]]);
    }
  }

  // 生成 sheet1.xml
  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane yOffset="1" xSplit="0" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetData>';

  // 表头行
  sheetXml += '<row r="1">';
  for (var hc = 0; hc < columns.length; hc++) {
    var colLetter = colIdxToLetter(hc);
    sheetXml += '<c r="' + colLetter + '1" t="s"><v>' + getSstIndex(columns[hc]) + '</v></c>';
  }
  sheetXml += '</row>';

  // 数据行
  for (var dr = 0; dr < rows.length; dr++) {
    sheetXml += '<row r="' + (dr + 2) + '">';
    for (var dc = 0; dc < columns.length; dc++) {
      var dcl = colIdxToLetter(dc);
      var dval = rows[dr][columns[dc]];
      var isNum = (typeof dval === "number" && isFinite(dval));
      sheetXml += '<c r="' + dcl + (dr + 2) + '"' + (isNum ? '' : ' t="s"') + '>' +
        '<v>' + (isNum ? dval : getSstIndex(dval)) + '</v></c>';
    }
    sheetXml += '</row>';
  }

  sheetXml += '</sheetData></worksheet>';

  // 生成 sharedStrings.xml
  var sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">';
  for (var si = 0; si < sst.length; si++) {
    sstXml += '<si><t>' + xmlEscape(sst[si]) + '</t></si>';
  }
  sstXml += '</sst>';

  // 生成其他 XML 文件
  var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var wbRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';

  var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';

  // 打包为 ZIP
  var zipFiles = [
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: relsXml },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: wbRelsXml },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    { name: "xl/sharedStrings.xml", data: sstXml },
  ];

  return buildZip(zipFiles);
}

// Mini-ZIP builder (STORE method, no compression)
function buildZip(files) {
  // 将所有文件和目录转换为 Uint8Array
  var encoder = new TextEncoder();
  var fileData = [];
  for (var i = 0; i < files.length; i++) {
    var nameBytes = encoder.encode(files[i].name);
    var dataBytes = encoder.encode(files[i].data);
    fileData.push({ name: files[i].name, nameBytes: nameBytes, data: dataBytes });
  }

  // 预分配足够大的缓冲区
  var totalSize = 0;
  for (var j = 0; j < fileData.length; j++) {
    totalSize += 30 + fileData[j].nameBytes.length + fileData[j].data.length; // local header
    totalSize += 46 + fileData[j].nameBytes.length; // central directory entry
  }
  totalSize += 22; // end of central directory

  var buf = new ArrayBuffer(totalSize);
  var view = new DataView(buf);
  var offset = 0;

  // 收集 central directory entries 用于末尾计算
  var centralEntries = [];

  for (var k = 0; k < fileData.length; k++) {
    var fd = fileData[k];
    var crc = crc32(fd.data);

    var localOffset = offset;  // 当前文件的 local header 偏移

    // Local file header
    view.setUint32(offset, 0x04034b50, true); offset += 4;  // signature
    view.setUint16(offset, 20, true); offset += 2;           // version needed
    view.setUint16(offset, 0, true); offset += 2;            // flags
    view.setUint16(offset, 0, true); offset += 2;            // compression (0 = store)
    view.setUint16(offset, 0, true); offset += 2;            // mod time
    view.setUint16(offset, 0, true); offset += 2;            // mod date
    view.setUint32(offset, crc, true); offset += 4;          // crc32
    view.setUint32(offset, fd.data.length, true); offset += 4; // compressed size
    view.setUint32(offset, fd.data.length, true); offset += 4; // uncompressed size
    view.setUint16(offset, fd.nameBytes.length, true); offset += 2; // filename length
    view.setUint16(offset, 0, true); offset += 2;            // extra field length

    // Filename
    for (var fn = 0; fn < fd.nameBytes.length; fn++) {
      view.setUint8(offset++, fd.nameBytes[fn]);
    }

    // File data
    for (var dd = 0; dd < fd.data.length; dd++) {
      view.setUint8(offset++, fd.data[dd]);
    }

    // Central directory entry
    centralEntries.push({
      nameBytes: fd.nameBytes,
      crc: crc,
      size: fd.data.length,
      localOffset: localOffset,
    });
  }

  var cdStart = offset;

  // Write central directory entries
  for (var ck = 0; ck < centralEntries.length; ck++) {
    var ce = centralEntries[ck];
    view.setUint32(offset, 0x02014b50, true); offset += 4;   // signature
    view.setUint16(offset, 20, true); offset += 2;            // version made by
    view.setUint16(offset, 20, true); offset += 2;            // version needed
    view.setUint16(offset, 0, true); offset += 2;             // flags
    view.setUint16(offset, 0, true); offset += 2;             // compression
    view.setUint16(offset, 0, true); offset += 2;             // mod time
    view.setUint16(offset, 0, true); offset += 2;             // mod date
    view.setUint32(offset, ce.crc, true); offset += 4;        // crc32
    view.setUint32(offset, ce.size, true); offset += 4;       // compressed size
    view.setUint32(offset, ce.size, true); offset += 4;       // uncompressed size
    view.setUint16(offset, ce.nameBytes.length, true); offset += 2; // filename length
    view.setUint16(offset, 0, true); offset += 2;             // extra field length
    view.setUint16(offset, 0, true); offset += 2;             // comment length
    view.setUint16(offset, 0, true); offset += 2;             // disk number start
    view.setUint16(offset, 0, true); offset += 2;             // internal attrs
    view.setUint32(offset, 0, true); offset += 4;             // external attrs
    view.setUint32(offset, ce.localOffset, true); offset += 4; // local header offset

    // Filename
    for (var fn2 = 0; fn2 < ce.nameBytes.length; fn2++) {
      view.setUint8(offset++, ce.nameBytes[fn2]);
    }
  }

  var cdSize = offset - cdStart;

  // End of central directory record
  view.setUint32(offset, 0x06054b50, true); offset += 4;     // signature
  view.setUint16(offset, 0, true); offset += 2;               // disk number
  view.setUint16(offset, 0, true); offset += 2;               // disk with central dir
  view.setUint16(offset, centralEntries.length, true); offset += 2; // entries on this disk
  view.setUint16(offset, centralEntries.length, true); offset += 2; // total entries
  view.setUint32(offset, cdSize, true); offset += 4;          // central dir size
  view.setUint32(offset, cdStart, true); offset += 4;         // central dir offset
  view.setUint16(offset, 0, true); offset += 2;               // comment length

  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// CRC32 计算
var _crcTable = null;
function _makeCrcTable() {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

function crc32(data) {
  if (!_crcTable) _crcTable = _makeCrcTable();
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 列索引 → Excel 列字母 (0→A, 1→B, ..., 25→Z, 26→AA, ...)
function colIdxToLetter(idx) {
  var result = "";
  var n = idx;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return result;
}

// XML 特殊字符转义
function xmlEscape(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// ---- 默认 System Prompt ----
// ⚠️ 与 options.js 中的 DEFAULT_SYSTEM_PROMPT 保持同步！
// 修改此处必须同步修改 options.js，反之亦然。
function getDefaultSystemPrompt() {
  return `You are a precise data extraction assistant. Your task is to extract structured data from web page content based on the user's extraction instruction.

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
}

// ================================================================
// 自动检测页面主要内容区域
// ================================================================

/**
 * 自动检测并选中页面主要内容区域
 * 流程：分析页面结构 → LLM 识别主内容区 → 自动选中区域内的元素 → 更新 UI
 */
async function autoDetectAndSelectContent(tabId) {
  // 步骤 1：注入脚本分析页面结构
  setStatus("正在分析页面结构...", "info");
  const structResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: analyzePageStructure,
  });

  if (!structResults || !structResults[0] || !structResults[0].result) {
    throw new Error("页面结构分析返回为空");
  }

  const structure = structResults[0].result;
  if (!structure.sections || structure.sections.length === 0) {
    throw new Error("未检测到可识别的页面区域");
  }

  // sections 已按显示面积从大到小排序
  const sections = structure.sections;
  areaSections = sections;

  // 步骤 2：默认选择面积最大的区域（索引 0）
  currentAreaIndex = 0;

  // 步骤 3：渲染区域选择器 UI（让用户可切换）
  renderAreaPicker();

  // 步骤 4：默认选中最大面积区域
  await selectArea(tabId, 0);

  hideStatus();
}

/**
 * 选中指定索引的区域（注入脚本 + 更新 UI）
 */
async function selectArea(tabId, areaIndex) {
  if (areaIndex < 0 || areaIndex >= areaSections.length) return;

  currentAreaIndex = areaIndex;

  // 注入脚本：选中该区域（仅 1 个外层容器）
  const selectResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: autoSelectInSection,
    args: [areaIndex],
  });

  var selectCount = (selectResults && selectResults[0] && typeof selectResults[0].result === "number")
    ? selectResults[0].result : 0;

  // 更新 UI
  selectedCount = selectCount;
  var s = areaSections[areaIndex];
  var areaLabel = s ? (s.idAttr || formatArea(s.area)) : "";

  DOM.btnSelect.innerHTML =
    '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' +
    '已选' + (areaLabel ? '「' + areaLabel + '」' : ' 1 个');
  DOM.btnSelect.style.borderColor = "#16a34a";
  DOM.btnSelect.style.color = "#16a34a";
  DOM.btnExtract.textContent = "提取选中";
  DOM.btnExtract.style.background = "#16a34a";

  setStatus("已选中" + (areaIndex === 0 ? "最大显示面积区域" : "第" + (areaIndex + 1) + "大区域") +
    (areaLabel ? "「" + areaLabel + "」" : ""), "success");

  // 获取选中元素文本用于自动生成指令
  var textResults = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      var els = document.querySelectorAll('[data-we-selected="true"]');
      var texts = [];
      for (var i = 0; i < els.length && i < 30; i++) {
        var t = (els[i].textContent || "").replace(/\s+/g, " ").trim();
        if (t.length > 0) texts.push(t.length > 300 ? t.substring(0, 297) + "..." : t);
      }
      return texts;
    },
  });

  if (textResults && textResults[0] && textResults[0].result) {
    var autoTexts = textResults[0].result;
    if (autoTexts.length > 0 && (!DOM.txtInstruction.value.trim() || instructionFromStorage)) {
      autoGenerateInstruction(autoTexts);
    }
  }

  // 更新选择器高亮
  updateAreaPickerHighlight();

  setTimeout(hideStatus, 3000);
}

/**
 * 用户点击区域选择器中的其他区域 → 切换选中
 */
async function switchToArea(areaIndex) {
  if (areaIndex === currentAreaIndex) return;

  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;

  setStatus("正在切换内容区域...", "info");
  await selectArea(tabs[0].id, areaIndex);
}

/**
 * 清除区域选择器
 */
function clearAreaPicker() {
  areaSections = [];
  currentAreaIndex = 0;
  DOM.areaPicker.classList.add("hidden");
  DOM.areaPickerList.innerHTML = "";
}

/**
 * 渲染区域选择器列表
 */
function renderAreaPicker() {
  if (!areaSections || areaSections.length === 0) {
    DOM.areaPicker.classList.add("hidden");
    return;
  }

  DOM.areaPicker.classList.remove("hidden");
  DOM.areaCount.textContent = areaSections.length + " 个区域";

  var html = "";
  for (var i = 0; i < areaSections.length; i++) {
    var s = areaSections[i];
    var isActive = (i === currentAreaIndex);
    var rank = i + 1;
    var areaStr = formatArea(s.area);
    var preview = escapeHTML(truncate(s.textPreview, 60));
    var label = s.idAttr || s.tag;

    html += '<div class="area-picker-item' + (isActive ? " active" : "") + '" data-area-index="' + i + '">' +
      '<span class="area-rank">' + rank + '</span>' +
      '<div class="area-info">' +
        '<div><span class="area-tag">' + escapeHTML(label) + '</span>' +
        '<span class="area-size">' + areaStr + '</span></div>' +
        '<div class="area-text-preview">' + preview + '</div>' +
      '</div>' +
    '</div>';
  }

  DOM.areaPickerList.innerHTML = html;

  // 绑定点击事件
  var items = DOM.areaPickerList.querySelectorAll(".area-picker-item");
  for (var j = 0; j < items.length; j++) {
    (function(idx) {
      items[j].addEventListener("click", function() {
        switchToArea(idx);
      });
    })(j);
  }
}

/**
 * 更新区域选择器高亮
 */
function updateAreaPickerHighlight() {
  var items = DOM.areaPickerList.querySelectorAll(".area-picker-item");
  for (var i = 0; i < items.length; i++) {
    if (i === currentAreaIndex) {
      items[i].classList.add("active");
    } else {
      items[i].classList.remove("active");
    }
  }
}

/**
 * 格式化面积数值（px² → 可读格式）
 */
function formatArea(area) {
  if (!area || area <= 0) return "";
  if (area >= 1000000) return (area / 1000000).toFixed(1) + "M px²";
  if (area >= 1000) return (area / 1000).toFixed(0) + "K px²";
  return area + " px²";
}

/**
 * 自动检测专用的 System Prompt（保留，供未来可选使用）
 */
function getAutoDetectSystemPrompt() {
  return "你是一个网页结构分析助手。你的任务是识别页面的主要内容区域。\n\n" +
    "注意：导航栏、页头、页脚、侧边栏、广告等非内容区域已被预先过滤，以下列出的所有区域都是潜在的内容候选区。\n\n" +
    "规则：\n" +
    "1. 主要内容区域通常是包含文章正文、商品列表、搜索结果、评论列表等核心内容的区域\n" +
    "2. 主要内容区域的特征：文本内容最多、包含重复数据结构、位于页面主干位置\n" +
    "3. 如果有多个候选，选择文本预览最丰富、最可能包含用户关心的核心数据的区域\n" +
    "4. 返回的 mainSectionIndex 必须是一个有效数字\n\n" +
    "返回格式（纯 JSON，不要任何其他内容）：\n" +
    '{"mainSectionIndex": <数字>, "contentType": "<内容类型>", "confidence": <0-1小数>}';
}

/**
 * 将文本中的特殊字符处理后用于 LLM prompt
 * 此函数在 popup 作用域中运行，不是注入函数
 */
function escPromptText(s) {
  if (!s) return "";
  return s.replace(/\n/g, " ").replace(/"/g, "'").trim();
}

/**
 * =================================================================
 * 注入函数：analyzePageStructure
 * 分析页面结构，将页面划分为多个区域，每个区域附带内容预览
 * 通过 chrome.scripting.executeScript 注入，必须完全自包含
 * =================================================================
 */
function analyzePageStructure() {
  // ---- 可见性检测 ----
  var SKIP_TAGS = { script: 1, style: 1, svg: 1, noscript: 1, iframe: 1, canvas: 1, video: 1, audio: 1, template: 1, link: 1, meta: 1, br: 1, hr: 1, wbr: 1, title: 1 };

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.hasOwnProperty(el.tagName.toLowerCase())) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function isContainer(el) {
    // 判断元素是否为"容器"：包含多个子元素或大量文本
    var children = 0;
    var textLen = 0;
    for (var i = 0; i < el.children.length; i++) {
      if (isVisible(el.children[i])) children++;
    }
    var dt = el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
    textLen = dt.length;
    // 至少 2 个可见子元素 或 文本 >= 100 字符，才视为容器
    return (children >= 2) || (textLen >= 100);
  }

  function getTextPreview(el, maxLen) {
    maxLen = maxLen || 200;
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t.length > maxLen) t = t.substring(0, maxLen - 3) + "...";
    return t;
  }

  function getClassSummary(el) {
    var cls = el.className;
    if (typeof cls !== "string" || !cls.trim()) return "";
    // 取前 3 个 class 名（处理 hashed class names）
    var parts = cls.trim().split(/\s+/);
    return parts.slice(0, 3).join(" ");
  }

  // ---- 判断是否为明确的非内容区域 ----
  function isNonContent(el) {
    var tag = el.tagName.toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    var cls = (el.className || "").toLowerCase();
    var id = (el.id || "").toLowerCase();

    // 语义标签：导航、页头、页脚、侧边栏
    if (tag === "nav" || tag === "header" || tag === "footer" || tag === "aside") return true;
    // role 属性
    if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "complementary") return true;
    // id 中匹配非内容关键词
    if (/^(nav|header|footer|sidebar|aside|menu|toolbar|breadcrumb|copyright)/.test(id)) return true;
    // class 中匹配非内容关键词
    if (/\b(nav|header|footer|sidebar|aside|menu|toolbar|breadcrumb|copyright|ad-|advertisement|banner-ad|popup|modal|overlay|drawer)\b/.test(cls)) return true;

    // 短文本 + 多子元素（典型导航菜单特征：很多链接但每个链接文本很短）
    var textLen = (el.textContent || "").replace(/\s+/g, " ").trim().length;
    var childCount = 0;
    for (var nc = 0; nc < el.children.length; nc++) {
      var cc = el.children[nc];
      if (cc.nodeType === 1) {
        var s2 = getComputedStyle(cc);
        if (s2.display !== "none" && s2.visibility !== "hidden") childCount++;
      }
    }
    // 超过 15 个子元素但每个平均文本 < 10 字符 → 导航菜单
    if (childCount > 15 && textLen > 0 && textLen / childCount < 10) return true;

    return false;
  }

  // ---- 寻找页面根容器 ----
  // 优先使用 main/article，其次 body
  var root = document.querySelector("main, [role='main']") ||
             document.querySelector("article, [role='article']") ||
             document.body;
  if (!root) root = document.documentElement;

  // ---- 遍历直接子元素，识别区域 ----
  var sections = [];
  var sectionCounter = 0;

  function walkChildren(parent, depth) {
    if (depth > 10 || sectionCounter >= 30) return;
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      if (sectionCounter >= 30) break;
      var child = children[i];
      if (!isVisible(child)) continue;

      // 跳过明确的非内容区域（导航、页头、页脚、侧边栏、广告等）
      if (isNonContent(child)) continue;

      var tag = child.tagName.toLowerCase();
      var preview = getTextPreview(child, 150);
      if (preview.length < 5) continue; // 跳过空区域

      var childCount = 0;
      for (var j = 0; j < child.children.length; j++) {
        if (isVisible(child.children[j])) childCount++;
      }

      // 判断是否可识别为独立区域
      var isSection = false;
      // 语义标签（已排除 nav/header/footer/aside，仅保留 main/article/section/div）
      if (["main", "article", "section"].indexOf(tag) >= 0) isSection = true;
      // role 属性（仅内容相关）
      var role = child.getAttribute("role");
      if (role && ["main", "article", "region"].indexOf(role) >= 0) isSection = true;
      // 常见内容容器 class
      var cls = (child.className || "").toLowerCase();
      if (/content|main|article|body|wrapper|container|list|grid|results|products/.test(cls) && childCount >= 2) isSection = true;
      // 包含多个子元素且文本丰富
      if (childCount >= 5 && preview.length >= 50) isSection = true;
      // 文本内容丰富（很可能是文章内容区域）
      if (preview.length >= 200) isSection = true;

      if (isSection) {
        // 计算显示面积（宽 × 高）
        var rect = child.getBoundingClientRect();
        var area = Math.round(rect.width * rect.height);

        // 给区域打标记，供后续 autoSelectInSection 使用（先用临时索引）
        child.setAttribute("data-we-section", String(sectionCounter));
        sections.push({
          index: sectionCounter,
          tag: tag,
          idAttr: child.id || "",
          className: getClassSummary(child),
          textPreview: preview,
          childCount: childCount,
          depth: depth,
          area: area,
        });
        sectionCounter++;
      } else if (isContainer(child)) {
        // 非直接区域但仍是容器 → 递归深入
        walkChildren(child, depth + 1);
      }
    }
  }

  walkChildren(root, 0);

  // ---- 如果 body 作为根容器且区域太少，尝试 body 的直接子元素 ----
  if (sections.length <= 1 && root === document.body) {
    sectionCounter = 0;
    sections = [];
    walkChildren(document.body, 0);
  }

  // ---- 按显示面积从大到小排序 ----
  sections.sort(function(a, b) { return b.area - a.area; });

  // ---- 重新索引：更新 data-we-section 属性为排序后的位置 ----
  for (var si = 0; si < sections.length; si++) {
    var sortedIndex = si;
    var oldIndex = sections[si].index;
    // 用旧索引找到 DOM 元素，更新 data-we-section
    var el = document.querySelector('[data-we-section="' + oldIndex + '"]');
    if (el) {
      el.setAttribute("data-we-section", String(sortedIndex));
    }
    sections[si].index = sortedIndex;
  }

  return {
    title: document.title || "",
    url: window.location.href,
    sectionCount: sections.length,
    sections: sections,
  };
}

/**
 * =================================================================
 * 注入函数：autoSelectInSection
 * 在指定区域内自动选中所有有意义的元素
 * 通过 chrome.scripting.executeScript 注入，必须完全自包含
 * =================================================================
 */
function autoSelectInSection(sectionIndex) {
  // 找到之前标记的区域（外层容器元素）
  var section = document.querySelector('[data-we-section="' + sectionIndex + '"]');
  if (!section) return 0;

  // 移除所有区域标记
  var allSections = document.querySelectorAll("[data-we-section]");
  for (var ai = 0; ai < allSections.length; ai++) {
    allSections[ai].removeAttribute("data-we-section");
  }

  // 清理已有的选中标记和旧样式
  var oldSelected = document.querySelectorAll('[data-we-selected="true"]');
  for (var os = 0; os < oldSelected.length; os++) {
    oldSelected[os].removeAttribute("data-we-selected");
    oldSelected[os].style.outline = "";
    oldSelected[os].style.boxShadow = "";
    oldSelected[os].style.backgroundColor = "";
    oldSelected[os].style.borderRadius = "";
  }

  // 注入动画样式（只注入一次）
  if (!document.getElementById("we-auto-select-style")) {
    var styleEl = document.createElement("style");
    styleEl.id = "we-auto-select-style";
    styleEl.textContent =
      "[data-we-selected='true'] {" +
      "  outline: 3px solid #16a34a !important;" +
      "  outline-offset: 3px !important;" +
      "  box-shadow: 0 0 0 6px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.3) !important;" +
      "  background-color: rgba(22,163,74,0.04) !important;" +
      "  border-radius: 4px !important;" +
      "  animation: we-pulse 2s ease-in-out infinite !important;" +
      "}" +
      "@keyframes we-pulse {" +
      "  0%, 100% { box-shadow: 0 0 0 6px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.3); }" +
      "  50% { box-shadow: 0 0 0 10px rgba(22,163,74,0.08), 0 0 30px rgba(22,163,74,0.5); }" +
      "}" +
      "[data-we-selected='true']::before {" +
      "  content: 'AI  主要区域';" +
      "  position: absolute;" +
      "  top: -32px; left: 4px;" +
      "  background: #16a34a;" +
      "  color: #fff;" +
      "  font-size: 12px; font-weight: 600;" +
      "  padding: 2px 10px; border-radius: 4px;" +
      "  z-index: 2147483647;" +
      "  pointer-events: none;" +
      "  white-space: nowrap;" +
      "}";
    document.head.appendChild(styleEl);
  }

  // 确保容器可定位（伪元素需要）
  var pos = getComputedStyle(section).position;
  if (pos === "static") {
    section.style.position = "relative";
  }

  // 标记选中
  section.setAttribute("data-we-selected", "true");

  // 滚动到可见区域
  if (section.scrollIntoView) {
    section.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return 1;
}
