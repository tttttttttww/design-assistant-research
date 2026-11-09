import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getSessionConfig,INTERVENTION_ORIENTATION,aiVariantFor} from '../src/config/researchConfig.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
for(let n=6;n<=10;n++){
 const s=getSessionConfig('W'+n);
 assert.equal(s.actual_lesson,n);
 assert.equal(s.order,n);
 assert.deepEqual(s.task_flow.steps.map(x=>x.min_ai_exchanges),n===6?[10,5]:[4,3]);
 const keys=new Set(s.fields.map(x=>x.key));
 const photos=new Set(s.artifacts.map(x=>x.key));
 for(const step of s.task_flow.steps){
   for(const k of step.required_fields)assert.ok(keys.has(k),'missing field '+k);
   for(const k of step.required_artifacts||[])assert.ok(photos.has(k),'missing artifact '+k);
 }
 assert.ok(s.paired_artifacts?.length>0);
 assert.equal(aiVariantFor({session:s,condition:'A'}),'free');
 assert.equal(aiVariantFor({session:s,condition:'B'}),'supported');
 assert.equal(INTERVENTION_ORIENTATION[s.id].supported.reflection_activity,false);
}
assert.equal(getSessionConfig('W11').carry_from,'W10');
assert.equal(getSessionConfig('W12').ai_mode,'free');
assert.equal(getSessionConfig('W13').ai_mode,'none');
const task=read('public/js/task.js'),rs=read('src/services/researchService.js');
assert.ok(task.includes("s.id==='W6'?w8TaskFlowHtml"));
assert.ok(task.includes('l06_wear_versions'));
assert.ok(rs.includes("this.getSessionRecord(id, 'W10')"));
assert.ok(rs.includes('course-v11-enhanced')||read('src/services/storageService.js').includes('course-v11-enhanced'));
console.log('V12.2 COURSE CHECK OK');
