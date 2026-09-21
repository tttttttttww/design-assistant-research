import { readFile, access } from 'node:fs/promises';
const must = [
  'public/index.html','public/task.html','public/admin.html','public/js/task.js','public/js/admin.js',
  'src/config/researchConfig.js','src/services/researchService.js','src/services/cozeService.js',
  'src/routes/course.js','src/routes/chat.js','src/routes/upload.js','src/routes/admin.js','cloud-functions/express/[[default]].js'
];
for (const f of must) await access(f);
const cfg = await import('../src/config/researchConfig.js');
if (cfg.SESSIONS.length !== 13) throw new Error(`Expected 13 sessions, got ${cfg.SESSIONS.length}`);
const ids = cfg.SESSIONS.map(x=>x.id);
if (new Set(ids).size !== 13) throw new Error('Duplicate session ids');

const w2 = cfg.SESSIONS.find(x=>x.id==='W2');
if (!w2 || w2.ai_mode!=='free' || w2.phase!=='pilot' || (w2.artifacts||[]).length) throw new Error('W2 pilot/free/no-upload config invalid');
if (!w2.bonus_task || !(w2.fields||[]).some(f=>f.stage==='bonus_before')) throw new Error('W2 optional locker bonus task missing');
for (const s of cfg.SESSIONS) {
  if (!s.title || !Array.isArray(s.brief) || !Array.isArray(s.fields) || !Array.isArray(s.artifacts)) throw new Error(`Bad session config ${s.id}`);
  if (!['free','condition','none'].includes(s.ai_mode)) throw new Error(`Bad ai_mode ${s.id}`);
}
const task = await readFile('public/js/task.js','utf8');
const chat = await readFile('src/routes/chat.js','utf8');
const coze = await readFile('src/services/cozeService.js','utf8');
const admin = await readFile('public/js/admin.js','utf8');
const adminRoute = await readFile('src/routes/admin.js','utf8');
const indexHtml = await readFile('public/index.html','utf8');
const authRoute = await readFile('src/routes/auth.js','utf8');
const validators = await readFile('src/utils/validators.js','utf8');
const rosterImport = await readFile('src/utils/rosterImport.js','utf8');
const adminHtml = await readFile('public/admin.html','utf8');
if (!task.includes('chatImage') || !task.includes('FormData')) throw new Error('Student chat image UI missing');
if (!chat.includes("imageUpload.single('image')") || !chat.includes('message_has_image')) throw new Error('Chat image route missing');
if (!coze.includes("content_type: 'object_string'") || !coze.includes("type: 'image'") || !coze.includes('/v1/files/upload') || !coze.includes('file_id')) throw new Error('Coze multimodal file-id payload missing');
if (!admin.includes('chat_image_count') || !adminRoute.includes('chat-package.zip') || !adminRoute.includes('task-package.zip')) throw new Error('Admin raw-data exports missing');
if (!admin.includes('resetCurrentAll') || !adminRoute.includes('reset-all') || !adminRoute.includes('reset-archives.json')) throw new Error('Admin reset controls missing');
if (!indexHtml.includes('studentName') || !authRoute.includes('hashStudentName') || !validators.includes('normalizeStudentName')) throw new Error('ID + name login verification missing');
if (!admin.includes('login_name_ready') || !adminRoute.includes('login_name_ready')) throw new Error('Roster readiness admin UI missing');
if (!adminHtml.includes('rosterFile') || !admin.includes('roster-preview') || !adminRoute.includes('roster-import') || !rosterImport.includes('parseXlsx')) throw new Error('Excel/CSV roster import missing');

if (!admin.includes('replaceRosterImport') || !adminRoute.includes('roster-replace') || !adminRoute.includes('REPLACE S01-S30')) throw new Error('Whole-cohort roster replacement controls missing');
if (!authRoute.includes('cohort_revision') || !validators || !adminRoute.includes('replaceFormalCohort')) throw new Error('Cohort revision / replacement safety missing');
if (!task.includes('questionnaireForm') || !adminRoute.includes('stratified-randomize')) throw new Error('Questionnaire/randomization flow missing');
if (!task.includes('ai_draft_deleted_unsent') || !task.includes('chat_history_revisit') || !task.includes('bonusTaskHtml')) throw new Error('W2 trace/bonus UI missing');
if (!adminRoute.includes('task_revisions.csv') || !adminRoute.includes('behavior_events.csv')) throw new Error('Trace exports missing');
const research = await readFile('src/services/researchService.js','utf8');
if (!research.includes('getRevisions') || !research.includes('field_revision_counts')) throw new Error('Task revision history service missing');
if (task.includes('请选择一个你真正不确定') || task.includes('最想比较或最需要反馈')) throw new Error('Help-seeking strategy prompt should not appear in W2 UI');
console.log('CHECK OK v11.21: 13 sessions + W2 lunch/locker pilot + neutral AI-use wording + draft/revisit traces + task revision history + trace exports + old-data-safe storage path.');
