process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/design-measure-v1147-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`test-v1147-${Date.now()}`;
import assert from 'node:assert/strict';
const {researchService}=await import('../src/services/researchService.js');
const {storageService}=await import('../src/services/storageService.js');
const {getSessionConfig}=await import('../src/config/researchConfig.js');
const {putMessageCoding,getMessageCoding,getMeasurements,codingDataset,putInterviewNote,getInterviewNote,interviewDataset}=await import('../src/services/measurementService.js');
// Existing historical objects in original storage namespace stay untouched after coding.
await researchService.createParticipant('S01',{grade:'7',condition:'A'});
await researchService.ensureStarted('S01','W1');
await researchService.markAiOpened('S01','W1');
await researchService.markFirstUserMessage('S01','W1');
const initial=await researchService.appendMessage('S01','W1',{role:'user',content:'直接给我完整成品',agent_route:'EHS',scaffold_triggered:true});
const backup=await storageService.getObject(`participants/S01/sessions/W1/chat/messages/${String(initial.message_index).padStart(5,'0')}.json`);
assert.ok(backup,'historical original message should exist');
// The next session is independently stored, without overwrite.
await researchService.createParticipant('S02',{grade:'7',condition:'B'});
await researchService.ensureStarted('S02','W5');
await researchService.markAiOpened('S02','W5');
await researchService.appendEvent('S02','W5','ai_draft_deleted_unsent',{max_chars:10});
await researchService.appendEvent('S02','W5','chat_history_revisit',{dwell_ms:2000});
const before=await getMeasurements('W1');
const first=before.find(x=>x.participant_id==='S01');
assert.equal(first.user_messages,1);
assert.equal(first.messages_pending_human_coding,1);
assert.equal(first.ehs_human,0); // system classified EHS, manual not yet labeled
assert.equal(first.ehs_share_among_ihs_ehs,null); // never auto-code
await putMessageCoding({participant_id:'S01',session_id:'W1',message_index:initial.message_index,help_type:'EHS',process_codes:['H'],memo:'要求代做',coder:'r1'});
await putMessageCoding({participant_id:'S01',session_id:'W1',message_index:initial.message_index,help_type:'IHS',process_codes:['H','D'],memo:'second pass',coder:'r1'});
const code=await getMessageCoding('S01','W1');
assert.equal(code.length,1);
assert.equal(code[0].revision,2);
assert.equal(code[0].help_type,'IHS');
assert.equal(await storageService.getObject(`participants/S01/sessions/W1/chat/messages/${String(initial.message_index).padStart(5,'0')}.json`),backup,'human coding must not edit source');
const codingAudit=await storageService.listObjects('research-coding-audit/S01/W1/');
assert.equal(codingAudit.length,2);
const after=await getMeasurements('W1');
assert.equal(after.find(x=>x.participant_id==='S01').ihs_human,1);
assert.equal(after.find(x=>x.participant_id==='S01').ihs_share_among_ihs_ehs,1);
const w5=await getMeasurements('W5');
assert.equal(w5.length,30);
const noQuestion=w5.find(x=>x.participant_id==='S02');
assert.equal(noQuestion.user_messages,0);
assert.equal(noQuestion.ai_open_without_message,true);
assert.equal(noQuestion.draft_unsent_deleted_events,1);
assert.equal(noQuestion.chat_history_revisit_events,1);
assert.equal(noQuestion.ehs_share_among_ihs_ehs,null);
await putInterviewNote({participant_id:'S02',session_id:'W5',difficulty:'yes',reasons:['technical_access','asked_teacher_peer'],memo:'test interview'});
assert.equal((await getInterviewNote('S02','W5')).difficulty,'yes');
assert.equal((await interviewDataset('W5')).length,1);
const w5AfterInterview=await getMeasurements('W5');
assert.equal(w5AfterInterview.find(x=>x.participant_id==='S02').interview_recorded,true);
assert.equal(w5AfterInterview.find(x=>x.participant_id==='S02').user_messages,0);
await Promise.all(Array.from({length:20},(_,i)=>researchService.appendEvent('S02','W5','simultaneous_test_event',{i})));
const afterBurst=await researchService.getEvents('S02','W5');
assert.equal(afterBurst.filter(x=>x.type==='simultaneous_test_event').length,20,'simultaneous events must not overwrite each other');
assert.equal((await codingDataset('W1')).find(x=>x.participant_id==='S01').help_type_human,'IHS');
// Old-style events are read together with new timestamp/uuid events.
await storageService.putObject('participants/S01/sessions/W1/events/00001.json',JSON.stringify({participant_id:'S01',session_id:'W1',event_index:1,type:'legacy_event',at:'2026-09-30T08:00:00.000Z',data:{}}));
const both=await researchService.getEvents('S01','W1');
assert.ok(both.some(x=>x.type==='legacy_event'));
const firstTimestamp=both[0].event_index;
assert.ok((await researchService.getEventsAfter('S01','W1',firstTimestamp)).length>=1);
let threw=false;
try{await researchService.replaceFormalCohort([]);}catch(e){threw=e.status===403;}
assert.ok(threw,'destructive formal replacement blocked');
console.log('MEASUREMENT OK v11.47: cross-session originals preserved; manual coding and audit; no-use reason not auto-labeled; event backwards compatibility; reset safety.');
