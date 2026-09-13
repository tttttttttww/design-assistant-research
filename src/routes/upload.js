import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { researchService } from '../services/researchService.js';
import { storageService } from '../services/storageService.js';
import { getSessionConfig } from '../config/researchConfig.js';
import { isAllowedParticipant, normalizeParticipantId } from '../utils/validators.js';

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
    if (!settings.session_open || settings.active_session_id !== sid) return res.status(409).json({ error: '当前不是这个课次。' });
    if (!config.artifacts.some(a => a.key === artifactKey)) return res.status(400).json({ error: '上传项目无效' });
    if (!req.file) return res.status(400).json({ error: '请选择 JPG、PNG 或 WEBP 图片' });
    const fileName = `${artifactKey}_${uuidv4()}.${ext(req.file)}`;
    const filePath = `uploads/${id}/${sid}/${artifactKey}/${fileName}`;
    await storageService.putObject(filePath, req.file.buffer);
    const meta = { file_name: fileName, file_path: filePath, participant_id: id, session_id: sid, artifact_key: artifactKey, mime: req.file.mimetype, uploaded_at: new Date().toISOString() };
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
