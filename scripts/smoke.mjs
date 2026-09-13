process.env.NODE_ENV='test'; process.env.USE_LOCAL_STORAGE='1'; process.env.LOCAL_STORAGE_DIR='/tmp/design-thinking-v11-smoke'; process.env.EXPERIMENT_RUN_ID=`smoke-${Date.now()}`; process.env.COZE_MOCK='1'; process.env.COZE_FREE_BOT_ID='free-bot'; process.env.COZE_SUPPORTED_BOT_ID='supported-bot';
const { researchService } = await import('../src/services/researchService.js');
const { getSessionConfig } = await import('../src/config/researchConfig.js');
await researchService.createParticipant('S01',{grade:'7',condition:'unassigned'});
let r=await researchService.ensureStarted('S01','W1'); if(!r.started_at) throw new Error('W1 not started');
await researchService.markAiOpened('S01','W1'); await researchService.markFirstUserMessage('S01','W1');
r=await researchService.getSessionRecord('S01','W1'); if(r.first_user_message_latency_seconds==null) throw new Error('latency missing');
await researchService.setParticipantMeta('S01',{condition:'A'});
await researchService.ensureStarted('S01','W4'); const stateA=await researchService.currentState('S01'); // active still W1, routing checked below by session record call only
const { aiVariantFor } = await import('../src/config/researchConfig.js');
if(aiVariantFor({session:getSessionConfig('W4'),condition:'A',isTest:false})!=='supported') throw new Error('A routing failed');
if(aiVariantFor({session:getSessionConfig('W4'),condition:'B',isTest:false})!=='free') throw new Error('B routing failed');
if(aiVariantFor({session:getSessionConfig('W10'),condition:'A',isTest:false})!=='free') throw new Error('transfer routing failed');
console.log('SMOKE OK: timing + routing rules passed.');
