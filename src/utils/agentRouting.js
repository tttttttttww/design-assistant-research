// IMPORTANT: backwards-compatible log parsing. Historical records are never rewritten.
export const ROUTE_PROTOCOL_VERSION = 'ihs-ehs-other-v1';
export const ROUTE_PROTOCOL_VERSION_V2 = 'help-seeking-responsive-v2';
const ANY_MARKER_RE = /\[\[HS_ROUTE:[^\]\r\n]*\]\]/gi;
const V1_MARKER_RE = /\[\[HS_ROUTE:(IHS|EHS|OTHER)\|SCAFFOLD:(NONE|EXECUTIVE_RESTRUCTURE)\]\]/i;
const V2_MARKER_RE = /\[\[HS_ROUTE:(IHS|EHS|OTHER)\|SCAFFOLD:(NONE|NEED_CLARIFICATION|EXECUTIVE_RESTRUCTURE|HELP_EVALUATION)\]\]/i;
const V2_SCAFFOLDS = Object.freeze({
  NONE:'',
  NEED_CLARIFICATION:'request_clarification',
  EXECUTIVE_RESTRUCTURE:'executive_help_restructure',
  HELP_EVALUATION:'help_evaluation_prompt',
});

export function parseAgentRouting(rawText = '', variant = 'free', { allowV2 = false } = {}) {
  const raw = String(rawText ?? '');
  if (variant !== 'supported') {
    return { visibleText:raw.trim(), agentRoute:'', scaffoldTriggered:false, scaffoldType:'',
      routeParseStatus:'not_applicable', routeProtocolVersion:ROUTE_PROTOCOL_VERSION };
  }
  // Strip internal markers from student-visible replies, including malformed ones.
  const visibleText = raw.replace(ANY_MARKER_RE, '').split(/\r?\n/).filter(line => !/HS_ROUTE:/i.test(line))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const v2 = allowV2 && raw.match(V2_MARKER_RE);
  if (v2) {
    const agentRoute=v2[1].toUpperCase(), scaffold=v2[2].toUpperCase();
    const consistent=(scaffold==='EXECUTIVE_RESTRUCTURE' ? agentRoute==='EHS' :
      scaffold==='HELP_EVALUATION' ? agentRoute==='IHS' :
      scaffold==='NEED_CLARIFICATION' ? agentRoute==='OTHER' : agentRoute!=='EHS');
    return {visibleText,agentRoute,scaffoldTriggered:scaffold!=='NONE',scaffoldType:V2_SCAFFOLDS[scaffold],
      routeParseStatus:consistent?'ok':'marker_inconsistent',routeProtocolVersion:ROUTE_PROTOCOL_VERSION_V2};
  }
  const match=raw.match(V1_MARKER_RE);
  if (!match) return { visibleText, agentRoute:'UNRESOLVED',scaffoldTriggered:null,scaffoldType:'',
    routeParseStatus:'missing_or_invalid_marker',routeProtocolVersion:allowV2?ROUTE_PROTOCOL_VERSION_V2:ROUTE_PROTOCOL_VERSION };
  const agentRoute=match[1].toUpperCase(), markerScaffold=match[2].toUpperCase();
  const expected=agentRoute==='EHS'?'EXECUTIVE_RESTRUCTURE':'NONE';
  return {visibleText,agentRoute,scaffoldTriggered:agentRoute==='EHS',
    scaffoldType:agentRoute==='EHS'?'executive_help_restructure':'',
    routeParseStatus:markerScaffold===expected?'ok':'marker_inconsistent',
    // Mark legacy markers honestly even after an optional V2 rollout.
    routeProtocolVersion:ROUTE_PROTOCOL_VERSION};
}
