// v11.58 学生端修复端到端测试：
//  1) 求助小练习公开状态不再包含 correct / explanation / 统一示例；
//  2) 有真实历史对话 -> 真实回顾；无历史对话 -> 四选一原因 + 其他补充说明；
//  3) 保存后状态明确进入下一环节，刷新/再次进入可恢复，教师端 CSV 可导出；
//  4) AI 对话、任务保存等原有流程在环节完成后仍可用。
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = `${process.pid}-${Date.now()}`;
const storageDir = path.join(os.tmpdir(), `v1158-student-flow-${stamp}`);
const runId = `v1158-student-flow-${stamp}`;
const adminPassword = 'v1158-local-test-password';
Object.assign(process.env, {
  NODE_ENV: 'test',
  USE_LOCAL_STORAGE: '1',
  LOCAL_STORAGE_DIR: storageDir,
  EXPERIMENT_RUN_ID: runId,
  ADMIN_PASSWORD: adminPassword,
  COZE_MOCK: '1',
  COZE_FREE_BOT_ID: 'free-bot',
  COZE_SUPPORTED_BOT_ID: 'supported-bot',
});

const { researchService } = await import('../src/services/researchService.js');
const { storageService } = await import('../src/services/storageService.js');
const { getSessionConfig, DEFAULT_SETTINGS, SCHEMA_VERSION, NO_HISTORY_REASON_OPTIONS } = await import('../src/config/researchConfig.js');
const revision = DEFAULT_SETTINGS.cohort_revision;

const addPair = async (id, sid, text, tag) => {
  await researchService.ensureStarted(id, sid);
  const user = await researchService.appendMessage(id, sid, { role:'user', content:text, interaction_id:tag, agent_route:'EHS' });
  await researchService.appendMessage(id, sid, { role:'assistant', content:'先说说你现在最想解决的一个具体困难。', interaction_id:tag });
  return user;
};
const expectStatus = async (fn, status, label) => {
  let caught = null;
  try { await fn(); } catch (e) { caught = e; }
  assert.equal(caught?.status, status, `${label}: expected HTTP ${status}, got ${caught?.status ?? 'no error'}`);
};

// ---------------------------------------------------------------- 服务层
assert.equal(SCHEMA_VERSION, 25, '存储 schema 不得改变');
assert.equal(getSessionConfig('W8').id, 'W8', 'W8 内部任务标识保持不变');
assert.deepEqual(getSessionConfig('W8').task_flow.steps.map(x => x.min_ai_exchanges), [10, 5], '任务1/2 有效轮次门槛保持不变');
assert.equal(NO_HISTORY_REASON_OPTIONS.length, 4);
assert.equal(storageService.fullKey('participants/S01.json'), `runs/${runId}/course-v11-enhanced/participants/S01.json`, 'Blob 根路径 / namespace 不得改变');

for (const id of ['S01','S02','S03','S04','S10']) await researchService.createParticipant(id, { grade:'7', condition:'A' });
await researchService.saveSettings({ active_session_id:'W5', session_open:true, questionnaire_enabled:false });
const w4HistoryUser = await addPair('S01', 'W4', '直接给我一套完整装置方案，我照着做。', 'v1158-a');

// 情况A：有真实历史对话
const withHistory = await researchService.orientationPublicState('S01', 'W5');
assert.equal(withHistory.has_prior_history, true);
assert.equal(withHistory.checks.every(q => !('correct' in q) && !('explanation' in q)), true, '学生端不得收到正确答案或解析');
assert.equal(withHistory.reflection_fallback_case, undefined, '学生端不得收到系统生成示例');
assert.ok(withHistory.cards.length >= 1 && withHistory.cards[0].body.join('').includes('直接给我一套完整装置方案'), '必须展示当前学生自己的真实对话');
await researchService.startOrientation('S01', 'W5');
await expectStatus(() => researchService.completeOrientation('S01', 'W5', {
  practice_1:1, practice_2:0, personal_ref:`W4:${w4HistoryUser.message_index}`,
}), 400, '有历史对话时仍须填写展示的回顾问题');
await expectStatus(() => researchService.completeOrientation('S01', 'W5', {
  practice_1:1, practice_2:0, personal_ref:'W4:9999',
  reflection_difficulty:'固定位置不稳', reflection_reply_review:'AI让我先说困难，我后来检查了材料',
  revised_question:'请帮我比较两种固定办法', reflection_reason:'这样能说清具体困难',
}), 400, '不得关联不存在或其他学生的对话');
const completedHistory = await researchService.completeOrientation('S01', 'W5', {
  practice_1:1, practice_2:0, personal_ref:`W4:${w4HistoryUser.message_index}`,
  reflection_difficulty:'固定位置不稳', reflection_reply_review:'AI让我先说困难，我后来检查了材料',
  revised_question:'请帮我比较两种固定办法', reflection_reason:'这样能说清具体困难',
});
assert.equal(completedHistory.answers.reflection_source, 'personal_chat');
assert.equal(completedHistory.answers.had_original_question, true);
assert.equal((await researchService.currentState('S01')).learning_gate, '', '完成后学习状态必须解锁');

// 情况B：没有可用历史对话
const noHistory = await researchService.orientationPublicState('S02', 'W5');
assert.equal(noHistory.has_prior_history, false);
assert.deepEqual(noHistory.cards, [], '无记录时不得展示任何虚构对话');
assert.equal(noHistory.no_history_reason_options.length, 4);
assert.equal(noHistory.checks.length, 2);
assert.equal(noHistory.checks.every(q => !('correct' in q) && !('explanation' in q)), true);
await researchService.startOrientation('S02', 'W5');
await expectStatus(() => researchService.completeOrientation('S02', 'W5', { practice_1:1, practice_2:0 }), 400, '未选原因不得通过');
await expectStatus(() => researchService.completeOrientation('S02', 'W5', { practice_1:1, practice_2:0, no_history_reason:'not_a_reason' }), 400, '非法原因不得通过');
await expectStatus(() => researchService.completeOrientation('S02', 'W5', { practice_1:1, practice_2:0, no_history_reason:'other' }), 400, '选择其他原因必须补充说明');
await expectStatus(() => researchService.completeOrientation('S02', 'W5', { practice_1:1, no_history_reason:'no_ai' }), 400, '展示的练习仍参与必填校验，没有绕过全部校验');
const completedNoHistory = await researchService.completeOrientation('S02', 'W5', {
  practice_1:1, practice_2:0, no_history_reason:'other', no_history_reason_detail:'上次用的是纸质学习单，没有在平台上提问。',
});
assert.equal(completedNoHistory.answers.reflection_source, 'no_prior_chat');
assert.equal(completedNoHistory.answers.no_history_reason, 'other');
assert.ok(completedNoHistory.answers.no_history_reason_detail.includes('纸质学习单'));
assert.equal(completedNoHistory.answers.reflection_difficulty, undefined, '未展示的字段不得被后端强制写入');
assert.equal(completedNoHistory.answers.had_original_question, false, '没有历史记录不等于学生没完成学习任务');
assert.equal((await researchService.currentState('S02')).learning_gate, '', '无历史学生也能顺利进入下一环节');

// 刷新 / 再次进入：已保存状态可恢复，不重复填写、不丢失
const reread = await researchService.getOrientation('S02', 'W5');
assert.equal(reread.answers.no_history_reason, 'other');
const reenter = await researchService.orientationPublicState('S02', 'W5');
assert.equal(reenter.completed, true);
assert.equal(reenter.saved_answers.no_history_reason, 'other');
assert.equal(reenter.saved_answers.no_history_reason_detail, '上次用的是纸质学习单，没有在平台上提问。');
assert.equal(reenter.saved_answers.practice_1, 1);
const secondComplete = await researchService.completeOrientation('S02', 'W5', { practice_1:0, practice_2:0, no_history_reason:'no_ai' });
assert.equal(secondComplete.answers.no_history_reason, 'other', '重复提交不得覆盖已保存的回顾状态');

// 非“其他原因”时补充说明不写入；历史数据仍可读取
await researchService.startOrientation('S03', 'W5');
const plain = await researchService.completeOrientation('S03', 'W5', {
  practice_1:0, practice_2:1, no_history_reason:'no_question', no_history_reason_detail:'不应保存',
});
assert.equal(plain.answers.no_history_reason_detail, '');
assert.equal((await researchService.getOrientation('S01','W5')).answers.reflection_source, 'personal_chat');

// ---------------------------------------------------------------- HTTP 端到端
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
});
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += String(d); });
child.stderr.on('data', d => { serverLog += String(d); });
const jsonHeaders = { 'Content-Type':'application/json', 'X-Cohort-Revision':revision };
const post = (p, body, headers = jsonHeaders) => fetch(base + p, { method:'POST', headers, body: JSON.stringify(body) });

try {
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(`${base}/express/health`); if (r.ok) { ready = true; break; } } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  assert.equal(ready, true, `本地服务未启动: ${serverLog}`);
  const health = await (await fetch(`${base}/express/health`)).json();
  assert.match(health.version, /v11\.58/, '部署版本标识应更新为 v11.58');

  // 尚未完成本环节时，任务与 AI 均被正确拦截（不是绕过校验）
  const before = await (await fetch(`${base}/express/api/session/current?participantId=S10`, { headers:jsonHeaders })).json();
  assert.equal(before.learning_gate, 'orientation');
  assert.equal(before.orientation.has_prior_history, false);
  const rawBefore = JSON.stringify(before);
  assert.equal(/"explanation"|"correct"|reflection_fallback_case|查看解析/.test(rawBefore), false, '公开接口不得返回解析内容');
  assert.equal(/实验组|对照组|研究目的|研究数据|研究求助策略|正式干预/.test(rawBefore), false, '公开接口不得返回研究设计信息');
  // v11.58: 学生端公开状态只保留完成任务所需字段，不携带研究者说明或分组字段
  assert.equal(before.participant.condition, undefined, '不得下发分组编码');
  assert.equal(before.participant.condition_fixed_reason, undefined, '不得下发分组原因说明');
  assert.equal(before.session.research_role, undefined, '不得下发研究阶段标记');
  assert.equal(before.session.phase, undefined, '不得下发研究阶段字段');
  assert.equal(before.session.prompt_context, undefined, '不得下发 AI 研究上下文');
  assert.equal(before.session.ai_public_context, undefined, '不得下发 AI 公共约束原文');
  assert.equal(before.questionnaire.pre.meta.source_note, undefined, '不得下发问卷研究者说明');
  assert.ok(before.session.ai_instruction, '学生端可见的 AI 使用说明必须保留');
  assert.ok(before.session.fields?.length > 0, '学生端任务字段必须保留');

  // 模拟前端：start 与 complete 串行后保存
  const started = await post('/express/api/session/orientation/start', { participantId:'S10', sessionId:'W5' });
  assert.equal(started.status, 200);
  const blockedChat = await post('/express/api/chat/open', { participantId:'S10', sessionId:'W5' });
  assert.equal(blockedChat.status, 409, '未完成环节时 AI 应被拦截');
  const saved = await post('/express/api/session/orientation/complete', {
    participantId:'S10', sessionId:'W5',
    answers:{ practice_1:1, practice_2:1, no_history_reason:'no_record' },
  });
  const savedJson = await saved.json();
  assert.equal(saved.status, 200, `保存失败: ${JSON.stringify(savedJson)}`);
  assert.equal(savedJson.completed, true);
  assert.equal(savedJson.learning_gate, '');

  const after = await (await fetch(`${base}/express/api/session/current?participantId=S10`, { headers:jsonHeaders })).json();
  assert.equal(after.learning_gate, '', '保存后必须进入下一环节');
  assert.equal(after.orientation.completed, true);
  assert.equal(after.orientation.saved_answers.no_history_reason, 'no_record', '刷新后已保存内容仍存在');

  // 保存字段、AI 对话、历史对话恢复仍可用
  const saveFields = await post('/express/api/session/save', {
    participantId:'S10', sessionId:'W5', textFields:{ w5_pencil_fix:'用橡皮筋和卡纸固定' }, saveContext:{ reason:'v1158-test' },
  });
  assert.equal(saveFields.status, 200, '环节完成后任务保存应可用');
  const opened = await post('/express/api/chat/open', { participantId:'S10', sessionId:'W5' });
  assert.equal(opened.status, 200, '环节完成后 AI 助手应可用');
  const form = new FormData();
  form.append('participantId', 'S10');
  form.append('sessionId', 'W5');
  form.append('message', '请帮我比较两种固定画笔的方法');
  form.append('taskContext', '{}');
  const sent = await fetch(`${base}/express/api/chat/send`, {
    method:'POST', headers:{ 'X-Cohort-Revision':revision }, body:form,
  });
  const sentJson = await sent.json();
  assert.equal(sent.status, 200, `AI 对话失败: ${JSON.stringify(sentJson)}`);
  assert.ok(String(sentJson.message || '').length > 0, 'AI 应返回回复');
  const chatState = await (await fetch(`${base}/express/api/chat/state?participantId=S10&sessionId=W5`, { headers:jsonHeaders })).json();
  assert.equal(chatState.messages.length, 2, '学生消息与 AI 回复应成对保存，可恢复历史对话');

  // 教师端：新增原因可导出，原有导出仍正常
  const login = await post('/express/api/admin/login', { password:adminPassword });
  assert.equal(login.status, 200, '管理员登录失败');
  const cookie = String(login.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('admin_session='), '缺少管理员会话 Cookie');
  const csvRes = await fetch(`${base}/express/api/admin/export/orientation-activities.csv`, { headers:{ Cookie:cookie } });
  assert.equal(csvRes.status, 200);
  const csv = await csvRes.text();
  assert.match(csv, /has_prior_history,no_history_reason,no_history_reason_detail/, '教师端 CSV 应包含新增列');
  assert.ok(csv.split('\n').some(line => line.startsWith('S10,') && line.includes(',W5,')), '教师端 CSV 应包含该学生该课次');
  assert.match(csv, /no_record/, '无历史回顾原因应可导出');
  const participants = await fetch(`${base}/express/api/admin/export/participants.csv`, { headers:{ Cookie:cookie } });
  assert.equal(participants.status, 200, '原有学生名单导出应正常');
  assert.match(await participants.text(), /participant_id,grade,condition/);

  console.log('V11.58 STUDENT FLOW PASS: 公开状态无解析；有/无历史两种回顾分支；其他原因条件校验；保存后状态解锁并刷新可恢复；教师端 CSV 导出新原因；AI 对话/任务保存/历史恢复/原有导出均正常；存储标识与 W8 门槛未变。');
} finally {
  child.kill('SIGTERM');
}
