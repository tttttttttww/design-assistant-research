const api = async (path, options = {}) => {
  const r = await fetch('/express/api/admin' + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.error || '操作失败');
  return d;
};

const uploadApi = async (path, formData) => {
  const r = await fetch('/express/api/admin' + path, { method: 'POST', body: formData });
  let d = {};
  try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.error || '上传失败');
  return d;
};

let rows = [], settings = null, sessions = [], selectedParticipantId = '';
let liveSelectedParticipantId = '';
let liveAutoRefresh = true;
let liveTimer = null;
let liveRefreshing = false;
let liveRefreshQueued = false;
const LIVE_POLL_MS = 4000;
let liveDetailCache = { id:'', session_id:'', messages:[], events:[], revisions:[] };
let liveLastRefreshAt = '';
const esc = App.escapeHtml;
const fmtSeconds = v => v == null ? '—' : v < 60 ? `${v}s` : `${Math.floor(v / 60)}m ${v % 60}s`;

async function check() {
  try {
    await api('/settings');
    showApp();
    await loadSettings();
    await loadParticipants();
    startLiveTimer();
  } catch {}
}
function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
}

document.getElementById('loginForm').onsubmit = async e => {
  e.preventDefault();
  try {
    await api('/login', { method: 'POST', body: JSON.stringify({ password: document.getElementById('password').value }) });
    showApp();
    await loadSettings();
    await loadParticipants();
    startLiveTimer();
  } catch (x) {
    const b = document.getElementById('loginError');
    b.textContent = x.message;
    b.classList.remove('hidden');
  }
};
document.getElementById('logout').onclick = async () => { await api('/logout', { method: 'POST' }); location.reload(); };

async function loadSettings() {
  settings = await api('/settings');
  sessions = settings.sessions || [];
  const f = document.getElementById('settingsForm');
  f.active_session_id.innerHTML = sessions.map(s => `<option value="${s.id}">${s.id} · ${s.date} · ${esc(s.title)}</option>`).join('');
  f.active_session_id.value = settings.active_session_id;
  f.session_open.checked = Boolean(settings.session_open);
  f.questionnaire_enabled.checked = Boolean(settings.questionnaire_enabled);
  document.getElementById('activeSessionBadge').textContent = `当前：${settings.active_session_id} · ${sessions.find(s => s.id === settings.active_session_id)?.title || ''}`;
  renderSessionCards();
}
document.getElementById('settingsForm').onsubmit = async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('/settings', { method: 'POST', body: JSON.stringify({ active_session_id: f.active_session_id.value, session_open: f.session_open.checked, questionnaire_enabled: f.questionnaire_enabled.checked }) });
    alert('设置已保存');
    await loadSettings();
    await loadParticipants();
  } catch (x) { alert(x.message); }
};

function renderSessionCards() {
  document.getElementById('sessionCards').innerHTML = sessions.map(s => `<div class="session-card ${s.id === settings.active_session_id ? 'current' : ''}"><div class="row between"><strong>${s.id} · ${s.date}</strong><span class="badge">${s.ai_mode === 'condition' ? '按组AI' : s.ai_mode === 'free' ? '自由AI' : '无AI'}</span></div><h3>${esc(s.title)}</h3><p>${esc(s.subtitle)}</p><p class="small">${esc(s.brief.join(' '))}</p>${s.candidate ? '<div class="notice"><strong>教师说明：</strong>候选任务，正式实施前仍可替换。</div>' : ''}<button class="btn ghost set-current" data-id="${s.id}">设为当前课次</button></div>`).join('');
  document.querySelectorAll('.set-current').forEach(b => b.onclick = async () => {
    await api('/settings', { method: 'POST', body: JSON.stringify({ active_session_id: b.dataset.id, session_open: settings.session_open, questionnaire_enabled: settings.questionnaire_enabled }) });
    await loadSettings();
    await loadParticipants();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

document.getElementById('createDefault').onclick = async () => { await api('/participants/create-default', { method: 'POST' }); await loadParticipants(); };

let rosterPreviewData = null;
const rosterFile = document.getElementById('rosterFile');
const rosterPreviewBox = document.getElementById('rosterPreview');
document.getElementById('chooseRoster').onclick = () => rosterFile.click();
rosterFile.onchange = async () => {
  const file = rosterFile.files?.[0];
  if (!file) return;
  document.getElementById('rosterFileName').textContent = file.name;
  rosterPreviewBox.classList.remove('hidden');
  rosterPreviewBox.innerHTML = '<div class="detail-loading"><span class="spinner-inline"></span>正在读取名单并检查编号、姓名、年级……</div>';
  try {
    const fd = new FormData();
    fd.append('roster', file);
    rosterPreviewData = await uploadApi('/participants/roster-preview', fd);
    renderRosterPreview(rosterPreviewData);
  } catch (x) {
    rosterPreviewData = null;
    rosterPreviewBox.innerHTML = `<div class="notice warn"><strong>名单读取失败：</strong>${esc(x.message)}</div>`;
  }
};

function renderRosterPreview(d) {
  const duplicateNameText = (d.duplicate_names || []).map(group => group.map(x => `${x.participant_id} ${x.login_name}`).join(' / '));
  const problems = [];
  if (d.errors?.length) problems.push(`有 ${d.errors.length} 行需要修正`);
  if (d.missing?.length) problems.push(`缺少 ${d.missing.length} 个编号`);
  const status = d.ready_for_full_import
    ? '<div class="notice roster-ready"><strong>可以导入：</strong>已识别 S01–S30 共30人。请再核对下面预览，然后点击“确认导入30人”。</div>'
    : `<div class="notice warn"><strong>暂时不能完整导入：</strong>${esc(problems.join('；') || '名单格式需要检查')}。</div>`;
  const errorHtml = d.errors?.length
    ? `<details open><summary>需要修正的行（${d.errors.length}）</summary><div class="roster-errors">${d.errors.map(e => `<div>第${e.line}行 · ${esc(e.participant_id)}：${esc(e.reason)}</div>`).join('')}</div></details>`
    : '';
  const missingHtml = d.missing?.length ? `<div class="small warn-text">缺少编号：${d.missing.join('、')}</div>` : '';
  const sameNameHtml = duplicateNameText.length
    ? `<div class="notice warn"><strong>发现同名学生：</strong>${duplicateNameText.map(esc).join('；')}。编号+姓名仍可使用，但同名学生若互相输错编号，姓名无法进一步区分；上课时请特别提醒他们核对编号。</div>`
    : '';
  const rowsHtml = (d.rows || []).map(r => `<tr><td>${esc(r.participant_id)}</td><td>${esc(r.login_name)}</td><td>${esc(r.grade || '—')}</td><td>${esc(r.condition || '保持原值')}</td></tr>`).join('');
  rosterPreviewBox.innerHTML = `${status}${sameNameHtml}${errorHtml}${missingHtml}<div class="row between roster-preview-head"><div class="small">文件：${esc(d.filename || '')} · 工作表：${esc(d.sheet_name || '')} · 有效 ${d.valid_count || 0} 人</div><div class="row roster-action-buttons"><button class="btn" id="confirmRosterImport" type="button" ${d.ready_for_full_import ? '' : 'disabled'}>更新现有名单（保留数据）</button></div></div><div class="notice roster-mode-note"><strong>数据安全：</strong>当前版本只允许更新姓名校验/年级/组别，不删除 S01–S30 已有任务、作品、聊天和图片。</div><div class="table-wrap roster-preview-table"><table class="admin-table"><thead><tr><th>编号</th><th>姓名</th><th>年级</th><th>condition</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="4">没有识别到有效学生</td></tr>'}</tbody></table></div><p class="small">隐私说明：这里显示姓名只是为了老师导入前核对；确认后平台只保存姓名哈希，原Excel/CSV文件不会保存。</p>`;
  const confirmBtn = document.getElementById('confirmRosterImport');
  if (confirmBtn && d.ready_for_full_import) confirmBtn.onclick = confirmRosterImport;
}

async function confirmRosterImport() {
  if (!rosterPreviewData?.ready_for_full_import) return;
  const btn = document.getElementById('confirmRosterImport');
  btn.disabled = true;
  btn.textContent = '正在导入…';
  try {
    const payloadRows = rosterPreviewData.rows.map(r => ({
      participant_id: r.participant_id,
      login_name: r.login_name,
      grade: r.grade,
      condition: r.condition,
    }));
    const r = await api('/participants/roster-import', { method: 'POST', body: JSON.stringify({ rows: payloadRows }) });
    rosterPreviewBox.innerHTML = `<div class="notice roster-ready"><strong>名单导入完成：</strong>${r.imported_count} 人。姓名明文没有保存，学生现在可用“编号 + 姓名”登录。</div>`;
    rosterPreviewData = null;
    rosterFile.value = '';
    document.getElementById('rosterFileName').textContent = '已完成导入';
    await loadParticipants();
  } catch (x) {
    btn.disabled = false;
    btn.textContent = '确认导入30人';
    alert(x.message);
  }
}

async function replaceRosterImport() {
  if (!rosterPreviewData?.ready_for_full_import) return;
  const first = confirm(`这是“换一批学生”操作：会清空 S01–S30 现有任务文字、作品、AI聊天和相关图片，再导入当前30人。S00不会清空。

如果旧数据需要保留，请先到“数据导出”下载备份。

确定继续吗？`);
  if (!first) return;
  const typed = prompt('为防止误操作，请输入：更换名单');
  if (typed !== '更换名单') { alert('没有输入正确确认文字，已取消。'); return; }
  const btn = document.getElementById('replaceRosterImport');
  btn.disabled = true;
  btn.textContent = '正在清空旧数据并导入…';
  try {
    const payloadRows = rosterPreviewData.rows.map(r => ({
      participant_id: r.participant_id,
      login_name: r.login_name,
      grade: r.grade,
      condition: r.condition,
    }));
    const r = await api('/participants/roster-replace', { method: 'POST', body: JSON.stringify({ rows: payloadRows, confirm: 'REPLACE S01-S30' }) });
    rosterPreviewBox.innerHTML = `<div class="notice roster-ready"><strong>整批学生更换完成：</strong>${r.imported_count} 人。旧 S01–S30 活跃任务/作品/聊天/图片已清空，S00 保留；为防止旧页面继续写入，当前课次已自动关闭，请确认无误后再到“课堂设置”重新开放。</div>`;
    rosterPreviewData = null;
    rosterFile.value = '';
    document.getElementById('rosterFileName').textContent = '已完成整批更换';
    await loadSettings();
    await loadParticipants();
  } catch (x) {
    btn.disabled = false;
    btn.textContent = '更换整批学生（清空旧数据）';
    alert(x.message);
  }
}

document.getElementById('bulkBtn').onclick = async () => {
  const r = await api('/participants/bulk-meta', { method: 'POST', body: JSON.stringify({ text: document.getElementById('bulkText').value }) });
  const bad = r.result.filter(x => x.status !== 'ok');
  alert(`处理 ${r.result.length} 行${bad.length ? `，${bad.length} 行无效` : ''}`);
  await loadParticipants();
};

const randomBtn=document.getElementById('stratifiedRandomize');
if(randomBtn) randomBtn.onclick=async()=>{
  const formalRows=rows.filter(x=>!x.is_test);
  const missing=formalRows.filter(x=>!['6','7','8'].includes(String(x.grade||'').trim())).map(x=>x.participant_id);
  if(missing.length){ alert(`请先补全年级信息：${missing.join('、')}`); return; }
  if(!confirm('确认按年级（6/7/8）分层随机分配A/B吗？\n\n该功能留给W3正式主项目前使用。W2共同AI试用任务不需要分组。系统会保存本次分组快照。')) return;
  const typed=prompt('为防止误操作，请输入：RANDOMIZE W2','');
  if(typed!=='RANDOMIZE W2'){ alert('输入不一致，已取消。'); return; }
  try{
    randomBtn.disabled=true; randomBtn.textContent='正在随机分组…';
    const r=await api('/participants/stratified-randomize',{method:'POST',body:JSON.stringify({confirm:typed})});
    alert(`分组完成：A组 ${r.totals.A} 人，B组 ${r.totals.B} 人。`);
    await loadParticipants();
  }catch(x){ alert(x.message); }
  finally{ randomBtn.disabled=false; randomBtn.textContent='按年级分层随机分组 A/B'; }
};

function badge(v, t = '已完成') { return v ? `<span class="badge">${t}</span>` : '—'; }

async function loadParticipants() {
  rows = await api('/participants');
  const formal = rows.filter(x => !x.is_test), sid = settings?.active_session_id || '';
  document.getElementById('currentTitle').textContent = `${sid} 课堂数据总览`;
  const stats = [
    ['正式学生', formal.length],
    ['姓名校验已设置', formal.filter(x => x.login_name_ready).length],
    ['已进入任务', formal.filter(x => x.started).length],
    ['打开过AI', formal.filter(x => x.first_ai_open_latency_seconds != null).length],
    ['发过AI消息', formal.filter(x => x.ai_used).length],
    ['聊天图片', formal.reduce((n, x) => n + (x.chat_image_count || 0), 0)],
    ['已提交', formal.filter(x => x.submitted).length],
  ];
  document.getElementById('summary').innerHTML = stats.map(([k, v]) => `<div class="summary-card"><strong>${v}</strong><span>${k}</span></div>`).join('');
  const rosterReady = formal.filter(x => x.login_name_ready).length;
  const rosterNotice = rosterReady === formal.length
    ? `<div class="notice roster-ready"><strong>姓名校验名单已就绪：</strong>${rosterReady}/${formal.length}。学生需要“编号 + 姓名”同时匹配才能进入。</div>`
    : `<div class="notice warn roster-warning"><strong>上课前还要完成姓名校验名单：</strong>目前 ${rosterReady}/${formal.length} 已设置。未设置姓名的正式编号将无法登录。</div>`;
  document.getElementById('participantTable').innerHTML = `${rosterNotice}<div class="table-wrap"><table class="admin-table"><thead><tr><th>编号</th><th>姓名校验</th><th>年级</th><th>condition</th><th>进入任务</th><th>首次打开AI</th><th>首次发消息</th><th>学生消息</th><th>聊天图片</th><th>任务图片</th><th>提交</th><th>操作</th></tr></thead><tbody>${rows.map(x => `<tr data-id="${x.participant_id}" class="p-row ${selectedParticipantId === x.participant_id ? 'selected-row' : ''}"><td><button class="participant-link view-detail" data-id="${x.participant_id}" type="button"><strong>${x.participant_id}</strong></button>${x.is_test ? ' <span class="badge">测试</span>' : ''}</td><td>${x.is_test ? '<span class="small">S00免校验</span>' : (x.login_name_ready ? '<span class="badge">已设置</span>' : '<span class="small warn-text">未设置</span>')}</td><td>${esc(x.grade || '')}</td><td>${esc(x.condition)}</td><td>${badge(x.started)}</td><td>${fmtSeconds(x.first_ai_open_latency_seconds)}</td><td>${fmtSeconds(x.first_user_message_latency_seconds)}</td><td>${x.user_turn_count}</td><td>${x.chat_image_count || 0}</td><td>${x.artifact_count || 0}</td><td>${badge(x.submitted)}</td><td class="reset-cell"><div class="row action-row"><button class="btn ghost mini view-detail" data-id="${x.participant_id}" type="button">查看记录</button><button class="btn danger ghost mini reset-current" data-id="${x.participant_id}" type="button">重置本课次</button></div></td></tr>`).join('')}</tbody></table></div>`;
  document.querySelectorAll('.p-row').forEach(tr => tr.onclick = e => {
    if (e.target.closest('button')) return;
    selectLiveParticipant(tr.dataset.id, true);
    detail(tr.dataset.id, true);
  });
  document.querySelectorAll('.view-detail').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    selectLiveParticipant(btn.dataset.id, true);
    detail(btn.dataset.id, true);
  });
  document.querySelectorAll('.reset-current').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    resetOne(btn.dataset.id, sid);
  });
  renderLiveParticipantList();
}


const liveStatusMeta = status => ({
  not_started:['未进入','muted'], working:['任务中','working'], ai_open:['已打开AI','aiopen'],
  typing:['正在输入','typing'], draft_cancelled:['取消发送','draftcancel'], draft_left:['草稿未发','draftleft'],
  processing:['AI处理中','processing'], replied:['已回复','replied'], error:['异常','error'], submitted:['已提交','submitted'],
}[status] || ['—','muted']);

function refreshClockText(iso){
  if(!iso) return '';
  const d=new Date(iso); if(Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function setLiveRefreshState(text, cls=''){
  const el=document.getElementById('liveRefreshState'); if(!el) return;
  el.className=`live-refresh-state ${cls}`.trim();
  el.textContent=text;
}

function renderLiveParticipantList(){
  const box=document.getElementById('liveParticipantList');
  if(!box) return;
  const oldScroll=box.scrollTop;
  const ordered=[...rows].sort((a,b)=>{
    if(a.is_test&&!b.is_test) return -1;
    if(!a.is_test&&b.is_test) return 1;
    return String(a.participant_id).localeCompare(String(b.participant_id));
  });
  const formalCount=ordered.filter(x=>!x.is_test).length;
  const testCount=ordered.filter(x=>x.is_test).length;
  const toolbar=`<div class="live-list-toolbar"><strong>${formalCount}名正式学生${testCount?` + S00测试`:''}</strong><span class="small">上下滚动查看全部账号</span></div>`;
  box.innerHTML=toolbar+(ordered.map(x=>{
    const [label,cls]=liveStatusMeta(x.live_status);
    const gradeText=x.is_test?'测试账号':`${esc(x.grade||'—')}年级`;
    const testBadge=x.is_test?' <span class="badge test-badge">测试</span>':'';
    const preview=x.last_student_message_preview?`<div class="live-preview">${esc(x.last_student_message_preview)}</div>`:'';
    return `<button class="live-student ${x.is_test?'test-account ':''}${liveSelectedParticipantId===x.participant_id?'selected':''}" data-id="${x.participant_id}" type="button"><div class="live-student-top"><strong>${x.participant_id}${testBadge}</strong><span class="live-status ${cls}">${label}</span></div><div class="live-student-meta"><span>${gradeText}</span><span>${x.user_turn_count||0}轮</span><span>${x.task_field_label?esc(x.task_field_label):'—'}</span></div>${preview}</button>`;
  }).join('') || '<div class="small">暂无学生</div>');
  box.scrollTop=oldScroll;
  box.querySelectorAll('.live-student').forEach(btn=>btn.onclick=()=>selectLiveParticipant(btn.dataset.id));
}

function liveMessageHtml(id,sid,m){
  const who=m.role==='assistant'?'AI':'学生';
  const stage=m.task_field_label?` · ${esc(m.task_field_label)}`:'';
  const latency=m.role==='assistant'&&m.ai_latency_ms!=null?` · ${(Number(m.ai_latency_ms)/1000).toFixed(1)}s`:'';
  const failed=m.request_failed?' · 请求失败':'';
  return `<div class="live-bubble ${m.role==='assistant'?'assistant':'user'}"><div class="live-msg-meta"><strong>${who}</strong><span>${esc(m.created_at||'')}${stage}${latency}${failed}</span></div><div class="live-msg-text">${esc(m.content||'')}</div>${(m.attachments||[]).length?`<div class="photo-grid chat-photos">${m.attachments.map(a=>chatImage(id,sid,a)).join('')}</div>`:''}</div>`;
}

function liveActivityRows(){
  const rows=[];
  const labelForEvent=(e)=>{
    const d=e?.data||{};
    const secs=d.duration_ms!=null?`${(Number(d.duration_ms)/1000).toFixed(1)}秒`:'';
    const chars=d.max_chars||d.current_chars||d.initial_chars||0;
    switch(e.type){
      case 'ai_draft_started': return ['开始输入AI问题', chars?`当前/初始 ${chars} 字`: ''];
      case 'ai_draft_deleted_unsent': return ['删除未发送', [chars?`最多 ${chars} 字`:'',secs,d.edit_count?`编辑 ${d.edit_count} 次`:''].filter(Boolean).join(' · ')];
      case 'ai_draft_left_unsent': return ['草稿未发送', [chars?`${chars} 字`:'',secs,d.reason?`原因 ${d.reason}`:''].filter(Boolean).join(' · ')];
      case 'ai_draft_sent': return ['发送AI问题', [d.final_chars?`${d.final_chars} 字`:'',secs].filter(Boolean).join(' · ')];
      case 'chat_history_revisit': return ['回看旧AI回复', d.dwell_ms?`停留约 ${(Number(d.dwell_ms)/1000).toFixed(1)}秒`: ''];
      case 'ai_request_started': return ['AI开始处理', d.task_field_label||''];
      case 'ai_request_completed': return ['AI回复完成', d.ai_latency_ms!=null?`${(Number(d.ai_latency_ms)/1000).toFixed(1)}秒`:''];
      case 'ai_request_failed': return ['AI请求异常', d.error||''];
      case 'ai_opened': return ['打开AI助手', ''];
      case 'session_submitted': return ['提交本课次任务', ''];
      case 'task_started': return ['进入本课次任务', ''];
      default: return null;
    }
  };
  for(const e of liveDetailCache.events||[]){
    const meta=labelForEvent(e); if(!meta) continue;
    rows.push({at:e.at||'', kind:'event', title:meta[0], detail:meta[1]||'', index:Number(e.event_index||0)});
  }
  for(const r of liveDetailCache.revisions||[]){
    const detail=[`V${r.field_revision_no||r.revision_index||''}`, r.seconds_since_last_ai_reply!=null&&r.last_ai_message_id?`距AI回复 ${r.seconds_since_last_ai_reply}s`: '', r.save_reason?`保存：${r.save_reason}`:''].filter(Boolean).join(' · ');
    rows.push({at:r.created_at||'', kind:'revision', title:`修改任务字段「${r.field_label||r.field_key||'任务文字'}」`, detail, index:Number(r.revision_index||0)});
  }
  return rows.sort((a,b)=>Date.parse(a.at||0)-Date.parse(b.at||0)).slice(-50);
}
function liveActivityHtml(){
  const list=liveActivityRows();
  return `<div class="live-activity-head"><div><strong>实时行为轨迹</strong><div class="small">只显示可观察事件；未发送草稿正文不保存</div></div></div><div class="live-activity-list">${list.length?list.map(x=>`<div class="live-activity-item ${x.kind}"><div class="live-activity-time">${esc(refreshClockText(x.at)||'—')}</div><div><strong>${esc(x.title)}</strong>${x.detail?`<div class="small">${esc(x.detail)}</div>`:''}</div></div>`).join(''):'<div class="live-empty compact">暂无行为事件。</div>'}</div>`;
}

async function selectLiveParticipant(id, forceScroll=true){
  liveSelectedParticipantId=id;
  liveDetailCache={id,session_id:'',messages:[],events:[],revisions:[]};
  renderLiveParticipantList();
  await loadLiveParticipant(id, forceScroll, true);
}

const maxIdx=(arr,key)=>arr.reduce((m,x)=>Math.max(m,Number(x?.[key]||0)),0);
function mergeByIndex(current, incoming, key){
  const map=new Map((current||[]).map(x=>[Number(x?.[key]||0),x]));
  for(const x of incoming||[]) map.set(Number(x?.[key]||0),x);
  return [...map.values()].sort((a,b)=>Number(a?.[key]||0)-Number(b?.[key]||0));
}

function renderLiveParticipantPane(id,d,forceScroll=false){
  const pane=document.getElementById('liveChatPane'); if(!pane) return;
  const oldScroll=pane.querySelector('.live-chat-messages');
  const nearBottom=oldScroll?oldScroll.scrollHeight-oldScroll.scrollTop-oldScroll.clientHeight<80:true;
  const oldActivity=pane.querySelector('.live-activity-list');
  const activityNearBottom=oldActivity?oldActivity.scrollHeight-oldActivity.scrollTop-oldActivity.clientHeight<60:true;
  const x=d.summary||{};
  const [label,cls]=liveStatusMeta(x.live_status);
  const msgs=liveDetailCache.messages||[];
  pane.innerHTML=`<div class="live-chat-head"><div><div class="row"><strong>${esc(id)}</strong><span class="live-status ${cls}">${label}</span></div><div class="small">${esc(d.session_id||'')} · 学生消息 ${x.user_turn_count||0} · AI回复 ${x.assistant_turn_count||0}${x.task_field_label?` · 当前/最近：${esc(x.task_field_label)}`:''}</div></div><button class="btn ghost mini open-full-detail" data-id="${esc(id)}" type="button">13周完整记录</button></div><div class="live-detail-body"><div class="live-chat-messages">${msgs.length?msgs.map(m=>liveMessageHtml(id,d.session_id,m)).join(''):'<div class="live-empty">当前课次还没有AI对话。</div>'}${x.processing?'<div class="live-thinking"><span class="spinner-inline"></span>AI正在处理学生刚刚发送的问题…</div>':''}</div><aside class="live-activity-panel">${liveActivityHtml()}</aside></div>`;
  pane.querySelector('.open-full-detail')?.addEventListener('click',()=>detail(id,true));
  const sc=pane.querySelector('.live-chat-messages'); if(sc&&(forceScroll||nearBottom)) sc.scrollTop=sc.scrollHeight;
  const ac=pane.querySelector('.live-activity-list'); if(ac&&activityNearBottom) ac.scrollTop=ac.scrollHeight;
}

async function loadLiveParticipant(id=liveSelectedParticipantId, forceScroll=false, reset=false){
  if(!id) return;
  const pane=document.getElementById('liveChatPane'); if(!pane) return;
  if(reset||liveDetailCache.id!==id) liveDetailCache={id,session_id:'',messages:[],events:[],revisions:[]};
  const afterMessage=maxIdx(liveDetailCache.messages,'message_index');
  const afterEvent=maxIdx(liveDetailCache.events,'event_index');
  const afterRevision=maxIdx(liveDetailCache.revisions,'revision_index');
  try{
    const d=await api(`/live/${id}?afterMessage=${afterMessage}&afterEvent=${afterEvent}&afterRevision=${afterRevision}`);
    if(liveDetailCache.session_id && liveDetailCache.session_id!==d.session_id){
      liveDetailCache={id,session_id:d.session_id,messages:[],events:[],revisions:[]};
      return loadLiveParticipant(id,forceScroll,true);
    }
    liveDetailCache.session_id=d.session_id||liveDetailCache.session_id;
    liveDetailCache.messages=mergeByIndex(liveDetailCache.messages,d.chat_messages,'message_index');
    liveDetailCache.events=mergeByIndex(liveDetailCache.events,d.events,'event_index');
    liveDetailCache.revisions=mergeByIndex(liveDetailCache.revisions,d.revisions,'revision_index');
    renderLiveParticipantPane(id,d,forceScroll);
  }catch(e){ pane.innerHTML=`<div class="notice warn">实时对话读取失败：${esc(e.message)}</div>`; }
}

function mergeLiveStatuses(payload){
  const map=new Map(rows.map(x=>[x.participant_id,x]));
  for(const x of payload?.rows||[]){
    const current=map.get(x.participant_id);
    if(current) Object.assign(current,x); else rows.push(x);
  }
}

async function refreshLiveMonitor(){
  if(!liveAutoRefresh||document.hidden) return;
  if(liveRefreshing){ liveRefreshQueued=true; setLiveRefreshState('上一轮仍在刷新，已排队下一次…','busy'); return; }
  liveRefreshing=true;
  const btn=document.getElementById('liveRefresh'); if(btn){btn.disabled=true;btn.textContent='刷新中…';}
  setLiveRefreshState('正在轻量刷新…','busy');
  try{
    const fresh=await api('/live-statuses');
    mergeLiveStatuses(fresh);
    renderLiveParticipantList();
    if(liveSelectedParticipantId) await loadLiveParticipant(liveSelectedParticipantId,false,false);
    liveLastRefreshAt=fresh?.server_time||new Date().toISOString();
    setLiveRefreshState(`已更新 ${refreshClockText(liveLastRefreshAt)} · 下一次约4秒后`,'ok');
  }catch(e){
    setLiveRefreshState(`刷新失败：${e.message}`,'error');
  } finally {
    liveRefreshing=false;
    if(btn){btn.disabled=false;btn.textContent='立即刷新';}
    if(liveRefreshQueued){ liveRefreshQueued=false; setTimeout(()=>refreshLiveMonitor(),60); }
  }
}
function scheduleLiveTimer(){
  if(liveTimer) clearTimeout(liveTimer);
  if(!liveAutoRefresh) return;
  liveTimer=setTimeout(async()=>{ await refreshLiveMonitor(); scheduleLiveTimer(); },LIVE_POLL_MS);
}
function startLiveTimer(){
  if(liveTimer) clearTimeout(liveTimer);
  refreshLiveMonitor().finally(scheduleLiveTimer);
}

document.getElementById('liveRefresh')?.addEventListener('click',async()=>{
  if(liveTimer) clearTimeout(liveTimer);
  const old=liveAutoRefresh; liveAutoRefresh=true;
  await refreshLiveMonitor();
  liveAutoRefresh=old;
  if(liveAutoRefresh) scheduleLiveTimer();
});
document.getElementById('liveToggle')?.addEventListener('click',e=>{
  liveAutoRefresh=!liveAutoRefresh;
  e.currentTarget.textContent=liveAutoRefresh?'暂停自动刷新':'继续自动刷新';
  if(liveAutoRefresh){ refreshLiveMonitor().finally(scheduleLiveTimer); }
  else { if(liveTimer) clearTimeout(liveTimer); liveTimer=null; setLiveRefreshState('自动刷新已暂停'); }
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){ if(liveTimer) clearTimeout(liveTimer); liveTimer=null; }
  else if(liveAutoRefresh){ refreshLiveMonitor().finally(scheduleLiveTimer); }
});

async function loadHistorySummary(){
  const box=document.getElementById('historySummary'); if(!box) return;
  try{
    const data=await api('/history-summary');
    box.innerHTML=data.map(x=>`<div class="history-session-card ${settings?.active_session_id===x.session_id?'current':''}"><div class="row between"><strong>${x.session_id}</strong><span class="small">${esc(x.title||'')}</span></div><div class="history-metrics"><span>进入 <b>${x.started}</b></span><span>用AI <b>${x.ai_used}</b></span><span>学生消息 <b>${x.user_messages}</b></span><span>提交 <b>${x.submitted}</b></span></div></div>`).join('');
  }catch(e){ box.innerHTML=`<div class="notice warn">历史课次读取失败：${esc(e.message)}</div>`; }
}
document.getElementById('refreshHistory')?.addEventListener('click',loadHistorySummary);

async function runDiagnostics(){
  const box=document.getElementById('diagnosticResult');
  box.innerHTML='<div class="detail-loading"><span class="spinner-inline"></span>正在只读检查存储…</div>';
  try{
    const d=await api('/storage-diagnostics');
    const sessions=Object.entries(d.by_session||{}).map(([sid,x])=>`<tr><td>${sid}</td><td>${x.records}</td><td>${x.messages}</td><td>${x.events}</td><td>${x.revisions}</td></tr>`).join('');
    const archives=(d.recent_reset_archives||[]).map(a=>`<div class="archive-row"><div><strong>${esc(a.participant_id)} ${esc(a.session_id)}</strong><div class="small">${esc(a.archived_at||'')} · ${esc(a.reason||'')}</div></div><button class="btn ghost mini restore-archive" data-key="${esc(a.key)}" data-id="${esc(a.participant_id)}" data-sid="${esc(a.session_id)}" type="button">恢复到空课次</button></div>`).join('');
    box.innerHTML=`<div class="notice"><strong>当前存储：</strong><code>${esc(d.storage?.root_prefix||'')}</code><br><span class="small">Blob：${esc(d.storage?.blob_store_name||'—')} · 对象总数 ${d.object_count} · 可恢复重置归档 ${d.reset_archive_count}</span></div><div class="table-wrap"><table class="admin-table"><thead><tr><th>课次</th><th>record</th><th>messages</th><th>events</th><th>revisions</th></tr></thead><tbody>${sessions}</tbody></table></div>${archives?`<h4>最近可恢复归档</h4><div class="archive-list">${archives}</div>`:'<p class="small">当前没有通过后台“重置”产生的可恢复归档。</p>'}`;
    box.querySelectorAll('.restore-archive').forEach(btn=>btn.onclick=async()=>{
      const id=btn.dataset.id,sid=btn.dataset.sid;
      const typed=prompt(`只会在 ${id} ${sid} 当前为空时恢复。请输入：RESTORE ${id} ${sid}`,'');
      if(typed!==`RESTORE ${id} ${sid}`) return;
      try{ await api('/restore-reset-archive',{method:'POST',body:JSON.stringify({archive_key:btn.dataset.key,confirm:typed})}); alert(`已恢复 ${id} ${sid}`); await loadParticipants(); await loadHistorySummary(); await runDiagnostics(); }
      catch(e){alert(e.message);}
    });
  }catch(e){box.innerHTML=`<div class="notice warn">诊断失败：${esc(e.message)}</div>`;}
}
document.getElementById('runDiagnostics')?.addEventListener('click',runDiagnostics);

async function resetOne(id, sid) {
  const ok = confirm(`确定重置 ${id} 的 ${sid} 记录吗？\n\n会清空该课次当前的进入时间、AI时间、聊天、任务文字、提交状态和作品引用。重置前会自动保存后台归档。`);
  if (!ok) return;
  try {
    const r = await api(`/participant/${id}/session/${sid}/reset`, { method: 'POST', body: JSON.stringify({ confirm: `${id}:${sid}` }) });
    alert(r.archived_previous ? '已重置，并保存了重置前归档。' : '该学生本课次没有活动数据，已保持为空。');
    await loadParticipants();
    if (selectedParticipantId === id) await detail(id, false);
  } catch (x) { alert(x.message); }
}

async function resetAllCurrent() {
  const sid = settings?.active_session_id;
  if (!sid) return;
  const first = confirm(`这是批量操作：将重置 ${sid} 的 S00–S30 当前课次记录。\n\n适合正式上课前清除测试/误触数据。每个有活动的数据都会先自动归档。是否继续？`);
  if (!first) return;
  const typed = prompt(`为防止误删，请输入：RESET ${sid}`, '');
  if (typed !== `RESET ${sid}`) { alert('输入不一致，已取消。'); return; }
  try {
    const r = await api(`/session/${sid}/reset-all`, { method: 'POST', body: JSON.stringify({ confirm: typed }) });
    alert(`已重置 ${sid}。共处理 ${r.reset_count} 个编号，其中 ${r.archived_count} 个在重置前保存了归档。`);
    selectedParticipantId = '';
    await loadParticipants();
    document.getElementById('detail').innerHTML = '<span class="eyebrow">学生完整记录</span><h2>点击上方学生编号或“查看记录”</h2><p class="small">可逐课查看文字记录、作品图片、AI聊天、AI聊天图片和系统事件。</p>';
  } catch (x) { alert(x.message); }
}
document.getElementById('resetCurrentAll').onclick = resetAllCurrent;

function taskImage(id, sid, key, p, label = '') {
  if (!p) return '';
  const href = `/express/api/image/${encodeURIComponent(id)}/${encodeURIComponent(sid)}/${encodeURIComponent(key)}/${encodeURIComponent(p.file_name)}`;
  return `<figure class="record-figure"><a target="_blank" href="${href}"><img src="${href}" alt="${esc(label || '任务作品')}"></a>${label ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`;
}
function chatImage(id, sid, a) {
  if (!a?.file_name) return '';
  const href = `/express/api/chat-image/${encodeURIComponent(id)}/${encodeURIComponent(sid)}/${encodeURIComponent(a.file_name)}`;
  return `<a target="_blank" href="${href}"><img src="${href}" alt="聊天图片"></a>`;
}
function messages(id, sid, arr = []) {
  return arr.map(m => `<div class="answer-block chat-record ${m.role === 'assistant' ? 'assistant-record' : 'student-record'}"><div><strong>${m.role === 'assistant' ? 'AI' : '学生'} · 第${m.message_index || '—'}条</strong><span class="small"> · ${esc(m.created_at || '')}</span></div><div class="record-text">${esc(m.content || '')}</div>${(m.attachments || []).length ? `<div class="photo-grid chat-photos">${m.attachments.map(a => chatImage(id, sid, a)).join('')}</div>` : ''}</div>`).join('') || '<p class="small empty-record">暂无聊天记录</p>';
}
function events(arr = []) {
  return arr.length ? `<details><summary class="small">查看系统事件（${arr.length}）</summary><pre>${esc(JSON.stringify(arr, null, 2))}</pre></details>` : '';
}
function revisions(arr = []) {
  return arr.length ? `<details><summary class="small">查看任务文本版本历史（${arr.length}）</summary><pre>${esc(JSON.stringify(arr, null, 2))}</pre></details>` : '';
}
function sessionHasData(x) {
  const r = x?.record || {};
  return Boolean(r.started_at || r.saved_at || r.submitted_at || x?.chat_session || (x?.chat_messages || []).length || (x?.events || []).length || (x?.revisions || []).length || Object.keys(r.artifacts || {}).length || Object.keys(r.text_fields || {}).length);
}

async function detail(id, scroll = false) {
  selectedParticipantId = id;
  const detailBox = document.getElementById('detail');
  detailBox.dataset.participantId = id;
  detailBox.innerHTML = `<span class="eyebrow">学生完整记录</span><h2>${esc(id)}</h2><div class="detail-loading"><span class="spinner-inline"></span>正在读取13周文字、作品、问卷和AI对话……</div>`;
  if (scroll) detailBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const d = await api(`/participant/${id}`);
    const sessionHtml = sessions.map(s => {
      const x = d.sessions?.[s.id] || { record: {}, chat_session: null, chat_messages: [], events: [], revisions: [] };
      const r = x.record || {};
      const arts = Object.entries(r.artifacts || {});
      const fieldLabels = Object.fromEntries((s.fields || []).map(f => [f.key, f.label]));
      const artifactLabels = Object.fromEntries((s.artifacts || []).map(a => [a.key, a.label]));
      const textEntries = Object.entries(r.text_fields || {}).filter(([, v]) => String(v || '').trim());
      const chatImages = (x.chat_messages || []).filter(m => m.message_has_image).length;
      const hasData = sessionHasData(x);
      const shouldOpen = hasData || s.id === settings?.active_session_id;
      return `<details class="answer-block session-detail ${hasData ? 'has-data' : 'no-data'}" ${shouldOpen ? 'open' : ''}><summary><strong>${s.id} ${esc(s.title)}</strong> ${hasData ? '<span class="badge">有记录</span>' : '<span class="small">暂无记录</span>'} ${r.submitted_at ? '<span class="badge">已提交</span>' : ''}</summary><p class="small">AI变体：${esc(r.ai_variant || x.chat_session?.ai_variant || '—')} ｜首次打开：${fmtSeconds(r.first_ai_open_latency_seconds)} ｜首次发消息：${fmtSeconds(r.first_user_message_latency_seconds)} ｜打开次数：${r.ai_open_count || 0} ｜聊天图片：${chatImages} ｜文本版本：${(x.revisions||[]).length}</p><h4>任务文字记录</h4>${textEntries.length ? textEntries.map(([k, v]) => `<div class="record-field"><strong>${esc(fieldLabels[k] || k)}</strong><div class="record-text">${esc(v)}</div></div>`).join('') : '<p class="small empty-record">暂无任务文字记录</p>'}<h4>任务作品 / 证据图片</h4>${arts.length ? `<div class="photo-grid">${arts.map(([k, p]) => taskImage(id, s.id, k, p, artifactLabels[k] || k)).join('')}</div>` : '<p class="small empty-record">暂无任务作品图片</p>'}<h4>AI聊天</h4>${messages(id, s.id, x.chat_messages)}${revisions(x.revisions||[])}${events(x.events)}<div class="row" style="margin-top:12px"><button class="btn danger ghost mini reset-session-detail" data-id="${id}" data-sid="${s.id}" type="button">重置这一课次</button></div></details>`;
    }).join('');

    detailBox.innerHTML = `<div class="row between detail-heading"><div><span class="eyebrow">学生完整数据</span><h2>${id}${d.participant.is_test ? ' · S00测试号' : ''}</h2><p class="small">已读取该编号13周的任务文字、作品图片、问卷、AI完整对话、聊天图片、任务文本版本历史和时间戳。有数据的课次会自动展开。</p></div><button class="btn ghost mini" id="refreshDetail" type="button">刷新此学生记录</button></div>
      <div class="section"><h3>基本信息</h3><div class="grid two"><label>年级<input id="grade" value="${esc(d.participant.grade || '')}"></label><label>condition<select id="condition"><option value="unassigned">unassigned</option><option value="A">A · 支持型AI</option><option value="B">B · 自由AI</option></select></label></div>${d.participant.is_test ? '<p class="small">S00 是教师测试号，不要求姓名校验。</p>' : `<label class="name-reset-label">登录姓名校验 <span class="small">${d.participant.login_name_hash ? '已设置。出于隐私，系统不保存也不显示姓名明文；如需更正，在下框重新输入。' : '尚未设置，学生现在无法用该编号登录。'}</span><input id="loginName" placeholder="输入姓名后保存；留空表示不修改" autocomplete="off"></label>`}<button class="btn secondary" id="saveMeta">保存</button></div>
      <div class="section"><h3>问卷</h3><div class="grid two"><div class="answer-block"><strong>W8后测（当前正式分析）</strong><p class="small">${d.questionnaires?.post?.submitted_at?`已提交：${esc(d.questionnaires.post.submitted_at)}｜IHS=${esc(d.questionnaires.post.scores?.instrumental_mean??'')} EHS=${esc(d.questionnaires.post.scores?.executive_mean??'')} AHS=${esc(d.questionnaires.post.scores?.avoidance_mean??'')}`:'未提交'}</p></div><div class="answer-block"><strong>历史前测（如曾测试）</strong><p class="small">${d.questionnaires?.pre?.submitted_at?`保留但不进入当前正式分析：${esc(d.questionnaires.pre.submitted_at)}`:'无'}</p></div></div></div><div class="section"><h3>13周完整记录</h3>${sessionHtml}</div>`;
    document.getElementById('condition').value = d.participant.condition || 'unassigned';
    document.getElementById('refreshDetail').onclick = () => detail(id, false);
    document.getElementById('saveMeta').onclick = async () => {
      const payload = { grade: document.getElementById('grade').value, condition: document.getElementById('condition').value };
      const loginNameInput = document.getElementById('loginName');
      if (loginNameInput && loginNameInput.value.trim()) payload.login_name = loginNameInput.value.trim();
      await api(`/participant/${id}/meta`, { method: 'POST', body: JSON.stringify(payload) });
      await loadParticipants();
      await detail(id, false);
    };
    document.querySelectorAll('.reset-session-detail').forEach(btn => btn.onclick = () => resetOne(btn.dataset.id, btn.dataset.sid));
    document.querySelectorAll('.p-row').forEach(tr => tr.classList.toggle('selected-row', tr.dataset.id === id));
  } catch (e) {
    detailBox.innerHTML = `<span class="eyebrow">学生完整记录</span><h2>${esc(id)}</h2><div class="notice warn"><strong>读取失败：</strong>${esc(e.message)}<br><span class="small">请点击下面按钮重试；如果仍失败，再查看部署日志。</span></div><button class="btn secondary" id="retryDetail" type="button">重新读取</button>`;
    document.getElementById('retryDetail').onclick = () => detail(id, false);
  }
}

check();
