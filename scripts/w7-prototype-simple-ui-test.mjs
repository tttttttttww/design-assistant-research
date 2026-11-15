import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const task=readFileSync(new URL('../public/js/task.js',import.meta.url),'utf8');
const start=task.indexOf('function w7PrototypeIterationHtml(){');
const end=task.indexOf('function compactW6EvidenceHtml(',start);
assert.ok(start>0&&end>start,'W7 prototype implementation not found');
const helper=task.slice(start,end);
const snapshot=({overview=[],wear=[],priorOverview=[],priorWear=[],progress=[]}={})=>{
  const state={session:{id:'W7'},record:{submitted_at:null,artifacts:{}},session_locked:false,
    carry_from:{session:{id:'W6'}},carry_artifact_versions:{l06_prototype_versions:priorOverview,l06_wear_versions:priorWear},
    artifact_versions:{l07_prototype_overview:overview,l07_prototype_wear:wear,l07_process_photo:progress}};
  const ctx={state,esc:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),artifactUrl:(v,sid='W7')=>'/image/'+sid+'/'+v.file_path};
  vm.createContext(ctx);vm.runInContext(helper,ctx);
  return vm.runInContext('w7PrototypeIterationHtml()',ctx);
};
const pic=(n,what)=>({file_path:`${what}-${n}.jpg`,version_no:n,kind:'revision',change_note:'改进画笔固定位置'});
const file=(html,key)=>html.match(new RegExp(`<input[^>]+data-artifact="${key}"[^>]*>`))?.[0]||'';
{
 const html=snapshot();
 assert.match(html,/上传新原型/);assert.match(html,/做了\/改了哪里？/);
 assert.match(html,/① 选择原型整体图/);assert.match(html,/② 选择实际佩戴图/);
 assert.match(html,/还没做完？保存制作进度照片（选填）/);
 assert.ok(!file(html,'l07_prototype_overview').includes('disabled'),'First overview should be allowed');
 assert.ok(file(html,'l07_prototype_wear').includes('disabled'),'Wear only after its overview');
 assert.ok(!html.includes('主要参考什么')&&!html.includes('AI建议最后怎样处理'),'No extra decision questionnaire');
 assert.ok(!html.includes('data-w8-exchange-count'),'Only final page shows chat counter');
}
{
 const html=snapshot({overview:[pic(1,'overall')]});
 assert.match(html,/当前原型 · 第1版/);
 assert.ok(file(html,'l07_prototype_overview').includes('disabled'),'Cannot upload V2 before wearing photo of V1');
 assert.ok(!file(html,'l07_prototype_wear').includes('disabled'),'Wear must unlock after overview');
 assert.match(html,/这版还差一张佩戴图/);
}
{
 const html=snapshot({overview:[pic(2,'overall')],wear:[pic(2,'wear')],priorOverview:[pic(1,'overall')],priorWear:[pic(1,'wear')]});
 assert.match(html,/当前原型 · 第2版/);
 assert.match(html,/查看之前的原型（1版）/);
 assert.ok(!file(html,'l07_prototype_overview').includes('disabled'),'Next version must unlock after matching wear');
 assert.ok(file(html,'l07_prototype_wear').includes('disabled'),'No redundant wear version without overview');
 assert.match(html,/第3版/);
}
{
 const html=snapshot({priorOverview:[pic(1,'overall')],priorWear:[pic(1,'wear')]});
 assert.match(html,/当前原型 · 第1版/);
 assert.match(html,/第2版/);
 assert.ok(!file(html,'l07_prototype_overview').includes('disabled'),'Carry should not block making a new prototype');
}
console.log('W7 SIMPLE PROTOTYPE UI PASS: short form, first upload, pending wear, matched pair, W6 carry and version unlocking.');
