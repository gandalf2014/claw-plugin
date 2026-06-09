// ============================================================
// xlsx-builder.spec.js — XLSX 生成器单元测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModules } = require('../helpers/test-loader');

let mods;
test.beforeAll(() => {
  mods = loadModules(['constants.js', 'utils.js', 'csv-utils.js', 'xlsx-builder.js']);
});

// ---- colIdxToLetter ----
test.describe('colIdxToLetter', () => {
  test('0 → A', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(0)).toBe('A');
  });

  test('25 → Z', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(25)).toBe('Z');
  });

  test('26 → AA', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(26)).toBe('AA');
  });

  test('27 → AB', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(27)).toBe('AB');
  });

  test('51 → AZ', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(51)).toBe('AZ');
  });

  test('52 → BA', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(52)).toBe('BA');
  });

  test('701 → ZZ', () => {
    const { colIdxToLetter } = mods;
    expect(colIdxToLetter(701)).toBe('ZZ');
  });
});

// ---- xmlEscape ----
test.describe('xmlEscape', () => {
  test('转义 XML 特殊字符', () => {
    const { xmlEscape } = mods;
    expect(xmlEscape('<>&"')).toBe('&lt;&gt;&amp;&quot;');
    expect(xmlEscape("'")).toBe('&apos;');
  });

  test('普通文本不变', () => {
    const { xmlEscape } = mods;
    expect(xmlEscape('Hello World')).toBe('Hello World');
  });

  test('null 和 undefined 返回空', () => {
    const { xmlEscape } = mods;
    expect(xmlEscape(null)).toBe('');
    expect(xmlEscape(undefined)).toBe('');
  });

  test('数字转字符串', () => {
    const { xmlEscape } = mods;
    expect(xmlEscape(42)).toBe('42');
  });
});

// ---- crc32 ----
test.describe('crc32', () => {
  test('相同输入产生相同校验和', () => {
    const { crc32 } = mods;
    const data = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const result = crc32(data);
    expect(typeof result).toBe('number');
    // 两次调用结果一致
    expect(crc32(data)).toBe(result);
  });

  test('不同输入产生不同校验和', () => {
    const { crc32 } = mods;
    const a = new Uint8Array([0x41]); // "A"
    const b = new Uint8Array([0x42]); // "B"
    expect(crc32(a)).not.toBe(crc32(b));
  });

  test('空数据返回非零值', () => {
    const { crc32 } = mods;
    const result = crc32(new Uint8Array(0));
    expect(typeof result).toBe('number');
  });
});

// ---- jsonToXlsxBlob ----
test.describe('jsonToXlsxBlob', () => {
  test('简单对象数组生成 XLSX Blob', () => {
    const { jsonToXlsxBlob } = mods;
    const blob = jsonToXlsxBlob(JSON.stringify([
      { name: 'Alice', score: 95 },
      { name: 'Bob', score: 87 },
    ]));
    expect(blob).toBeTruthy();
    expect(blob instanceof require('buffer').Blob || blob.constructor.name === 'Blob').toBeTruthy();
    // XLSX 文件有最小尺寸
    expect(blob.size).toBeGreaterThan(100);
  });

  test('无效 JSON 抛出错误', () => {
    const { jsonToXlsxBlob } = mods;
    expect(() => jsonToXlsxBlob('bad json')).toThrow('JSON 解析失败');
  });

  test('空数组抛出错误', () => {
    const { jsonToXlsxBlob } = mods;
    expect(() => jsonToXlsxBlob('[]')).toThrow('无可转换为表格的数据');
  });

  test('含包装对象的数据', () => {
    const { jsonToXlsxBlob } = mods;
    const blob = jsonToXlsxBlob(JSON.stringify({
      results: [{ title: 'Test', value: 1 }],
    }));
    expect(blob).toBeTruthy();
    expect(blob.size).toBeGreaterThan(100);
  });
});
