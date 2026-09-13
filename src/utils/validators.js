export function normalizeParticipantId(value) {
  return String(value || '').trim().toUpperCase();
}

export function validateParticipantId(value) {
  const id = normalizeParticipantId(value);
  return /^S(?:0[0-9]|[12][0-9]|30)$/.test(id);
}

export function isTestParticipant(value) {
  return normalizeParticipantId(value) === 'S00';
}

export function allowedParticipantIds() {
  return (process.env.ALLOWED_PARTICIPANTS || '')
    .split(',')
    .map(normalizeParticipantId)
    .filter(Boolean);
}

export function isAllowedParticipant(value) {
  const id = normalizeParticipantId(value);
  if (!validateParticipantId(id)) return false;
  if (id === 'S00') return true;
  if (!/^S(?:0[1-9]|[12][0-9]|30)$/.test(id)) return false;
  if (process.env.STRICT_PARTICIPANT_ALLOWLIST !== '1') return true;
  const allowed = allowedParticipantIds();
  return allowed.length === 0 || allowed.includes(id);
}

export function validateMessage(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 5000;
}
