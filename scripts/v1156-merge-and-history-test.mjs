process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/v1156-verify-${process.pid}-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`last-class-history-test-${process.pid}`;
import assert from 'node:assert/strict';
const {storageService}=await import('../src/services/storageService.js');
const {researchService}=await import('../src/services/researchService.js');
const {INTERVENTION_ORIENTATION,SESSIONS}=await import('../src/config/researchConfig.js');
// Seed raw original historical files directly, exactly as on an earlier deployed project.
const historical={
 'participants/S01.json':JSON.stringify({participant_id:'S01',condition:'A',grade:'8',login_name_hash:'old-hash',created_at:'2026-10-10T01:00:00Z',last_active_at:'2026-10-11T01:00:00Z'}),
 'participants/S01/sessions/W4/record.json':'{"participant_id":"S01","session_id":"W4","started_at":"2026-10-11T01:00:00Z","ai_used":true}',
 'participants/S01/sessions/W4/chat/messages/00001.json':JSON.stringify({role:'user',message_index:1,agent_route:'EHS',content:'以前直接让AI设计完整方案',interaction_id:'old-1'}),
 'participants/S01/sessions/W4/chat/messages/00002.json':JSON.stringify({role:'assistant',message_index:2,content:'先说一说真实困难',interaction_id:'old-1'}),
 'participants/S01/sessions/W4/chat/session.json':JSON.stringify({session_id:'old-conversation-1',user_turn_count:1,assistant_turn_count:1}),
 'participants/S01/sessions/W4/events/00001.json':JSON.stringify({type:'ai_opened',at:'2026-10-11T01:00:00Z'}),
};
for(const [key,value] of Object.entries(historical))await storageService.putObject(key,value);
await storageService.putObject('uploads/S01/W4/20261011.jpg',Buffer.from('old-image-binary'));
assert.deepEqual(storageService.fullKey('participants/S01.json'),`runs/${process.env.EXPERIMENT_RUN_ID}/course-v11-enhanced/participants/S01.json`);
const profile=await researchService.getParticipantReadOnly('S01');assert.equal(profile.condition,'A');
const missing=await researchService.getParticipantReadOnly('S02');assert.equal(missing.history_profile_missing,true);
assert.equal(await storageService.getObject('participants/S02.json'),null,'monitor must not create a blank profile');
const state=await researchService.orientationPublicState('S01','W5');
assert.equal(state.previous_session_id,'W4');
assert.equal(state.strategy_micro_lesson,true);
assert.equal(state.personal_query_options[0].session_id,'W4');
await researchService.startOrientation('S01','W5');
await researchService.completeOrientation('S01','W5',{practice_1:1,practice_2:1,personal_ref:'W4:1',reflection_difficulty:'原问题直接让AI设计全部',reflection_reply_review:'AI提醒我应当明确困难',revised_question:'请帮我分析我画的装置哪里不稳',reflection_reason:'保留关键方案自己做决定'});
for(const [key,value] of Object.entries(historical))assert.equal(await storageService.getObject(key),value,'old data changed: '+key);
assert.equal((await storageService.getObjectBuffer('uploads/S01/W4/20261011.jpg')).toString(),'old-image-binary');
assert.equal(INTERVENTION_ORIENTATION.W10.supported.checks.length,2);
assert.equal((await researchService.orientationPublicState('S01','W11')),null);
assert.equal(SESSIONS.find(s=>s.id==='W11').phase,'transfer');
let stopped=false;try{await researchService.archiveAndResetSession('S01','W4')}catch(e){stopped=e.status===403}assert.equal(stopped,true);
stopped=false;try{await researchService.replaceFormalCohort([])}catch(e){stopped=e.status===403}assert.equal(stopped,true);
assert.equal(await storageService.getObject('participants/S01/sessions/W4/chat/messages/00001.json'),historical['participants/S01/sessions/W4/chat/messages/00001.json']);
const probe=await storageService.discoverRunPrefixes();assert.equal(probe.mode,'local');
console.log('V11.56 MERGED PASS: historical W4 JSON and original picture byte-identical, no auto-created missing profile, W5 new training, W11 migration, formal delete paths blocked, same storage root.');
