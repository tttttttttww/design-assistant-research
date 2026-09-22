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
const esc = App.escapeHtml;
const fmtSeconds = v => v == null ? '—' : v < 60 ? `${v}s` : `${Math.floor(v / 60)}m ${v % 60}s`;

async function check() {
  try {
    await api('/settings');
    showApp();
    await loadSettings();
    await loadParticipants();
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
  rosterPreviewBox.innerHTML = `${status}${sameNameHtml}${errorHtml}${missingHtml}<div class="row between roster-preview-head"><div class="small">文件：${esc(d.filename || '')} · 工作表：${esc(d.sheet_name || '')} · 有效 ${d.valid_count || 0} 人</div><div class="row roster-action-buttons"><button class="btn" id="confirmRosterImport" type="button" ${d.ready_for_full_import ? '' : 'disabled'}>更新现有名单（保留数据）</button><button class="btn danger" id="replaceRosterImport" type="button" ${d.ready_for_full_import ? '' : 'disabled'}>更换整批学生（清空旧数据）</button></div></div><div class="notice roster-mode-note"><strong>两种导入方式：</strong>“更新现有名单”只改姓名校验/年级/组别，保留 S01–S30 已有任务、作品和聊天；“更换整批学生”会清空 S01–S30 现有任务、作品、聊天和图片，再导入这30人，S00 不受影响。</div><div class="table-wrap roster-preview-table"><table class="admin-table"><thead><tr><th>编号</th><th>姓名</th><th>年级</th><th>condition</th></tr></thead><tbody>${rowsHtml || '<tr><td colspan="4">没有识别到有效学生</td></tr>'}</tbody></table></div><p class="small">隐私说明：这里显示姓名只是为了让老师导入前核对；确认后平台只保存姓名哈希，原Excel/CSV文件不会保存。</p>`;
  const confirmBtn = document.getElementById('confirmRosterImport');
  const replaceBtn = document.getElementById('replaceRosterImport');
  if (confirmBtn && d.ready_for_full_import) confirmBtn.onclick = confirmRosterImport;
  if (replaceBtn && d.ready_for_full_import) replaceBtn.onclick = replaceRosterImport;
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
    detail(tr.dataset.id, true);
  });
  document.querySelectorAll('.view-detail').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    detail(btn.dataset.id, true);
  });
  document.querySelectorAll('.reset-current').forEach(btn => btn.onclick = e => {
    e.stopPropagation();
    resetOne(btn.dataset.id, sid);
  });
}

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
