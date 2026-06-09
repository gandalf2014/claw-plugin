// ============================================================
// test-loader.js — 单元测试辅助：在 Node 沙箱中加载扩展模块
// ============================================================
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { Blob } = require('buffer');

const SRC_DIR = path.resolve(__dirname, '../../web-extractor');

/**
 * 加载单个 JS 文件并在沙箱上下文中执行，返回被暴露的变量。
 * @param {string} filename - JS 文件名（不含路径）
 * @param {object} sandboxOverrides - 需要注入到沙箱的 mock 对象
 * @returns {object} 沙箱上下文中定义的所有顶层变量
 */
function loadModule(filename, sandboxOverrides = {}) {
  const filePath = path.join(SRC_DIR, filename);
  let code = fs.readFileSync(filePath, 'utf-8');

  // vm.runInContext 中 const/let 声明的变量不会出现在 context 对象上，
  // 因此将顶层 const/let 替换为 var，使它们成为 context 的属性。
  // 使用单词边界确保精确匹配，排除字符串内的 false positive
  code = code.replace(/(^|[;\{\}])\s*\b(const|let)\b\s+/gm, '$1 var ');

  const sandbox = {
    // 模拟 chrome 扩展 API
    chrome: createChromeMock(),
    // 浏览器全局对象
    document: createDocumentMock(),
    window: createWindowMock(),
    navigator: { clipboard: { writeText: async () => {} } },
    setTimeout: (fn, ms) => fn(),
    clearTimeout: () => {},
    // DOM API
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    DataView: globalThis.DataView,
    ArrayBuffer: globalThis.ArrayBuffer,
    Uint8Array: globalThis.Uint8Array,
    Blob,
    // Compression 相关
    CompressionStream: undefined, // 默认不可用，测试 STORE 模式
    // 注入用户自定义的 mock
    ...sandboxOverrides,
  };

  const context = vm.createContext(sandbox);

  try {
    vm.runInContext(code, context, { filename: filePath });
  } catch (err) {
    console.error(`Failed to load module ${filename}:`, err.message);
    throw err;
  }

  // 收集所有在沙箱中定义的非内置变量
  const exports = {};
  const skipKeys = new Set([
    'chrome', 'document', 'window', 'navigator',
    'setTimeout', 'clearTimeout', 'TextEncoder', 'TextDecoder',
    'DataView', 'ArrayBuffer', 'Uint8Array', 'CompressionStream',
    'console', 'global', 'globalThis', 'process',
  ]);
  for (const key of Object.keys(context)) {
    if (key.startsWith('__') || skipKeys.has(key)) continue;
    try {
      exports[key] = context[key];
    } catch (_) { /* skip unexportable */ }
  }

  return exports;
}

/**
 * 按顺序加载多个模块（后面的模块可以引用前面的变量）
 */
function loadModules(filenames, sandboxOverrides = {}) {
  const allExports = {};
  let accumulatedSandbox = { ...sandboxOverrides };

  for (const filename of filenames) {
    const ctx = loadModule(filename, accumulatedSandbox);
    Object.assign(allExports, ctx);
    // 将已加载模块的变量注入后续沙箱
    Object.assign(accumulatedSandbox, ctx);
  }

  return allExports;
}

// ---- Mock 工厂 ----

function createChromeMock() {
  const storageData = {};
  return {
    storage: {
      sync: {
        get: async (keys) => {
          const result = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (storageData[k] !== undefined) result[k] = storageData[k];
          }
          return result;
        },
        set: async (obj) => { Object.assign(storageData, obj); },
      },
      local: {
        get: async (keys) => {
          const result = {};
          for (const k of (Array.isArray(keys) ? keys : [keys])) {
            if (storageData[k] !== undefined) result[k] = storageData[k];
          }
          return result;
        },
        set: async (obj) => { Object.assign(storageData, obj); },
      },
    },
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: () => {},
      getURL: (p) => p,
      openOptionsPage: () => {},
      lastError: null,
    },
    tabs: {
      query: async () => [{ id: 1, url: 'https://example.com' }],
      get: async () => ({ url: 'https://example.com' }),
    },
    scripting: {
      executeScript: async () => [{ result: null }],
    },
    action: {
      openPopup: () => {},
    },
    _storageData: storageData,
  };
}

function createDocumentMock() {
  return {
    title: 'Test Page',
    body: { children: [], innerHTML: '', classList: { add: () => {}, remove: () => {} } },
    head: { appendChild: () => {} },
    createElement: (tag) => ({
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      style: {},
      innerHTML: '',
      textContent: '',
      classList: { add: () => {}, remove: () => {}, toggle: () => {} },
      setAttribute: () => {},
      getAttribute: () => null,
      removeAttribute: () => {},
      appendChild: () => {},
      remove: () => {},
      addEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
    }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    execCommand: () => {},
  };
}

function createWindowMock() {
  return {
    location: { href: 'https://example.com' },
    _WE: {
      isElementVisible: () => true,
      quickContentCheck: () => ({ ready: true, sources: [] }),
      isDynamicPage: () => false,
      extractSSRDataSection: () => '',
      extractStructuredContent: () => 'mock snapshot',
      restoreNetworkMonitors: () => {},
      sleep: async () => {},
      esc: (s) => (s || '').replace(/"/g, '\\"'),
    },
    fetch: async () => ({ ok: false, status: 500, text: async () => '' }),
  };
}

module.exports = { loadModule, loadModules };
