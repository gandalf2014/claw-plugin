// ============================================================
// instruction-generator.js — 自动指令生成器
// ============================================================

/**
 * 根据选中元素自动生成提取指令（LLM + 规则兜底）
 * @param {string[]} elementTexts - 选中元素的文本内容数组
 * @param {boolean} [shouldAutoExtract=true] - 生成后是否自动触发提取
 * @param {string}  [existingInstruction] - 已有的提取指令，用于缩小重试时精炼
 */
async function autoGenerateInstruction(elementTexts, shouldAutoExtract, existingInstruction) {
  if (shouldAutoExtract === undefined) shouldAutoExtract = true;
  try {
    DOM.txtInstruction.value = "";
    DOM.txtInstruction.placeholder = "AI 正在根据选中元素生成提取指令...";
    DOM.txtInstruction.style.color = "#94a3b8";

    const config = await getConfig();
    if (!config.apiKey || !config.baseUrl) {
      fallbackGenerateInstruction(elementTexts, shouldAutoExtract, existingInstruction);
      return;
    }

    config.systemPrompt = [
      "你是一个专业的数据提取指令生成专家。",
      "你的任务是根据网页元素的样本内容，生成一份详尽、全面的中文数据提取指令。",
      "",
      "关键原则：",
      "1. 仔细分析每个样本元素，识别其中包含的所有信息字段",
      "2. 常见字段类型：名称/标题、价格/金额、描述/详情、评分/星级、评价数/评论数、",
      "   日期/时间、地址/位置/区域、电话/联系方式、图片链接/URL、规格/参数、",
      "   品牌/厂商、颜色、尺寸/大小/重量、折扣/优惠/活动、库存/状态、",
      "   标签/分类/类型、配送信息、服务/权益/设施、销量/热度等",
      "3. 指令必须列出所有可识别的字段，不能遗漏任何一个",
      "4. 指令格式示例：'提取页面上所有XX的[字段1]、[字段2]、[字段3]...信息'",
      "5. 只输出指令文本，不要任何解释或引号包裹",
      "6. 优先考虑完整性而非简洁性——宁可多列字段也不遗漏"
    ].join("\n");

    var samples = elementTexts.slice(0, 20);
    var elementSample = "";
    for (var i = 0; i < samples.length; i++) {
      elementSample += "- " + samples[i] + "\n";
    }
    if (elementTexts.length > 20) {
      elementSample += "... (共 " + elementTexts.length + " 个元素)\n";
    }

    var genPrompt = [
      "分析以下网页元素的样本内容，识别其中包含的所有信息字段，",
      "生成一条详细的提取指令，确保覆盖每个字段。",
      "",
      "选中元素内容：",
      elementSample
    ].join("\n");

    // 如果有已有指令（缩小重试场景），加入精炼上下文
    if (existingInstruction && existingInstruction.trim()) {
      genPrompt += "\n当前已有的提取指令（请在此基础上精炼优化）：\n" + existingInstruction.trim() + "\n\n请根据缩小后的元素内容，优化这条指令：增加新发现的字段、删除不存在字段、使描述更精确。";
    }

    const rawResult = await callLLM(config, genPrompt, "", { skipJsonFormat: true });
    var instruction = (rawResult || "").trim();

    instruction = instruction.replace(/^["'""\u201c\u201d](.*)["'""\u201c\u201d]$/, "$1").trim();

    if (instruction && instruction.length > 5) {
      DOM.txtInstruction.value = instruction;
      instructionFromStorage = false;
      if (shouldAutoExtract) {
        setStatus("AI 已根据选中元素自动生成提取指令，正在自动开始提取...", "success");
        setTimeout(function() { handleExtract(); }, 300);
      }
    } else {
      fallbackGenerateInstruction(elementTexts, shouldAutoExtract, existingInstruction);
    }
  } catch (e) {
    console.warn("Auto-generate instruction failed:", e);
    fallbackGenerateInstruction(elementTexts, shouldAutoExtract, existingInstruction);
  } finally {
    DOM.txtInstruction.placeholder = "描述你需要提取的数据，例如：\n提取页面上所有酒店的名称、价格、评分、评价数量和是否包含早餐";
    DOM.txtInstruction.style.color = "";
  }
}

/** 规则兜底：根据元素文本关键词生成指令 */
function fallbackGenerateInstruction(elementTexts, shouldAutoExtract, existingInstruction) {
  if (shouldAutoExtract === undefined) shouldAutoExtract = true;
  var allText = elementTexts.join(" ");
  var fields = [];

  // ---- 价格/金额 ----
  if (/[¥￥$€£]\s*\d|[\d.]+\s*元|[\d.]+\s*起|原价|现价|售价|单价|总价|金额/.test(allText)) fields.push("价格");

  // ---- 名称/标题 ----
  if (/[大中小双单家豪标经].*[床房间型]|房型|酒店|商品|产品|标题|品名|款式/.test(allText)) fields.push("名称");

  // ---- 评分 ----
  if (/[\d.]+分|评分|星级|好评|差评|口碑/.test(allText)) fields.push("评分");

  // ---- 评价/评论数 ----
  if (/[\d.]+条|评论|评价|点评|[\d.]+万?条评价/.test(allText)) fields.push("评价数");

  // ---- 销量/热度 ----
  if (/(已售|销量|成交|订单|热度|人气|收藏)\s*[\d.]+万?/.test(allText)) fields.push("销量");

  // ---- 日期/时间 ----
  if (/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|入住|离店|日期|时间|有效期/.test(allText)) fields.push("日期");

  // ---- 地址/位置 ----
  if (/地址|位置|区域|商圈|街道|路[\d]+号|位于|坐落/.test(allText)) fields.push("地址");

  // ---- 电话/联系方式 ----
  if (/[\d]{3,4}[- ]?[\d]{7,}|电话|手机|联系|客服/.test(allText)) fields.push("电话");

  // ---- 描述/详情 ----
  if (/描述|详情|介绍|简介|说明|特点|亮点|特色/.test(allText)) fields.push("描述");

  // ---- 图片 ----
  if (/\.(jpg|png|gif|webp|svg|jpeg)/i.test(allText) || /图片|图像|照片|img/.test(allText)) fields.push("图片链接");

  // ---- 规格/参数 ----
  if (/规格|参数|型号|容量|内存|尺寸|大小|重量|[\d.]+[gG][bB]|[\d.]+[mM][lL]|[\d.]+[kK][gG]|[\d.]+英寸/.test(allText)) fields.push("规格参数");

  // ---- 品牌/厂商 ----
  if (/品牌|厂商|制造商|出品|系列/.test(allText)) fields.push("品牌");

  // ---- 折扣/优惠 ----
  if (/\d+折|满减|优惠|折扣|促销|活动|立减|[\d.]+%off/i.test(allText)) fields.push("优惠信息");

  // ---- 库存/状态 ----
  if (/库存|有货|缺货|预售|在售|下架|仅剩|限量/.test(allText)) fields.push("库存状态");

  // ---- 标签/分类 ----
  if (/标签|分类|类目|类型|风格|属性/.test(allText)) fields.push("分类标签");

  // ---- 设施/服务 ----
  if (/设施|服务|配套|提供|包含|含早|WiFi|停车|泳池|健身房|接机/.test(allText)) fields.push("设施服务");

  // ---- 配送 ----
  if (/配送|包邮|运费|发货|物流|快递|自提/.test(allText)) fields.push("配送信息");

  // ---- 百分比/比率 ----
  if (/\d+%|利率|费率|增长率|占比/.test(allText)) fields.push("百分比");

  // ---- 兜底 ----
  if (fields.length === 0) {
    fields.push("名称");
    if (elementTexts.length > 1) fields.push("价格");
    if (elementTexts.length > 3) fields.push("描述", "详细信息");
  }

  fields = fields.filter(function(v, i, arr) { return arr.indexOf(v) === i; });

  // 如果有已有指令（缩小重试），在旧指令基础上优化
  var instruction;
  if (existingInstruction && existingInstruction.trim()) {
    instruction = existingInstruction.trim() + "（每个元素额外包含：" + fields.join("、") + "）";
  } else {
    instruction = "提取页面中被选中元素的" + fields.join("、") + "信息";
  }

  DOM.txtInstruction.value = instruction;
  instructionFromStorage = false;
  if (shouldAutoExtract) {
    setStatus("已根据元素内容自动填写提取指令，正在自动开始提取...", "info");
    setTimeout(function() { handleExtract(); }, 300);
  }
}
