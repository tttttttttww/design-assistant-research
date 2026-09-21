import express from 'express';
import { researchService } from '../services/researchService.js';
import { isAllowedParticipant, normalizeParticipantId } from '../utils/validators.js';

const router = express.Router();
const pid = req => normalizeParticipantId(req.body?.participantId ?? req.query?.participantId);
const guard = (id, res) => {
  if (!isAllowedParticipant(id)) { res.status(403).json({ error: '编号无效' }); return false; }
  return true;
};
const cohortGuard = async (req, id, res) => {
  const settings = await researchService.getSettings();
  if (id !== 'S00') {
    const revision = String(req.headers['x-cohort-revision'] || '');
    if (!revision || revision !== settings.cohort_revision) {
      res.status(409).json({ error: '学生名单已更新，请返回登录页重新输入编号和姓名。' });
      return null;
    }
  }
  return settings;
};

router.get('/session/current', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open) return res.status(409).json({ error: '当前课次还没有开放，请听老师安排。' });
    const state = await researchService.currentState(id);
    res.json(state);
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取任务失败' }); }
});

router.post('/session/save', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    await researchService.assertTaskAccess(id, sid);
    res.json({ record: await researchService.saveFields(id, sid, req.body?.textFields || {}, req.body?.saveContext || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '保存失败' }); }
});

router.post('/session/submit', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    await researchService.assertTaskAccess(id, sid);
    res.json({ record: await researchService.submitSession(id, sid, req.body?.textFields || {}, req.body?.saveContext || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '提交失败' }); }
});


router.get('/questionnaire/:slot', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.questionnaire_enabled) return res.status(409).json({ error: '问卷模块尚未开放。' });
    const slot = String(req.params.slot || '').toLowerCase();
    res.json(await researchService.questionnairePublicState(id, slot));
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '读取问卷失败' }); }
});

router.post('/questionnaire/:slot', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.questionnaire_enabled) return res.status(409).json({ error: '问卷模块尚未开放。' });
    const slot = String(req.params.slot || '').toLowerCase();
    const row = await researchService.submitQuestionnaire(id, slot, req.body?.responses || {});
    res.json({ questionnaire: row });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '提交问卷失败' }); }
});

router.post('/session/event', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    const type = String(req.body?.type || '').trim();
    if (!type) return res.status(400).json({ error: 'event type required' });
    res.json({ event: await researchService.appendEvent(id, sid, type, req.body?.data || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '记录失败' }); }
});

export default router;
