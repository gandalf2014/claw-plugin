// ================================================================
// pagination-inject.js — 翻页检测与页面跳转注入函数
//
// 本文件的函数通过 chrome.scripting.executeScript({ func: ... }) 注入到目标页面执行。
// 所有函数均为自包含，不依赖 popup 上下文。
// ================================================================

// ================================================================
// 注入函数：startNextPagePicker — 让用户手动点击翻页按钮并记录 XPath
// ================================================================

function startNextPagePicker() {
  var PICKER_ID = 'we-next-page-picker-style';

  // 清理旧实例
  var oldStyle = document.getElementById(PICKER_ID);
  if (oldStyle) oldStyle.remove();
  var oldToast = document.getElementById('we-picker-toast');
  if (oldToast) oldToast.remove();

  // 注入样式
  var style = document.createElement('style');
  style.id = PICKER_ID;
  style.textContent = [
    'body.we-picking-next, body.we-picking-next * { cursor: crosshair !important; }',
    '.we-picker-hover { outline: 2px dashed #3b82f6 !important; outline-offset: 2px !important; background-color: rgba(59,130,246,0.08) !important; }',
    '#we-picker-toast { position: fixed !important; bottom: 24px !important; left: 50% !important; transform: translateX(-50%) !important; z-index: 2147483647 !important; background: #1e40af !important; color: #fff !important; padding: 10px 20px !important; border-radius: 10px !important; font-size: 14px !important; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif !important; box-shadow: 0 4px 20px rgba(0,0,0,0.3) !important; pointer-events: none !important; }',
  ].join('\n');
  document.head.appendChild(style);

  // 提示 toast
  var toast = document.createElement('div');
  toast.id = 'we-picker-toast';
  toast.textContent = '请点击页面上的「下一页」按钮';
  document.body.appendChild(toast);

  var hoverEl = null;

  function _isSelectable(el) {
    if (!el || el.nodeType !== 1) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return false;
    if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'path') return false;
    if (el.id === PICKER_ID || el.id === 'we-picker-toast') return false;
    return true;
  }

  // 复用 shared-extractor 的 getXPath（统一 XPath 计算逻辑）
  function _computeXPath(el) { return (window._WE && window._WE.getXPath) ? window._WE.getXPath(el) : null; }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    if (hoverEl) { try { hoverEl.classList.remove('we-picker-hover'); } catch(e) {} hoverEl = null; }
    var hs = document.querySelectorAll('.we-picker-hover');
    for (var i = 0; i < hs.length; i++) hs[i].classList.remove('we-picker-hover');
    document.body.classList.remove('we-picking-next');
    var st = document.getElementById(PICKER_ID);
    if (st) st.remove();
    var tb = document.getElementById('we-picker-toast');
    if (tb) tb.remove();
  }

  function onMouseMove(e) {
    var target = e.target;
    if (!_isSelectable(target)) return;
    if (hoverEl !== target) {
      if (hoverEl) { try { hoverEl.classList.remove('we-picker-hover'); } catch(e) {} }
      hoverEl = target;
      try { target.classList.add('we-picker-hover'); } catch(e) {}
    }
  }

  function onClick(e) {
    var target = e.target;
    if (!_isSelectable(target)) return;
    e.preventDefault(); e.stopPropagation();
    var xpath = _computeXPath(target);
    cleanup();
    // 存储 XPath 并通知 background 打开 popup
    chrome.storage.local.set({ customNextPageXPath: xpath, pendingNextPageXPath: xpath }, function() {
      chrome.runtime.sendMessage({ type: 'nextPageSelected', xpath: xpath });
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cleanup();
      // 取消时不传 xpath
      chrome.storage.local.set({ pendingNextPageXPath: '' }, function() {
        chrome.runtime.sendMessage({ type: 'nextPageSelected', xpath: '' });
      });
    }
  }

  document.body.classList.add('we-picking-next');
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
}

// ================================================================
// 注入函数：detectPaginationOnPage — 检测页面翻页组件
// ================================================================

function detectPaginationOnPage() {
  var NEXT_SELECTORS = [
    'a[rel="next"]',
    'link[rel="next"]',
    '[aria-label*="next" i]:not([aria-label*="previous" i])',
    '[aria-label*="Next" i]:not([aria-label*="Previous" i])',
    '[aria-label*="下一页"]',
    '[aria-label*="下一頁"]',
    '[class*="pagination"] [class*="next"]:not(.disabled)',
    '[class*="pagination"] a[class*="next"]:not([class*="disabled"])',
    '[class*="pager"] [class*="next"]:not(.disabled)',
    '.ant-pagination-next:not(.ant-pagination-disabled)',
    '.el-pagination button.btn-next:not([disabled])',
    '.el-pagination .btn-next:not([disabled])',
    '.t-pagination__btn-next:not(.t-is-disabled)',
    '.arco-pagination-item-next:not(.arco-pagination-item-disabled)',
    'nav[aria-label*="pagination" i] a[href]:last-of-type',
    'nav[aria-label*="分页" i] a[href]:last-of-type',
    '[data-testid*="next-page"]',
    '[data-testid*="pagination-next"]',
    'ul.pagination li.next a:not(.disabled)',
  ];

  // 尝试 CSS 选择器
  for (var i = 0; i < NEXT_SELECTORS.length; i++) {
    try {
      var els = document.querySelectorAll(NEXT_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!el.offsetParent && el.tagName.toLowerCase() !== 'link') continue;
        if (el.hasAttribute('disabled')) continue;
        if (el.getAttribute('aria-disabled') === 'true') continue;
        var text = (el.textContent || el.getAttribute('aria-label') || '').trim().substring(0, 40);
        return { found: true, selector: NEXT_SELECTORS[i], tag: el.tagName.toLowerCase(), text: text };
      }
    } catch(e) {}
  }

  // 文本匹配回退
  var NEXT_TEXTS = ['next', '下一页', '下一頁', '>', '›', '»', 'next page', '下页'];
  var candidates = document.querySelectorAll('a, button, span[role="button"], div[role="button"]');
  for (var k = 0; k < candidates.length; k++) {
    var c = candidates[k];
    if (!c.offsetParent) continue;
    if (c.hasAttribute('disabled')) continue;
    if (c.getAttribute('aria-disabled') === 'true') continue;
    var ct = (c.textContent || '').trim().toLowerCase();
    for (var ti = 0; ti < NEXT_TEXTS.length; ti++) {
      if (ct === NEXT_TEXTS[ti]) {
        return { found: true, selector: 'text-match', tag: c.tagName.toLowerCase(), text: (c.textContent || '').trim().substring(0, 40) };
      }
    }
  }

  // ---- 回退：检测仅有页码数字（无"下一页"按钮）的分页 ----
  var pageItemSelectors = [
    '.ant-pagination-item',
    '.el-pager li.number',
    '.el-pager li:not(.active)',
    'li.page-item:not(.active)',
    'li[class*="page-item"]',
    '[class*="pagination"] li:not([class*="next"]):not([class*="prev"]):not([class*="disabled"])',
    'nav[aria-label*="pagination" i] a[href]',
    'nav[aria-label*="分页" i] a[href]',
    '[class*="pager"] li',
  ];

  for (var si = 0; si < pageItemSelectors.length; si++) {
    try {
      var pageItems = document.querySelectorAll(pageItemSelectors[si]);
      for (var pj = 0; pj < pageItems.length; pj++) {
        var pi = pageItems[pj];
        if (!pi.offsetParent) continue;
        var pit = (pi.textContent || '').trim();
        if (/^\d+$/.test(pit)) {
          return { found: true, selector: 'page-number', tag: pi.tagName.toLowerCase(), text: '页码 ' + pit };
        }
      }
    } catch(e) {}
  }

  return { found: false };
}

// ================================================================
// 注入函数：clickNextPageOnPage — 点击翻页按钮
// 策略：优先点「下一页」按钮，不存在则点具体页码
// 参数 targetPage: 目标页码（当无下一页按钮时使用）
// ================================================================

function clickNextPageOnPage(targetPage, customXPath) {
  // ---- 第零优先：用户指定的自定义 XPath ----
  if (customXPath && customXPath.length > 0) {
    try {
      var result = document.evaluate(customXPath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      var customEl = result.singleNodeValue;
      if (customEl && customEl.nodeType === 1 && customEl.offsetParent) {
        customEl.scrollIntoView({ behavior: 'instant', block: 'center' });
        customEl.click();
        return { clicked: true, method: 'custom-xpath', xpath: customXPath, text: (customEl.textContent || '').trim().substring(0, 40) };
      }
    } catch(e) {}
  }

  // ---- 第一优先：点击「下一页」按钮 ----
  var NEXT_SELECTORS = [
    'a[rel="next"]',
    '[class*="pagination"] [class*="next"]:not(.disabled)',
    '[class*="pagination"] a[class*="next"]:not([class*="disabled"])',
    '.ant-pagination-next:not(.ant-pagination-disabled)',
    '.el-pagination button.btn-next:not([disabled])',
    '.el-pagination .btn-next:not([disabled])',
    '.t-pagination__btn-next:not(.t-is-disabled)',
    '.arco-pagination-item-next:not(.arco-pagination-item-disabled)',
    '[aria-label*="next" i]:not([aria-label*="previous" i])',
    '[aria-label*="下一页"]',
    '[aria-label*="下一頁"]',
    'nav[aria-label*="pagination" i] a[href]:last-of-type',
    'nav[aria-label*="分页" i] a[href]:last-of-type',
    '[data-testid*="next-page"]',
    'ul.pagination li.next a:not(.disabled)',
  ];

  for (var i = 0; i < NEXT_SELECTORS.length; i++) {
    try {
      var els = document.querySelectorAll(NEXT_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!el.offsetParent && el.tagName.toLowerCase() !== 'link') continue;
        if (el.hasAttribute('disabled')) continue;
        if (el.getAttribute('aria-disabled') === 'true') continue;
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.click();
        return { clicked: true, method: 'next-button', selector: NEXT_SELECTORS[i], text: (el.textContent || '').trim().substring(0, 40) };
      }
    } catch(e) {}
  }

  // 文本匹配回退
  var NEXT_TEXTS = ['next', '下一页', '下一頁', '>', '›', '»'];
  var candidates = document.querySelectorAll('a, button');
  for (var k = 0; k < candidates.length; k++) {
    var c = candidates[k];
    if (!c.offsetParent) continue;
    if (c.hasAttribute('disabled')) continue;
    var ct = (c.textContent || '').trim().toLowerCase();
    for (var ti = 0; ti < NEXT_TEXTS.length; ti++) {
      if (ct === NEXT_TEXTS[ti]) {
        c.click();
        return { clicked: true, method: 'next-text', text: c.textContent.trim().substring(0, 40) };
      }
    }
  }

  // ---- 第二优先：点击具体页码 ----
  if (targetPage !== undefined && targetPage !== null) {
    var pageNum = String(targetPage);
    var pageSelectors = [
      '.ant-pagination-item-' + pageNum + ' a',
      '.ant-pagination-item[title="' + pageNum + '"] a',
      'li[class*="page"]:not([class*="next"]):not([class*="prev"]) a',
      'li[class*="number"] a',
      '.pagination li a',
      '.pagination a[href]',
      '[class*="pagination"] a:not([class*="next"]):not([class*="prev"]):not([class*="disabled"])',
      'nav[aria-label*="pagination" i] a',
      'nav[aria-label*="分页" i] a',
      '[class*="pager"] li:not([class*="next"]):not([class*="prev"]) a',
      '[class*="pager"] a:not([class*="next"]):not([class*="prev"])',
    ];

    for (var si = 0; si < pageSelectors.length; si++) {
      try {
        var pageEls = document.querySelectorAll(pageSelectors[si]);
        for (var pj = 0; pj < pageEls.length; pj++) {
          var pe = pageEls[pj];
          if (!pe.offsetParent) continue;
          var pt = (pe.textContent || '').trim();
          if (pt === pageNum || pt === '第' + pageNum + '页') {
            pe.scrollIntoView({ behavior: 'instant', block: 'center' });
            pe.click();
            return { clicked: true, method: 'page-number', text: pt, page: targetPage };
          }
        }
      } catch(e) {}
    }

    // 通用回退：在所有可见 a/button 中找文本精确等于目标页码的元素
    var allEls = document.querySelectorAll('a, button, li[class*="page"]');
    for (var ai = 0; ai < allEls.length; ai++) {
      var ae = allEls[ai];
      if (!ae.offsetParent) continue;
      if (ae.hasAttribute('disabled')) continue;
      if (ae.closest('[class*="next"]') || ae.closest('[class*="prev"]')) continue;
      var at = (ae.textContent || '').trim();
      if (at === pageNum) {
        var inPagination = ae.closest('[class*="pagination"], [class*="pager"], nav[aria-label*="pagination" i], nav[aria-label*="分页" i]');
        if (inPagination || /^\d+$/.test(at)) {
          ae.scrollIntoView({ behavior: 'instant', block: 'center' });
          ae.click();
          return { clicked: true, method: 'page-number-fallback', text: at, page: targetPage };
        }
      }
    }
  }

  return { clicked: false };
}
