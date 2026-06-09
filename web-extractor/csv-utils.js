// ============================================================
// csv-utils.js — JSON → CSV 转换
// ============================================================

/** 标准化为行数组 */
function normalizeToRows(data) {
  if (Array.isArray(data)) {
    return data.filter(function(item) { return typeof item === "object" && item !== null; });
  }
  if (typeof data === "object" && data !== null) {
    var keys = Object.keys(data);
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(data[keys[i]]) && data[keys[i]].length > 0 &&
          typeof data[keys[i]][0] === "object") {
        return data[keys[i]];
      }
    }
    return [flattenObject(data)];
  }
  return [];
}

/** 展平嵌套对象 */
function flattenObject(obj, prefix) {
  prefix = prefix || "";
  var result = {};
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = obj[k];
    var fullKey = prefix ? prefix + "." + k : k;
    if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      var flattened = flattenObject(v, fullKey);
      var fk = Object.keys(flattened);
      for (var j = 0; j < fk.length; j++) {
        result[fk[j]] = flattened[fk[j]];
      }
    } else if (Array.isArray(v)) {
      result[fullKey] = JSON.stringify(v);
    } else {
      result[fullKey] = v;
    }
  }
  return result;
}

/** CSV 字段转义 */
function csvEscape(val) {
  if (val === null || val === undefined) return "";
  var s = String(val);
  if (s.indexOf(",") >= 0 || s.indexOf("\n") >= 0 || s.indexOf('"') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** JSON 文本 → CSV 文本 */
function jsonToCsv(jsonText) {
  var data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON 解析失败，无法转换为 CSV");
  }

  var rows = normalizeToRows(data);
  if (rows.length === 0) return "";

  var columns = [];
  var colSet = {};
  for (var i = 0; i < rows.length; i++) {
    var keys = Object.keys(rows[i]);
    for (var j = 0; j < keys.length; j++) {
      if (!colSet[keys[j]]) {
        colSet[keys[j]] = true;
        columns.push(keys[j]);
      }
    }
  }

  var lines = [];
  lines.push(columns.map(function(c) { return csvEscape(c); }).join(","));
  for (var r = 0; r < rows.length; r++) {
    var line = [];
    for (var c = 0; c < columns.length; c++) {
      line.push(csvEscape(rows[r][columns[c]]));
    }
    lines.push(line.join(","));
  }
  return lines.join("\n");
}
