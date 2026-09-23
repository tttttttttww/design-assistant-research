import express from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { randomInt } from 'node:crypto';
import * as XLSX from 'xlsx';
import { requireAdmin } from '../middleware/auth.js';
import { storageService } from '../services/storageService.js';
import { researchService } from '../services/researchService.js';
import { SESSIONS, QUESTIONNAIRE_ITEMS, QUESTIONNAIRE_META, QUESTIONNAIRE_VERSION } from '../config/researchConfig.js';
import { normalizeParticipantId, validateParticipantId } from '../utils/validators.js';
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
const shuffle = arr => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
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
  try { res.json(await researchService.saveSettings(req.body || {})); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

async function ensureDefaultStudents() {
  for (let i = 1; i <= 30; i++) await researchService.createParticipant(`S${String(i).padStart(2, '0')}`, {});
}
async function allIds(includeTest = true) {
  // 不在每次实时轮询时反复 create/写入30个学生；首次 /participants 的 getParticipant 会自动补缺失账号。
  const ids = formalIds();
  if (includeTest) ids.unshift('S00');
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
router.post('/participants/roster-replace', requireAdmin, async (req, res) => {
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
      if (!validateParticipantId(id) || id === 'S00') { result.push({ line, status: 'invalid' }); continue; }

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
    if (String(req.body?.confirm || '').trim() !== 'RANDOMIZE W2') return res.status(400).json({ error: '请输入 RANDOMIZE W2 才能执行分层随机分组' });
    const participants = [];
    for (const id of formalIds()) participants.push(await researchService.getParticipant(id));
    const missing = participants.filter(p => !['6','7','8'].includes(String(p.grade || '').trim())).map(p => p.participant_id);
    if (missing.length) return res.status(400).json({ error: `以下编号缺少6/7/8年级信息：${missing.join(', ')}` });
    const already = participants.filter(p => ['A','B'].includes(p.condition));
    if (already.length && !req.body?.force) return res.status(409).json({ error: '已有正式学生被分到A/B。为避免误重分，系统已停止；如确需重分请使用force并重新确认。' });

    const groups = new Map();
    for (const p of participants) { const g=String(p.grade); if(!groups.has(g)) groups.set(g,[]); groups.get(g).push(p.participant_id); }
    const assignments = []; let totalA=0,totalB=0;
    for (const grade of ['6','7','8']) {
      const ids = shuffle(groups.get(grade) || []);
      let start = totalA <= totalB ? 'A' : 'B';
      for (let i=0;i<ids.length;i++) {
        const condition = i % 2 === 0 ? start : (start === 'A' ? 'B' : 'A');
        await researchService.setParticipantMeta(ids[i], { condition });
        if (condition==='A') totalA++; else totalB++;
        assignments.push({ participant_id:ids[i], grade, condition });
      }
    }
    const snapshot = { method:'stratified_randomization_by_grade', created_at:new Date().toISOString(), totals:{A:totalA,B:totalB}, assignments };
    await storageService.putObject(`group-assignments/${snapshot.created_at.replace(/[:.]/g,'-')}.json`, JSON.stringify(snapshot,null,2));
    res.json(snapshot);
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
    const all = await storageService.listObjects('', 20000);
    const resets = await researchService.listResetArchives();
    const bySession = Object.fromEntries(SESSIONS.map(s => [s.id, { records: 0, messages: 0, events: 0, revisions: 0 }]));
    for (const row of all) {
      const m = row.key.match(/^participants\/S(?:00|[0-3]\d)\/sessions\/(W\d+)\/(record\.json|chat\/messages\/|events\/|revisions\/)/);
      if (!m || !bySession[m[1]]) continue;
      if (m[2] === 'record.json') bySession[m[1]].records++;
      else if (m[2] === 'chat/messages/') bySession[m[1]].messages++;
      else if (m[2] === 'events/') bySession[m[1]].events++;
      else if (m[2] === 'revisions/') bySession[m[1]].revisions++;
    }
    res.json({ storage: storageService.describe(), object_count: all.length, reset_archive_count: resets.length, by_session: bySession, recent_reset_archives: resets.slice(0, 30).map(x => ({ key: x.key, archived_at: x.data?.archived_at || '', participant_id: x.data?.participant?.participant_id || '', session_id: x.data?.session_config?.id || '', reason: x.data?.archive_reason || '' })) });
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
    if (!SESSIONS.some(s => s.id === sid)) return res.status(400).json({ error: '课次无效' });
    if (String(req.body?.confirm || '') !== `${id}:${sid}`) return res.status(400).json({ error: '确认信息不匹配，未执行重置' });
    res.json(await researchService.archiveAndResetSession(id, sid, { reason: 'single_session_admin_reset' }));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '重置失败' }); }
});

router.post('/session/:sessionId/reset-all', requireAdmin, async (req, res) => {
  try {
    const sid = String(req.params.sessionId || '').toUpperCase();
    if (!SESSIONS.some(s => s.id === sid)) return res.status(400).json({ error: '课次无效' });
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

// ===== 推荐的正式导出：求助过程证据 + 任务作品 + W8后测 + 完整JSON =====
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
            data_json:d,
          });
        }
      }
    }
    const headers = ['participant_id','grade','condition','course_session_id','session_title','message_index','interaction_id','role','content','content_type','message_has_image','image_file_names','image_zip_paths','client_sent_at','server_received_at','ai_request_started_at','ai_response_received_at','ai_latency_ms','task_field_key','task_field_label','task_field_stage','task_context_json','created_at','conversation_id','chat_id','bot_id','model','ai_variant','prompt_version'];
    archive.append(csvText(headers, rows), { name: 'chat_messages.csv' });
    const revisionHeaders = ['participant_id','grade','condition','session_id','session_title','revision_index','field_key','field_label','field_stage','field_revision_no','previous_text','text','created_at','save_reason','last_ai_message_id','last_ai_message_at','seconds_since_last_ai_reply'];
    archive.append(csvText(revisionHeaders, revisionRows), { name: 'task_revisions.csv' });
    const eventHeaders = ['participant_id','grade','condition','session_id','session_title','event_index','type','at','interaction_id','task_field_key','task_field_label','task_field_stage','duration_ms','max_chars','edit_count','current_chars','reason','message_count','dwell_ms','ai_latency_ms','data_json'];
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
      raw_data_json:r.data_json,
    });
    timelineRows.sort((a,b) => String(a.participant_id).localeCompare(String(b.participant_id)) || String(a.session_id).localeCompare(String(b.session_id)) || String(a.event_time).localeCompare(String(b.event_time)) || String(a.source_type).localeCompare(String(b.source_type)));
    let seqKey = '', seq = 0;
    for (const row of timelineRows) {
      const key = `${row.participant_id}|${row.session_id}`;
      if (key !== seqKey) { seqKey = key; seq = 0; }
      row.sequence_order = ++seq;
    }
    const timelineHeaders = ['participant_id','grade','condition','session_id','session_title','sequence_order','event_time','source_type','subtype','interaction_id','message_index','role','content','field_key','field_label','field_stage','previous_text','revised_text','raw_data_json'];
    archive.append(csvText(timelineHeaders, timelineRows), { name: 'process_timeline.csv' });
    archive.append(`正式数据仅含 S01-S30，自动排除 S00。\nchat_messages.csv：学生与AI完整消息，含 interaction_id、真实AI请求/回复时间、ai_latency_ms，以及发送时所在任务步骤字段。\nbehavior_events.csv：输入草稿开始/删除未发送/离开未发送、回看旧回复、查看新反馈等可观察事件；删除草稿正文不会保存。\ntask_revisions.csv：任务文本框V1/V2/V3版本历史，可通过 last_ai_message_id / last_ai_message_at 与AI回复对齐。\nprocess_timeline.csv：把聊天、行为事件、任务修订按学生×课次合并为统一时间线，仅整理原始证据，不自动判定IHS/EHS/AHS。\nchat_images/：学生在允许上传图片的课次中发送给AI的原图；W2关闭聊天图片。\n共导出聊天消息 ${rows.length} 条、版本记录 ${revisionRows.length} 条、行为事件 ${eventRows.length} 条、聊天图片 ${imageCount} 张。\n`, { name: 'README.txt' });
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
    archive.append(`正式数据仅含 S01-S30，自动排除 S00。\ntask_records.csv：每个学生每个课次的当前/最终任务记录。\nworks/：W1及W3以后需要上传的草图、原型、测试证据和最终作品原图；W2不要求最终图片。\n求助过程相关的 behavior_events.csv、task_revisions.csv 与 process_timeline.csv 已统一放入“AI求助过程数据 ZIP”，避免两个工作包重复。\n共 ${rows.length} 条课次记录、${imageCount} 张任务图片。\n`, { name: 'README.txt' });
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
  sendCsv(res, 'chat_messages.csv', ['participant_id','course_session_id','message_index','role','content','content_type','message_has_image','attachments','created_at','conversation_id','chat_id','bot_id','model','ai_variant','prompt_version'], rows);
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
router.get('/export/test-archives.json', requireAdmin, async (req, res) => sendJson(res, 'S00_test_archives.json', await researchService.listTestArchives()));
router.get('/export/reset-archives.json', requireAdmin, async (req, res) => sendJson(res, 'admin_reset_archives.json', await researchService.listResetArchives()));

export default router;
