// ============================================================
// xlsx-builder.js — JSON → XLSX 内联生成器 (OOXML + mini-ZIP)
//
// 支持 CompressionStream API（Chrome 80+）进行 Deflate 压缩，
// 自动降级为 STORE（无压缩）以保证兼容性。
// ============================================================

/** JSON 文本 → XLSX Blob（异步，支持压缩） */
async function jsonToXlsxBlob(jsonText) {
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

  return await buildZip(zipFiles);
}

// ================================================================
// Mini-ZIP builder（支持 Deflate 压缩，自动降级为 STORE）
// ================================================================

/** 检测 CompressionStream API 是否可用 */
function supportsCompressionStream() {
  return typeof CompressionStream !== "undefined";
}

/** 压缩数据（异步），失败或不可用时返回 null */
async function compressData(data) {
  if (!supportsCompressionStream()) return null;
  try {
    var cs = new CompressionStream("deflate");
    var writer = cs.writable.getWriter();
    var reader = cs.readable.getReader();
    writer.write(data);
    writer.close();
    var chunks = [];
    while (true) {
      var result = await reader.read();
      if (result.done) break;
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

/** 将多个 Uint8Array 合并为一个 */
function concatByteArrays(arrays) {
  var totalLen = 0;
  for (var i = 0; i < arrays.length; i++) totalLen += arrays[i].length;
  var result = new Uint8Array(totalLen);
  var off = 0;
  for (var i = 0; i < arrays.length; i++) {
    result.set(arrays[i], off);
    off += arrays[i].length;
  }
  return result;
}

/** 构建 ZIP 文件（异步，支持 Deflate 压缩） */
async function buildZip(files) {
  var encoder = new TextEncoder();
  var fileData = [];

  // 编码所有文件并并发压缩
  for (var i = 0; i < files.length; i++) {
    var nameBytes = encoder.encode(files[i].name);
    var rawData = encoder.encode(files[i].data);
    fileData.push({
      name: files[i].name,
      nameBytes: nameBytes,
      rawData: rawData,
      compressedData: null,
      compression: 0,          // 0=STORE, 8=Deflate
    });
  }

  // 异步压缩大文件（并行）
  var compressPromises = [];
  for (var j = 0; j < fileData.length; j++) {
    if (fileData[j].rawData.length > 300) {
      compressPromises.push(
        compressData(fileData[j].rawData).then(function(fd, comp) {
          return function(cdata) { fd.compressedData = cdata; };
        }(fileData[j]))
      );
    }
  }

  if (compressPromises.length > 0) {
    try {
      await Promise.all(compressPromises);
    } catch(e) {
      // 压缩失败时静默降级
    }
  }

  // 确定每个文件的压缩状态并计算压缩版本
  for (var k = 0; k < fileData.length; k++) {
    var fd = fileData[k];
    // 只有压缩后确实变小了才使用压缩版本
    if (fd.compressedData && fd.compressedData.length < fd.rawData.length) {
      fd.compression = 8;
    } else {
      fd.compressedData = null;
      fd.compression = 0;
    }
  }

  // 构建 ZIP 分段（使用动态数组避免预分配缓冲区问题）
  var parts = [];
  var centralEntries = [];
  var localOffsets = [];

  for (var m = 0; m < fileData.length; m++) {
    var fd = fileData[m];
    var useCompressed = fd.compression === 8 ? fd.compressedData : null;
    var dataToWrite = useCompressed || fd.rawData;
    var crc = crc32(fd.rawData);

    // 计算本次写入前的偏移量
    var localOffset = 0;
    for (var pi = 0; pi < parts.length; pi++) localOffset += parts[pi].length;
    localOffsets.push(localOffset);

    // 构建 Local File Header
    var lfh = new ArrayBuffer(30 + fd.nameBytes.length);
    var lfhView = new DataView(lfh);
    var lfhOff = 0;
    lfhView.setUint32(lfhOff, 0x04034b50, true); lfhOff += 4;
    lfhView.setUint16(lfhOff, 20, true); lfhOff += 2;
    lfhView.setUint16(lfhOff, useCompressed ? 0x0800 : 0, true); lfhOff += 2;
    lfhView.setUint16(lfhOff, fd.compression, true); lfhOff += 2;
    lfhView.setUint16(lfhOff, 0, true); lfhOff += 2;
    lfhView.setUint16(lfhOff, 0, true); lfhOff += 2;
    lfhView.setUint32(lfhOff, crc, true); lfhOff += 4;
    lfhView.setUint32(lfhOff, dataToWrite.length, true); lfhOff += 4;
    lfhView.setUint32(lfhOff, fd.rawData.length, true); lfhOff += 4;
    lfhView.setUint16(lfhOff, fd.nameBytes.length, true); lfhOff += 2;
    lfhView.setUint16(lfhOff, 0, true); lfhOff += 2;
    for (var fn = 0; fn < fd.nameBytes.length; fn++) {
      lfhView.setUint8(lfhOff++, fd.nameBytes[fn]);
    }
    parts.push(new Uint8Array(lfh));
    parts.push(dataToWrite);

    centralEntries.push({
      nameBytes: fd.nameBytes,
      crc: crc,
      compressedSize: dataToWrite.length,
      uncompressedSize: fd.rawData.length,
      compression: fd.compression,
      localOffset: localOffset,
    });
  }

  // 构建 Central Directory
  var cdParts = [];
  for (var ck = 0; ck < centralEntries.length; ck++) {
    var ce = centralEntries[ck];
    var cd = new ArrayBuffer(46 + ce.nameBytes.length);
    var cdView = new DataView(cd);
    var cdOff = 0;
    cdView.setUint32(cdOff, 0x02014b50, true); cdOff += 4;
    cdView.setUint16(cdOff, 20, true); cdOff += 2;
    cdView.setUint16(cdOff, 20, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint16(cdOff, ce.compression, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint32(cdOff, ce.crc, true); cdOff += 4;
    cdView.setUint32(cdOff, ce.compressedSize, true); cdOff += 4;
    cdView.setUint32(cdOff, ce.uncompressedSize, true); cdOff += 4;
    cdView.setUint16(cdOff, ce.nameBytes.length, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint16(cdOff, 0, true); cdOff += 2;
    cdView.setUint32(cdOff, 0, true); cdOff += 4;
    cdView.setUint32(cdOff, ce.localOffset, true); cdOff += 4;
    for (var fn2 = 0; fn2 < ce.nameBytes.length; fn2++) {
      cdView.setUint8(cdOff++, ce.nameBytes[fn2]);
    }
    cdParts.push(new Uint8Array(cd));
  }

  var cdAll = concatByteArrays(cdParts);
  var cdStart = 0;
  for (var pi2 = 0; pi2 < parts.length; pi2++) cdStart += parts[pi2].length;

  // End of Central Directory Record
  var eocd = new ArrayBuffer(22);
  var eocdView = new DataView(eocd);
  var eocdOff = 0;
  eocdView.setUint32(eocdOff, 0x06054b50, true); eocdOff += 4;
  eocdView.setUint16(eocdOff, 0, true); eocdOff += 2;
  eocdView.setUint16(eocdOff, 0, true); eocdOff += 2;
  eocdView.setUint16(eocdOff, centralEntries.length, true); eocdOff += 2;
  eocdView.setUint16(eocdOff, centralEntries.length, true); eocdOff += 2;
  eocdView.setUint32(eocdOff, cdAll.length, true); eocdOff += 4;
  eocdView.setUint32(eocdOff, cdStart, true); eocdOff += 4;
  eocdView.setUint16(eocdOff, 0, true); eocdOff += 2;

  // 合并所有部分
  var allParts = parts.concat([cdAll, new Uint8Array(eocd)]);
  var finalBuf = concatByteArrays(allParts);

  return new Blob([finalBuf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
