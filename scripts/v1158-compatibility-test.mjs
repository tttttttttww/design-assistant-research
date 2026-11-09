// v11.58 兼容性静态检查：确认本次学生端修复没有改动任何会影响线上学生数据的标识、
// 存储根路径、身份映射、任务流程、接口字段或教师端原有导出能力。
// 本脚本只做只读检查，不写任何学生数据。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

process.env.NODE_ENV = 'test';
process.env.USE_LOCAL_STORAGE = '1';
process.env.EXPERIMENT_RUN_ID = 'v1158-compat-static-check';

const cfg = await import('../src/config/researchConfig.js');
const { storageService } = await import('../src/services/storageService.js');
const storageSrc = await readFile('src/services/storageService.js', 'utf8');
const courseSrc = await readFile('src/routes/course.js', 'utf8');
const adminSrc = await readFile('src/routes/admin.js', 'utf8');
const serviceSrc = await readFile('src/services/researchService.js', 'utf8');
const taskSrc = await readFile('public/js/task.js', 'utf8');
const envExample = await readFile('.env.example', 'utf8');
const health = await readFile('cloud-functions/express/[[default]].js', 'utf8');

// ---------------------------------------------------------------- 1. 存储标识
assert.equal(cfg.SCHEMA_VERSION, 25, 'SCHEMA_VERSION 不得改变');
assert.match(storageSrc, /rootPrefix = `runs\/\$\{this\.runId\}\/course-v11-enhanced`/, 'Blob 根路径 / namespace 不得改变');
assert.match(storageSrc, /this\.runId = process\.env\.EXPERIMENT_RUN_ID/, 'EXPERIMENT_RUN_ID 读取方式不得改变');
assert.match(storageSrc, /process\.env\.BLOB_STORE_NAME/, 'BLOB_STORE_NAME 读取方式不得改变');
assert.match(storageSrc, /fullKey\(key\) \{ return `\$\{this\.rootPrefix\}\//, '对象键构造方式不得改变');
assert.equal(
  storageService.fullKey('participants/S01/sessions/W4.json'),
  'runs/v1158-compat-static-check/course-v11-enhanced/participants/S01/sessions/W4.json',
  '学生对象键不得改变',
);
for (const key of ['BLOB_STORE_NAME=', 'EXPERIMENT_RUN_ID=', 'COZE_FREE_BOT_ID=', 'COZE_SUPPORTED_BOT_ID=', 'ADMIN_PASSWORD=', 'ALLOWED_PARTICIPANTS=', 'ALLOW_PROTECTED_PILOT_RESET=false']) {
  assert.ok(envExample.includes(key), `.env.example 缺少关键配置项 ${key}`);
}
assert.match(envExample, /BLOB_STORE_NAME=design-assistant-research-data/);
assert.match(envExample, /EXPERIMENT_RUN_ID=design-thinking-course-202609-v11-enhanced/);
assert.match(envExample, /ALLOWED_PARTICIPANTS=S01,.*,S30/);
assert.match(health, /course-v11\.58/, '部署版本标识应更新');

// ---------------------------------------------------------------- 2. 身份与课次映射
assert.deepEqual(cfg.PROTECTED_SESSION_IDS, ['W1', 'W2', 'W3'], 'W1-W3 保护课次不得改变');
assert.deepEqual(cfg.CONDITIONS, ['unassigned', 'A', 'B'], '分组编码取值不得改变');
assert.equal(cfg.SESSIONS.length, 13);
assert.deepEqual(cfg.SESSIONS.map(s => s.id), ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13'], '课次 id 与顺序不得改变');
assert.match(serviceSrc, /\['S04','S05'\]\.includes\(id\)/, 'S04/S05 固定规则不得改变');
assert.match(serviceSrc, /isTestParticipant\(id\)/, 'S00/S99 教师测试号规则不得改变');
assert.match(adminSrc, /PROTECTED_SESSION_IDS\.includes\(sid\) && process\.env\.ALLOW_PROTECTED_PILOT_RESET !== 'true'/, '保护课次重置开关不得删除');
assert.match(serviceSrc, /orientation-archives\//, '历史环节归档路径不得改变');

// ---------------------------------------------------------------- 3. W8 两阶段任务与轮次规则
const w8 = cfg.getSessionConfig('W8');
assert.equal(w8.id, 'W8', 'W8 内部任务标识不得改变');
assert.equal(w8.task_flow.steps.length, 2);
assert.deepEqual(w8.task_flow.steps.map(s => [s.key, s.task_phase, s.min_ai_exchanges]), [
  ['task1', 'task1_design', 10],
  ['task2', 'task2_prototype', 5],
], '任务1/2 有效 AI 对话轮次门槛不得改变');
assert.match(serviceSrc, /interaction_id/, '有效轮次必须按消息配对统计，不能用图片上传次数替代');
assert.match(serviceSrc, /paired|配对|user_turn_count/, '配对轮次统计逻辑必须保留');
assert.equal(cfg.PROMPT_VERSION_FREE, 'free-ai-v11.50-exhibit-related-task');
assert.equal(cfg.PROMPT_VERSION_SUPPORTED, 'help-seeking-support-v18-context-neutral');
assert.equal(cfg.HELP_SEEKING_ROUTE_PROTOCOL_VERSION, 'ihs-ehs-other-v1');

// ---------------------------------------------------------------- 4. 每周环节 key 保持不变（否则已保存的学生记录会被重新锁上）
for (const sid of ['W5','W6','W7','W8','W9','W10']) {
  const c = cfg.INTERVENTION_ORIENTATION[sid];
  assert.equal(c.supported.key, `weekly-help-strategy-and-reflection-v1-${sid}`, `${sid} supported key 不得改变`);
  assert.equal(c.control.key, `neutral-weekly-readiness-v1-${sid}`, `${sid} control key 不得改变`);
  assert.equal(c.supported.checks.length, 2, `${sid} 小练习题目数量不得改变`);
  assert.equal(c.supported.button, '保存，进入下一节');
}
for (const sid of ['W5','W6','W7','W8','W9','W10']) {
  for (const q of cfg.INTERVENTION_ORIENTATION[sid].supported.checks) {
    assert.equal(q.options.length, 3);
    assert.ok(Number.isInteger(q.correct), '教师端评分字段仍需保留');
    assert.ok(q.explanation, '教师端研究记录中的解析文本仍需保留（但不下发学生端）');
  }
}

// ---------------------------------------------------------------- 5. 前后端接口字段一致性
const routes = [
  "router.get('/session/current'",
  "router.post('/session/orientation/start'",
  "router.post('/session/orientation/complete'",
  "router.post('/session/save'",
  "router.post('/session/step-submit'",
  "router.post('/session/submit'",
  "router.post('/session/reopen'",
  "router.get('/questionnaire/:slot'",
  "router.post('/questionnaire/:slot'",
  "router.post('/session/event'",
];
for (const route of routes) assert.ok(courseSrc.includes(route), `接口 ${route} 缺失`);
for (const [front, back] of [
  ['/session/orientation/complete', "req.body?.answers"],
  ['/session/save', 'req.body?.textFields'],
  ['/session/step-submit', 'req.body?.stepKey'],
  ['/session/submit', 'req.body?.saveContext'],
]) {
  assert.ok(taskSrc.includes(front), `前端缺少调用 ${front}`);
  assert.ok(courseSrc.includes(back), `后端缺少解析 ${back}`);
}
// 前端实际提交的每个答案字段，后端都必须读取（反之亦然：后端不得强求未展示字段）
for (const key of ['personal_ref','reflection_difficulty','reflection_reply_review','revised_question','reflection_reason','no_history_reason','no_history_reason_detail','neutral_observation','neutral_nextstep','acknowledged']) {
  assert.ok(taskSrc.includes(`answers.${key}`), `前端未提交 ${key}`);
  assert.ok(serviceSrc.includes(`answers.${key}`), `后端未读取 ${key}`);
}
assert.match(serviceSrc, /NO_HISTORY_REASON_OPTIONS\.some\(x=>x\.value===reason\)/, '无历史原因必须按展示选项校验');
assert.match(serviceSrc, /reason==='other' && detail\.length<2/, '“其他原因”补充说明必须条件必填');
assert.match(serviceSrc, /if \(row\.completed_at\) return row;/, '重复进入不得覆盖已保存状态');
assert.match(serviceSrc, /learning_gate = 'orientation'/, '状态判断仍由服务端明确控制');

// ---------------------------------------------------------------- 6. 教师端导出与管理能力保留
const oldColumns = ['participant_id','grade','condition_at_time','session_id','orientation_mode','activity_key','started_at','completed_at','duration_seconds','selected_past_message_ref','reflection_source','reflection_difficulty','reflection_reply_review','revised_help_question','reflection_reason','had_original_ai_question','prior_chat_count','case_selection_reason','selected_case_basis','neutral_observation','neutral_nextstep','answers_json','shown_personal_queries_json','strategy_practice_count','strategy_practice_correct_count','strategy_practice_protocol'];
const headerLine = adminSrc.split('\n').find(l => l.includes("'orientation_and_personal_reflection.csv'")) || '';
for (const col of oldColumns) assert.ok(headerLine.includes(`'${col}'`), `教师端原有导出列 ${col} 丢失`);
for (const col of ['has_prior_history','no_history_reason','no_history_reason_detail']) assert.ok(headerLine.includes(`'${col}'`), `新增导出列 ${col} 缺失`);
for (const route of ['/export/chat-package.zip','/export/task-package.zip','/export/all.json','/export/participants.csv','/export/questionnaire.csv','/export/protected-pre-w4.zip','/export/orientation-activities.csv','/participants/stratified-randomize','/participants/roster-import','/participant/:participantId/meta','/research/coding','/live/:participantId']) {
  assert.ok(adminSrc.includes(route), `教师端原有接口 ${route} 缺失`);
}
assert.ok(serviceSrc.includes('condition_change_history'), '分组变更审计记录不得删除');

// ---------------------------------------------------------------- 7. 学生端不得出现研究文案或解析入口
const studentFiles = ['public/index.html','public/task.html','public/js/common.js','public/js/index.js','public/js/task.js','public/css/app.css'];
const banned = /实验组|对照组|正式干预|实验条件|研究数据|研究目的|研究求助策略|计划内学习|回答只用于研究|查看解析|正确答案|分组|组别|前测|后测/;
for (const f of studentFiles) {
  const src = await readFile(f, 'utf8');
  assert.equal(banned.test(src), false, `学生端文件 ${f} 仍有不合适的文案`);
  assert.equal(/解析/.test(src) && /\bexplanation\b/.test(src), false, `学生端文件 ${f} 仍有解析入口`);
}

console.log('V11.58 COMPATIBILITY PASS: 存储标识/根路径/namespace、身份映射、W8 两阶段与10+5轮次、A/B提示词版本、每周环节key、前后端字段、教师端导出与研究字段、学生端文案均通过兼容性检查。');
