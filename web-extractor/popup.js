// ============================================================
// popup.js — 弹窗编排逻辑（精简版）
//
// 已拆分模块：
//   shared-prompt.js          → 默认 System Prompt
//   constants.js              → 全局配置常量
//   utils.js                  → 通用工具函数
//   csv-utils.js              → JSON → CSV 转换
//   xlsx-builder.js           → JSON → XLSX 内联生成器
//   history.js                → 提取历史记录管理
//   instruction-generator.js  → 自动指令生成
//   area-inject.js            → 页面区域检测与选择注入函数
//   pagination-inject.js      → 翻页检测与跳转注入函数
//
// shared-extractor.js 通过 executeScript files 注入页面
// ============================================================

// ---- DOM 引用 ----
const DOM = {
  btnSettings:    document.getElementById("btnSettings"),
  txtInstruction: document.getElementById("txtInstruction"),
  btnSelect:      document.getElementById("btnSelect"),
  btnExtract:     document.getElementById("btnExtract"),
  btnScrollHint:  document.getElementById("btnScrollHint"),
  btnCopy:        document.getElementById("btnCopy"),
  btnDownload:    document.getElementById("btnDownload"),
  btnSaveRule:    document.getElementById("btnSaveRule"),
  btnRetryNarrow: document.getElementById("btnRetryNarrow"),
  btnMultiExtract:document.getElementById("btnMultiExtract"),
  btnPickNextPage:document.getElementById("btnPickNextPage"),
  pageCount:      document.getElementById("pageCount"),
  paginationStatus: document.getElementById("paginationStatus"),
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
  historySection: document.getElementById("historySection"),
  historyToggle:  document.getElementById("historyToggle"),
  historyList:    document.getElementById("historyList"),
  historyItems:   document.getElementById("historyItems"),
  historyEmpty:   document.getElementById("historyEmpty"),
  historyCount:   document.getElementById("historyCount"),
  btnClearHistory:document.getElementById("btnClearHistory"),
  areaPicker:     document.getElementById("areaPicker"),
  areaPickerList: document.getElementById("areaPickerList"),
  areaCount:      document.getElementById("areaCount"),
};

// ---- 状态 ----
let isSelecting = false;
let selectedCount = 0;
let lastSavedInstruction = null;
let lastSavedSystemPrompt = null;
let instructionFromStorage = false;
let autoDetectionDone = false;
let areaSections = [];
let currentAreaIndex = 0;
let paginationDetected = false;
let paginationInfo = null;
let multiPageExtracting = false;
let customNextPageXPath = null;   // 用户手动指定的翻页按钮 XPath

// ---- 工具函数 ----
function _sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

// ---- 初始化 ----
document.addEventListener("DOMContentLoaded", async () => {
  await loadSavedInstruction();
  await loadMaxContentLength();
  await loadHistory();
  await loadCustomNextPageXPath();
  bindEvents();
  listenForSelectionComplete();
  await checkSelectedElements();
  updateMultiExtractButton();
});

// ---- 事件绑定 ----
function bindEvents() {
  DOM.btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  DOM.quickBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      DOM.txtInstruction.value = btn.dataset.prompt;
      DOM.txtInstruction.focus();
      instructionFromStorage = false;
    });
  });

  DOM.txtInstruction.addEventListener("input", () => {
    instructionFromStorage = false;
    updateMultiExtractButton();
  });

  DOM.btnSelect.addEventListener("click", toggleSelectionMode);
  DOM.btnExtract.addEventListener("click", handleExtract);
  DOM.btnCopy.addEventListener("click", handleCopy);
  DOM.btnDownload.addEventListener("click", handleDownload);

  DOM.btnRetryNarrow.addEventListener("click", handleRetryNarrow);

  // 格式切换按钮组
  document.getElementById("formatSwitcher").addEventListener("click", (e) => {
    const btn = e.target.closest(".format-option");
    if (!btn) return;
    document.querySelectorAll("#formatSwitcher .format-option").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
  });

  DOM.btnSaveRule.addEventListener("click", () => {
    handleSaveRule(lastSavedInstruction, lastSavedSystemPrompt);
  });

  DOM.btnMultiExtract.addEventListener("click", handleMultiPageExtract);
  DOM.btnPickNextPage.addEventListener("click", handlePickNextPage);
  DOM.pageCount.addEventListener("change", () => {
    var v = parseInt(DOM.pageCount.value, 10);
    if (isNaN(v) || v < 1) DOM.pageCount.value = 1;
    else if (v > 50) DOM.pageCount.value = 50;
  });

  DOM.historyToggle.addEventListener("click", toggleHistory);
  DOM.btnClearHistory.addEventListener("click", handleClearHistory);

  DOM.txtInstruction.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleExtract();
    }
  });
}

// ---- 配置加载 ----
async function loadSavedInstruction() {
  try {
    const data = await chrome.storage.local.get("lastInstruction");
    if (data.lastInstruction) {
      DOM.txtInstruction.value = data.lastInstruction;
      instructionFromStorage = true;
    }
  } catch (_) { /* ignore */ }
}

async function loadMaxContentLength() {
  try {
    const data = await chrome.storage.sync.get("maxContentLength");
    const limit = data.maxContentLength || EXTRACTOR_CONSTANTS.DEFAULT_MAX_CONTENT_LENGTH;
    DOM.contentLimit.textContent = limit.toLocaleString();
  } catch (_) { /* ignore */ }
}

async function loadCustomNextPageXPath() {
  try {
    var data = await chrome.storage.local.get("customNextPageXPath");
    if (data.customNextPageXPath) {
      customNextPageXPath = data.customNextPageXPath;
    }
  } catch(_) {}
}

// ---- 状态管理 ----
function setStatus(msg, type) {
  type = type || "info";
  DOM.statusBar.classList.remove("hidden", "success", "error", "warning");
  if (type === "success") DOM.statusBar.classList.add("success");
  if (type === "error")   DOM.statusBar.classList.add("error");
  if (type === "warning") DOM.statusBar.classList.add("warning");
  DOM.statusText.textContent = msg;
}

function hideStatus() {
  DOM.statusBar.classList.add("hidden");
}

function setProgress(percent) {
  DOM.progressBar.classList.remove("hidden");
  DOM.progressFill.style.width = Math.min(percent, 100) + "%";
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

// ---- 选择模式监听 ----
function listenForSelectionComplete() {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.type === "selectionComplete") {
      isSelecting = false;
      updateSelectButton();
      checkSelectedElements().then(() => {
        // 选区完成后检测翻页
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs && tabs.length > 0) checkPagination(tabs[0].id);
        });
      });
    }
  });
}

async function checkSelectedElements() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;

    const results = await chrome.scripting.executeScript({
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

    if (results && results[0] && results[0].result) {
      var status = results[0].result;
      if (status.toolbarActive) { isSelecting = true; updateSelectButton(); return; }
      if (status.selectedCount > 0) {
        selectedCount = status.selectedCount;
        clearAreaPicker();
        DOM.btnSelect.innerHTML = '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' + '已选 ' + selectedCount + ' 个';
        DOM.btnSelect.style.borderColor = "#16a34a";
        DOM.btnSelect.style.color = "#16a34a";
        DOM.btnExtract.textContent = "提取选中";
        DOM.btnExtract.style.background = "#16a34a";
        if (status.selectedTexts && status.selectedTexts.length > 0) {
          if (!DOM.txtInstruction.value.trim() || instructionFromStorage) {
            autoGenerateInstruction(status.selectedTexts);
          }
        }
      } else if (!autoDetectionDone) {
        autoDetectionDone = true;
        setStatus("AI 正在分析页面结构，识别主要内容区域...", "info");
        try { await autoDetectAndSelectContent(tabs[0].id); }
        catch (_) { hideStatus(); }
      }
    }
  } catch (_) { /* ignore */ }
}

// ---- 选择模式 UI 更新 ----
function updateSelectButton() {
  if (isSelecting) {
    DOM.btnSelect.innerHTML = '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' + '退出选择';
    DOM.btnSelect.style.borderColor = "#dc2626";
    DOM.btnSelect.style.color = "#dc2626";
  } else if (selectedCount > 0) {
    DOM.btnSelect.innerHTML = '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' + '已选 ' + selectedCount + ' 个';
    DOM.btnSelect.style.borderColor = "#16a34a";
    DOM.btnSelect.style.color = "#16a34a";
    DOM.btnExtract.textContent = "提取选中";
    DOM.btnExtract.style.background = "#16a34a";
  } else {
    DOM.btnSelect.innerHTML = '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' + '选择元素';
    DOM.btnSelect.style.borderColor = "";
    DOM.btnSelect.style.color = "";
    DOM.btnExtract.textContent = "开始提取";
    DOM.btnExtract.style.background = "";
  }
  updateMultiExtractButton();
}

// ---- 翻页提取按钮状态 ---- 
function updateMultiExtractButton() {
  if (!DOM.btnMultiExtract) return;
  var hasInstruction = DOM.txtInstruction.value.trim().length > 0;
  var hasContent = selectedCount > 0 || autoDetectionDone;
  DOM.btnMultiExtract.disabled = !(hasInstruction && hasContent && !multiPageExtracting);
  
  // 更新分页状态提示
  if (customNextPageXPath) {
    DOM.paginationStatus.textContent = '已指定翻页按钮';
    DOM.paginationStatus.style.color = '#16a34a';
    if (DOM.btnPickNextPage) DOM.btnPickNextPage.classList.add('picked');
    DOM.btnMultiExtract.disabled = !(hasInstruction && hasContent && !multiPageExtracting);
  } else if (paginationDetected && paginationInfo) {
    DOM.paginationStatus.textContent = paginationInfo.text ? '检测到翻页: ' + paginationInfo.text : '检测到翻页';
    DOM.paginationStatus.style.color = '#16a34a';
    if (DOM.btnPickNextPage) DOM.btnPickNextPage.classList.remove('picked');
  } else if (hasContent) {
    DOM.paginationStatus.textContent = '未检测到翻页';
    DOM.paginationStatus.style.color = '#94a3b8';
    if (DOM.btnPickNextPage) DOM.btnPickNextPage.classList.remove('picked');
  } else {
    DOM.paginationStatus.textContent = '';
    if (DOM.btnPickNextPage) DOM.btnPickNextPage.classList.remove('picked');
  }
}

// ---- 检测页面分页 ---- 
async function checkPagination(tabId) {
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: detectPaginationOnPage,
    });
    if (results && results[0] && results[0].result) {
      paginationInfo = results[0].result;
      paginationDetected = paginationInfo.found;
    }
  } catch(e) {
    console.debug("[popup] checkPagination failed:", e.message || e);
    paginationDetected = false;
    paginationInfo = null;
  }
  updateMultiExtractButton();
}

// ---- 手动指定翻页按钮 ----
async function handlePickNextPage() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) { showError("无法获取当前标签页"); return; }
    var tabId = tabs[0].id;

    // 注入翻页按钮拾取器
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: startNextPagePicker,
    });
    // 关闭 popup，让用户在页面上操作
    window.close();
  } catch(e) {
    showError("启动翻页按钮选择失败: " + e.message);
  }
}

// ---- 选择模式切换 ----
function toggleSelectionMode() {
  if (isSelecting) {
    isSelecting = false;
    updateSelectButton();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return;
      try { chrome.tabs.sendMessage(tabs[0].id, { type: "stopSelection" }); } catch(e) {}
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: cleanupSelectionMode,
      }, () => {});
    });
  } else {
    clearAreaPicker();
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) { showError("无法获取当前标签页"); return; }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: injectSelectionMode,
      }, (results) => {
        if (chrome.runtime.lastError) {
          showError("注入失败：" + chrome.runtime.lastError.message + "。请刷新页面后重试。");
          return;
        }
        if (results && results[0] && results[0].result) {
          isSelecting = true;
          updateSelectButton();
          window.close();
        } else {
          showError("无法启动选择模式，请刷新页面后重试");
        }
      });
    });
  }
}

// ================================================================
// 注入函数：选择模式（自包含，不依赖外部变量）
// ================================================================

function injectSelectionMode() {
  var SEL_ATTR = 'data-we-selected';
  var SEL_STYLE_ID = 'we-extractor-selection-style';
  var SEL_TOOLBAR_ID = 'we-extractor-toolbar';
  var _selActive = false, _selHoverEl = null, _selCountEl = null, _selToolbar = null;

  try {
    if (!document.body || !document.head) return false;

    var existing = document.getElementById(SEL_TOOLBAR_ID); if (existing) existing.remove();
    var existingStyle = document.getElementById(SEL_STYLE_ID); if (existingStyle) existingStyle.remove();
    document.body.classList.remove('we-selecting');
    var oldHover = document.querySelectorAll('.we-sel-hover');
    for (var i = 0; i < oldHover.length; i++) oldHover[i].classList.remove('we-sel-hover');

    var s = document.createElement('style');
    s.id = SEL_STYLE_ID;
    s.textContent = [
      'body.we-selecting, body.we-selecting * { cursor: crosshair !important; }',
      '.we-sel-hover { outline: 2px dashed #3b82f6 !important; outline-offset: -2px !important; background-color: rgba(59,130,246,0.08) !important; }',
      '[' + SEL_ATTR + '="true"] { outline: 3px solid #16a34a !important; outline-offset: -3px !important; background-color: rgba(22,163,74,0.1) !important; box-shadow: 0 0 0 6px rgba(22,163,74,0.08) !important; }',
      '.we-sel-toolbar { position:fixed !important; bottom:20px !important; left:50% !important; transform:translateX(-50%) !important; z-index:2147483647 !important; background:#1e293b !important; color:#f1f5f9 !important; border-radius:12px !important; padding:10px 18px !important; display:flex !important; align-items:center !important; gap:10px !important; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important; font-size:14px !important; box-shadow:0 4px 24px rgba(0,0,0,0.35) !important; pointer-events:auto !important; user-select:none !important; }',
      '.we-sel-toolbar .we-count { font-weight:700 !important; color:#22c55e !important; }',
      '.we-sel-toolbar button { background:#334155 !important; color:#e2e8f0 !important; border:none !important; border-radius:8px !important; padding:7px 14px !important; cursor:pointer !important; font-size:13px !important; font-weight:500 !important; }',
      '.we-sel-toolbar button:hover { background:#475569 !important; }',
      '.we-sel-toolbar .we-btn-done { background:#16a34a !important; color:#fff !important; }',
      '.we-sel-toolbar .we-btn-clear { background:#b91c1c !important; }',
    ].join('\n');
    document.head.appendChild(s);

    function _selIsSelectable(el) {
      if (!el || el.nodeType !== 1) return false;
      var tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') return false;
      if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') return false;
      if (el.closest('#' + SEL_STYLE_ID + ', #' + SEL_TOOLBAR_ID)) return false;
      return true;
    }

    function _selUpdateCount() {
      if (_selCountEl) _selCountEl.textContent = document.querySelectorAll('[' + SEL_ATTR + '="true"]').length;
    }

    function _selClearAll() {
      var els = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
      for (var i = 0; i < els.length; i++) els[i].removeAttribute(SEL_ATTR);
      _selUpdateCount();
    }

    function cleanupUI() {
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
      var st = document.getElementById(SEL_STYLE_ID);
      if (st) st.remove();
    }

    function _selCancel() { _selClearAll(); cleanupUI(); /* 取消不发送 selectionComplete，避免重新弹出 popup */ }
    function _selComplete() { cleanupUI(); try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {} }

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
      e.preventDefault(); e.stopPropagation();
      try { target.classList.remove('we-sel-hover'); } catch(ee) {}
      if (target.getAttribute(SEL_ATTR) === 'true') target.removeAttribute(SEL_ATTR);
      else target.setAttribute(SEL_ATTR, 'true');
      _selUpdateCount();
    }

    function _selOnMouseOut(e) {
      try { var el = e.target; if (el && el.nodeType === 1) el.classList.remove('we-sel-hover'); } catch(ee) {}
    }

    function _selOnKeyDown(e) {
      if (!_selActive) return;
      if (e.key === 'Escape') { e.preventDefault(); _selCancel(); }
    }

    var tb = document.createElement('div');
    tb.id = SEL_TOOLBAR_ID;
    tb.className = 'we-sel-toolbar';
    tb.setAttribute('data-we-extension', 'true');
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', '元素选择工具栏');
    tb.innerHTML =
      '<span>已选: <span class="we-count" id="we-sel-count">0</span> 个元素</span>' +
      '<button class="we-btn-clear" id="we-btn-clear" aria-label="清除选中">清除</button>' +
      '<button id="we-btn-cancel" aria-label="取消选择">取消</button>' +
      '<button class="we-btn-done" id="we-btn-done" aria-label="完成选择">完成选择</button>';
    document.body.appendChild(tb);

    document.getElementById('we-btn-done').addEventListener('click', _selComplete);
    document.getElementById('we-btn-cancel').addEventListener('click', _selCancel);
    document.getElementById('we-btn-clear').addEventListener('click', _selClearAll);
    _selCountEl = document.getElementById('we-sel-count');
    _selToolbar = tb;

    // 注册 beforeunload 清理
    window.addEventListener('beforeunload', cleanupUI, { once: true });

    _selActive = true;
    document.body.classList.add('we-selecting');
    document.addEventListener('mousemove', _selOnMouseMove, true);
    document.addEventListener('click', _selOnClick, true);
    document.addEventListener('mouseout', _selOnMouseOut, true);
    document.addEventListener('keydown', _selOnKeyDown, true);
    _selUpdateCount();
    return true;
  } catch(e) { return false; }
}

// ================================================================
// 空值率计算与自动重试
// ================================================================

// 自动重试状态
let autoRetryCount = 0;
const MAX_AUTO_RETRY = 3;
const NULL_RATE_THRESHOLD = 0.3;

/**
 * 计算提取结果的空值率
 * 遍历 JSON 结果中所有叶子值，统计空值（null、undefined、空字符串、"-")占比
 */
function calculateNullRate(jsonText) {
  try {
    var obj;
    if (typeof jsonText === "string") {
      var cleaned = jsonText.trim();
      var mdMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (mdMatch) cleaned = mdMatch[1].trim();
      obj = JSON.parse(cleaned);
    } else {
      obj = jsonText;
    }
    if (!obj) return 1;

    var total = 0, nullCount = 0;

    function walk(v) {
      if (v === null || v === undefined) { total++; nullCount++; return; }
      if (typeof v === "string") {
        total++;
        if (v.trim() === "" || v.trim() === "-" || v.trim() === "N/A" || v.trim() === "无" || v.trim() === "未知") nullCount++;
        return;
      }
      if (typeof v === "number" || typeof v === "boolean") { total++; return; }
      if (Array.isArray(v)) { for (var i = 0; i < v.length; i++) walk(v[i]); return; }
      if (typeof v === "object") {
        var keys = Object.keys(v);
        for (var k = 0; k < keys.length; k++) walk(v[keys[k]]);
      }
    }

    walk(obj);
    return total === 0 ? 1 : nullCount / total;
  } catch(e) {
    return 0; // 解析失败不阻断流程
  }
}

// ---- 记录最近一次提取的空值率，供重试按钮使用 ----
let lastNullRate = 0;

/**
 * 手动重试：缩小选中元素范围后重新提取
 */
async function handleRetryNarrow() {
  if (selectedCount <= 0) {
    showError("没有选中元素，无法缩小范围");
    return;
  }

  hideError();
  DOM.btnRetryNarrow.disabled = true;
  autoRetryCount = 0;

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) { showError("无法获取当前标签页"); return; }
    var tabId = tabs[0].id;

    setStatus("正在缩小选择范围...", "info");
    const narrowResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: narrowSelectionScope,
    });
    var newCount = (narrowResults && narrowResults[0] && typeof narrowResults[0].result === "number")
      ? narrowResults[0].result : 0;

    if (newCount === 0) {
      showError("无法进一步缩小选择范围，请手动选择更精确的页面元素");
      setStatus("缩小范围失败", "error");
      return;
    }

    selectedCount = newCount;
    updateSelectButton();
    setStatus("已缩小到 " + newCount + " 个元素，正在根据新元素优化提取指令...", "info");

    // 获取缩小后选中元素的文本内容，用于优化提取指令
    var textResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: getSelectedElementTexts,
    });
    if (textResults && textResults[0] && textResults[0].result) {
      var texts = textResults[0].result;
      if (texts.length > 0) {
        // 传入已有指令，让 LLM 在旧指令基础上精炼优化
        var oldInstruction = DOM.txtInstruction.value.trim();
        await autoGenerateInstruction(texts, false, oldInstruction);
      }
    }

    setStatus("已缩小到 " + newCount + " 个元素，正在重新提取...", "info");
    handleExtract();
  } catch (err) {
    showError("重试失败：" + err.message);
    setStatus("重试失败", "error");
  }
}

// ================================================================
// 核心流程：提取
// ================================================================

async function handleExtract() {
  const instruction = DOM.txtInstruction.value.trim();
  if (!instruction) { DOM.txtInstruction.focus(); showError("请输入提取指令"); return; }

  chrome.storage.local.set({ lastInstruction: instruction }).catch(() => {});

  hideError(); hideResult(); hideProgress();
  DOM.btnExtract.disabled = true;
  DOM.btnRetryNarrow.disabled = true;
  DOM.btnScrollHint.classList.remove("hidden");

  // 建立 keepalive 连接，防止 Service Worker 在长时间 LLM 调用期间被终止
  var keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
  keepAlivePort.onMessage.addListener(function(msg) {
    // 心跳响应，无需处理
  });

  try {
    setStatus("正在读取配置...", "info");
    const config = await getConfig();
    if (!config.apiKey) { showError("请先在设置页面配置 API Key"); setStatus("未配置 API Key", "error"); return; }
    if (!config.baseUrl) { showError("请先在设置页面配置 Base URL"); setStatus("未配置 Base URL", "error"); return; }

    // ---- 提取循环：支持空值率过高时自动缩小范围重试 ----
    var extractSuccess = false;

    while (!extractSuccess && autoRetryCount <= MAX_AUTO_RETRY) {
      var isSelectedExtract = (selectedCount > 0);
      if (autoRetryCount === 0) {
        setStatus(isSelectedExtract ? "正在提取 " + selectedCount + " 个选中元素的快照..." : "正在生成页面快照...", "info");
      } else {
        setStatus("缩小范围后重新提取 (" + autoRetryCount + "/" + MAX_AUTO_RETRY + ")...", "info");
      }
      setProgress(autoRetryCount === 0 ? 10 : 5);

      const maxContentLength = await getMaxContentLength();
      const content = await extractPageContent(maxContentLength, isSelectedExtract);

      if (!content || content.trim().length === 0) {
        showError("未能生成有效快照，请确认页面已加载完成");
        setStatus("快照为空", "error");
        return;
      }

      setProgress(30);
      setStatus("快照 " + content.length.toLocaleString() + " 字符，正在调用 LLM 分析...", "info");

      setProgress(40);
      const result = await callLLM(config, instruction, content);
      setProgress(90);

      const jsonText = formatJSON(result);
      showResult(jsonText);

      // ---- 空值率检测 ----
      var nullRate = calculateNullRate(jsonText);
      var nullRatePercent = Math.round(nullRate * 100);
      lastNullRate = nullRate;

      if (nullRate > NULL_RATE_THRESHOLD && isSelectedExtract && autoRetryCount < MAX_AUTO_RETRY) {
        // 空值率过高且有选中元素，尝试缩小范围
        autoRetryCount++;
        setStatus("空值率 " + nullRatePercent + "% 过高，正在缩小选择范围 (" + autoRetryCount + "/" + MAX_AUTO_RETRY + ")...", "info");

        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tabs && tabs.length > 0) {
            const narrowResults = await chrome.scripting.executeScript({
              target: { tabId: tabs[0].id },
              func: narrowSelectionScope,
            });
            var newCount = (narrowResults && narrowResults[0] && typeof narrowResults[0].result === "number")
              ? narrowResults[0].result : 0;

            if (newCount > 0) {
              selectedCount = newCount;
              updateSelectButton();
              // 继续循环重试
              continue;
            }
          }
        } catch(retryErr) {
          console.warn("缩小选择范围失败:", retryErr);
        }
        // 缩小范围失败，跳出循环
        break;
      }

      // 空值率可接受 或 无选中元素 或 已达最大重试次数
      if (nullRate > NULL_RATE_THRESHOLD && isSelectedExtract && autoRetryCount >= MAX_AUTO_RETRY) {
        // 重试次数用尽，空值率仍然过高
        setStatus("空值率 " + nullRatePercent + "% 仍过高，请手动选择更精确的页面元素", "warning");
        setProgress(100);
        autoRetryCount = 0;
        lastSavedInstruction = instruction;
        lastSavedSystemPrompt = config.systemPrompt;
        updateSaveRuleButton(lastSavedInstruction);
        // 自动进入选择模式，让用户手动选择
        DOM.btnExtract.disabled = false;
        DOM.btnScrollHint.classList.add("hidden");
        try { keepAlivePort.disconnect(); } catch(e) {}
        toggleSelectionMode();
        return;
      }

      // 正常完成
      setStatus("提取完成" + (nullRate > 0 ? "（空值率 " + nullRatePercent + "%）" : ""), "success");
      setProgress(100);
      autoRetryCount = 0;
      extractSuccess = true;
      lastSavedInstruction = instruction;
      lastSavedSystemPrompt = config.systemPrompt;
      updateSaveRuleButton(lastSavedInstruction);
      // 注意：不在此处清理选中元素，保留选中状态以便用户使用"缩小重试"功能
    }
  } catch (err) {
    console.error("Extraction error:", err);
    showError("提取失败：" + err.message);
    setStatus("提取失败", "error");
    autoRetryCount = 0;
  } finally {
    // 断开 keepalive 连接
    try { keepAlivePort.disconnect(); } catch(e) {}
    DOM.btnExtract.disabled = false;
    DOM.btnRetryNarrow.disabled = (selectedCount <= 0);
    DOM.btnScrollHint.classList.add("hidden");
    setTimeout(() => { hideStatus(); hideProgress(); }, 3000);
  }
}

/** 提取完成后的清理工作 */
function cleanupAfterExtract(isSelectedExtract) {
  if (isSelectedExtract) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) chrome.tabs.sendMessage(tabs[0].id, { type: "clearSelection" });
      });
    } catch(e) {}
    selectedCount = 0;
    updateSelectButton();
  }
}

// ---- 配置 ----
async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["apiKey", "baseUrl", "modelName", "systemPrompt", "maxContentLength"], (data) => {
      resolve({
        apiKey:          data.apiKey          || "",
        baseUrl:         data.baseUrl         || "",
        modelName:       data.modelName       || EXTRACTOR_CONSTANTS.LLM_DEFAULT_MODEL,
        systemPrompt:    data.systemPrompt    || DEFAULT_SYSTEM_PROMPT,
        maxContentLength: data.maxContentLength || EXTRACTOR_CONSTANTS.DEFAULT_MAX_CONTENT_LENGTH,
      });
    });
  });
}

async function getMaxContentLength() {
  return new Promise((resolve) => {
    chrome.storage.sync.get("maxContentLength", (data) => {
      resolve(data.maxContentLength || EXTRACTOR_CONSTANTS.DEFAULT_MAX_CONTENT_LENGTH);
    });
  });
}

// ---- 提取页面内容（shared-extractor.js 已由 content_scripts 注入） ----
async function extractPageContent(maxLength) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) return reject(new Error("无法获取当前标签页"));
      const tabId = tabs[0].id;

      // shared-extractor.js 已通过 manifest content_scripts 在 document_idle 时注入，
      // window._WE 已可用，直接执行提取函数即可
      // 但如果 content script 未注入（如扩展安装后未刷新的旧标签页），需先注入 shared-extractor.js
      chrome.scripting.executeScript({
        target: { tabId },
        func: extractContentFromDOM,
        args: [maxLength],
      }, (results) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!results || results.length === 0 || !results[0].result) {
          // 可能是 window._WE 未注入导致的失败，尝试先注入 shared-extractor.js 再重试
          chrome.scripting.executeScript({
            target: { tabId },
            files: ["shared-extractor.js"],
          }, () => {
            if (chrome.runtime.lastError) return reject(new Error("内容提取返回为空，且注入 shared-extractor.js 失败：" + chrome.runtime.lastError.message));
            chrome.scripting.executeScript({
              target: { tabId },
              func: extractContentFromDOM,
              args: [maxLength],
            }, (retryResults) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (!retryResults || retryResults.length === 0 || !retryResults[0].result) return reject(new Error("内容提取返回为空"));
              resolve(retryResults[0].result);
            });
          });
          return;
        }
        resolve(results[0].result);
      });
    });
  });
}

// ================================================================
// 注入函数：extractContentFromDOM
// 依赖 window._WE（shared-extractor.js 已预先注入）
// 委托所有提取逻辑到 shared-extractor，消除代码重复
// ================================================================

async function extractContentFromDOM(maxLength) {
  var WE = window._WE;

  // 如果 shared-extractor.js 未注入（如扩展安装后未刷新的旧标签页），
  // 返回空值让调用方触发注入重试
  if (!WE || !WE.extractWithWait) {
    return null;
  }

  // 检测选中元素
  var selectedEls = [];
  try {
    var allSel = document.querySelectorAll('[data-we-selected="true"]');
    if (allSel.length > 0) {
      for (var si = 0; si < allSel.length; si++) {
        if (WE.isElementVisible(allSel[si])) selectedEls.push(allSel[si]);
      }
    }
  } catch(e) {}

  // 委托到 shared-extractor 的统一提取方法
  return await WE.extractWithWait(maxLength, 15000, selectedEls.length > 0 ? selectedEls : null);
}

// ---- LLM 调用（通过 background） ----
async function callLLM(config, instruction, content, options) {
  options = options || {};
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: "callLLM",
      config: { apiKey: config.apiKey, baseUrl: config.baseUrl, modelName: config.modelName, systemPrompt: config.systemPrompt },
      instruction, content, pageUrl: "",
      skipJsonFormat: !!options.skipJsonFormat,
    }, (response) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response) return reject(new Error("Background 未响应"));
      if (response.error) return reject(new Error(response.error));
      resolve(response.result);
    });
  });
}

// ---- JSON 格式化 ----
function formatJSON(raw) {
  try {
    var obj;
    if (typeof raw === "string") {
      var cleaned = raw.trim();
      var mdMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
      if (mdMatch) cleaned = mdMatch[1].trim();
      obj = JSON.parse(cleaned);
    } else { obj = raw; }
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    return typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
  }
}

// ---- 复制 ----
async function handleCopy() {
  const text = DOM.jsonOutput.textContent;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showCopyFeedback();
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); document.body.removeChild(ta);
    showCopyFeedback();
  }
}

function showCopyFeedback() {
  const origHTML = DOM.btnCopy.innerHTML;
  DOM.btnCopy.innerHTML = "✓ 已复制";
  DOM.btnCopy.style.color = "#16a34a";
  DOM.btnCopy.style.borderColor = "#16a34a";
  setTimeout(() => { DOM.btnCopy.innerHTML = origHTML; DOM.btnCopy.style.color = ""; DOM.btnCopy.style.borderColor = ""; }, 2000);
}

// ---- 下载 ----
async function handleDownload() {
  const text = DOM.jsonOutput.textContent;
  if (!text) return;
  const activeFormat = document.querySelector("#formatSwitcher .format-option.active");
  const format = activeFormat ? activeFormat.dataset.format : "json";
  const baseName = (document.title || "extracted-data").replace(/[\\/:*?"<>|]/g, "_").substring(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const namePrefix = baseName + "-" + timestamp;

  try {
    var blob, filename;
    switch (format) {
      case "csv":
        blob = new Blob(["\uFEFF" + jsonToCsv(text)], { type: "text/csv;charset=utf-8" });
        filename = namePrefix + ".csv";
        break;
      case "xlsx":
        blob = await jsonToXlsxBlob(text);
        filename = namePrefix + ".xlsx";
        break;
      default:
        blob = new Blob([text], { type: "application/json" });
        filename = namePrefix + ".json";
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus("已下载 " + format.toUpperCase() + " 文件", "success");
    setTimeout(hideStatus, 2000);
  } catch (e) { showError("下载失败：" + e.message); }
}

// ================================================================
// 自动检测页面主要内容区域
// ================================================================

async function autoDetectAndSelectContent(tabId) {
  setStatus("正在分析页面结构...", "info");
  const structResults = await chrome.scripting.executeScript({
    target: { tabId }, func: analyzePageStructure,
  });
  if (!structResults || !structResults[0] || !structResults[0].result) throw new Error("页面结构分析返回为空");

  const structure = structResults[0].result;
  if (!structure.sections || structure.sections.length === 0) throw new Error("未检测到可识别的页面区域");

  areaSections = structure.sections;
  currentAreaIndex = 0;
  renderAreaPicker();
  await selectArea(tabId, 0);
  hideStatus();
}

async function selectArea(tabId, areaIndex) {
  if (areaIndex < 0 || areaIndex >= areaSections.length) return;
  currentAreaIndex = areaIndex;

  const selectResults = await chrome.scripting.executeScript({
    target: { tabId }, func: autoSelectInSection, args: [areaIndex],
  });
  var selectCount = (selectResults && selectResults[0] && typeof selectResults[0].result === "number") ? selectResults[0].result : 0;

  selectedCount = selectCount;
  var s = areaSections[areaIndex];
  var areaLabel = s ? (s.idAttr || formatArea(s.area)) : "";

  DOM.btnSelect.innerHTML = '<svg class="btn-icon-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="2"></rect><circle cx="10" cy="8" r="1"></circle><circle cx="18" cy="18" r="1"></circle><line x1="10" y1="8" x2="18" y2="18"></line></svg>' + '已选' + (areaLabel ? '「' + areaLabel + '」' : ' 1 个');
  DOM.btnSelect.style.borderColor = "#16a34a";
  DOM.btnSelect.style.color = "#16a34a";
  DOM.btnExtract.textContent = "提取选中";
  DOM.btnExtract.style.background = "#16a34a";

  setStatus("已选中" + (areaIndex === 0 ? "最大显示面积区域" : "第" + (areaIndex + 1) + "大区域") + (areaLabel ? "「" + areaLabel + "」" : ""), "success");

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
  // 检测翻页
  checkPagination(tabId);
  updateAreaPickerHighlight();
  setTimeout(hideStatus, 3000);
}

async function switchToArea(areaIndex) {
  if (areaIndex === currentAreaIndex) return;
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || tabs.length === 0) return;
  setStatus("正在切换内容区域...", "info");
  await selectArea(tabs[0].id, areaIndex);
}

function clearAreaPicker() {
  areaSections = [];
  currentAreaIndex = 0;
  DOM.areaPicker.classList.add("hidden");
  DOM.areaPickerList.innerHTML = "";
}

function renderAreaPicker() {
  if (!areaSections || areaSections.length === 0) { DOM.areaPicker.classList.add("hidden"); return; }
  DOM.areaPicker.classList.remove("hidden");
  DOM.areaCount.textContent = areaSections.length + " 个区域";

  var html = "";
  for (var i = 0; i < areaSections.length; i++) {
    var s = areaSections[i];
    var isActive = (i === currentAreaIndex);
    var areaStr = formatArea(s.area);
    var preview = escapeHTML(truncate(s.textPreview, 60));
    var label = s.idAttr || s.tag;

    html += '<div class="area-picker-item' + (isActive ? " active" : "") + '" data-area-index="' + i + '" tabindex="0" role="option" aria-selected="' + isActive + '">' +
      '<span class="area-rank">' + (i + 1) + '</span>' +
      '<div class="area-info">' +
        '<div><span class="area-tag">' + escapeHTML(label) + '</span>' +
        '<span class="area-size">' + areaStr + '</span></div>' +
        '<div class="area-text-preview">' + preview + '</div>' +
      '</div>' +
    '</div>';
  }
  DOM.areaPickerList.innerHTML = html;

  var items = DOM.areaPickerList.querySelectorAll(".area-picker-item");
  for (var j = 0; j < items.length; j++) {
    (function(idx) {
      items[j].addEventListener("click", function() { switchToArea(idx); });
      items[j].addEventListener("keydown", function(e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchToArea(idx); }
        else if (e.key === "ArrowDown") { e.preventDefault(); var next = items[Math.min(idx + 1, items.length - 1)]; if (next) next.focus(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); var prev = items[Math.max(idx - 1, 0)]; if (prev) prev.focus(); }
      });
    })(j);
  }
}

function updateAreaPickerHighlight() {
  var items = DOM.areaPickerList.querySelectorAll(".area-picker-item");
  for (var i = 0; i < items.length; i++) {
    items[i].classList.toggle("active", i === currentAreaIndex);
    items[i].setAttribute("aria-selected", (i === currentAreaIndex).toString());
  }
}

// ================================================================
// 多页提取核心逻辑
// ================================================================

/**
 * 单页提取辅助函数 — 复用 extractPageContent + callLLM，输出格式化 JSON 字符串
 */
async function extractSinglePage(instruction, config) {
  var maxLen = EXTRACTOR_CONSTANTS ? EXTRACTOR_CONSTANTS.DEFAULT_MAX_CONTENT_LENGTH : 50000;
  try {
    var synced = await chrome.storage.sync.get("maxContentLength");
    if (synced.maxContentLength) maxLen = synced.maxContentLength;
  } catch(e) {}

  var content = await extractPageContent(maxLen);
  if (!content || content.trim().length === 0) {
    throw new Error("页面快照为空");
  }
  var result = await callLLM(config, instruction, content);
  return formatJSON(result);
}

/**
 * 翻页后等待页面就绪
 * URL 变化 → 等待 tab 加载完成；URL 不变 → AJAX 翻页，等待内容稳定
 */
async function waitForPageReady(tabId, prevUrl) {
  var maxWait = 25000;
  var pollInterval = 400;
  var stableThreshold = 3;
  var startTime = Date.now();

  // 先等待 URL 变化型翻页完成
  var urlChangePhase = true;
  while (Date.now() - startTime < maxWait) {
    try {
      var tab = await chrome.tabs.get(tabId);

      if (tab.url !== prevUrl) {
        // URL 发生变化 — 传统页面跳转
        if (tab.status === 'complete') {
          await _sleep(800); // 页面基础渲染完成
          urlChangePhase = false;
          break; // 跳出，进入 DOM 稳定检测阶段
        }
      } else if (tab.status === 'complete') {
        // URL 未变 — AJAX 翻页，直接进入 DOM 稳定检测
        if (urlChangePhase) {
          urlChangePhase = false;
          break;
        }
      }
      await _sleep(pollInterval);
    } catch(e) {
      return { ready: false, error: e.message };
    }
  }

  if (Date.now() - startTime >= maxWait) {
    return { ready: false, error: '页面加载超时' };
  }

  // DOM 稳定检测：轮询页面 body 文本长度，连续 N 次不变则认为内容稳定
  var prevTextLen = -1;
  var stableCount = 0;
  var ajaxTimeout = Date.now() + 15000;

  while (Date.now() < ajaxTimeout) {
    try {
      var checkResults = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function() {
          try { return (document.body ? document.body.textContent || '' : '').length; } catch(e) { return -1; }
        },
      });
      var textLen = (checkResults && checkResults[0] && typeof checkResults[0].result === 'number')
        ? checkResults[0].result : -1;

      if (textLen === prevTextLen && textLen > 0) {
        stableCount++;
        if (stableCount >= stableThreshold) {
          await _sleep(300); // 最后给一点喘息时间
          return { ready: true, urlChanged: false };
        }
      } else {
        stableCount = 0;
        prevTextLen = textLen;
      }
    } catch(e) {
      // 注入失败（页面可能还在导航），继续等待
    }
    await _sleep(pollInterval);
  }

  // 超时但页面可能已经稳定，返回 ready
  return { ready: true, urlChanged: false };
}

/**
 * 合并多页提取结果
 */
function mergePageResults(resultsArray) {
  if (!resultsArray || resultsArray.length === 0) return '[]';
  if (resultsArray.length === 1) return resultsArray[0];

  var parsed = [];
  var allArrays = true;
  var allObjects = true;

  for (var i = 0; i < resultsArray.length; i++) {
    try {
      var obj = JSON.parse(resultsArray[i]);
      parsed.push(obj);
      if (!Array.isArray(obj)) allArrays = false;
      if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) allObjects = false;
    } catch(e) {
      parsed.push(resultsArray[i]);
      allArrays = false;
      allObjects = false;
    }
  }

  // 全部是数组 → 拼接
  if (allArrays) {
    var merged = [];
    for (var j = 0; j < parsed.length; j++) {
      merged = merged.concat(parsed[j]);
    }
    return JSON.stringify(merged, null, 2);
  }

  // 全部是普通对象 → 包裹为数组
  if (allObjects) {
    return JSON.stringify(parsed, null, 2);
  }

  // 混合类型 → 按页组织
  return JSON.stringify(parsed, null, 2);
}

/**
 * 翻页提取主处理函数
 */
async function handleMultiPageExtract() {
  var instruction = DOM.txtInstruction.value.trim();
  if (!instruction) {
    showError("请先输入提取指令");
    return;
  }
  if (multiPageExtracting) return;

  multiPageExtracting = true;
  console.debug("[popup] handleMultiPageExtract: starting", { pageCount: pageCount, customXPath: !!customNextPageXPath });
  DOM.btnMultiExtract.disabled = true;
  DOM.btnExtract.disabled = true;
  DOM.btnRetryNarrow.disabled = true;
  hideError(); hideResult();

  var pageCount = parseInt(DOM.pageCount.value, 10);
  if (isNaN(pageCount) || pageCount < 1) pageCount = 3;
  if (pageCount > 50) pageCount = 50;

  var keepAlivePort = chrome.runtime.connect({ name: "keepalive" });
  var allResults = [];
  var successCount = 0;
  var tabId = null;
  var prevUrl = '';

  try {
    // 获取配置
    var config = await getConfig();
    if (!config.apiKey) { showError("请先在设置页面配置 API Key"); return; }
    if (!config.baseUrl) { showError("请先在设置页面配置 Base URL"); return; }

    // 获取当前 tab
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) { showError("无法获取当前标签页"); return; }
    tabId = tabs[0].id;
    prevUrl = tabs[0].url;

    // 逐页提取
    for (var page = 1; page <= pageCount; page++) {
      setStatus("翻页提取 第 " + page + "/" + pageCount + " 页...", "info");
      setProgress(Math.round((page - 1) / pageCount * 90));

      // 提取当前页
      var jsonText = null;
      try {
        jsonText = await extractSinglePage(instruction, config);
        allResults.push(jsonText);
        successCount++;
      } catch(extractErr) {
        console.warn("第 " + page + " 页提取失败:", extractErr);
        setStatus("第 " + page + " 页提取失败: " + extractErr.message, "warning");
        // 如果第一页就失败，直接终止
        if (page === 1) {
          showError("首页提取失败：" + extractErr.message);
          return;
        }
        // 后续页失败则停止翻页
        break;
      }

      // 最后一页，不再翻页
      if (page >= pageCount) break;

      // 点击下一页（优先点「下一页」按钮，不存在则点具体页码）
      var targetPageNum = page + 1;
      setStatus("正在翻到第 " + targetPageNum + " 页...", "info");
      var clickResults = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: clickNextPageOnPage,
        args: [targetPageNum, customNextPageXPath],
      });

      var clicked = clickResults && clickResults[0] && clickResults[0].result && clickResults[0].result.clicked;
      if (!clicked) {
        setStatus("未找到翻页按钮，提取完成（已提取 " + successCount + " 页）", "success");
        break;
      }

      // 等待页面就绪
      var readyResult = await waitForPageReady(tabId, prevUrl);
      if (!readyResult.ready) {
        setStatus("页面加载超时，提取完成（已提取 " + successCount + " 页）", "warning");
        break;
      }

      // 更新当前 URL 用于下次翻页判断
      try {
        var updatedTab = await chrome.tabs.get(tabId);
        prevUrl = updatedTab.url;
      } catch(e) {}

      // 页面跳转后可能需要重新执行共享脚本（content_scripts 会自动注入），短暂等待
      if (readyResult.urlChanged) {
        await _sleep(1000);
      }
    }

    // 合并结果
    setProgress(95);
    setStatus("正在合并 " + successCount + " 页数据...", "info");

    var mergedJson = mergePageResults(allResults);
    showResult(mergedJson);

    // 计算并显示空值率
    var nullRate = calculateNullRate(mergedJson);
    var nullRatePercent = Math.round(nullRate * 100);
    lastNullRate = nullRate;

    setProgress(100);
    if (successCount < pageCount) {
      setStatus("提取完成：成功 " + successCount + "/" + pageCount + " 页" + (nullRate > 0 ? "（空值率 " + nullRatePercent + "%）" : ""), "success");
    } else {
      setStatus("提取完成：全部 " + pageCount + " 页" + (nullRate > 0 ? "（空值率 " + nullRatePercent + "%）" : ""), "success");
    }

    lastSavedInstruction = instruction;
    lastSavedSystemPrompt = config.systemPrompt;
    updateSaveRuleButton(lastSavedInstruction);
    updateMultiExtractButton();

  } catch(err) {
    console.error("Multi-page extraction error:", err);
    showError("翻页提取失败：" + err.message);
    setStatus("翻页提取失败", "error");
  } finally {
    multiPageExtracting = false;
    try { keepAlivePort.disconnect(); } catch(e) {}
    DOM.btnExtract.disabled = false;
    DOM.btnRetryNarrow.disabled = (selectedCount <= 0);
    updateMultiExtractButton();
    setTimeout(function() { hideStatus(); hideProgress(); }, 5000);
  }
}
