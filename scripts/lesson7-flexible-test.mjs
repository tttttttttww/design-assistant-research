import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getSessionConfig,INTERVENTION_ORIENTATION,aiVariantFor,SCHEMA_VERSION} from '../src/config/researchConfig.js';
const w6=getSessionConfig('W6');
const w7=getSessionConfig('W7');
assert.equal(w6.task_flow.steps[0].min_ai_exchanges,10,'上节课门槛必须原样保留');
assert.equal(SCHEMA_VERSION,25,'研究记录数据格式不可更改');
assert.equal(w7.actual_lesson,7);
assert.equal(w7.carry_from,'W6');
assert.equal(w7.task_flow.min_ai_exchanges_total,10);
assert.equal(w7.task_flow.steps[0].min_ai_exchanges,0);
assert.equal(w7.task_flow.steps[0].require_drawing_evidence,true);
assert.equal(w7.task_flow.steps[1].min_ai_exchanges_total,10);
assert.equal(w7.task_flow.steps[1].require_prototype_evidence,true);
assert.equal(w7.artifacts.find(a=>a.key==='l07_design_version').version_book,true);
assert.equal(w7.version_predecessors_by_artifact.l07_design_version[0].artifact_key,'l06_design_version');
assert.ok(w7.paired_artifacts.some(p=>p.overview==='l07_prototype_overview'&&p.wear==='l07_prototype_wear'));
assert.equal(aiVariantFor({session:w7,condition:'A'}),'free');
assert.equal(aiVariantFor({session:w7,condition:'B'}),'supported');
assert.ok(INTERVENTION_ORIENTATION.W7.supported.strategy_micro_lesson);
assert.notEqual(INTERVENTION_ORIENTATION.W7.control.strategy_micro_lesson,true);
const task=readFileSync(new URL('../public/js/task.js',import.meta.url),'utf8');
const wizard=readFileSync(new URL('../public/js/lesson-wizard.js',import.meta.url),'utf8');
const backend=readFileSync(new URL('../src/services/researchService.js',import.meta.url),'utf8');
const storage=readFileSync(new URL('../src/services/storageService.js',import.meta.url),'utf8');
for(const marker of ['l07_design_version','l07_prototype_overview','l07_prototype_wear','图纸已满意','data-w8-exchange-count','本节累计']){
  assert.ok(task.includes(marker)||wizard.includes(marker),'missing UI '+marker);
}
for(const marker of ['require_drawing_evidence','require_prototype_evidence','minimumTotal','totalAiExchanges','version_predecessors_by_artifact']){
 assert.ok(backend.includes(marker),'missing server guard '+marker);
}
for(const marker of ['BLOB_STORE_NAME','course-v11-enhanced','EXPERIMENT_RUN_ID']){
 assert.ok(storage.includes(marker),'old storage path modified: '+marker);
}
console.log('LESSON7 FLEXIBLE VERSION CHECK OK: old lesson kept, group conditions kept, drawing/prototype evidence and ten-turn gate present.');
