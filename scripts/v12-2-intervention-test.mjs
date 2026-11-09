import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SESSIONS,getSessionConfig,INTERVENTION_ORIENTATION,aiVariantFor} from '../src/config/researchConfig.js';
import {forcedParticipantCondition,testParticipantCondition} from '../src/utils/validators.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const service=read('src/services/researchService.js');
const task=read('public/js/task.js'),wizard=read('public/js/lesson-wizard.js');
for(let n=6;n<=10;n++){
  const s=getSessionConfig('W'+n);
  const pre=INTERVENTION_ORIENTATION[s.id];
  assert.equal(s.actual_lesson,n);
  assert.equal(aiVariantFor({session:s,condition:'A'}),'free');
  assert.equal(aiVariantFor({session:s,condition:'B'}),'supported');
  assert.match(pre.supported.title,/第0步/);
  assert.equal(pre.supported.strategy_micro_lesson,true);
  assert.equal(pre.supported.cards.length,3);
  assert.equal(pre.supported.checks.length,1);
  assert.equal(pre.supported.allow_imperfect_quiz,true);
  assert.equal(pre.control.checks?.length||0,0);
  assert.ok(pre.supported.cards.some(x=>x.example_good&&x.example_bad));
  assert.equal(pre.supported.reflection_activity,false);
}
assert.equal(aiVariantFor({session:getSessionConfig('W4'),condition:'A'}),'supported');
assert.equal(aiVariantFor({session:getSessionConfig('W4'),condition:'B'}),'free');
assert.equal(testParticipantCondition('S00'),'B');
assert.equal(testParticipantCondition('S99'),'A');
assert.equal(forcedParticipantCondition('S04'),'');
assert.equal(forcedParticipantCondition('S05'),'');
assert.equal(forcedParticipantCondition('S00'),'B');
assert.equal(forcedParticipantCondition('S99'),'A');

// Test the real effective-variant method with mocked storage rather than
// assuming that changing a session config can safely relabel old messages.
const start=service.indexOf('  async effectiveVariantFor(');
const end=service.indexOf('  async orientationConfigFor(',start);
assert.ok(start>=0&&end>start,'effective variant method must exist');
const method=service.slice(start,end).trim();
const effective=new Function('getSessionConfig','aiVariantFor',`return ({${method}}).effectiveVariantFor;`)(getSessionConfig,aiVariantFor);
const scenario=(condition,record,chat=null,orientation=null,sid='W6')=>
  effective.call({
    getParticipant:async()=>({condition,is_test:false}),
    getSessionRecord:async()=>record,
    getChatSession:async()=>chat,
    getOrientation:async()=>orientation,
  },'S17',sid,{condition,is_test:false});
assert.equal(await scenario('B',{started_at:null,ai_variant:''}),'supported','fresh B student should see scaffold');
assert.equal(await scenario('A',{started_at:null,ai_variant:''}),'free','fresh A student should see ordinary AI');
assert.equal(await scenario('B',{started_at:'old-date',ai_variant:'free'}),'free','already-started former control must keep original bot');
assert.equal(await scenario('A',{started_at:'old-date',ai_variant:'supported'}),'supported','already-started former scaffold must keep original bot');
assert.equal(await scenario('A',{started_at:null}, {started_at:'old-date',ai_variant:'supported'}),'supported','already-open chat must remain on original variant');
assert.equal(await scenario('B',{started_at:null},null,{started_at:'old-date',mode:'control'}),'free','old pre-lesson record must not be silently reinterpreted');
assert.equal(await scenario('A',{started_at:null},null,null,'W4'),'supported','historical W4 condition mapping preserved');

assert.match(service,/if \(!participant\.is_test && \(previousRecord\?\.started_at/,'retroactive intervention must remain disabled for formal learners');
assert.ok(service.includes("if (!task_gate && orientation && !orientation.completed) learning_gate = 'orientation'"));
assert.ok(task.includes("state.learning_gate==='orientation'"));
assert.ok(task.includes('completeOrientation'));
assert.ok(task.includes("o.mode==='supported'?'scaffold-intro'"),'dedicated student pre-lesson layout must render');
assert.ok(wizard.includes('wizardPage===0')&&wizard.includes('lessonReviewHtml(s)'));
console.log('V12.2 INTERVENTION CHECK OK: day-zero learning, conditional AI, historical pinning, no automatic fixed-learner switches.');
