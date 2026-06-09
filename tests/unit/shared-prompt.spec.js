// ============================================================
// shared-prompt.spec.js — 默认 System Prompt 测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModule } = require('../helpers/test-loader');

let mods;
test.beforeAll(() => {
  mods = loadModule('shared-prompt.js');
});

test.describe('DEFAULT_SYSTEM_PROMPT', () => {
  test('已定义且非空', () => {
    const { DEFAULT_SYSTEM_PROMPT } = mods;
    expect(DEFAULT_SYSTEM_PROMPT).toBeDefined();
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe('string');
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(100);
  });

  test('包含关键提取指令', () => {
    const { DEFAULT_SYSTEM_PROMPT } = mods;
    expect(DEFAULT_SYSTEM_PROMPT).toContain('JSON');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Page Metadata');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('SSR Embedded Data');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Flat Data List');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Accessibility Tree Snapshot');
  });

  test('包含数据提取规则', () => {
    const { DEFAULT_SYSTEM_PROMPT } = mods;
    expect(DEFAULT_SYSTEM_PROMPT).toContain('CRITICAL RULES');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('null');
    expect(DEFAULT_SYSTEM_PROMPT).toContain('valid JSON');
  });

  test('不包含非法控制字符', () => {
    const { DEFAULT_SYSTEM_PROMPT } = mods;
    // 不应该包含 null 字节等
    expect(DEFAULT_SYSTEM_PROMPT).not.toContain('\0');
  });
});
