import { readFile, access } from 'node:fs/promises';
const must = [
  'public/index.html','public/task.html','public/admin.html','public/js/task.js','public/js/admin.js',
  'src/config/researchConfig.js','src/services/researchService.js','src/services/cozeService.js',
  'src/routes/course.js','src/routes/chat.js','src/routes/upload.js','src/routes/admin.js','cloud-functions/express/[[default]].js'
];
for (const f of must) await access(f);
const cfg = await import('../src/config/researchConfig.js');
if (cfg.SCHEMA_VERSION !== 23) throw new Error(`Expected schema 23, got ${cfg.SCHEMA_VERSION}`);
if (!cfg.INTERVENTION_ORIENTATION?.W4?.supported || !cfg.INTERVENTION_ORIENTATION?.W4?.control) throw new Error('W4 orientation missing');
if (!cfg.INTERVENTION_ORIENTATION?.W7?.supported || !cfg.INTERVENTION_ORIENTATION?.W7?.control) throw new Error('W7 personal/neutral review missing');
if (Object.keys(cfg.INTERVENTION_SUPPORT_CARDS||{}).length) throw new Error('Weekly visible help-seeking cards should be removed in final design');
if (cfg.SESSIONS.length !== 13) throw new Error(`Expected 13 sessions, got ${cfg.SESSIONS.length}`);
const ids = cfg.SESSIONS.map(x=>x.id);
if (new Set(ids).size !== 13) throw new Error('Duplicate session ids');
const w2=cfg.SESSIONS.find(x=>x.id==='W2'), w3=cfg.SESSIONS.find(x=>x.id==='W3'), w9=cfg.SESSIONS.find(x=>x.id==='W9');
if (!w2 || w2.ai_mode!=='free' || w2.ai_use_required_once) throw new Error('W2 should be ordinary optional AI');
if (!w3 || w3.ai_mode!=='free' || w3.phase!=='pre_intervention') throw new Error('W3 must be common pre-intervention preparation');
const w4=cfg.SESSIONS.find(x=>x.id==='W4');
if (!w4?.title.includes('纸质原型图') || w4?.title.includes('制作第一版')) throw new Error('W4 must be user-needs/design-requirements/paper-prototype only');
if (w4.brief.some(x=>x.includes('定义设计问题')) || w4.requirements.some(x=>x.includes('用一句话明确“为谁解决什么问题”')) || w4.fields.some(x=>String(x.label||'').includes('问题定义'))) throw new Error('W4 student-facing redundant problem-definition prompt must be removed');
if (!w4.fields.some(x=>x.key==='problem_definition')) throw new Error('W4 legacy field id must remain for record continuity');
const expectedMaterials=['瓦楞纸板 / 厚卡纸','普通海绵','布 / 毛毡片','雪糕棒','橡皮筋','宽松紧带','魔术贴','小夹子','美纹纸胶带'];
for (const sid of ['W3','W4']) {
  const s=cfg.SESSIONS.find(x=>x.id===sid);
  const tg=s?.materials?.find(g=>g.group==='测试工具');
  if(!tg || tg.items.length!==1 || tg.items[0].label!=='铅笔') throw new Error(`${sid} test tool must be pencil only`);
  const actual=(s?.materials||[]).filter(g=>g.group!=='测试工具').flatMap(g=>g.items||[]).map(x=>x.label);
  if(JSON.stringify(actual)!==JSON.stringify(expectedMaterials)) throw new Error(`${sid} streamlined material bank mismatch: ${JSON.stringify(actual)}`);
}
if (!cfg.SESSIONS.find(x=>x.id==='W5')?.title.includes('制作第一版')) throw new Error('W5 must build V1 after W4 paper prototype');
if (!cfg.SESSIONS.find(x=>x.id==='W4')?.ai_public_context?.task) throw new Error('W4 minimal public task context missing');
if (!cfg.AI_VARIANT_RUNTIME_RULES.supported.some(x=>x.includes('一次只推进一个关键决策点'))) throw new Error('Strict one-step EHS gate missing');
for (const sid of ['W4','W5','W6','W7','W8','W9']) {
  const s=cfg.SESSIONS.find(x=>x.id===sid); if(!s||s.ai_mode!=='condition'||s.phase!=='intervention') throw new Error(`${sid} must be formal intervention`);
}
for (const sid of ['W10','W11']) {
  const s=cfg.SESSIONS.find(x=>x.id===sid); if(!s||s.ai_mode!=='free'||s.phase!=='transfer') throw new Error(`${sid} must be scaffold-off transfer`);
}
if(!w9.questionnaire_after_submit) throw new Error('Optional posttest gate should sit at W9');
if(cfg.DEFAULT_SETTINGS.questionnaire_enabled!==false) throw new Error('Candidate questionnaire must default off until supervisor decision');
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
const research = await readFile('src/services/researchService.js','utf8');
const routing = await readFile('src/utils/agentRouting.js','utf8');
if (!task.includes('chatImage') || !task.includes('FormData')) throw new Error('Student chat image UI missing');
if (!chat.includes("imageUpload.single('image')") || !chat.includes('message_has_image')) throw new Error('Chat image route missing');
if (!chat.includes('AI_VARIANT_RUNTIME_RULES') || !chat.includes('variantResponseRules')) throw new Error('Runtime experimental/control rules missing');
if (!cfg.HELP_SEEKING_ROUTE_PROTOCOL_VERSION || !cfg.AI_VARIANT_RUNTIME_RULES.supported.some(x=>x.includes('IHS、EHS 或 OTHER'))) throw new Error('IHS/EHS/Other routing prompt missing');
if (!routing.includes('parseAgentRouting') || !chat.includes('help_seeking_route_decision')) throw new Error('Hidden routing marker parser/log missing');
if (!coze.includes("content_type: 'object_string'") || !coze.includes('/v1/files/upload')) throw new Error('Coze multimodal upload missing');
if (!admin.includes('chat_image_count') || !adminRoute.includes('chat-package.zip') || !adminRoute.includes('task-package.zip')) throw new Error('Admin raw-data exports missing');
if (!indexHtml.includes('studentName') || !authRoute.includes('hashStudentName') || !validators.includes('normalizeStudentName')) throw new Error('ID + name login verification missing');
if (!adminHtml.includes('rosterFile') || !admin.includes('roster-preview') || !adminRoute.includes('roster-import') || !rosterImport.includes('parseXlsx')) throw new Error('Roster import missing');
if (!adminRoute.includes('ALLOW_DESTRUCTIVE_COHORT_REPLACE')) throw new Error('Destructive cohort safety missing');
if (!task.includes('orientationHtml') || !task.includes('/session/orientation/complete') || !research.includes("['W4','W7']")) throw new Error('W4/W7 platform learning gates missing');
if (adminRoute.includes('auto_on_W3_activation')) throw new Error('Auto grouping on W3 must be removed');
if (!adminHtml.includes('W4前确认分组') || !adminHtml.includes('手动调整实验组 / 对照组')) throw new Error('Manual group control UI missing');
if (!adminRoute.includes('optional_stratified_randomization_by_grade_with_fixed_control')) throw new Error('Optional stratified randomizer missing');
if (adminRoute.includes('exact_total_balance_with_fixed_control')) throw new Error('Forced exact-total randomization should be removed');
if (!research.includes('dynamic_personal_queries') || !research.includes('selection_basis') || !research.includes('agent_route_EHS') || !research.includes('agent_route_IHS')) throw new Error('W7 IHS/EHS-informed personal query review missing');
if (!task.includes('ai_draft_deleted_unsent') || !task.includes('chat_history_revisit') || !task.includes('task_field_interaction')) throw new Error('Process traces missing');
if (!adminRoute.includes('task_revisions.csv') || !adminRoute.includes('behavior_events.csv') || !adminRoute.includes('process_timeline.csv')) throw new Error('Process evidence exports missing');
if (!adminRoute.includes('protected-pre-w4.zip') || !research.includes('createProtectedPreW4Snapshot') || !research.includes("sessions: ['W1','W2','W3']")) throw new Error('Pre-W4 protected snapshot missing');
if (!adminHtml.includes('候选后测问卷 CSV')) throw new Error('Candidate questionnaire label missing');
if (!adminHtml.includes('实时AI对话') || !admin.includes('refreshLiveMonitor') || !adminRoute.includes('/live/:participantId')) throw new Error('Teacher live monitor missing');
if (!research.includes('condition_change_history') || !research.includes('orientation-archives')) throw new Error('Group-change audit missing');
console.log('CHECK OK v11.45: IHS/EHS/Other internal routing + hidden marker logging; draft unsent events preserved; W7 route-informed query review; transfer and questionnaire settings unchanged.');
