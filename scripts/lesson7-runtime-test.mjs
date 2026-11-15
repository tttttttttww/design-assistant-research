// Isolated real storage/service test; no actual Coze requests, no production student data.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'lesson7-reviewed-'));
process.env.LOCAL_STORAGE_DIR=dir;
process.env.USE_LOCAL_STORAGE='1';
process.env.NODE_ENV='test';
process.env.EXPERIMENT_RUN_ID='isolated-runtime-tests';
const {researchService:r}=await import('../src/services/researchService.js');
const {storageService:store}=await import('../src/services/storageService.js');
const {getSessionConfig}=await import('../src/config/researchConfig.js');
const photo=key=>({file_path:`uploads/S00/W7/${key}/test-${key}.png`,file_name:`${key}.png`,kind:'draft',mime:'image/png',change_note:'真实修改：加强了固定连接',change_bases:['自己的想法'],ai_usage_role:'not_used'});
const saveChat=async(id,idx,role,interaction,phase)=>{
  const m={participant_id:id,session_id:'W7',role,interaction_id:interaction,message_id:`${role}-${idx}`,message_index:idx,task_context:{task_phase:phase},content:role==='user'?'请帮我分析固定问题':'可以先检验连接位置和稳定性',created_at:new Date().toISOString()};
  await store.putObject(`participants/${id}/sessions/W7/chat/messages/${String(idx).padStart(5,'0')}.json`,JSON.stringify(m));
};
const shouldFail=async(fn,re)=>{
  let error;
  try{await fn();}catch(e){error=e;}
  assert.ok(error,'expected a blocking error');
  assert.match(error.message,re);
};
try{
  const cfg=getSessionConfig('W7');
  assert.equal(cfg.actual_lesson,7);
  const saved=await r.saveSettings({active_session_id:'W7',session_open:true});
  assert.equal(saved.active_session_id,'W7');
  assert.equal((await r.getSettings()).active_session_id,'W7');
  await r.createParticipant('S00',{condition:'B'});
  await r.createParticipant('S99',{condition:'A'});
  const fields={l07_check1:'我还没有检查，不确定',l07_check2:'我检查了，暂时没发现问题',l07_check3:'我还没做到这一步',l07_check_evidence:'还没有测试画笔是否会滑动'};
  // No drawing may not be falsely treated as a completed sketch.
  await shouldFail(()=>r.submitTaskStep('S00','W7','task1',fields),/设计图|图纸/);
  await r.addArtifact('S00','W6','l06_design_version',{...photo('l06_design_version'),file_path:'uploads/S00/W6/l06_design_version/v1.png'});
  await r.addArtifact('S00','W6','l06_prototype_versions',{...photo('l06_prototype_versions'),file_path:'uploads/S00/W6/l06_prototype_versions/v1.png'});
  await r.addArtifact('S00','W6','l06_wear_versions',{...photo('l06_wear_versions'),file_path:'uploads/S00/W6/l06_wear_versions/v1.png'});
  const prior=await r.getArtifactVersions('S00','W6');
  assert.equal(prior.l06_design_version.length,1);
  // Prior W6 images alone must not satisfy W7 first step: upload a current-session copy of the actual drawing.
  await shouldFail(()=>r.submitTaskStep('S00','W7','task1',fields),/上节课.*图纸|设计图纸/);
  const baseline=await r.addArtifact('S00','W7','l07_design_version',{
    ...photo('l07_design_version'),change_note:'上节课图纸，作为本节修改起点'});
  assert.equal(baseline.artifact_versions.l07_design_version.length,1);
  await r.submitTaskStep('S00','W7','task1',fields);
  // Drawing remains editable after beginning prototype work. Versions continue after the W6 baseline.
  const second=await r.addArtifact('S00','W7','l07_design_version',{...photo('l07_design_version'),file_path:'uploads/S00/W7/l07_design_version/test-2.png'});
  assert.equal(second.artifact_versions.l07_design_version[1].version_no,baseline.artifact_versions.l07_design_version[0].version_no+1);
  const third=await r.addArtifact('S00','W7','l07_design_version',{...photo('l07_design_version'),file_path:'uploads/S00/W7/l07_design_version/test-3.png'});
  assert.equal(third.artifact_versions.l07_design_version[2].version_no,second.artifact_versions.l07_design_version[1].version_no+1);
  assert.equal((await r.getArtifactVersions('S00','W6')).l06_design_version.length,1,'Historical version must remain unchanged');
  // The two formal pictures must inherit exactly the same version number.
  const prototype=await r.addArtifact('S00','W7','l07_prototype_overview',photo('l07_prototype_overview'));
  const worn=await r.addArtifact('S00','W7','l07_prototype_wear',photo('l07_prototype_wear'));
  assert.equal(prototype.artifact_versions.l07_prototype_overview[0].version_no,2);
  assert.equal(worn.artifact_versions.l07_prototype_wear[0].version_no,2);
  for(let n=1;n<=9;n++){
    const phase=n<=4?'lesson7_check':'lesson7_work';
    await saveChat('S00',2*n-1,'user',`i${n}`,phase);
    await saveChat('S00',2*n,'assistant',`i${n}`,phase);
  }
  const bReview={lesson_review_reference:'assistant-2',lesson_review_use:'AI建议先测试夹笔处，我决定先检查。',lesson_review_next:'下次描述问题和尝试过的办法。'};
  await shouldFail(()=>r.submitTaskStep('S00','W7','task2',bReview),/还需要1轮/);
  await saveChat('S00',19,'user','i10','lesson7_work');
  await saveChat('S00',20,'assistant','i10','lesson7_work');
  const result=await r.submitTaskStep('S00','W7','task2',{
    lesson_review_reference:'assistant-2',
    lesson_review_use:'AI建议先测试夹笔处。我根据材料调整后准备实际检验。',
    lesson_review_next:'下一次描述观察现象和已做的尝试，再决定采用哪条建议。'
  });
  assert.ok(result.record.submitted_at,'10 pairs + matched photos + B reflection must allow final submission');
  assert.equal(result.task_progress.total_ai_exchanges,10);
  await r.reopenSession('S00','W7');
  assert.equal((await r.getSessionRecord('S00','W7')).submitted_at,null,'Reopen must not delete records');
  // A-control stays neutral and has no forced scaffolded reflection.
  assert.equal((await r.effectiveVariantFor('S99','W7',await r.getParticipant('S99'))),'free');
  assert.equal((await r.effectiveVariantFor('S00','W7',await r.getParticipant('S00'))),'supported');
  console.log('LESSON7 RUNTIME PASS: W7 switching, missing drawing gate, carried drawing, V2/V3 numbering, paired prototype, 9/10-turn final gating, supported reflection, reopen, A/B variants.');
}finally{
  await rm(dir,{recursive:true,force:true});
}
