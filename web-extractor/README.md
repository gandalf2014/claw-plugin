# Web Data Extractor - LLM 智能网页数据提取插件

一个 Microsoft Edge / Chrome 浏览器扩展，通过**大语言模型 (LLM)** 从当前网页智能提取结构化数据，输出为 JSON 格式。

## 功能特性

- **智能数据提取**：使用 LLM（GPT-4o、Claude 3.5 等）从任意网页提取指定字段的结构化数据
- **完全可配置**：自定义 API Key、Base URL、模型名称、System Prompt
- **页面内容清洗**：自动去除 script/style/svg 等干扰标签，提取纯净文本内容
- **长度自适应**：可配置最大内容长度，避免 Token 溢出
- **Markdown 转换**：将页面 DOM 转为结构化 Markdown，保留表格、标题、链接等关键信息
- **严格的 JSON 输出**：内置 Prompt 模板确保 LLM 只输出纯 JSON
- **结果预览与导出**：在弹窗中预览 JSON，支持复制到剪贴板和下载 .json 文件
- **API 安全**：密钥存储在 chrome.storage.sync 中，不上传到任何第三方服务器

## 目录结构

```
web-extractor/
├── manifest.json          # 扩展清单文件 (Manifest V3)
├── popup.html             # 弹窗界面
├── popup.css              # 弹窗样式
├── popup.js               # 弹窗主逻辑
├── options.html           # 配置页面
├── options.css            # 配置页样式
├── options.js             # 配置页逻辑
├── content.js             # 内容脚本（页面 DOM 提取）
├── background.js          # 后台 Service Worker（LLM API 调用）
├── generate_icons.html    # 图标生成器（浏览器打开即可生成图标）
├── icons/                 # 图标目录
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 安装步骤

### 1. 生成图标

在浏览器中打开 `generate_icons.html`，自动生成并下载三个尺寸的图标文件。将下载的 `icon16.png`、`icon48.png`、`icon128.png` 放入 `icons/` 目录。

### 2. 加载扩展到浏览器

**Edge 浏览器**：
1. 打开 `edge://extensions/`
2. 开启左下角的「开发人员模式」
3. 点击「加载解压缩的扩展」
4. 选择 `web-extractor/` 目录

**Chrome 浏览器**：
1. 打开 `chrome://extensions/`
2. 开启右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `web-extractor/` 目录

### 3. 配置 API

1. 右键点击扩展图标 →「选项」，或点击弹窗右上角齿轮图标
2. 填写以下信息：
   - **API Key**：你的 LLM API 密钥
   - **Base URL**：API 端点地址
   - **模型名称**：如 `gpt-4o`、`claude-3-5-sonnet-20241022`
   - **最大页面内容长度**：建议 15,000-30,000 字符
   - **System Prompt**：可自定义，默认使用内置的数据提取 Prompt
3. 点击「保存设置」，可使用「测试连接」验证配置

## 使用方法

1. 打开目标网页（如携程酒店列表页）
2. **重要**：向下滚动页面，确保所有需要提取的数据已动态加载完成
3. 点击浏览器工具栏中的扩展图标
4. 在「提取指令」文本框中输入提取需求，例如：
   ```
   提取页面上所有酒店的名称、价格、评分、评价数量和是否包含早餐
   ```
5. 点击「开始提取」按钮（或按 Ctrl+Enter）
6. 等待 LLM 分析完成后，结果将以 JSON 格式显示
7. 点击「复制」将 JSON 复制到剪贴板，或点击「下载」保存为 .json 文件

## 快捷指令

弹窗中预设了三个快捷指令模板：
- **酒店信息**：提取酒店名称、价格、评分等
- **商品列表**：提取产品名称、价格、销量等
- **文章内容**：提取文章标题、作者、日期、摘要

## 支持的 API

扩展支持以下 API 格式：

| API 类型 | Base URL 示例 | 备注 |
|----------|--------------|------|
| OpenAI | `https://api.openai.com/v1` | 自动启用 JSON Mode |
| Anthropic Claude | `https://api.anthropic.com` | 自动适配消息格式 |
| Azure OpenAI | `https://xxx.openai.azure.com` | OpenAI 兼容格式 |
| DeepSeek | `https://api.deepseek.com/v1` | OpenAI 兼容格式 |
| Ollama (本地) | `http://localhost:11434/v1` | OpenAI 兼容格式 |
| vLLM (自部署) | `http://xxx:8000/v1` | OpenAI 兼容格式 |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容格式 |
| 其他兼容接口 | 任何 OpenAI 格式兼容的 `/chat/completions` 端点 | - |

## 测试场景

### 携程酒店列表页

1. 打开携程酒店搜索页（如 `https://hotels.ctrip.com/`）
2. 搜索目标城市和日期，进入酒店列表页
3. 向下滚动加载更多酒店数据
4. 打开扩展，输入指令：
   ```
   提取页面上所有酒店的名称、价格、评分、评价数量和是否包含早餐
   ```
5. 预期输出格式：
   ```json
   {
     "items": [
       {
         "name": "上海浦东香格里拉大酒店",
         "price": 1288,
         "rating": 4.7,
         "reviewCount": 3521,
         "hasBreakfast": true
       }
     ]
   }
   ```

## 避坑指南

### 1. 页面过长导致 Token 溢出

解决方案：
- 在设置中调整「最大页面内容长度」（默认 20,000 字符）
- 如果 LLM 提示内容过长，将该值调小至 10,000-15,000
- 插件会在句子/段落边界智能截断内容

### 2. LLM 输出不稳定

解决方案：
- 使用 `gpt-4o` 或支持 JSON Mode 的模型（扩展会自动启用 `response_format: json_object`）
- 在 System Prompt 中强调"只输出 JSON，不要任何解释"
- 扩展内置了鲁棒的 JSON 解析逻辑，会自动清理 markdown 代码块标记

### 3. 动态加载的数据提取不到

解决方案：
- 提取前确保已向下滚动页面触发懒加载
- 对于需要点击展开的内容（如"查看全部评论"），先手动展开再提取
- 弹窗中的橙色提示会在每次提取时提醒用户先滚动页面

## 技术架构

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   popup.js   │────▶│  content.js  │────▶│ background.js│
│  (弹窗界面)   │     │ (DOM 提取)   │     │ (LLM API)    │
└─────────────┘     └──────────────┘     └──────┬───────┘
       │                                        │
       │         chrome.storage.sync            │
       └───────────────┬────────────────────────┘
                       │
                 ┌─────┴──────┐
                 │ options.js  │
                 │  (设置页面)  │
                 └────────────┘
```

- **Manifest V3**：使用最新的 Chrome 扩展标准
- **Service Worker**：后台静默处理 API 请求
- **Content Script**：注入目标页面进行 DOM 提取
- **chrome.storage.sync**：跨设备同步 API 配置（密钥同步到用户 Google 账户）

## 许可证

MIT License
