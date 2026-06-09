// ============================================================
// content.js — 页面内容提取器
// 作为 content_script 注入到每个页面
// ============================================================

// 调试开关：设为 false 可关闭所有 [WebExtractor] 控制台输出
var WEBEX_DEBUG = false;
function _weLog(/* ... */) {
  if (!WEBEX_DEBUG) return;
  console.log.apply(console, arguments);
}

/**
 * 监听来自 popup 的直接消息（备用方式）
 * 主要提取逻辑在 popup.js 中通过 scripting.executeScript 注入执行
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

  // --- 内容提取 ---
  if (request.type === "extractContent") {
    (async function() {
      try {
        const maxLength = request.maxLength || 50000;
        const waitTimeout = request.waitTimeout || 15000;
        const content = await extractWithWait(maxLength, waitTimeout);
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
// 动态内容等待策略
// ============================================================

/**
 * 等待页面中的动态内容加载完成
 *
 * 策略优先级：
 *   1. 先检测 DOM 中是否已有足够的可见内容（快速路径）
 *   2. 如果没有，等待特定选择器出现（如携程的 .room-list, .comment-list）
 *   3. 同时监听 fetch/XHR 请求完成（数据就绪信号）
 *   4. 超时兜底：到达最大等待时间后，即使不完美也返回当前 DOM
 *
 * @param {number} timeoutMs - 最大等待毫秒数（默认 8000ms）
 * @returns {object} { ready: boolean, dataSources: string[] }
 */
async function waitForDynamicContent(timeoutMs) {
  timeoutMs = timeoutMs || 15000;

  // ============================================================
  // 阶段 1：快速检查 — DOM 中是否已有足够内容
  // ============================================================
  var quickCheck = quickContentCheck();
  if (quickCheck.ready) {
    return { ready: true, waited: 0, dataSources: quickCheck.sources, reason: "content_already_loaded" };
  }

  // ============================================================
  // 阶段 2：智能等待 — 轮询 + API 监听
  // ============================================================
  // 如果页面是纯同步的（无框架特征），直接返回当前 DOM，不再等待
  if (!isDynamicPage()) {
    return { ready: true, waited: 0, dataSources: [], reason: "static_page" };
  }

  // 安装 API 请求监听器（拦截 fetch/XHR）
  var pendingRequests = 0;
  var apiUrls = [];
  var origFetch = null;
  var origXHROpen = null;
  var origXHRSend = null;

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
    origXHROpen = XMLHttpRequest.prototype.open;
    origXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(_method, url) {
      this.__xhrUrl = url;
      return origXHROpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      pendingRequests++;
      this.addEventListener("loadend", function() {
        pendingRequests = Math.max(0, pendingRequests - 1);
        if (self.__xhrUrl) apiUrls.push(self.__xhrUrl);
      });
      return origXHRSend.apply(this, arguments);
    };
  } catch(e) {}

  // 非阻塞轮询（每次等待 400ms，给浏览器渲染线程时间）
  // try/finally 确保无论如何都能恢复被拦截的网络 API
  try {
    var startTime = Date.now();
    var lastContentLength = 0;
    var stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      var check = quickContentCheck();
      var currentLength = document.body ? document.body.innerHTML.length : 0;

      if (check.ready) {
        return {
          ready: true,
          waited: Date.now() - startTime,
          dataSources: check.sources.concat(apiUrls),
          reason: "content_detected"
        };
      }

      if (currentLength === lastContentLength) {
        stableCount++;
        if (stableCount >= 5 && pendingRequests === 0) {
          return {
            ready: true,
            waited: Date.now() - startTime,
            dataSources: apiUrls,
            reason: "content_stable"
          };
        }
      } else {
        stableCount = 0;
        lastContentLength = currentLength;
      }

      // 非阻塞等待：释放主线程让 React 完成渲染
      await new Promise(function(r) { setTimeout(r, 400); });
    }

    // 超时兜底
    return {
      ready: true,
      waited: timeoutMs,
      dataSources: apiUrls,
      reason: "timeout"
    };
  } finally {
    // 无论如何都要恢复原始网络 API，防止页面功能永久损坏
    restoreNetworkMonitors(origFetch, origXHROpen, origXHRSend);
  }
}

/**
 * 恢复被拦截的网络监听器
 */
function restoreNetworkMonitors(origFetch, origXHROpen, origXHRSend) {
  try {
    if (origFetch) window.fetch = origFetch;
    if (origXHROpen) XMLHttpRequest.prototype.open = origXHROpen;
    if (origXHRSend) XMLHttpRequest.prototype.send = origXHRSend;
  } catch(e) {}
}

/**
 * 快速检查当前 DOM 中是否已有足够的可见内容
 * 识别常见数据模式：酒店详情、商品列表、文章内容等
 */
function quickContentCheck() {
  var sources = [];
  var score = 0;

  // 1. 检测 SSR 内嵌数据（Next.js __NEXT_DATA__ / Nuxt __NUXT__ / 通用 JSON-LD）
  //    SSR 数据只给 2 分，不足以触发"就绪"——必须等待客户端数据
  var ssrData = detectSSRData();
  if (ssrData.found) {
    sources.push("ssr_embedded_data(" + ssrData.type + ")");
    score += 2;
  }

  // 2. 扫描可见的数据元素（文本较多的 div/section，包含价格等信息）
  try {
    var textBlocks = 0, dataBlocks = 0;
    var allDivs = document.querySelectorAll("div, section, article");
    for (var di = 0; di < allDivs.length; di++) {
      if (!isElementVisible(allDivs[di])) continue;
      var txt = (allDivs[di].textContent || "").trim();
      if (txt.length > 80) { textBlocks++; }
      if (txt.length > 30 && /[¥￥$]\s*\d/.test(txt)) { dataBlocks++; }
      if (textBlocks > 15) break;
    }
    if (dataBlocks > 0) { sources.push("price_text_found:" + dataBlocks); score += 2; }
    if (textBlocks > 5) { sources.push("dense_content:" + textBlocks); score += 1; }
  } catch(e) {}

  // 3. 检测是否有可见的列表/表格内容（对散列 class 名的宽泛匹配）
  var listSelectors = [
    ".room-list", ".room-item", ".room-type", "[data-room-id]",
    ".product-list", ".product-item", ".item-list",
    ".search-result", ".result-item",
    ".comment-list", ".review-list", ".review-item",
    "table tbody tr", ".data-table tr",
    ".price-item", ".rate-item", "[data-price]",
    ".hotel-info", ".hotel-detail",
    // 散列 class 名的宽泛匹配（携程等 CSS Modules 页面）
    '[class*="roomItem"]', '[class*="RoomItem"]', '[class*="room-item"]',
    '[class*="priceRow"]', '[class*="PriceRow"]', '[class*="price-row"]',
    '[class*="hotelDetail"]', '[class*="HotelDetail"]',
    '[class*="productCard"]', '[class*="ProductCard"]', '[class*="product-card"]',
    '[class*="tableList"]', '[class*="TableList"]',
    '[class*="listItem"]', '[class*="ListItem"]',
    '[class*="cardBox"]', '[class*="CardBox"]',
  ];
  for (var i = 0; i < listSelectors.length && score < 5; i++) {
    try {
      var els = document.querySelectorAll(listSelectors[i]);
      for (var j = 0; j < els.length; j++) {
        if (isElementVisible(els[j])) {
          sources.push("selector:" + listSelectors[i]);
          score += 3;
          break;
        }
      }
    } catch(e) {}
  }

  // 4. 检测是否有评分/价格等关键数据元素
  var keyDataSelectors = [
    ".score", ".rating", ".star", "[data-score]",
    ".price", ".amount", ".cost", "[data-price]",
    ".address", ".location",
    ".facility", ".amenity",
    ".review-score", ".review-count",
  ];
  for (var i = 0; i < keyDataSelectors.length; i++) {
    try {
      var el = document.querySelector(keyDataSelectors[i]);
      if (el && isElementVisible(el) && (el.textContent || "").trim().length > 0) {
        sources.push("keydata:" + keyDataSelectors[i]);
        score += 1;
      }
    } catch(e) {}
  }

  // 5. 检测 body 中是否有足够多的可见文本节点
  try {
    var bodyText = (document.body ? document.body.innerText || "" : "").trim();
    if (bodyText.length > 500) {
      score += 1;
    }
  } catch(e) {}

  // 需要 score >= 5 才认为就绪（SSR 仅贡献 2 分，必须等客户端数据）
  return { ready: score >= 5, score: score, sources: sources };
}

/**
 * 检测 SSR 内嵌数据（Next.js, Nuxt, JSON-LD 等）
 */
function detectSSRData() {
  try {
    // Next.js: __NEXT_DATA__ 包含 props.pageProps 中的服务端数据
    if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props) {
      var props = window.__NEXT_DATA__.props;
      if (props.pageProps) {
        // 检查是否有实际数据（不仅仅是 pathname 等路由信息）
        var keys = Object.keys(props.pageProps);
        var dataKeys = keys.filter(function(k) {
          return k !== "pathname" && k !== "asPath" && k !== "query";
        });
        if (dataKeys.length > 0) {
          return { found: true, type: "nextjs", keys: dataKeys };
        }
      }
    }

    // Nuxt: __NUXT__
    if (window.__NUXT__) {
      return { found: true, type: "nuxt" };
    }

    // JSON-LD 结构化数据
    var jsonldEls = document.querySelectorAll('script[type="application/ld+json"]');
    if (jsonldEls.length > 0) {
      var ldData = [];
      for (var i = 0; i < jsonldEls.length; i++) {
        try {
          ldData.push(JSON.parse(jsonldEls[i].textContent));
        } catch(e) {}
      }
      if (ldData.length > 0) {
        return { found: true, type: "jsonld", count: ldData.length };
      }
    }

    // 通用 data 属性中的内嵌数据（如 window.__NFES_DATA__）
    if (window.__NFES_DATA__) {
      return { found: true, type: "nfes_data" };
    }
  } catch(e) {}

  return { found: false };
}

/**
 * 快速判断元素是否可见（不触发重排的轻量版本）
 */
function isElementVisible(el) {
  if (!el) return false;
  try {
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    return true;
  } catch(e) { return false; }
}

/**
 * 判断当前页面是否为动态渲染页面（SPA/SSR）
 * 检测常见框架的标记
 */
function isDynamicPage() {
  try {
    // Next.js
    if (document.getElementById("__next") || window.__NEXT_DATA__ || document.querySelector("[data-nextjs]")) return true;
    // Nuxt
    if (document.getElementById("__nuxt") || window.__NUXT__) return true;
    // React/Vue/Angular 根节点
    if (document.getElementById("root") || document.getElementById("app")) {
      var rootEl = document.getElementById("root") || document.getElementById("app");
      // 如果根节点有子元素但几乎没有文本内容，很可能是 SPA 等待渲染
      if (rootEl && rootEl.children.length > 0 && (rootEl.innerText || "").trim().length < 100) {
        return true;
      }
    }
    // 检测常见 SPA 路由特征
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.__VUE_DEVTOOLS_GLOBAL_HOOK__) return true;
    // 检测是否包含大量 script 标签（SPA 特征）
    var scripts = document.querySelectorAll('script[src*="_next/"], script[src*="chunk"], script[src*="bundle"]');
    if (scripts.length > 2) return true;
  } catch(e) {}
  return false;
}

/**
 * 提取可访问性树快照（仿 Playwright Accessibility Snapshot）
 * 输出 YAML 风格缩进树，保留 DOM 层次结构
 */
function extractStructuredContent(maxLength) {
  // ================================================================
  // 角色映射
  // ================================================================
  var LANDMARK = {
    header: "banner", main: "main", nav: "navigation",
    footer: "contentinfo", aside: "complementary", form: "form"
  };

  var SKIP = {
    script: 1, style: 1, svg: 1, noscript: 1, iframe: 1,
    canvas: 1, video: 1, audio: 1, template: 1,
    link: 1, meta: 1, br: 1, hr: 1, wbr: 1
  };

  var LEAF_TAGS = {
    button: 1, input: 1, textarea: 1, select: 1, img: 1, label: 1
  };

  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    if (el !== document.body && el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("hidden")) return false;
    return true;
  }

  function roleOf(el) {
    var tag = el.tagName.toLowerCase();
    var explicit = el.getAttribute("role");
    if (explicit) return explicit;
    if (LANDMARK.hasOwnProperty(tag)) return LANDMARK[tag];
    var h = tag.match(/^h([1-6])$/);
    if (h) return "heading [h" + h[1] + "]";
    switch (tag) {
      case "a":    return "link";
      case "ul": case "ol": return "list";
      case "li":   return "listitem";
      case "button": return "button";
      case "table":  return "table";
      case "tr":     return "row";
      case "td":     return "cell";
      case "th":     return "cell [th]";
      case "img":    return "image";
      case "input":  return "textbox";
      case "textarea": return "textbox";
      case "select": return "combobox";
      case "p":      return "paragraph";
      case "label":  return "label";
      default:       return "";
    }
  }

  function directText(el) {
    var t = "";
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3) t += el.childNodes[i].textContent;
    }
    return t.replace(/\s+/g, " ").trim();
  }

  function esc(s, limit) {
    if (!s) return "";
    limit = limit || 200;
    s = s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
    if (s.length > limit) s = s.substring(0, limit - 3) + "...";
    return s;
  }

  function linkHref(el) {
    var h = (el.getAttribute("href") || "").trim();
    if (!h || h.toLowerCase().startsWith("javascript:")) return "";
    if (h.length > 500) h = h.substring(0, 497) + "...";
    return h;
  }

  // ================================================================
  // 主遍历
  // ================================================================
  var lines = [];
  var total = 0;
  var HIT_LIMIT = false;

  function emit(depth, text) {
    if (HIT_LIMIT) return false;
    var line = sp(depth) + text;
    if (total + line.length + 1 > maxLength) { HIT_LIMIT = true; return false; }
    lines.push(line);
    total += line.length + 1;
    return true;
  }

  function walk(node, depth) {
    if (HIT_LIMIT || depth > 12) return;

    if (node.nodeType === 3) {
      var t = node.textContent.replace(/\s+/g, " ").trim();
      if (t) emit(depth, 'text "' + esc(t) + '"');
      return;
    }

    if (node.nodeType !== 1) return;
    if (!visible(node)) return;

    var tag = node.tagName.toLowerCase();
    if (SKIP.hasOwnProperty(tag)) return;

    var role = roleOf(node);
    var isLeaf = LEAF_TAGS.hasOwnProperty(tag);

    var hasVisibleChildren = false;
    if (!isLeaf) {
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (visible(c) && !SKIP.hasOwnProperty(c.tagName.toLowerCase())) {
          hasVisibleChildren = true;
          break;
        }
      }
    }

    if (!hasVisibleChildren || isLeaf) {
      var text = "";
      var href = "";
      if (tag === "img") {
        text = (node.getAttribute("alt") || node.getAttribute("title") || "").trim();
      } else if (tag === "a") {
        text = directText(node);
        href = linkHref(node);
      } else if (tag === "input") {
        text = (node.getAttribute("placeholder") || node.getAttribute("value") || node.getAttribute("name") || "").trim();
      } else {
        text = directText(node);
      }
      if (text) {
        if (!role) role = "text";
        var line = role;
        if (tag === "a" && href) {
          line += ' "' + esc(text) + '" [' + esc(href, 500) + ']';
        } else {
          line += ' "' + esc(text) + '"';
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

    var mainSelectors = [
      "main", '[role="main"]', "article",
      ".main-content", "#main-content", ".content", "#content",
      ".post-content", ".article-content",
      ".search-result-list", ".list-container", ".hotel-list", ".product-list"
    ];

    var mainEl = null;
    for (var i = 0; i < mainSelectors.length; i++) {
      var el = document.querySelector(mainSelectors[i]);
      if (el && visible(el)) { mainEl = el; break; }
    }

    var root = mainEl || body;
    walk(root, 0);

    var result = lines.join("\n");
    if (HIT_LIMIT) result += "\n... (快照因长度限制已截断)";
    return result;
  } catch (e) {
    return "提取出错: " + e.message;
  }
}

// ============================================================
// 增强版提取：先等待动态内容，再提取 + SSR 数据
// ============================================================

/**
 * 增强版内容提取（带智能等待 + SSR 数据提取）
 * 1. 等待动态内容加载完成
 * 2. 提取 SSR 内嵌数据（__NEXT_DATA__、__NFES_DATA__、JSON-LD 等）
 * 3. 生成可访问性树快照
 * 4. 组合输出（SSR 数据 + 快照）
 *
 * @param {number} maxLength - 快照最大长度
 * @param {number} waitTimeout - 等待超时（毫秒）
 */
async function extractWithWait(maxLength, waitTimeout) {
  maxLength = maxLength || 50000;
  waitTimeout = waitTimeout || 15000;

  // Step 1: 等待动态内容加载
  var waitResult = await waitForDynamicContent(waitTimeout);

  // Step 2: 提取 SSR 内嵌数据
  var ssrDataSection = extractSSRDataSection();

  // Step 3: 生成可访问性树快照
  // 为快照保留足够空间（SSR 数据已占一部分）
  var remainingForSnapshot = maxLength - ssrDataSection.length - 200; // 200 为元数据预留
  if (remainingForSnapshot < 5000) remainingForSnapshot = 5000; // 最少保留 5KB 给快照

  var snapshot = extractStructuredContent(remainingForSnapshot);

  // Step 4: 组合输出
  var header = "=== Page Metadata ===\n";
  header += "title: \"" + (document.title || "") + "\"\n";
  header += "url: \"" + (window.location.href || "") + "\"\n";
  header += "wait_result: " + waitResult.reason + " (waited " + waitResult.waited + "ms)\n";
  if (waitResult.dataSources.length > 0) {
    header += "data_sources: " + waitResult.dataSources.slice(0, 10).join(", ") + "\n";
  }
  header += "\n";

  var combined = header;

  if (ssrDataSection.trim().length > 0) {
    combined += ssrDataSection + "\n";
  }

  combined += "=== Accessibility Tree Snapshot ===\n";
  combined += snapshot;

  return combined;
}

/**
 * 提取 SSR 内嵌数据，输出为结构化 YAML 文本
 * 会尝试从以下来源提取：
 *   1. __NEXT_DATA__.props.pageProps（Next.js 服务端数据）
 *   2. __NFES_DATA__（携程 NFES 框架数据）
 *   3. JSON-LD (application/ld+json) 结构化数据
 *   4. __NUXT__（Nuxt.js 服务端数据）
 *
 * 输出格式为缩进的 YAML，方便 LLM 解析
 */
function extractSSRDataSection() {
  var lines = [];

  // ---- Next.js: __NEXT_DATA__ ----
  try {
    if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
      var pageProps = window.__NEXT_DATA__.props.pageProps;
      lines.push("=== SSR Data: Next.js (__NEXT_DATA__.props.pageProps) ===");
      lines.push(yamlifyObject(pageProps, 0, 8)); // 最大深度 8 层
    }
  } catch(e) {}

  // ---- 携程 NFES: __NFES_DATA__ ----
  try {
    if (window.__NFES_DATA__) {
      lines.push("=== SSR Data: NFES (__NFES_DATA__) ===");
      // 提取关键字段，避免输出过多无用配置
      var nfesData = window.__NFES_DATA__;
      var relevant = {};
      if (nfesData.query) relevant.query = nfesData.query;
      if (nfesData.hotelDetailResponse) relevant.hotelDetailResponse = nfesData.hotelDetailResponse;
      if (nfesData.props && nfesData.props.pageProps) relevant.pageProps = nfesData.props.pageProps;
      // 如果有关键数据，输出；否则也尝试输出顶层但限制深度
      if (Object.keys(relevant).length > 0) {
        lines.push(yamlifyObject(relevant, 0, 6));
      } else {
        // 只提取看起来像数据的顶层键
        var dataKeys = ["query", "props", "hotelDetailResponse", "hotelComment", "hotelPositionInfo"];
        var filtered = {};
        for (var k = 0; k < dataKeys.length; k++) {
          if (nfesData[dataKeys[k]] !== undefined) filtered[dataKeys[k]] = nfesData[dataKeys[k]];
        }
        if (Object.keys(filtered).length > 0) {
          lines.push(yamlifyObject(filtered, 0, 6));
        }
      }
    }
  } catch(e) {}

  // ---- JSON-LD ----
  try {
    var jsonldEls = document.querySelectorAll('script[type="application/ld+json"]');
    if (jsonldEls.length > 0) {
      lines.push("=== SSR Data: JSON-LD ===");
      for (var i = 0; i < jsonldEls.length; i++) {
        try {
          var ldData = JSON.parse(jsonldEls[i].textContent);
          lines.push("# Item " + (i + 1));
          lines.push(yamlifyObject(ldData, 0, 5));
        } catch(e) {
          lines.push("# Item " + (i + 1) + " (parse error)");
        }
      }
    }
  } catch(e) {}

  // ---- Nuxt: __NUXT__ ----
  try {
    if (window.__NUXT__) {
      lines.push("=== SSR Data: Nuxt (__NUXT__) ===");
      lines.push(yamlifyObject(window.__NUXT__, 0, 5));
    }
  } catch(e) {}

  return lines.join("\n");
}

/**
 * 将 JS 对象转换为 YAML 风格的缩进文本
 * @param {*} obj - 要转换的对象
 * @param {number} depth - 当前缩进层级
 * @param {number} maxDepth - 最大递归深度
 * @param {number} maxStringLen - 字符串值最大长度
 */
function yamlifyObject(obj, depth, maxDepth, maxStringLen) {
  maxStringLen = maxStringLen || 300;
  if (depth > maxDepth) return sp(depth) + "... (max depth reached)";

  var lines = [];
  var indent = sp(depth);

  if (obj === null || obj === undefined) return indent + "null";

  if (typeof obj === "string") {
    var s = obj.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "");
    if (s.length > maxStringLen) s = s.substring(0, maxStringLen - 3) + "...";
    return indent + '"' + s + '"';
  }

  if (typeof obj === "number" || typeof obj === "boolean") {
    return indent + String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return indent + "[]";
    // 如果数组元素都是简单值，在一行显示
    if (obj.every(function(v) { return typeof v !== "object" || v === null; })) {
      var vals = obj.slice(0, 20).map(function(v) {
        if (typeof v === "string") return '"' + v.substring(0, 50) + '"';
        return String(v);
      });
      var suffix = obj.length > 20 ? " ... (" + (obj.length - 20) + " more)" : "";
      return indent + "[ " + vals.join(", ") + suffix + " ]";
    }
    // 复杂数组逐项输出
    lines.push(indent + "-");
    var limit = Math.min(obj.length, 50);
    for (var i = 0; i < limit; i++) {
      lines.push(yamlifyObject(obj[i], depth + 1, maxDepth, maxStringLen));
    }
    if (obj.length > limit) {
      lines.push(sp(depth + 1) + "... (" + (obj.length - limit) + " more items)");
    }
    return lines.join("\n");
  }

  if (typeof obj === "object") {
    var keys = Object.keys(obj);
    if (keys.length === 0) return indent + "{}";
    var limit = Math.min(keys.length, 30);
    for (var i = 0; i < limit; i++) {
      var k = keys[i];
      var v = obj[k];
      if (typeof v === "object" && v !== null) {
        lines.push(indent + k + ":");
        lines.push(yamlifyObject(v, depth + 1, maxDepth, maxStringLen));
      } else if (typeof v === "string") {
        var sv = v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "");
        if (sv.length > maxStringLen) sv = sv.substring(0, maxStringLen - 3) + "...";
        lines.push(indent + k + ': "' + sv + '"');
      } else {
        lines.push(indent + k + ": " + String(v));
      }
    }
    if (keys.length > limit) {
      lines.push(indent + "... (" + (keys.length - limit) + " more keys)");
    }
    return lines.join("\n");
  }

  return indent + String(obj);
}

/**
 * 缩进辅助
 */
function sp(n) {
  var s = "";
  for (var j = 0; j < n; j++) s += "  ";
  return s;
}

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
    tb.innerHTML =
      '<span>已选: <span class="we-count" id="we-sel-count">0</span> 个元素</span>' +
      '<button class="we-btn-clear" id="we-btn-clear">清除</button>' +
      '<button id="we-btn-cancel">取消</button>' +
      '<button class="we-btn-done" id="we-btn-done">完成选择</button>';
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
  // popup 已关闭，无需通知
}

function _selComplete() {
  stopSelectionMode();
  // 通知 background 打开 popup 面板
  try { chrome.runtime.sendMessage({ type: 'selectionComplete' }); } catch(e) {}
}

function startSelectionMode() {
  try {
    _weLog('[WebExtractor] startSelectionMode called, _selActive=', _selActive);
    if (_selActive) { _weLog('[WebExtractor] already active, skipping'); return; }

    // 安全检查：确保 document.body 存在
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

