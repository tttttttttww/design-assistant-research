import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { researchService } from '../services/researchService.js';
import { storageService } from '../services/storageService.js';
import { getSessionConfig } from '../config/researchConfig.js';
import { isAllowedParticipant, normalizeParticipantId, isTestParticipant } from '../utils/validators.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg','image/png','image/webp'].includes(file.mimetype)),
});
const ext = f => f.mimetype === 'image/png' ? 'png' : f.mimetype === 'image/webp' ? 'webp' : 'jpg';

router.post('/upload', upload.single('image'), async (req, res) => {
  try {
    const id = normalizeParticipantId(req.body?.participantId);
    const sid = String(req.body?.sessionId || '').toUpperCase();
    const artifactKey = String(req.body?.artifactKey || '');
    if (!isAllowedParticipant(id)) return res.status(403).json({ error: '编号无效' });
    const config = getSessionConfig(sid);
    if (!config) return res.status(400).json({ error: '课次无效' });
    const settings = await researchService.getSettings();
    if (!isTestParticipant(id)) {
      const revision = String(req.headers['x-cohort-revision'] || '');
      if (!revision || revision !== settings.cohort_revision) return res.status(409).json({ error: '学生名单已更新，请返回登录页重新输入编号和姓名。' });
    }
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    if (Array.isArray(settings.locked_session_ids) && settings.locked_session_ids.includes(sid)) return res.status(409).json({ error: '老师已结束并锁定本阶段，不能再上传。' });
    if (!config.artifacts.some(a => a.key === artifactKey)) return res.status(400).json({ error: '上传项目无效' });
    const flowSteps = config.task_flow?.steps || [];
    const flowStepIndex = flowSteps.findIndex(step => (step.artifact_keys || step.required_artifacts || []).includes(artifactKey));
    if (flowStepIndex >= 0) {
      const flowState = await researchService.getTaskFlowState(id, sid, config.task_flow);
      const flowStep = flowSteps[flowStepIndex];
      if (flowStepIndex > 0) {
        const previousStep = flowSteps[flowStepIndex - 1];
        if (!flowState?.completed_steps?.includes(previousStep.key)) {
          return res.status(409).json({ error: `请先完成并提交${previousStep.label}，再上传下一项任务作品。` });
        }
      }
      if (flowState?.completed_steps?.includes(flowStep.key)) return res.status(409).json({ error: '这一任务已提交，相关图片版本已锁定。后续课时请在新的版本记录中继续。' });
    }
    if (!req.file) return res.status(400).json({ error: '请选择 JPG、PNG 或 WEBP 图片' });
    const artifactDefinition=config.artifacts.find(a=>a.key===artifactKey);
    if(artifactDefinition?.version_questionnaire && !String(req.body?.changeNote||'').trim())return res.status(400).json({error:'请先说明本次版本具体做了什么变化/目前做出了什么。'});
    if(artifactDefinition?.version_questionnaire && !req.body?.changeBases)return res.status(400).json({error:'请至少选择一项本次设计/原型形成依据。'});
    if ((await researchService.getSessionRecord(id,sid)).submitted_at) return res.status(409).json({ error:'本节已标记完成，请先点击“继续修改”再上传新版本。' });
    const fileData=req.file.buffer;
    const valid = req.file.mimetype==='image/png'
      ? fileData.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : req.file.mimetype==='image/jpeg'
      ? fileData.length>4 && fileData[0]===255 && fileData[1]===216 && fileData[2]===255
      : fileData.length>12 && fileData.toString('ascii',0,4)==='RIFF' && fileData.toString('ascii',8,12)==='WEBP';
    if(!valid) return res.status(400).json({error:'文件不是有效的JPG/PNG/WEBP图片，请选择正确照片。'});
    // Validate evidence links before writing blobs, avoiding ghost uploads on invalid links.
    const rawAiIds=req.body?.aiMessageIds ?? req.body?.aiMessageId ?? '';
    const aiMessageIds=[...new Set((Array.isArray(rawAiIds)?rawAiIds:[rawAiIds]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,8);
    const availableMessages=aiMessageIds.length ? await researchService.getMessages(id,sid) : [];
    if(aiMessageIds.some(aiId=>!availableMessages.some(x=>x.role==='assistant'&&x.message_id===aiId)))return res.status(400).json({error:'关联的AI回复中有无效记录，请重新选择。'});
    const aiRef=String(req.body?.aiMessageId||aiMessageIds[0]||'');
    const prevRef=String(req.body?.basedOnVersionRef||'');
    if(prevRef){
      const carry=getSessionConfig(sid).carry_from;
      if(!carry || !(Object.values(await researchService.getArtifactVersions(id,carry)).flat()).some(v=>prevRef===`${carry}:${v.version_id}`))return res.status(400).json({error:'上一课作品关联无效，请重新选择。'});
    }
    const fileName = `${artifactKey}_${uuidv4()}.${ext(req.file)}`;
    const filePath = `uploads/${id}/${sid}/${artifactKey}/${fileName}`;
    await storageService.putObject(filePath, req.file.buffer);
    const rawBases=req.body?.changeBases ?? [];
    const allowedBases=new Set(['AI建议','科学知识学习','用户测试或反馈','教师建议','同伴建议','自己的想法','材料/制作条件','其他']);
    const changeBases=[...new Set((Array.isArray(rawBases)?rawBases:[rawBases]).map(x=>String(x||'').trim()).filter(x=>allowedBases.has(x)))].slice(0,8);
    const validStatuses=new Set(['first_version','modified','not_modified','tested_no_change']);
    const validRoles=new Set(['not_used','unsure','direct_adopt','adapted','inspired','viewed_not_adopted']);
    const explicitSource=String(req.body?.changeSource||'');
    const hasAI=changeBases.includes('AI建议');
    const changeSource=['self','ai','teacher','peer','mixed','unknown'].includes(explicitSource)&&explicitSource!=='unknown'
      ? explicitSource : (hasAI ? (changeBases.length>1?'mixed':'ai') : changeBases.includes('教师建议')?'teacher' : changeBases.includes('同伴建议')?'peer' : changeBases.length?'self':'unknown');
    const meta = { file_name: fileName, file_path: filePath, participant_id: id, session_id: sid, artifact_key: artifactKey, mime: req.file.mimetype, uploaded_at: new Date().toISOString(), kind:String(req.body?.kind||''), change_source:changeSource, change_note:String(req.body?.changeNote||''), ai_message_id:aiRef, ai_message_ids:aiMessageIds, based_on_version_ref:String(req.body?.basedOnVersionRef||''), modification_status:validStatuses.has(String(req.body?.modificationStatus||''))?String(req.body.modificationStatus):'', change_bases:changeBases, ai_usage_role:validRoles.has(String(req.body?.aiUsageRole||''))?String(req.body.aiUsageRole):'' };
    res.json({ photo: meta, record: await researchService.addArtifact(id, sid, artifactKey, meta) });
  } catch (e) {
    if (e.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '图片不能超过10MB' });
    res.status(e.status || 500).json({ error: e.message || '图片上传失败' });
  }
});

router.get('/image/:participantId/:sessionId/:artifactKey/:fileName', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    const sid = String(req.params.sessionId || '').toUpperCase();
    const artifactKey = String(req.params.artifactKey || '');
    const fileName = String(req.params.fileName || '');
    if (!isAllowedParticipant(id) || !getSessionConfig(sid)) return res.status(403).end();
    const data = await storageService.getObjectBuffer(`uploads/${id}/${sid}/${artifactKey}/${fileName}`);
    if (!data) return res.status(404).end();
    const mime = fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime); res.setHeader('Cache-Control', 'private,max-age=60'); res.send(data);
  } catch { res.status(500).end(); }
});


router.get('/chat-image/:participantId/:sessionId/:fileName', async (req, res) => {
  try {
    const id = normalizeParticipantId(req.params.participantId);
    const sid = String(req.params.sessionId || '').toUpperCase();
    const fileName = String(req.params.fileName || '');
    if (!isAllowedParticipant(id) || !getSessionConfig(sid)) return res.status(403).end();
    if (!/^chat_[a-f0-9-]+\.(?:jpg|png|webp)$/i.test(fileName)) return res.status(400).end();
    const data = await storageService.getObjectBuffer(`uploads/${id}/${sid}/chat/${fileName}`);
    if (!data) return res.status(404).end();
    const mime = fileName.endsWith('.png') ? 'image/png' : fileName.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public,max-age=300');
    res.send(data);
  } catch { res.status(500).end(); }
});

export default router;
