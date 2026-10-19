// Research measurement layer v11.47: read-only objective indicators, separate human coding.
// Old session, messages, revisions and event objects are NEVER modified here.
import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
import { researchService } from './researchService.js';
import { SESSIONS } from '../config/researchConfig.js';

const FORMAL_IDS = Array.from({length:30},(_,i)=>`S${String(i+1).padStart(2,'0')}`);
const INTERVIEW_REASONS=new Set(['no_difficulty','solved_independently','asked_teacher_peer','technical_access','unsure_how_to_ask','ai_trust_concern','possible_avoidance','other','unknown']);
const CODING_VALUES = new Set(['', 'IHS','EHS','OTHER','NOT_HELP']);
const PROCESS_VALUES = new Set(['D','H','E','P']);
const FINE_PROCESS_TO_STAGE={
 'D_EXPLICIT':'D', // 学生明确说出了自身困难/已有尝试
 'H_INSTRUMENTAL':'H','H_EXECUTIVE':'H','H_CLARIFY':'H','H_EXPLAIN':'H',
 'E_REASONED_AGREE':'E','E_REASONED_QUESTION':'E','E_COMPARE':'E',
 'P_REPORTED_ADOPT':'P','P_REPORTED_ADAPT':'P','P_REPORTED_REJECT':'P'
};
// All fine codes are researcher adaptations of observable dialogue, not Chen's complete multimodal codebook.
// Do not code unobservable eye-tracking categories or assume that scrolling means evaluation.

const pathFor = (id,sid,index) => `research-coding/v1/${id}/${sid}/message-${String(index).padStart(5,'0')}.json`;
const iso = () => new Date().toISOString();
const loadJson = async key => {const value=await storageService.getObject(key); if (!value) return null; try {return JSON.parse(value)}catch {return null}};
const error = (message,status=400) => Object.assign(new Error(message),{status});
const validIds = id => FORMAL_IDS.includes(id);
const validSid = sid => SESSIONS.some(s=>s.id===sid);

// The interviews are supplementary self-report evidence, never inferred from logs.
const interviewPath=(id,sid)=>`research-interviews/v1/${id}/${sid}.json`;
export async function getInterviewNote(id,sid){
 if(!validIds(id)||!validSid(sid))throw error('编号或课次无效');
 return await loadJson(interviewPath(id,sid));
}
export async function putInterviewNote(input){
 const id=String(input?.participant_id||'').toUpperCase(),sid=String(input?.session_id||'').toUpperCase();
 if(!validIds(id)||!validSid(sid))throw error('编号或课次无效');
 const reasons=[...new Set(Array.isArray(input?.reasons)?input.reasons.map(x=>String(x)):[])];
 if(reasons.some(r=>!INTERVIEW_REASONS.has(r)))throw error('访谈原因编码不在候选表内');
 const difficulty=String(input?.difficulty||'unknown');
 if(!['yes','no','unknown'].includes(difficulty))throw error('遇到困难状态无效');
 const memo=String(input?.memo||'').slice(0,1000);
 const previous=await getInterviewNote(id,sid);
 const next={participant_id:id,session_id:sid,difficulty,reasons,memo,source:'teacher_interview_summary',recorded_at:iso(),revision:Number(previous?.revision||0)+1};
 await storageService.putObject(`research-interviews-audit/${id}/${sid}/${Date.now()}_${randomUUID()}.json`,JSON.stringify({previous,next}));
 await storageService.putObject(interviewPath(id,sid),JSON.stringify(next));
 return next;
}

export async function getMessageCoding(id,sid) {
  if (!validIds(id)||!validSid(sid)) throw error('学生或课次无效');
  const keys=await storageService.listObjects(`research-coding/v1/${id}/${sid}/`);
  const rows=await Promise.all(keys.map(x=>loadJson(x.key)));
  return rows.filter(Boolean).sort((a,b)=>a.message_index-b.message_index);
}

export async function putMessageCoding(input) {
  const id=String(input?.participant_id||'').toUpperCase();
  const sid=String(input?.session_id||'').toUpperCase();
  const index=Number(input?.message_index);
  if (!validIds(id)||!validSid(sid)||!Number.isInteger(index)||index<1) throw error('学生、课次或消息序号无效');
  const messages=await researchService.getMessages(id,sid);
  const msg=messages.find(x=>Number(x.message_index)===index && x.role==='user');
  if (!msg) throw error('该消息不存在，或不是学生发送的消息',404);
  const helpType=String(input?.help_type||'').toUpperCase();
  if (!CODING_VALUES.has(helpType)) throw error('行为类型只能是 IHS/EHS/OTHER/NOT_HELP/未编码');
  const processes=[...new Set(Array.isArray(input?.process_codes)?input.process_codes.map(x=>String(x).toUpperCase()):[])];
  if (processes.some(x=>!PROCESS_VALUES.has(x))) throw error('过程编码只能是 D/H/E/P');
  const primary=String(input?.primary_process_code||'').toUpperCase();
  if(primary && !PROCESS_VALUES.has(primary) && primary!=='NONE')throw error('主过程只能 D/H/E/P/NONE/未填');
  if(primary && primary!=='NONE' && !processes.includes(primary))throw error('主过程必须包含在本条已选的过程证据内');
  const fine=String(input?.fine_process_code||'').toUpperCase();
  if(fine && !Object.prototype.hasOwnProperty.call(FINE_PROCESS_TO_STAGE,fine))throw error('细分类别无效');
  if(fine && primary !== FINE_PROCESS_TO_STAGE[fine])throw error('细分类别必须与主阶段一致');
  const memo=String(input?.memo||'').slice(0,800);
  const coder=String(input?.coder||'researcher').trim().slice(0,40) || 'researcher';
  const key=pathFor(id,sid,index);
  const previous=await loadJson(key);
  const next={participant_id:id,session_id:sid,message_index:index,source_message_created_at:msg.created_at||'',help_type:helpType,process_codes:processes,primary_process_code:primary,fine_process_code:fine,memo,coder,coding_scheme:'human-v2-chen-observable-adaptation',updated_at:iso(),created_at:previous?.created_at||iso(),revision:Number(previous?.revision||0)+1};
  // Preserve all revisions in an append-only audit object; never change source messages.
  await storageService.putObject(`research-coding-audit/${id}/${sid}/${String(index).padStart(5,'0')}_${Date.now()}_${randomUUID()}.json`, JSON.stringify({previous,next}));
  await storageService.putObject(key,JSON.stringify(next));
  return next;
}

const revisionAssessmentKey=(id,sid,versionId)=>`research-artifact-assessment/v1/${id}/${sid}/${versionId}.json`;
export async function getArtifactAssessments(id,sid) {
 if(!validIds(id)||!validSid(sid)) throw error('学生或课次无效');
 const keys=await storageService.listObjects(`research-artifact-assessment/v1/${id}/${sid}/`);
 return (await Promise.all(keys.map(k=>loadJson(k.key)))).filter(Boolean);
}
export async function putArtifactAssessment(input) {
 const id=String(input?.participant_id||'').toUpperCase(),sid=String(input?.session_id||'').toUpperCase();
 if(!validIds(id)||!validSid(sid))throw error('学生或课次无效');
 const versionId=String(input?.version_id||'');
 const versions=await researchService.getArtifactVersions(id,sid);
 const version=Object.values(versions).flat().find(v=>v.version_id===versionId);
 if(!version)throw error('此作品版本不存在',404);
 const verification=String(input?.verification||'pending');
 if(!['pending','evidence_supported','reported_only','unclear','not_linked'].includes(verification))throw error('修改归因不在编码选项内');
 const nature=String(input?.change_nature||'unknown');
 if(!['unknown','substantive','minor','correction','no_change'].includes(nature))throw error('修改性质无效');
 const key=revisionAssessmentKey(id,sid,versionId),previous=await loadJson(key);
 const next={participant_id:id,session_id:sid,version_id:versionId,verification,change_nature:nature,
   evidence_note:String(input?.evidence_note||'').slice(0,800),coder:String(input?.coder||'researcher').slice(0,50),
   updated_at:iso(),revision:Number(previous?.revision||0)+1};
 await storageService.putObject(`research-artifact-assessment-audit/${id}/${sid}/${Date.now()}_${randomUUID()}.json`,JSON.stringify({previous,next}));
 await storageService.putObject(key,JSON.stringify(next)); return next;
}
export async function artifactEvidenceDataset(sid='ALL') {
 if(sid!=='ALL'&&!validSid(sid))throw error('课次无效');
 const sessions=sid==='ALL'?SESSIONS:SESSIONS.filter(x=>x.id===sid);const rows=[];
 for(const s of sessions){
   const byStudent=await Promise.all(FORMAL_IDS.map(async id=>{
     const [record,participant,messages,codings]=await Promise.all([researchService.getSessionRecord(id,s.id),researchService.getParticipant(id),researchService.getMessages(id,s.id),getArtifactAssessments(id,s.id)]);
     const versions=await researchService.getArtifactVersions(id,s.id,record);
     const assessment=new Map(codings.map(c=>[c.version_id,c]));
     const answers=new Map(messages.filter(m=>m.role==='assistant').map(m=>[m.message_id,m]));
     return Object.entries(versions).flatMap(([key,values])=>values.map((v,index)=>{
        const c=assessment.get(v.version_id)||{};const sourceReply=answers.get(v.ai_message_id)||{};
        const previous=values[index-1]||{};
        return { participant_id:id,grade:participant.grade||'',condition_at_time:record.condition_at_time||'',session_id:s.id,
          artifact_key:key,version_id:v.version_id,version_no:index+1,version_kind:v.kind||'legacy',
          previous_version_id:previous.version_id||'',based_on_previous_session_version_ref:v.based_on_version_ref||'',file_name:v.file_name||'',file_path:v.file_path||'',uploaded_at:v.uploaded_at||'',
          student_report_change_source:v.change_source||'',student_change_note:v.change_note||'',
          linked_ai_message_id:v.ai_message_id||'',linked_ai_message_at:v.ai_message_at||'',linked_ai_message_text:sourceReply.content||'',
          chronological_ai_reply_before_upload:messages.some(m=>m.role==='assistant'&&m.created_at&&v.uploaded_at&&m.created_at<v.uploaded_at),
          researcher_link_verification:c.verification||'',researcher_change_nature:c.change_nature||'',researcher_evidence_note:c.evidence_note||'',researcher_coder:c.coder||'',researcher_coded_at:c.updated_at||'',
          is_legacy:!!v.is_legacy, source_warning:'student report and time order are not causal proof' };
     }));
   }));rows.push(...byStudent.flat());
 }return rows;
}

const tally=(events,type)=>events.filter(x=>x.type===type).length;
export function deriveSessionMeasurement({participant, session, record, artifactVersions=null, chatMessages=[], events=[], revisions=[], coding=[],interview=null}) {
  const user=chatMessages.filter(x=>x.role==='user');
  const assistants=chatMessages.filter(x=>x.role==='assistant');
  const codes=new Map(coding.map(c=>[Number(c.message_index),c]));
  const values=user.map(x=>codes.get(Number(x.message_index))?.help_type || '');
  const codedCount=values.filter(Boolean).length;
  const count=(t)=>values.filter(v=>v===t).length;
  const ihs=count('IHS'),ehs=count('EHS'),other=count('OTHER'),nonhelp=count('NOT_HELP');
  const assessed=ihs+ehs;
  const processCount=(c)=>user.reduce((n,x)=>n+(codes.get(Number(x.message_index))?.process_codes||[]).includes(c),0);
  const observedHelp=(ihs+ehs+other);
  const attemptCount=tally(events,'ai_draft_started');
  const sent=user.length;
  const codingComplete=sent>0 && codedCount===sent;
  const ehsRoutes=user.filter(x=>x.agent_route==='EHS').length;
  const ehsTriggers=user.filter(x=>x.scaffold_triggered===true).length;
  return {
    participant_id:participant.participant_id,
    grade:participant.grade||'',
    condition_current:participant.condition||'',
    condition_at_time:record.condition_at_time||'',
    session_id:session.id,
    session_title:session.title,
    phase:session.phase||'',
    started_at:record.started_at||'',
    completed_at:record.completed_at||'',
    has_task_record:Boolean(record.started_at),
    ai_open_count:Number(record.ai_open_count||0),
    ai_opened:Number(record.ai_open_count||0)>0,
    user_messages:sent,
    ai_responses:assistants.length,
    actual_sent_to_ai:sent>0,
    ai_open_without_message:Number(record.ai_open_count||0)>0&&sent===0,
    never_opened_ai:Number(record.ai_open_count||0)===0,
    draft_started_events:attemptCount,
    draft_unsent_deleted_events:tally(events,'ai_draft_deleted_unsent'),
    draft_unsent_left_events:tally(events,'ai_draft_left_unsent'),
    chat_history_revisit_events:tally(events,'chat_history_revisit'),
    ai_open_no_send_events:tally(events,'ai_open_no_send'),
    task_field_interaction_events:tally(events,'task_field_interaction'),
    task_text_revisions:revisions.length,
    uploaded_artifact_count:Object.keys(record.artifacts||{}).length,
    uploaded_artifact_version_count:artifactVersions?Object.values(artifactVersions).reduce((n,rows)=>n+rows.length,0):(Object.keys(record.artifact_versions||{}).length?Object.values(record.artifact_versions||{}).reduce((n,rows)=>n+(rows||[]).length,0):Object.values(record.artifacts||{}).filter(Boolean).length),
    unindexed_historical_images:artifactVersions?Object.values(artifactVersions).flat().filter(x=>x.original_order_unknown).length:0,
    artifact_self_report_ai_count:Object.values(artifactVersions||record.artifact_versions||{}).flat().filter(v=>['ai','mixed'].includes(v.change_source)).length,
    orientation_completed_events:tally(events,'orientation_completed'),
    interview_recorded:Boolean(interview?.recorded_at),
    interview_difficulty:interview?.difficulty||'',
    interview_reasons:(interview?.reasons||[]).join('|'),
    route_ehs_events:ehsRoutes,
    scaffold_triggered_system_events:ehsTriggers,
    messages_human_coded:codedCount,
    messages_pending_human_coding:Math.max(0,sent-codedCount),
    messages_with_primary_process: user.filter(x=>{const v=codes.get(Number(x.message_index))?.primary_process_code;return ['D','H','E','P','NONE'].includes(v)}).length,
    human_coding_complete:codingComplete,
    ihs_human:ihs,ehs_human:ehs,other_help_human:other,not_help_human:nonhelp,
    valid_ihs_ehs_denom:assessed,
    ihs_share_among_ihs_ehs:codingComplete&&assessed?Number((ihs/assessed).toFixed(4)):null,
    ehs_share_among_ihs_ehs:codingComplete&&assessed?Number((ehs/assessed).toFixed(4)):null,
    total_human_help:observedHelp,
    process_d_human:processCount('D'),
    process_h_human:processCount('H'),
    process_e_human:processCount('E'),
    process_p_human:processCount('P'),
    source_note:'Logs are observed actions only; AI routes are not human coding; revisit/edits do not prove reflection or adoption. Null ratios mean human coding is incomplete or IHS+EHS equals zero.'
  };
}

export async function getMeasurements(sid='ALL') {
  if (sid!=='ALL'&&!validSid(sid)) throw error('课次无效');
  const sessionList=sid==='ALL'?SESSIONS:SESSIONS.filter(x=>x.id===sid);
  const rows=[];
  const participants=await Promise.all(FORMAL_IDS.map(x=>researchService.getParticipant(x)));
  for (const session of sessionList) {
    const partRows=await Promise.all(participants.map(async participant=>{
      const id=participant.participant_id;
      const [record,chatMessages,events,revisions,coding,interview]=await Promise.all([
        researchService.getSessionRecord(id,session.id), researchService.getMessages(id,session.id),
        researchService.getEvents(id,session.id),researchService.getRevisions(id,session.id),getMessageCoding(id,session.id),getInterviewNote(id,session.id)
      ]);
      const artifactVersions=await researchService.getArtifactVersions(id,session.id,record);
      return deriveSessionMeasurement({participant,session,record,artifactVersions,chatMessages,events,revisions,coding,interview});
    }));
    rows.push(...partRows);
  }
  return rows;
}

export async function codingDataset(sid='ALL') {
  if(sid!=='ALL'&&!validSid(sid)) throw error('课次无效');
  const out=[];
  const target= sid==='ALL'?SESSIONS:SESSIONS.filter(x=>x.id===sid);
  for(const session of target) {
    const per=await Promise.all(FORMAL_IDS.map(async id=>{
      const [messages,coding,participant,record]=await Promise.all([researchService.getMessages(id,session.id),getMessageCoding(id,session.id),researchService.getParticipant(id),researchService.getSessionRecord(id,session.id)]);
      const codes=new Map(coding.map(c=>[Number(c.message_index),c]));
      return messages.filter(x=>x.role==='user').map(m=>{
        const c=codes.get(Number(m.message_index));
        return {participant_id:id,grade:participant.grade,condition_current:participant.condition,condition_at_time:record.condition_at_time||'',session_id:session.id, message_index:m.message_index, message_at:m.created_at, message_text:m.content||'', interaction_id:m.interaction_id||'',protocol_ai_required:Boolean(session.ai_use_required_once),protocol_first_user_message:Boolean(session.ai_use_required_once&&m.message_index===messages.find(x=>x.role==='user')?.message_index), agent_route_system:m.agent_route||'', scaffold_triggered_system:m.scaffold_triggered??'', help_type_human:c?.help_type||'',process_codes_human:(c?.process_codes||[]).join('|'),primary_process_code_human:c?.primary_process_code||'',fine_process_code_human:c?.fine_process_code||'',coder:c?.coder||'',memo:c?.memo||'',coded_at:c?.updated_at||'',coding_scheme:c?.coding_scheme||''};
      });
    }));out.push(...per.flat());
  }
  return out;
}
export async function interviewDataset(sid='ALL'){
 if(sid!=='ALL'&&!validSid(sid))throw error('课次无效');
 const target=sid==='ALL'?SESSIONS:SESSIONS.filter(x=>x.id===sid);
 const rows=[];
 for(const session of target){
   const entries=await Promise.all(FORMAL_IDS.map(async id=>{
     const interview=await getInterviewNote(id,session.id);
     return interview?{...interview,reasons:(interview.reasons||[]).join('|')}:null;
   }));rows.push(...entries.filter(Boolean));
 }
 return rows;
}
// LSA-ready human sequence; NEVER turn click/scroll into a cognitive-process event.
// One primary stage per student message avoids manufacturing an order inside one message.
export async function processSequenceDataset(sid='ALL') {
 if(sid!=='ALL'&&!validSid(sid))throw error('课次无效');
 const sessions=sid==='ALL'?SESSIONS:SESSIONS.filter(s=>s.id===sid),rows=[];
 for(const session of sessions){
  const students=await Promise.all(FORMAL_IDS.map(async id=>{
   const [messages,codes,assessments,record]=await Promise.all([researchService.getMessages(id,session.id),getMessageCoding(id,session.id),getArtifactAssessments(id,session.id),researchService.getSessionRecord(id,session.id)]);
   const coded=new Map(codes.map(c=>[c.message_index,c]));
   const firstUserIndex=messages.find(m=>m.role==='user')?.message_index;
   const replyTime=new Map(messages.filter(m=>m.role==='assistant').map(m=>[m.message_id,m.created_at]));
   const events=[];
   for(const msg of messages){
    if(msg.role!=='user')continue;
    const c=coded.get(msg.message_index);
    if(!c?.primary_process_code || c.primary_process_code==='NONE')continue;
    events.push({participant_id:id,session_id:session.id,at:msg.created_at||'',sequence_event_code:c.primary_process_code,source:'human_coded_user_message',source_id:String(msg.message_index),fine_process_code_human:c.fine_process_code||'',help_type_human:c.help_type||'',fine_process_code_human:c.fine_process_code||'',protocol_first_user_message:Boolean(session.ai_use_required_once && msg.message_index===firstUserIndex),
      evidence_level:'human_coding',message_text:msg.content||'',link_note:c.memo||''});
   }
   const versions=await researchService.getArtifactVersions(id,session.id,record);
   const amap=new Map(assessments.map(a=>[a.version_id,a]));
   for(const versionsForArtifact of Object.values(versions))for(const v of versionsForArtifact){
     const a=amap.get(v.version_id);
     if(a?.verification==='evidence_supported' && a.change_nature==='substantive' && v.ai_message_id && replyTime.get(v.ai_message_id) && replyTime.get(v.ai_message_id)<v.uploaded_at){
       events.push({participant_id:id,session_id:session.id,at:v.uploaded_at,sequence_event_code:'P_VERIFIED',source:'human_verified_artifact_revision',source_id:v.version_id,fine_process_code_human:'P_VERIFIED_IMAGE',help_type_human:'',evidence_level:'triangulated',message_text:'',link_note:a.evidence_note||''});
     }
   }
   return events.sort((a,b)=>a.at.localeCompare(b.at)||a.source_id.localeCompare(b.source_id)).map((e,i)=>({...e,lsa_stage:e.sequence_event_code==='P_VERIFIED'?'':e.sequence_event_code,sensitivity_lsa_stage:e.sequence_event_code==='P_VERIFIED'?'P':e.sequence_event_code,primary_lsa_included:e.sequence_event_code!=='P_VERIFIED',protocol_first_user_message:Boolean(e.protocol_first_user_message),within_session_event_order:i+1}));
  }));rows.push(...students.flat());
 }return rows;
}

export const measurementMeta={eventMeaning:{ai_opened:'opening the AI',ai_draft_started:'typing began',ai_draft_deleted_unsent:'unsent input removed (body is not collected)',ai_draft_left_unsent:'left with unsent input (body is not collected)',chat_history_revisit:'scrolled to older messages, not proof of reflective evaluation',task_field_interaction:'text field interaction, not proof of idea change',fields_saved:'saved data',help_seeking_route_decision:'system classification used for support, not human research label'},humanCodes:['IHS','EHS','OTHER','NOT_HELP'],processCodes:['D','H','E','P'],denominator:'Only human-coded IHS+EHS, and only after every student message has a human code; otherwise null. OTHER and NOT_HELP excluded.',status:'draft coding scheme; two-coder reliability requires separate reconciliation outside the app'};
