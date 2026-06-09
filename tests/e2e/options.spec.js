// ============================================================
// options.spec.js — 设置页面 E2E 测试 (file:// + chrome mock)
// ============================================================
const { test, expect, SRC } = require('./e2e-fixture');

test.describe('Options 设置页面', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`file://${SRC}/options.html`);
    // 等待异步 loadSettings 完成：modelName 从默认值 "" 变成 "gpt-4o"
    await page.waitForFunction(() => {
      const el = document.getElementById('modelName');
      return el && el.value !== '';
    }, { timeout: 5000 });
  });

  test('页面正确加载并显示标题', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Web Data Extractor');
  });

  test('API Key 输入框存在', async ({ page }) => {
    await expect(page.locator('#apiKey')).toBeVisible();
    await expect(page.locator('#apiKey')).toHaveAttribute('type', 'password');
  });

  test('Base URL 输入框存在', async ({ page }) => {
    await expect(page.locator('#baseUrl')).toBeVisible();
  });

  test('模型名称默认值为 gpt-4o', async ({ page }) => {
    await expect(page.locator('#modelName')).toHaveValue('gpt-4o');
  });

  test('最大内容长度输入框存在', async ({ page }) => {
    await expect(page.locator('#maxContentLength')).toBeVisible();
  });

  test('System Prompt 文本框包含默认内容', async ({ page }) => {
    // options.js 会通过 chrome.storage.sync.get 加载，mock 返回空时会回退到 DEFAULT_SYSTEM_PROMPT
    await page.waitForFunction(() => {
      const el = document.getElementById('systemPrompt');
      return el && el.value && el.value.length > 0;
    }, { timeout: 5000 });
    const value = await page.locator('#systemPrompt').inputValue();
    expect(value.length).toBeGreaterThan(0);
    expect(value).toContain('data extraction');
  });

  test('保存按钮存在', async ({ page }) => {
    await expect(page.locator('#btnSave')).toHaveText('保存设置');
  });

  test('测试连接按钮存在', async ({ page }) => {
    await expect(page.locator('#btnTest')).toBeVisible();
  });

  test('切换 API Key 可见性', async ({ page }) => {
    const apiKeyInput = page.locator('#apiKey');
    const toggleBtn = page.locator('#btnToggleKey');
    await expect(apiKeyInput).toHaveAttribute('type', 'password');
    await toggleBtn.click();
    await expect(apiKeyInput).toHaveAttribute('type', 'text');
    await toggleBtn.click();
    await expect(apiKeyInput).toHaveAttribute('type', 'password');
  });

  test('重置 System Prompt 恢复默认', async ({ page }) => {
    await page.locator('#systemPrompt').fill('custom prompt');
    await page.locator('#btnResetPrompt').click();
    await expect(page.locator('#systemPrompt')).toHaveValue(/data extraction/);
  });

  test('空 API Key 保存显示错误', async ({ page }) => {
    await page.locator('#apiKey').fill('');
    await page.locator('#baseUrl').fill('https://api.openai.com/v1');
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveBanner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#saveBanner')).toContainText('请输入 API Key');
  });

  test('有效配置保存显示成功', async ({ page }) => {
    await page.locator('#apiKey').fill('sk-test-key-123');
    await page.locator('#baseUrl').fill('https://api.openai.com/v1');
    await page.locator('#btnSave').click();
    await expect(page.locator('#saveBanner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#saveBanner')).toContainText('设置已保存');
  });
});
