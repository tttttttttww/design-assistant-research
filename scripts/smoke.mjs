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
if(aiVariantFor({session:getSessionConfig('W10'),condition:'A',isTest:false})!=='supported') throw new Error('W10 must continue supported AI');
if(aiVariantFor({session:getSessionConfig('W11'),condition:'A',isTest:false})!=='free') throw new Error('W11 transfer must use ordinary AI');

const o4=await researchService.orientationPublicState('S01','W4');
if(!o4||o4.mode!=='supported'||o4.completed) throw new Error('W4 supported orientation missing');
await researchService.startOrientation('S01','W4');
let bad=false; try{await researchService.completeOrientation('S01','W4',{q1:0,q2:0});}catch(e){bad=e.status===422;}
if(!bad) throw new Error('W4 orientation correctness gate missing');
await researchService.completeOrientation('S01','W4',{q1:1,q2:0});
if(!(await researchService.orientationPublicState('S01','W4')).completed) throw new Error('W4 orientation completion missing');

// W5 design review and W7 personal reflection do not alter earlier history.
await researchService.appendMessage('S01','W4',{role:'user',content:'直接给我一套完整方案，我照着做。',message_id:'W4-q',interaction_id:'W4-real1',agent_route:'EHS',scaffold_triggered:true,scaffold_type:'executive_help_restructure',route_parse_status:'ok'});
await researchService.appendMessage('S01','W4',{role:'assistant',content:'请先确定需要帮助的局部困难。',interaction_id:'W4-real1'});
await researchService.appendMessage('S01','W5',{role:'user',content:'魔术贴固定铅笔时容易转动，怎样处理？',message_id:'W5-q',agent_route:'IHS',scaffold_triggered:false,route_parse_status:'ok'});
if(getSessionConfig('W5').artifacts[0].key==='v1_photo') throw new Error('W5 should not require built prototype photo');
await researchService.appendMessage('S01','W6',{role:'user',content:'你帮我直接做好整套作品',interaction_id:'W6-real1',agent_route:'EHS'});
await researchService.appendMessage('S01','W6',{role:'assistant',content:'先看你遇到的最关键困难',interaction_id:'W6-real1'});
const o7=await researchService.orientationPublicState('S01','W7');
if(!o7?.reflection_activity || o7?.mode!=='supported' || o7.cards.length<1) throw new Error('W7 personal retrospective missing');
await researchService.startOrientation('S01','W7');
await researchService.completeOrientation('S01','W7', {practice_1:1,practice_2:0,personal_ref:'W6:1',reflection_difficulty:'当时我不知道怎样固定铅笔',reflection_reply_review:'我当时收到AI建议但还需要检查材料是否合适',revised_question:'我现在不知道材料应该怎样连接，请帮我比较可选方法',reflection_reason:'用自己的情况描述困难后我还需要检验建议是否适合'});
if(!(await researchService.orientationPublicState('S01','W7')).completed)throw new Error('W7 reflection not saved');
// W10 is the last supported week, while W11/W12 are common-model transfer.
if(!getSessionConfig('W10').questionnaire_after_submit || getSessionConfig('W9').questionnaire_after_submit)throw new Error('posttest should only be after W10');
if(!getSessionConfig('W11').ai_use_required_once || getSessionConfig('W12').ai_use_required_once)throw new Error('W11 AI exchange requirement configuration invalid');

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

// Formal history cannot be reset. Test participant may still be reset with archive.
let resetBlocked=false;
try { await researchService.archiveAndResetSession('S01','W1',{reason:'attempt_blocked'}); }
catch(e){resetBlocked=e.status===403;}
if(!resetBlocked) throw new Error('formal archive reset must be blocked');
if(!(await researchService.getSessionRecord('S01','W1')).started_at) throw new Error('formal W1 lost during blocked reset');
await researchService.createParticipant('S00',{grade:'7',condition:'A'});
await researchService.ensureStarted('S00','W4');
await researchService.appendMessage('S00','W4',{role:'user',content:'测试清理',message_id:'test-w4'});
const reset=await researchService.archiveAndResetSession('S00','W4',{reason:'smoke_reset'});
if(!reset.archived_previous) throw new Error('test reset archive missing');
const archives=await researchService.listResetArchives();
const target=archives.find(x=>x.data?.participant?.participant_id==='S00'&&x.data?.session_config?.id==='W4');
if(!target) throw new Error('test restore archive missing');
await researchService.restoreResetArchive(target.key);
if(!(await researchService.getSessionRecord('S00','W4')).started_at) throw new Error('test restore failed');

// Test accounts persist.
await researchService.createParticipant('S99',{grade:'',condition:'B'});
await researchService.ensureStarted('S99','W3');
await researchService.appendMessage('S99','W3',{role:'user',content:'测试号连续性消息',message_id:'test-persist-1'});
await researchService.touchParticipant('S99');
if((await researchService.getMessages('S99','W3')).at(-1)?.content!=='测试号连续性消息') throw new Error('test account history persistence failed');

console.log('SMOKE OK v11.54: W7 prior-session review with mini practice, W4–W10 supported AI; W11–W12 scaffold-off; historical snapshot retained.');
