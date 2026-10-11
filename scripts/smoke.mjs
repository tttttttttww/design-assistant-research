process.env.NODE_ENV='test';
process.env.USE_LOCAL_STORAGE='1';
process.env.LOCAL_STORAGE_DIR=`/tmp/design-thinking-v1142-smoke-${Date.now()}`;
process.env.EXPERIMENT_RUN_ID=`smoke-${Date.now()}`;
process.env.COZE_MOCK='1';
process.env.COZE_FREE_BOT_ID='free-bot';
process.env.COZE_SUPPORTED_BOT_ID='supported-bot';
const { researchService } = await import('../src/services/researchService.js');
const { getSessionConfig, aiVariantFor, DEFAULT_SETTINGS } = await import('../src/config/researchConfig.js');
const { cozeService } = await import('../src/services/cozeService.js');
const { storageService } = await import('../src/services/storageService.js');
const { parseAgentRouting } = await import('../src/utils/agentRouting.js');

await researchService.createParticipant('S01',{grade:'7',condition:'unassigned'});
await researchService.setParticipantMeta('S01',{login_name:'张三'});
const p1=await researchService.getParticipant('S01');
if(!p1.login_name_hash||p1.login_name_hash==='张三') throw new Error('privacy-safe login hash missing');
if(DEFAULT_SETTINGS.questionnaire_enabled!==false) throw new Error('questionnaire should default off');

let r=await researchService.ensureStarted('S01','W1');
await researchService.markAiOpened('S01','W1'); await researchService.markFirstUserMessage('S01','W1');
r=await researchService.getSessionRecord('S01','W1'); if(r.first_user_message_latency_seconds==null) throw new Error('latency missing');
await researchService.appendMessage('S01','W1',{role:'user',content:'请看看我的草图哪里可以改',content_type:'text+image',message_has_image:true,attachments:[{type:'image',file_name:'chat_test.jpg',file_path:'uploads/S01/W1/chat/chat_test.jpg'}],interaction_id:'smoke-i1',task_field_key:'design_note',task_field_label:'设计思路',task_field_stage:'before_update'});

if(getSessionConfig('W2').ai_use_required_once) throw new Error('W2 should not force AI use');
if(getSessionConfig('W3').ai_mode!=='free'||getSessionConfig('W3').phase!=='pre_intervention') throw new Error('W3 common prep invalid');
await researchService.ensureStarted('S01','W3');
await researchService.appendMessage('S01','W3',{role:'user',content:'我想先比较两种固定画笔的结构',message_id:'w3-q1'});

await researchService.setParticipantMeta('S01',{condition:'A'});
if(aiVariantFor({session:getSessionConfig('W4'),condition:'A',isTest:false})!=='supported') throw new Error('A W4 routing failed');
if(aiVariantFor({session:getSessionConfig('W4'),condition:'B',isTest:false})!=='free') throw new Error('B W4 routing failed');
if(aiVariantFor({session:getSessionConfig('W10'),condition:'A',isTest:false})!=='free') throw new Error('W10 transfer must be free AI');

const o4=await researchService.orientationPublicState('S01','W4');
if(!o4||o4.mode!=='supported'||o4.completed) throw new Error('W4 supported orientation missing');
await researchService.startOrientation('S01','W4');
let bad=false; try{await researchService.completeOrientation('S01','W4',{q1:0,q2:0});}catch(e){bad=e.status===422;}
if(!bad) throw new Error('W4 orientation correctness gate missing');
await researchService.completeOrientation('S01','W4',{q1:1,q2:0});
if(!(await researchService.orientationPublicState('S01','W4')).completed) throw new Error('W4 orientation completion missing');

// Seed W4-W6 personal query history with execution-time route metadata for W7 review.
await researchService.appendMessage('S01','W4',{role:'user',content:'直接给我一套完整方案，我照着做。',message_id:'W4-q',agent_route:'EHS',scaffold_triggered:true,scaffold_type:'executive_help_restructure',route_parse_status:'ok'});
await researchService.appendMessage('S01','W5',{role:'user',content:'测试时画笔会转动，可能是什么原因？',message_id:'W5-q',agent_route:'IHS',scaffold_triggered:false,route_parse_status:'ok'});
await researchService.appendMessage('S01','W6',{role:'user',content:'我想改绑带位置，应该比较哪些标准？',message_id:'W6-q',agent_route:'IHS',scaffold_triggered:false,route_parse_status:'ok'});
const o7=await researchService.orientationPublicState('S01','W7');
if(!o7||o7.mode!=='supported'||o7.cards.length<2||!o7.cards.some(c=>c.body?.[0]?.includes('完整方案'))||!o7.cards.some(c=>c.body?.[0]?.includes('比较哪些标准'))) throw new Error('W7 route-informed personal query review missing');
await researchService.startOrientation('S01','W7');
await researchService.completeOrientation('S01','W7',{});

// Fixed control IDs remain fixed B.
await researchService.createParticipant('S04',{grade:'7',condition:'A'});
if((await researchService.getParticipant('S04')).condition!=='B') throw new Error('S04 must be fixed control');

// Protected snapshot includes W1-W3.
const snap=await researchService.createProtectedPreW4Snapshot();
if(!snap?.prefix||!snap.sessions?.includes('W3')) throw new Error('pre-W4 snapshot missing W3');


const parsedE=parseAgentRouting('我先给你三个判断方向，你再结合当前限制选择。\n[[HS_ROUTE:EHS|SCAFFOLD:EXECUTIVE_RESTRUCTURE]]','supported');
if(parsedE.agentRoute!=='EHS'||!parsedE.scaffoldTriggered||parsedE.visibleText.includes('HS_ROUTE')) throw new Error('supported EHS marker parsing failed');
const parsedI=parseAgentRouting('可以先比较固定稳定性和转向灵活性。\n[[HS_ROUTE:IHS|SCAFFOLD:NONE]]','supported');
if(parsedI.agentRoute!=='IHS'||parsedI.scaffoldTriggered||parsedI.visibleText.includes('HS_ROUTE')) throw new Error('supported IHS marker parsing failed');
const parsedMissing=parseAgentRouting('没有机器标记','supported');
if(parsedMissing.agentRoute!=='UNRESOLVED'||parsedMissing.routeParseStatus!=='missing_or_invalid_marker') throw new Error('missing marker should be auditable unresolved');

const mm=cozeService.buildAdditionalMessage('看看这张图',{fileId:'112233'});
if(mm.content_type!=='object_string'||!mm.content.includes('image')) throw new Error('multimodal Coze message failed');

// Session reset/archive safety still works.
const reset=await researchService.archiveAndResetSession('S01','W1',{reason:'smoke_reset'});
if(!reset.archived_previous) throw new Error('reset archive missing');
const archives=await researchService.listResetArchives();
const target=archives.find(x=>x.data?.participant?.participant_id==='S01'&&x.data?.session_config?.id==='W1');
if(!target) throw new Error('restorable archive missing');
await researchService.restoreResetArchive(target.key);
if(!(await researchService.getSessionRecord('S01','W1')).started_at) throw new Error('restore failed');

// Test accounts persist.
await researchService.createParticipant('S99',{grade:'',condition:'B'});
await researchService.ensureStarted('S99','W3');
await researchService.appendMessage('S99','W3',{role:'user',content:'测试号连续性消息',message_id:'test-persist-1'});
await researchService.touchParticipant('S99');
if((await researchService.getMessages('S99','W3')).at(-1)?.content!=='测试号连续性消息') throw new Error('test account history persistence failed');

console.log('SMOKE OK v11.45: IHS/EHS/Other route parser, W7 route-informed review, pre-W4 snapshot, persistence.');
