// ============================================================
// constants.spec.js — 全局常量存在性测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModule } = require('../helpers/test-loader');

let mods;
test.beforeAll(() => {
  mods = loadModule('constants.js');
});

test.describe('EXTRACTOR_CONSTANTS', () => {
  test('所有必需常量已定义', () => {
    const { EXTRACTOR_CONSTANTS } = mods;
    expect(EXTRACTOR_CONSTANTS).toBeDefined();

    // 动态内容等待
    expect(EXTRACTOR_CONSTANTS.WAIT_TIMEOUT_MS).toBe(15000);
    expect(EXTRACTOR_CONSTANTS.POLL_INTERVAL_MS).toBe(400);
    expect(EXTRACTOR_CONSTANTS.STABLE_COUNT_THRESHOLD).toBe(5);

    // 快照
    expect(EXTRACTOR_CONSTANTS.DEFAULT_MAX_CONTENT_LENGTH).toBe(50000);
    expect(EXTRACTOR_CONSTANTS.MIN_SNAPSHOT_LENGTH).toBe(5000);
    expect(EXTRACTOR_CONSTANTS.SNAPSHOT_MAX_DEPTH).toBe(12);

    // LLM API
    expect(EXTRACTOR_CONSTANTS.LLM_MAX_TOKENS).toBe(16384);
    expect(EXTRACTOR_CONSTANTS.LLM_TEMPERATURE).toBeCloseTo(0.1);
    expect(EXTRACTOR_CONSTANTS.LLM_DEFAULT_MODEL).toBe('gpt-4o');

    // 历史记录
    expect(EXTRACTOR_CONSTANTS.MAX_HISTORY_ITEMS).toBe(50);

    // 扁平数据
    expect(EXTRACTOR_CONSTANTS.FLAT_DATA_MAX_ITEMS).toBe(40);
  });

  test('常量值为合理范围', () => {
    const C = mods.EXTRACTOR_CONSTANTS;
    // 等待时间合理
    expect(C.WAIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(C.WAIT_TIMEOUT_MS).toBeLessThanOrEqual(60000);

    // 内容长度合理
    expect(C.DEFAULT_MAX_CONTENT_LENGTH).toBeGreaterThan(1000);

    // Token 数合理
    expect(C.LLM_MAX_TOKENS).toBeGreaterThan(0);
    expect(C.LLM_MAX_TOKENS).toBeLessThanOrEqual(200000);

    // 温度在 0-2 之间
    expect(C.LLM_TEMPERATURE).toBeGreaterThanOrEqual(0);
    expect(C.LLM_TEMPERATURE).toBeLessThanOrEqual(2);
  });
});

test.describe('SEL_CONSTANTS', () => {
  test('选择模式常量已定义', () => {
    const { SEL_CONSTANTS } = mods;
    expect(SEL_CONSTANTS.ATTR).toBe('data-we-selected');
    expect(SEL_CONSTANTS.STYLE_ID).toBeTruthy();
    expect(SEL_CONSTANTS.TOOLBAR_ID).toBeTruthy();
  });
});

test.describe('SNAPSHOT_CONSTANTS', () => {
  test('快照常量已定义', () => {
    const { SNAPSHOT_CONSTANTS } = mods;
    expect(SNAPSHOT_CONSTANTS.LANDMARK).toBeDefined();
    expect(SNAPSHOT_CONSTANTS.LANDMARK.main).toBe('main');
    expect(SNAPSHOT_CONSTANTS.LANDMARK.header).toBe('banner');
    expect(SNAPSHOT_CONSTANTS.LANDMARK.nav).toBe('navigation');
    expect(SNAPSHOT_CONSTANTS.LANDMARK.footer).toBe('contentinfo');

    expect(SNAPSHOT_CONSTANTS.SKIP_TAGS).toBeDefined();
    expect(SNAPSHOT_CONSTANTS.SKIP_TAGS.script).toBe(1);
    expect(SNAPSHOT_CONSTANTS.SKIP_TAGS.style).toBe(1);

    expect(SNAPSHOT_CONSTANTS.LEAF_TAGS).toBeDefined();
    expect(SNAPSHOT_CONSTANTS.LEAF_TAGS.img).toBe(1);
    expect(SNAPSHOT_CONSTANTS.LEAF_TAGS.button).toBe(1);
    expect(SNAPSHOT_CONSTANTS.LEAF_TAGS.input).toBe(1);
  });
});
