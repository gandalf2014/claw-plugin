// ============================================================
// popup.js — 弹窗编排逻辑（精简版）
//
// 已拆分模块：
//   shared-prompt.js     → 默认 System Prompt
//   constants.js         → 全局配置常量
//   utils.js             → 通用工具函数
//   csv-utils.js         → JSON → CSV 转换
//   xlsx-builder.js      → JSON → XLSX 内联生成器
//   history.js           → 提取历史记录管理
//   instruction-generator.js → 自动指令生成
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

  DOM.quickBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      DOM.txtInstruction.value = btn.dataset.prompt;
      DOM.txtInstruction.focus();
      instructionFromStorage = false;
    });
  });

  DOM.txtInstruction.addEventListener("input", () => {
    instructionFromStorage = false;
  });

  DOM.btnSelect.addEventListener("click", toggleSelectionMode);
  DOM.btnExtract.addEventListener("click", handleExtract);
  DOM.btnCopy.addEventListener("click", handleCopy);
  DOM.btnDownload.addEventListener("click", handleDownload);

  DOM.btnSaveRule.addEventListener("click", () => {
    handleSaveRule(lastSavedInstruction, lastSavedSystemPrompt);
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

// ---- 状态管理 ----
function setStatus(msg, type) {
  type = type || "info";
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
      checkSelectedElements();
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

    function _selCancel() { _selClearAll(); cleanupUI(); try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {} }
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

function cleanupSelectionMode() {
  try {
    var ids = ['we-extractor-toolbar', 'we-extractor-selection-style', 'we-auto-select-style'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el) el.remove();
    }
    document.body.classList.remove('we-selecting');
    var hs = document.querySelectorAll('.we-sel-hover');
    for (var j = 0; j < hs.length; j++) hs[j].classList.remove('we-sel-hover');
    var selected = document.querySelectorAll('[data-we-selected="true"]');
    for (var k = 0; k < selected.length; k++) {
      selected[k].removeAttribute('data-we-selected');
      selected[k].style.outline = '';
      selected[k].style.boxShadow = '';
      selected[k].style.backgroundColor = '';
      selected[k].style.borderRadius = '';
    }
  } catch(e) {}
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
  DOM.btnScrollHint.classList.remove("hidden");

  try {
    setStatus("正在读取配置...", "info");
    const config = await getConfig();
    if (!config.apiKey) { showError("请先在设置页面配置 API Key"); setStatus("未配置 API Key", "error"); return; }
    if (!config.baseUrl) { showError("请先在设置页面配置 Base URL"); setStatus("未配置 Base URL", "error"); return; }

    var isSelectedExtract = (selectedCount > 0);
    setStatus(isSelectedExtract ? "正在提取 " + selectedCount + " 个选中元素的快照..." : "正在生成页面快照...", "info");
    setProgress(10);

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
    setStatus("提取完成", "success");
    setProgress(100);

    lastSavedInstruction = instruction;
    lastSavedSystemPrompt = config.systemPrompt;
    updateSaveRuleButton(lastSavedInstruction);

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
    showError("提取失败：" + err.message);
    setStatus("提取失败", "error");
  } finally {
    DOM.btnExtract.disabled = false;
    DOM.btnScrollHint.classList.add("hidden");
    setTimeout(() => { hideStatus(); hideProgress(); }, 3000);
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

// ---- 提取页面内容（注入 shared-extractor.js + extractContentFromDOM） ----
async function extractPageContent(maxLength) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs || tabs.length === 0) return reject(new Error("无法获取当前标签页"));
      const tabId = tabs[0].id;

      // Step 1: 注入 shared-extractor.js
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["shared-extractor.js"],
        });
      } catch (e) {
        return reject(new Error("注入 shared-extractor.js 失败: " + e.message));
      }

      // Step 2: 注入提取函数（引用 window._WE）
      chrome.scripting.executeScript({
        target: { tabId },
        func: extractContentFromDOM,
        args: [maxLength],
      }, (results) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!results || results.length === 0 || !results[0].result) return reject(new Error("内容提取返回为空"));
        resolve(results[0].result);
      });
    });
  });
}

// ================================================================
// 注入函数：extractContentFromDOM
// 依赖 window._WE（shared-extractor.js 已预先注入）
// ================================================================

async function extractContentFromDOM(maxLength) {
  var WE = window._WE;
  var SEL_ATTR = 'data-we-selected';

  // ---- 检测选中元素 ----
  var selectedEls = [];
  var selectedOnly = false;
  try {
    var allSel = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
    if (allSel.length > 0) {
      selectedOnly = true;
      for (var si = 0; si < allSel.length; si++) {
        if (WE.isElementVisible(allSel[si])) selectedEls.push(allSel[si]);
      }
    }
  } catch(e) {}

  // ---- 选中模式下的受限扫描 ----
  function $scanDataInRoots(roots) {
    var lines = []; var MAX_ITEMS = 40; var count = 0;
    var pp = /[¥￥$€£]\s*\d[\d,.]*|(\d[\d,.]*)\s*(起|元|晚|起\/晚|元起|元\/晚)/;
    for (var ri = 0; ri < roots.length && count < MAX_ITEMS; ri++) {
      try {
        var allEls = roots[ri].querySelectorAll("div, h3, h4, p, span, li, dt, dd, td, th");
        var cands = [];
        for (var ei = 0; ei < allEls.length; ei++) {
          var el = allEls[ei];
          if (!WE.isElementVisible(el)) continue;
          var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
          if (txt.length < 8 || txt.length > 300) continue;
          cands.push({ el: el, text: txt });
        }
        for (var ci = 0; ci < cands.length && count < MAX_ITEMS; ci++) {
          var c = cands[ci];
          if (!pp.test(c.text)) continue;
          var label = "";
          var cel = c.el;
          var prev = cel.previousElementSibling;
          for (var pi = 0; pi < 3 && prev; pi++) {
            var pTag = prev.tagName.toLowerCase();
            var pText = (prev.textContent || "").replace(/\s+/g, " ").trim();
            if (pTag.match(/^h[1-6]$/) && pText.length > 0) { label = pText; break; }
            if (pText.length > 0 && pText.length <= 100 && !pp.test(pText)) { label = pText; break; }
            prev = prev.previousElementSibling;
          }
          var item = "  [" + (count + 1) + "]";
          if (label) item += ' label: "' + WE.esc(label, 300) + '"';
          item += ' data: "' + WE.esc(c.text, 600) + '"';
          lines.push(item); count++;
        }
      } catch(e) {}
    }
    return lines.join("\n");
  }

  // ---- 受限树遍历（选中元素） ----
  function $walkRoots(roots, remaining) {
    var T_LANDMARK = { header:"banner", main:"main", nav:"navigation", footer:"contentinfo", aside:"complementary", form:"form" };
    var T_SKIP = { script:1, style:1, svg:1, noscript:1, iframe:1, canvas:1, video:1, audio:1, template:1, link:1, meta:1, br:1, hr:1, wbr:1 };
    var T_LEAF = { button:1, input:1, textarea:1, select:1, img:1, label:1 };
    var tLines = []; var tTotal = 0; var hit = false;

    function tSp(n) { var s = ""; for (var j = 0; j < n; j++) s += "  "; return s; }
    function tEmit(depth, text) { if (hit) return false; var line = tSp(depth) + text; if (tTotal + line.length + 1 > remaining) { hit = true; return false; } tLines.push(line); tTotal += line.length + 1; return true; }
    function tVis(el) {
      if (!el || el.nodeType !== 1) return false; var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      if (el !== document.body && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
      if (el.getAttribute("aria-hidden") === "true") return false; if (el.hasAttribute("hidden")) return false; return true;
    }
    function tRoleOf(el) {
      var tag = el.tagName.toLowerCase(); var ex = el.getAttribute("role"); if (ex) return ex;
      if (T_LANDMARK.hasOwnProperty(tag)) return T_LANDMARK[tag];
      var h = tag.match(/^h([1-6])$/); if (h) return "heading [h" + h[1] + "]";
      switch (tag) { case "a":return "link"; case "ul":case "ol":return "list"; case "li":return "listitem"; case "button":return "button"; case "table":return "table"; case "tr":return "row"; case "td":return "cell"; case "th":return "cell [th]"; case "img":return "image"; case "input":return "textbox"; case "textarea":return "textbox"; case "select":return "combobox"; case "p":return "paragraph"; case "label":return "label"; default:return ""; }
    }
    function tDirTxt(el) { var t = ""; for (var i = 0; i < el.childNodes.length; i++) { if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent; } return t.replace(/\s+/g, " ").trim(); }
    function tEsc(s, lim) { if (!s) return ""; lim = lim || 500; s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t"); if (s.length > lim) s = s.substring(0, lim - 3) + "..."; return s; }
    function tLnk(el) { var h = (el.getAttribute("href") || "").trim(); if (!h || h.toLowerCase().startsWith("javascript:")) return ""; if (h.length > 500) h = h.substring(0, 497) + "..."; return h; }

    function tWalk(node, depth) {
      if (hit || depth > 12) return;
      if (node.nodeType === 3) { var t = node.textContent.replace(/\s+/g, " ").trim(); if (t) tEmit(depth, 'text "' + tEsc(t) + '"'); return; }
      if (node.nodeType !== 1) return; if (!tVis(node)) return;
      var tag = node.tagName.toLowerCase(); if (T_SKIP.hasOwnProperty(tag)) return;
      var role = tRoleOf(node); var isLeaf = T_LEAF.hasOwnProperty(tag);
      var hasVisKids = false;
      if (!isLeaf) { for (var i = 0; i < node.children.length; i++) { var c = node.children[i]; if (tVis(c) && !T_SKIP.hasOwnProperty(c.tagName.toLowerCase())) { hasVisKids = true; break; } } }
      if (!hasVisKids || isLeaf) {
        var text = "", href = "";
        if (tag === "img") text = (node.getAttribute("alt") || node.getAttribute("title") || "").trim();
        else if (tag === "a") { text = tDirTxt(node); href = tLnk(node); }
        else if (tag === "input") text = (node.getAttribute("placeholder") || node.getAttribute("value") || node.getAttribute("name") || "").trim();
        else text = tDirTxt(node);
        if (text) { if (!role) role = "text"; var line = role; if (tag === "a" && href) line += ' "' + tEsc(text) + '" [' + tEsc(href, 500) + ']'; else line += ' "' + tEsc(text) + '"'; tEmit(depth, line); }
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

  // ---- 扁平数据提取 ----
  function $extractFlatData() {
    var lines = []; var MAX_ITEMS = 40; var count = 0;
    try {
      var pp = /[¥￥$€£]\s*\d[\d,.]*|(\d[\d,.]*)\s*(起|元|晚|起\/晚|元起|元\/晚)/;
      var candidates = [];
      var allEls = document.querySelectorAll("div, h3, h4, p, span, li, dt, dd, td, th");
      for (var ei = 0; ei < allEls.length; ei++) {
        var el = allEls[ei];
        if (!WE.isElementVisible(el)) continue;
        var txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length < 8 || txt.length > 300) continue;
        candidates.push({ el: el, text: txt });
      }
      for (var ci = 0; ci < candidates.length && count < MAX_ITEMS; ci++) {
        var c = candidates[ci];
        if (!pp.test(c.text)) continue;
        var label = "", cel = c.el;
        var prev = cel.previousElementSibling;
        for (var pi = 0; pi < 3 && prev; pi++) {
          var pTag = prev.tagName.toLowerCase();
          var pText = (prev.textContent || "").replace(/\s+/g, " ").trim();
          if (pTag.match(/^h[1-6]$/) && pText.length > 0) { label = pText; break; }
          if (pText.length > 0 && pText.length <= 100 && !pp.test(pText)) { label = pText; break; }
          prev = prev.previousElementSibling;
        }
        if (!label && cel.parentElement) {
          var dt = "";
          for (var j = 0; j < cel.parentElement.childNodes.length; j++) {
            if (cel.parentElement.childNodes[j] === cel) break;
            if (cel.parentElement.childNodes[j].nodeType === 3) dt += cel.parentElement.childNodes[j].textContent;
          }
          dt = dt.replace(/\s+/g, " ").trim();
          if (dt.length > 0 && dt.length <= 100) label = dt;
        }
        var item = "  [" + (count + 1) + "]";
        if (label) item += ' label: "' + WE.esc(label, 300) + '"';
        item += ' data: "' + WE.esc(c.text, 600) + '"';
        lines.push(item); count++;
      }
    } catch(e) {}
    return lines.join("\n");
  }

  // ================================================================
  // Phase 0: 等待动态内容 / 选中模式跳过
  // ================================================================
  var waitResult;
  if (selectedOnly) {
    waitResult = { ready: true, waited: 0, dataSources: ["user_selected_elements"], reason: "user_selected" };
  } else {
    var qc = WE.quickContentCheck();
    if (qc.ready) {
      waitResult = { ready: true, waited: 0, dataSources: qc.sources, reason: "content_already_loaded" };
    } else if (!WE.isDynamicPage()) {
      waitResult = { ready: true, waited: 0, dataSources: [], reason: "static_page" };
    } else {
      var pendingRequests = 0, apiUrls = [];
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

      var timeoutMs = 15000;
      var startTime = Date.now();
      var lastLen = 0, stableCount = 0;

      while (Date.now() - startTime < timeoutMs) {
        var ck = WE.quickContentCheck();
        var curLen = document.body ? document.body.innerHTML.length : 0;
        if (ck.ready) { WE.restoreNetworkMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: Date.now() - startTime, dataSources: ck.sources.concat(apiUrls), reason: "content_detected" }; break; }
        if (curLen === lastLen) { stableCount++; if (stableCount >= 5 && pendingRequests === 0) { WE.restoreNetworkMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: Date.now() - startTime, dataSources: apiUrls, reason: "content_stable" }; break; } }
        else { stableCount = 0; lastLen = curLen; }
        await WE.sleep(400);
      }
      if (!waitResult) { WE.restoreNetworkMonitors(origFetch, origXOpen, origXSend); waitResult = { ready: true, waited: timeoutMs, dataSources: apiUrls, reason: "timeout" }; }
    }
  }

  // ================================================================
  // Phase 1: SSR 内嵌数据
  // ================================================================
  var ssrSection = "";
  if (!selectedOnly) {
    ssrSection = WE.extractSSRDataSection();
  }

  // ================================================================
  // Phase 2: 快照
  // ================================================================
  var remaining = maxLength - ssrSection.length - 500;
  if (remaining < 5000) remaining = 5000;

  var snapshot = "";
  if (selectedOnly && selectedEls.length > 0) {
    try { snapshot = $walkRoots(selectedEls, remaining); } catch (e) { snapshot = "Snapshot error: " + e.message; }
  } else {
    snapshot = WE.extractStructuredContent(remaining);
  }

  // ================================================================
  // Phase 2.5: 扁平数据列表
  // ================================================================
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
  result += 'title: "' + (document.title || "") + '"\n';
  result += 'url: "' + (window.location.href || "") + '"\n';
  result += "wait_result: " + waitResult.reason + " (waited " + waitResult.waited + "ms)\n";
  if (waitResult.dataSources.length > 0) result += "data_sources: " + waitResult.dataSources.slice(0, 10).join(", ") + "\n";
  if (selectedOnly) result += "selected_mode: true (" + selectedEls.length + " user-selected elements)\n";
  result += "\n";
  if (ssrSection.trim().length > 0) result += ssrSection + "\n";
  if (flatDataSection.trim().length > 0) {
    result += "=== Flat Data List (key data items with prices) ===\n";
    result += "format: [N] label: \"...\" data: \"...\"\n";
    result += flatDataSection + "\n\n";
  }
  result += "=== Accessibility Tree Snapshot ===\n";
  result += snapshot;
  return result;
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
    let obj;
    if (typeof raw === "string") {
      let cleaned = raw.trim();
      const mdMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
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
function handleDownload() {
  const text = DOM.jsonOutput.textContent;
  if (!text) return;
  const format = document.getElementById("selDownloadFormat").value;
  const baseName = (document.title || "extracted-data").replace(/[\\/:*?"<>|]/g, "_").substring(0, 50);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const namePrefix = baseName + "-" + timestamp;

  try {
    let blob, filename;
    switch (format) {
      case "csv":
        blob = new Blob(["\uFEFF" + jsonToCsv(text)], { type: "text/csv;charset=utf-8" });
        filename = namePrefix + ".csv";
        break;
      case "xlsx":
        blob = jsonToXlsxBlob(text);
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
// 注入函数：analyzePageStructure（自包含）
// ================================================================

function analyzePageStructure() {
  var SKIP_TAGS = { script:1, style:1, svg:1, noscript:1, iframe:1, canvas:1, video:1, audio:1, template:1, link:1, meta:1, br:1, hr:1, wbr:1, title:1 };

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS.hasOwnProperty(el.tagName.toLowerCase())) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
    return true;
  }

  function isContainer(el) {
    var children = 0, textLen = 0;
    for (var i = 0; i < el.children.length; i++) { if (isVisible(el.children[i])) children++; }
    textLen = (el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "").length;
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
    return cls.trim().split(/\s+/).slice(0, 3).join(" ");
  }

  function isNonContent(el) {
    var tag = el.tagName.toLowerCase();
    var role = (el.getAttribute("role") || "").toLowerCase();
    var cls = (el.className || "").toLowerCase();
    var id = (el.id || "").toLowerCase();
    if (tag === "nav" || tag === "header" || tag === "footer" || tag === "aside") return true;
    if (role === "navigation" || role === "banner" || role === "contentinfo" || role === "complementary") return true;
    if (/^(nav|header|footer|sidebar|aside|menu|toolbar|breadcrumb|copyright)/.test(id)) return true;
    if (/\b(nav|header|footer|sidebar|aside|menu|toolbar|breadcrumb|copyright|ad-|advertisement|banner-ad|popup|modal|overlay|drawer)\b/.test(cls)) return true;
    var textLen = (el.textContent || "").replace(/\s+/g, " ").trim().length;
    var childCount = 0;
    for (var nc = 0; nc < el.children.length; nc++) {
      var cc = el.children[nc];
      if (cc.nodeType === 1) { var s2 = getComputedStyle(cc); if (s2.display !== "none" && s2.visibility !== "hidden") childCount++; }
    }
    if (childCount > 15 && textLen > 0 && textLen / childCount < 10) return true;
    return false;
  }

  var root = document.querySelector("main, [role='main']") || document.querySelector("article, [role='article']") || document.body;
  if (!root) root = document.documentElement;

  var sections = [];
  var sectionCounter = 0;

  function walkChildren(parent, depth) {
    if (depth > 10 || sectionCounter >= 30) return;
    var children = parent.children;
    for (var i = 0; i < children.length; i++) {
      if (sectionCounter >= 30) break;
      var child = children[i];
      if (!isVisible(child)) continue;
      if (isNonContent(child)) continue;

      var tag = child.tagName.toLowerCase();
      var preview = getTextPreview(child, 150);
      if (preview.length < 5) continue;

      var childCount = 0;
      for (var j = 0; j < child.children.length; j++) { if (isVisible(child.children[j])) childCount++; }

      var isSection = false;
      if (["main", "article", "section"].indexOf(tag) >= 0) isSection = true;
      var role = child.getAttribute("role");
      if (role && ["main", "article", "region"].indexOf(role) >= 0) isSection = true;
      var cls = (child.className || "").toLowerCase();
      if (/content|main|article|body|wrapper|container|list|grid|results|products/.test(cls) && childCount >= 2) isSection = true;
      if (childCount >= 5 && preview.length >= 50) isSection = true;
      if (preview.length >= 200) isSection = true;

      if (isSection) {
        var rect = child.getBoundingClientRect();
        child.setAttribute("data-we-section", String(sectionCounter));
        sections.push({
          index: sectionCounter, tag: tag, idAttr: child.id || "",
          className: getClassSummary(child), textPreview: preview,
          childCount: childCount, depth: depth, area: Math.round(rect.width * rect.height),
        });
        sectionCounter++;
      } else if (isContainer(child)) {
        walkChildren(child, depth + 1);
      }
    }
  }

  walkChildren(root, 0);
  if (sections.length <= 1 && root === document.body) { sectionCounter = 0; sections = []; walkChildren(document.body, 0); }

  sections.sort(function(a, b) { return b.area - a.area; });
  for (var si = 0; si < sections.length; si++) {
    var oldIndex = sections[si].index;
    var el = document.querySelector('[data-we-section="' + oldIndex + '"]');
    if (el) el.setAttribute("data-we-section", String(si));
    sections[si].index = si;
  }

  return { title: document.title || "", url: window.location.href, sectionCount: sections.length, sections: sections };
}

// ================================================================
// 注入函数：autoSelectInSection（自包含）
// ================================================================

function autoSelectInSection(sectionIndex) {
  var section = document.querySelector('[data-we-section="' + sectionIndex + '"]');
  if (!section) return 0;

  var allSections = document.querySelectorAll("[data-we-section]");
  for (var ai = 0; ai < allSections.length; ai++) allSections[ai].removeAttribute("data-we-section");

  var oldSelected = document.querySelectorAll('[data-we-selected="true"]');
  for (var os = 0; os < oldSelected.length; os++) {
    oldSelected[os].removeAttribute("data-we-selected");
    oldSelected[os].style.outline = "";
    oldSelected[os].style.boxShadow = "";
    oldSelected[os].style.backgroundColor = "";
    oldSelected[os].style.borderRadius = "";
  }

  if (!document.getElementById("we-auto-select-style")) {
    var styleEl = document.createElement("style");
    styleEl.id = "we-auto-select-style";
    styleEl.textContent =
      "[data-we-selected='true'] {" +
      "  outline: 3px solid #16a34a !important; outline-offset: 3px !important;" +
      "  box-shadow: 0 0 0 6px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.3) !important;" +
      "  background-color: rgba(22,163,74,0.04) !important; border-radius: 4px !important;" +
      "  animation: we-pulse 2s ease-in-out infinite !important;" +
      "}" +
      "@keyframes we-pulse {" +
      "  0%, 100% { box-shadow: 0 0 0 6px rgba(22,163,74,0.15), 0 0 20px rgba(22,163,74,0.3); }" +
      "  50% { box-shadow: 0 0 0 10px rgba(22,163,74,0.08), 0 0 30px rgba(22,163,74,0.5); }" +
      "}" +
      "[data-we-selected='true']::before {" +
      "  content: 'AI  主要区域'; position: absolute; top: -32px; left: 4px;" +
      "  background: #16a34a; color: #fff; font-size: 12px; font-weight: 600;" +
      "  padding: 2px 10px; border-radius: 4px; z-index: 2147483647;" +
      "  pointer-events: none; white-space: nowrap;" +
      "}";
    document.head.appendChild(styleEl);
  }

  var pos = getComputedStyle(section).position;
  if (pos === "static") section.style.position = "relative";

  section.setAttribute("data-we-selected", "true");
  if (section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "center" });
  return 1;
}
