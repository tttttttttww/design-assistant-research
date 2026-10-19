process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/design-v1153-targeted-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`v1153-${Date.now()}`;
import assert from 'node:assert/strict';
const {researchService}=await import('../src/services/researchService.js');
const {storageService}=await import('../src/services/storageService.js');
const {putMessageCoding}=await import('../src/services/measurementService.js');
const candidate=async (id,sid,route,content,interaction)=>{
  await researchService.ensureStarted(id,sid);
  const q=await researchService.appendMessage(id,sid,{role:'user',agent_route:route,content,interaction_id:interaction});
  await researchService.appendMessage(id,sid,{role:'assistant',content:`回复${interaction}`,interaction_id:interaction});
  return q;
};
// Nothing previously sent => standard case, not a fabricated personal message.
await researchService.createParticipant('S01',{grade:'7',condition:'A'});
const blank=await researchService.orientationPublicState('S01','W7');
assert.equal(blank.case_selection_reason,'no_prior_chat');
assert.equal(blank.personal_query_options.length,0);
await researchService.startOrientation('S01','W7');
const frozen=await researchService.getOrientation('S01','W7');
assert.equal(frozen.displayed_cards[0].source,'standard_case');
// Prior good IHS only => standard case, not disparaging ordinary questions.
await researchService.createParticipant('S02',{grade:'7',condition:'A'});
await candidate('S02','W4','IHS','我想比较两种材料的稳定性','m-good');
const good=await researchService.orientationPublicState('S02','W7');
assert.equal(good.case_selection_reason,'no_identified_EHS_in_prior_chat');
assert.equal(good.personal_query_options.length,0);
// AI route EHS => candidate only, not human research classification.
await researchService.createParticipant('S03',{grade:'7',condition:'A'});
const flagged=await candidate('S03','W5','EHS','直接把所有方案写好给我','m-flag');
const flaggedState=await researchService.orientationPublicState('S03','W7');
assert.equal(flaggedState.personal_query_options.length,1);
assert.equal(flaggedState.case_selection_reason,'personal_EHS_candidate');
await researchService.startOrientation('S03','W7');
const before=await storageService.getObject(`participants/S03/sessions/W5/chat/messages/${String(flagged.message_index).padStart(5,'0')}.json`);
const completed=await researchService.completeOrientation('S03','W7',{personal_ref:`W5:${flagged.message_index}`,reflection_difficulty:'原问题让我不用自己设计，应该描述具体困难',reflection_reply_review:'AI建议需要核实，我当时没有全部采用',revised_question:'我的铅笔支架总是晃，能帮我分析这个局部问题吗？',reflection_reason:'只求局部帮助，关键方案自己判断'});
assert.equal(completed.answers.selected_case_basis,'agent_route_EHS_unverified');
assert.equal(await storageService.getObject(`participants/S03/sessions/W5/chat/messages/${String(flagged.message_index).padStart(5,'0')}.json`),before);
// Human IHS overrides a mistaken EHS route and must NOT be shown as poor.
await researchService.createParticipant('S05',{grade:'7',condition:'A'});
const falseFlag=await candidate('S05','W5','EHS','我只是想听材料比较依据','m-incorrect');
await putMessageCoding({participant_id:'S05',session_id:'W5',message_index:falseFlag.message_index,help_type:'IHS',process_codes:['H'],primary_process_code:'H',coder:'r1'});
const verifiedGood=await researchService.orientationPublicState('S05','W7');
assert.equal(verifiedGood.personal_query_options.length,0);
// Human EHS overrides an initial IHS route.
await researchService.createParticipant('S06',{grade:'7',condition:'A'});
const missed=await candidate('S06','W6','IHS','你替我完成全部工作我不想动脑','m-missed');
await putMessageCoding({participant_id:'S06',session_id:'W6',message_index:missed.message_index,help_type:'EHS',process_codes:['H'],primary_process_code:'H',coder:'r1'});
const human=await researchService.orientationPublicState('S06','W7');
assert.equal(human.personal_query_options.length,1);
await researchService.startOrientation('S06','W7');
const orig=await researchService.getOrientation('S06','W7');
assert.equal(orig.selection_meta[0].selection_basis,'human_coded_EHS');
// Once an activity starts, its displayed cards and allowed message references are frozen.
await putMessageCoding({participant_id:'S06',session_id:'W6',message_index:missed.message_index,help_type:'IHS',process_codes:['H'],primary_process_code:'H',coder:'r1'});
const afterHumanUpdate=await researchService.orientationPublicState('S06','W7');
assert.equal(afterHumanUpdate.personal_query_options.length,1);
assert.deepEqual(afterHumanUpdate.cards, orig.displayed_cards);
await researchService.completeOrientation('S06','W7',{personal_ref:`W6:${missed.message_index}`,reflection_difficulty:'没有说明具体困难',reflection_reply_review:'AI回复不等于我已经决定',revised_question:'我试过纸板却难固定，请帮我比较两种方法',reflection_reason:'保留自己实际设计判断'});
console.log('V11.53 TARGETED REFLECTION TEST OK: human preference, route fallback, ordinary requests not mislabeled, no chat fallback, frozen records, historical bytes intact.');
