// ============================================================
// history.js — 提取历史记录管理
// ============================================================

const HISTORY_KEY = "extractionHistory";
var HISTORY_MAX = EXTRACTOR_CONSTANTS ? EXTRACTOR_CONSTANTS.MAX_HISTORY_ITEMS : 50;

var historyItems = [];
var historyOpen = false;

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
  if (!DOM.historyCount || !DOM.historyItems) return;
  DOM.historyCount.textContent = historyItems.length > 0 ? "(" + historyItems.length + ")" : "";
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

    // 提取模式标签
    var modeLabel = "";
    var ctx = item.extractionContext;
    if (ctx) {
      if (ctx.mode === "fullpage") {
        modeLabel = '<span class="h-mode-tag h-mode-fullpage">全页</span>';
      } else if (ctx.wasAutoDetected) {
        modeLabel = '<span class="h-mode-tag h-mode-auto">自动检测</span>';
      } else {
        var xpathCount = ctx.selectedXPaths ? ctx.selectedXPaths.length : ctx.elementCount;
        modeLabel = '<span class="h-mode-tag h-mode-manual">手动选择 (' + xpathCount + '个)</span>';
      }
    }

    html +=
      '<div class="history-item" data-id="' + item.id + '" tabindex="0" role="listitem">' +
        '<div class="history-item-info">' +
          '<div class="history-item-name" title="' + escapeHTML(item.instruction) + '">' + modeLabel + name + '</div>' +
          '<div class="history-item-meta">' +
            '<span title="' + escapeHTML(item.instruction) + '">' + inst + '</span>' +
            '<span>' + date + useInfo + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="history-item-actions">' +
          '<button class="h-btn-apply" data-action="apply" data-id="' + item.id + '" aria-label="应用规则: ' + escapeHTML(name) + '">应用</button>' +
          '<button class="h-btn-delete" data-action="delete" data-id="' + item.id + '" aria-label="删除规则: ' + escapeHTML(name) + '">' +
            '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<polyline points="3 6 5 6 21 6"></polyline>' +
              '<path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"></path>' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>';
  }
  DOM.historyItems.innerHTML = html;

  // 事件委托
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

  // 还原自定义翻页按钮 XPath
  if (item.extractionContext && item.extractionContext.customNextPageXPath) {
    customNextPageXPath = item.extractionContext.customNextPageXPath;
    try {
      await chrome.storage.local.set({ customNextPageXPath: customNextPageXPath });
    } catch(e) {}
  } else {
    customNextPageXPath = null;
  }

  item.useCount = (item.useCount || 0) + 1;
  item.lastUsed = new Date().toISOString();
  await saveHistory();
  renderHistory();

  flashElement(DOM.txtInstruction);

  // ---- 复现提取过程 ----
  var ctx = item.extractionContext;
  if (!ctx) {
    // 旧数据没有 extractionContext，仅填指令
    setStatus("已应用规则，请选择元素后提取", "info");
    setTimeout(hideStatus, 3000);
    return;
  }

  if (ctx.mode === "fullpage") {
    // 全页提取模式：直接用指令提取整个页面
    setStatus("正在复现全页提取...", "info");
    handleExtract();
    return;
  }

  // ---- 辅助函数：通过 XPath 选中元素 ----
  async function trySelectByXPath(xpaths) {
    if (!xpaths || xpaths.length === 0) return 0;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) return 0;
      const selectResults = await chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: selectElementsByXPaths,
        args: [xpaths],
      });
      var foundCount = (selectResults && selectResults[0] && typeof selectResults[0].result === "number")
        ? selectResults[0].result : 0;
      if (foundCount > 0) {
        selectedCount = foundCount;
        updateSelectButton();
      }
      return foundCount;
    } catch(e) {
      console.warn("XPath 选择失败:", e);
      return 0;
    }
  }

  if (ctx.mode === "selected" && ctx.wasAutoDetected) {
    // 自动检测模式：优先通过 XPath 快速还原，失败时重新分析页面结构
    try {
      // 先尝试 XPath
      if (ctx.selectedXPaths && ctx.selectedXPaths.length > 0) {
        setStatus("正在通过保存的 XPath 还原选区...", "info");
        var foundCount = await trySelectByXPath(ctx.selectedXPaths);
        if (foundCount > 0) {
          setStatus("已选中 " + foundCount + " 个元素，正在使用保存的规则提取...", "info");
          handleExtract();
          return;
        }
      }
      // XPath 失败，回退到重新分析页面
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) {
        setStatus("无法获取当前页面，请手动提取", "error");
        return;
      }

      setStatus("正在复现：分析页面结构并选中内容区域...", "info");
      autoDetectionDone = false;
      await autoDetectAndSelectContent(tabs[0].id);

      setStatus("页面区域已选中，正在使用保存的规则提取...", "info");
      handleExtract();
    } catch (e) {
      console.warn("复现自动检测失败:", e);
      setStatus("页面分析失败，请手动选择元素后提取", "warning");
      setTimeout(hideStatus, 3000);
    }
    return;
  }

  if (ctx.mode === "selected" && !ctx.wasAutoDetected) {
    // 手动选择模式：优先通过 XPath 自动选中，失败时提示用户重新选择
    if (ctx.selectedXPaths && ctx.selectedXPaths.length > 0) {
      setStatus("正在通过保存的 XPath 还原选区...", "info");
      var foundCount = await trySelectByXPath(ctx.selectedXPaths);
      if (foundCount > 0) {
        setStatus("已选中 " + foundCount + " 个元素，正在使用保存的规则提取...", "info");
        handleExtract();
        return;
      }
      // XPath 未匹配到元素（页面结构可能已变化）
      setStatus("页面结构已变化，" + ctx.selectedXPaths.length + " 个 XPath 均未匹配，请重新选择", "warning");
      setTimeout(hideStatus, 4000);
      return;
    }
    // 无 XPath，提示用户重新选择
    setStatus('请重新选择目标元素后点击「提取选中」', "info");
    setTimeout(hideStatus, 3000);
    return;
  }
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

async function handleSaveRule(lastSavedInstruction, lastSavedSystemPrompt) {
  if (!lastSavedInstruction) return;

  var instruction = lastSavedInstruction;

  // ---- 获取当前选中元素的 XPath ----
  var selectedXPaths = [];
  if (selectedCount > 0) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs.length > 0) {
        const xpathResults = await chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          func: getSelectedElementXPaths,
        });
        if (xpathResults && xpathResults[0] && xpathResults[0].result) {
          selectedXPaths = xpathResults[0].result;
        }
      }
    } catch(e) {
      console.warn("获取 XPath 失败:", e);
    }
  }

  // 判断是否已有相同指令的规则
  var existing = historyItems.find(function(it) {
    return it.instruction === instruction;
  });
  if (existing) {
    existing.useCount = (existing.useCount || 0) + 1;
    existing.lastUsed = new Date().toISOString();
    // 更新提取上下文（可能上一次是全页，这次选中了元素）
    existing.extractionContext = {
      mode: selectedCount > 0 ? "selected" : "fullpage",
      elementCount: selectedCount,
      wasAutoDetected: autoDetectionDone && selectedCount > 0,
      selectedXPaths: selectedXPaths,
      customNextPageXPath: (typeof customNextPageXPath !== 'undefined') ? customNextPageXPath : null
    };
    await saveHistory();
    renderHistory();
    showSaveRuleFeedback("规则已更新");
    return;
  }

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
    extractionContext: {
      mode: selectedCount > 0 ? "selected" : "fullpage",
      elementCount: selectedCount,
      wasAutoDetected: autoDetectionDone && selectedCount > 0,
      selectedXPaths: selectedXPaths,
      customNextPageXPath: (typeof customNextPageXPath !== 'undefined') ? customNextPageXPath : null
    }
  });

  if (historyItems.length > HISTORY_MAX) {
    historyItems = historyItems.slice(-HISTORY_MAX);
  }

  await saveHistory();
  renderHistory();
  showSaveRuleFeedback("规则已保存");
}

function showSaveRuleFeedback(msg) {
  if (!DOM.btnSaveRule) return;
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

function updateSaveRuleButton(lastSavedInstruction) {
  if (lastSavedInstruction) {
    DOM.btnSaveRule.classList.remove("hidden");
  }
}

// ============================================================
// 注入函数：getSelectedElementXPaths — 获取当前选中元素的 XPath 列表
// 自包含，通过 chrome.scripting.executeScript 注入到页面
// ============================================================

function getSelectedElementXPaths() {
  // 复用 shared-extractor 的 getXPath（统一 XPath 计算逻辑）
  function _getXPath(el) {
    return (window._WE && window._WE.getXPath) ? window._WE.getXPath(el) : null;
  }

  var els = document.querySelectorAll('[data-we-selected="true"]');
  var xpaths = [];
  for (var i = 0; i < els.length; i++) {
    var xp = _getXPath(els[i]);
    if (xp) xpaths.push(xp);
  }
  return xpaths;
}

// ============================================================
// 注入函数：selectElementsByXPaths — 根据 XPath 列表选中页面元素
// 自包含，通过 chrome.scripting.executeScript 注入到页面
// ============================================================

function selectElementsByXPaths(xpaths) {
  // 清除现有选中
  var oldSelected = document.querySelectorAll('[data-we-selected="true"]');
  for (var i = 0; i < oldSelected.length; i++) {
    oldSelected[i].removeAttribute('data-we-selected');
    oldSelected[i].style.outline = '';
    oldSelected[i].style.boxShadow = '';
    oldSelected[i].style.backgroundColor = '';
    oldSelected[i].style.borderRadius = '';
  }

  // 复用共享函数注入选中样式
  if (!document.getElementById('we-auto-select-style')) {
    (window._WE && window._WE.injectSelectionStyles) ? window._WE.injectSelectionStyles(null, false) : null;
  }

  var count = 0;
  for (var i = 0; i < xpaths.length; i++) {
    try {
      var result = document.evaluate(
        xpaths[i], document, null,
        XPathResult.FIRST_ORDERED_NODE_TYPE, null
      );
      var el = result.singleNodeValue;
      if (el && el.nodeType === 1) {
        var pos = getComputedStyle(el).position;
        if (pos === 'static') el.style.position = 'relative';
        el.setAttribute('data-we-selected', 'true');
        count++;
      }
    } catch(e) {}
  }
  return count;
}
