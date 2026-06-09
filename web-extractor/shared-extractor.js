// ============================================================
// shared-extractor.js — 共享页面提取逻辑
//
// 用途：
//   - 作为 content script 被 manifest.json 加载（供 content.js 使用）
//   - 作为 executeScript `files` 注入（供 popup.js 的提取流程使用）
//
// 编码规范：
//   - 使用 var（兼容 executeScript 注入的旧浏览器引擎）
//   - 空 catch(e) {} 是有意的：DOM 提取运行在不可控的外部页面，异常属正常
//   - 所有共享函数挂载到 window._WE 命名空间
// ============================================================

window._WE = window._WE || {};

// ---- 调试 ----
window._WE.DEBUG = false;

(function() {
  var WE = window._WE;

  // ================================================================
  // 工具函数
  // ================================================================

  /** 缩进辅助 */
  WE.sp = function(n) {
    var s = "";
    for (var j = 0; j < n; j++) s += "  ";
    return s;
  };

  /** 字符串转义 */
  WE.esc = function(s, limit) {
    if (!s) return "";
    limit = limit || 200;
    s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "");
    if (s.length > limit) s = s.substring(0, limit - 3) + "...";
    return s;
  };

  // ================================================================
  // 元素可见性检测
  // ================================================================

  WE.isElementVisible = function(el) {
    if (!el) return false;
    try {
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
      return true;
    } catch(e) { return false; }
  };

  WE.isVisible = function(el) {
    if (!el || el.nodeType !== 1) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    if (el !== document.body && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("hidden")) return false;
    return true;
  };

  // ================================================================
  // SSR 数据检测
  // ================================================================

  WE.detectSSRData = function() {
    try {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
        var pp = window.__NEXT_DATA__.props.pageProps || {};
        var dk = Object.keys(pp).filter(function(k) {
          return k !== "pathname" && k !== "asPath" && k !== "query";
        });
        if (dk.length > 0) return { found: true, type: "nextjs", keys: dk };
      }
      if (window.__NUXT__) return { found: true, type: "nuxt" };
      var jld = document.querySelectorAll('script[type="application/ld+json"]');
      if (jld.length > 0) {
        var cnt = 0;
        for (var i = 0; i < jld.length; i++) {
          try { JSON.parse(jld[i].textContent); cnt++; } catch(e) {}
        }
        if (cnt > 0) return { found: true, type: "jsonld", count: cnt };
      }
      if (window.__NFES_DATA__) return { found: true, type: "nfes_data" };
    } catch(e) {}
    return { found: false };
  };

  // ================================================================
  // 动态页面判断
  // ================================================================

  WE.isDynamicPage = function() {
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
  };

  // ================================================================
  // 快速内容检查
  // ================================================================

  WE.scanDataElements = function() {
    var result = { textBlocks: 0, dataCount: 0 };
    try {
      var allDivs = document.querySelectorAll("div, section");
      for (var i = 0; i < allDivs.length; i++) {
        if (!WE.isElementVisible(allDivs[i])) continue;
        var txt = (allDivs[i].textContent || "").trim();
        if (txt.length > 80) result.textBlocks++;
        if (txt.length > 30 && /[¥￥$]\s*\d/.test(txt)) result.dataCount++;
        if (result.textBlocks > 10) break;
      }
    } catch(e) {}
    return result;
  };

  /** 列表/卡片选择器（宽泛匹配 CSS Modules 散列类名） */
  function getListSelectors() {
    return [
      ".room-list", ".room-item", ".room-type", "[data-room-id]",
      ".product-list", ".product-item", ".item-list",
      ".search-result", ".result-item",
      ".comment-list", ".review-list", ".review-item",
      "table tbody tr", ".data-table tr",
      ".price-item", ".rate-item", "[data-price]",
      ".hotel-info", ".hotel-detail",
      '[class*="roomItem"]', '[class*="RoomItem"]', '[class*="room-item"]',
      '[class*="priceRow"]', '[class*="PriceRow"]', '[class*="price-row"]',
      '[class*="hotelDetail"]', '[class*="HotelDetail"]',
      '[class*="productCard"]', '[class*="ProductCard"]', '[class*="product-card"]',
      '[class*="tableList"]', '[class*="TableList"]',
      '[class*="listItem"]', '[class*="ListItem"]',
      '[class*="cardBox"]', '[class*="CardBox"]',
    ];
  }

  function getKeyDataSelectors() {
    return [
      ".score", ".rating", ".star", "[data-score]",
      ".price", ".amount", ".cost", "[data-price]",
      ".address", ".location",
      ".facility", ".amenity",
      ".review-score", ".review-count",
    ];
  }

  function getMainContentSelectors() {
    return [
      "main", '[role="main"]', "article",
      ".main-content", "#main-content", ".content", "#content",
      ".post-content", ".article-content",
      ".search-result-list", ".list-container", ".hotel-list", ".product-list"
    ];
  }

  WE.quickContentCheck = function() {
    var sources = [];
    var score = 0;

    var ssr = WE.detectSSRData();
    if (ssr.found) { sources.push("ssr_embedded_data(" + ssr.type + ")"); score += 2; }

    var scan = WE.scanDataElements();
    if (scan.dataCount > 0) { sources.push("price_text_found:" + scan.dataCount); score += 2; }
    if (scan.textBlocks > 5) { sources.push("dense_content:" + scan.textBlocks); score += 1; }

    var listSels = getListSelectors();
    for (var si = 0; si < listSels.length && score < 5; si++) {
      try {
        var els = document.querySelectorAll(listSels[si]);
        for (var ej = 0; ej < els.length; ej++) {
          if (WE.isElementVisible(els[ej])) {
            sources.push("selector:" + listSels[si]);
            score += 3;
            break;
          }
        }
      } catch(e) {}
    }

    var keySels = getKeyDataSelectors();
    for (var ki = 0; ki < keySels.length; ki++) {
      try {
        var el = document.querySelector(keySels[ki]);
        if (el && WE.isElementVisible(el) && (el.textContent || "").trim().length > 0) {
          sources.push("keydata:" + keySels[ki]);
          score += 1;
        }
      } catch(e) {}
    }

    try {
      if ((document.body ? document.body.innerText || "" : "").trim().length > 500) score += 1;
    } catch(e) {}

    return { ready: score >= 5, score: score, sources: sources };
  };

  // ================================================================
  // 网络监听器恢复
  // ================================================================

  WE.restoreNetworkMonitors = function(origFetch, origXHROpen, origXHRSend) {
    try {
      if (origFetch) window.fetch = origFetch;
      if (origXHROpen) XMLHttpRequest.prototype.open = origXHROpen;
      if (origXHRSend) XMLHttpRequest.prototype.send = origXHRSend;
    } catch(e) {}
  };

  // ================================================================
  // Promise-based sleep
  // ================================================================

  WE.sleep = function(ms) {
    return new Promise(function(r) { setTimeout(r, ms); });
  };

  // ================================================================
  // YAML 化 JS 对象
  // ================================================================

  WE.yamlifyObject = function(obj, depth, maxDepth, maxStrLen) {
    maxStrLen = maxStrLen || 300;
    if (depth > maxDepth) return WE.sp(depth) + "...";
    var indent = WE.sp(depth);
    if (obj === null || obj === undefined) return indent + "null";
    if (typeof obj === "string") return indent + '"' + WE.esc(obj, maxStrLen) + '"';
    if (typeof obj === "number" || typeof obj === "boolean") return indent + String(obj);

    if (Array.isArray(obj)) {
      if (obj.length === 0) return indent + "[]";
      var allSimple = true;
      for (var ai = 0; ai < obj.length; ai++) {
        if (typeof obj[ai] === "object" && obj[ai] !== null) { allSimple = false; break; }
      }
      if (allSimple) {
        var vals = [];
        for (var ai = 0; ai < Math.min(obj.length, 20); ai++) {
          vals.push(typeof obj[ai] === "string" ? '"' + WE.esc(obj[ai], 50) + '"' : String(obj[ai]));
        }
        return indent + "[ " + vals.join(", ") + (obj.length > 20 ? " ... (" + (obj.length - 20) + " more)" : "") + " ]";
      }
      var lns = [indent + "-"];
      var lim = Math.min(obj.length, 50);
      for (var ai = 0; ai < lim; ai++) { lns.push(WE.yamlifyObject(obj[ai], depth + 1, maxDepth, maxStrLen)); }
      if (obj.length > lim) lns.push(WE.sp(depth + 1) + "... (" + (obj.length - lim) + " more items)");
      return lns.join("\n");
    }

    if (typeof obj === "object") {
      var keys = Object.keys(obj);
      if (keys.length === 0) return indent + "{}";
      var lns = [];
      var lim = Math.min(keys.length, 30);
      for (var i = 0; i < lim; i++) {
        var k = keys[i], v = obj[k];
        if (typeof v === "object" && v !== null) {
          lns.push(indent + k + ":");
          lns.push(WE.yamlifyObject(v, depth + 1, maxDepth, maxStrLen));
        } else if (typeof v === "string") {
          lns.push(indent + k + ': "' + WE.esc(v, maxStrLen) + '"');
        } else {
          lns.push(indent + k + ": " + String(v));
        }
      }
      if (keys.length > lim) lns.push(indent + "... (" + (keys.length - lim) + " more keys)");
      return lns.join("\n");
    }
    return indent + String(obj);
  };

  // ================================================================
  // 可访问性树角色映射
  // ================================================================

  WE.roleOf = function(el) {
    var tag = el.tagName.toLowerCase();
    var explicit = el.getAttribute("role");
    if (explicit) return explicit;
    var LANDMARK = { header: "banner", main: "main", nav: "navigation", footer: "contentinfo", aside: "complementary", form: "form" };
    if (LANDMARK.hasOwnProperty(tag)) return LANDMARK[tag];
    var h = tag.match(/^h([1-6])$/);
    if (h) return "heading [h" + h[1] + "]";
    switch (tag) {
      case "a": return "link";
      case "ul": case "ol": return "list";
      case "li": return "listitem";
      case "button": return "button";
      case "table": return "table";
      case "tr": return "row";
      case "td": return "cell";
      case "th": return "cell [th]";
      case "img": return "image";
      case "input": return "textbox";
      case "textarea": return "textbox";
      case "select": return "combobox";
      case "p": return "paragraph";
      case "label": return "label";
      default: return "";
    }
  };

  WE.directText = function(el) {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent;
    }
    return t.replace(/\s+/g, " ").trim();
  };

  WE.linkHref = function(el) {
    var h = (el.getAttribute("href") || "").trim();
    if (!h || h.toLowerCase().startsWith("javascript:")) return "";
    if (h.length > 500) h = h.substring(0, 497) + "...";
    return h;
  };

  // ================================================================
  // SSR 数据提取
  // ================================================================

  WE.extractSSRDataSection = function() {
    var lines = [];

    try {
      if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
        lines.push("=== SSR Data: Next.js (__NEXT_DATA__.props.pageProps) ===");
        lines.push(WE.yamlifyObject(window.__NEXT_DATA__.props.pageProps, 0, 8));
      }
    } catch(e) {}

    try {
      if (window.__NFES_DATA__) {
        var nd = window.__NFES_DATA__;
        var rel = {};
        if (nd.hotelDetailResponse) rel.hotelDetailResponse = nd.hotelDetailResponse;
        if (nd.props && nd.props.pageProps) rel.pageProps = nd.props.pageProps;
        if (nd.query) rel.query = nd.query;
        if (Object.keys(rel).length > 0) {
          lines.push("=== SSR Data: NFES (__NFES_DATA__) ===");
          lines.push(WE.yamlifyObject(rel, 0, 6));
        }
      }
    } catch(e) {}

    try {
      var jldEls = document.querySelectorAll('script[type="application/ld+json"]');
      if (jldEls.length > 0) {
        lines.push("=== SSR Data: JSON-LD ===");
        for (var i = 0; i < jldEls.length; i++) {
          try {
            lines.push("# Item " + (i + 1));
            lines.push(WE.yamlifyObject(JSON.parse(jldEls[i].textContent), 0, 5));
          } catch(e) {
            lines.push("# Item " + (i + 1) + " (parse error)");
          }
        }
      }
    } catch(e) {}

    try {
      if (window.__NUXT__) {
        lines.push("=== SSR Data: Nuxt (__NUXT__) ===");
        lines.push(WE.yamlifyObject(window.__NUXT__, 0, 5));
      }
    } catch(e) {}

    return lines.join("\n");
  };

  // ================================================================
  // 可访问性树快照
  // ================================================================

  WE.extractStructuredContent = function(maxLength) {
    var SKIP_TAGS = { script:1, style:1, svg:1, noscript:1, iframe:1, canvas:1, video:1, audio:1, template:1, link:1, meta:1, br:1, hr:1, wbr:1 };
    var LEAF_TAGS = { button:1, input:1, textarea:1, select:1, img:1, label:1 };

    var lines = [];
    var total = 0;
    var HIT_LIMIT = false;

    function emit(depth, text) {
      if (HIT_LIMIT) return false;
      var line = WE.sp(depth) + text;
      if (total + line.length + 1 > maxLength) { HIT_LIMIT = true; return false; }
      lines.push(line);
      total += line.length + 1;
      return true;
    }

    function walk(node, depth) {
      if (HIT_LIMIT || depth > 12) return;
      if (node.nodeType === 3) {
        var t = node.textContent.replace(/\s+/g, " ").trim();
        if (t) emit(depth, 'text "' + WE.esc(t, 500) + '"');
        return;
      }
      if (node.nodeType !== 1) return;
      if (!WE.isVisible(node)) return;
      var tag = node.tagName.toLowerCase();
      if (SKIP_TAGS.hasOwnProperty(tag)) return;

      var role = WE.roleOf(node);
      var isLeaf = LEAF_TAGS.hasOwnProperty(tag);
      var hasVisChildren = false;
      if (!isLeaf) {
        for (var i = 0; i < node.children.length; i++) {
          var c = node.children[i];
          if (WE.isVisible(c) && !SKIP_TAGS.hasOwnProperty(c.tagName.toLowerCase())) {
            hasVisChildren = true;
            break;
          }
        }
      }

      if (!hasVisChildren || isLeaf) {
        var text = "", href = "";
        if (tag === "img") {
          text = (node.getAttribute("alt") || node.getAttribute("title") || "").trim();
        } else if (tag === "a") {
          text = WE.directText(node);
          href = WE.linkHref(node);
        } else if (tag === "input") {
          text = (node.getAttribute("placeholder") || node.getAttribute("value") || node.getAttribute("name") || "").trim();
        } else {
          text = WE.directText(node);
        }
        if (text) {
          if (!role) role = "text";
          var line = role;
          if (tag === "a" && href) {
            line += ' "' + WE.esc(text, 200) + '" [' + WE.esc(href, 500) + ']';
          } else {
            line += ' "' + WE.esc(text, 200) + '"';
          }
          emit(depth, line);
        }
      } else {
        if (!role) role = "group";
        if (!emit(depth, role)) return;
        for (var i = 0; i < node.childNodes.length; i++) {
          walk(node.childNodes[i], depth + 1);
          if (HIT_LIMIT) return;
        }
      }
    }

    try {
      var body = document.body;
      if (!body) return "";

      var mainSelectors = getMainContentSelectors();
      var mainEl = null;
      for (var i = 0; i < mainSelectors.length; i++) {
        var el = document.querySelector(mainSelectors[i]);
        if (el && WE.isVisible(el)) { mainEl = el; break; }
      }
      walk(mainEl || body, 0);
      var result = lines.join("\n");
      if (HIT_LIMIT) result += "\n... (snapshot truncated at length limit)";
      return result;
    } catch(e) {
      return "Snapshot error: " + e.message;
    }
  };

  // ================================================================
  // 动态内容等待
  // ================================================================

  WE.waitForDynamicContent = async function(timeoutMs) {
    timeoutMs = timeoutMs || 15000;

    var qc = WE.quickContentCheck();
    if (qc.ready) {
      return { ready: true, waited: 0, dataSources: qc.sources, reason: "content_already_loaded" };
    }

    if (!WE.isDynamicPage()) {
      return { ready: true, waited: 0, dataSources: [], reason: "static_page" };
    }

    var pendingRequests = 0;
    var apiUrls = [];
    var origFetch = null, origXOpen = null, origXSend = null;

    try {
      origFetch = window.fetch;
      window.fetch = function() {
        pendingRequests++;
        var p = origFetch.apply(this, arguments);
        p.finally(function() { pendingRequests = Math.max(0, pendingRequests - 1); });
        return p;
      };
    } catch(e) {}

    try {
      origXOpen = XMLHttpRequest.prototype.open;
      origXSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function(_m, url) {
        this.__xUrl = url;
        return origXOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function() {
        var s = this;
        pendingRequests++;
        s.addEventListener("loadend", function() {
          pendingRequests = Math.max(0, pendingRequests - 1);
          if (s.__xUrl) apiUrls.push(s.__xUrl);
        });
        return origXSend.apply(this, arguments);
      };
    } catch(e) {}

    try {
      var startTime = Date.now();
      var lastLen = 0, stableCount = 0;

      while (Date.now() - startTime < timeoutMs) {
        var ck = WE.quickContentCheck();
        var curLen = document.body ? document.body.innerHTML.length : 0;
        if (ck.ready) {
          return {
            ready: true, waited: Date.now() - startTime,
            dataSources: ck.sources.concat(apiUrls), reason: "content_detected"
          };
        }
        if (curLen === lastLen) {
          stableCount++;
          if (stableCount >= 5 && pendingRequests === 0) {
            return {
              ready: true, waited: Date.now() - startTime,
              dataSources: apiUrls, reason: "content_stable"
            };
          }
        } else {
          stableCount = 0;
          lastLen = curLen;
        }
        await WE.sleep(400);
      }
      return { ready: true, waited: timeoutMs, dataSources: apiUrls, reason: "timeout" };
    } finally {
      WE.restoreNetworkMonitors(origFetch, origXOpen, origXSend);
    }
  };

  // ================================================================
  // 增强版提取：等待 + SSR + 快照
  // ================================================================

  WE.extractWithWait = async function(maxLength, waitTimeout) {
    maxLength = maxLength || 50000;
    waitTimeout = waitTimeout || 15000;

    var waitResult = await WE.waitForDynamicContent(waitTimeout);
    var ssrDataSection = WE.extractSSRDataSection();

    var remainingForSnapshot = maxLength - ssrDataSection.length - 200;
    if (remainingForSnapshot < 5000) remainingForSnapshot = 5000;

    var snapshot = WE.extractStructuredContent(remainingForSnapshot);

    var combined = "";
    combined += "=== Page Metadata ===\n";
    combined += 'title: "' + (document.title || "") + '"\n';
    combined += 'url: "' + (window.location.href || "") + '"\n';
    combined += "wait_result: " + waitResult.reason + " (waited " + waitResult.waited + "ms)\n";
    if (waitResult.dataSources.length > 0) {
      combined += "data_sources: " + waitResult.dataSources.slice(0, 10).join(", ") + "\n";
    }
    combined += "\n";

    if (ssrDataSection.trim().length > 0) {
      combined += ssrDataSection + "\n";
    }
    combined += "=== Accessibility Tree Snapshot ===\n";
    combined += snapshot;

    return combined;
  };

})();
