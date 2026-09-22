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
if (!w2 || w2.ai_mode!=='free' || w2.phase!=='pilot' || (w2.artifacts||[]).length || w2.chat_image_enabled!==false) throw new Error('W2 pilot/free/no-upload config invalid');
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

if (!adminRoute.includes('ALLOW_DESTRUCTIVE_COHORT_REPLACE') || !adminHtml.includes('整批清空学生数据的入口已关闭')) throw new Error('Destructive cohort replacement is not safely disabled');
if (!authRoute.includes('cohort_revision') || !validators || !adminRoute.includes('replaceFormalCohort')) throw new Error('Cohort revision / replacement safety missing');
if (!task.includes('questionnaireForm') || !adminRoute.includes('stratified-randomize')) throw new Error('Questionnaire/randomization flow missing');
if (!task.includes('ai_draft_deleted_unsent') || !task.includes('chat_history_revisit') || !task.includes('bonusTaskHtml')) throw new Error('W2 trace/bonus UI missing');
if (!adminRoute.includes('task_revisions.csv') || !adminRoute.includes('behavior_events.csv') || !adminRoute.includes('process_timeline.csv') || !adminRoute.includes('interaction_id') || !adminRoute.includes('ai_latency_ms')) throw new Error('Process-evidence exports missing');
const research = await readFile('src/services/researchService.js','utf8');
if (!research.includes('getRevisions') || !research.includes('field_revision_counts')) throw new Error('Task revision history service missing');
if (task.includes('请选择一个你真正不确定') || task.includes('最想比较或最需要反馈')) throw new Error('Help-seeking strategy prompt should not appear in W2 UI');
if (!chat.includes('taskContext') || !chat.includes('aiResponseReceivedAt') || !task.includes('chatTaskContext')) throw new Error('Task-step/timing chat context missing');
if (!adminHtml.includes('AI求助过程数据 ZIP') || !adminHtml.includes('W8后测问卷 CSV')) throw new Error('Admin export labels not updated');
if (!adminHtml.includes('实时AI对话') || !admin.includes('refreshLiveMonitor') || !adminRoute.includes('/live/:participantId')) throw new Error('Teacher live monitor missing');
if (!admin.includes('S00测试') || !admin.includes('test-account') || !admin.includes('const ordered=[...rows]')) throw new Error('S00 live-monitor account missing');
const css = await readFile('public/css/app.css','utf8');
if (!css.includes('scrollbar-gutter:stable') || !css.includes('height:clamp(520px,72vh,760px)') || !css.includes('.live-list-toolbar')) throw new Error('Live monitor internal scrolling fix missing');
if (!adminRoute.includes('storage-diagnostics') || !adminRoute.includes('restore-reset-archive') || !research.includes('restoreResetArchive')) throw new Error('History diagnostics/restore missing');
if (!chat.includes('s.processing = true') || !chat.includes('ai_request_started') || !research.includes('updateMessage')) throw new Error('Live processing state / early user-message persistence missing');
console.log('CHECK OK v11.24: live monitor scroll fixed + S00 test account visible + history diagnostics/restore + process-evidence export + data-safety guards.');
