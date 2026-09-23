import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
import {
  DEFAULT_SETTINGS, CONDITIONS, SCHEMA_VERSION, SESSIONS, getSessionConfig,
  aiVariantFor, hiddenAiContext, PROMPT_VERSION_FREE, PROMPT_VERSION_SUPPORTED,
  QUESTIONNAIRE_ITEMS, QUESTIONNAIRE_META, QUESTIONNAIRE_VERSION,
} from '../config/researchConfig.js';
import { isTestParticipant, hashStudentName } from '../utils/validators.js';

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
const revPrefix = (id, sid) => `${sBase(id, sid)}/revisions/`;
const revKey = (id, sid, index) => `${revPrefix(id, sid)}${String(index).padStart(5, '0')}.json`;
const qKey = (id, slot) => `participants/${id}/questionnaires/${slot}.json`;
const liveKey = (id, sid) => `${sBase(id, sid)}/live-trace.json`;

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
    ai_requirement_met: null,
    text_fields: {},
    revision_count: 0,
    field_revision_counts: {},
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
      cohort_revision: input.cohort_revision == null ? current.cohort_revision : String(input.cohort_revision || current.cohort_revision),
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
      login_name_hash: input.login_name_hash ?? old.login_name_hash ?? '',
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

  async setParticipantMeta(id, { condition, grade, login_name } = {}) {
    const p = await this.getParticipant(id);
    if (condition != null) {
      if (!CONDITIONS.includes(condition)) throw Object.assign(new Error('condition无效'), { status: 400 });
      p.condition = condition;
    }
    if (grade != null) p.grade = String(grade).trim();
    if (login_name != null) {
      const hash = hashStudentName(login_name, id);
      if (!hash) throw Object.assign(new Error('姓名不能为空'), { status: 400 });
      p.login_name_hash = hash;
    }
    p.last_active_at = iso();
    await storageService.putObject(pKey(id), JSON.stringify(p));
    return p;
  }

  async replaceFormalCohort(rows = []) {
    const expected = Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
    const byId = new Map(rows.map(r => [String(r.participant_id || '').toUpperCase(), r]));
    if (byId.size !== 30 || expected.some(id => !byId.has(id))) {
      throw Object.assign(new Error('更换整批学生时必须包含完整的 S01–S30 共30人'), { status: 400 });
    }

    // 先关闭当前课次，避免更换名单时仍有学生继续写入旧编号。
    const revision = `cohort-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await this.saveSettings({ session_open: false, cohort_revision: revision });

    // 彻底清空正式学生的活跃任务/聊天/图片与旧登录信息；S00 不受影响。
    const chunks = [];
    for (let i = 0; i < expected.length; i += 5) chunks.push(expected.slice(i, i + 5));
    for (const chunk of chunks) {
      await Promise.all(chunk.map(async id => {
        await Promise.all([
          storageService.deletePrefix(`participants/${id}/`),
          storageService.deletePrefix(`uploads/${id}/`),
          storageService.deleteObject(pKey(id)),
        ]);
      }));
    }

    const result = [];
    for (const id of expected) {
      const row = byId.get(id);
      await this.createParticipant(id, { condition: 'unassigned', grade: '', login_name_hash: '' });
      const participant = await this.setParticipantMeta(id, {
        login_name: row.login_name,
        grade: row.grade || '',
        condition: row.condition || 'unassigned',
      });
      result.push({
        participant_id: id,
        grade: participant.grade,
        condition: participant.condition,
        login_name_ready: Boolean(participant.login_name_hash),
        status: 'ok',
      });
    }
    return { imported_count: result.length, cohort_revision: revision, session_open: false, result };
  }


  async getQuestionnaire(id, slot) {
    if (!['pre','post'].includes(slot)) throw Object.assign(new Error('问卷阶段无效'), { status: 400 });
    return parse(await storageService.getObject(qKey(id, slot)), null);
  }

  questionnaireScores(responses = {}) {
    const dims = { instrumental: [], executive: [], avoidance: [] };
    for (const item of QUESTIONNAIRE_ITEMS) {
      const v = Number(responses[item.id]);
      if (Number.isFinite(v) && v >= 1 && v <= 5) dims[item.dimension].push(v);
    }
    const mean = arr => arr.length ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(3)) : null;
    return {
      instrumental_mean: mean(dims.instrumental),
      executive_mean: mean(dims.executive),
      avoidance_mean: mean(dims.avoidance),
    };
  }

  async submitQuestionnaire(id, slot, responses = {}) {
    if (!['pre','post'].includes(slot)) throw Object.assign(new Error('问卷阶段无效'), { status: 400 });
    const existing = await this.getQuestionnaire(id, slot);
    if (existing?.submitted_at) throw Object.assign(new Error('该问卷已经提交，不能重复修改。'), { status: 409 });
    const clean = {};
    for (const item of QUESTIONNAIRE_ITEMS) {
      const v = Number(responses[item.id]);
      if (!Number.isInteger(v) || v < 1 || v > 5) throw Object.assign(new Error(`请完成第${QUESTIONNAIRE_ITEMS.indexOf(item)+1}题`), { status: 400 });
      clean[item.id] = v;
    }
    if (slot === 'post') {
      const w8 = await this.getSessionRecord(id, 'W8');
      if (!w8.submitted_at) throw Object.assign(new Error('请先提交W8正式项目，再完成后测问卷。'), { status: 409 });
    }
    const row = {
      participant_id: id, slot, questionnaire_version: QUESTIONNAIRE_VERSION,
      responses: clean, scores: this.questionnaireScores(clean), submitted_at: iso(),
    };
    await storageService.putObject(qKey(id, slot), JSON.stringify(row));
    await this.appendEvent(id, slot === 'pre' ? 'W2' : 'W8', `questionnaire_${slot}_submitted`, {
      questionnaire_version: QUESTIONNAIRE_VERSION, scores: row.scores,
    });
    return row;
  }

  async questionnairePublicState(id, slot) {
    const q = await this.getQuestionnaire(id, slot);
    return {
      slot, submitted: Boolean(q?.submitted_at), submitted_at: q?.submitted_at || null,
      scores: q?.scores || null,
      meta: QUESTIONNAIRE_META, items: QUESTIONNAIRE_ITEMS,
    };
  }

  async assertTaskAccess(id, sid) {
    const participant = await this.getParticipant(id);
    const session = getSessionConfig(sid);
    if (!session) throw Object.assign(new Error('课次不存在'), { status: 404 });
    if (session.require_questionnaire_before_task) {
      const pre = await this.getQuestionnaire(id, 'pre');
      if (!pre?.submitted_at) throw Object.assign(new Error('请先完成前测问卷。'), { status: 409 });
      if (!participant.is_test && participant.condition === 'unassigned') throw Object.assign(new Error('前测已完成，等待老师完成随机分组后再开始正式任务。'), { status: 409 });
    }
    return true;
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

  async getRevisions(id, sid) {
    const rows = await storageService.listObjects(revPrefix(id, sid));
    const out = [];
    for (const row of rows.sort((a, b) => a.key.localeCompare(b.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push(JSON.parse(raw));
    }
    return out;
  }

  async getRevisionsAfter(id, sid, afterIndex = 0, limit = 120) {
    const rows = await storageService.listObjects(revPrefix(id, sid));
    const pick = rows
      .map(row => ({ ...row, index: Number((row.key.match(/(\d+)\.json$/) || [])[1] || 0) }))
      .filter(row => row.index > Number(afterIndex || 0))
      .sort((a,b) => a.index - b.index)
      .slice(-Math.max(1, Number(limit || 120)));
    const out = await Promise.all(pick.map(async row => {
      const raw = await storageService.getObject(row.key);
      return raw ? JSON.parse(raw) : null;
    }));
    return out.filter(Boolean).sort((a,b) => Number(a.revision_index||0)-Number(b.revision_index||0));
  }

  async saveFields(id, sid, textFields = {}, saveContext = {}) {
    const r = await this.ensureStarted(id, sid);
    if (r.submitted_at) throw Object.assign(new Error('本节任务已经提交，不能再修改。'), { status: 409 });
    const config = getSessionConfig(sid);
    const allowed = new Set(config.fields.map(f => f.key));
    const changed = [];
    for (const [k, v] of Object.entries(textFields || {})) {
      if (!allowed.has(k)) continue;
      const nextText = String(v ?? '').trim();
      const previousText = String(r.text_fields[k] ?? '').trim();
      if (nextText !== previousText) changed.push({ field_key: k, previous_text: previousText, text: nextText });
      r.text_fields[k] = nextText;
    }

    if (changed.length) {
      let revisionIndex = Number(r.revision_count || 0);
      const perFieldCount = { ...(r.field_revision_counts || {}) };
      const lastAiAt = saveContext?.last_ai_message_at ? Date.parse(saveContext.last_ai_message_at) : NaN;
      for (const item of changed) {
        revisionIndex += 1;
        const fieldRevisionNo = Number(perFieldCount[item.field_key] || 0) + 1;
        perFieldCount[item.field_key] = fieldRevisionNo;
        const createdAt = iso();
        const secondsSinceAi = Number.isFinite(lastAiAt) ? Math.max(0, Math.floor((Date.parse(createdAt) - lastAiAt) / 1000)) : null;
        const row = {
          participant_id: id,
          session_id: sid,
          revision_index: revisionIndex,
          field_key: item.field_key,
          field_label: config.fields.find(f => f.key === item.field_key)?.label || item.field_key,
          field_stage: config.fields.find(f => f.key === item.field_key)?.stage || '',
          field_revision_no: fieldRevisionNo,
          previous_text: item.previous_text,
          text: item.text,
          created_at: createdAt,
          save_reason: String(saveContext?.reason || 'save'),
          last_ai_message_id: String(saveContext?.last_ai_message_id || ''),
          last_ai_message_at: String(saveContext?.last_ai_message_at || ''),
          seconds_since_last_ai_reply: secondsSinceAi,
        };
        await storageService.putObject(revKey(id, sid, revisionIndex), JSON.stringify(row));
      }
      r.revision_count = revisionIndex;
      r.field_revision_counts = perFieldCount;
    }

    r.saved_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.appendEvent(id, sid, 'fields_saved', {
      keys: Object.keys(textFields || {}).filter(k => allowed.has(k)),
      changed_keys: changed.map(x => x.field_key),
      save_reason: String(saveContext?.reason || 'save'),
    });
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

  async submitSession(id, sid, textFields = {}, saveContext = {}) {
    const config = getSessionConfig(sid);
    let r = await this.saveFields(id, sid, textFields, { ...saveContext, reason: saveContext?.reason || 'submit' });
    if (r.submitted_at) return r;
    const missingField = config.fields.find(f => f.required && !String(r.text_fields[f.key] || '').trim());
    if (missingField) throw Object.assign(new Error(`请先完成：${missingField.label}`), { status: 400 });
    const missingArtifact = config.artifacts.find(a => a.required && !r.artifacts[a.key]);
    if (missingArtifact) throw Object.assign(new Error(`请先完成：${missingArtifact.label}`), { status: 400 });
    if (config.ai_use_required_once && !r.ai_used) await this.appendEvent(id, sid, 'ai_required_not_used_at_submit', {});
    r.ai_requirement_met = config.ai_use_required_once ? Boolean(r.ai_used) : null;
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
    // 仅列出消息键来分配序号，不再为了 append 读取全部历史消息正文。
    const existing = await storageService.listObjects(mPrefix(id, sid));
    const message_index = existing.length + 1;
    const row = {
      participant_id: id, course_session_id: sid, message_index,
      message_id: data.message_id || randomUUID(), role: data.role, content: data.content,
      created_at: data.created_at || iso(), conversation_id: data.conversation_id || '', chat_id: data.chat_id || '',
      bot_id: data.bot_id || '', model: data.model || '', ai_variant: data.ai_variant || '', prompt_version: data.prompt_version || '',
      content_type: data.content_type || 'text', message_has_image: Boolean(data.message_has_image), attachments: Array.isArray(data.attachments) ? data.attachments : [],
      interaction_id: data.interaction_id || '',
      client_sent_at: data.client_sent_at || '',
      server_received_at: data.server_received_at || '',
      ai_request_started_at: data.ai_request_started_at || '',
      ai_response_received_at: data.ai_response_received_at || '',
      ai_latency_ms: Number.isFinite(Number(data.ai_latency_ms)) ? Number(data.ai_latency_ms) : null,
      task_field_key: data.task_field_key || '',
      task_field_label: data.task_field_label || '',
      task_field_stage: data.task_field_stage || '',
      task_context: data.task_context && typeof data.task_context === 'object' ? data.task_context : {},
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

  async getMessagesAfter(id, sid, afterIndex = 0, limit = 200) {
    const rows = await storageService.listObjects(mPrefix(id, sid));
    const pick = rows
      .map(row => ({ ...row, index: Number((row.key.match(/(\d+)\.json$/) || [])[1] || 0) }))
      .filter(row => row.index > Number(afterIndex || 0))
      .sort((a,b) => a.index - b.index)
      .slice(-Math.max(1, Number(limit || 200)));
    const out = await Promise.all(pick.map(async row => {
      const raw = await storageService.getObject(row.key);
      return raw ? JSON.parse(raw) : null;
    }));
    return out.filter(Boolean).sort((a,b) => Number(a.message_index||0)-Number(b.message_index||0));
  }

  async updateMessage(id, sid, messageIndex, patch = {}) {
    const key = mKey(id, sid, messageIndex);
    const current = parse(await storageService.getObject(key), null);
    if (!current) return null;
    const next = { ...current, ...patch };
    await storageService.putObject(key, JSON.stringify(next));
    return next;
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

  async getEventsAfter(id, sid, afterIndex = 0, limit = 160) {
    const rows = await storageService.listObjects(ePrefix(id, sid));
    const pick = rows
      .map(row => ({ ...row, index: Number((row.key.match(/(\d+)\.json$/) || [])[1] || 0) }))
      .filter(row => row.index > Number(afterIndex || 0))
      .sort((a,b) => a.index - b.index)
      .slice(-Math.max(1, Number(limit || 160)));
    const out = await Promise.all(pick.map(async row => {
      const raw = await storageService.getObject(row.key);
      return raw ? JSON.parse(raw) : null;
    }));
    return out.filter(Boolean).sort((a,b) => Number(a.event_index||0)-Number(b.event_index||0));
  }

  async getLiveTrace(id, sid) {
    return parse(await storageService.getObject(liveKey(id, sid)), null);
  }

  async updateLiveDraftState(id, sid, type, data = {}) {
    const relevant = new Set(['ai_draft_started','ai_draft_deleted_unsent','ai_draft_left_unsent','ai_draft_sent']);
    if (!relevant.has(type)) return null;
    // 单独保存实时草稿状态，避免与任务record并发写入造成覆盖。未发送正文从不写入。
    const state = {
      type, at: iso(),
      max_chars: Number(data?.max_chars || data?.initial_chars || data?.current_chars || 0),
      duration_ms: Number(data?.duration_ms || 0),
      edit_count: Number(data?.edit_count || 0),
      task_field_key: String(data?.task_field_key || ''),
      task_field_label: String(data?.task_field_label || ''),
      task_field_stage: String(data?.task_field_stage || ''),
    };
    await storageService.putObject(liveKey(id, sid), JSON.stringify(state));
    return state;
  }

  async hiddenContextForChat(sid) {
    return hiddenAiContext(getSessionConfig(sid));
  }

  async currentState(id) {
    const settings = await this.getSettings();
    const session = getSessionConfig(settings.active_session_id);
    const participant = await this.getParticipant(id);
    const questionnaire = {
      pre: await this.questionnairePublicState(id, 'pre'),
      post: await this.questionnairePublicState(id, 'post'),
    };
    let task_gate = '';
    if (session.require_questionnaire_before_task && !questionnaire.pre.submitted) task_gate = 'questionnaire_pre';
    else if (session.require_questionnaire_before_task && !participant.is_test && participant.condition === 'unassigned') task_gate = 'awaiting_assignment';
    const record = task_gate ? await this.getSessionRecord(id, session.id) : await this.ensureStarted(id, session.id);
    if (session.questionnaire_after_submit && record.submitted_at && !questionnaire.post.submitted) task_gate = 'questionnaire_post';
    const chat = session.ai_mode === 'none' || task_gate ? null : await this.getChatSession(id, session.id);
    const messages = session.ai_mode === 'none' || task_gate ? [] : await this.getMessages(id, session.id);
    let carry = null;
    if (session.carry_from) carry = await this.getSessionRecord(id, session.carry_from);
    const publicParticipant = { ...participant };
    delete publicParticipant.login_name_hash;
    return {
      settings, participant: publicParticipant, session, record, questionnaire, task_gate,
      ai_variant: aiVariantFor({ session, condition: participant.condition, isTest: participant.is_test }),
      chat_session: chat, chat_messages: messages,
      carry_from: session.carry_from ? { session: getSessionConfig(session.carry_from), record: carry } : null,
    };
  }

  async getCompleteParticipantData(id) {
    const participant = await this.getParticipant(id);
    // 管理员查看学生完整记录时，一次会读取 12 个课次。旧版逐项串行读取，
    // 在云端 Blob 上容易等待很久，前端又没有加载状态，看起来就像“点了没反应”。
    // 这里改为按课次并行读取，并在每个课次内并行拉取记录 / 聊天 / 事件。
    const entries = await Promise.all(SESSIONS.map(async config => {
      const [record, chat_session, chat_messages, events, revisions] = await Promise.all([
        this.getSessionRecord(id, config.id),
        this.getChatSession(id, config.id),
        this.getMessages(id, config.id),
        this.getEvents(id, config.id),
        this.getRevisions(id, config.id),
      ]);
      return [config.id, { config, record, chat_session, chat_messages, events, revisions }];
    }));
    const [pre, post] = await Promise.all([this.getQuestionnaire(id, 'pre'), this.getQuestionnaire(id, 'post')]);
    return { participant, questionnaires: { pre, post }, sessions: Object.fromEntries(entries) };
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
      revisions: await this.getRevisions(id, sid),
    };
    const hasActivity = Boolean(
      snapshot.record?.started_at || snapshot.record?.saved_at || snapshot.record?.submitted_at ||
      snapshot.chat_session || snapshot.chat_messages.length || snapshot.events.length || snapshot.revisions.length ||
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

  async restoreResetArchive(archiveKey) {
    const key = String(archiveKey || '');
    if (!/^reset-archives\/[A-Za-z0-9_.:-]+_S(?:00|[0-3]\d)_W\d+\.json$/.test(key)) {
      throw Object.assign(new Error('归档标识无效'), { status: 400 });
    }
    const snapshot = parse(await storageService.getObject(key), null);
    if (!snapshot?.participant?.participant_id || !snapshot?.session_config?.id) {
      throw Object.assign(new Error('归档内容不完整'), { status: 400 });
    }
    const id = snapshot.participant.participant_id;
    const sid = snapshot.session_config.id;
    const current = await this.getSessionRecord(id, sid);
    const currentMessages = await this.getMessages(id, sid);
    const currentEvents = await this.getEvents(id, sid);
    const currentRevisions = await this.getRevisions(id, sid);
    const hasCurrent = Boolean(current.started_at || current.saved_at || current.submitted_at || currentMessages.length || currentEvents.length || currentRevisions.length || Object.keys(current.text_fields || {}).length || Object.keys(current.artifacts || {}).length);
    if (hasCurrent) throw Object.assign(new Error(`${id} ${sid} 当前已有活动数据，为避免覆盖，未执行恢复。`), { status: 409 });

    if (snapshot.record) await storageService.putObject(rKey(id, sid), JSON.stringify(snapshot.record));
    if (snapshot.chat_session) await storageService.putObject(cKey(id, sid), JSON.stringify(snapshot.chat_session));
    for (let i = 0; i < (snapshot.chat_messages || []).length; i++) {
      const row = snapshot.chat_messages[i];
      const index = Number(row.message_index || i + 1);
      await storageService.putObject(mKey(id, sid, index), JSON.stringify(row));
    }
    for (let i = 0; i < (snapshot.events || []).length; i++) {
      const row = snapshot.events[i];
      const index = Number(row.event_index || i + 1);
      await storageService.putObject(eKey(id, sid, index), JSON.stringify(row));
    }
    for (let i = 0; i < (snapshot.revisions || []).length; i++) {
      const row = snapshot.revisions[i];
      const index = Number(row.revision_index || i + 1);
      await storageService.putObject(revKey(id, sid, index), JSON.stringify(row));
    }
    await storageService.putObject(`restore-audit/${new Date().toISOString().replace(/[:.]/g,'-')}_${id}_${sid}.json`, JSON.stringify({ restored_at: iso(), archive_key: key, participant_id: id, session_id: sid }));
    return { restored: true, participant_id: id, session_id: sid, archive_key: key };
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
    await this.createParticipant(id, { condition: 'unassigned', grade: current.participant?.grade || '', login_name_hash: current.participant?.login_name_hash || '' });
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
