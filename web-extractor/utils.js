// ============================================================
// utils.js — 通用工具函数（popup 作用域）
// ============================================================

/** HTML 转义 */
function escapeHTML(str) {
  if (!str) return "";
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 字符串截断 */
function truncate(str, max) {
  if (!str) return "";
  str = str.replace(/\n/g, " ");
  return str.length > max ? str.substring(0, max) + "..." : str;
}

/** 友好日期格式化 */
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

/** 元素闪烁高亮 */
function flashElement(el) {
  el.style.transition = "background 0.15s";
  el.style.background = "#eef2ff";
  setTimeout(function() { el.style.background = ""; }, 400);
}

/** 格式化面积数值 */
function formatArea(area) {
  if (!area || area <= 0) return "";
  if (area >= 1000000) return (area / 1000000).toFixed(1) + "M px²";
  if (area >= 1000) return (area / 1000).toFixed(0) + "K px²";
  return area + " px²";
}

/** 清理 prompt 文本中的特殊字符 */
function escPromptText(s) {
  if (!s) return "";
  return s.replace(/\n/g, " ").replace(/"/g, "'").trim();
}
