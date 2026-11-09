import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SESSIONS,getSessionConfig,INTERVENTION_ORIENTATION,aiVariantFor} from '../src/config/researchConfig.js';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const expected=[['W8',6,10,5],['W9',7,4,3],['W10',8,4,3],['W14',9,4,3],['W15',10,4,3]];
const seen=new Set();
for(const s of SESSIONS){assert.ok(!seen.has(s.id),'课次内部编号不能重复：'+s.id);seen.add(s.id);}
for(const [sid,lesson,a,b] of expected){
 const s=getSessionConfig(sid);
 assert.equal(s.actual_lesson,lesson);
 assert.deepEqual(s.task_flow.steps.map(x=>x.min_ai_exchanges),[a,b]);
 assert.ok(s.paired_artifacts?.length,'缺少整体图和佩戴图关联');
 assert.equal(aiVariantFor({session:s,condition:'A'}),'supported');
 assert.equal(aiVariantFor({session:s,condition:'B'}),'free');
 assert.equal(INTERVENTION_ORIENTATION[sid].supported.reflection_activity,false,'不应强制回顾前一周');
 const names=new Set(s.fields.map(f=>f.key));
 for(const step of s.task_flow.steps){
  for(const key of step.required_fields||[])assert.ok(names.has(key),sid+':'+key+'字段缺失');
 }
 for(const field of ['lesson_review_reference','lesson_review_use','lesson_review_next','lesson_exit_note','lesson_no_history_reason']) assert.ok(names.has(field),sid+'缺'+field);
}
for(const sid of ['W11','W12']){
 const s=getSessionConfig(sid);
 assert.equal(s.ai_mode,'free');
 assert.equal(s.phase,'transfer');
 assert.ok(s.title.includes('舞台'));
 assert.equal(INTERVENTION_ORIENTATION[sid],undefined);
}
assert.equal(getSessionConfig('W11').carry_from,'W15');
assert.equal(getSessionConfig('W13').ai_mode,'none');
assert.ok(getSessionConfig('W13').title.includes('全校'));
assert.equal(getSessionConfig('W15').questionnaire_after_submit,true);

const t=read('public/js/task.js'),rs=read('src/services/researchService.js'),chat=read('src/routes/chat.js');
for(const value of ['lessonReviewHtml','scienceDiagramCardsHtml','weeklyTaskFlowHtml','w8_wear_versions'])
 assert.ok(t.includes(value),'学生流程缺少'+value);
for(const value of ['prototypeVersionBase','paired_artifacts','lesson_review_reference'])
 assert.ok(rs.includes(value),'研究服务缺少'+value);
assert.ok(chat.includes('pendingTaskStep?.task_phase'),'聊天阶段必须由服务端校验');
for(const value of ['BLOB_STORE_NAME','EXPERIMENT_RUN_ID','course-v11-enhanced'])
 assert.ok(read('src/services/storageService.js').includes(value),'不得变更原数据命名空间');
console.log('课程与存储静态校验通过：第6—13节、舞台迁移、真实对话回顾、跨课版本。');
