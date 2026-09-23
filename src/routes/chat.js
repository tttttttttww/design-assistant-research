import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { cozeService } from '../services/cozeService.js';
import { researchService } from '../services/researchService.js';
import { storageService } from '../services/storageService.js';
import { getSessionConfig } from '../config/researchConfig.js';
import { isAllowedParticipant, normalizeParticipantId, validateMessage } from '../utils/validators.js';

const router = express.Router();
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return cb(Object.assign(new Error('聊天图片仅支持 JPG、PNG 或 WEBP'), { status: 400 }));
    }
    cb(null, true);
  },
});
const ext = file => file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';

async function access(req, id, sid) {
  const settings = await researchService.getSettings();
  if (id !== 'S00') {
    const revision = String(req.headers['x-cohort-revision'] || '');
    if (!revision || revision !== settings.cohort_revision) throw Object.assign(new Error('学生名单已更新，请返回登录页重新输入编号和姓名。'), { status: 409 });
  }
  if (!settings.session_open) throw Object.assign(new Error('当前课次还没有开放。'), { status: 409 });
  if (settings.active_session_id !== sid) throw Object.assign(new Error('当前不是这个课次。'), { status: 409 });
  const config = getSessionConfig(sid);
  if (!config || config.ai_mode === 'none') throw Object.assign(new Error('本节课没有AI助手。'), { status: 409 });
  await researchService.assertTaskAccess(id, sid);
  const state = await researchService.currentState(id);
  if (state.record.submitted_at) throw Object.assign(new Error('本节任务已经提交。'), { status: 409 });
  if (state.ai_variant === 'unassigned') throw Object.assign(new Error('本课已进入分组阶段，但你的组别尚未配置，请联系老师。'), { status: 409 });
  return state;
}

function imageUrl(req, id, sid, fileName) {
  const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const proto = forwarded || req.protocol || 'https';
  const base = configured || `${proto}://${req.get('host')}`;
  return `${base}/express/api/chat-image/${encodeURIComponent(id)}/${encodeURIComponent(sid)}/${encodeURIComponent(fileName)}`;
}

function safeTaskContext(raw, config) {
  let parsed = {};
  try { parsed = raw ? JSON.parse(String(raw)) : {}; } catch { parsed = {}; }
  const key = String(parsed?.field_key || '').slice(0, 120);
  const field = (config?.fields || []).find(f => f.key === key);
  const completed = Array.isArray(parsed?.completed_field_keys)
    ? parsed.completed_field_keys.map(x => String(x)).filter(x => (config?.fields || []).some(f => f.key === x)).slice(0, 30)
    : [];
  return {
    field_key: field?.key || '',
    field_label: field?.label || '',
    field_stage: field?.stage || '',
    main_update_revealed: Boolean(parsed?.main_update_revealed),
    bonus_task_revealed: Boolean(parsed?.bonus_task_revealed),
    bonus_update_revealed: Boolean(parsed?.bonus_update_revealed),
    completed_field_keys: completed,
  };
}

router.get('/chat/state', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.query.participantId);
    const sid = String(req.query.sessionId || '').toUpperCase();
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    const state = await access(req, id, sid);
    res.json({ session: await researchService.getChatSession(id, sid), messages: await researchService.getMessages(id, sid), ai_variant: state.ai_variant });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取聊天失败' }); }
});

router.post('/chat/open', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    const state = await access(req, id, sid);
    const result = await researchService.markAiOpened(id, sid);
    const s = result.session;
    if (!s.bot_id) {
      s.bot_id = cozeService.botId(state.ai_variant);
      s.model = cozeService.modelName();
      await researchService.saveChatSession(id, sid, s);
    }
    res.json({ session: s, messages: await researchService.getMessages(id, sid), ai_variant: state.ai_variant, record: result.record });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '打开AI失败' }); }
});

router.post('/chat/send', imageUpload.single('image'), async (req, res) => {
  let uploadedPath = '';
  let committed = false;
  let activeId = '';
  let activeSid = '';
  let interactionId = '';
  let userMessageRow = null;
  const serverReceivedAt = new Date().toISOString();
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    activeId = id; activeSid = sid;
    const message = String(req.body?.message || '');
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    if (!validateMessage(message)) return res.status(400).json({ error: '请用文字告诉AI你想让它帮你看什么。' });
    const state = await access(req, id, sid);
    const config = getSessionConfig(sid);
    const taskContext = safeTaskContext(req.body?.taskContext, config);
    const clientSentAt = String(req.body?.clientSentAt || '').trim();
    if (req.file && config?.chat_image_enabled === false) return res.status(400).json({ error: '本节任务不使用聊天图片，请直接用文字与AI交流。' });
    let s = await researchService.ensureChatSession(id, sid);
    if (s.locked) return res.status(409).json({ error: '本节AI记录已经结束。' });

    let attachment = null;
    let publicImageUrl = '';
    if (req.file) {
      const fileName = `chat_${uuidv4()}.${ext(req.file)}`;
      uploadedPath = `uploads/${id}/${sid}/chat/${fileName}`;
      await storageService.putObject(uploadedPath, req.file.buffer);
      publicImageUrl = imageUrl(req, id, sid, fileName);
      attachment = {
        type: 'image', file_name: fileName, file_path: uploadedPath, mime: req.file.mimetype,
        participant_id: id, session_id: sid, uploaded_at: new Date().toISOString(),
      };
    }

    const updatedRecord = await researchService.markFirstUserMessage(id, sid);
    const firstStudentTurn = (s.user_turn_count || 0) === 0;
    const hidden = firstStudentTurn ? `${await researchService.hiddenContextForChat(sid)}\n\n【学生实际输入】\n${message}` : message;
    interactionId = uuidv4();
    const aiRequestStartedAt = new Date().toISOString();

    // 先落盘学生消息，再等待AI。这样教师后台能在AI思考期间实时看到学生刚刚问了什么。
    userMessageRow = await researchService.appendMessage(id, sid, {
      role: 'user', content: message, content_type: attachment ? 'text+image' : 'text',
      message_has_image: Boolean(attachment), attachments: attachment ? [attachment] : [],
      message_id: uuidv4(), conversation_id: s.conversation_id || '', chat_id: '',
      bot_id: s.bot_id || '', model: s.model || '', ai_variant: state.ai_variant, prompt_version: s.prompt_version,
      interaction_id: interactionId, created_at: serverReceivedAt,
      client_sent_at: clientSentAt, server_received_at: serverReceivedAt,
      ai_request_started_at: aiRequestStartedAt, ai_response_received_at: '', ai_latency_ms: null,
      task_field_key: taskContext.field_key, task_field_label: taskContext.field_label, task_field_stage: taskContext.field_stage, task_context: taskContext,
    });
    committed = true;
    s.user_turn_count = (s.user_turn_count || 0) + 1;
    s.processing = true;
    s.processing_started_at = aiRequestStartedAt;
    s.processing_interaction_id = interactionId;
    s.last_student_message_at = serverReceivedAt;
    s.last_student_message_preview = message.replace(/\s+/g,' ').trim().slice(0,120);
    s.last_task_field_key = taskContext.field_key || '';
    s.last_task_field_label = taskContext.field_label || '';
    s.last_task_field_stage = taskContext.field_stage || '';
    s.chat_image_count = Number(s.chat_image_count || 0) + (attachment ? 1 : 0);
    s.last_error_at = '';
    s.last_error_message = '';
    await researchService.saveChatSession(id, sid, s);
    await researchService.appendEvent(id, sid, 'ai_request_started', {
      interaction_id: interactionId,
      task_field_key: taskContext.field_key,
      task_field_label: taskContext.field_label,
      task_field_stage: taskContext.field_stage,
    });

    const ai = await cozeService.sendMessage({
      participantId: id,
      sessionId: s.session_id,
      courseSessionId: sid,
      conversationId: s.conversation_id,
      message: hidden,
      image: req.file ? { buffer: req.file.buffer, fileName: attachment?.file_name, mime: req.file.mimetype } : null,
      imageUrl: publicImageUrl,
      variant: state.ai_variant,
    });
    const aiResponseReceivedAt = new Date().toISOString();
    const aiLatencyMs = Math.max(0, Date.parse(aiResponseReceivedAt) - Date.parse(aiRequestStartedAt));
    if (attachment && ai.coze_file_id) attachment.coze_file_id = ai.coze_file_id;

    userMessageRow = await researchService.updateMessage(id, sid, userMessageRow.message_index, {
      conversation_id: ai.conversation_id, chat_id: ai.chat_id, bot_id: ai.bot_id, model: ai.model,
      attachments: attachment ? [attachment] : [],
      ai_response_received_at: aiResponseReceivedAt, ai_latency_ms: aiLatencyMs,
    }) || userMessageRow;

    s.conversation_id = ai.conversation_id;
    s.bot_id = ai.bot_id;
    s.model = ai.model;
    s.assistant_turn_count = (s.assistant_turn_count || 0) + 1;
    s.processing = false;
    s.processing_started_at = '';
    s.processing_interaction_id = '';
    s.last_response_at = aiResponseReceivedAt;
    await researchService.saveChatSession(id, sid, s);
    const assistantMessageRow = await researchService.appendMessage(id, sid, {
      role: 'assistant', content: ai.assistant_message, content_type: 'text', message_has_image: false, attachments: [],
      message_id: ai.message_id || uuidv4(), conversation_id: ai.conversation_id, chat_id: ai.chat_id,
      bot_id: ai.bot_id, model: ai.model, ai_variant: state.ai_variant, prompt_version: s.prompt_version,
      interaction_id: interactionId, created_at: aiResponseReceivedAt,
      client_sent_at: clientSentAt, server_received_at: serverReceivedAt,
      ai_request_started_at: aiRequestStartedAt, ai_response_received_at: aiResponseReceivedAt, ai_latency_ms: aiLatencyMs,
      task_field_key: taskContext.field_key, task_field_label: taskContext.field_label, task_field_stage: taskContext.field_stage, task_context: taskContext,
    });
    await researchService.appendEvent(id, sid, 'ai_request_completed', {
      interaction_id: interactionId, ai_latency_ms: aiLatencyMs,
      task_field_key: taskContext.field_key, task_field_label: taskContext.field_label, task_field_stage: taskContext.field_stage,
    });
    await researchService.appendEvent(id, sid, 'ai_message_sent', {
      interaction_id: interactionId,
      user_turn_count: s.user_turn_count,
      message_has_image: Boolean(attachment),
      image_file_name: attachment?.file_name || '',
      client_sent_at: clientSentAt,
      server_received_at: serverReceivedAt,
      ai_request_started_at: aiRequestStartedAt,
      ai_response_received_at: aiResponseReceivedAt,
      ai_latency_ms: aiLatencyMs,
      task_field_key: taskContext.field_key,
      task_field_label: taskContext.field_label,
      task_field_stage: taskContext.field_stage,
    });
    res.json({ message: ai.assistant_message, session: s, attachment, record: updatedRecord, user_message: userMessageRow, assistant_message_row: assistantMessageRow });
  } catch (e) {
    const attemptedId = activeId || normalizeParticipantId(req.body?.participantId);
    if (activeId && activeSid && interactionId) {
      try {
        const s = await researchService.getChatSession(activeId, activeSid);
        if (s) {
          s.processing = false;
          s.processing_started_at = '';
          s.processing_interaction_id = '';
          s.last_error_at = new Date().toISOString();
          s.last_error_message = String(e?.message || 'AI请求失败').slice(0, 300);
          await researchService.saveChatSession(activeId, activeSid, s);
        }
        if (userMessageRow?.message_index) await researchService.updateMessage(activeId, activeSid, userMessageRow.message_index, { request_failed: true, request_error: String(e?.message || 'AI请求失败').slice(0, 300) });
        await researchService.appendEvent(activeId, activeSid, 'ai_request_failed', { interaction_id: interactionId, error: String(e?.message || 'AI请求失败').slice(0, 300) });
      } catch (_) {}
    }
    // 只有尚未形成正式消息的失败上传才清理；已落盘的学生消息保留为研究原始证据。
    if (uploadedPath && !committed && attemptedId !== 'S00') await storageService.deleteObject(uploadedPath).catch(() => {});
    console.error('chat send', { message: e?.message, stage: e?.stage, chat_id: e?.chat_id, coze_file_id: e?.coze_file_id, raw: e?.raw || null, stack: e?.stack });
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '聊天图片不能超过10MB' });
    if (attemptedId === 'S00') {
      return res.status(e.status || 500).json({
        error: e.message || 'AI暂时没有回复，请再试一次。',
        debug: { stage: e?.stage || '', chat_id: e?.chat_id || '', coze_file_id: e?.coze_file_id || '' },
      });
    }
    res.status(e.status || 500).json({ error: 'AI暂时没有回复，请稍后再试。' });
  }
});

export default router;
