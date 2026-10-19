import express from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'node:crypto';
import * as XLSX from 'xlsx';
import { requireAdmin } from '../middleware/auth.js';
import { storageService } from '../services/storageService.js';
import { researchService } from '../services/researchService.js';
import { getMeasurements, getMessageCoding, putMessageCoding, codingDataset, getInterviewNote, putInterviewNote, interviewDataset, getArtifactAssessments, putArtifactAssessment, artifactEvidenceDataset, processSequenceDataset, measurementMeta } from '../services/measurementService.js';
import { getFinalProductScores, putFinalProductScore, finalProductDataset, productScoreHeaders } from '../services/finalProductService.js';
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
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
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
    const rows = await Promise.all(ids.map(id => summary(id, settings.active_session_id)));
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
    const rows = await Promise.all(ids.map(async id => {
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
    }));
    res.json({ session_id: sid, rows, server_time: new Date().toISOString() });
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
router.post('/participants/roster-replace', requireAdmin, (_req,res)=>res.status(403).json({error:'已永久禁用整批清空正式学生数据；请更新现有名单。'}));

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

router.get('/history-summary', requireAdmin, async (req, res) => {
  try {
    const ids = formalIds();
    const data = await Promise.all(SESSIONS.map(async session => {
      const perStudent = await Promise.all(ids.map(async id => {
        const [record, chat] = await Promise.all([
          researchService.getSessionRecord(id, session.id),
          researchService.getChatSession(id, session.id),
        ]);
        return { record, chat };
      }));
      return {
        session_id: session.id,
        title: session.title,
        started: perStudent.filter(x => x.record?.started_at).length,
        ai_used: perStudent.filter(x => x.record?.ai_used || (x.chat?.user_turn_count || 0) > 0).length,
        user_messages: perStudent.reduce((n, x) => n + Number(x.chat?.user_turn_count || 0), 0),
        assistant_messages: perStudent.reduce((n, x) => n + Number(x.chat?.assistant_turn_count || 0), 0),
        submitted: perStudent.filter(x => x.record?.submitted_at).length,
      };
    }));
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message || '读取历史课次统计失败' }); }
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
  try {
    const id = normalizeParticipantId(req.params.participantId);
    const sid = String(req.params.sessionId || '').toUpperCase();
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    if (!isTestParticipant(id)) return res.status(403).json({error:'为保护正式研究历史，S01–S30 的重置接口已关闭。'});
    if (PROTECTED_SESSION_IDS.includes(sid) && process.env.ALLOW_PROTECTED_PILOT_RESET !== 'true') {
      return res.status(403).json({ error: `${sid} 已设为受保护的前期观察数据，当前禁止重置。` });
    }
    if (!SESSIONS.some(s => s.id === sid)) return res.status(400).json({ error: '课次无效' });
    if (String(req.body?.confirm || '') !== `${id}:${sid}`) return res.status(400).json({ error: '确认信息不匹配，未执行重置' });
    res.json(await researchService.archiveAndResetSession(id, sid, { reason: 'single_session_admin_reset' }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '重置失败' }); }
});

router.post('/session/:sessionId/reset-all', requireAdmin, (_req,res)=>res.status(403).json({error:'已永久禁用整节课重置，前几节课的正式记录受到保护。'}));

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
    const workVersionRows = [];
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
        const versions=await researchService.getArtifactVersions(id,s.id,r);
        for(const [key,list] of Object.entries(versions))for(const [index,a] of list.entries()){
          if(!a?.file_path)continue;
          const data=await storageService.getObjectBuffer(a.file_path);
          if(!data)continue;
          const zipPath=`works/${id}/${s.id}/${safeName(key)}/v${String(index+1).padStart(3,'0')}_${safeName(a.file_name)}`;
          archive.append(data,{name:zipPath});artifactNames.push(a.file_name||'');artifactZipPaths.push(zipPath);imageCount++;
          workVersionRows.push({participant_id:id,session_id:s.id,artifact_key:key,version_no:index+1,version_id:a.version_id||'',version_kind:a.kind||'',file_name:a.file_name||'',file_path:a.file_path,zip_path:zipPath,uploaded_at:a.uploaded_at||'',change_source:a.change_source||'',change_note:a.change_note||'',ai_message_id:a.ai_message_id||'',based_on_version_ref:a.based_on_version_ref||'',original_order_unknown:!!a.original_order_unknown});
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
    archive.append(csvText(['participant_id','session_id','artifact_key','version_no','version_id','version_kind','file_name','file_path','zip_path','uploaded_at','change_source','change_note','ai_message_id','based_on_version_ref','original_order_unknown'],workVersionRows),{name:'artifact_versions_and_image_paths.csv'});
    archive.append(`正式数据仅含 S01-S30，自动排除 S00（实验组测试）与 S99（对照组测试）。\ntask_records.csv：每个学生每个课次的当前/最终任务记录。\nworks/：W1及W3以后历次上传的原始图像，按版本分目录（包括更正误传的旧图）；W2不要求最终图片。\n求助过程相关的 behavior_events.csv、task_revisions.csv 与 process_timeline.csv 已统一放入“AI求助过程数据 ZIP”，避免两个工作包重复。\n共 ${rows.length} 条课次记录、${imageCount} 张任务图片。\n`, { name: 'README.txt' });
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


// ===== 研究测量：原始行为统计与人工编码，和AI自动路由严格分离 =====
router.get('/research/measurements',requireAdmin,async(req,res)=>{
 try {const sid=String(req.query.session_id||'W5').toUpperCase();res.json({session_id:sid,rows:await getMeasurements(sid),meta:measurementMeta,generated_at:new Date().toISOString()});}
 catch(e){res.status(e.status||500).json({error:e.message||'汇总失败'});}
});
router.get('/research/coding/:participantId/:sessionId',requireAdmin,async(req,res)=>{
 try {
 const id=String(req.params.participantId||'').toUpperCase(),sid=String(req.params.sessionId||'').toUpperCase();
 if(!formalIds().includes(id)||!SESSIONS.some(x=>x.id===sid))return res.status(400).json({error:'学生或课次无效'});
 const [messages,codes,interview]=await Promise.all([researchService.getMessages(id,sid),getMessageCoding(id,sid),getInterviewNote(id,sid)]);
 res.json({participant_id:id,session_id:sid,artifact_versions:await researchService.getArtifactVersions(id,sid),artifact_assessments:await getArtifactAssessments(id,sid),messages:messages.filter(x=>x.role==='user').map(x=>({message_index:x.message_index,content:x.content,created_at:x.created_at,agent_route_system:x.agent_route||'',scaffold_triggered_system:x.scaffold_triggered??null,task_field_key:x.task_field_key||''})),codings:codes,interview,meta:measurementMeta});
 }catch(e){res.status(e.status||500).json({error:e.message||'读取编码失败'});}
});
router.post('/research/coding',requireAdmin,async(req,res)=>{
 try {res.json(await putMessageCoding(req.body||{}));}
 catch(e){res.status(e.status||500).json({error:e.message||'保存编码失败'});}
});
router.post('/research/interview',requireAdmin,async(req,res)=>{
 try{res.json(await putInterviewNote(req.body||{}));}
 catch(e){res.status(e.status||500).json({error:e.message||'访谈记录保存失败'});}
});
router.post('/research/artifact-assessment',requireAdmin,async(req,res)=>{
 try{res.json(await putArtifactAssessment(req.body||{}));}
 catch(e){res.status(e.status||500).json({error:e.message||'保存作品关联核实失败'});}
});
// Independent W10 final-product assessment: different evidence from process portfolio / LSA.
router.get('/research/product-scores/:participantId',requireAdmin,async(req,res)=>{
 try{res.json({participant_id:req.params.participantId,scores:await getFinalProductScores(String(req.params.participantId).toUpperCase())});}
 catch(e){res.status(e.status||500).json({error:e.message||'读取作品评分失败'});}
});
router.post('/research/product-scores',requireAdmin,async(req,res)=>{
 try{res.json(await putFinalProductScore(req.body||{}));}
 catch(e){res.status(e.status||500).json({error:e.message||'保存作品评分失败'});}
});
router.get('/export/final-product-scores.csv',requireAdmin,async(req,res)=>{
 try{sendCsv(res,'W10_final_product_scores_two_raters.csv',productScoreHeaders,await finalProductDataset());}
 catch(e){res.status(500).json({error:e.message||'导出作品评分失败'});}
});
const ARTIFACT_CSV_HEADERS=['participant_id','grade','condition_at_time','session_id','artifact_key','version_id','version_no','version_kind','previous_version_id','based_on_previous_session_version_ref','file_name','file_path','uploaded_at','student_report_change_source','student_change_note','linked_ai_message_id','linked_ai_message_at','linked_ai_message_text','chronological_ai_reply_before_upload','researcher_link_verification','researcher_change_nature','researcher_evidence_note','researcher_coder','researcher_coded_at','is_legacy','source_warning'];
// v11.49: standalone W4/W7 exposure CSV: never edits original orientation or historical chats.
router.get('/export/orientation-activities.csv',requireAdmin,async(req,res)=>{
 try{
  const rows=[];
  for(const id of formalIds())for(const sid of ['W4','W5','W6','W7','W8','W9','W10']){
   const [o,p,record]=await Promise.all([researchService.getOrientation(id,sid),researchService.getParticipant(id),researchService.getSessionRecord(id,sid)]);
   if(!o)continue;
   const a=o.answers||{};
   rows.push({participant_id:id,grade:p.grade||'',condition_at_time:record.condition_at_time||p.condition,
    session_id:sid,orientation_mode:o.mode||'',activity_key:o.orientation_key||'',started_at:o.started_at||'',completed_at:o.completed_at||'',duration_seconds:o.duration_seconds||'',
    selected_past_message_ref:a.personal_ref||'',reflection_source:a.reflection_source||'',reflection_difficulty:a.reflection_difficulty||'',reflection_reply_review:a.reflection_reply_review||'',revised_help_question:a.revised_question||'',reflection_reason:a.reflection_reason||'',had_original_ai_question:a.had_original_question??'',prior_chat_count:a.prior_chat_count??o.prior_chat_count??'',case_selection_reason:a.case_selection_reason||o.case_selection_reason||'',selected_case_basis:a.selected_case_basis||'',
    neutral_observation:a.neutral_observation||'',neutral_nextstep:a.neutral_nextstep||'',answers_json:JSON.stringify(a),shown_personal_queries_json:JSON.stringify(o.displayed_cards||[]),
    review_is_planned_intervention:['W5','W6','W7','W8','W9','W10'].includes(sid)&&o.mode==='supported',strategy_practice_count:a.strategy_practice_count??'',strategy_practice_correct_count:a.strategy_practice_correct_count??'',strategy_practice_protocol:a.strategy_practice_protocol||'',review_previous_session_id: sid==='W4'?'':`W${Number(sid.slice(1))-1}`});
  }
  sendCsv(res,'orientation_and_personal_reflection.csv',['participant_id','grade','condition_at_time','session_id','orientation_mode','activity_key','started_at','completed_at','duration_seconds','selected_past_message_ref','reflection_source','reflection_difficulty','reflection_reply_review','revised_help_question','reflection_reason','had_original_ai_question','prior_chat_count','case_selection_reason','selected_case_basis','neutral_observation','neutral_nextstep','answers_json','shown_personal_queries_json','review_is_planned_intervention','strategy_practice_count','strategy_practice_correct_count','strategy_practice_protocol','review_previous_session_id'],rows);
 }catch(e){res.status(500).json({error:e.message||'导出活动记录失败'});}
});

router.get('/export/download-test.csv',requireAdmin,async(req,res)=>{
 sendCsv(res,'download_test.csv',['check','generated_at','tip'],[{check:'OK',generated_at:new Date().toISOString(),tip:'能实际在下载目录找到并打开本CSV，再尝试正式统计CSV和逐课历史ZIP。'}]);
});
router.get('/export/artifact-versions.csv',requireAdmin,async(req,res)=>{
 try{const sid=String(req.query.session_id||'ALL').toUpperCase();sendCsv(res,'artifact_versions_and_ai_links.csv',ARTIFACT_CSV_HEADERS,await artifactEvidenceDataset(sid));}
 catch(e){res.status(e.status||500).json({error:e.message||'作品版本CSV导出失败'});}
});
// SMALL, image-free full-session research pack, with actual direct CSV routes as fallbacks.
router.get('/export/research-tables/:sessionId.zip',requireAdmin,async(req,res)=>{
 const sid=String(req.params.sessionId||'').toUpperCase();if(!SESSIONS.some(s=>s.id===sid))return res.status(400).json({error:'课次不存在'});
 let archive;try{
  const [measure,coding,artifact,interviews]=await Promise.all([getMeasurements(sid),codingDataset(sid),artifactEvidenceDataset(sid),interviewDataset(sid)]);
  archive=openZip(res,`research_tables_${sid}.zip`);
  archive.append(csvText(['participant_id','grade','condition_at_time','session_id','user_messages','ai_open_count','ihs_human','ehs_human','ihs_share_among_ihs_ehs','ehs_share_among_ihs_ehs','human_coding_complete','uploaded_artifact_version_count','unindexed_historical_images','artifact_self_report_ai_count','task_text_revisions','chat_history_revisit_events','interview_recorded'],measure),{name:'participant_session_summary.csv'});
  archive.append(csvText(['participant_id','session_id','message_index','message_at','message_text','interaction_id','protocol_ai_required','protocol_first_user_message','help_type_human','process_codes_human','primary_process_code_human','fine_process_code_human','coder','memo','coded_at'],coding),{name:'human_coding_and_original_user_text.csv'});
  archive.append(csvText(ARTIFACT_CSV_HEADERS,artifact),{name:'all_artifact_versions.csv'});
  if(sid==='W10')archive.append(csvText(productScoreHeaders,await finalProductDataset()),{name:'W10_final_product_scores_two_raters.csv'});
  if(['W4','W5','W6','W7','W8','W9','W10'].includes(sid)){
    const activity=await Promise.all(formalIds().map(async id=>{
      const o=await researchService.getOrientation(id,sid);if(!o)return null;
      return {participant_id:id,session_id:sid,mode:o.mode||'',key:o.orientation_key||'',completed_at:o.completed_at||'',duration_seconds:o.duration_seconds??'',reflection_source:o.answers?.reflection_source||'',answers:JSON.stringify(o.answers||{}),shown_personal_queries:JSON.stringify(o.displayed_cards||[])};
    }));
    archive.append(csvText(['participant_id','session_id','mode','key','completed_at','duration_seconds','reflection_source','answers','shown_personal_queries'],activity.filter(Boolean)),{name:'session_strategy_and_reflection_activity.csv'});
  }
  const rawGroups=await Promise.all(formalIds().map(async id=>{
    const [messages,events,revisions]=await Promise.all([researchService.getMessages(id,sid),researchService.getEvents(id,sid),researchService.getRevisions(id,sid)]);
    return {id,messages,events,revisions};
  }));
  const allMessages=rawGroups.flatMap(g=>g.messages.map(m=>({...m,participant_id:g.id})));
  const allEvents=rawGroups.flatMap(g=>g.events.map(e=>({...e,participant_id:g.id})));
  const allRevisions=rawGroups.flatMap(g=>g.revisions.map(r=>({...r,participant_id:g.id})));
  archive.append(csvText(['participant_id','course_session_id','message_index','message_id','interaction_id','role','content','created_at','agent_route','scaffold_triggered','task_field_key','attachments'],allMessages),{name:'raw_full_ai_chat_both_roles.csv'});
  archive.append(csvText(['participant_id','session_id','event_index','type','at','data'],allEvents),{name:'raw_action_trace_events.csv'});
  archive.append(csvText(['participant_id','session_id','revision_index','field_key','previous_text','text','created_at','last_ai_message_id','last_ai_message_at','save_reason'],allRevisions),{name:'raw_task_text_revisions.csv'});

  archive.append(csvText(['participant_id','session_id','at','within_session_event_order','sequence_event_code','lsa_stage','sensitivity_lsa_stage','primary_lsa_included','source','source_id','protocol_first_user_message','help_type_human','fine_process_code_human','evidence_level','message_text','link_note'],await processSequenceDataset(sid)),{name:'human_coded_process_sequence.csv'});
  archive.append(csvText(['participant_id','session_id','difficulty','reasons','memo','source','recorded_at','revision'],interviews),{name:'interview_reasons.csv'});
  archive.append('此包是无图片的研究统计表，可以直接用Excel导入。要保留作品/聊天原图，还需下载对应课次完整原始ZIP。未编码的IHS/EHS比例为空；图片版本与AI的先后顺序/学生报告不是因果证明。\n',{name:'README.txt'});
  await archive.finalize();
 }catch(e){console.error('research tables export',e);if(!res.headersSent)res.status(500).json({error:e.message||'轻量研究表导出失败'});else res.destroy(e);}
});
router.get('/export/interviews.csv',requireAdmin,async(req,res)=>{
 try{const sid=String(req.query.session_id||'ALL').toUpperCase();sendCsv(res,'no_ai_interview_coded_summary.csv',['participant_id','session_id','difficulty','reasons','memo','source','recorded_at','revision'],await interviewDataset(sid));}
 catch(e){res.status(e.status||500).json({error:e.message||'访谈摘要导出失败'});}
});
router.get('/export/measurement.csv',requireAdmin,async(req,res)=>{
 try {
 const sid=String(req.query.session_id||'ALL').toUpperCase(),rows=await getMeasurements(sid);
 const headers=['participant_id','grade','condition_current','condition_at_time','session_id','session_title','phase','started_at','completed_at','has_task_record','ai_open_count','ai_opened','user_messages','ai_responses','actual_sent_to_ai','ai_open_without_message','never_opened_ai','draft_started_events','draft_unsent_deleted_events','draft_unsent_left_events','chat_history_revisit_events','ai_open_no_send_events','task_field_interaction_events','task_text_revisions','uploaded_artifact_count','uploaded_artifact_version_count','unindexed_historical_images','artifact_self_report_ai_count','orientation_completed_events','interview_recorded','interview_difficulty','interview_reasons','route_ehs_events','scaffold_triggered_system_events','messages_human_coded','messages_pending_human_coding','messages_with_primary_process','human_coding_complete','ihs_human','ehs_human','other_help_human','not_help_human','valid_ihs_ehs_denom','ihs_share_among_ihs_ehs','ehs_share_among_ihs_ehs','total_human_help','process_d_human','process_h_human','process_e_human','process_p_human','source_note'];
 sendCsv(res,'helpseeking_participant_session_measures.csv',headers,rows);
 }catch(e){res.status(e.status||500).json({error:e.message||'统计CSV导出失败'});}
});
router.get('/export/process-sequence.csv',requireAdmin,async(req,res)=>{
 try{const sid=String(req.query.session_id||'ALL').toUpperCase();sendCsv(res,'human_coded_process_sequence.csv',['participant_id','session_id','at','within_session_event_order','sequence_event_code','lsa_stage','sensitivity_lsa_stage','primary_lsa_included','source','source_id','protocol_first_user_message','help_type_human','fine_process_code_human','evidence_level','message_text','link_note'],await processSequenceDataset(sid));}
 catch(e){res.status(e.status||500).json({error:e.message||'过程序列CSV导出失败'});}
});
router.get('/export/human-coding.csv',requireAdmin,async(req,res)=>{
 try {
 const sid=String(req.query.session_id||'ALL').toUpperCase(),rows=await codingDataset(sid);
 sendCsv(res,'human_coding_with_source_messages.csv',['participant_id','grade','condition_current','condition_at_time','session_id','message_index','message_at','message_text','interaction_id','protocol_ai_required','protocol_first_user_message','agent_route_system','scaffold_triggered_system','help_type_human','process_codes_human','primary_process_code_human','fine_process_code_human','coder','memo','coded_at','coding_scheme'],rows);
 }catch(e){res.status(e.status||500).json({error:e.message||'逐条编码CSV导出失败'});}
});
// 每节课独立完整原始对象包：有所有学生原始消息、事件、记录、修订和对应上传图片，不更动存储。
router.get('/export/history-session/:sessionId.zip',requireAdmin,async(req,res)=>{
 const sid=String(req.params.sessionId||'').toUpperCase();
 if(!SESSIONS.some(x=>x.id===sid))return res.status(400).json({error:'课次不存在'});
 const pid=String(req.query.participant_id||'').trim().toUpperCase();
 if(pid && !formalIds().includes(pid))return res.status(400).json({error:'只能导出S01–S30正式学生编号'});
 const exportIds=pid?[pid]:formalIds();
 let archive;try{
 archive=openZip(res,`original_history_${sid}${pid?'_'+pid:''}.zip`);
 const stats={session_id:sid,created_at:new Date().toISOString(),storage_namespace:storageService.describe().root_prefix,student_count:exportIds.length,participant_filter:pid||'ALL',raw_objects:0,bytes:0,empty:false,missing_objects:[],note:'正式学生 S01–S30 原始对象和图片；原始路径保留在 objects/ 下。此导出只读，不覆盖原有记录。解压后请妥善保管学生敏感数据。'};
 for(const id of exportIds) {
   for(const prefix of [`participants/${id}/sessions/${sid}/`,`uploads/${id}/${sid}/`]){
     const objects=await storageService.listObjects(prefix,30000);
     for(const item of objects){
       const bytes=await storageService.getObjectBuffer(item.key);
       if(bytes==null){stats.missing_objects.push(item.key);continue;}
       archive.append(bytes,{name:`objects/${item.key}`});stats.raw_objects++;stats.bytes+=bytes.length;
     }
   }
 }
 stats.empty=stats.raw_objects===0;
 archive.append(JSON.stringify(stats,null,2),{name:'MANIFEST.json'});
 archive.append('本ZIP为当前存储命名空间中该课次的实际原始数据，不是自动创建的历史副本。若以前的记录已经丢失或存储命名空间改变，此ZIP不会恢复缺失数据。\\n', {name:'README.txt'});
 await archive.finalize();
 }catch(e){console.error('history raw export',e);if(!res.headersSent)res.status(e.status||500).json({error:e.message||'历史课次导出失败'});else res.destroy(e);}
});

export default router;
