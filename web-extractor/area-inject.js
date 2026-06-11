// ================================================================
// area-inject.js — 页面区域检测与元素选择注入函数
//
// 本文件的函数通过 chrome.scripting.executeScript({ func: ... }) 注入到目标页面执行。
// 所有函数均为自包含，不依赖 popup 上下文。
// ================================================================

// ================================================================
// 注入函数：清理选择模式残留（兜底，content.js stopSelectionMode 保留标记供提取用）
// ================================================================

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
    (window._WE && window._WE.injectSelectionStyles) ? window._WE.injectSelectionStyles('AI  主要区域', true) : null;
  }
  }

  var pos = getComputedStyle(section).position;
  if (pos === "static") section.style.position = "relative";

  section.setAttribute("data-we-selected", "true");
  if (section.scrollIntoView) section.scrollIntoView({ behavior: "smooth", block: "center" });
  return 1;
}

// ================================================================
// 注入函数：narrowSelectionScope — 缩小选中元素范围
// 将当前选中的大区域拆解为其直接可见子元素，只保留文本密度最高的子集
// ================================================================

function narrowSelectionScope() {
  var SEL_ATTR = 'data-we-selected';

  // 收集当前选中的元素
  var selected = document.querySelectorAll('[' + SEL_ATTR + '="true"]');
  if (selected.length === 0) return 0;

  // 清除旧选中样式
  for (var ci = 0; ci < selected.length; ci++) {
    selected[ci].removeAttribute(SEL_ATTR);
    selected[ci].style.outline = '';
    selected[ci].style.boxShadow = '';
    selected[ci].style.backgroundColor = '';
    selected[ci].style.borderRadius = '';
  }

  // 对每个选中元素，提取其直接可见子元素作为候选
  var candidates = [];
  for (var si = 0; si < selected.length; si++) {
    var parent = selected[si];
    var children = parent.children;
    for (var chi = 0; chi < children.length; chi++) {
      var child = children[chi];
      var tag = child.tagName.toLowerCase();
      // 跳过不可见和无关元素
      if ({script:1,style:1,svg:1,noscript:1,iframe:1,canvas:1,video:1,audio:1,template:1,link:1,meta:1}[tag]) continue;
      var cs = getComputedStyle(child);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
      var text = (child.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 10) continue;
      var rect = child.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      candidates.push({
        el: child,
        textLen: text.length,
        area: rect.width * rect.height,
        density: text.length / Math.max(1, rect.width * rect.height)
      });
    }
  }

  if (candidates.length === 0) return 0;

  // 按文本长度降序排列，保留文本密度最高的前 N 个
  candidates.sort(function(a, b) { return b.textLen - a.textLen; });

  // 保留文本内容最丰富的前 60%（至少保留 1 个，最多保留 15 个）
  var keepCount = Math.max(1, Math.min(15, Math.ceil(candidates.length * 0.6)));

  // 注入选中样式（复用共享函数）
  if (!document.getElementById('we-auto-select-style')) {
    (window._WE && window._WE.injectSelectionStyles) ? window._WE.injectSelectionStyles('AI 缩小范围', false) : null;
  }

  var newCount = 0;
  for (var ni = 0; ni < keepCount; ni++) {
    var c = candidates[ni].el;
    var pos = getComputedStyle(c).position;
    if (pos === 'static') c.style.position = 'relative';
    c.setAttribute(SEL_ATTR, 'true');
    newCount++;
  }

  return newCount;
}

// ================================================================
// 注入函数：getSelectedElementTexts — 获取选中元素的文本内容
// 用于缩小重试时根据新元素优化提取指令
// ================================================================

function getSelectedElementTexts() {
  var els = document.querySelectorAll('[data-we-selected="true"]');
  var texts = [];
  for (var i = 0; i < els.length && i < 30; i++) {
    var t = (els[i].textContent || '').replace(/\s+/g, ' ').trim();
    if (t.length > 0) texts.push(t.length > 300 ? t.substring(0, 297) + '...' : t);
  }
  return texts;
}
