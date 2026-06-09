// ============================================================
// constants.js — 全局配置常量
// 将所有 Magic Number 集中管理，便于调整和维护
// ============================================================

const EXTRACTOR_CONSTANTS = {
  // ---- 动态内容等待 ----
  WAIT_TIMEOUT_MS: 15000,         // 动态内容等待最大超时（毫秒）
  POLL_INTERVAL_MS: 400,          // DOM 轮询间隔（毫秒）
  STABLE_COUNT_THRESHOLD: 5,      // 内容稳定所需的连续不变次数

  // ---- 快照/内容提取 ----
  DEFAULT_MAX_CONTENT_LENGTH: 50000,  // 默认页面内容长度上限
  MIN_SNAPSHOT_LENGTH: 5000,          // 快照最小保留空间
  SNAPSHOT_MAX_DEPTH: 12,             // 快照树遍历最大深度
  METADATA_RESERVED: 200,             // 元数据预留空间

  // ---- SSR 数据提取 ----
  SSR_MAX_DEPTH_NEXT: 8,           // Next.js 数据最大深度
  SSR_MAX_DEPTH_NFES: 6,           // NFES 数据最大深度
  SSR_MAX_DEPTH_JSONLD: 5,         // JSON-LD 数据最大深度
  SSR_MAX_DEPTH_NUXT: 5,           // Nuxt 数据最大深度
  YAML_MAX_STRING_LEN: 300,        // YAML 字符串值最大长度
  YAML_MAX_ARRAY_ITEMS: 50,        // YAML 数组最大展开项数
  YAML_MAX_OBJ_KEYS: 30,           // YAML 对象最大展开键数
  YAML_SIMPLE_ARRAY_LIMIT: 20,     // 简单数组一行展示上限

  // ---- 扁平数据列表 ----
  FLAT_DATA_MAX_ITEMS: 40,         // 扁平数据列表最大条目数
  FLAT_DATA_MIN_TEXT_LEN: 8,       // 候选文本最小长度
  FLAT_DATA_MAX_TEXT_LEN: 300,     // 候选文本最大长度
  LABEL_SEARCH_MAX_SIBLINGS: 3,    // 标签搜索最大兄弟元素数

  // ---- 字符串截断 ----
  TEXT_ESCAPE_LIMIT: 200,          // 默认转义字符串最大长度
  TEXT_ESCAPE_LIMIT_INJECT: 800,   // 注入版转义字符串最大长度
  INJECT_TEXT_ESCAPE_SHORT: 500,   // 注入版短转义字符串最大长度
  HREF_MAX_LENGTH: 500,            // 链接 href 最大长度
  SAMPLE_TEXT_MAX_LENGTH: 300,     // 元素文本采样最大长度

  // ---- 快速内容检查 ----
  QUICK_CHECK_SCORE_SSR: 2,        // SSR 数据检测得分
  QUICK_CHECK_SCORE_PRICE: 2,      // 价格文本检测得分
  QUICK_CHECK_SCORE_DENSE: 1,      // 密集文本检测得分
  QUICK_CHECK_SCORE_KEYDATA: 1,    // 关键数据元素检测得分
  QUICK_CHECK_SCORE_BODYTEXT: 1,   // Body 文本检测得分
  QUICK_CHECK_SCORE_SELECTOR: 3,   // 列表选择器检测得分
  QUICK_CHECK_READY_THRESHOLD: 5,  // 就绪所需最低得分
  QUICK_CHECK_MIN_TEXT_BLOCKS: 15, // 最少文本块数
  QUICK_CHECK_MIN_DENSE_BLOCKS: 5, // 最少密集文本块数
  QUICK_CHECK_MIN_BODY_TEXT: 500,  // Body 最少可见文本

  // ---- LLM API ----
  LLM_MAX_TOKENS: 16384,           // LLM 最大输出 token 数
  LLM_TEMPERATURE: 0.1,            // LLM 生成温度
  LLM_DEFAULT_MODEL: "gpt-4o",     // 默认模型名称

  // ---- 历史记录 ----
  MAX_HISTORY_ITEMS: 50,           // 最大历史记录条数

  // ---- UI ----
  STATUS_AUTO_HIDE_MS: 3000,       // 状态栏自动隐藏时间（毫秒）
  FEEDBACK_AUTO_HIDE_MS: 2000,     // 反馈按钮恢复时间（毫秒）
  FLASH_DURATION_MS: 400,          // 元素闪烁高亮持续时间

  // ---- 存储 ----
  MIN_CONTENT_LENGTH: 500,         // 最小内容长度（设置校验）

  // ---- 区域检测 ----
  AREA_MAX_DEPTH: 10,              // 区域检测最大递归深度
  AREA_MAX_COUNT: 30,              // 最多检测区域数
  AREA_MIN_CHILDREN: 2,            // 容器最少子元素数
  AREA_MIN_CHILDREN_SECTION: 5,    // 区域最少子元素数
  AREA_MIN_TEXT_SECTION: 50,       // 区域最少文本长度（含多子元素时）
  AREA_MIN_TEXT_CONTAINER: 100,    // 容器最少文本长度
  AREA_MIN_PREVIEW: 5,             // 区域最少预览文本长度
  AREA_MIN_TEXT_CONTENT: 200,      // 文本内容型区域最少长度
  AREA_NAV_CHILD_COUNT: 15,        // 导航菜单最少子元素数
  AREA_NAV_AVG_TEXT: 10,           // 导航菜单平均文本上限
  AREA_AREA_DISPLAY_THRESHOLD: 1000000, // 显示面积 M 级阈值
  AREA_AREA_DISPLAY_THRESHOLD_K: 1000,  // 显示面积 K 级阈值
};

// 选择模式常量（同时用于 content.js / popup.js 注入）
const SEL_CONSTANTS = {
  ATTR: "data-we-selected",
  STYLE_ID: "we-extractor-selection-style",
  TOOLBAR_ID: "we-extractor-toolbar",
};

// 可访问性树快照常量
const SNAPSHOT_CONSTANTS = {
  LANDMARK: {
    header: "banner", main: "main", nav: "navigation",
    footer: "contentinfo", aside: "complementary", form: "form"
  },
  SKIP_TAGS: {
    script: 1, style: 1, svg: 1, noscript: 1, iframe: 1,
    canvas: 1, video: 1, audio: 1, template: 1,
    link: 1, meta: 1, br: 1, hr: 1, wbr: 1
  },
  LEAF_TAGS: {
    button: 1, input: 1, textarea: 1, select: 1, img: 1, label: 1
  }
};
