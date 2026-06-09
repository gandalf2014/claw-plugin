// ============================================================
// csv-utils.spec.js — CSV 转换函数单元测试
// ============================================================
const { test, expect } = require('@playwright/test');
const { loadModules } = require('../helpers/test-loader');

let mods;
test.beforeAll(() => {
  mods = loadModules(['constants.js', 'utils.js', 'csv-utils.js']);
});

// ---- normalizeToRows ----
test.describe('normalizeToRows', () => {
  test('数组直接返回过滤后的对象数组', () => {
    const { normalizeToRows } = mods;
    const rows = normalizeToRows([{ a: 1 }, { a: 2 }, 'bad', null]);
    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
  });

  test('含数组值的对象提取第一个数组', () => {
    const { normalizeToRows } = mods;
    const rows = normalizeToRows({
      items: [{ name: 'A' }, { name: 'B' }],
      meta: { version: 1 },
    });
    expect(rows).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  test('普通对象展平为单行', () => {
    const { normalizeToRows } = mods;
    const rows = normalizeToRows({ name: 'Test', count: 5 });
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveProperty('name', 'Test');
    expect(rows[0]).toHaveProperty('count', 5);
  });

  test('非数组非对象返回空数组', () => {
    const { normalizeToRows } = mods;
    expect(normalizeToRows('string')).toEqual([]);
    expect(normalizeToRows(123)).toEqual([]);
    expect(normalizeToRows(null)).toEqual([]);
  });

  test('空对象返回包含单行的数组', () => {
    const { normalizeToRows } = mods;
    expect(normalizeToRows({})).toEqual([{}]);
  });

  test('对象中有嵌套对象，展平', () => {
    const { normalizeToRows } = mods;
    const rows = normalizeToRows({ user: { name: 'Alice', age: 30 } });
    expect(rows.length).toBe(1);
  });
});

// ---- flattenObject ----
test.describe('flattenObject', () => {
  test('展平嵌套对象', () => {
    const { flattenObject } = mods;
    const result = flattenObject({ a: { b: 1, c: 2 }, d: 3 });
    expect(result).toEqual({ 'a.b': 1, 'a.c': 2, d: 3 });
  });

  test('数组值 JSON 序列化', () => {
    const { flattenObject } = mods;
    const result = flattenObject({ items: [1, 2, 3] });
    expect(result).toEqual({ items: '[1,2,3]' });
  });

  test('带 prefix 参数', () => {
    const { flattenObject } = mods;
    const result = flattenObject({ x: 1, y: { z: 2 } }, 'root');
    expect(result).toEqual({ 'root.x': 1, 'root.y.z': 2 });
  });
});

// ---- csvEscape ----
test.describe('csvEscape', () => {
  test('普通字符串不转义', () => {
    const { csvEscape } = mods;
    expect(csvEscape('hello')).toBe('hello');
  });

  test('含逗号的字符串用双引号包裹', () => {
    const { csvEscape } = mods;
    expect(csvEscape('a,b')).toBe('"a,b"');
  });

  test('含双引号的字符串转义内部双引号', () => {
    const { csvEscape } = mods;
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  test('含换行的字符串用双引号包裹', () => {
    const { csvEscape } = mods;
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  test('null 和 undefined 返回空字符串', () => {
    const { csvEscape } = mods;
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });

  test('数字转换为字符串', () => {
    const { csvEscape } = mods;
    expect(csvEscape(123)).toBe('123');
  });
});

// ---- jsonToCsv ----
test.describe('jsonToCsv', () => {
  test('对象数组转为 CSV', () => {
    const { jsonToCsv } = mods;
    const result = jsonToCsv(JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]));
    const lines = result.split('\n');
    expect(lines[0]).toBe('name,age');
    expect(lines[1]).toBe('Alice,30');
    expect(lines[2]).toBe('Bob,25');
  });

  test('含包装对象的数据', () => {
    const { jsonToCsv } = mods;
    const result = jsonToCsv(JSON.stringify({
      users: [
        { name: 'Alice', age: 30 },
      ],
    }));
    const lines = result.split('\n');
    expect(lines[0]).toBe('name,age');
  });

  test('带逗号的值正确转义', () => {
    const { jsonToCsv } = mods;
    const result = jsonToCsv(JSON.stringify([
      { name: 'New York, NY', tag: 'city' },
    ]));
    expect(result).toContain('"New York, NY"');
  });

  test('空数组返回空字符串', () => {
    const { jsonToCsv } = mods;
    expect(jsonToCsv('[]')).toBe('');
  });

  test('无效 JSON 抛出错误', () => {
    const { jsonToCsv } = mods;
    expect(() => jsonToCsv('invalid')).toThrow('JSON 解析失败');
  });
});
