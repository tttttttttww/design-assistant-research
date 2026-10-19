process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/design-v1154-weekly-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`v1154-${Date.now()}`;
import assert from 'node:assert/strict';
const { researchService }=await import('../src/services/researchService.js');
const { storageService }=await import('../src/services/storageService.js');
const {INTERVENTION_ORIENTATION,SESSIONS}=await import('../src/config/researchConfig.js');
const {putMessageCoding}=await import('../src/services/measurementService.js');
const addPair=async(id,sid,route,text,key)=>{
 await researchService.ensureStarted(id,sid);
 const m=await researchService.appendMessage(id,sid,{role:'user',content:text,interaction_id:key,agent_route:route});
 await researchService.appendMessage(id,sid,{role:'assistant',content:'关于这条问题的真实模拟回复',interaction_id:key});
 return m;
};
await researchService.createParticipant('S01',{grade:'7',condition:'A'});
const w4=await addPair('S01','W4','EHS','直接给我一个完整装置，我照着做','orig1');
const priorKey=`participants/S01/sessions/W4/chat/messages/${String(w4.message_index).padStart(5,'0')}.json`;
const oldText=await storageService.getObject(priorKey);
const preState=await researchService.orientationPublicState('S01','W5');
assert.equal(preState.strategy_micro_lesson,true);
assert.equal(preState.previous_session_id,'W4');
assert.equal(preState.personal_query_options.length,1);
assert.equal(preState.case_selection_reason,'personal_EHS_candidate');
await researchService.startOrientation('S01','W5');
let locked=false;try{await researchService.assertTaskAccess('S01','W5')}catch(e){locked=e.status===409}
assert.equal(locked,true);
const w5Review=await researchService.completeOrientation('S01','W5',{practice_1:0,practice_2:0,personal_ref:`W4:${w4.message_index}`,reflection_difficulty:'原问题没有清楚说明需要帮助的具体地方',reflection_reply_review:'AI讲了判断方向我还没有实际测试过',revised_question:'我已经画了草图，怎样检查铅笔的固定是否可靠？',reflection_reason:'说明具体任务困难，同时保留实际设计选择'});
assert.equal(w5Review.answers.strategy_practice_count,2);
assert.equal(w5Review.answers.strategy_practice_correct_count,0);
assert.equal(w5Review.answers.reflection_source,'personal_chat');
await researchService.assertTaskAccess('S01','W5');
assert.equal(await storageService.getObject(priorKey),oldText);
const w5Prior=await addPair('S01','W5','IHS','我做了两种连接，有哪些点值得比较','orig2');
const w6State=await researchService.orientationPublicState('S01','W6');
assert.equal(w6State.personal_query_options.length,1);
assert.equal(w6State.personal_query_options[0].session_id,'W5');
assert.equal(w6State.case_selection_reason,'personal_IHS_neutral_review');
await researchService.startOrientation('S01','W6');
await researchService.completeOrientation('S01','W6',{practice_1:1,practice_2:0,personal_ref:`W5:${w5Prior.message_index}`,reflection_difficulty:'我的问题已经说了在比较两种连接方式',reflection_reply_review:'AI提到需要检查稳定性，但我还没有测试',revised_question:'两种连接方法在稳固性上应该怎样做对比测试？',reflection_reason:'继续明确需要怎样比较，而不是让AI替我决定'});
// If prior messages have no valid help request, display an explicitly labeled standard case.
await researchService.createParticipant('S02',{grade:'7',condition:'A'});
const noChat=await researchService.orientationPublicState('S02','W5');
assert.equal(noChat.case_selection_reason,'no_prior_chat');
await researchService.startOrientation('S02','W5');
const fallback=await researchService.completeOrientation('S02','W5',{practice_1:1,practice_2:1,reflection_difficulty:'案例直接索取全部结果',reflection_reply_review:'案例没有真实验证，仍需检查',revised_question:'请帮我比较局部方法有哪些优缺点',reflection_reason:'把要解决的局部需求交代清楚'});
assert.equal(fallback.answers.reflection_source,'standard_case');
assert.equal(fallback.answers.prior_chat_count,0);
// Human IHS overrides mistaken route label, preventing disparaging normal questions.
await researchService.createParticipant('S03',{grade:'7',condition:'A'});
const misroute=await addPair('S03','W4','EHS','我想对比固定位置的两个方案','badroute');
await putMessageCoding({participant_id:'S03',session_id:'W4',message_index:misroute.message_index,help_type:'IHS',process_codes:['H'],primary_process_code:'H',coder:'r1'});
const corrected=await researchService.orientationPublicState('S03','W5');
assert.equal(corrected.case_selection_reason,'personal_IHS_neutral_review');
// A pre-existing work record is never retroactively blocked by a newly added lesson opener.
await researchService.createParticipant('S07',{grade:'7',condition:'A'});
await researchService.ensureStarted('S07','W5');
assert.equal(await researchService.orientationPublicState('S07','W5'),null);
await researchService.assertTaskAccess('S07','W5');
// Control gets non-help-seeking task preparation only.
await researchService.createParticipant('S05',{grade:'7',condition:'B'});
const b=await researchService.orientationPublicState('S05','W5');
assert.equal(b.mode,'control');assert.equal(b.reflection_activity,false);
await researchService.startOrientation('S05','W5');
await researchService.completeOrientation('S05','W5',{neutral_observation:'完成了最初草图，记录了设计想法',neutral_nextstep:'准备检查材料并完成制作准备图',acknowledged:[]});
for(const sid of ['W5','W6','W7','W8','W9','W10']){
 const c=INTERVENTION_ORIENTATION[sid];assert.equal(c.supported.checks.length,2);
 assert.equal(c.supported.previous_session_id,`W${Number(sid.slice(1))-1}`);
 assert.equal(c.control.neutral_design_note_required,true);
}
assert.equal((await researchService.orientationPublicState('S01','W11')),null);
assert.equal((await researchService.orientationPublicState('S01','W12')),null);
// Simulate an old W7 activity; when new protocol is activated it is preserved in archive.
await researchService.createParticipant('S06',{grade:'7',condition:'A'});
const legacy={mode:'supported',orientation_key:'personal-help-seeking-reflection-w7-v5-targeted-case',started_at:'2026-10-01T00:00:00Z',completed_at:'2026-10-01T00:06:00Z',answers:{legacy:'original'}};
await storageService.putObject('participants/S06/sessions/W7/orientation.json',JSON.stringify(legacy));
assert.equal(await researchService.orientationPublicState('S06','W7'),null);
assert.deepEqual(await researchService.getOrientation('S06','W7'),legacy);
await researchService.assertTaskAccess('S06','W7');
// An incomplete legacy orientation that never reached the task can be archived on start.
await researchService.createParticipant('S08',{grade:'7',condition:'A'});
const legacyIncomplete={...legacy,completed_at:null};
await storageService.putObject('participants/S08/sessions/W7/orientation.json',JSON.stringify(legacyIncomplete));
const fresh=await researchService.startOrientation('S08','W7');
assert.equal(fresh.orientation_key,INTERVENTION_ORIENTATION.W7.supported.key);
const archived=await storageService.listObjects('orientation-archives/S08/W7/');
assert.equal(archived.length,1);
const archiveText=await storageService.getObject(archived[0].key);
assert.equal(JSON.parse(archiveText).answers.legacy,'original');
console.log('WEEKLY INTERVENTION v11.54 PASS: last-session review; wrong quiz accepted as teaching; no-chat & IHS fallbacks; old W4 chat byte-identical; control neutral; prior W7 archived; W11-12 no training.');
