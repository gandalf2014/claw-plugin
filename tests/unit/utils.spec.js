// ============================================================
// utils.spec.js — 通用工具函数单元测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModules } = require('../helpers/test-loader');

// 预先加载依赖模块，再加载 utils.js
let mods;
test.beforeAll(() => {
  mods = loadModules(['constants.js', 'utils.js']);
});

// ---- escapeHTML ----
test.describe('escapeHTML', () => {
  test('转义 HTML 特殊字符', () => {
    const { escapeHTML } = mods;
    expect(escapeHTML('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  test('空字符串返回空', () => {
    const { escapeHTML } = mods;
    expect(escapeHTML('')).toBe('');
  });

  test('falsy 值返回空字符串', () => {
    const { escapeHTML } = mods;
    expect(escapeHTML(null)).toBe('');
    expect(escapeHTML(undefined)).toBe('');
  });

  test('无特殊字符的文本不变', () => {
    const { escapeHTML } = mods;
    expect(escapeHTML('Hello World')).toBe('Hello World');
  });
});

// ---- truncate ----
test.describe('truncate', () => {
  test('短文本不截断', () => {
    const { truncate } = mods;
    expect(truncate('hello', 10)).toBe('hello');
  });

  test('长文本截断并追加 ...', () => {
    const { truncate } = mods;
    expect(truncate('hello world this is long', 10)).toBe('hello worl...');
  });

  test('正好等于最大长度不追加 ...', () => {
    const { truncate } = mods;
    expect(truncate('1234567890', 10)).toBe('1234567890');
  });

  test('换行符替换为空格', () => {
    const { truncate } = mods;
    expect(truncate('hello\nworld', 20)).toBe('hello world');
  });

  test('空字符串返回空', () => {
    const { truncate } = mods;
    expect(truncate('', 10)).toBe('');
  });
});

// ---- formatDate ----
test.describe('formatDate', () => {
  test('刚刚（1分钟以内）', () => {
    const { formatDate } = mods;
    const justNow = new Date().toISOString();
    expect(formatDate(justNow)).toBe('刚刚');
  });

  test('N 分钟前', () => {
    const { formatDate } = mods;
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatDate(tenMinAgo)).toBe('10 分钟前');
  });

  test('N 小时前', () => {
    const { formatDate } = mods;
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect(formatDate(threeHoursAgo)).toBe('3 小时前');
  });

  test('N 天前（30天以内）', () => {
    const { formatDate } = mods;
    const fiveDaysAgo = new Date(Date.now() - 5 * 86400 * 1000).toISOString();
    expect(formatDate(fiveDaysAgo)).toBe('5 天前');
  });

  test('超过30天显示 M/D 格式', () => {
    const { formatDate } = mods;
    const old = new Date(2024, 0, 15).toISOString(); // Jan 15
    expect(formatDate(old)).toBe('1/15');
  });
});

// ---- formatArea ----
test.describe('formatArea', () => {
  test('M 级别面积', () => {
    const { formatArea } = mods;
    expect(formatArea(2000000)).toBe('2.0M px²');
  });

  test('K 级别面积', () => {
    const { formatArea } = mods;
    expect(formatArea(50000)).toBe('50K px²');
  });

  test('小面积直接显示', () => {
    const { formatArea } = mods;
    expect(formatArea(500)).toBe('500 px²');
  });

  test('无效面积返回空', () => {
    const { formatArea } = mods;
    expect(formatArea(0)).toBe('');
    expect(formatArea(-1)).toBe('');
    expect(formatArea(null)).toBe('');
  });
});

// ---- escPromptText ----
test.describe('escPromptText', () => {
  test('替换换行和双引号', () => {
    const { escPromptText } = mods;
    expect(escPromptText('hello\n"world"')).toBe("hello 'world'");
  });

  test('空值返回空字符串', () => {
    const { escPromptText } = mods;
    expect(escPromptText('')).toBe('');
    expect(escPromptText(null)).toBe('');
  });
});
