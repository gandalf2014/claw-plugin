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

    html +=
      '<div class="history-item" data-id="' + item.id + '" tabindex="0" role="listitem">' +
        '<div class="history-item-info">' +
          '<div class="history-item-name" title="' + escapeHTML(item.instruction) + '">' + name + '</div>' +
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

  item.useCount = (item.useCount || 0) + 1;
  item.lastUsed = new Date().toISOString();
  await saveHistory();
  renderHistory();

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

async function handleSaveRule(lastSavedInstruction, lastSavedSystemPrompt) {
  if (!lastSavedInstruction) return;

  var instruction = lastSavedInstruction;

  var existing = historyItems.find(function(it) {
    return it.instruction === instruction;
  });
  if (existing) {
    existing.useCount = (existing.useCount || 0) + 1;
    existing.lastUsed = new Date().toISOString();
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
