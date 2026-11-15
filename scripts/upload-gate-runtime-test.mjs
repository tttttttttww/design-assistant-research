// Real upload handler exercised with fake Blob, no network and no student data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {getSessionConfig} from '../src/config/researchConfig.js';
const source=readFileSync(new URL('../src/routes/upload.js',import.meta.url),'utf8')
  .replace(/^import .*;$/gm,'').replace(/^export default router;?/gm,'');
let handler;
const express={Router:()=>({post:(route,...fns)=>{if(route==='/upload')handler=fns.at(-1)},get:()=>{}})};
const multer=Object.assign(()=>({single:()=>()=>{}}),{memoryStorage:()=>({})});
const uuidv4=()=> 'test-uuid';
let currentSid='W7',completed=['task1'],isSubmitted=false,stored=[];
const researchService={
  getSettings:async()=>({active_session_id:currentSid,session_open:true,locked_session_ids:[],cohort_revision:'test'}),
  getTaskFlowState:async()=>({completed_steps:completed}),
  getSessionRecord:async()=>({submitted_at:isSubmitted}),
  getMessages:async()=>[],
  addArtifact:async(id,sid,key,meta)=>({artifacts:{[key]:meta}}),
};
const storageService={putObject:async(key,buffer)=>{stored.push(key)}};
const fakeNormalize=x=>x;
new Function('express','multer','uuidv4','researchService','storageService','getSessionConfig','isAllowedParticipant','normalizeParticipantId','isTestParticipant','Buffer',source+'\nreturn router;')(
  express,multer,uuidv4,researchService,storageService,getSessionConfig,
  ()=>true,fakeNormalize,()=>true,Buffer);
assert.equal(typeof handler,'function');
const sample={buffer:Buffer.from([137,80,78,71,13,10,26,10,0,0,0]),mimetype:'image/png'};
async function call(sid,key,withNote=true){
 currentSid=sid;
 const req={body:{participantId:'S00',sessionId:sid,artifactKey:key,
   changeNote:withNote?'设计图的固定结构已调整':'',changeBases:'自己的想法'},
   headers:{'x-cohort-revision':'test'},file:sample};
 const res={statusCode:200,status(n){this.statusCode=n;return this},json(data){this.body=data;return this}};
 await handler(req,res);
 return res;
}
let res=await call('W7','l07_design_version');
assert.equal(res.statusCode,200,'W7 drawing must be uploadable after completing task1');
assert.ok(stored.some(x=>x.includes('l07_design_version')));
completed=[];
res=await call('W7','l07_prototype_overview');
assert.equal(res.statusCode,409,'Cannot upload prototype before completing initial drawing check');
completed=['task1'];
res=await call('W7','l07_prototype_overview');
assert.equal(res.statusCode,200,'Prototype allowed after task1');
completed=['task1','task2'];
res=await call('W7','l07_prototype_overview');
assert.equal(res.statusCode,409,'Do not modify completed prototype unless session reopened');
res=await call('W7','l07_design_version');
assert.equal(res.statusCode,200,'W7 drawing may be revised even if stage2 done, provided whole session reopened');
isSubmitted=true;
res=await call('W7','l07_design_version');
assert.equal(res.statusCode,409,'Submitted session must be explicitly reopened');
isSubmitted=false;
completed=['task1'];
res=await call('W6','l06_design_version');
assert.equal(res.statusCode,409,'Original W6 lock must not change');
console.log('UPLOAD HANDLER PASS: W7 drawings editable after proceeding, prototypes gated, submitted sessions protected, W6 unchanged.');
