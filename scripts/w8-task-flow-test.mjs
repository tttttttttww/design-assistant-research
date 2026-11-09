import assert from 'node:assert/strict';
import { getSessionConfig } from '../src/config/researchConfig.js';
import { researchService } from '../src/services/researchService.js';
import { readFile } from 'node:fs/promises';

const config = getSessionConfig('W8');
assert.ok(config, 'W8 config exists');
assert.equal(config.date, '11/9');
assert.equal(config.id, 'W8', 'W8 内部任务标识与存储映射保持不变');
assert.equal(config.student_label, '第6节课 · 科学知识与原型制作');
assert.ok(!/实验组|对照组|正式干预|研究/.test(config.student_label), '学生端标签不得暴露研究设计');
assert.deepEqual(config.task_flow.steps.map(x => [x.key, x.task_phase, x.min_ai_exchanges]), [
  ['task1', 'task1_design', 10],
  ['task2', 'task2_prototype', 5],
]);

const task1 = config.task_flow.steps[0];
const task2 = config.task_flow.steps[1];
for (const key of ['w8_previous_task_sheet','w8_science_learning_sheet','w8_design_version']) {
  assert.ok(task1.required_artifacts.includes(key), `${key} is required for task1`);
}
assert.ok(task2.required_artifacts.includes('w8_prototype_versions'));
assert.ok(task2.artifact_keys.includes('w8_build_progress'), 'task2 progress-only photos are also gated behind task1');
assert.ok(config.artifacts.find(x=>x.key==='w8_prototype_versions')?.version_book);
assert.ok(config.artifacts.find(x=>x.key==='w8_prototype_versions')?.version_questionnaire);
assert.ok(config.artifacts.find(x=>x.key==='w8_build_progress')?.progress_only);
const taskUi = await readFile(new URL('../public/js/task.js', import.meta.url), 'utf8');
assert.match(taskUi, /scienceSheet\?artifactHtml\(scienceSheet/,'the annotated learning-sheet upload control is rendered in Task 1');
assert.match(taskUi, /data-prototype-iterate/,'prototype version book includes an iterate control');
const uploadRoute = await readFile(new URL('../src/routes/upload.js', import.meta.url), 'utf8');
const courseRoute = await readFile(new URL('../src/routes/course.js', import.meta.url), 'utf8');
assert.match(uploadRoute, /step\.artifact_keys \|\| step\.required_artifacts/,'optional Task 2 uploads are also protected by the task-order gate');
assert.match(courseRoute, /task_flow\?\.steps\?\.length[\s\S]*本课需要按任务阶段提交/,'generic session submit cannot bypass the two-stage submission gates');
for (const sid of ['W9','W10']) {
  assert.ok(getSessionConfig(sid).artifacts.some(x=>x.version_book && x.version_questionnaire), `${sid} carries version history`);
}

const makeMessages = (phase, count, tag='a') => Array.from({length:count}, (_,i) => {
  const interaction_id = `${phase}-${tag}-${i+1}`;
  return [
    {role:'user', interaction_id, task_context:{task_phase:phase}},
    {role:'assistant', interaction_id, task_context:{task_phase:phase}},
  ];
}).flat();

const original = {};
for (const name of ['getMessages','getEvents','getTaskFlowState','assertSessionWritable','saveFields','getSessionRecord','appendEvent','submitSession']) {
  original[name] = researchService[name];
}
let messages = [];
const events = [];
const record = {
  text_fields: {
    w8_science_point:'摩擦力',
    w8_science_application:'应用在画笔夹持处，减少滑动',
    w8_material_plan:'橡胶垫用于夹持处，宽松紧带用于腕部固定',
    w8_design_change:'增加防滑接触面并标注材料用途',
    w8_proto_focus:'先实现画笔固定和腕部连接',
    w8_proto_progress:'已完成底板，夹持结构仍在制作',
  },
  artifacts: {
    w8_previous_task_sheet:{file_name:'previous.jpg'},
    w8_science_learning_sheet:{file_name:'science.jpg'},
    w8_design_version:{file_name:'design-v2.jpg'},
    w8_prototype_versions:{file_name:'prototype-v1.jpg'},
  },
};
let finalSubmitCalls = 0;

researchService.getMessages = async () => messages;
researchService.getEvents = async () => events;
researchService.assertSessionWritable = async () => true;
researchService.saveFields = async () => structuredClone(record);
researchService.getSessionRecord = async () => structuredClone(record);
researchService.appendEvent = async (_id,_sid,type,data) => { events.push({type,data}); };
researchService.submitSession = async () => { finalSubmitCalls += 1; return {...structuredClone(record), submitted_at:'2026-11-09T10:00:00.000Z'}; };

try {
  // A completed round requires the student and assistant messages to share an interaction ID and phase.
  messages = [
    ...makeMessages('task1_design', 9, 'initial'),
    {role:'user',interaction_id:'task1-orphan-user',task_context:{task_phase:'task1_design'}},
    {role:'assistant',interaction_id:'task1-orphan-ai',task_context:{task_phase:'task1_design'}},
    ...makeMessages('task2_prototype', 4, 'initial'),
    ...makeMessages('old-week-without-phase', 20, 'history'),
  ];
  let counts = await researchService.getTaskPhaseExchangeCounts('S01','W8',config.task_flow);
  assert.deepEqual(counts,{task1:9,task2:4},'only complete same-phase pairs are counted');

  await assert.rejects(
    () => researchService.submitTaskStep('S01','W8','task1',record.text_fields,{}),
    /还需要1轮/,
    'task1 submission must be blocked at 9 of 10 rounds',
  );
  assert.equal(events.some(e=>e.type==='task_step_submitted'&&e.data.step_key==='task1'),false);

  messages = [...messages, ...makeMessages('task2_prototype',1,'preunlock')];
  await assert.rejects(
    () => researchService.submitTaskStep('S01','W8','task2',record.text_fields,{}),
    /请先完成并提交任务一/ ,
    'task2 cannot be submitted before task1 even if the task2 exchange threshold is met',
  );
  messages = messages.filter(m=>m.interaction_id!=='task2_prototype-preunlock-1');

  messages = [...messages, ...makeMessages('task1_design',1,'tenth')];
  let state = await researchService.submitTaskStep('S01','W8','task1',record.text_fields,{});
  assert.ok(state.task_progress.completed_steps.includes('task1'),'task1 is recorded complete');
  assert.equal(finalSubmitCalls,0,'submitting task1 does not end the session');

  await assert.rejects(
    () => researchService.submitTaskStep('S01','W8','task2',record.text_fields,{}),
    /还需要1轮/,
    'task2 submission must be blocked at 4 of 5 rounds',
  );
  assert.equal(finalSubmitCalls,0,'task2 is not finalized before five complete rounds');

  messages = [...messages, ...makeMessages('task2_prototype',1,'fifth')];
  state = await researchService.submitTaskStep('S01','W8','task2',record.text_fields,{});
  assert.equal(finalSubmitCalls,1,'task2 submission finalizes the session');
  assert.ok(state.record.submitted_at,'final session has submitted_at');
  assert.ok(state.task_progress.completed_steps.includes('task2'),'task2 is recorded complete');

  console.log('W8 TASK FLOW PASS: W8 date/label and 10+5 thresholds; complete paired rounds only; task 1 gate; task 2 gate; append-only version-book config for W8-W10.');
} finally {
  for (const [name,fn] of Object.entries(original)) researchService[name] = fn;
}
