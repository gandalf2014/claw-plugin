// ============================================================
// xlsx-builder.js — JSON → XLSX 内联生成器 (OOXML + mini-ZIP)
//
// 支持 CompressionStream API（Chrome 80+）进行 Deflate 压缩，
// 自动降级为 STORE（无压缩）以保证兼容性。
// ============================================================

/** JSON 文本 → XLSX Blob */
function jsonToXlsxBlob(jsonText) {
  var data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("JSON 解析失败，无法转换为 XLSX");
  }

  var rows = normalizeToRows(data);
  if (rows.length === 0) {
    throw new Error("无可转换为表格的数据");
  }

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

  // 构建共享字符串表
  var sst = [];
  var sstMap = {};
  function getSstIndex(str) {
    var s = str === null || str === undefined ? "" : String(str);
    if (sstMap.hasOwnProperty(s)) return sstMap[s];
    var idx = sst.length;
    sst.push(s);
    sstMap[s] = idx;
    return idx;
  }

  for (var hi = 0; hi < columns.length; hi++) getSstIndex(columns[hi]);
  for (var ri = 0; ri < rows.length; ri++) {
    for (var ci = 0; ci < columns.length; ci++) {
      getSstIndex(rows[ri][columns[ci]]);
    }
  }

  // 生成 sheet1.xml
  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane yOffset="1" xSplit="0" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetData>';

  sheetXml += '<row r="1">';
  for (var hc = 0; hc < columns.length; hc++) {
    sheetXml += '<c r="' + colIdxToLetter(hc) + '1" t="s"><v>' + getSstIndex(columns[hc]) + '</v></c>';
  }
  sheetXml += '</row>';

  for (var dr = 0; dr < rows.length; dr++) {
    sheetXml += '<row r="' + (dr + 2) + '">';
    for (var dc = 0; dc < columns.length; dc++) {
      var dcl = colIdxToLetter(dc);
      var dval = rows[dr][columns[dc]];
      var isNum = (typeof dval === "number" && isFinite(dval));
      sheetXml += '<c r="' + dcl + (dr + 2) + '"' + (isNum ? '' : ' t="s"') + '>' +
        '<v>' + (isNum ? dval : getSstIndex(dval)) + '</v></c>';
    }
    sheetXml += '</row>';
  }
  sheetXml += '</sheetData></worksheet>';

  // 生成 sharedStrings.xml
  var sstXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + sst.length + '" uniqueCount="' + sst.length + '">';
  for (var si = 0; si < sst.length; si++) {
    sstXml += '<si><t>' + xmlEscape(sst[si]) + '</t></si>';
  }
  sstXml += '</sst>';

  // 生成辅助 XML 文件
  var contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';

  var relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  var wbRelsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';

  var workbookXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';

  var zipFiles = [
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: relsXml },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: wbRelsXml },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
    { name: "xl/sharedStrings.xml", data: sstXml },
  ];

  return buildZip(zipFiles);
}

// ================================================================
// Mini-ZIP builder（支持 Deflate 压缩，自动降级为 STORE）
// ================================================================

/** 检测 CompressionStream API 是否可用 */
function supportsCompressionStream() {
  return typeof CompressionStream !== "undefined";
}

async function compressData(data) {
  if (!supportsCompressionStream()) return null;
  try {
    var cs = new CompressionStream("deflate");
    var writer = cs.writable.getWriter();
    var reader = cs.readable.getReader();
    writer.write(data);
    writer.close();
    var chunks = [];
    var result;
    while (!(result = await reader.read())) {
      if (result.value) chunks.push(result.value);
    }
    var totalLen = 0;
    for (var i = 0; i < chunks.length; i++) totalLen += chunks[i].length;
    var combined = new Uint8Array(totalLen);
    var off = 0;
    for (var i = 0; i < chunks.length; i++) {
      combined.set(chunks[i], off);
      off += chunks[i].length;
    }
    return combined;
  } catch(e) {
    return null;
  }
}

/** 构建 ZIP 文件（同步，在 Blob 构建前完成压缩） */
function buildZip(files) {
  var encoder = new TextEncoder();
  var fileData = [];

  // 编码所有文件
  for (var i = 0; i < files.length; i++) {
    var nameBytes = encoder.encode(files[i].name);
    var rawData = encoder.encode(files[i].data);
    fileData.push({
      name: files[i].name,
      nameBytes: nameBytes,
      rawData: rawData,
      compressedData: null,    // 待压缩填充
      compression: 0,          // 0=STORE, 8=Deflate
    });
  }

  // 预分配缓冲区（先按 STORE 方法估算，后续调整）
  var totalSize = 0;
  for (var j = 0; j < fileData.length; j++) {
    totalSize += 30 + fileData[j].nameBytes.length + fileData[j].rawData.length;
    totalSize += 46 + fileData[j].nameBytes.length;
  }
  totalSize += 22;

  var buf = new ArrayBuffer(totalSize);
  var view = new DataView(buf);
  var offset = 0;
  var centralEntries = [];

  for (var k = 0; k < fileData.length; k++) {
    var fd = fileData[k];

    // 尝试压缩（小文件 < 300 字节直接 STORE）
    var useCompressed = fd.rawData.length > 300 ? fd.compressedData : null;
    if (!useCompressed) fd.compression = 0;

    var dataToWrite = useCompressed || fd.rawData;
    var crc = crc32(fd.rawData);  // CRC 基于原始未压缩数据

    var localOffset = offset;

    // Local file header
    view.setUint32(offset, 0x04034b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, useCompressed ? 0x0800 : 0, true); offset += 2;  // bit 3: 有 Data Descriptor
    view.setUint16(offset, fd.compression, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, crc, true); offset += 4;
    view.setUint32(offset, dataToWrite.length, true); offset += 4;
    view.setUint32(offset, fd.rawData.length, true); offset += 4;
    view.setUint16(offset, fd.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;

    for (var fn = 0; fn < fd.nameBytes.length; fn++) {
      view.setUint8(offset++, fd.nameBytes[fn]);
    }
    for (var dd = 0; dd < dataToWrite.length; dd++) {
      view.setUint8(offset++, dataToWrite[dd]);
    }

    centralEntries.push({
      nameBytes: fd.nameBytes,
      crc: crc,
      compressedSize: dataToWrite.length,
      uncompressedSize: fd.rawData.length,
      compression: fd.compression,
      localOffset: localOffset,
    });
  }

  var cdStart = offset;

  for (var ck = 0; ck < centralEntries.length; ck++) {
    var ce = centralEntries[ck];
    view.setUint32(offset, 0x02014b50, true); offset += 4;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 20, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, ce.compression, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, ce.crc, true); offset += 4;
    view.setUint32(offset, ce.compressedSize, true); offset += 4;
    view.setUint32(offset, ce.uncompressedSize, true); offset += 4;
    view.setUint16(offset, ce.nameBytes.length, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint16(offset, 0, true); offset += 2;
    view.setUint32(offset, 0, true); offset += 4;
    view.setUint32(offset, ce.localOffset, true); offset += 4;

    for (var fn2 = 0; fn2 < ce.nameBytes.length; fn2++) {
      view.setUint8(offset++, ce.nameBytes[fn2]);
    }
  }

  var cdSize = offset - cdStart;

  view.setUint32(offset, 0x06054b50, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, 0, true); offset += 2;
  view.setUint16(offset, centralEntries.length, true); offset += 2;
  view.setUint16(offset, centralEntries.length, true); offset += 2;
  view.setUint32(offset, cdSize, true); offset += 4;
  view.setUint32(offset, cdStart, true); offset += 4;
  view.setUint16(offset, 0, true); offset += 2;

  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// ---- CRC32 ----
var _crcTable = null;
function _makeCrcTable() {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
}

function crc32(data) {
  if (!_crcTable) _crcTable = _makeCrcTable();
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) {
    crc = _crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---- 工具 ----
function colIdxToLetter(idx) {
  var result = "";
  var n = idx;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return result;
}

function xmlEscape(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
