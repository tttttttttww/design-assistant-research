import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
import {
  DEFAULT_SETTINGS, CONDITIONS, SCHEMA_VERSION, SESSIONS, getSessionConfig,
  aiVariantFor, hiddenAiContext, PROMPT_VERSION_FREE, PROMPT_VERSION_SUPPORTED,
  QUESTIONNAIRE_ITEMS, QUESTIONNAIRE_META, QUESTIONNAIRE_VERSION,
  INTERVENTION_ORIENTATION, INTERVENTION_SUPPORT_CARDS,
} from '../config/researchConfig.js';
import { isTestParticipant, testParticipantCondition, forcedParticipantCondition, hashStudentName } from '../utils/validators.js';

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
const orientationKey = (id, sid) => `${sBase(id, sid)}/orientation.json`;

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
    artifact_versions: {}, // v11.48: append-only image revision index; old artifacts remain readable
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
    return { ...DEFAULT_SETTINGS, ...stored, active_session_id: active, locked_session_ids: Array.isArray(stored.locked_session_ids) ? stored.locked_session_ids.filter(x => getSessionConfig(x)) : [] };
  }

  async saveSettings(input = {}) {
    const current = await this.getSettings();
    const active = getSessionConfig(input.active_session_id) ? input.active_session_id : current.active_session_id;
    const locked = new Set(Array.isArray(current.locked_session_ids) ? current.locked_session_ids : []);
    if (input.active_session_locked != null) {
      if (Boolean(input.active_session_locked)) locked.add(active);
      else locked.delete(active);
    }
    const next = {
      ...current,
      active_session_id: active,
      session_open: input.session_open == null ? current.session_open : Boolean(input.session_open),
      questionnaire_enabled: input.questionnaire_enabled == null ? current.questionnaire_enabled : Boolean(input.questionnaire_enabled),
      cohort_revision: input.cohort_revision == null ? current.cohort_revision : String(input.cohort_revision || current.cohort_revision),
      locked_session_ids: [...locked],
      updated_at: iso(),
    };
    await storageService.putObject('settings.json', JSON.stringify(next));
    return next;
  }

  async isSessionLocked(sid) {
    const settings = await this.getSettings();
    return Array.isArray(settings.locked_session_ids) && settings.locked_session_ids.includes(String(sid || '').toUpperCase());
  }

  async assertSessionWritable(sid) {
    if (await this.isSessionLocked(sid)) throw Object.assign(new Error('老师已结束并锁定本阶段，不能再修改。'), { status: 409 });
    return true;
  }

  async activeSession() {
    const settings = await this.getSettings();
    return getSessionConfig(settings.active_session_id);
  }

  async createParticipant(id, input = {}) {
    const old = parse(await storageService.getObject(pKey(id)), {});
    const fixedCondition = forcedParticipantCondition(id);
    const condition = fixedCondition || (CONDITIONS.includes(input.condition) ? input.condition : (CONDITIONS.includes(old.condition) ? old.condition : 'unassigned'));
    const p = {
      participant_id: id,
      condition,
      grade: input.grade ?? old.grade ?? '',
      login_name_hash: input.login_name_hash ?? old.login_name_hash ?? '',
      is_test: isTestParticipant(id),
      condition_fixed: Boolean(fixedCondition),
      condition_fixed_reason: fixedCondition ? (['S04','S05'].includes(id) ? 'S04/S05因前两节未参与，固定为B对照组' : '教师测试号固定组别') : '',
      created_at: old.created_at || iso(),
      last_active_at: iso(),
      schema_version: SCHEMA_VERSION,
    };
    await storageService.putObject(pKey(id), JSON.stringify(p));
    return p;
  }

  // Admin read-only snapshot: unlike getParticipant(), never creates blank student
  // profiles or silently reassigns groups when historical data is missing.
  async getParticipantReadOnly(id){
    const raw=await storageService.getObject(pKey(id));
    if(!raw) return {participant_id:id,condition:'unassigned',grade:'',login_name_hash:'',is_test:isTestParticipant(id),condition_fixed:false,history_profile_missing:true};
    return JSON.parse(raw);
  }

  async getParticipant(id) {
    const raw = await storageService.getObject(pKey(id));
    if (!raw) return this.createParticipant(id);
    const p = JSON.parse(raw);
    const forced = forcedParticipantCondition(id);
    if (forced && p.condition !== forced) {
      const previous = p.condition || 'unassigned';
      p.condition = forced;
      p.condition_fixed = true;
      p.condition_fixed_reason = ['S04','S05'].includes(id)
        ? 'S04/S05因前两节未参与，固定为B对照组'
        : '教师测试号固定组别';
      p.condition_corrected_from = previous;
      p.condition_corrected_at = iso();
      p.schema_version = SCHEMA_VERSION;
      await storageService.putObject(pKey(id), JSON.stringify(p));
    } else if (forced) {
      p.condition_fixed = true;
      p.condition_fixed_reason = ['S04','S05'].includes(id)
        ? 'S04/S05因前两节未参与，固定为B对照组'
        : '教师测试号固定组别';
    }
    return p;
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
      const previousCondition = p.condition || 'unassigned';
      const nextCondition = forcedParticipantCondition(id) || condition;
      p.condition = nextCondition;
      if (previousCondition !== nextCondition) {
        const changedAt = iso();
        p.condition_changed_at = changedAt;
        p.condition_change_history = Array.isArray(p.condition_change_history) ? p.condition_change_history : [];
        p.condition_change_history.push({ from: previousCondition, to: nextCondition, at: changedAt });
        if (p.condition_change_history.length > 50) p.condition_change_history = p.condition_change_history.slice(-50);
      }
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
    throw Object.assign(new Error('保护模式：禁止整批覆盖或删除正式学生资料。'),{status:403});
    throw Object.assign(new Error('正式研究期间禁止整批清空学生记录；使用更新现有名单。'),{status:403});
    const expected = Array.from({ length: 30 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
    const byId = new Map(rows.map(r => [String(r.participant_id || '').toUpperCase(), r]));
    if (byId.size !== 30 || expected.some(id => !byId.has(id))) {
      throw Object.assign(new Error('更换整批学生时必须包含完整的 S01–S30 共30人'), { status: 400 });
    }

    // 先关闭当前课次，避免更换名单时仍有学生继续写入旧编号。
    const revision = `cohort-${Date.now()}-${randomUUID().slice(0, 8)}`;
    await this.saveSettings({ session_open: false, cohort_revision: revision });

    // 彻底清空正式学生的活跃任务/聊天/图片与旧登录信息；S00/S99 测试号不受影响。
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


  async getOrientation(id, sid) {
    return parse(await storageService.getObject(orientationKey(id, sid)), null);
  }

  async orientationConfigFor(id, sid) {
    const session = getSessionConfig(sid);
    if (!session || !INTERVENTION_ORIENTATION[sid]) return null;
    const participant = await this.getParticipant(id);
    const variant = aiVariantFor({ session, condition: participant.condition, isTest: participant.is_test });
    if (!['supported','free'].includes(variant)) return null;
    const mode = variant === 'supported' ? 'supported' : 'control';
    const base = INTERVENTION_ORIENTATION[sid]?.[mode];
    if (!base) return null;
    const config = JSON.parse(JSON.stringify(base));
    // Preserve historical course timing: a lesson that already started before this weekly
    // protocol became active must never be retrospectively locked behind a new pre-task gate.
    // Old orientation records remain readable in original storage (and archive on any deliberate
    // new start), but are not rewritten merely to make a past class look treated.
    if (config.strategy_micro_lesson || String(config.key||'').startsWith('neutral-weekly-readiness-')) {
      const existing = await this.getOrientation(id, sid);
      if (!existing || existing.orientation_key !== config.key) {
        const previousRecord = await this.getSessionRecord(id, sid);
        if (previousRecord?.started_at || previousRecord?.submitted_at || previousRecord?.saved_at || existing?.completed_at) return null;
      }
    }
    if (mode === 'supported' && config.dynamic_personal_queries) {
      const pool = [];
      const humanEhsRefs = new Set();
      const humanIhsRefs = new Set();
      const humanLabeledRefs = new Set();
      for (const priorSid of [config.previous_session_id]) {
        const allMessages = await this.getMessages(id, priorSid);
        const messages = allMessages.filter(m => m.role === 'user' && String(m.content || '').trim())
          .map(m => ({ ...m, prior_sid:priorSid,
            paired_ai_reply:(allMessages.find(a => a.role === 'assistant' && m.interaction_id && a.interaction_id === m.interaction_id)?.content || '').slice(0,2400) }));
        pool.push(...messages);
        // Human-coded EHS takes precedence over any online model route. The coding remains unchanged.
        const codingKeys = await storageService.listObjects(`research-coding/v1/${id}/${priorSid}/`);
        for (const entry of codingKeys) {
          try {
            const row = parse(await storageService.getObject(entry.key), null);
            if (row?.help_type && Number.isInteger(Number(row.message_index))) {
              humanLabeledRefs.add(`${priorSid}:${row.message_index}`);
              if (row.help_type === 'EHS') humanEhsRefs.add(`${priorSid}:${row.message_index}`);
              if (row.help_type === 'IHS') humanIhsRefs.add(`${priorSid}:${row.message_index}`);
            }
          } catch (_) { /* Malformed optional coding never blocks the lesson. */ }
        }
      }
      const reversed = [...pool].reverse();
      const eligible = row => Boolean(row.paired_ai_reply && String(row.content || '').trim());
      const verified = reversed.filter(row => eligible(row) && humanEhsRefs.has(`${row.prior_sid}:${row.message_index}`));
      const system = reversed.filter(row => eligible(row) && row.agent_route === 'EHS' && !humanLabeledRefs.has(`${row.prior_sid}:${row.message_index}`));
      const ehsPicked = [...verified.map(row => ({row, selection_basis:'human_coded_EHS'})),
        ...system.map(row => ({row, selection_basis:'agent_route_EHS_unverified'}))].slice(0,2);
      // When last session has no EHS candidate, allow a genuine, help-oriented IHS chat as neutral review. Never label it wrong.
      const ordinary = reversed.filter(row => eligible(row) && (humanIhsRefs.has(`${row.prior_sid}:${row.message_index}`) ||
        (!humanLabeledRefs.has(`${row.prior_sid}:${row.message_index}`) && row.agent_route === 'IHS')));
      const picked = ehsPicked.length ? ehsPicked : ordinary.slice(0,1).map(row => ({row, selection_basis:'personal_IHS_neutral_review'}));
      // Do NOT show an ordinary/IHS request as 'poor help-seeking'. When no candidate exists, use a standardized case.
      config._prior_chat_count = pool.length;
      config._case_selection_reason = ehsPicked.length ? 'personal_EHS_candidate' : (picked.length ? 'personal_IHS_neutral_review' : (pool.length ? 'no_eligible_help_request_in_prior_chat' : 'no_prior_chat'));
      config.cards = picked.length ? picked.map((x,i) => ({
        title:`真实历史对话 ${i+1} · ${x.row.prior_sid}`,
        body:[`学生当时的问题：${String(x.row.content || '').trim().slice(0,1600)}`,
          `AI当时的回答：${x.row.paired_ai_reply}`],
      })) : [];
      config._selection_meta = picked.map(x => ({
        session_id:x.row.prior_sid,message_index:x.row.message_index,
        selection_basis:x.selection_basis,agent_route:x.row.agent_route || '',
      }));
    }
    return { session, participant, variant, mode, config };
  }

  async orientationPublicState(id, sid) {
    const resolved = await this.orientationConfigFor(id, sid);
    if (!resolved) return null;
    const { mode, config } = resolved;
    const stored = await this.getOrientation(id, sid);
    const compatible = stored?.mode === mode && stored?.orientation_key === config.key ? stored : null;
    return {
      mode,
      key: config.key,
      title: config.title,
      intro: config.intro,
      cards: compatible?.displayed_cards ?? config.cards ?? [],
      checks: config.checks || [],
      acknowledgements: config.acknowledgements || [],
      button: config.button,
      reflection_activity: Boolean(config.reflection_activity),
      strategy_micro_lesson: Boolean(config.strategy_micro_lesson),
      previous_session_id: config.previous_session_id || '',
      neutral_label_1: config.neutral_label_1 || '',
      neutral_label_2: config.neutral_label_2 || '',
      personal_query_options: (compatible?.selection_meta ?? config._selection_meta ?? []).map(x=>({session_id:x.session_id,message_index:x.message_index})),
      reflection_fallback_case: config.reflection_fallback_case || null,
      prior_chat_count: compatible?.prior_chat_count ?? config._prior_chat_count ?? null,
      case_selection_reason: compatible?.case_selection_reason || config._case_selection_reason || '',
      neutral_design_note_required: Boolean(config.neutral_design_note_required),
      started_at: compatible?.started_at || null,
      completed_at: compatible?.completed_at || null,
      duration_seconds: compatible?.duration_seconds ?? null,
      completed: Boolean(compatible?.completed_at),
    };
  }

  async startOrientation(id, sid) {
    const resolved = await this.orientationConfigFor(id, sid);
    if (!resolved) throw Object.assign(new Error('当前课次没有平台学习环节。'), { status: 409 });
    const { mode, config } = resolved;
    const old = await this.getOrientation(id, sid);
    if (old && (old.mode !== mode || old.orientation_key !== config.key)) {
      await storageService.putObject(
        `orientation-archives/${id}/${sid}/${iso().replace(/[:.]/g,'-')}.json`,
        JSON.stringify({ ...old, archived_reason:'condition_or_design_changed', archived_at:iso() }, null, 2),
      );
    }
    const isNew = !(old?.mode === mode && old?.orientation_key === config.key);
    const row = !isNew ? old : {
      participant_id: id,
      session_id: sid,
      mode,
      orientation_key: config.key,
      started_at: iso(),
      completed_at: null,
      duration_seconds: null,
      answers: {},
      displayed_cards: config.dynamic_personal_queries ? ((config.cards || []).length ? config.cards : [config.reflection_fallback_case]) : [],
      selection_meta: config.dynamic_personal_queries ? (config._selection_meta || []) : [],
      prior_chat_count: config._prior_chat_count ?? null,
      case_selection_reason: config._case_selection_reason || '',
      schema_version: SCHEMA_VERSION,
    };
    if (!row.started_at) row.started_at = iso();
    await storageService.putObject(orientationKey(id, sid), JSON.stringify(row));
    if (isNew) {
      await this.appendEvent(id, sid, 'orientation_started', {
        orientation_mode: mode,
        orientation_key: config.key,
        displayed_cards: row.displayed_cards || [],
        selection_meta: row.selection_meta || [],
      });
    }
    return row;
  }

  async completeOrientation(id, sid, answers = {}) {
    const row = await this.startOrientation(id, sid);
    if (row.completed_at) return row;
    const resolved = await this.orientationConfigFor(id, sid);
    const config = resolved?.config;
    if (!config) throw Object.assign(new Error('平台学习环节配置不存在。'), { status: 409 });
    const clean = {};
    if (row.mode === 'supported') {
      if(config.reflection_activity) {
        const ref=String(answers.personal_ref||'').slice(0,80);
        const allowedRefs=(row.selection_meta||[]).map(x=>`${x.session_id}:${x.message_index}`);
        if(ref && !allowedRefs.includes(ref))throw Object.assign(new Error('历史提问关联无效。'),{status:400});
        if(allowedRefs.length && !ref)throw Object.assign(new Error('请从上方真实历史对话中选择一条作为主要回顾对象。'),{status:400});
        const difficulty=String(answers.reflection_difficulty||'').trim().slice(0,600);
        const replyReview=String(answers.reflection_reply_review||'').trim().slice(0,600);
        const revised=String(answers.revised_question||'').trim().slice(0,600);
        const rationale=String(answers.reflection_reason||'').trim().slice(0,600);
        if(difficulty.length<4 || replyReview.length<4 || revised.length<6 || rationale.length<6)throw Object.assign(new Error('请完成三个核心回顾：明确问题、判断回复后采取的行动、改写提问并说明理由。'),{status:400});
        clean.personal_ref=ref;clean.reflection_source=ref?'personal_chat':'standard_case';clean.reflection_difficulty=difficulty;clean.reflection_reply_review=replyReview;clean.revised_question=revised;clean.reflection_reason=rationale;
        clean.had_original_question=Boolean(ref);
        clean.prior_chat_count=Number(row.prior_chat_count ?? config._prior_chat_count ?? 0);
        clean.case_selection_reason=row.case_selection_reason || config._case_selection_reason || '';
        clean.selected_case_basis=ref?(row.selection_meta||[]).find(x=>`${x.session_id}:${x.message_index}`===ref)?.selection_basis||'':'';
      }
      for (const item of config.checks || []) {
        const v = Number(answers[item.id]);
        if (!Number.isInteger(v) || v < 0 || v >= item.options.length) {
          throw Object.assign(new Error('请先完成全部小练习。'), { status: 400 });
        }
        clean[item.id] = v;
      }
      const wrong = (config.checks || []).find(item => clean[item.id] !== Number(item.correct));
      if (wrong && !config.allow_imperfect_quiz) throw Object.assign(new Error('还有一题需要重新判断，请看完提示后再试一次。'), { status: 422 });
      if (config.strategy_micro_lesson) {
        clean.strategy_practice_count = (config.checks || []).length;
        clean.strategy_practice_correct_count = (config.checks || []).filter(item => clean[item.id] === Number(item.correct)).length;
        clean.strategy_practice_protocol='scenario-practice-with-explanation-not-pretest';
      }
    } else {
      if(config.neutral_design_note_required){
        const observation=String(answers.neutral_observation||'').trim().slice(0,600);
        const nextstep=String(answers.neutral_nextstep||'').trim().slice(0,600);
        if(observation.length<6 || nextstep.length<6)throw Object.assign(new Error('请先写下具体的测试观察点和可能的后续操作。'),{status:400});
        clean.neutral_observation=observation;clean.neutral_nextstep=nextstep;
      }
      const ack = Array.isArray(answers.acknowledged) ? answers.acknowledged.map(Boolean) : [];
      if (ack.length !== (config.acknowledgements || []).length || ack.some(v => !v)) {
        throw Object.assign(new Error('请确认已经阅读全部平台操作说明。'), { status: 400 });
      }
      clean.acknowledged = ack;
    }
    row.answers = clean;
    row.completed_at = iso();
    row.duration_seconds = Math.max(0, Math.floor((Date.parse(row.completed_at) - Date.parse(row.started_at)) / 1000));
    await storageService.putObject(orientationKey(id, sid), JSON.stringify(row));
    await this.appendEvent(id, sid, 'orientation_completed', {
      orientation_mode: row.mode,
      orientation_key: row.orientation_key,
      duration_seconds: row.duration_seconds,
    });
    return row;
  }

  async createProtectedPreW4Snapshot() {
    const latestKey = 'protected-snapshots/pre-w4-latest.json';
    const existing = parse(await storageService.getObject(latestKey), null);
    if (existing?.prefix) return { ...existing, reused: true };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const prefix = `protected-snapshots/pre-w4-${stamp}`;
    const all = await storageService.listObjects('', 30000);
    const keep = all.filter(row => {
      const k = String(row.key || '');
      return /^participants\/S(?:0[1-9]|[12]\d|30)\/sessions\/W[123]\//.test(k)
        || /^uploads\/S(?:0[1-9]|[12]\d|30)\/W[123]\//.test(k);
    });
    let copied = 0;
    for (const row of keep) {
      const buf = await storageService.getObjectBuffer(row.key);
      if (buf == null) continue;
      await storageService.putObject(`${prefix}/raw/${row.key}`, buf);
      copied += 1;
    }
    const meta = {
      created_at: iso(),
      prefix,
      copied_objects: copied,
      source_storage: storageService.describe(),
      sessions: ['W1','W2','W3'],
      note: 'W1/W2/W3 immutable pre-W4 intervention safety snapshot. Raw object paths are preserved under raw/.',
    };
    await storageService.putObject(`${prefix}/meta.json`, JSON.stringify(meta, null, 2));
    await storageService.putObject(latestKey, JSON.stringify(meta, null, 2));
    return meta;
  }

  async protectedPreW4SnapshotInfo() {
    return parse(await storageService.getObject('protected-snapshots/pre-w4-latest.json'), null);
  }

  async restoreProtectedPreW4SnapshotMissingOnly() {
    const meta = await this.protectedPreW4SnapshotInfo();
    if (!meta?.prefix) throw Object.assign(new Error('尚未创建W1/W2/W3干预前安全快照。'), { status: 404 });
    const rows = await storageService.listObjects(`${meta.prefix}/raw/`, 30000);
    let restored = 0, skipped = 0;
    const rawPrefix = `${meta.prefix}/raw/`;
    for (const row of rows) {
      const originalKey = String(row.key || '').slice(rawPrefix.length);
      if (!originalKey) continue;
      const current = await storageService.getObjectBuffer(originalKey);
      if (current != null) { skipped += 1; continue; }
      const buf = await storageService.getObjectBuffer(row.key);
      if (buf == null) continue;
      await storageService.putObject(originalKey, buf);
      restored += 1;
    }
    await storageService.putObject(
      `protected-snapshots/restore-audit/${new Date().toISOString().replace(/[:.]/g,'-')}.json`,
      JSON.stringify({ restored_at: iso(), source_prefix: meta.prefix, restored, skipped }, null, 2)
    );
    return { restored, skipped, source_prefix: meta.prefix };
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
      const w10 = await this.getSessionRecord(id, 'W10');
      if (!w10.submitted_at) throw Object.assign(new Error('请先提交W10正式干预任务，再完成后测问卷。'), { status: 409 });
    }
    const row = {
      participant_id: id, slot, questionnaire_version: QUESTIONNAIRE_VERSION,
      responses: clean, scores: this.questionnaireScores(clean), submitted_at: iso(),
    };
    await storageService.putObject(qKey(id, slot), JSON.stringify(row));
    await this.appendEvent(id, slot === 'pre' ? 'W2' : 'W10', `questionnaire_${slot}_submitted`, {
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
    if (session.ai_mode === 'condition' && !participant.is_test && participant.condition === 'unassigned') {
      throw Object.assign(new Error('正式干预课次尚未设置实验组/对照组，请联系老师。'), { status: 409 });
    }
    if (INTERVENTION_ORIENTATION[sid]) {
      const orientation = await this.orientationPublicState(id, sid);
      if (orientation && !orientation.completed) {
        throw Object.assign(new Error('请先完成本节进入任务前的平台学习环节。'), { status: 409 });
      }
    }
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
    await this.assertSessionWritable(sid);
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

  // Read both newly recorded versions and legacy single-image slots without changing past records.
  async getArtifactVersions(id, sid, record = null) {
    const r = record || await this.getSessionRecord(id, sid);
    const out = {};
    for (const [key, old] of Object.entries(r.artifacts || {})) {
      if (old?.file_path) out[key] = [{...old, version_id:old.version_id||`legacy-${old.file_name}`, version_no:old.version_no||1, kind:old.kind||'legacy', evidence_status:'legacy_upload', is_legacy:!old.version_id}];
    }
    for (const [key, entries] of Object.entries(r.artifact_versions || {})) {
      if (!out[key]) out[key] = [];
      for (const entry of entries || []) if (entry?.file_path && !out[key].some(x=>x.file_path===entry.file_path)) out[key].push(entry);
    }
    // A separate immutable source object is written per upload for audit/recovery.
    const objects = await storageService.listObjects(`${sBase(id,sid)}/artifact-versions/`);
    for (const item of objects) {
      const v = parse(await storageService.getObject(item.key));
      if (!v?.file_path || !v?.artifact_key) continue;
      if (!out[v.artifact_key]) out[v.artifact_key] = [];
      if (!out[v.artifact_key].some(x=>x.file_path===v.file_path)) out[v.artifact_key].push(v);
    }
    // Before v11.48 a replaced upload could leave an unreferenced image object.
    // Recover references non-destructively from the old upload path; original order is unknown.
    const allowedKeys = new Set((getSessionConfig(sid)?.artifacts||[]).map(a=>a.key));
    const olderImages = await storageService.listObjects(`uploads/${id}/${sid}/`);
    for (const item of olderImages) {
      const parts=String(item.key||'').split('/');
      if(parts.length!==5 || !allowedKeys.has(parts[3]))continue; // exclude chat images
      const [, , , key, fileName]=parts;
      if(!/\.(png|jpg|jpeg|webp)$/i.test(fileName))continue;
      if(!out[key])out[key]=[];
      if(!out[key].some(x=>x.file_path===item.key))out[key].push({participant_id:id,session_id:sid,
        artifact_key:key,file_name:fileName,file_path:item.key,version_id:`unindexed-${fileName}`,
        version_no:null,kind:'unindexed_legacy_image',uploaded_at:'',is_legacy:true,
        original_order_unknown:true,evidence_status:'historical_blob_found_without_version_index'});
    }
    for (const values of Object.values(out)) values.sort((a,b)=>
      Number(Boolean(a.original_order_unknown))-Number(Boolean(b.original_order_unknown))||
      Number(a.version_no??1)-Number(b.version_no??1)||
      String(a.uploaded_at||'').localeCompare(String(b.uploaded_at||'')));
    return out;
  }

  async addArtifact(id, sid, artifactKey, meta) {
    await this.assertSessionWritable(sid);
    const config = getSessionConfig(sid);
    if (!config.artifacts.some(a => a.key === artifactKey)) throw Object.assign(new Error('上传项目无效'), { status: 400 });
    const r = await this.ensureStarted(id, sid);
    if (r.submitted_at) throw Object.assign(new Error('本节任务已经提交，不能再替换图片。'), { status: 409 });
    const prior = r.artifacts[artifactKey];
    // Capture the prior v11.47 image before changing the latest-image pointer.
    const history = r.artifact_versions && Array.isArray(r.artifact_versions[artifactKey]) ? [...r.artifact_versions[artifactKey]] : [];
    if (prior?.file_path && !history.some(x=>x.file_path===prior.file_path)) history.unshift({ ...prior, version_id:prior.version_id||`legacy-${prior.file_name}`, version_no:prior.version_no||1, kind:prior.kind||'legacy', is_legacy:!prior.version_id });
    const previous = history.at(-1) || null;
    const kind = ['draft','revision','correction'].includes(meta.kind) ? meta.kind : previous?'revision':'draft';
    const source = ['self','ai','teacher','peer','mixed','unknown'].includes(meta.change_source) ? meta.change_source:'unknown';
    let baseVersionRef = '';
    const requestedBase = String(meta.based_on_version_ref||'').slice(0,160);
    const carrySid = getSessionConfig(sid)?.carry_from;
    if (requestedBase && carrySid) {
      const prevVersions = await this.getArtifactVersions(id,carrySid);
      if(Object.values(prevVersions).flat().some(v=>requestedBase===`${carrySid}:${v.version_id}`))baseVersionRef=requestedBase;
      else throw Object.assign(new Error('关联的上一课作品版本不存在，请重新选择。'),{status:400});
    } else if(requestedBase) throw Object.assign(new Error('此课次不能关联上一课作品。'),{status:400});
    const aiMessageId = String(meta.ai_message_id||'').slice(0,110);
    let matched = null;
    if (aiMessageId) {
      const messages = await this.getMessages(id,sid);
      matched = messages.find(m=>m.role==='assistant' && String(m.message_id||'')===aiMessageId) || null;
      if (!matched) throw Object.assign(new Error('所选择的AI回复不存在，请重新选择或取消关联。'),{status:400});
    }
    const version = { ...meta, version_id:randomUUID(), version_no:history.length+1, kind,
      change_source:source, change_note:String(meta.change_note||'').slice(0,500),
      ai_message_id:matched?.message_id||'', ai_message_at:matched?.created_at||'',
      linked_ai_evidence:matched?'student_linked_to_existing_reply':'not_linked',
      supersedes_version_id:previous?.version_id||'', based_on_version_ref:baseVersionRef, uploaded_at:iso() };
    // Write independent append-only version metadata first: no past version/image is ever deleted.
    await storageService.putObject(`${sBase(id,sid)}/artifact-versions/${artifactKey}/${version.uploaded_at.replace(/[:.]/g,'-')}_${version.version_id}.json`,JSON.stringify(version));
    r.artifact_versions = { ...(r.artifact_versions||{}), [artifactKey]:[...history,version] };
    r.artifacts[artifactKey] = version; // old API keeps latest-image pointer for backward compatibility
    r.saved_at = iso();
    await this.saveSessionRecord(id,sid,r);
    await this.appendEvent(id,sid,kind==='correction'?'artifact_corrected':'artifact_version_uploaded',{
      artifact_key:artifactKey, version_id:version.version_id, version_no:version.version_no,
      previous_version_id:version.supersedes_version_id, kind, change_source:source,
      ai_message_id:version.ai_message_id, based_on_version_ref:baseVersionRef, file_name:version.file_name });
    return r;
  }

  async submitSession(id, sid, textFields = {}, saveContext = {}) {
    await this.assertSessionWritable(sid);
    const config = getSessionConfig(sid);
    let r = await this.saveFields(id, sid, textFields, { ...saveContext, reason: saveContext?.reason || 'submit' });
    if (r.submitted_at) return r;
    const missingField = config.fields.find(f => f.required && !String(r.text_fields[f.key] || '').trim());
    if (missingField) throw Object.assign(new Error(`请先完成：${missingField.label}`), { status: 400 });
    const missingArtifact = config.artifacts.find(a => a.required && !r.artifacts[a.key]);
    if (missingArtifact) throw Object.assign(new Error(`请先完成：${missingArtifact.label}`), { status: 400 });
    if (config.ai_use_required_once) {
      const msgs=await this.getMessages(id,sid);
      const hasExchange=msgs.some((m,i)=>m.role==='user' && msgs.slice(i+1).some(a=>a.role==='assistant' && (a.interaction_id && a.interaction_id===m.interaction_id || !a.interaction_id)));
      if (!hasExchange) {
        await this.appendEvent(id,sid,'ai_required_exchange_missing_at_submit',{});
        throw Object.assign(new Error('本节需要至少完成一轮AI问答：发送问题并等待AI回复后再提交。如遇设备或网络故障请联系教师。'),{status:400});
      }
      r.ai_requirement_met = true;
    } else r.ai_requirement_met = null;
    r.submitted_at = iso();
    r.completed_at = iso();
    await this.saveSessionRecord(id, sid, r);
    await this.endChat(id, sid, { submitted: true });
    await this.appendEvent(id, sid, 'session_marked_complete', {});
    return r;
  }

  async reopenSession(id, sid) {
    await this.assertSessionWritable(sid);
    const r = await this.getSessionRecord(id, sid);
    if (!r.submitted_at) return r;
    const priorSubmittedAt = r.submitted_at;
    r.submitted_at = null;
    r.completed_at = null;
    r.saved_at = iso();
    await this.saveSessionRecord(id, sid, r);
    const s = await this.getChatSession(id, sid);
    if (s) {
      s.locked = false;
      s.ended_at = null;
      await this.saveChatSession(id, sid, s);
    }
    await this.appendEvent(id, sid, 'session_reopened_by_student', { prior_submitted_at: priorSubmittedAt });
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
    } else if (s.ai_variant !== variant) {
      // 组别发生纠正时，不沿用另一条件下创建的 Coze 会话，避免跨组上下文污染。
      s.ai_variant = variant;
      s.bot_id = '';
      s.model = '';
      s.conversation_id = '';
      s.locked = false;
      s.ended_at = null;
      s.processing = false;
      s.processing_interaction_id = '';
      s.prompt_version = variant === 'supported' ? PROMPT_VERSION_SUPPORTED : PROMPT_VERSION_FREE;
      await storageService.putObject(cKey(id, sid), JSON.stringify(s));
      await this.appendEvent(id, sid, 'ai_condition_reconciled', { ai_variant: variant });
    } else {
      const desiredPromptVersion = variant === 'supported' ? PROMPT_VERSION_SUPPORTED : PROMPT_VERSION_FREE;
      if (s.prompt_version !== desiredPromptVersion) {
        const previousPromptVersion = s.prompt_version || '';
        // 上下文协议发生改变时，旧 Coze conversation 里可能已经保留了此前注入的任务背景。
        // 平台聊天记录不删除，但AI侧开启新 conversation，避免旧隐藏上下文继续污染后续回答。
        s.bot_id = '';
        s.model = '';
        s.conversation_id = '';
        s.processing = false;
        s.processing_interaction_id = '';
        s.prompt_version = desiredPromptVersion;
        await storageService.putObject(cKey(id, sid), JSON.stringify(s));
        await this.appendEvent(id, sid, 'ai_context_policy_reset', {
          previous_prompt_version: previousPromptVersion,
          prompt_version: desiredPromptVersion,
          preserved_platform_chat_history: true,
        });
      }
    }
    return s;
  }

  async saveChatSession(id, sid, s) {
    await storageService.putObject(cKey(id, sid), JSON.stringify(s));
    return s;
  }

  async markAiOpened(id, sid) {
    await this.assertSessionWritable(sid);
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
      agent_route: data.agent_route || '',
      scaffold_triggered: typeof data.scaffold_triggered === 'boolean' ? data.scaffold_triggered : null,
      scaffold_type: data.scaffold_type || '',
      route_parse_status: data.route_parse_status || '',
      route_protocol_version: data.route_protocol_version || '',
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
    const at = iso();
    const index=Date.now()*1000+Math.floor(Math.random()*1000);
    const row = { participant_id: id, session_id: sid, event_index: index, type, at, data };
    // Unique append-only filename; historical 00001.json events remain readable.
    await storageService.putObject(`${ePrefix(id, sid)}v2_${at.replace(/[^0-9]/g,'')}_${randomUUID()}.json`, JSON.stringify(row));
    return row;
  }

  async getEvents(id, sid) {
    const rows = await storageService.listObjects(ePrefix(id, sid));
    const out = [];
    for (const row of rows.sort((a, b) => a.key.localeCompare(b.key))) {
      const raw = await storageService.getObject(row.key);
      if (raw) out.push(JSON.parse(raw));
    }
    return out.sort((a,b)=> Number(a.event_index||0)-Number(b.event_index||0));
  }

  async getEventsAfter(id, sid, afterIndex = 0, limit = 160) {
    const rows=await this.getEvents(id,sid);
    return rows.filter(x=>Number(x.event_index||0)>Number(afterIndex||0))
      .sort((a,b)=>Number(a.event_index||0)-Number(b.event_index||0))
      .slice(0,Math.max(1,Number(limit||160)));
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
    const session_locked = Array.isArray(settings.locked_session_ids) && settings.locked_session_ids.includes(session.id);
    const participant = await this.getParticipant(id);
    const questionnaire = {
      pre: await this.questionnairePublicState(id, 'pre'),
      post: await this.questionnairePublicState(id, 'post'),
    };
    const ai_variant = aiVariantFor({ session, condition: participant.condition, isTest: participant.is_test });
    const orientation = await this.orientationPublicState(id, session.id);
    let task_gate = '';
    let learning_gate = '';
    if (session.require_questionnaire_before_task && !questionnaire.pre.submitted) task_gate = 'questionnaire_pre';
    else if (session.ai_mode === 'condition' && !participant.is_test && participant.condition === 'unassigned') task_gate = 'awaiting_assignment';
    if (!task_gate && orientation && !orientation.completed) learning_gate = 'orientation';
    const record = (task_gate || learning_gate) ? await this.getSessionRecord(id, session.id) : await this.ensureStarted(id, session.id);
    if (!learning_gate && settings.questionnaire_enabled && session.questionnaire_after_submit && record.submitted_at && !questionnaire.post.submitted) task_gate = 'questionnaire_post';
    const chat = session.ai_mode === 'none' || task_gate || learning_gate ? null : await this.getChatSession(id, session.id);
    const messages = session.ai_mode === 'none' || task_gate || learning_gate ? [] : await this.getMessages(id, session.id);
    let carry = null;
    if (session.carry_from) carry = await this.getSessionRecord(id, session.carry_from);
    const publicParticipant = { ...participant };
    delete publicParticipant.login_name_hash;
    return {
      settings, participant: publicParticipant, session, session_locked, record, questionnaire, task_gate, learning_gate, orientation,
      support_card: null,
      artifact_versions: await this.getArtifactVersions(id, session.id, record),
      carry_artifact_versions: carry ? await this.getArtifactVersions(id,session.carry_from,carry) : {},
      ai_variant,
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
      return [config.id, { config, record, chat_session, chat_messages, events, revisions, artifact_versions:await this.getArtifactVersions(id,config.id,record) }];
    }));
    const [pre, post] = await Promise.all([this.getQuestionnaire(id, 'pre'), this.getQuestionnaire(id, 'post')]);
    return { participant, questionnaires: { pre, post }, sessions: Object.fromEntries(entries) };
  }

  async archiveAndResetSession(id, sid, { reason = 'manual_admin_reset' } = {}) {
    if (!isTestParticipant(id)) throw Object.assign(new Error('保护模式：正式学生历史课次不可重置。'),{status:403});
    if (!isTestParticipant(id)) throw Object.assign(new Error('正式学生历史数据不可重置。'),{status:403});
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

  async archiveAndResetTest(id = 'S00') {
    if (!isTestParticipant(id)) throw Object.assign(new Error('不是测试账号'), { status: 400 });
    const current = await this.getCompleteParticipantData(id);
    const hasActivity = SESSIONS.some(s => {
      const x = current.sessions[s.id];
      return Boolean(x.record?.started_at || x.chat_messages?.length || Object.keys(x.record?.artifacts || {}).length);
    });
    if (hasActivity) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await storageService.putObject(`test-archives/${stamp}_${id}.json`, JSON.stringify(current, null, 2));
    }
    await storageService.deletePrefix(`participants/${id}/`);
    await this.createParticipant(id, { condition: testParticipantCondition(id) || 'unassigned', grade: current.participant?.grade || '', login_name_hash: current.participant?.login_name_hash || '' });
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
