import { readFile, access } from 'node:fs/promises';
const must = [
  'public/index.html','public/task.html','public/admin.html','public/js/task.js','public/js/admin.js',
  'src/config/researchConfig.js','src/services/researchService.js','src/services/cozeService.js',
  'src/routes/course.js','src/routes/chat.js','src/routes/upload.js','src/routes/admin.js','cloud-functions/express/[[default]].js'
];
for (const f of must) await access(f);
const cfg = await import('../src/config/researchConfig.js');
if (cfg.SESSIONS.length !== 12) throw new Error(`Expected 12 sessions, got ${cfg.SESSIONS.length}`);
const ids = cfg.SESSIONS.map(x=>x.id);
if (new Set(ids).size !== 12) throw new Error('Duplicate session ids');
for (const s of cfg.SESSIONS) {
  if (!s.title || !Array.isArray(s.brief) || !Array.isArray(s.fields) || !Array.isArray(s.artifacts)) throw new Error(`Bad session config ${s.id}`);
  if (!['free','condition','none'].includes(s.ai_mode)) throw new Error(`Bad ai_mode ${s.id}`);
}
const task = await readFile('public/js/task.js','utf8');
const chat = await readFile('src/routes/chat.js','utf8');
const coze = await readFile('src/services/cozeService.js','utf8');
const admin = await readFile('public/js/admin.js','utf8');
const adminRoute = await readFile('src/routes/admin.js','utf8');
if (!task.includes('chatImage') || !task.includes('FormData')) throw new Error('Student chat image UI missing');
if (!chat.includes("imageUpload.single('image')") || !chat.includes('message_has_image')) throw new Error('Chat image route missing');
if (!coze.includes("content_type: 'object_string'") || !coze.includes("type: 'image'")) throw new Error('Coze multimodal payload missing');
if (!admin.includes('chat_image_count') || !adminRoute.includes('chat-attachments.csv')) throw new Error('Admin image data collection missing');
if (!admin.includes('resetCurrentAll') || !adminRoute.includes('reset-all') || !adminRoute.includes('reset-archives.json')) throw new Error('Admin reset controls missing');
console.log('CHECK OK: 12 sessions + admin dashboard + multimodal AI chat + exports + dual AI routing + safe reset controls.');
