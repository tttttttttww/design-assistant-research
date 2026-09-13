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

async function access(id, sid) {
  const settings = await researchService.getSettings();
  if (!settings.session_open) throw Object.assign(new Error('当前课次还没有开放。'), { status: 409 });
  if (settings.active_session_id !== sid) throw Object.assign(new Error('当前不是这个课次。'), { status: 409 });
  const config = getSessionConfig(sid);
  if (!config || config.ai_mode === 'none') throw Object.assign(new Error('本节课没有AI助手。'), { status: 409 });
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

router.get('/chat/state', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.query.participantId);
    const sid = String(req.query.sessionId || '').toUpperCase();
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    const state = await access(id, sid);
    res.json({ session: await researchService.getChatSession(id, sid), messages: await researchService.getMessages(id, sid), ai_variant: state.ai_variant });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取聊天失败' }); }
});

router.post('/chat/open', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    const state = await access(id, sid);
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
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const message = String(req.body?.message || '');
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    if (!validateMessage(message)) return res.status(400).json({ error: '请用文字告诉AI你想让它帮你看什么。' });
    const state = await access(id, sid);
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

    if (attachment && ai.coze_file_id) attachment.coze_file_id = ai.coze_file_id;

    await researchService.appendMessage(id, sid, {
      role: 'user', content: message, content_type: attachment ? 'text+image' : 'text',
      message_has_image: Boolean(attachment), attachments: attachment ? [attachment] : [],
      message_id: uuidv4(), conversation_id: ai.conversation_id, chat_id: ai.chat_id,
      bot_id: ai.bot_id, model: ai.model, ai_variant: state.ai_variant, prompt_version: s.prompt_version,
    });
    committed = true;
    s.user_turn_count = (s.user_turn_count || 0) + 1;
    s.conversation_id = ai.conversation_id;
    s.bot_id = ai.bot_id;
    s.model = ai.model;
    s.assistant_turn_count = (s.assistant_turn_count || 0) + 1;
    await researchService.saveChatSession(id, sid, s);
    await researchService.appendMessage(id, sid, {
      role: 'assistant', content: ai.assistant_message, content_type: 'text', message_has_image: false, attachments: [],
      message_id: ai.message_id || uuidv4(), conversation_id: ai.conversation_id, chat_id: ai.chat_id,
      bot_id: ai.bot_id, model: ai.model, ai_variant: state.ai_variant, prompt_version: s.prompt_version,
    });
    await researchService.appendEvent(id, sid, 'ai_message_sent', {
      user_turn_count: s.user_turn_count,
      message_has_image: Boolean(attachment),
      image_file_name: attachment?.file_name || '',
    });
    res.json({ message: ai.assistant_message, session: s, attachment, record: updatedRecord });
  } catch (e) {
    const attemptedId = normalizeParticipantId(req.body?.participantId);
    // Keep failed S00 image locally for teacher debugging; formal-student failed uploads are cleaned as before.
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
