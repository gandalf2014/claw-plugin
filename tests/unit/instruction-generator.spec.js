// ============================================================
// instruction-generator.spec.js — 规则兜底指令生成测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModules } = require('../helpers/test-loader');

let mods;
test.beforeAll(() => {
  // 创建带有 DOM 模拟的沙箱
  const mockDOM = {
    txtInstruction: { value: '', placeholder: '', style: {}, focus: () => {} },
  };
  // 先加载依赖
  mods = loadModules(
    ['constants.js', 'shared-prompt.js', 'utils.js',
     'csv-utils.js', 'xlsx-builder.js', 'history.js',
     'instruction-generator.js'],
    {
      DOM: mockDOM,
      setStatus: () => {},
      hideStatus: () => {},
      updateMultiExtractButton: () => {},
      updateSaveRuleButton: () => {},
      getConfig: async () => ({ apiKey: '', baseUrl: '' }),
      callLLM: async () => { throw new Error('no LLM'); },
      handleExtract: () => {},
      instructionFromStorage: false,
      chrome: {
        storage: {
          sync: { get: async () => ({}), set: async () => {} },
          local: { get: async () => ({}), set: async () => {} },
        },
        runtime: {
          sendMessage: () => {},
          onMessage: { addListener: () => {} },
          openOptionsPage: () => {},
        },
        tabs: { query: async () => [{ id: 1 }] },
        scripting: { executeScript: async () => [{ result: null }] },
        action: { openPopup: () => {} },
      },
    }
  );
});

test.describe('fallbackGenerateInstruction', () => {
  test('检测价格关键词生成指令', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['酒店豪华大床房 ¥688 起 含早餐']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('价格');
    expect(DOM_ALIAS.txtInstruction.value).toContain('提取');
  });

  test('检测评分关键词', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['评分 4.8分 好评如潮']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('评分');
  });

  test('检测日期关键词', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['活动时间 2025-06-09 至 2025-06-30']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('日期');
  });

  test('检测销量关键词', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['已售 10万+ 爆款商品热卖中']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('销量');
  });

  test('检测百分比关键词', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['折扣 15% 限时优惠']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('百分比');
  });

  test('无匹配关键词时生成默认指令', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction(['这是一段没有特殊数据的普通文本']);
    expect(DOM_ALIAS.txtInstruction.value).toContain('名称');
    expect(DOM_ALIAS.txtInstruction.value).toContain('提取');
  });

  test('多条元素文本合并检测', () => {
    const { fallbackGenerateInstruction } = mods;
    fallbackGenerateInstruction([
      '酒店豪华大床房',
      '¥688 起/晚',
      '评分 4.8',
      '已售 1.2万',
    ]);
    // 应包含多个检测到的字段
    expect(DOM_ALIAS.txtInstruction.value).toContain('价格');
    expect(DOM_ALIAS.txtInstruction.value).toContain('评分');
    expect(DOM_ALIAS.txtInstruction.value).toContain('销量');
  });
});

// 因为 loadModules 会创建新的 DOM 对象，我们需要引用到被修改的同一个对象
// 这里使用一个简单方式：在 global 上挂载引用
const DOM_ALIAS = {
  get txtInstruction() {
    return mods.DOM ? mods.DOM.txtInstruction : { value: '' };
  },
};
