import express from 'express';
import archiver from 'archiver';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/auth.js';
import { storageService } from '../services/storageService.js';
import { researchService } from '../services/researchService.js';
import { SESSIONS } from '../config/researchConfig.js';
import { normalizeParticipantId, validateParticipantId } from '../utils/validators.js';

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
  await ensureDefaultStudents();
  const ids = formalIds();
  if (includeTest) ids.unshift('S00');
  return ids;
}
async function summary(id) {
  const p = await researchService.getParticipant(id);
  const settings = await researchService.getSettings();
  const r = await researchService.getSessionRecord(id, settings.active_session_id);
  const c = await researchService.getChatSession(id, settings.active_session_id);
  const messages = await researchService.getMessages(id, settings.active_session_id);
  const chatImageCount = messages.filter(m => m.role === 'user' && m.message_has_image).length;
  const artifactCount = Object.keys(r.artifacts || {}).length;
  return {
    participant_id: id,
    condition: p.condition,
    grade: p.grade,
    is_test: p.is_test,
    active_session_id: settings.active_session_id,
    started: Boolean(r.started_at),
    ai_used: Boolean(r.ai_used),
    first_ai_open_latency_seconds: r.first_ai_open_latency_seconds,
    first_user_message_latency_seconds: r.first_user_message_latency_seconds,
    user_turn_count: c?.user_turn_count || 0,
    chat_image_count: chatImageCount,
    artifact_count: artifactCount,
    submitted: Boolean(r.submitted_at),
    last_active_at: p.last_active_at,
  };
}

router.get('/participants', requireAdmin, async (req, res) => {
  try {
    const rows = [];
    for (const id of await allIds(true)) rows.push(await summary(id));
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '读取学生列表失败' });
  }
});
router.post('/participants/create-default', requireAdmin, async (req, res) => {
  await ensureDefaultStudents();
  res.json({ created_or_checked: 30 });
});
router.post('/participant/:participantId/meta', requireAdmin, async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    if (!validateParticipantId(id)) return res.status(400).json({ error: '编号无效' });
    res.json(await researchService.setParticipantMeta(id, { condition: req.body?.condition, grade: req.body?.grade }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || '保存失败' });
  }
});
router.post('/participants/bulk-meta', requireAdmin, async (req, res) => {
  try {
    const lines = String(req.body?.text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const result = [];
    for (const line of lines) {
      const parts = line.split(/[\t,， ]+/).filter(Boolean);
      const id = normalizeParticipantId(parts[0]);
      if (!validateParticipantId(id) || id === 'S00') { result.push({ line, status: 'invalid' }); continue; }
      const grade = parts[1] || '';
      const condition = parts[2] || 'unassigned';
      try {
        await researchService.setParticipantMeta(id, { grade, condition });
        result.push({ participant_id: id, grade, condition, status: 'ok' });
      } catch { result.push({ line, status: 'invalid' }); }
    }
    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: e.message || '批量更新失败' });
  }
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
  for (const id of formalIds()) out.push(await researchService.getCompleteParticipantData(id));
  return out;
}

// ===== 推荐的正式导出：只保留两个工作包 + 一个完整 JSON 备份 =====
router.get('/export/chat-package.zip', requireAdmin, async (req, res) => {
  let archive;
  try {
    archive = openZip(res, 'AI_chat_and_images.zip');
    const rows = [];
    let imageCount = 0;
    for (const id of formalIds()) {
      const participant = await researchService.getParticipant(id);
      for (const s of SESSIONS) {
        const messages = await researchService.getMessages(id, s.id);
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
            role: m.role,
            content: m.content,
            content_type: m.content_type,
            message_has_image: m.message_has_image,
            image_file_names: imageNames.join('; '),
            image_zip_paths: imageZipPaths.join('; '),
            created_at: m.created_at,
            conversation_id: m.conversation_id,
            chat_id: m.chat_id,
            bot_id: m.bot_id,
            model: m.model,
            ai_variant: m.ai_variant,
            prompt_version: m.prompt_version,
          });
        }
      }
    }
    const headers = ['participant_id','grade','condition','course_session_id','session_title','message_index','role','content','content_type','message_has_image','image_file_names','image_zip_paths','created_at','conversation_id','chat_id','bot_id','model','ai_variant','prompt_version'];
    archive.append(csvText(headers, rows), { name: 'chat_messages.csv' });
    archive.append(`正式数据仅含 S01-S30，自动排除 S00。\nchat_messages.csv 与 chat_images/ 中的图片通过 image_zip_paths 一一对应。\n共导出聊天消息 ${rows.length} 条，聊天图片 ${imageCount} 张。\n`, { name: 'README.txt' });
    await archive.finalize();
  } catch (e) {
    console.error('chat package export', e);
    if (!res.headersSent) res.status(500).json({ error: 'AI聊天与图片导出失败' });
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
    archive.append(`正式数据仅含 S01-S30，自动排除 S00。\ntask_records.csv 与 works/ 中的作品、证据图片通过 work_zip_paths 一一对应。\n每个学生每个课次一行，共 ${rows.length} 行；共导出作品/任务图片 ${imageCount} 张。\n`, { name: 'README.txt' });
    await archive.finalize();
  } catch (e) {
    console.error('task package export', e);
    if (!res.headersSent) res.status(500).json({ error: '任务记录与作品导出失败' });
    else res.destroy(e);
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
