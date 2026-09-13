import express from 'express';
import { researchService } from '../services/researchService.js';
import { isAllowedParticipant, normalizeParticipantId } from '../utils/validators.js';

const router = express.Router();
const pid = req => normalizeParticipantId(req.body?.participantId ?? req.query?.participantId);
const guard = (id, res) => {
  if (!isAllowedParticipant(id)) { res.status(403).json({ error: '编号无效' }); return false; }
  return true;
};

router.get('/session/current', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const settings = await researchService.getSettings();
    if (!settings.session_open) return res.status(409).json({ error: '当前课次还没有开放，请听老师安排。' });
    const state = await researchService.currentState(id);
    res.json(state);
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取任务失败' }); }
});

router.post('/session/save', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await researchService.getSettings();
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    res.json({ record: await researchService.saveFields(id, sid, req.body?.textFields || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '保存失败' }); }
});

router.post('/session/submit', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await researchService.getSettings();
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    res.json({ record: await researchService.submitSession(id, sid, req.body?.textFields || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '提交失败' }); }
});

router.post('/session/event', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const type = String(req.body?.type || '').trim();
    if (!type) return res.status(400).json({ error: 'event type required' });
    res.json({ event: await researchService.appendEvent(id, sid, type, req.body?.data || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '记录失败' }); }
});

export default router;
