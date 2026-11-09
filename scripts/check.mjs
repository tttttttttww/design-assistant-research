import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { SESSIONS, getSessionConfig, INTERVENTION_ORIENTATION, SCHEMA_VERSION, aiVariantFor } from '../src/config/researchConfig.js';

const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');
const ids = SESSIONS.map(s=>s.id);
assert.equal(SCHEMA_VERSION,25,'保存数据 schema 不允许更改');
assert.equal(new Set(ids).size,ids.length,'内部课次 id 不能重复');
for(const sid of ['W1','W2','W3','W4','W5','W6','W7','W8','W9','W10','W11','W12','W13','W14','W15'])assert.ok(getSessionConfig(sid),sid+' 必须保留');
const expected=[['W8',6,[10,5]],['W9',7,[4,3]],['W10',8,[4,3]],['W14',9,[4,3]],['W15',10,[4,3]]];
for(const [sid,lesson,counts] of expected){
  const s=getSessionConfig(sid);
  assert.equal(s.actual_lesson,lesson,'实际课次编号错误 '+sid);
  assert.equal(s.ai_mode,'condition','第6—10节持续支持 '+sid);
  assert.deepEqual(s.task_flow?.steps?.map(x=>x.min_ai_exchanges),counts);
  assert.ok(s.fields.filter(x=>x.type==='select').length>=3,'缺少自检选项 '+sid);
  assert.ok(s.fields.some(x=>x.key==='lesson_review_use'),'缺少当堂对话回顾 '+sid);
  assert.ok(Array.isArray(s.paired_artifacts)&&s.paired_artifacts.length>0,'必须有原型整体与佩戴图 '+sid);
  for(const pair of s.paired_artifacts){
    assert.ok(s.artifacts.some(x=>x.key===pair.overview),'缺原型整体图 '+sid);
    assert.ok(s.artifacts.some(x=>x.key===pair.wear),'缺原型佩戴图 '+sid);
  }
  assert.ok(INTERVENTION_ORIENTATION[sid]?.supported,'实验组应有求助策略指导 '+sid);
  assert.ok(INTERVENTION_ORIENTATION[sid]?.control,'两组都有课前流程 '+sid);
  assert.equal(INTERVENTION_ORIENTATION[sid].supported.reflection_activity,false,'课前不应回顾前一周 '+sid);
  assert.equal(aiVariantFor({session:s,condition:'A'}),'supported');
  assert.equal(aiVariantFor({session:s,condition:'B'}),'free');
}
assert.ok(getSessionConfig('W15').questionnaire_after_submit,'后测应在实际第10节之后');
assert.notEqual(getSessionConfig('W10').questionnaire_after_submit,true,'旧W10不应作为实际第10节后测');
for(const sid of ['W11','W12']){
  const s=getSessionConfig(sid);
  assert.equal(s.ai_mode,'free','迁移期不能保留实验支架');
  assert.equal(s.phase,'transfer');
  assert.ok(s.title.includes('舞台'),'迁移任务必须服务于全校舞台展示');
  assert.equal(INTERVENTION_ORIENTATION[sid],undefined);
}
assert.equal(getSessionConfig('W13').ai_mode,'none');
assert.match(getSessionConfig('W13').title,/全校.*舞台/);
const storage=read('src/services/storageService.js');
for(const str of ['course-v11-enhanced','BLOB_STORE_NAME','EXPERIMENT_RUN_ID']){
  assert.ok(storage.includes(str),'原有存储路径不能更改：'+str);
}
const rs=read('src/services/researchService.js'), task=read('public/js/task.js');
assert.ok(rs.includes('getTaskPhaseExchangeCounts'));
assert.ok(rs.includes('lesson_review_reference'));
assert.ok(rs.includes('paired_artifacts'));
assert.ok(task.includes('lessonReviewHtml('));
assert.ok(task.includes('w8_wear_versions'));
assert.ok(task.includes('science-guide-zh.svg'));
assert.ok(existsSync(new URL('../public/assets/science-guide-zh.svg',import.meta.url)));
assert.ok(existsSync(new URL('../LESSONS_6_TO_13_TEACHER_GUIDE.md',import.meta.url)));
console.log('COURSE CHECK OK: lessons 6–13, two-stage AI gates, same-day reflections, stage demonstration and unchanged storage namespace.');
