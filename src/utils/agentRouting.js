export const ROUTE_PROTOCOL_VERSION = 'ihs-ehs-other-v1';
const ANY_MARKER_RE = /\[\[HS_ROUTE:[^\]\r\n]*\]\]/gi;
const VALID_MARKER_RE = /\[\[HS_ROUTE:(IHS|EHS|OTHER)\|SCAFFOLD:(NONE|EXECUTIVE_RESTRUCTURE)\]\]/i;

export function parseAgentRouting(rawText = '', variant = 'free') {
  const raw = String(rawText ?? '');
  if (variant !== 'supported') {
    return {
      visibleText: raw.trim(),
      agentRoute: '',
      scaffoldTriggered: false,
      scaffoldType: '',
      routeParseStatus: 'not_applicable',
      routeProtocolVersion: ROUTE_PROTOCOL_VERSION,
    };
  }
  const match = raw.match(VALID_MARKER_RE);
  const visibleText = raw.replace(ANY_MARKER_RE, '').split(/\r?\n/).filter(line => !/HS_ROUTE:/i.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!match) {
    return {
      visibleText,
      agentRoute: 'UNRESOLVED',
      scaffoldTriggered: null,
      scaffoldType: '',
      routeParseStatus: 'missing_or_invalid_marker',
      routeProtocolVersion: ROUTE_PROTOCOL_VERSION,
    };
  }
  const agentRoute = match[1].toUpperCase();
  const markerScaffold = match[2].toUpperCase();
  const expectedScaffold = agentRoute === 'EHS' ? 'EXECUTIVE_RESTRUCTURE' : 'NONE';
  const consistent = markerScaffold === expectedScaffold;
  return {
    visibleText,
    agentRoute,
    scaffoldTriggered: agentRoute === 'EHS',
    scaffoldType: agentRoute === 'EHS' ? 'executive_help_restructure' : '',
    routeParseStatus: consistent ? 'ok' : 'marker_inconsistent',
    routeProtocolVersion: ROUTE_PROTOCOL_VERSION,
  };
}
