import assert from 'node:assert/strict';
import {parseAgentRouting,ROUTE_PROTOCOL_VERSION_V2} from '../src/utils/agentRouting.js';
import {scaffoldV2Enabled} from '../src/utils/scaffoldV2Mode.js';
import {SCHEMA_VERSION,AI_VARIANT_RUNTIME_RULES_V2,aiVariantFor,getSessionConfig} from '../src/config/researchConfig.js';
assert.equal(SCHEMA_VERSION,25,'never change the storage schema');
assert.equal(scaffoldV2Enabled({mode:'off',participantId:'S00',variant:'supported'}),false);
assert.equal(scaffoldV2Enabled({mode:'test',participantId:'S00',variant:'supported'}),true);
assert.equal(scaffoldV2Enabled({mode:'test',participantId:'S01',variant:'supported'}),false);
assert.equal(scaffoldV2Enabled({mode:'on',participantId:'S01',variant:'free'}),false);
assert.equal(aiVariantFor({session:getSessionConfig('W4'),condition:'A'}),'supported','historical mapping preserved');
assert.equal(aiVariantFor({session:getSessionConfig('W6'),condition:'B'}),'supported','new mapping preserved');
assert.ok(AI_VARIANT_RUNTIME_RULES_V2.some(x=>x.includes('HELP_EVALUATION')));
const examples=[
 ['IHS','NONE',false,''],['OTHER','NEED_CLARIFICATION',true,'request_clarification'],
 ['EHS','EXECUTIVE_RESTRUCTURE',true,'executive_help_restructure'],
 ['IHS','HELP_EVALUATION',true,'help_evaluation_prompt']
];
for (const [route,scaffold,trigger,type] of examples) {
 const answer=`解释与支持内容\n[[HS_ROUTE:${route}|SCAFFOLD:${scaffold}]]`;
 const r=parseAgentRouting(answer,'supported',{allowV2:true});
 assert.equal(r.visibleText,'解释与支持内容');
 assert.equal(r.agentRoute,route);
 assert.equal(r.scaffoldTriggered,trigger);
 assert.equal(r.scaffoldType,type);
 assert.equal(r.routeProtocolVersion,ROUTE_PROTOCOL_VERSION_V2);
 assert.equal(r.routeParseStatus,'ok');
}
assert.equal(parseAgentRouting('内容\n[[HS_ROUTE:OTHER|SCAFFOLD:NONE]]','supported',{allowV2:true}).routeProtocolVersion,'help-seeking-responsive-v2');
assert.equal(parseAgentRouting('内容\n[[HS_ROUTE:IHS|SCAFFOLD:HELP_EVALUATION]]','supported').routeParseStatus,'missing_or_invalid_marker');
assert.equal(parseAgentRouting('内容\n[[HS_ROUTE:EHS|SCAFFOLD:EXECUTIVE_RESTRUCTURE]]','supported',{allowV2:true}).routeProtocolVersion,'help-seeking-responsive-v2');
assert.equal(parseAgentRouting('内容\n[[HS_ROUTE:EHS|SCAFFOLD:EXECUTIVE_RESTRUCTURE]]','supported').routeProtocolVersion,'ihs-ehs-other-v1');
assert.equal(parseAgentRouting('普通回答','free',{allowV2:true}).visibleText,'普通回答');
assert.equal(parseAgentRouting('内容\n[[HS_ROUTE:OTHER|SCAFFOLD:HELP_EVALUATION]]','supported',{allowV2:true}).routeParseStatus,'marker_inconsistent');
console.log('V2 SAFE OPT-IN ROUTE TEST OK: 4 routes, no forced deployment, backward compatible historical schema.');
