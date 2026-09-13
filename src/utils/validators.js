import { createHash } from 'node:crypto';

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

// 姓名仅用于“编号 + 姓名”登录核对。统一全/半角、大小写和空格，
// 再做单向 SHA-256；系统不需要保存学生真实姓名明文。
export function normalizeStudentName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, '')
    .toLocaleLowerCase('zh-CN');
}

export function hashStudentName(value, participantId = '') {
  const normalized = normalizeStudentName(value);
  if (!normalized) return '';
  const id = normalizeParticipantId(participantId);
  return createHash('sha256').update(`${id}|${normalized}`, 'utf8').digest('hex');
}

export function validateMessage(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 5000;
}
