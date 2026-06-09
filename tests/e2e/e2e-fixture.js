// ============================================================
// e2e-fixture.js — E2E 测试共享 Fixture
// 直接打开扩展 HTML 页面 + 注入 mock chrome API
// 支持 Promise 和 callback 双模式（兼容 MV3 的两种调用方式）
// ============================================================
const { test: base } = require('@playwright/test');
const path = require('path');

const SRC = path.resolve(__dirname, '../../web-extractor');

const CHROME_MOCK_SCRIPT = `
// 构建一个同时支持 callback 和 Promise 模式的 storage mock
function _makeStorage(key) {
  function _read() {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
    catch (_) { return {}; }
  }
  function _write(d) {
    localStorage.setItem(key, JSON.stringify(d));
  }
  return {
    get: function(keys, callback) {
      var d = _read();
      var res = {};
      // 处理 keys 参数：支持 string, array, object, null/undefined
      var keyList;
      if (keys === null || keys === undefined || (typeof keys === 'object' && !Array.isArray(keys))) {
        keyList = Object.keys(d);
      } else if (Array.isArray(keys)) {
        keyList = keys;
      } else {
        keyList = [keys];
      }
      for (var i = 0; i < keyList.length; i++) {
        var kk = keyList[i];
        if (d[kk] !== undefined) res[kk] = d[kk];
      }
      if (typeof callback === 'function') {
        // 用 setTimeout 模拟异步 callback，兼容 callback 风格调用
        setTimeout(function() { callback(res); }, 0);
      }
      return Promise.resolve(res);
    },
    set: function(obj, callback) {
      var d = _read();
      for (var k in obj) { if (obj.hasOwnProperty(k)) d[k] = obj[k]; }
      _write(d);
      if (typeof callback === 'function') {
        setTimeout(function() { callback(); }, 0);
      }
      return Promise.resolve();
    },
  };
}
var _sync = _makeStorage('__mock_sync__');
var _local = _makeStorage('__mock_local__');

window.chrome = {
  storage: {
    sync: _sync,
    local: _local,
  },
  runtime: {
    onMessage: { addListener: function() {} },
    sendMessage: function(msg, cb) {
      if (msg.type === 'callLLM') {
        setTimeout(function() {
          var resp = { result: JSON.stringify({ name: 'Test', value: 123 }) };
          if (typeof cb === 'function') cb(resp);
        }, 0);
      } else {
        setTimeout(function() {
          if (typeof cb === 'function') cb({});
        }, 0);
      }
    },
    openOptionsPage: function() {},
    // chrome.runtime.lastError 需要在属性访问时动态取值
    _lastError: undefined,
  },
  tabs: {
    query: function(info, callback) {
      var result = [{ id: 1, url: 'https://example.com' }];
      if (typeof callback === 'function') { setTimeout(function() { callback(result); }, 0); }
      return Promise.resolve(result);
    },
    get: function(tabId, callback) {
      var result = { url: 'https://example.com' };
      if (typeof callback === 'function') { setTimeout(function() { callback(result); }, 0); }
      return Promise.resolve(result);
    },
    sendMessage: function(tabId, msg, cb) {
      setTimeout(function() { if (typeof cb === 'function') cb(); }, 0);
    },
  },
  scripting: {
    executeScript: function(details, callback) {
      var result = [{ result: { sections: [], toolbarActive: false, selectedCount: 0, selectedTexts: [] } }];
      if (typeof callback === 'function') { setTimeout(function() { callback(result); }, 0); }
      return Promise.resolve(result);
    },
  },
  action: { openPopup: function() {} },
};

// getter for lastError
Object.defineProperty(window.chrome.runtime, 'lastError', {
  get: function() { return window.chrome.runtime._lastError; },
  configurable: true,
});
`;

const test = base.extend({
  page: async ({ browser }, use) => {
    const context = await browser.newContext({ viewport: { width: 480, height: 700 } });
    const page = await context.newPage();

    // 注入 chrome mock 在页面脚本之前
    await page.addInitScript(CHROME_MOCK_SCRIPT);

    await use(page);
    await context.close();
  },
});

module.exports = { test, expect: base.expect, SRC };
