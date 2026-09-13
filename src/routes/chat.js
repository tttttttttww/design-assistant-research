import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { cozeService } from '../services/cozeService.js';
import { researchService } from '../services/researchService.js';
import { getSessionConfig } from '../config/researchConfig.js';
import { isAllowedParticipant, normalizeParticipantId, validateMessage } from '../utils/validators.js';

const router = express.Router();

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

router.post('/chat/send', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const message = String(req.body?.message || '');
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    if (!validateMessage(message)) return res.status(400).json({ error: '请输入要发送的内容。' });
    const state = await access(id, sid);
    let s = await researchService.ensureChatSession(id, sid);
    if (s.locked) return res.status(409).json({ error: '本节AI记录已经结束。' });
    await researchService.markFirstUserMessage(id, sid);

    const firstStudentTurn = (s.user_turn_count || 0) === 0;
    const hidden = firstStudentTurn ? `${await researchService.hiddenContextForChat(sid)}\n\n【学生实际输入】\n${message}` : message;
    const ai = await cozeService.sendMessage({
      participantId: id, sessionId: s.session_id, courseSessionId: sid,
      conversationId: s.conversation_id, message: hidden, variant: state.ai_variant,
    });

    await researchService.appendMessage(id, sid, {
      role: 'user', content: message, message_id: uuidv4(), conversation_id: ai.conversation_id,
      chat_id: ai.chat_id, bot_id: ai.bot_id, model: ai.model, ai_variant: state.ai_variant, prompt_version: s.prompt_version,
    });
    s.user_turn_count = (s.user_turn_count || 0) + 1;
    s.conversation_id = ai.conversation_id; s.bot_id = ai.bot_id; s.model = ai.model;
    s.assistant_turn_count = (s.assistant_turn_count || 0) + 1;
    await researchService.saveChatSession(id, sid, s);
    await researchService.appendMessage(id, sid, {
      role: 'assistant', content: ai.assistant_message, message_id: ai.message_id || uuidv4(), conversation_id: ai.conversation_id,
      chat_id: ai.chat_id, bot_id: ai.bot_id, model: ai.model, ai_variant: state.ai_variant, prompt_version: s.prompt_version,
    });
    await researchService.appendEvent(id, sid, 'ai_message_sent', { user_turn_count: s.user_turn_count });
    res.json({ message: ai.assistant_message, session: s });
  } catch (e) {
    console.error('chat send', e);
    res.status(e.status || 500).json({ error: e.message || 'AI暂时没有回复，请再试一次。' });
  }
});

export default router;
