import express from 'express';
import { isAllowedParticipant, normalizeParticipantId, isTestParticipant } from '../utils/validators.js';
import { researchService } from '../services/researchService.js';

const router = express.Router();
router.post('/validate', async (req, res) => {
  try {
    const participantId = normalizeParticipantId(req.body?.participantId ?? req.body?.studentId);
    if (!isAllowedParticipant(participantId)) return res.status(400).json({ valid: false, message: '编号不正确，请对照老师给出的名单确认。' });
    let testInfo = null;
    if (isTestParticipant(participantId)) testInfo = await researchService.archiveAndResetTest();
    await researchService.touchParticipant(participantId);
    const settings = await researchService.getSettings();
    res.json({ valid: true, participant_id: participantId, is_test: isTestParticipant(participantId), test_info: testInfo, active_session_id: settings.active_session_id });
  } catch (e) {
    console.error('validate', e); res.status(500).json({ valid: false, message: '暂时无法进入，请稍后重试。' });
  }
});
export default router;
