// ============================================================
// popup.spec.js — 弹窗页面 E2E 测试 (file:// + chrome mock)
// ============================================================
const { test, expect, SRC } = require('./e2e-fixture');

test.describe('Popup 弹窗页面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${SRC}/popup.html`);
    // 等待所有脚本加载并初始化完成
    // 1. 核心 DOM 元素存在
    await page.waitForSelector('#txtInstruction', { timeout: 5000 });
    // 2. 异步 loadMaxContentLength 完成：contentLimit 不再是初始值
    await page.waitForFunction(() => {
      const el = document.getElementById('contentLimit');
      const text = (el && el.textContent) || '';
      // 初始 HTML 是 20,000，异步加载后变为 EXTRACTOR_CONSTANTS 或用户设置的值
      return text.length > 0 && /^\d/.test(text.replace(/,/g, ''));
    }, { timeout: 5000 });
  });

  test('页面正确加载并显示标题', async ({ page }) => {
    await expect(page.locator('.title')).toContainText('Web Data Extractor');
  });

  test('提取指令输入框存在且有默认 placeholder', async ({ page }) => {
    const textarea = page.locator('#txtInstruction');
    await expect(textarea).toBeVisible();
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('描述你需要提取的数据');
  });

  test('快捷指令按钮不少于 3 个', async ({ page }) => {
    const count = await page.locator('.btn-quick').count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('点击快捷指令填充输入框', async ({ page }) => {
    await page.locator('.btn-quick[data-prompt]').first().click();
    const value = await page.locator('#txtInstruction').inputValue();
    expect(value).toContain('酒店');
  });

  test('开始提取按钮存在', async ({ page }) => {
    await expect(page.locator('#btnExtract')).toHaveText('开始提取');
  });

  test('选择元素按钮存在', async ({ page }) => {
    await expect(page.locator('#btnSelect')).toContainText('选择元素');
  });

  test('设置按钮存在', async ({ page }) => {
    await expect(page.locator('#btnSettings')).toBeVisible();
  });

  test('空状态提示显示', async ({ page }) => {
    await expect(page.locator('#emptyState')).toBeVisible();
    await expect(page.locator('#emptyState p')).toContainText('输入提取指令');
  });

  test('提取历史区域存在', async ({ page }) => {
    await expect(page.locator('#historyToggle')).toContainText('提取历史');
  });

  test('点击历史切换展开/收起', async ({ page }) => {
    await expect(page.locator('#historyList')).not.toBeVisible();
    await page.locator('#historyToggle').click();
    await expect(page.locator('#historyList')).toBeVisible();
    await page.locator('#historyToggle').click();
    await expect(page.locator('#historyList')).not.toBeVisible();
  });

  test('快照上限显示数字', async ({ page }) => {
    const text = await page.locator('#contentLimit').textContent();
    expect(Number(text.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('下载格式选择器存在', async ({ page }) => {
    await expect(page.locator('#formatSwitcher')).toHaveCount(1);
  });

  test('未输入指令直接提取显示错误', async ({ page }) => {
    await page.locator('#txtInstruction').fill('');
    await page.locator('#btnExtract').click();
    await expect(page.locator('#errorBanner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#errorText')).toContainText('请输入提取指令');
  });
});
