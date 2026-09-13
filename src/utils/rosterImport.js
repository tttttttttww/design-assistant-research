import { inflateRawSync } from 'node:zlib';
import { normalizeParticipantId, validateParticipantId } from './validators.js';

const clean = v => String(v ?? '').normalize('NFKC').trim();
const key = v => clean(v).toLowerCase().replace(/[\s_\-（）()]/g, '');

const HEADER_ALIASES = {
  participant_id: new Set(['编号','学生编号','学号','studentid','studentno','participantid','id','code','学生代码']),
  login_name: new Set(['姓名','学生姓名','名字','name','studentname','student']),
  grade: new Set(['年级','grade','年级段','学生年级']),
  condition: new Set(['condition','组别','分组','实验组','group','groupname','条件']),
};

export function normalizeGrade(value) {
  const raw = clean(value).replace(/年级$/,'');
  const map = { '6':'6','7':'7','8':'8','六':'6','七':'7','八':'8' };
  return map[raw] || '';
}

export function normalizeCondition(value) {
  const raw = clean(value);
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (upper === 'A' || upper === 'B') return upper;
  if (upper === 'UNASSIGNED' || ['未分组','待分组','未分配'].includes(raw)) return 'unassigned';
  if (['支持型AI','结构化AI','支架AI','支持型'].includes(raw)) return 'A';
  if (['自由AI','自由组','自由'].includes(raw)) return 'B';
  return '__invalid__';
}

function decodeXml(s = '') {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function parseCsv(text) {
  const sample = text.split(/\r?\n/).find(x => x.trim()) || '';
  const delimiters = [',', '\t', ';'];
  const delimiter = delimiters.sort((a,b) => sample.split(b).length - sample.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === delimiter) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function unzipEntries(buffer) {
  const EOCD = 0x06054b50, CEN = 0x02014b50, LOC = 0x04034b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw Object.assign(new Error('无法读取这个 .xlsx 文件，请另存为标准 Excel 工作簿后重试'), { status: 400 });
  const total = buffer.readUInt16LE(eocd + 10);
  let pos = buffer.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < total; n++) {
    if (buffer.readUInt32LE(pos) !== CEN) throw Object.assign(new Error('Excel 文件结构异常'), { status: 400 });
    const method = buffer.readUInt16LE(pos + 10);
    const compSize = buffer.readUInt32LE(pos + 20);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    if (buffer.readUInt32LE(localOffset) !== LOC) throw Object.assign(new Error('Excel 文件局部结构异常'), { status: 400 });
    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buffer.subarray(start, start + compSize);
    let data;
    if (method === 0) data = compressed;
    else if (method === 8) data = inflateRawSync(compressed);
    else throw Object.assign(new Error('这个 Excel 使用了暂不支持的压缩方式，请另存为 .xlsx 或 .csv'), { status: 400 });
    out.set(name, data);
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function colIndex(ref = '') {
  const m = String(ref).match(/^([A-Z]+)/i);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textTags(xml = '') {
  const parts = [];
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(xml))) parts.push(decodeXml(m[1]));
  return parts.join('');
}

function parseXlsx(buffer) {
  const zip = unzipEntries(buffer);
  const sharedXml = zip.get('xl/sharedStrings.xml')?.toString('utf8') || '';
  const shared = [];
  if (sharedXml) {
    const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = re.exec(sharedXml))) shared.push(textTags(m[1]));
  }
  const sheetNames = [...zip.keys()].filter(n => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort((a,b) => {
    const na = Number(a.match(/sheet(\d+)/i)?.[1] || 0), nb = Number(b.match(/sheet(\d+)/i)?.[1] || 0);
    return na - nb;
  });
  if (!sheetNames.length) throw Object.assign(new Error('Excel 中没有找到工作表'), { status: 400 });
  const sheetPath = sheetNames[0];
  const xml = zip.get(sheetPath).toString('utf8');
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const arr = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1], inner = cm[2];
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] || '';
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
      let value = '';
      if (type === 'inlineStr') value = textTags(inner);
      else {
        const raw = decodeXml(inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] || '');
        if (type === 's') value = shared[Number(raw)] ?? '';
        else value = raw;
      }
      arr[colIndex(ref)] = value;
    }
    rows.push(arr.map(v => v ?? ''));
  }
  return { rows, sheet_name: sheetPath.replace(/^.*\//,'').replace(/\.xml$/,'') };
}

function detectHeader(row = []) {
  const map = {};
  row.forEach((cell, index) => {
    const k = key(cell);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.has(k)) map[field] = index;
  });
  return map;
}

function looksLikeId(value) {
  const id = normalizeParticipantId(value);
  return validateParticipantId(id) && id !== 'S00';
}

function rowToObject(row, headerMap = null) {
  if (headerMap && headerMap.participant_id != null && headerMap.login_name != null) {
    return {
      participant_id: row[headerMap.participant_id], login_name: row[headerMap.login_name],
      grade: headerMap.grade == null ? '' : row[headerMap.grade],
      condition: headerMap.condition == null ? '' : row[headerMap.condition],
    };
  }
  return { participant_id: row[0], login_name: row[1], grade: row[2], condition: row[3] };
}

export function parseRosterBuffer(buffer, filename = '') {
  const lower = String(filename || '').toLowerCase();
  let matrix, sheetName;
  if (lower.endsWith('.csv')) {
    let text = buffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    matrix = parseCsv(text);
    sheetName = 'CSV';
  } else if (lower.endsWith('.xlsx')) {
    const parsed = parseXlsx(buffer);
    matrix = parsed.rows;
    sheetName = parsed.sheet_name;
  } else {
    throw Object.assign(new Error('请选择 .xlsx 或 .csv 名单文件'), { status: 400 });
  }
  const trimmed = matrix.map(r => (Array.isArray(r) ? r.map(clean) : [])).filter(r => r.some(Boolean));
  if (!trimmed.length) throw Object.assign(new Error('名单文件是空的'), { status: 400 });
  const headerMap = detectHeader(trimmed[0]);
  const hasHeader = headerMap.participant_id != null && headerMap.login_name != null;
  const dataRows = hasHeader ? trimmed.slice(1) : trimmed;
  const rows = [], seen = new Set(), duplicates = [], errors = [];
  dataRows.forEach((rawRow, index) => {
    const line = index + (hasHeader ? 2 : 1);
    const obj = rowToObject(rawRow, hasHeader ? headerMap : null);
    const participant_id = normalizeParticipantId(obj.participant_id);
    const login_name = clean(obj.login_name), gradeRaw = clean(obj.grade), conditionRaw = clean(obj.condition);
    if (!participant_id && !login_name && !gradeRaw && !conditionRaw) return;
    if (!looksLikeId(participant_id)) { errors.push({ line, participant_id: participant_id || '—', reason: '编号必须是 S01–S30' }); return; }
    if (!login_name) { errors.push({ line, participant_id, reason: '姓名为空' }); return; }
    if (seen.has(participant_id)) { duplicates.push(participant_id); errors.push({ line, participant_id, reason: '编号重复' }); return; }
    seen.add(participant_id);
    let grade = '';
    if (gradeRaw) { grade = normalizeGrade(gradeRaw); if (!grade) { errors.push({ line, participant_id, reason: `年级“${gradeRaw}”无法识别（只接受6/7/8或六/七/八年级）` }); return; } }
    let condition = '';
    if (conditionRaw) { condition = normalizeCondition(conditionRaw); if (condition === '__invalid__') { errors.push({ line, participant_id, reason: `组别“${conditionRaw}”无法识别（只接受A/B/unassigned）` }); return; } }
    rows.push({ line, participant_id, login_name, grade, condition });
  });
  const required = Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2,'0')}`);
  const found = new Set(rows.map(r => r.participant_id));
  const missing = required.filter(id => !found.has(id));
  const nameBuckets = new Map();
  for (const row of rows) {
    const nk = key(row.login_name);
    if (!nameBuckets.has(nk)) nameBuckets.set(nk, []);
    nameBuckets.get(nk).push({ participant_id: row.participant_id, login_name: row.login_name });
  }
  const duplicate_names = [...nameBuckets.values()].filter(group => group.length > 1);
  return { filename: clean(filename), sheet_name: sheetName, has_header: hasHeader, rows, errors, duplicates: [...new Set(duplicates)], duplicate_names, missing, valid_count: rows.length, ready_for_full_import: rows.length === 30 && errors.length === 0 && missing.length === 0 };
}

export function validateRosterRows(inputRows = []) {
  if (!Array.isArray(inputRows)) throw Object.assign(new Error('导入数据格式无效'), { status: 400 });
  const cleanRows = [], seen = new Set();
  for (const [index, r] of inputRows.entries()) {
    const participant_id = normalizeParticipantId(r?.participant_id), login_name = clean(r?.login_name);
    if (!looksLikeId(participant_id)) throw Object.assign(new Error(`第${index + 1}行编号无效`), { status: 400 });
    if (!login_name) throw Object.assign(new Error(`${participant_id} 姓名为空`), { status: 400 });
    if (seen.has(participant_id)) throw Object.assign(new Error(`${participant_id} 重复`), { status: 400 });
    seen.add(participant_id);
    const grade = r?.grade ? normalizeGrade(r.grade) : '';
    if (r?.grade && !grade) throw Object.assign(new Error(`${participant_id} 年级无效`), { status: 400 });
    const condition = r?.condition ? normalizeCondition(r.condition) : '';
    if (condition === '__invalid__') throw Object.assign(new Error(`${participant_id} 组别无效`), { status: 400 });
    cleanRows.push({ participant_id, login_name, grade, condition });
  }
  return cleanRows;
}
