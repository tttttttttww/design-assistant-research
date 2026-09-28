import express from 'express';
import {
  isAllowedParticipant,
  normalizeParticipantId,
  isTestParticipant,
  hashStudentName,
  normalizeStudentName,
} from '../utils/validators.js';
import { researchService } from '../services/researchService.js';

const router = express.Router();
router.post('/validate', async (req, res) => {
  try {
    const participantId = normalizeParticipantId(req.body?.participantId ?? req.body?.studentId);
    const studentName = normalizeStudentName(req.body?.studentName ?? req.body?.name);

    if (!isAllowedParticipant(participantId)) {
      return res.status(400).json({ valid: false, message: '编号或姓名不匹配，请对照老师展示的名单确认。' });
    }

    // S00（实验组）和 S99（对照组）只用于教师测试，不进入正式数据。正式学生必须同时通过“编号 + 姓名”核对。
    if (!isTestParticipant(participantId)) {
      if (!studentName) {
        return res.status(400).json({ valid: false, message: '请输入你的姓名。' });
      }
      const participant = await researchService.getParticipant(participantId);
      if (!participant.login_name_hash) {
        return res.status(409).json({ valid: false, message: '该编号的姓名名单尚未由老师录入，请先联系老师。' });
      }
      if (hashStudentName(studentName, participantId) !== participant.login_name_hash) {
        return res.status(400).json({ valid: false, message: '编号或姓名不匹配，请对照老师展示的名单确认。' });
      }
    }

    // 教师测试号必须用于验证“退出 / 重新登录 / 更新部署后记录仍然存在”。
    // 因此登录时绝不能自动归档并清空 S00/S99。需要新一轮测试时，由教师在后台显式重置。
    const testInfo = isTestParticipant(participantId) ? { preserved: true } : null;
    await researchService.touchParticipant(participantId);
    const settings = await researchService.getSettings();
    res.json({
      valid: true,
      participant_id: participantId,
      is_test: isTestParticipant(participantId),
      test_info: testInfo,
      active_session_id: settings.active_session_id,
      cohort_revision: settings.cohort_revision,
    });
  } catch (e) {
    console.error('validate', e);
    res.status(500).json({ valid: false, message: '暂时无法进入，请稍后重试。' });
  }
});
export default router;
