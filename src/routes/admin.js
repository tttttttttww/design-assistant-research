import express from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'node:crypto';
import * as XLSX from 'xlsx';
import { requireAdmin } from '../middleware/auth.js';
import { storageService } from '../services/storageService.js';
import { researchService } from '../services/researchService.js';
import { SESSIONS, QUESTIONNAIRE_ITEMS, QUESTIONNAIRE_META, QUESTIONNAIRE_VERSION, PROTECTED_SESSION_IDS } from '../config/researchConfig.js';
import { normalizeParticipantId, validateParticipantId, isTestParticipant } from '../utils/validators.js';
import { parseRosterBuffer, validateRosterRows } from '../utils/rosterImport.js';

const router = express.Router();
const csv = v => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvText = (headers, rows) => '\uFEFF' + [
  headers.join(','),
  ...rows.map(r => headers.map(h => csv(r[h])).join(',')),
].join('\n');
const sendJson = (res, name, data) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${name}`);
  res.send(JSON.stringify(data, null, 2));
};
const sendCsv = (res, name, headers, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=${name}`);
  res.send(csvText(headers, rows));
};
const safeName = value => String(value || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_');
const pad = n => String(n || 0).padStart(5, '0');
const formalIds = () => Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
const TEST_IDS = ['S00','S99'];
const FORCED_CONTROL_IDS = new Set(['S04','S05']);
const shuffle = arr => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

async function stratifiedRandomizeRostered({ force = false, reason = 'manual' } = {}) {
  const participants = [];
  for (const id of formalIds()) participants.push(await researchService.getParticipant(id));
  const enrolled = participants.filter(p => Boolean(p.login_name_hash));
  if (!enrolled.length) throw Object.assign(new Error('还没有已录入姓名的正式学生，无法随机分组。'), { status: 400 });

  const missing = enrolled.filter(p => !['6','7','8'].includes(String(p.grade || '').trim())).map(p => p.participant_id);
  if (missing.length) throw Object.assign(new Error(`以下已录入学生缺少6/7/8年级信息：${missing.join(', ')}`), { status: 400 });

  // S04/S05按当前研究安排固定为对照组；其余学生仅提供“可选”的年级分层随机初始分组。
  // 平台不再强制30人必须15/15，也不会在切换课次时自动分组；教师可在后台逐个调整。
  const forced = enrolled.filter(p => FORCED_CONTROL_IDS.has(p.participant_id));
  for (const p of forced) {
    if (p.condition !== 'B') await researchService.setParticipantMeta(p.participant_id, { condition:'B' });
    p.condition = 'B';
  }
  const randomizable = enrolled.filter(p => !FORCED_CONTROL_IDS.has(p.participant_id));
  const alreadyRandomizable = randomizable.filter(p => ['A','B'].includes(p.condition));
  const allAssigned = enrolled.every(p => ['A','B'].includes(p.condition));
  if (allAssigned && !force) {
    const preW4Snapshot = await researchService.createProtectedPreW4Snapshot();
    return {
      method:'existing_manual_or_prior_assignment', already_assigned:true, reason,
      fixed_control_ids:forced.map(p=>p.participant_id),
      totals:{ A: enrolled.filter(p=>p.condition==='A').length, B: enrolled.filter(p=>p.condition==='B').length },
      assignments: enrolled.map(p=>({participant_id:p.participant_id,grade:p.grade,condition:p.condition,fixed:FORCED_CONTROL_IDS.has(p.participant_id)})),
      pre_w4_snapshot:preW4Snapshot,
    };
  }
  if (alreadyRandomizable.length && !force) {
    throw Object.assign(new Error('已有部分学生被手动设置为A/B。为避免覆盖现有分组，平台没有重新随机；请继续手动调整，或明确选择强制重分。'), { status: 409 });
  }

  const preW4Snapshot = await researchService.createProtectedPreW4Snapshot();
  const assignments = forced.map(p=>({participant_id:p.participant_id,grade:p.grade,condition:'B',fixed:true}));
  let totalA = 0, totalB = forced.length;

  for (const grade of ['6','7','8']) {
    const allInGrade = enrolled.filter(p => String(p.grade) === grade);
    const ids = shuffle(allInGrade.filter(p => !FORCED_CONTROL_IDS.has(p.participant_id)).map(p => p.participant_id));
    const fixedBCount = allInGrade.filter(p => FORCED_CONTROL_IDS.has(p.participant_id)).length;
    // 每个年级尽量接近一半，但不追求全体固定15/15；固定B已计入该年级对照人数。
    const desiredA = Math.max(0, Math.min(ids.length, Math.round(allInGrade.length / 2)));
    for (let i=0; i<ids.length; i++) {
      const condition = i < desiredA ? 'A' : 'B';
      await researchService.setParticipantMeta(ids[i], { condition });
      if (condition === 'A') totalA += 1; else totalB += 1;
      assignments.push({ participant_id:ids[i], grade, condition, fixed:false });
    }
  }

  const result = {
    method:'optional_stratified_randomization_by_grade_with_fixed_control',
    created_at:new Date().toISOString(), reason,
    fixed_control_ids:forced.map(p=>p.participant_id),
    totals:{A:totalA,B:totalB}, assignments,
    pre_w4_snapshot:preW4Snapshot,
    note:'Optional initial stratified randomization only; no forced global 15/15 target. Teacher may adjust individual assignments before W4.',
  };
  await storageService.putObject(`group-assignments/${result.created_at.replace(/[:.]/g,'-')}.json`, JSON.stringify(result,null,2));
  return result;
}
const setWidths = (ws, widths) => { ws['!cols'] = widths.map(w => ({ wch: w })); return ws; };

const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok = /\.(xlsx|csv)$/.test(name) || [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      'text/plain',
    ].includes(file.mimetype);
    cb(null, ok);
  },
});

function openZip(res, fileName) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', err => console.warn('zip warning', err));
  archive.on('error', err => {
    console.error('zip error', err);
    if (!res.headersSent) res.status(500).json({ error: '导出压缩包失败' });
    else res.destroy(err);
  });
  archive.pipe(res);
  return archive;
}

router.post('/login', async (req, res) => {
  try {
    const password = String(req.body?.password || '');
    if (!process.env.ADMIN_PASSWORD) return res.status(500).json({ error: '服务器未配置 ADMIN_PASSWORD' });
    if (password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ error: '密码错误，请重新输入。' });
    const id = `admin_${uuidv4().replace(/-/g, '')}`;
    await storageService.putObject(`admin-sessions/${id}.json`, JSON.stringify({
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 4 * 3600000).toISOString(),
    }));
    res.cookie('admin_session', id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 4 * 3600000,
      path: '/',
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: '管理员登录服务异常' });
  }
});

router.post('/logout', requireAdmin, async (req, res) => {
  if (req.cookies?.admin_session) await storageService.deleteObject(`admin-sessions/${req.cookies.admin_session}.json`);
  res.clearCookie('admin_session', { path: '/' });
  res.json({ success: true });
});

router.get('/settings', requireAdmin, async (req, res) => res.json({ ...(await researchService.getSettings()), sessions: SESSIONS }));
router.post('/settings', requireAdmin, async (req, res) => {
  try {
    const input = req.body || {};
    // 切换课次不自动分组。正式W4前由教师确认分组；S04/S05仍固定B。
    // 进入W4时自动创建一次W1/W2/W3只读安全快照（若已存在则复用），确保早期真实记录不会因后续更新丢失。
    let preW4Snapshot = null;
    if (String(input.active_session_id || '').toUpperCase() === 'W4') preW4Snapshot = await researchService.createProtectedPreW4Snapshot();
    const settings = await researchService.saveSettings(input);
    res.json({ ...settings, auto_randomization: null, pre_w4_snapshot: preW4Snapshot });
  }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

async function ensureDefaultStudents() {
  for (let i = 1; i <= 30; i++) await researchService.createParticipant(`S${String(i).padStart(2, '0')}`, {});
}
async function allIds(includeTest = true) {
  const ids = formalIds();
  if (includeTest) ids.unshift(...TEST_IDS);
  return ids;
}
function liveStatusFrom(record = {}, chat = null, draft = null) {
  const draftAge = draft?.at ? Date.now() - Date.parse(draft.at) : Infinity;
  let liveStatus = 'not_started';
  if (record?.submitted_at) liveStatus = 'submitted';
  else if (chat?.processing) liveStatus = 'processing';
  else if (draft?.type === 'ai_draft_started' && draftAge < 120000) liveStatus = 'typing';
  else if (draft?.type === 'ai_draft_deleted_unsent' && draftAge < 20000) liveStatus = 'draft_cancelled';
  else if (draft?.type === 'ai_draft_left_unsent' && draftAge < 20000) liveStatus = 'draft_left';
  else if (chat?.last_error_at && (!chat?.last_response_at || Date.parse(chat.last_error_at) > Date.parse(chat.last_response_at))) liveStatus = 'error';
  else if ((chat?.assistant_turn_count || 0) > 0) liveStatus = 'replied';
  else if (record?.ai_open_count > 0) liveStatus = 'ai_open';
  else if (record?.started_at) liveStatus = 'working';
  return liveStatus;
}

async function summary(id, activeSessionId = '') {
  const p = await researchService.getParticipant(id);
  const sid = activeSessionId || (await researchService.getSettings()).active_session_id;
  const [r, c, live] = await Promise.all([
    researchService.getSessionRecord(id, sid),
    researchService.getChatSession(id, sid),
    researchService.getLiveTrace(id, sid),
  ]);
  return {
    participant_id: id,
    condition: p.condition,
    grade: p.grade,
    login_name_ready: Boolean(p.login_name_hash),
    is_test: p.is_test,
    condition_fixed: Boolean(p.condition_fixed),
    condition_fixed_reason: p.condition_fixed_reason || '',
    active_session_id: sid,
    started: Boolean(r.started_at),
    ai_used: Boolean(r.ai_used),
    first_ai_open_latency_seconds: r.first_ai_open_latency_seconds,
    first_user_message_latency_seconds: r.first_user_message_latency_seconds,
    user_turn_count: c?.user_turn_count || 0,
    assistant_turn_count: c?.assistant_turn_count || 0,
    chat_image_count: Number(c?.chat_image_count || 0),
    artifact_count: Object.keys(r.artifacts || {}).length,
    submitted: Boolean(r.submitted_at),
    last_active_at: c?.last_student_message_at || p.last_active_at,
    live_status: liveStatusFrom(r, c, live),
    processing: Boolean(c?.processing),
    processing_started_at: c?.processing_started_at || '',
    last_response_at: c?.last_response_at || '',
    last_error_at: c?.last_error_at || '',
    task_field_label: c?.last_task_field_label || live?.task_field_label || '',
    task_field_stage: c?.last_task_field_stage || live?.task_field_stage || '',
    last_student_message_preview: c?.last_student_message_preview || '',
    live_draft_state: live || null,
  };
}

router.get('/participants', requireAdmin, async (req, res) => {
  try {
    const settings = await researchService.getSettings();
    const ids = await allIds(true);
    const rows=[];
    for(let i=0;i<ids.length;i+=4){
      const batch=await Promise.allSettled(ids.slice(i,i+4).map(id=>summary(id,settings.active_session_id)));
      if(batch.some(x=>x.status==='rejected')){
        return res.status(503).json({error:'部分学生的云端记录读取失败。后台不会用0轮替代读取失败的数据；请前往只读存储检查。'});
      }
      rows.push(...batch.map(x=>x.value));
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取学生列表失败' });
  }
});

// 实时监看只读“课次记录 + chat session”，不反复读取31名学生的全部消息历史。
router.get('/live-statuses', requireAdmin, async (req, res) => {
  try {
    const settings = await researchService.getSettings();
    const sid = settings.active_session_id;
    const ids = await allIds(true);
    const rows = [];
    let failedCount=0;
    for(let i=0;i<ids.length;i+=4){
      const batch=await Promise.all(ids.slice(i,i+4).map(async id => {
        try{
      const [r, c, live] = await Promise.all([
        researchService.getSessionRecord(id, sid),
        researchService.getChatSession(id, sid),
        researchService.getLiveTrace(id, sid),
      ]);
      return {
        participant_id: id,
        active_session_id: sid,
        started: Boolean(r.started_at),
        ai_used: Boolean(r.ai_used),
        first_ai_open_latency_seconds: r.first_ai_open_latency_seconds,
        first_user_message_latency_seconds: r.first_user_message_latency_seconds,
        user_turn_count: c?.user_turn_count || 0,
        assistant_turn_count: c?.assistant_turn_count || 0,
        submitted: Boolean(r.submitted_at),
        live_status: liveStatusFrom(r, c, live),
        processing: Boolean(c?.processing),
        processing_started_at: c?.processing_started_at || '',
        last_response_at: c?.last_response_at || '',
        last_error_at: c?.last_error_at || '',
        task_field_label: c?.last_task_field_label || live?.task_field_label || '',
        task_field_stage: c?.last_task_field_stage || live?.task_field_stage || '',
        last_student_message_preview: c?.last_student_message_preview || '',
        live_draft_state: live || null,
      };
        }catch(err){
          failedCount++;
          return {participant_id:id,active_session_id:sid,live_status:'read_error',read_error:true,user_turn_count:null,assistant_turn_count:null};
        }
      }));
      rows.push(...batch);
    }
    res.json({session_id:sid,rows,partial:failedCount>0,failed_count:failedCount,server_time:new Date().toISOString()});
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取实时状态失败' });
  }
});
router.post('/participants/create-default', requireAdmin, async (req, res) => {
  await ensureDefaultStudents();
  res.json({ created_or_checked: 30 });
});


// Excel / CSV roster preview. The uploaded file is parsed only in memory and is never saved.
router.post('/participants/roster-preview', requireAdmin, rosterUpload.single('roster'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择 .xlsx 或 .csv 名单文件' });
    const preview = parseRosterBuffer(req.file.buffer, req.file.originalname);
    res.json(preview);
  } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '名单文件不能超过 3MB' });
    res.status(e.status || 400).json({ error: e.message || '名单文件读取失败' });
  }
});

// Confirm roster import. Plain-text names exist only in this HTTPS request and are immediately hashed.
router.post('/participants/roster-import', requireAdmin, async (req, res) => {
  try {
    const cleanRows = validateRosterRows(req.body?.rows || []);
    if (!cleanRows.length) return res.status(400).json({ error: '没有可导入的学生记录' });
    const result = [];
    for (const row of cleanRows) {
      const meta = { login_name: row.login_name };
      if (row.grade) meta.grade = row.grade;
      if (row.condition) meta.condition = row.condition;
      const participant = await researchService.setParticipantMeta(row.participant_id, meta);
      result.push({
        participant_id: row.participant_id,
        grade: participant.grade,
        condition: participant.condition,
        login_name_ready: Boolean(participant.login_name_hash),
        status: 'ok',
      });
    }
    res.json({ imported_count: result.length, result });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || '名单导入失败' });
  }
});
// Replace the whole formal cohort. This is intentionally destructive for active S01-S30 data.
router.post('/participants/roster-replace', requireAdmin, async (req, res) => {
  return res.status(403).json({ error:'恢复保护模式：该写入／重置接口已关闭。请先备份原始Blob，再由研究者核对恢复方案。' });
  try {
    if (process.env.ALLOW_DESTRUCTIVE_COHORT_REPLACE !== 'true') return res.status(403).json({ error: '为保护研究数据，当前版本已禁用整批清空名单。请使用“更新现有名单（保留数据）”。' });
    if (String(req.body?.confirm || '') !== 'REPLACE S01-S30') {
      return res.status(400).json({ error: '确认信息不匹配，未更换名单' });
    }
    const cleanRows = validateRosterRows(req.body?.rows || []);
    const expected = formalIds();
    const ids = [...new Set(cleanRows.map(r => r.participant_id))].sort();
    if (cleanRows.length !== 30 || ids.length !== 30 || expected.some((id, i) => ids[i] !== id)) {
      return res.status(400).json({ error: '更换整批学生必须包含完整的 S01–S30 共30人' });
    }
    const result = await researchService.replaceFormalCohort(cleanRows);
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '更换整批学生失败' });
  }
});

router.post('/participant/:participantId/meta', requireAdmin, async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    const meta = { condition: req.body?.condition, grade: req.body?.grade };
    const loginName = String(req.body?.login_name || '').trim();
    if (loginName) meta.login_name = loginName;
    res.json(await researchService.setParticipantMeta(id, meta));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '保存失败' });
  }
});
router.post('/participants/bulk-meta', requireAdmin, async (req, res) => {
  try {
    const lines = String(req.body?.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const result = [];
    const validConditions = new Set(['unassigned', 'A', 'B']);
    const normalizeGrade = value => {
      const raw = String(value || '').trim().replace(/\s+/g, '').replace(/年级$/, '');
      const map = { '6': '6', '7': '7', '8': '8', '六': '6', '七': '7', '八': '8' };
      if (map[raw]) return map[raw];
      const m = raw.match(/^(6|7|8|六|七|八)/);
      return m ? (map[m[1]] || '') : '';
    };
    const looksLikeGrade = value => Boolean(normalizeGrade(value));

    for (const line of lines) {
      // 首次名单推荐：S01 张三 6 unassigned
      // 后续只改分组仍兼容旧格式：S01 6 A
      const parts = /[\t,，]/.test(line)
        ? line.split(/[\t,，]+/).map(x => x.trim()).filter(Boolean)
        : line.split(/\s+/).map(x => x.trim()).filter(Boolean);
      const id = normalizeParticipantId(parts[0]);
      if (!validateParticipantId(id) || isTestParticipant(id)) { result.push({ line, status: 'invalid' }); continue; }

      let login_name;
      let grade;
      let gradeSupplied = false;
      let condition;
      if (parts.length >= 4) {
        login_name = parts[1];
        gradeSupplied = true;
        grade = normalizeGrade(parts[2]);
        condition = parts[3];
      } else if (parts.length === 3) {
        if (looksLikeGrade(parts[1]) && validConditions.has(parts[2])) {
          gradeSupplied = true;
          grade = normalizeGrade(parts[1]);
          condition = parts[2];
        } else {
          login_name = parts[1];
          gradeSupplied = true;
          grade = normalizeGrade(parts[2]);
        }
      } else if (parts.length === 2) {
        if (looksLikeGrade(parts[1])) { gradeSupplied = true; grade = normalizeGrade(parts[1]); }
        else login_name = parts[1];
      }

      if (gradeSupplied && !grade) {
        result.push({ line, status: 'invalid', reason: 'grade' });
        continue;
      }
      if (condition != null && !validConditions.has(condition)) {
        result.push({ line, status: 'invalid', reason: 'condition' });
        continue;
      }

      try {
        const meta = {};
        if (login_name) meta.login_name = login_name;
        if (grade != null) meta.grade = grade;
        if (condition != null) meta.condition = condition;
        const participant = await researchService.setParticipantMeta(id, meta);
        result.push({
          participant_id: id,
          grade: participant.grade,
          condition: participant.condition,
          login_name_ready: Boolean(participant.login_name_hash),
          status: 'ok',
        });
      } catch { result.push({ line, status: 'invalid' }); }
    }
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message || '批量更新失败' });
  }
});

router.post('/participants/stratified-randomize', requireAdmin, async (req, res) => {
  try {
    if (String(req.body?.confirm || '').trim() !== 'RANDOMIZE W4') return res.status(400).json({ error: '请输入 RANDOMIZE W4 才能执行可选的年级分层随机分组' });
    res.json(await stratifiedRandomizeRostered({ force:Boolean(req.body?.force), reason:'manual_admin' }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '分层随机分组失败' }); }
});


router.get('/live/:participantId', requireAdmin, async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    const settings = await researchService.getSettings();
    const sid = settings.active_session_id;
    const afterMessage = Math.max(0, Number(req.query.afterMessage || 0));
    const afterEvent = Math.max(0, Number(req.query.afterEvent || 0));
    const afterRevision = Math.max(0, Number(req.query.afterRevision || 0));
    const [record, chat_session, live, chat_messages, events, revisions] = await Promise.all([
      researchService.getSessionRecord(id, sid),
      researchService.getChatSession(id, sid),
      researchService.getLiveTrace(id, sid),
      researchService.getMessagesAfter(id, sid, afterMessage),
      researchService.getEventsAfter(id, sid, afterEvent),
      researchService.getRevisionsAfter(id, sid, afterRevision),
    ]);
    const row = {
      participant_id: id,
      active_session_id: sid,
      started: Boolean(record.started_at),
      ai_used: Boolean(record.ai_used),
      user_turn_count: chat_session?.user_turn_count || 0,
      assistant_turn_count: chat_session?.assistant_turn_count || 0,
      submitted: Boolean(record.submitted_at),
      live_status: liveStatusFrom(record, chat_session, live),
      processing: Boolean(chat_session?.processing),
      processing_started_at: chat_session?.processing_started_at || '',
      last_response_at: chat_session?.last_response_at || '',
      last_error_at: chat_session?.last_error_at || '',
      task_field_label: chat_session?.last_task_field_label || live?.task_field_label || '',
      task_field_stage: chat_session?.last_task_field_stage || live?.task_field_stage || '',
      last_student_message_preview: chat_session?.last_student_message_preview || '',
      live_draft_state: live || null,
    };
    res.json({ session_id: sid, record, chat_session, chat_messages, events, revisions, summary: row, server_time:new Date().toISOString() });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取实时对话失败' }); }
});

// Legacy history-summary used 13*30*2=780 simultaneous Blob reads and often failed.
// Recovery version reports directly observable object counts; no fabricated zeros for missing details.
router.get('/history-summary', requireAdmin, async (req, res) => {
  try {
    const list=await storageService.listObjects('participants/',30000);
    const bySession=Object.fromEntries(SESSIONS.map(s=>[s.id,{files:new Set(),chats:new Set(),messages:0}]));
    for(const row of list){
      const m=row.key.match(/^participants\/(S(?:0[1-9]|[12]\d|30))\/sessions\/(W\d+)\/(.*)$/);
      if(!m||!bySession[m[2]])continue;
      const x=bySession[m[2]];
      if(m[3]==='record.json')x.files.add(m[1]);
      if(m[3].startsWith('chat/messages/')){x.messages++;x.chats.add(m[1]);}
    }
    res.json(SESSIONS.map(session=>({
      session_id:session.id,title:session.title,
      started:bySession[session.id].files.size,
      ai_used:bySession[session.id].chats.size,
      user_messages:null,assistant_messages:null,
      raw_chat_message_files:bySession[session.id].messages,
      submitted:null,source:'read_only_raw_object_index',
      caution:'只读对象数量；有记录不一定已进入。查看正式人数/消息角色需要下载原数据。'
    })));
  } catch(e){res.status(503).json({error:'云端对象列表读取失败：'+String(e.message||'').slice(0,120)+'。不能把失败当作0。'});}
});

router.get('/storage-diagnostics', requireAdmin, async (req, res) => {
  try {
    const all = await storageService.listObjects('', 30000);
    const resets = await researchService.listResetArchives();
    const protectedSnapshot = await researchService.protectedPreW4SnapshotInfo();
    const bySession = Object.fromEntries(SESSIONS.map(s => [s.id, { records: 0, messages: 0, events: 0, revisions: 0 }]));
    for (const row of all) {
      const m = row.key.match(/^participants\/S(?:00|[0-3]\d)\/sessions\/(W\d+)\/(record\.json|chat\/messages\/|events\/|revisions\/)/);
      if (!m || !bySession[m[1]]) continue;
      if (m[2] === 'record.json') bySession[m[1]].records++;
      else if (m[2] === 'chat/messages/') bySession[m[1]].messages++;
      else if (m[2] === 'events/') bySession[m[1]].events++;
      else if (m[2] === 'revisions/') bySession[m[1]].revisions++;
    }
    res.json({ storage: storageService.describe(), object_count: all.length, reset_archive_count: resets.length, protected_pre_w3_snapshot: protectedSnapshot, by_session: bySession, recent_reset_archives: resets.slice(0, 30).map(x => ({ key: x.key, archived_at: x.data?.archived_at || '', participant_id: x.data?.participant?.participant_id || '', session_id: x.data?.session_config?.id || '', reason: x.data?.archive_reason || '' })) });
  } catch (e) { res.status(500).json({ error: e.message || '存储诊断失败' }); }
});

router.post('/restore-reset-archive', requireAdmin, async (req, res) => {
  return res.status(403).json({ error:'恢复保护模式：该写入／重置接口已关闭。请先备份原始Blob，再由研究者核对恢复方案。' });
  try {
    const key = String(req.body?.archive_key || '');
    const expected = String(req.body?.confirm || '');
    const match = key.match(/_(S(?:00|[0-3]\d))_(W\d+)\.json$/);
    if (!match || expected !== `RESTORE ${match[1]} ${match[2]}`) return res.status(400).json({ error: '恢复确认信息不匹配' });
    res.json(await researchService.restoreResetArchive(key));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '恢复归档失败' }); }
});

router.get('/participant/:participantId', requireAdmin, async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    res.json(await researchService.getCompleteParticipantData(id));
  } catch (e) {
    console.error('read participant detail', e);
    res.status(e.status || 500).json({ error: e.message || '读取学生数据失败' });
  }
});

router.post('/participant/:participantId/session/:sessionId/reset', requireAdmin, async (req, res) => {
  return res.status(403).json({ error:'恢复保护模式：该写入／重置接口已关闭。请先备份原始Blob，再由研究者核对恢复方案。' });
  try {
    const id = normalizeParticipantId(req.params.participantId);
    const sid = String(req.params.sessionId || '').toUpperCase();
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    if (PROTECTED_SESSION_IDS.includes(sid) && process.env.ALLOW_PROTECTED_PILOT_RESET !== 'true') {
      return res.status(403).json({ error: `${sid} 已设为受保护的前期观察数据，当前禁止重置。` });
    }
    if (!SESSIONS.some(s => s.id === sid)) return res.status(400).json({ error: '课次无效' });
    if (String(req.body?.confirm || '') !== `${id}:${sid}`) return res.status(400).json({ error: '确认信息不匹配，未执行重置' });
    res.json(await researchService.archiveAndResetSession(id, sid, { reason: 'single_session_admin_reset' }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '重置失败' }); }
});

router.post('/session/:sessionId/reset-all', requireAdmin, async (req, res) => {
  return res.status(403).json({ error:'恢复保护模式：该写入／重置接口已关闭。请先备份原始Blob，再由研究者核对恢复方案。' });
  try {
    const sid = String(req.params.sessionId || '').toUpperCase();
    if (!SESSIONS.some(s => s.id === sid)) return res.status(400).json({ error: '课次无效' });
    if (PROTECTED_SESSION_IDS.includes(sid) && process.env.ALLOW_PROTECTED_PILOT_RESET !== 'true') {
      return res.status(403).json({ error: `${sid} 已设为受保护的前期观察数据，当前禁止批量重置。` });
    }
    if (String(req.body?.confirm || '').trim() !== `RESET ${sid}`) return res.status(400).json({ error: `请输入 RESET ${sid} 才能执行批量重置` });
    const result = [];
    for (const id of await allIds(true)) result.push(await researchService.archiveAndResetSession(id, sid, { reason: 'whole_session_admin_reset' }));
    const archived = result.filter(x => x.archived_previous).length;
    res.json({ session_id: sid, reset_count: result.length, archived_count: archived, result });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '批量重置失败' }); }
});

async function formalData() {
  const out = [];
  for (const id of formalIds()) {
    const row = await researchService.getCompleteParticipantData(id);
    // 姓名只用于登录核对；正式研究导出保持匿名，不带姓名哈希。
    if (row.participant) delete row.participant.login_name_hash;
    out.push(row);
  }
  return out;
}

// ===== 推荐的正式导出：求助过程证据 + 任务作品 + 候选后测 + 完整JSON =====
router.get('/export/chat-package.zip', requireAdmin, async (req, res) => {
  let archive;
  try {
    archive = openZip(res, 'AI_helpseeking_process_evidence.zip');
    const rows = [];
    const revisionRows = [];
    const eventRows = [];
    const timelineRows = [];
    let imageCount = 0;
    for (const id of formalIds()) {
      const participant = await researchService.getParticipant(id);
      for (const s of SESSIONS) {
        const [messages, revisions, events] = await Promise.all([
          researchService.getMessages(id, s.id),
          researchService.getRevisions(id, s.id),
          researchService.getEvents(id, s.id),
        ]);
        for (const m of messages) {
          const imageNames = [];
          const imageZipPaths = [];
          for (let i = 0; i < (m.attachments || []).length; i++) {
            const a = m.attachments[i];
            if (!a?.file_path) continue;
            const data = await storageService.getObjectBuffer(a.file_path);
            if (!data) continue;
            const zipPath = `chat_images/${id}/${s.id}/${pad(m.message_index)}_${i + 1}_${safeName(a.file_name)}`;
            archive.append(data, { name: zipPath });
            imageNames.push(a.file_name || '');
            imageZipPaths.push(zipPath);
            imageCount++;
          }
          rows.push({
            participant_id: id,
            grade: participant.grade,
            condition: participant.condition,
            course_session_id: s.id,
            session_title: s.title,
            message_index: m.message_index,
            interaction_id: m.interaction_id || '',
            role: m.role,
            content: m.content,
            content_type: m.content_type,
            message_has_image: m.message_has_image,
            image_file_names: imageNames.join('; '),
            image_zip_paths: imageZipPaths.join('; '),
            client_sent_at: m.client_sent_at || '',
            server_received_at: m.server_received_at || '',
            ai_request_started_at: m.ai_request_started_at || '',
            ai_response_received_at: m.ai_response_received_at || '',
            ai_latency_ms: m.ai_latency_ms ?? '',
            task_field_key: m.task_field_key || '',
            task_field_label: m.task_field_label || '',
            task_field_stage: m.task_field_stage || '',
            task_context_json: m.task_context || {},
            created_at: m.created_at,
            conversation_id: m.conversation_id,
            chat_id: m.chat_id,
            bot_id: m.bot_id,
            model: m.model,
            ai_variant: m.ai_variant,
            prompt_version: m.prompt_version,
            agent_route: m.agent_route || '',
            scaffold_triggered: m.scaffold_triggered == null ? '' : Boolean(m.scaffold_triggered),
            scaffold_type: m.scaffold_type || '',
            route_parse_status: m.route_parse_status || '',
            route_protocol_version: m.route_protocol_version || '',
          });
        }
        for (const rev of revisions) revisionRows.push({
          participant_id:id,
          grade:participant.grade,
          condition:participant.condition,
          session_id:s.id,
          session_title:s.title,
          revision_index:rev.revision_index,
          field_key:rev.field_key,
          field_label:rev.field_label || '',
          field_stage:rev.field_stage || '',
          field_revision_no:rev.field_revision_no,
          previous_text:rev.previous_text,
          text:rev.text,
          created_at:rev.created_at,
          save_reason:rev.save_reason,
          last_ai_message_id:rev.last_ai_message_id,
          last_ai_message_at:rev.last_ai_message_at,
          seconds_since_last_ai_reply:rev.seconds_since_last_ai_reply,
        });
        for (const ev of events) {
          const d = ev.data || {};
          eventRows.push({
            participant_id:id,
            grade:participant.grade,
            condition:participant.condition,
            session_id:s.id,
            session_title:s.title,
            event_index:ev.event_index,
            type:ev.type,
            at:ev.at,
            interaction_id:d.interaction_id || '',
            task_field_key:d.task_field_key || '',
            task_field_label:d.task_field_label || '',
            task_field_stage:d.task_field_stage || '',
            duration_ms:d.duration_ms ?? '',
            max_chars:d.max_chars ?? '',
            edit_count:d.edit_count ?? '',
            current_chars:d.current_chars ?? '',
            reason:d.reason || '',
            message_count:d.message_count ?? '',
            dwell_ms:d.dwell_ms ?? '',
            ai_latency_ms:d.ai_latency_ms ?? '',
            potential_unsent_help_event:['ai_draft_deleted_unsent','ai_draft_left_unsent'].includes(ev.type) ? 1 : 0,
            agent_route:d.agent_route || '',
            scaffold_triggered:d.scaffold_triggered == null ? '' : Boolean(d.scaffold_triggered),
            scaffold_type:d.scaffold_type || '',
            route_parse_status:d.route_parse_status || '',
            data_json:d,
          });
        }
      }
    }
    const headers = ['participant_id','grade','condition','course_session_id','session_title','message_index','interaction_id','role','content','content_type','message_has_image','image_file_names','image_zip_paths','client_sent_at','server_received_at','ai_request_started_at','ai_response_received_at','ai_latency_ms','task_field_key','task_field_label','task_field_stage','task_context_json','created_at','conversation_id','chat_id','bot_id','model','ai_variant','prompt_version','agent_route','scaffold_triggered','scaffold_type','route_parse_status','route_protocol_version'];
    archive.append(csvText(headers, rows), { name: 'chat_messages.csv' });
    const revisionHeaders = ['participant_id','grade','condition','session_id','session_title','revision_index','field_key','field_label','field_stage','field_revision_no','previous_text','text','created_at','save_reason','last_ai_message_id','last_ai_message_at','seconds_since_last_ai_reply'];
    archive.append(csvText(revisionHeaders, revisionRows), { name: 'task_revisions.csv' });
    const eventHeaders = ['participant_id','grade','condition','session_id','session_title','event_index','type','at','interaction_id','task_field_key','task_field_label','task_field_stage','duration_ms','max_chars','edit_count','current_chars','reason','message_count','dwell_ms','ai_latency_ms','potential_unsent_help_event','agent_route','scaffold_triggered','scaffold_type','route_parse_status','data_json'];
    archive.append(csvText(eventHeaders, eventRows), { name: 'behavior_events.csv' });

    for (const r of rows) timelineRows.push({
      participant_id:r.participant_id,
      grade:r.grade,
      condition:r.condition,
      session_id:r.course_session_id,
      session_title:r.session_title,
      event_time:r.role==='user' ? (r.client_sent_at || r.created_at) : (r.ai_response_received_at || r.created_at),
      source_type:'chat_message',
      subtype:r.role,
      interaction_id:r.interaction_id,
      message_index:r.message_index,
      role:r.role,
      content:r.content,
      field_key:r.task_field_key,
      field_label:r.task_field_label,
      field_stage:r.task_field_stage,
      previous_text:'',
      revised_text:'',
      agent_route:r.agent_route || '',
      scaffold_triggered:r.scaffold_triggered ?? '',
      scaffold_type:r.scaffold_type || '',
      potential_unsent_help_event:'',
      raw_data_json:r.task_context_json,
    });
    for (const r of revisionRows) timelineRows.push({
      participant_id:r.participant_id,
      grade:r.grade,
      condition:r.condition,
      session_id:r.session_id,
      session_title:r.session_title,
      event_time:r.created_at,
      source_type:'task_revision',
      subtype:r.save_reason || 'revision',
      interaction_id:'',
      message_index:'',
      role:'',
      content:'',
      field_key:r.field_key,
      field_label:r.field_label,
      field_stage:r.field_stage,
      previous_text:r.previous_text,
      revised_text:r.text,
      agent_route:'',
      scaffold_triggered:'',
      scaffold_type:'',
      potential_unsent_help_event:'',
      raw_data_json:{ last_ai_message_id:r.last_ai_message_id, last_ai_message_at:r.last_ai_message_at, seconds_since_last_ai_reply:r.seconds_since_last_ai_reply },
    });
    for (const r of eventRows) timelineRows.push({
      participant_id:r.participant_id,
      grade:r.grade,
      condition:r.condition,
      session_id:r.session_id,
      session_title:r.session_title,
      event_time:r.at,
      source_type:'behavior_event',
      subtype:r.type,
      interaction_id:r.interaction_id,
      message_index:'',
      role:'',
      content:'',
      field_key:r.task_field_key,
      field_label:r.task_field_label,
      field_stage:r.task_field_stage,
      previous_text:'',
      revised_text:'',
      agent_route:r.agent_route || '',
      scaffold_triggered:r.scaffold_triggered ?? '',
      scaffold_type:r.scaffold_type || '',
      potential_unsent_help_event:r.potential_unsent_help_event || '',
      raw_data_json:r.data_json,
    });
    timelineRows.sort((a,b) => String(a.participant_id).localeCompare(String(b.participant_id)) || String(a.session_id).localeCompare(String(b.session_id)) || String(a.event_time).localeCompare(String(b.event_time)) || String(a.source_type).localeCompare(String(b.source_type)));
    let seqKey = '', seq = 0;
    for (const row of timelineRows) {
      const key = `${row.participant_id}|${row.session_id}`;
      if (key !== seqKey) { seqKey = key; seq = 0; }
      row.sequence_order = ++seq;
    }
    const timelineHeaders = ['participant_id','grade','condition','session_id','session_title','sequence_order','event_time','source_type','subtype','interaction_id','message_index','role','content','field_key','field_label','field_stage','previous_text','revised_text','agent_route','scaffold_triggered','scaffold_type','potential_unsent_help_event','raw_data_json'];
    archive.append(csvText(timelineHeaders, timelineRows), { name: 'process_timeline.csv' });
    archive.append(`正式数据仅含 S01-S30，自动排除 S00（实验组测试）与 S99（对照组测试）。\nchat_messages.csv：学生与AI完整消息，含 interaction_id、真实AI请求/回复时间、ai_latency_ms，以及发送时所在任务步骤字段。\nbehavior_events.csv：输入草稿开始/删除未发送/离开未发送、打开AI但未发送、打开到发送时长、任务字段停留与编辑、粘贴/复制字符数、回看旧回复、查看新反馈等可观察事件；删除/离开未发送只标记为 potential_unsent_help_event，不能自动等同AHS；未发送草稿正文和剪贴板正文不会保存。
实验组还记录 help_seeking_route_decision：agent_route=IHS/EHS/OTHER、是否触发EHS支架、解析状态。该系统路由仅用于干预执行/fidelity，不等于正式人工编码。\ntask_revisions.csv：任务文本框V1/V2/V3版本历史，可通过 last_ai_message_id / last_ai_message_at 与AI回复对齐。\nprocess_timeline.csv：把聊天、行为事件、任务修订按学生×课次合并为统一时间线，仅整理原始证据，不自动判定IHS/EHS/AHS。\nchat_images/：学生在允许上传图片的课次中发送给AI的原图；W2关闭聊天图片。\n共导出聊天消息 ${rows.length} 条、版本记录 ${revisionRows.length} 条、行为事件 ${eventRows.length} 条、聊天图片 ${imageCount} 张。\n`, { name: 'README.txt' });
    await archive.finalize();
  } catch (e) {
    console.error('help-seeking process package export', e);
    if (!res.headersSent) res.status(500).json({ error: 'AI求助过程数据导出失败' });
    else res.destroy(e);
  }
});

router.get('/export/task-package.zip', requireAdmin, async (req, res) => {
  let archive;
  try {
    archive = openZip(res, 'task_records_and_works.zip');
    const rows = [];
    let imageCount = 0;
    for (const id of formalIds()) {
      const participant = await researchService.getParticipant(id);
      for (const s of SESSIONS) {
        const r = await researchService.getSessionRecord(id, s.id);
        const fieldLabel = Object.fromEntries((s.fields || []).map(f => [f.key, f.label]));
        const taskText = Object.entries(r.text_fields || {})
          .filter(([, value]) => String(value || '').trim())
          .map(([key, value]) => `${fieldLabel[key] || key}: ${value}`)
          .join('\n');
        const artifactNames = [];
        const artifactZipPaths = [];
        for (const [key, a] of Object.entries(r.artifacts || {})) {
          if (!a?.file_path) continue;
          const data = await storageService.getObjectBuffer(a.file_path);
          if (!data) continue;
          const zipPath = `works/${id}/${s.id}/${safeName(key)}_${safeName(a.file_name)}`;
          archive.append(data, { name: zipPath });
          artifactNames.push(a.file_name || '');
          artifactZipPaths.push(zipPath);
          imageCount++;
        }
        rows.push({
          participant_id: id,
          grade: participant.grade,
          condition_current: participant.condition,
          session_id: s.id,
          session_title: s.title,
          date: s.date,
          research_role: s.research_role,
          condition_at_time: r.condition_at_time,
          ai_variant: r.ai_variant,
          started_at: r.started_at,
          first_ai_open_at: r.first_ai_open_at,
          first_ai_open_latency_seconds: r.first_ai_open_latency_seconds,
          first_user_message_at: r.first_user_message_at,
          first_user_message_latency_seconds: r.first_user_message_latency_seconds,
          ai_open_count: r.ai_open_count,
          ai_used: r.ai_used,
          task_text: taskText,
          text_fields_json: r.text_fields,
          work_file_names: artifactNames.join('; '),
          work_zip_paths: artifactZipPaths.join('; '),
          submitted_at: r.submitted_at,
          completed_at: r.completed_at,
        });
      }
    }
    const headers = ['participant_id','grade','condition_current','session_id','session_title','date','research_role','condition_at_time','ai_variant','started_at','first_ai_open_at','first_ai_open_latency_seconds','first_user_message_at','first_user_message_latency_seconds','ai_open_count','ai_used','task_text','text_fields_json','work_file_names','work_zip_paths','submitted_at','completed_at'];
    archive.append(csvText(headers, rows), { name: 'task_records.csv' });
    archive.append(`正式数据仅含 S01-S30，自动排除 S00（实验组测试）与 S99（对照组测试）。\ntask_records.csv：每个学生每个课次的当前/最终任务记录。\nworks/：W1及W3以后需要上传的草图、原型、测试证据和最终作品原图；W2不要求最终图片。\n求助过程相关的 behavior_events.csv、task_revisions.csv 与 process_timeline.csv 已统一放入“AI求助过程数据 ZIP”，避免两个工作包重复。\n共 ${rows.length} 条课次记录、${imageCount} 张任务图片。\n`, { name: 'README.txt' });
    await archive.finalize();
  } catch (e) {
    console.error('task package export', e);
    if (!res.headersSent) res.status(500).json({ error: '任务记录与作品导出失败' });
    else res.destroy(e);
  }
});

router.get('/export/questionnaire.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) {
    const p = await researchService.getParticipant(id);
    const slot = 'post';
    const q = await researchService.getQuestionnaire(id, slot);
    const row = {
      participant_id:id,
      grade:p.grade,
      condition:p.condition,
      slot,
      questionnaire_version:q?.questionnaire_version||'',
      submitted_at:q?.submitted_at||'',
      instrumental_mean:q?.scores?.instrumental_mean??'',
      executive_mean:q?.scores?.executive_mean??'',
      avoidance_mean:q?.scores?.avoidance_mean??'',
    };
    for (const item of QUESTIONNAIRE_ITEMS) row[item.id] = q?.responses?.[item.id] ?? '';
    rows.push(row);
  }
  sendCsv(res, 'questionnaire_posttest_raw.csv', ['participant_id','grade','condition','slot','questionnaire_version','submitted_at','instrumental_mean','executive_mean','avoidance_mean',...QUESTIONNAIRE_ITEMS.map(x=>x.id)], rows);
});


router.post('/protected-snapshot/create', requireAdmin, async (req, res) => {
  try { res.json(await researchService.createProtectedPreW4Snapshot()); }
  catch (e) { res.status(e.status || 500).json({ error: e.message || '创建W1/W2/W3干预前安全快照失败' }); }
});

router.post('/protected-snapshot/restore-missing', requireAdmin, async (req, res) => {
  try {
    if (String(req.body?.confirm || '') !== 'RESTORE W1 W2 W3') return res.status(400).json({ error: '请输入 RESTORE W1 W2 W3 才会执行恢复。' });
    res.json(await researchService.restoreProtectedPreW4SnapshotMissingOnly());
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '恢复W1/W2/W3干预前安全快照失败' }); }
});

router.get('/export/protected-pre-w4.zip', requireAdmin, async (req, res) => {
  try {
    const meta = await researchService.protectedPreW4SnapshotInfo();
    if (!meta?.prefix) return res.status(404).json({ error: '尚未创建W1/W2/W3干预前安全快照。可在正式W4前手动创建，或执行可选随机分组时自动创建。' });
    const rows = await storageService.listObjects(`${meta.prefix}/`, 30000);
    const archive = openZip(res, 'W1_W2_W3_pre_W4_protected_snapshot.zip');
    for (const row of rows) {
      const data = await storageService.getObjectBuffer(row.key);
      if (data == null) continue;
      const rel = row.key.slice(`${meta.prefix}/`.length);
      archive.append(data, { name: rel || 'meta.json' });
    }
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(e.status || 500).json({ error: e.message || '导出W1/W2/W3干预前安全快照失败' });
  }
});


// ========== 11.55 审慎恢复：以下接口只读、不会修改学生数据 ==========
// Check a few exact Blob keys plus historical object count. Avoid getParticipant/getSessionRecord
// because legacy getParticipant can automatically create an empty account in the wrong run.
router.get('/recovery/probe', requireAdmin, async (req, res) => {
  const result={ checked_at:new Date().toISOString(), storage:storageService.describe(), checks:{}, hints:[], writable_actions_disabled:true };
  const test=async (name,fn)=>{try{result.checks[name]=await fn();}catch(e){result.checks[name]={error:String(e?.message||e).slice(0,240)};}};
  await test('settings_object',async()=>{
    const raw=await storageService.getObject('settings.json');
    if(!raw) return { found:false };
    const json=JSON.parse(raw);
    return {found:true, active_session_id:json.active_session_id||null, updated_at:json.updated_at||null};
  });
  await test('formal_participants',async()=>{
    const rows=await storageService.listObjects('participants/',15000);
    const files=rows.map(x=>x.key);
    const totals={ objects:files.length, formal_participant_files:0, sessions:{}, message_files:0, event_files:0, revision_files:0 };
    for(const key of files){
      if(/^participants\/S(?:0[1-9]|[12]\d|30)\.json$/.test(key)) totals.formal_participant_files++;
      const m=key.match(/^participants\/S(?:0[1-9]|[12]\d|30)\/sessions\/(W\d+)\//);
      if(m){totals.sessions[m[1]]=(totals.sessions[m[1]]||0)+1;
        if(key.includes('/chat/messages/'))totals.message_files++;
        if(key.includes('/events/'))totals.event_files++;
        if(key.includes('/revisions/'))totals.revision_files++;
      }
    }
    return totals;
  });
  await test('images',async()=>{
    const list=await storageService.listObjects('uploads/',5000);
    return { objects:list.length, list_capped:list.length>=5000 };
  });
  await test('reset_archives',async()=>{
    const list=await storageService.listObjects('reset-archives/',1500);
    return { objects:list.length, list_capped:list.length>=1500 };
  });
  await test('protected_snapshots',async()=>{
    const list=await storageService.listObjects('protected-snapshots/',1500);
    return { objects:list.length, list_capped:list.length>=1500 };
  });
  await test('other_run_prefixes',async()=>storageService.discoverRunPrefixes(1600));
  if(result.checks.formal_participants?.objects===0){
    result.hints.push('当前运行前缀下未列到学生对象，不等于已删除。检查other_run_prefixes是否出现旧实验编号，并检查原Blob名称/绑定。');
  }
  if(Object.values(result.checks).some(x=>x?.error)) result.hints.push('发生存储访问错误：页面的0轮不是可靠的历史统计。');
  res.setHeader('Cache-Control','no-store'); res.json(result);
});

router.get('/recovery/test-download.csv', requireAdmin, (req,res)=>{
  res.setHeader('Cache-Control','no-store');
  sendCsv(res,'recovery_download_test.csv',['check','time'],[{check:'ok',time:new Date().toISOString()}]);
});

// Read-only raw object export: does not rely on existing chat indexes, schema or automatic migrations.
// Export one student's one session to limit cloud-function duration and to include orphan images.
router.get('/recovery/backup/:participantId/:sessionId.zip', requireAdmin, async (req,res)=>{
  const id=normalizeParticipantId(req.params.participantId);
  const sid=String(req.params.sessionId||'').toUpperCase();
  if(!validateParticipantId(id)||!SESSIONS.some(x=>x.id===sid)) return res.status(400).json({error:'编号或课次无效'});
  try{
    const [dataFiles, imageFiles]=await Promise.all([
      storageService.listObjects(`participants/${id}/sessions/${sid}/`,8000),
      storageService.listObjects(`uploads/${id}/${sid}/`,5000)
    ]);
    const all=[...dataFiles,...imageFiles];
    if(!all.length) return res.status(404).json({error:`未找到 ${id} ${sid} 的原始对象；未生成空ZIP。请先做只读存储检查。`});
    const archive=openZip(res,`recovery_raw_${id}_${sid}.zip`);
    archive.append(JSON.stringify({participant_id:id,session_id:sid,object_count:all.length,warning:'原始对象副本；如上传过多次，上传目录内可能有未索引图片。',exported_at:new Date().toISOString()},null,2),{name:'README.json'});
    for(const row of all){
      const b=await storageService.getObjectBuffer(row.key);
      if(b) archive.append(b,{name:row.key});
    }
    await archive.finalize();
  }catch(e){ console.error('raw backup failed',e); if(!res.headersSent)res.status(503).json({error:'无法读取当前存储空间中的原始文件，请保留旧数据。'+String(e.message||'').slice(0,100)}); else res.destroy(e); }
});

router.get('/export/all.json', requireAdmin, async (req, res) => sendJson(res, 'course_research_all.json', await formalData()));

// ===== 旧版细分导出仍保留，避免已有链接失效；后台不再把它们作为主按钮展示 =====
router.get('/export/participants.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) {
    const p = await researchService.getParticipant(id);
    rows.push({ participant_id: p.participant_id, grade: p.grade, condition: p.condition, created_at: p.created_at, last_active_at: p.last_active_at });
  }
  sendCsv(res, 'participants.csv', ['participant_id','grade','condition','created_at','last_active_at'], rows);
});
router.get('/export/sessions.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) for (const s of SESSIONS) {
    const r = await researchService.getSessionRecord(id, s.id);
    rows.push({ participant_id:id,session_id:s.id,date:s.date,research_role:s.research_role,condition_at_time:r.condition_at_time,ai_variant:r.ai_variant,started_at:r.started_at,first_ai_open_at:r.first_ai_open_at,first_ai_open_latency_seconds:r.first_ai_open_latency_seconds,first_user_message_at:r.first_user_message_at,first_user_message_latency_seconds:r.first_user_message_latency_seconds,ai_open_count:r.ai_open_count,ai_used:r.ai_used,text_fields:r.text_fields,artifacts:r.artifacts,submitted_at:r.submitted_at });
  }
  sendCsv(res, 'session_records.csv', ['participant_id','session_id','date','research_role','condition_at_time','ai_variant','started_at','first_ai_open_at','first_ai_open_latency_seconds','first_user_message_at','first_user_message_latency_seconds','ai_open_count','ai_used','text_fields','artifacts','submitted_at'], rows);
});
router.get('/export/chat.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) for (const s of SESSIONS) for (const m of await researchService.getMessages(id, s.id)) rows.push(m);
  sendCsv(res, 'chat_messages.csv', ['participant_id','course_session_id','message_index','role','content','content_type','message_has_image','attachments','created_at','conversation_id','chat_id','bot_id','model','ai_variant','prompt_version','agent_route','scaffold_triggered','scaffold_type','route_parse_status','route_protocol_version'], rows);
});
router.get('/export/chat-attachments.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) for (const s of SESSIONS) for (const m of await researchService.getMessages(id, s.id)) {
    for (const a of (m.attachments || [])) rows.push({ participant_id:id,course_session_id:s.id,message_index:m.message_index,created_at:m.created_at,type:a.type||'',file_name:a.file_name||'',mime:a.mime||'',uploaded_at:a.uploaded_at||'',file_path:a.file_path||'',coze_file_id:a.coze_file_id||'' });
  }
  sendCsv(res, 'chat_attachments.csv', ['participant_id','course_session_id','message_index','created_at','type','file_name','mime','uploaded_at','file_path','coze_file_id'], rows);
});
router.get('/export/events.csv', requireAdmin, async (req, res) => {
  const rows = [];
  for (const id of formalIds()) for (const s of SESSIONS) for (const e of await researchService.getEvents(id, s.id)) rows.push(e);
  sendCsv(res, 'events.csv', ['participant_id','session_id','event_index','type','at','data'], rows);
});
router.get('/export/test-archives.json', requireAdmin, async (req, res) => sendJson(res, 'teacher_test_archives.json', await researchService.listTestArchives()));
router.get('/export/reset-archives.json', requireAdmin, async (req, res) => sendJson(res, 'admin_reset_archives.json', await researchService.listResetArchives()));

export default router;
