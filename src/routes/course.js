import express from 'express';
import { researchService } from '../services/researchService.js';
import { isAllowedParticipant, normalizeParticipantId, isTestParticipant } from '../utils/validators.js';
import { getSessionConfig } from '../config/researchConfig.js';
import { peerReviewCandidates, reviewsByAuthor, reviewsForTarget, savePeerReview } from '../services/peerReviewService.js';

const router = express.Router();
const pid = req => normalizeParticipantId(req.body?.participantId ?? req.query?.participantId);
const guard = (id, res) => {
  if (!isAllowedParticipant(id)) { res.status(403).json({ error: '编号无效' }); return false; }
  return true;
};
const cohortGuard = async (req, id, res) => {
  const settings = await researchService.getSettings();
  if (!isTestParticipant(id)) {
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


router.post('/session/orientation/start', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    res.json({ orientation: await researchService.startOrientation(id, sid) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '打开本节内容失败，请刷新页面重试。' }); }
});

router.post('/session/orientation/complete', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    const orientation = await researchService.completeOrientation(id, sid, req.body?.answers || {});
    // 明确返回完成状态，前端据此清除 learning_gate 并进入下一环节；不依赖页面自行猜测。
    res.json({ orientation, completed: Boolean(orientation.completed_at), learning_gate: '' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '保存失败，请稍后重试。' }); }
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

router.post('/session/step-submit', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    await researchService.assertTaskAccess(id, sid);
    const result = await researchService.submitTaskStep(id, sid, String(req.body?.stepKey || ''), req.body?.textFields || {}, req.body?.saveContext || {});
    res.json(result);
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '提交任务环节失败' }); }
});

router.post('/session/submit', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    if (getSessionConfig(sid)?.task_flow?.steps?.length) {
      return res.status(409).json({ error: '本课需要按任务阶段提交，请使用任务页面中的分阶段提交按钮。' });
    }
    await researchService.assertTaskAccess(id, sid);
    res.json({ record: await researchService.submitSession(id, sid, req.body?.textFields || {}, req.body?.saveContext || {}) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '提交失败' }); }
});

router.post('/session/reopen', async (req, res) => {
  try {
    const id = pid(req); if (!guard(id, res)) return;
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const settings = await cohortGuard(req, id, res); if (!settings) return;
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    await researchService.assertTaskAccess(id, sid);
    res.json({ record: await researchService.reopenSession(id, sid) });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '继续修改失败' }); }
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
    const data = req.body?.data || {};
    const event = await researchService.appendEvent(id, sid, type, data);
    // 仅把草稿的“状态元数据”同步到课次记录，绝不保存未发送草稿正文。
    await researchService.updateLiveDraftState(id, sid, type, data);
    res.json({ event });
  } catch (e) { res.status(e.status || 500).json({ error: e.message || '记录失败' }); }
});

// Lesson 8: class-only pseudonymous gallery. Only published artifacts are visible.
const peerGuard=async(req,res)=>{
  const id=pid(req);if(!guard(id,res))return null;
  const settings=await cohortGuard(req,id,res);if(!settings)return null;
  if(!settings.session_open||settings.active_session_id!=='W8'){
    res.status(409).json({error:'班级作品互评仅在第8节开放时可查看。'});return null;
  }
  const progress=await researchService.getTaskFlowState(id,'W8');
  if(!progress?.completed_steps?.includes('task1')){
    res.status(409).json({error:'先完成并发布自己的作品，再查看班级作品墙。'});return null;
  }
  return id;
};
async function peerGallery(id){
  const ids=peerReviewCandidates(id);
  const rows=await Promise.all(ids.map(async target=>{
    const progress=await researchService.getTaskFlowState(target,'W8');
    if(!progress?.completed_steps?.includes('task1'))return null;
    const r=await researchService.getSessionRecord(target,'W8');
    const photo=r.artifacts?.l08_showcase_photo;
    if(!photo?.file_name)return null;
    const f=r.text_fields||{};
    return {student_id:target,photo_url:`/express/api/image/${target}/W8/l08_showcase_photo/${encodeURIComponent(photo.file_name)}`,
      steps:{empathize:String(f.l08_dt_empathize||'').slice(0,600),define:String(f.l08_dt_define||'').slice(0,600),
      ideate:String(f.l08_dt_ideate||'').slice(0,600),prototype:String(f.l08_dt_prototype||'').slice(0,600),
      test:String(f.l08_dt_test||'').slice(0,600),reflection:String(f.l08_dt_reflection||'').slice(0,600)}};
  }));
  return rows.filter(Boolean);
}
router.get('/peer/gallery',async(req,res)=>{
  try{
    const id=await peerGuard(req,res);if(!id)return;
    const [cards,mine,received]=await Promise.all([peerGallery(id),reviewsByAuthor(id),reviewsForTarget(id)]);
    res.setHeader('Cache-Control','no-store');res.json({cards,mine,received,viewer:id});
  }catch(e){res.status(e.status||500).json({error:e.message||'作品墙读取失败'});}
});
router.post('/peer/review',async(req,res)=>{
  try{
    const id=await peerGuard(req,res);if(!id)return;
    await researchService.assertSessionWritable('W8');
    const existing=await researchService.getSessionRecord(id,'W8');
    if(existing.submitted_at)return res.status(409).json({error:'本节已提交，如需修改评价请先请老师解锁本节。'});
    const cards=await peerGallery(id);
    const row=await savePeerReview({from:id,to:String(req.body?.target||'').toUpperCase(),
      strength:req.body?.strength,question:req.body?.question,suggestion:req.body?.suggestion,
      allowedTargets:cards.map(x=>x.student_id)});
    await researchService.appendEvent(id,'W8','peer_review_submitted',{target_student_id:row.to,revision:row.revision,has_question:true,has_suggestion:true});
    res.json({review:row});
  }catch(e){res.status(e.status||500).json({error:e.message||'同伴评价保存失败'});}
});

export default router;
