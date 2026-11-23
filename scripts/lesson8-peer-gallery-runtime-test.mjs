// W8 gallery + review regression test. Isolated local store; never touches live student data.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'lesson8-peer-safe-'));
process.env.LOCAL_STORAGE_DIR=dir;
process.env.USE_LOCAL_STORAGE='1';
process.env.NODE_ENV='test';
process.env.EXPERIMENT_RUN_ID='lesson8-isolated-test';
const { researchService:r }=await import('../src/services/researchService.js');
const { storageService:storage }=await import('../src/services/storageService.js');
const { getSessionConfig }=await import('../src/config/researchConfig.js');
const { reviewsByAuthor, reviewsForTarget, peerReviewCandidates, savePeerReview }=await import('../src/services/peerReviewService.js');
const gallery=async id=>{
 const cards=[];
 for(const target of peerReviewCandidates(id)){
  const state=await r.getTaskFlowState(target,'W8');
  if(state?.completed_steps?.includes('task2'))cards.push(target);
 }
 return cards;
};
const review=async(from,to,data)=>savePeerReview({from,to,allowedTargets:await gallery(from),...data});
const texts={l08_dt_empathize:'观察使用者握笔困难',l08_dt_define:'改进画笔固定与操作便利',l08_dt_ideate:'比较笔套和弹力绳两个方案',l08_dt_prototype:'制作了手持画笔辅助夹具',l08_dt_test:'目前只检查了连接牢固，尚未实际试戴',l08_dt_reflection:'学会用证据检查自己的设计'};
const mockImage=(id)=>({file_name:`mock-${id}.png`,file_path:`uploads/${id}/W8/l08_showcase_photo/mock-${id}.png`,mime:'image/png',kind:'draft',change_note:'当前真实原型图片，用于测试',ai_usage_role:'not_used'});
const expectFail=async(fn,pattern)=>{let err;try{await fn()}catch(e){err=e}assert.ok(err,'expected error');assert.match(err.message,pattern);};
try{
  assert.equal(getSessionConfig('W8').ai_use_required_once,true,'W8 requires real AI replies');
  assert.equal(getSessionConfig('W8').task_flow.min_ai_exchanges_total,3,'W8 requires three paired exchanges across the lesson');
  assert.equal(getSessionConfig('W8').task_flow.steps[0].min_ai_exchanges,0,'W8 task 1 publish does not require AI');
  assert.equal(getSessionConfig('W8').task_flow.steps[3].min_ai_exchanges_total,3,'W8 task 4 checks full-lesson count');
  const sharedKeys=['l08_shared_change','l08_shared_change_reason','l08_shared_ai_reference','l08_shared_ai_decision'];
  for(const key of sharedKeys){
    const f=getSessionConfig('W8').fields.find(x=>x.key===key);
    assert.ok(f && f.stage==='task4' && f.required===false, `missing neutral shared evidence field ${key}`);
  }
  assert.equal(getSessionConfig('W8').task_flow.steps.length,4,'W8 has four task steps');

  assert.equal(getSessionConfig('W7').task_flow.steps[1].min_ai_exchanges_total,10,'W7 baseline unchanged');
  await r.saveSettings({active_session_id:'W8',session_open:true});
  await r.createParticipant('S00',{condition:'B'});
  await r.createParticipant('S99',{condition:'A'});
  // A user request can be recovered intact before the current AI reply;
  // predecessor markers reflect context, not a system verdict about learning.
  const rawRequest=await r.appendMessage('S99','W8',{
    role:'user', content:'我应该怎样检查连接会不会松开？',
    request_capture_stage:'student_sent_before_current_ai_reply',
    preceding_assistant_message_id:'prior-ai-123',
    preceding_ai_scaffold_type:'help_evaluation_prompt',
    preceding_ai_route:'IHS',
  });
  const recovered=(await r.getMessages('S99','W8')).find(m=>m.message_id===rawRequest.message_id);
  assert.equal(recovered.content,'我应该怎样检查连接会不会松开？');
  assert.equal(recovered.request_capture_stage,'student_sent_before_current_ai_reply');
  assert.equal(recovered.preceding_assistant_message_id,'prior-ai-123');
  assert.equal(recovered.preceding_ai_scaffold_type,'help_evaluation_prompt');
  assert.ok(!(await r.getTaskFlowState('S00','W8')).completed_steps.includes('task1'),'no browsing before own publish');
  await expectFail(()=>r.submitTaskStep('S00','W8','task1',texts),/上传/);
  await r.addArtifact('S00','W8','l08_showcase_photo',mockImage('S00'));
  await r.addArtifact('S00','W8','l08_design_versions',{...mockImage('S00'),artifact_key:'l08_design_versions'});
  await storage.putObject('uploads/S00/W8/l08_showcase_photo/mock-S00.png',Buffer.from('TEST'));
  await r.addArtifact('S00','W8','l08_design_versions',{...mockImage('S00'),artifact_key:'l08_design_versions',kind:'revision'});
  await expectFail(()=>r.submitTaskStep('S00','W8','task1',{}),/配套照片/);
  await r.addArtifact('S00','W8','l08_showcase_photo',{...mockImage('S00'),kind:'revision'});
  await r.submitTaskStep('S00','W8','task1',{});
  let view=await gallery('S00'); assert.deepEqual(view,[], 'draft versions are not public before five-step publication');
  await r.submitTaskStep('S00','W8','task2',texts);
  view=await gallery('S00'); assert.deepEqual(view,['S00']);
  await r.addArtifact('S99','W8','l08_showcase_photo',mockImage('S99'));
  await r.addArtifact('S99','W8','l08_design_versions',{...mockImage('S99'),artifact_key:'l08_design_versions'});
  await r.submitTaskStep('S99','W8','task1',{});
  await r.submitTaskStep('S99','W8','task2',texts);
  view=await gallery('S00');assert.equal(view.length,2);
  await expectFail(()=>review('S00','S00',{strength:'很牢固',question:'是否可靠',suggestion:'请测连接'}),/不能评价自己/);
  await expectFail(()=>review('S00','S99',{strength:'好',question:'难',suggestion:'改'}),/至少4个字/);
  const data={strength:'连接位置很清晰',question:'需要检查画笔会不会滑动',suggestion:'建议先多次画线观察夹紧程度'};
  const saved=await review('S00','S99',data);assert.equal(saved.to,'S99');
  assert.equal((await reviewsByAuthor('S00')).length,1);
  assert.equal((await reviewsForTarget('S99')).length,1);
  assert.equal((await reviewsForTarget('S99')).length,1);
  await r.submitTaskStep('S00','W8','task3',{l08_peer_decision:'听到建议，计划先测滑动'});
  assert.equal((await r.getTaskFlowState('S00','W8')).completed_steps.includes('task3'),true);
  assert.ok(!(await r.getSessionRecord('S00','W8')).submitted_at,'peer step alone must not finalize lesson');
  await expectFail(()=>r.submitTaskStep('S00','W8','task4',{l08_ai_review_complete:'本节没有需要处理的AI建议',l08_ai_suggestion_reviews_json:'[]',lesson_no_history_reason:'今天尚未提问'}),/还需要3轮/);
  // Only successfully paired student+assistant messages count; chat phase is tracked.
  const m=(role,index,phase)=>({participant_id:'S00',session_id:'W8',role,interaction_id:`real-pair-${Math.ceil(index/2)}`,message_id:`m-${index}`,message_index:index,content:role==='user'?'同学建议加固，我怎么验证会不会滑动？':'可以先画相同线条，记录笔的移动。',task_context:{task_phase:phase},created_at:new Date().toISOString()});
  const saveMsg=async(index,role,phase)=>storage.putObject(`participants/S00/sessions/W8/chat/messages/${String(index).padStart(5,'0')}.json`,JSON.stringify(m(role,index,phase)));
  // One exchange and an incomplete unanswered request: still only one valid round.
  await saveMsg(1,'user','lesson8_peer');await saveMsg(2,'assistant','lesson8_peer');
  await saveMsg(3,'user','lesson8_peer');
  assert.equal((await r.getTaskFlowState('S00','W8')).total_ai_exchanges,1,'unanswered message not counted');
  const finalFields={l08_ai_review_complete:'本节没有需要处理的AI建议',l08_ai_suggestion_reviews_json:'[]',l08_shared_change:'考虑加固夹笔位置',lesson_review_reference:'m-2',lesson_review_use:'AI给出可检验步骤，我准备自己实验。',lesson_review_next:'以后说明已经做过的操作和实际观察。'};
  await expectFail(()=>r.submitTaskStep('S00','W8','task4',finalFields),/还需要2轮/);
  await saveMsg(4,'assistant','lesson8_peer');
  assert.equal((await r.getTaskFlowState('S00','W8')).total_ai_exchanges,2);
  await expectFail(()=>r.submitTaskStep('S00','W8','task4',finalFields),/还需要1轮/);
  await saveMsg(5,'user','lesson8_peer');await saveMsg(6,'assistant','lesson8_peer');
  assert.equal((await r.getTaskFlowState('S00','W8')).total_ai_exchanges,3);
  finalFields.lesson_review_reference='m-6';
  const advice=[{message_id:'m-6',part_index:0,excerpt:'可以先画相同线条，记录笔的移动。',decision:'调整后采纳'}];
  await expectFail(()=>r.submitTaskStep('S00','W8','task4',{...finalFields,l08_ai_review_complete:'已记录相关AI建议的处理方式',l08_ai_suggestion_reviews_json:JSON.stringify([{...advice[0],message_id:'fake-message'}])}),/对应本节真实回复/);
  finalFields.l08_ai_review_complete='已记录相关AI建议的处理方式';
  finalFields.l08_ai_suggestion_reviews_json=JSON.stringify(advice);
  await r.submitTaskStep('S00','W8','task4',finalFields);
  assert.deepEqual(JSON.parse((await r.getSessionRecord('S00','W8')).text_fields.l08_ai_suggestion_reviews_json),advice,'choices linked to real AI message are retained');
  assert.ok((await r.getSessionRecord('S00','W8')).submitted_at,'peer review and AI conversation qualify for final submission');
  assert.equal((await r.getTaskFlowState('S00','W8')).completed_steps.includes('task4'),true);
  console.log('LESSON8 FLEXIBLE VERSION + PEER GALLERY PASS: isolated data, publication gate, test cohort, anonymized gallery, no self-review, quality gate, review trace, three real AI exchanges, gated submission, read-only after completion.');
}finally{
 await rm(dir,{recursive:true,force:true});
}
