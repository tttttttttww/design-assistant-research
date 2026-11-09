import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/js/task.js', import.meta.url), 'utf8');
const start = src.indexOf('function artifactQuestionnaireHtml(');
const end = src.indexOf('function supportCardHtml(',start);
assert.ok(start >= 0 && end > start, 'Image UI routines must be present');
const ui = src.slice(start,end);
const create = new Function('state','esc','artifactRequiredForCurrentFlow','artifactStepCompleted','artifactUrl','prototypeVersionIndexByKey',
  ui + '\nreturn {prototypeVersionBookHtml,artifactHtml};');

function mock(qty) {
  const state={
    record:{submitted_at:null},session_locked:false,
    session:{paired_artifacts:[{overview:'l06_prototype_versions',wear:'l06_wear_versions'}]},
    artifact_versions:{
      l06_design_version:Array.from({length:qty},(_,i)=>({
        version_no:i+1,kind:i?'revision':'draft',uploaded_at:'2026-11-09T12:00:00',file_path:'/test/'+i
      }))
    },
    chat_messages:[],carry_from:null,carry_artifact_versions:{}
  };
  const funcs=create(state,String,()=>true,()=>false,()=>'/image', {});
  return {state,...funcs};
}

for (const qty of [0,1,3]) {
  const {prototypeVersionBookHtml} = mock(qty);
  const html=prototypeVersionBookHtml({
    key:'l06_design_version',label:'修改后的设计图',
    book_item_label:'设计图',helper:'只有真实修改才新增版本',required:true
  },null);
  assert.equal((html.match(/type="file"/g)||[]).length,1,'One image picker per versionbook');
  assert.equal((html.match(/data-prototype-iterate=/g)||[]).length,0,'No redundant upload button');
  assert.ok(!html.includes('prototype-upload-editor hidden'),'Picker remains directly visible');
  assert.equal((html.match(/data-artifact-note=/g)||[]).length,1,'Keep change note');
  assert.equal((html.match(/data-artifact-source=/g)||[]).length,1,'Keep change evidence');
  assert.equal((html.match(/data-artifact-ai-role=/g)||[]).length,1,'Keep AI uptake');
  assert.equal((html.match(/data-prototype-prev=/g)||[]).length,qty>1?1:0,'Only show useful version navigation');
  assert.equal((html.match(/data-prototype-next=/g)||[]).length,qty>1?1:0);
}

const {artifactHtml} = mock(0);
for(const artifact of [
 {key:'l06_science_learning_sheet',label:'学习单',helper:'已填写的学习单',version_book:false,version_questionnaire:false},
 {key:'l06_wear_versions',label:'原型佩戴照',version_book:false,version_questionnaire:false},
 {key:'l06_build_progress',label:'制作进度照',progress_only:true,version_book:false,version_questionnaire:false}
]) {
  const html=artifactHtml(artifact,null);
  assert.equal((html.match(/type="file"/g)||[]).length,1,'One upload picker for '+artifact.key);
}

const wizard=readFileSync(new URL('../public/js/lesson-wizard.js',import.meta.url),'utf8');
assert.ok(wizard.includes("a('l06_science_learning_sheet')") &&
          wizard.includes("a('l06_design_version')"),'Both real W6 task-one evidence types stay required');
assert.ok(src.includes("await App.api('/upload'"),'Existing uploader remains intact');
assert.ok(src.includes("fd.append('changeBases'"),'Change-source metadata remains recorded');
console.log('V12.3 UPLOAD UI CHECK OK: one picker per evidence type, retained metadata, safe version browsing.');
