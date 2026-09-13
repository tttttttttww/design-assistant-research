import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
import {
  DEFAULT_SETTINGS, CONDITIONS, SCHEMA_VERSION, SESSIONS, getSessionConfig,
  aiVariantFor, hiddenAiContext, PROMPT_VERSION_FREE, PROMPT_VERSION_SUPPORTED,
} from '../config/researchConfig.js';
import { isTestParticipant } from '../utils/validators.js';

const iso = () => new Date().toISOString();
const parse = (raw, fallback = null) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
const pKey = id => `participants/${id}.json`;
const sBase = (id, sid) => `participants/${id}/sessions/${sid}`;
const rKey = (id, sid) => `${sBase(id, sid)}/record.json`;
const cKey = (id, sid) => `${sBase(id, sid)}/chat/session.json`;
const mPrefix = (id, sid) => `${sBase(id, sid)}/chat/messages/`;
const mKey = (id, sid, index) => `${mPrefix(id, sid)}${String(index).padStart(5, '0')}.json`;
const ePrefix = (id, sid) => `${sBase(id, sid)}/events/`;
const eKey = (id, sid, index) => `${ePrefix(id, sid)}${String(index).padStart(5, '0')}.json`;

function blankRecord(id, sid) {
  return {
    participant_id: id,
    session_id: sid,
    schema_version: SCHEMA_VERSION,
    started_at: null,
    first_ai_open_at: null,
    first_ai_open_latency_seconds: null,
    first_user_message_at: null,
    first_user_message_latency_seconds: null,
    ai_open_count: 0,
    ai_used: false,
    text_fields: {},
    artifacts: {},
    saved_at: null,
    submitted_at: null,
    completed_at: null,
    condition_at_time: '',
    ai_variant: '',
  };
}

class ResearchService {
  staticContent() {
    return { sessions: SESSIONS, schema_version: SCHEMA_VERSION };
  }

  async getSettings() {
    const stored = parse(await storageService.getObject('settings.json'), {}) || {};
    const active = getSessionConfig(stored.active_session_id) ? stored.active_session_id : DEFAULT_SETTINGS.active_session_id;
    return { ...DEFAULT_SETTINGS, ...stored, active_session_id: active };
  }

  async saveSettings(input = {}) {
    const current = await this.getSettings();
    const active = getSessionConfig(input.active_session_id) ? input.active_session_id : current.active_session_id;
    const next = {
      ...current,
      active_session_id: active,
      session_open: input.session_open == null ? current.session_open : Boolean(input.session_open),
      questionnaire_enabled: input.questionnaire_enabled == null ? current.questionnaire_enabled : Boolean(input.questionnaire_enabled),
      updated_at: iso(),
    };
    await storageService.putObject('settings.json', JSON.stringify(next));
    return next;
  }

  async activeSession() {
    const settings = await this.getSettings();
    return getSessionConfig(settings.active_session_id);
  }

  async createParticipant(id, input = {}) {
    const old = parse(await storageService.getObject(pKey(id)), {});
    const condition = CONDITIONS.includes(input.condition) ? input.condition : (CONDITIONS.includes(old.condition) ? old.condition : 'unassigned');
    const p = {
      participant_id: id,
      condition,
      grade: input.grade ?? old.grade ?? '',
      is_test: isTestParticipant(id),
      created_at: old.created_at || iso(),
      last_active_at: iso(),
      schema_version: SCHEMA_VERSION,
    };
    await storageService.putObject(pKey(id), JSON.stringify(p));
    return p;
  }

  async getParticipant(id) {
    const raw = await storageService.getObject(pKey(id));
    return raw ? JSON.parse(raw) : this.createParticipant(id);
  }

  async touchParticipant(id) {
    const p = await this.getParticipant(id);
    p.last_active_at = iso();
    await storageService.putObject(pKey(id), JSON.stringify(p));
    return p;
  }

  async setParticipantMeta(id, { condition, grade } = {}) {
    const p = await this.getParticipant(id);
    if (condition != null) {
      if (!CONDITIONS.includes(condition)) throw Object.assign(new Error('condition无效'), { status: 400 });
      p.condition = condition;
    }
    if (grade != null) p.grade = String(grade).trim();
    p.last_active_at = iso();
    await storageService.putObject(pKey(id), JSON.stringify(p));
    return p;
  }

  async getSessionRecord(id, sid) {
    const session = getSessionConfig(sid);
    if (!session) throw Object.assign(new Error('课次不存在'), { status: 404 });
    return parse(await storageService.getObject(rKey(id, sid)), blankRecord(id, sid));
  }

  async saveSessionRecord(id, sid, record) {
    record.participant_id = id;
    record.session_id = sid;
    record.schema_version = SCHEMA_VERSION;
    await storageService.putObject(rKey(id, sid), JSON.stringify(record));
    return record;
  }

  async ensureStarted(id, sid) {
    const p = await this.getParticipant(id);
    const s = getSessionConfig(sid);
    let r = await this.getSessionRecord(id, sid);
    if (!r.started_at) {
      r.started_at = iso();
      r.condition_at_time = p.condition;
      r.ai_variant = aiVariantFor({ session: s, condition: p.condition, isTest: p.is_test });
      await this.saveSessionRecord(id, sid, r);
      await this.appendEvent(id, sid, 'task_started', {});
    }
    return r;
  }

  async saveFields(id, sid, textFields = {}) {
    const r = await this.ensureStarted(id, sid);
    if (r.submitted_at) throw Object.assign(new Error('本节任务已经提交，不能再修改。'), { status: 409 });
    const config = getSessionConfig(sid);
    const allowed = new Set(config.fields.map(f => f.key));
    for (const [k, v] of Object.entries(textFields || {})) if (allowed.has(k)) r.text_fields[k] = String(v ?? '').trim();
    r.saved_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.appendEvent(id, sid, 'fields_saved', { keys: Object.keys(textFields || {}).filter(k => allowed.has(k)) });
    return r;
  }

  async addArtifact(id, sid, artifactKey, meta) {
    const config = getSessionConfig(sid);
    if (!config.artifacts.some(a => a.key === artifactKey)) throw Object.assign(new Error('上传项目无效'), { status: 400 });
    const r = await this.ensureStarted(id, sid);
    if (r.submitted_at) throw Object.assign(new Error('本节任务已经提交，不能再替换图片。'), { status: 409 });
    r.artifacts[artifactKey] = meta;
    r.saved_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.appendEvent(id, sid, 'artifact_uploaded', { artifact_key: artifactKey, file_name: meta.file_name });
    return r;
  }

  async submitSession(id, sid, textFields = {}) {
    const config = getSessionConfig(sid);
    let r = await this.saveFields(id, sid, textFields);
    if (r.submitted_at) return r;
    const missingField = config.fields.find(f => f.required && !String(r.text_fields[f.key] || '').trim());
    if (missingField) throw Object.assign(new Error(`请先完成：${missingField.label}`), { status: 400 });
    const missingArtifact = config.artifacts.find(a => a.required && !r.artifacts[a.key]);
    if (missingArtifact) throw Object.assign(new Error(`请先完成：${missingArtifact.label}`), { status: 400 });
    r.submitted_at = iso();
    r.completed_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.endChat(id, sid, { submitted: true });
    await this.appendEvent(id, sid, 'session_submitted', {});
    return r;
  }

  async getChatSession(id, sid) {
    return parse(await storageService.getObject(cKey(id, sid)), null);
  }

  async ensureChatSession(id, sid) {
    const p = await this.getParticipant(id);
    const config = getSessionConfig(sid);
    const variant = aiVariantFor({ session: config, condition: p.condition, isTest: p.is_test });
    if (variant === 'none') throw Object.assign(new Error('本节课没有AI助手。'), { status: 409 });
    if (variant === 'unassigned') throw Object.assign(new Error('本课已进入分组阶段，但你的组别尚未配置，请联系老师。'), { status: 409 });
    let s = await this.getChatSession(id, sid);
    if (!s) {
      s = {
        session_id: randomUUID(), participant_id: id, course_session_id: sid,
        ai_variant: variant, bot_id: '', model: '', conversation_id: '',
        started_at: null, ended_at: null, locked: false,
        user_turn_count: 0, assistant_turn_count: 0,
        prompt_version: variant === 'supported' ? PROMPT_VERSION_SUPPORTED : PROMPT_VERSION_FREE,
      };
      await storageService.putObject(cKey(id, sid), JSON.stringify(s));
    }
    return s;
  }

  async saveChatSession(id, sid, s) {
    await storageService.putObject(cKey(id, sid), JSON.stringify(s));
    return s;
  }

  async markAiOpened(id, sid) {
    let r = await this.ensureStarted(id, sid);
    const p = await this.getParticipant(id);
    const config = getSessionConfig(sid);
    r.condition_at_time = p.condition;
    r.ai_variant = aiVariantFor({ session: config, condition: p.condition, isTest: p.is_test });
    let s = await this.ensureChatSession(id, sid);
    if (r.submitted_at) throw Object.assign(new Error('本节任务已经提交。'), { status: 409 });
    r.ai_open_count = Number(r.ai_open_count || 0) + 1;
    if (!r.first_ai_open_at) {
      r.first_ai_open_at = iso();
      r.first_ai_open_latency_seconds = Math.max(0, Math.floor((Date.parse(r.first_ai_open_at) - Date.parse(r.started_at)) / 1000));
    }
    if (!s.started_at) s.started_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.saveChatSession(id, sid, s);
    await this.appendEvent(id, sid, 'ai_opened', { ai_open_count: r.ai_open_count });
    return { record: r, session: s };
  }

  async markFirstUserMessage(id, sid) {
    let r = await this.ensureStarted(id, sid);
    if (!r.first_user_message_at) {
      r.first_user_message_at = iso();
      r.first_user_message_latency_seconds = Math.max(0, Math.floor((Date.parse(r.first_user_message_at) - Date.parse(r.started_at)) / 1000));
      r.ai_used = true;
      await this.saveSessionRecord(id, sid, r);
    }
    return r;
  }

  async appendMessage(id, sid, data) {
    const existing = await this.getMessages(id, sid);
    const message_index = existing.length + 1;
    const row = {
      participant_id: id, course_session_id: sid, message_index,
      message_id: data.message_id || randomUUID(), role: data.role, content: data.content,
      created_at: data.created_at || iso(), conversation_id: data.conversation_id || '', chat_id: data.chat_id || '',
      bot_id: data.bot_id || '', model: data.model || '', ai_variant: data.ai_variant || '', prompt_version: data.prompt_version || '',
      content_type: data.content_type || 'text', message_has_image: Boolean(data.message_has_image), attachments: Array.isArray(data.attachments) ? data.attachments : [],
    };
    await storageService.putObject(mKey(id, sid, message_index), JSON.stringify(row));
    return row;
  }

  async getMessages(id, sid) {
    const rows = await storageService.listObjects(mPrefix(id, sid));
    const out = [];
    for (const row of rows.sort((a, b) => a.key.localeCompare(b.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push(JSON.parse(raw));
    }
    return out;
  }

  async endChat(id, sid, { submitted = false } = {}) {
    const s = await this.getChatSession(id, sid);
    if (!s) return null;
    if (submitted && !s.ended_at) s.ended_at = iso();
    if (submitted) s.locked = true;
    await this.saveChatSession(id, sid, s);
    return s;
  }

  async appendEvent(id, sid, type, data = {}) {
    const rows = await storageService.listObjects(ePrefix(id, sid));
    const index = rows.length + 1;
    const row = { participant_id: id, session_id: sid, event_index: index, type, at: iso(), data };
    await storageService.putObject(eKey(id, sid, index), JSON.stringify(row));
    return row;
  }

  async getEvents(id, sid) {
    const rows = await storageService.listObjects(ePrefix(id, sid));
    const out = [];
    for (const row of rows.sort((a, b) => a.key.localeCompare(b.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push(JSON.parse(raw));
    }
    return out;
  }

  async hiddenContextForChat(sid) {
    return hiddenAiContext(getSessionConfig(sid));
  }

  async currentState(id) {
    const settings = await this.getSettings();
    const session = getSessionConfig(settings.active_session_id);
    const participant = await this.getParticipant(id);
    const record = await this.ensureStarted(id, session.id);
    const chat = session.ai_mode === 'none' ? null : await this.getChatSession(id, session.id);
    const messages = session.ai_mode === 'none' ? [] : await this.getMessages(id, session.id);
    let carry = null;
    if (session.carry_from) carry = await this.getSessionRecord(id, session.carry_from);
    return {
      settings,
      participant,
      session,
      record,
      ai_variant: aiVariantFor({ session, condition: participant.condition, isTest: participant.is_test }),
      chat_session: chat,
      chat_messages: messages,
      carry_from: session.carry_from ? { session: getSessionConfig(session.carry_from), record: carry } : null,
    };
  }

  async getCompleteParticipantData(id) {
    const participant = await this.getParticipant(id);
    // 管理员查看学生完整记录时，一次会读取 12 个课次。旧版逐项串行读取，
    // 在云端 Blob 上容易等待很久，前端又没有加载状态，看起来就像“点了没反应”。
    // 这里改为按课次并行读取，并在每个课次内并行拉取记录 / 聊天 / 事件。
    const entries = await Promise.all(SESSIONS.map(async config => {
      const [record, chat_session, chat_messages, events] = await Promise.all([
        this.getSessionRecord(id, config.id),
        this.getChatSession(id, config.id),
        this.getMessages(id, config.id),
        this.getEvents(id, config.id),
      ]);
      return [config.id, { config, record, chat_session, chat_messages, events }];
    }));
    return { participant, sessions: Object.fromEntries(entries) };
  }

  async archiveAndResetSession(id, sid, { reason = 'manual_admin_reset' } = {}) {
    const config = getSessionConfig(sid);
    if (!config) throw Object.assign(new Error('课次不存在'), { status: 404 });
    const participant = await this.getParticipant(id);
    const snapshot = {
      archived_at: iso(),
      archive_reason: reason,
      participant,
      session_config: config,
      record: await this.getSessionRecord(id, sid),
      chat_session: await this.getChatSession(id, sid),
      chat_messages: await this.getMessages(id, sid),
      events: await this.getEvents(id, sid),
    };
    const hasActivity = Boolean(
      snapshot.record?.started_at || snapshot.record?.saved_at || snapshot.record?.submitted_at ||
      snapshot.chat_session || snapshot.chat_messages.length || snapshot.events.length ||
      Object.keys(snapshot.record?.artifacts || {}).length || Object.keys(snapshot.record?.text_fields || {}).length
    );
    let archive_key = '';
    if (hasActivity) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      archive_key = `reset-archives/${stamp}_${id}_${sid}.json`;
      await storageService.putObject(archive_key, JSON.stringify(snapshot, null, 2));
    }
    // Clear only the active structured record/chat/event data. Uploaded image blobs are kept
    // as a safety copy; after reset they are no longer referenced by the active record or formal exports.
    await storageService.deletePrefix(`${sBase(id, sid)}/`);
    return { participant_id: id, session_id: sid, reset: true, archived_previous: hasActivity, archive_key };
  }

  async listResetArchives() {
    const rows = await storageService.listObjects('reset-archives/');
    const out = [];
    for (const row of rows.sort((a, b) => b.key.localeCompare(a.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push({ key: row.key, data: parse(raw, {}) });
    }
    return out;
  }

  async archiveAndResetTest() {
    const id = 'S00';
    const current = await this.getCompleteParticipantData(id);
    const hasActivity = SESSIONS.some(s => {
      const x = current.sessions[s.id];
      return Boolean(x.record?.started_at || x.chat_messages?.length || Object.keys(x.record?.artifacts || {}).length);
    });
    if (hasActivity) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await storageService.putObject(`test-archives/${stamp}.json`, JSON.stringify(current, null, 2));
    }
    await storageService.deletePrefix(`participants/${id}/`);
    await this.createParticipant(id, { condition: 'unassigned', grade: current.participant?.grade || '' });
    return { archived_previous: hasActivity };
  }

  async listTestArchives() {
    const rows = await storageService.listObjects('test-archives/');
    const out = [];
    for (const row of rows.sort((a, b) => b.key.localeCompare(a.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push({ key: row.key, data: parse(raw, {}) });
    }
    return out;
  }
}

export const researchService = new ResearchService();
