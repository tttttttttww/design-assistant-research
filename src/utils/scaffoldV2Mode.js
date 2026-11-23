// Explicit opt-in only. Production remains unchanged unless owner deliberately sets on.
// In `test` mode, the V2 rules are available only to S00 (support-agent test ID).
export function scaffoldV2Enabled({mode=process.env.HELP_SEEKING_V2_MODE||'off',participantId='',variant=''}={}) {
  if(variant!=='supported')return false;
  if(mode==='on')return true;
  if(mode==='test')return String(participantId).trim().toUpperCase()==='S00';
  return false;
}
