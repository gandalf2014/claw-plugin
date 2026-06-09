// ============================================================
// content.js — 页面内容提取器（精简版）
// 作为 content_script 注入到每个页面
// 共享提取逻辑已迁移至 shared-extractor.js（window._WE）
// ============================================================

var WEBEX_DEBUG = false;
function _weLog(/* ... */) {
  if (!WEBEX_DEBUG) return;
  console.log.apply(console, arguments);
}

/**
 * 监听来自 popup 的直接消息
 */
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  // --- 元素选择模式 ---
  if (request.type === "startSelection") {
    startSelectionMode();
    sendResponse({ success: true });
    return false;
  }
  if (request.type === "stopSelection") {
    stopSelectionMode();
    sendResponse({ success: true });
    return false;
  }
  if (request.type === "getSelectedContent") {
    sendResponse({
      success: true,
      html: getSelectedElementsHTML(),
      count: getSelectedElementsCount()
    });
    return false;
  }
  if (request.type === "clearSelection") {
    clearSelectedMarkers();
    sendResponse({ success: true });
    return false;
  }

  // --- 内容提取（委托给 window._WE） ---
  if (request.type === "extractContent") {
    (async function() {
      try {
        var maxLength = request.maxLength || 50000;
        var waitTimeout = request.waitTimeout || 15000;
        var content = await window._WE.extractWithWait(maxLength, waitTimeout);
        sendResponse({
          success: true,
          content,
          title: document.title,
          url: window.location.href,
        });
      } catch (err) {
        sendResponse({
          success: false,
          error: err.message,
        });
      }
    })();
    return true;
  }

  if (request.type === "ping") {
    sendResponse({ pong: true, url: window.location.href });
    return true;
  }
});

// ============================================================
// 元素选择模式 (Element Selection Mode)
// ============================================================
var _selActive = false;
var _selHoverEl = null;
var _selCountEl = null;
var _selToolbar = null;

var SEL_ATTR = 'data-we-selected';
var SEL_STYLE_ID = 'we-extractor-selection-style';
var SEL_TOOLBAR_ID = 'we-extractor-toolbar';

function _selInjectStyles() {
  try {
    if (document.getElementById(SEL_STYLE_ID)) return;
    if (!document.head) { console.error('[WebExtractor] Cannot inject styles: document.head is null'); return; }
    var s = document.createElement('style');
    s.id = SEL_STYLE_ID;
    s.textContent = [
      'body.we-selecting, body.we-selecting * { cursor: crosshair !important; }',
      '.we-sel-hover { outline: 2px dashed #3b82f6 !important; outline-offset: -2px !important; background-color: rgba(59,130,246,0.08) !important; }',
      '[' + SEL_ATTR + '="true"] { outline: 3px solid #16a34a !important; outline-offset: -3px !important; background-color: rgba(22,163,74,0.1) !important; box-shadow: 0 0 0 6px rgba(22,163,74,0.08) !important; }',
      '[' + SEL_ATTR + '="true"].we-sel-hover { outline-color: #22c55e !important; }',
      '.we-sel-toolbar { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#1e293b; color:#f1f5f9; border-radius:12px; padding:10px 18px; display:flex; align-items:center; gap:10px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; font-size:14px; box-shadow:0 4px 24px rgba(0,0,0,0.35); pointer-events:auto; user-select:none; }',
      '.we-sel-toolbar .we-count { font-weight:700; color:#22c55e; min-width:20px; text-align:center; }',
      '.we-sel-toolbar button { background:#334155; color:#e2e8f0; border:none; border-radius:8px; padding:7px 14px; cursor:pointer; font-size:13px; font-weight:500; transition:background .15s; white-space:nowrap; }',
      '.we-sel-toolbar button:hover { background:#475569; }',
      '.we-sel-toolbar .we-btn-done { background:#16a34a; color:#fff; }',
      '.we-sel-toolbar .we-btn-done:hover { background:#15803d; }',
      '.we-sel-toolbar .we-btn-clear { background:#b91c1c; }',
      '.we-sel-toolbar .we-btn-clear:hover { background:#991b1b; }',
    ].join('\n');
    document.head.appendChild(s);
    _weLog('[WebExtractor] styles injected');
  } catch(e) { console.error('[WebExtractor] _selInjectStyles error:', e); }
}

function _selRemoveStyles() {
  var s = document.getElementById(SEL_STYLE_ID);
  if (s) s.remove();
  document.body.classList.remove('we-selecting');
}

function _selCreateToolbar() {
  try {
    if (document.getElementById(SEL_TOOLBAR_ID)) return;
    if (!document.body) { console.error('[WebExtractor] Cannot create toolbar: document.body is null'); return; }
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
    _weLog('[WebExtractor] toolbar appended to body, body has ', document.body.children.length, ' children');

    var btnDone = document.getElementById('we-btn-done');
    var btnCancel = document.getElementById('we-btn-cancel');
    var btnClear = document.getElementById('we-btn-clear');
    if (btnDone) btnDone.addEventListener('click', _selComplete);
    if (btnCancel) btnCancel.addEventListener('click', _selCancel);
    if (btnClear) btnClear.addEventListener('click', _selClearAll);
    _selCountEl = document.getElementById('we-sel-count');
    _selToolbar = tb;
    _weLog('[WebExtractor] toolbar buttons bound, _selToolbar=', !!_selToolbar, '_selCountEl=', !!_selCountEl);
  } catch(e) { console.error('[WebExtractor] _selCreateToolbar error:', e); }
}

function _selRemoveToolbar() {
  if (_selToolbar) { _selToolbar.remove(); _selToolbar = null; _selCountEl = null; }
}

function _selUpdateCount() {
  var n = document.querySelectorAll('[' + SEL_ATTR + '="true"]').length;
  if (_selCountEl) _selCountEl.textContent = n;
}

/** 判断元素是否适合选中（排除 script/style/svg 等和过小的元素） */
function _selIsSelectable(el) {
  if (!el || el.nodeType !== 1) return false;
  var tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return false;
  if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') return false;
  if (el.closest('#we-extractor-selection-style, #' + SEL_TOOLBAR_ID)) return false;
  return true;
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
  try {
    var el = e.target;
    if (el && el.nodeType === 1) el.classList.remove('we-sel-hover');
  } catch(ee) {}
}

function _selOnKeyDown(e) {
  if (!_selActive) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    _selCancel();
  }
}

function _selClearAll() {
  var els = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
  for (var i = 0; i < els.length; i++) els[i].removeAttribute(SEL_ATTR);
  _selUpdateCount();
}

function _selCancel() {
  _selClearAll();
  stopSelectionMode();
}

function _selComplete() {
  stopSelectionMode();
  try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {}
}

// ---- 完整清理（含事件解绑和 UI 移除） ----
function _selFullCleanup() {
  _selActive = false;
  document.removeEventListener('mousemove', _selOnMouseMove, true);
  document.removeEventListener('click', _selOnClick, true);
  document.removeEventListener('mouseout', _selOnMouseOut, true);
  document.removeEventListener('keydown', _selOnKeyDown, true);

  try {
    if (_selHoverEl) { _selHoverEl.classList.remove('we-sel-hover'); _selHoverEl = null; }
    var allHover = document.querySelectorAll('.we-sel-hover');
    for (var i = 0; i < allHover.length; i++) allHover[i].classList.remove('we-sel-hover');
  } catch(e) {}

  _selRemoveToolbar();
  _selRemoveStyles();
}

function startSelectionMode() {
  try {
    _weLog('[WebExtractor] startSelectionMode called, _selActive=', _selActive);
    if (_selActive) { _weLog('[WebExtractor] already active, skipping'); return; }

    if (!document.body) {
      console.error('[WebExtractor] document.body is null, cannot start selection mode');
      return;
    }
    if (!document.head) {
      console.error('[WebExtractor] document.head is null, cannot inject styles');
      return;
    }

    _selActive = true;
    _selRemoveToolbar(); _selRemoveStyles(); // 清理旧状态

    _weLog('[WebExtractor] injecting styles...');
    _selInjectStyles();
    document.body.classList.add('we-selecting');
    _weLog('[WebExtractor] creating toolbar...');
    _selCreateToolbar();
    _weLog('[WebExtractor] toolbar created:', !!_selToolbar);

    document.addEventListener('mousemove', _selOnMouseMove, true);
    document.addEventListener('click', _selOnClick, true);
    document.addEventListener('mouseout', _selOnMouseOut, true);
    document.addEventListener('keydown', _selOnKeyDown, true);

    // 页面离开时自动清理
    window.addEventListener('beforeunload', _selFullCleanup, { once: true });

    _selUpdateCount();
    _weLog('[WebExtractor] selection mode started successfully');
  } catch(e) {
    console.error('[WebExtractor] startSelectionMode error:', e);
    _selActive = false;
  }
}

function stopSelectionMode() {
  _selActive = false;
  document.removeEventListener('mousemove', _selOnMouseMove, true);
  document.removeEventListener('click', _selOnClick, true);
  document.removeEventListener('mouseout', _selOnMouseOut, true);
  document.removeEventListener('keydown', _selOnKeyDown, true);

  try {
    if (_selHoverEl) { _selHoverEl.classList.remove('we-sel-hover'); _selHoverEl = null; }
    var allHover = document.querySelectorAll('.we-sel-hover');
    for (var i = 0; i < allHover.length; i++) allHover[i].classList.remove('we-sel-hover');
  } catch(e) {}

  // 保留选中的 data 属性在 DOM 中，供后续提取使用
  _selRemoveToolbar();
  _selRemoveStyles();
}

function getSelectedElementsHTML() {
  var els = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
  var parts = [];
  for (var i = 0; i < els.length; i++) {
    parts.push(els[i].outerHTML);
  }
  return parts.join('\n');
}

function getSelectedElementsCount() {
  return document.querySelectorAll('[' + SEL_ATTR + '="true"]').length;
}

function clearSelectedMarkers() {
  var els = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
  for (var i = 0; i < els.length; i++) {
    els[i].removeAttribute(SEL_ATTR);
    els[i].style.outline = '';
    els[i].style.boxShadow = '';
    els[i].style.backgroundColor = '';
    els[i].style.borderRadius = '';
  }
}
