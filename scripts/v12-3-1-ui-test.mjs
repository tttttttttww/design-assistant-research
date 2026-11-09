import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {getSessionConfig,aiVariantFor,INTERVENTION_ORIENTATION} from '../src/config/researchConfig.js';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const wizard=read('public/js/lesson-wizard.js');
const task=read('public/js/task.js');

function makePage(session,variant,page){
  const ctx={
    id:'S00',
    state:{session,record:{submitted_at:null},session_locked:false,ai_variant:variant,carry_from:null},
    sessionStorage:{getItem:()=>null,setItem:()=>{}},
    esc:x=>String(x??''),
    w8StepDone:()=>false,
    w8Count:()=>0,
    displayTextFields:()=>({}),
    fieldHtml:f=>'<div>'+f.label+'</div>',
    artifactHtml:a=>'<div>'+a.label+'</div>',
    lessonReviewHtml:()=>'<div>回顾控件</div>',
    scienceDiagramCardsHtml:()=>'<div>科学知识配图</div>',
    artifactUrl:()=>'/asset'
  };
  vm.createContext(ctx);
  vm.runInContext(wizard,ctx);
  return vm.runInContext('wizardPage='+page+';wizardSessionId=state.session.id;lessonWizardHtml(state.session,state.record)',ctx);
}
for(let n=6;n<=10;n++){
  const s=getSessionConfig('W'+n);
  assert.equal(s.actual_lesson,n);
  assert.equal(aiVariantFor({session:s,condition:'A'}),'free');
  assert.equal(aiVariantFor({session:s,condition:'B'}),'supported');
  assert.equal(s.fields.find(f=>f.key.endsWith('_check_evidence')).label,'我发现了什么问题？');
  assert.ok(s.fields.find(f=>f.key.endsWith('_check_evidence')).placeholder.includes('暂时没发现问题'));
  assert.equal(INTERVENTION_ORIENTATION[s.id].control.strategy_micro_lesson,false);
  assert.equal(INTERVENTION_ORIENTATION[s.id].supported.strategy_micro_lesson,true);
  const a0=makePage(s,'free',0),b0=makePage(s,'supported',0);
  assert.ok(!a0.includes('今天的求助方法'),'ordinary group must not see strategic instructions');
  assert.ok(b0.includes('今天的求助方法'),'scaffold group must see help-seeking guidance');
  const a2=makePage(s,'free',2),b2=makePage(s,'supported',2);
  assert.ok(!a2.includes('可以这样问')&&!a2.includes('求助提示')&&!a2.includes('向AI求助时可以结合'),'no prompt exemplars in the control group');
  if(n>6)assert.ok(b2.includes('求助提示'),'scaffold group must see context-bound exemplar');
  const a4=makePage(s,'free',4),b4=makePage(s,'supported',4);
  assert.ok(a4.includes('下课前记录任务进度'),'ordinary group gets neutral progress note');
  assert.ok(!a4.includes('下课前回顾AI求助'),'ordinary group must not get help reflection');
  assert.ok(b4.includes('下课前回顾AI求助'),'scaffold group gets help reflection');
}
assert.ok(task.includes("state.ai_variant==='supported'?supportCardHtml():''"),'scaffold tips guarded by actual AI variant');
assert.ok(task.includes("neutral?'记录今天的任务进度'"),'neutral reflection header must be distinct');

const start=task.indexOf('function compactW6EvidenceHtml(');
const end=task.indexOf('function supportCardHtml(',start);
assert.ok(start>=0&&end>start);
const build=new Function('state','esc','artifactRequiredForCurrentFlow','artifactStepCompleted','artifactUrl','prototypeVersionIndexByKey',
  task.slice(start,end)+'\nreturn {artifactHtml};');
const s=getSessionConfig('W6'),state={session:s,record:{submitted_at:null},session_locked:false,
  artifact_versions:{},chat_messages:[],carry_from:null,carry_artifact_versions:{}};
const {artifactHtml}=build(state,String,()=>true,()=>false,()=>'/image',{});
const keys=['l06_science_learning_sheet','l06_design_version'];
const htmls=keys.map(key=>artifactHtml(s.artifacts.find(a=>a.key===key),null));
for(const h of htmls){
  assert.equal((h.match(/type="file"/g)||[]).length,1,'Each distinct evidence item needs exactly one photo picker');
  assert.ok(h.includes('data-artifact-card'),'Original upload key and API remain');
  assert.ok(!h.includes('data-prototype-iterate='),'No redundant version-upload toggle');
}
assert.ok(htmls[1].includes('data-artifact-note="l06_design_version"'),'Keep real change note for design');
assert.ok(htmls[1].includes('data-artifact-source="l06_design_version"'),'Keep evidence source for analysis');
assert.ok(htmls[1].includes('data-artifact-ai-role="l06_design_version"'),'Keep AI uptake for analysis');

console.log('V12.3.1 UI CHECK OK: A-control no scaffold, B-support distinct, understandable self-check, two compact uploads.');
