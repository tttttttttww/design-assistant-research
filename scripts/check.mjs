import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {SESSIONS,getSessionConfig,INTERVENTION_ORIENTATION,SCHEMA_VERSION,aiVariantFor} from '../src/config/researchConfig.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
assert.equal(SCHEMA_VERSION,25,'Do not change the stored data schema or Blob paths');
const allIds=SESSIONS.map(s=>s.id);
assert.equal(new Set(allIds).size,allIds.length,'Duplicate session ids');
for(let n=1;n<=13;n++)assert.ok(getSessionConfig('W'+n),'Missing W'+n);
for(let n=6;n<=10;n++){
 const s=getSessionConfig('W'+n);
 assert.equal(s.actual_lesson,n,'Actual lesson must equal W'+n);
 assert.equal(s.archived,false,'Live lesson incorrectly archived');
 assert.equal(s.ai_mode,'condition');
 assert.deepEqual(s.task_flow?.steps?.map(x=>x.min_ai_exchanges),n===6?[10,5]:[4,3]);
 assert.ok(s.fields.filter(x=>x.type==='select').length>=3,'Missing observation self-check');
 const names=new Set(s.fields.map(f=>f.key)),photos=new Set(s.artifacts.map(f=>f.key));
 for(const k of ['lesson_review_reference','lesson_review_use','lesson_review_next','lesson_no_history_reason','lesson_exit_note'])assert.ok(names.has(k),'Missing review field '+k);
 for(const step of s.task_flow.steps){
   for(const k of step.required_fields||[])assert.ok(names.has(k),'Missing required '+k);
   for(const k of step.required_artifacts||[])assert.ok(photos.has(k),'Missing photo '+k);
 }
 for(const pair of s.paired_artifacts||[]){
   assert.ok(photos.has(pair.overview)&&photos.has(pair.wear),'Missing overall and worn photo pair');
 }
 assert.equal(aiVariantFor({session:s,condition:'A'}),'free');
 assert.equal(aiVariantFor({session:s,condition:'B'}),'supported');
 assert.equal(INTERVENTION_ORIENTATION[s.id]?.supported?.checks?.length,1);
 assert.equal(INTERVENTION_ORIENTATION[s.id]?.supported?.cards?.length,3);
 assert.match(INTERVENTION_ORIENTATION[s.id].supported.title,/第0步/);
 assert.equal(INTERVENTION_ORIENTATION[s.id].supported.reflection_activity,false);
}
assert.equal(getSessionConfig('W10').questionnaire_after_submit,true,'Posttest belongs after actual lesson 10');
assert.equal(getSessionConfig('W11').carry_from,'W10','Transfer must follow lesson 10');
for(const n of [11,12]){
 const s=getSessionConfig('W'+n);
 assert.equal(s.ai_mode,'free');
 assert.equal(s.phase,'transfer');
 assert.ok(s.title.includes('舞台'));
 assert.equal(INTERVENTION_ORIENTATION[s.id],undefined);
}
assert.equal(getSessionConfig('W13').ai_mode,'none');
assert.ok(getSessionConfig('W13').title.includes('全校'));
for(const n of [14,15])assert.equal(getSessionConfig('W'+n).archived,true,'Legacy sessions must remain archived');
const storage=read('src/services/storageService.js');
for(const marker of ['course-v11-enhanced','BLOB_STORE_NAME','EXPERIMENT_RUN_ID'])assert.ok(storage.includes(marker),'Storage invariant missing: '+marker);
const task=read('public/js/task.js'),service=read('src/services/researchService.js');
for(const k of ['l06_science_point','l06_prototype_versions','lessonReviewHtml','scienceDiagramCardsHtml'])assert.ok(task.includes(k),'Missing new UI '+k);
for(const k of ['getTaskPhaseExchangeCounts','paired_artifacts','lesson_review_reference'])assert.ok(service.includes(k),'Missing backend safeguard '+k);
assert.ok(existsSync(new URL('../LESSONS_6_TO_13_TEACHER_GUIDE.md',import.meta.url)),'Teacher guide missing');
assert.ok(existsSync(new URL('../public/js/lesson-wizard.js',import.meta.url)),'Student wizard script is required');
const wizard=read('public/js/lesson-wizard.js');
assert.ok(wizard.includes('lessonWizardHtml')&&wizard.includes('wizardGo'),'Student lesson steps missing');
assert.ok(task.includes('lessonWizardHtml(s,r)'),'Student page still uses old full-height task flow');
assert.ok(!task.includes('关联上一课作品')&&!task.includes('关联一条AI回复'),'Confusing record links must not appear in student UI');
assert.ok(existsSync(new URL('../scripts/v12-3-upload-ui-test.mjs',import.meta.url)),'v12.3 one-picker regression test missing');
assert.ok(existsSync(new URL('../scripts/v12-3-1-ui-test.mjs',import.meta.url)),'v12.3.1 UI regression test is missing');
assert.ok(existsSync(new URL('../scripts/v12-3-2-live-monitor-test.mjs',import.meta.url)),'v12.3.2 live monitoring regression test is required');
console.log('V12.3.2 BUILD CHECK OK: W6–W13, stage AI counts, existing Blob namespace, documents present.');
