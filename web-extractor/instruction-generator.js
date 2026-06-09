// ============================================================
// instruction-generator.js — 自动指令生成器
// ============================================================

/**
 * 根据选中元素自动生成提取指令（LLM + 规则兜底）
 */
async function autoGenerateInstruction(elementTexts) {
  try {
    DOM.txtInstruction.value = "";
    DOM.txtInstruction.placeholder = "AI 正在根据选中元素生成提取指令...";
    DOM.txtInstruction.style.color = "#94a3b8";

    const config = await getConfig();
    if (!config.apiKey || !config.baseUrl) {
      fallbackGenerateInstruction(elementTexts);
      return;
    }

    config.systemPrompt = "你是一个数据提取指令生成助手。根据用户提供的网页元素内容，生成简洁的数据提取指令。只输出指令文本。";

    var samples = elementTexts.slice(0, 20);
    var elementSample = "";
    for (var i = 0; i < samples.length; i++) {
      elementSample += "- " + samples[i] + "\n";
    }
    if (elementTexts.length > 20) {
      elementSample += "... (共 " + elementTexts.length + " 个元素)\n";
    }

    var genPrompt =
      "根据以下用户选中的网页元素内容，生成一条简洁的中文数据提取指令。" +
      "指令应描述从类似页面中要提取哪些字段（如名称、价格、评分等）。" +
      "只输出指令文本，不要解释或标点包裹。\n\n" +
      "选中元素内容：\n" + elementSample;

    const rawResult = await callLLM(config, genPrompt, "", { skipJsonFormat: true });
    var instruction = (rawResult || "").trim();

    instruction = instruction.replace(/^["'""\u201c\u201d](.*)["'""\u201c\u201d]$/, "$1").trim();

    if (instruction && instruction.length > 5) {
      DOM.txtInstruction.value = instruction;
      instructionFromStorage = false;
      setStatus("AI 已根据选中元素自动生成提取指令", "success");
      setTimeout(hideStatus, 3000);
    } else {
      fallbackGenerateInstruction(elementTexts);
    }
  } catch (e) {
    console.warn("Auto-generate instruction failed:", e);
    fallbackGenerateInstruction(elementTexts);
  } finally {
    DOM.txtInstruction.placeholder = "描述你需要提取的数据，例如：\n提取页面上所有酒店的名称、价格、评分、评价数量和是否包含早餐";
    DOM.txtInstruction.style.color = "";
  }
}

/** 规则兜底：根据元素文本关键词生成简单指令 */
function fallbackGenerateInstruction(elementTexts) {
  var allText = elementTexts.join(" ");
  var fields = [];

  if (/[¥￥$€£]\s*\d|[\d.]+\s*元|[\d.]+\s*起/.test(allText)) fields.push("价格");
  if (/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(allText)) fields.push("日期");
  if (/[\d.]+分|[\d.]+条|评分/.test(allText)) fields.push("评分");
  if (/(已售|销量|成交|订单)\s*[\d.]+万?/.test(allText)) fields.push("销量");
  if (/[大中小双单家豪标经].*[床房间型]|房型|酒店|商品|产品/.test(allText)) fields.push("名称");
  if (/\d+%/.test(allText)) fields.push("百分比");

  if (fields.length === 0) {
    fields.push("名称", "主要内容");
    if (elementTexts.length > 3) fields.push("详细信息");
  }

  fields = fields.filter(function(v, i, arr) { return arr.indexOf(v) === i; });

  var instruction = "提取页面中被选中元素的" + fields.join("、") + "信息";

  DOM.txtInstruction.value = instruction;
  instructionFromStorage = false;
  setStatus("已根据元素内容自动填写提取指令（可自行修改）", "info");
  setTimeout(hideStatus, 3000);
}
