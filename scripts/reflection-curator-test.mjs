process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/design-reflection-v1151-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`test-reflection-v1151-${Date.now()}`;
import assert from 'node:assert/strict';
const {researchService}=await import('../src/services/researchService.js');
const {getSessionConfig}=await import('../src/config/researchConfig.js');

// No historical chat: standard case is visible, source is explicitly labeled, and the activity can be completed.
await researchService.createParticipant('S01',{grade:'7',condition:'A'});
const noChat=await researchService.orientationPublicState('S01','W7');
assert.equal(noChat.mode,'supported');
assert.equal(noChat.personal_query_options.length,0);
assert.equal(noChat.reflection_fallback_case.source,'standard_case');
assert.ok(noChat.reflection_fallback_case.body.length>=2);
assert.equal(noChat.cards.length,0);
assert.equal(noChat.case_selection_reason,'no_prior_chat');
await researchService.startOrientation('S01','W7');
const completedSample=await researchService.completeOrientation('S01','W7',{
  practice_1:1,practice_2:0,personal_ref:'', reflection_difficulty:'原提问要求直接给完整方案，但没有说明具体使用者和困难。',
  reflection_reply_review:'AI追问使用者困难和已尝试方法；还需要结合实际材料确认。',
  revised_question:'请根据我描述的具体困难，帮我比较两种局部固定办法，不要直接替我决定整套设计。',
  reflection_reason:'这样能把问题说具体，并保留我自己比较和选择方案的责任。',
});
assert.equal(completedSample.answers.reflection_source,'standard_case');
assert.equal(completedSample.answers.had_original_question,false);

// Has real prior dialogue: the student must choose one actual message and the source is recorded as personal_chat.
await researchService.createParticipant('S02',{grade:'7',condition:'A'});
await researchService.ensureStarted('S02','W6');
const user=await researchService.appendMessage('S02','W6',{role:'user',content:'直接给我完整的辅助绘画装置方案。',interaction_id:'ix1',agent_route:'EHS'});
await researchService.appendMessage('S02','W6',{role:'assistant',content:'你最想解决使用者哪一步的困难？你已经试过什么？',interaction_id:'ix1'});
const withChat=await researchService.orientationPublicState('S02','W7');
assert.ok(withChat.personal_query_options.length>=1);
await researchService.startOrientation('S02','W7');
const completedPersonal=await researchService.completeOrientation('S02','W7',{
  practice_1:1,practice_2:0,personal_ref:`W6:${user.message_index}`,
  reflection_difficulty:'我当时想解决装置设计，但没有说清具体使用者和哪一步最难。',
  reflection_reply_review:'AI让我说明困难和尝试，我需要补充真实材料和测试信息。',
  revised_question:'我的目标是帮助精细动作受限的人画直线，我已尝试海绵固定但铅笔会滑，请帮我比较两种局部改进。',
  reflection_reason:'新问题给出了对象、困难和已有尝试，也只请求比较而不是代做。',
});
assert.equal(completedPersonal.answers.reflection_source,'personal_chat');
assert.equal(completedPersonal.answers.had_original_question,true);
const w11=getSessionConfig('W11'),w12=getSessionConfig('W12');
assert.ok(w11.fields.some(f=>f.key==='curator_process_evidence'));
assert.ok(w12.fields.some(f=>f.key==='display_process_check'));
assert.ok(w11.brief.some(x=>x.includes('原型')&&x.includes('测试')));
console.log('REFLECTION/CURATOR OK v11.51: personal-chat and standard-case sources distinguished; W11/W12 whole-process exhibition fields present.');
