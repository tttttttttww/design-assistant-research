const id = App.requireParticipant();
const switchStudentBtn = document.getElementById('switchStudent');
if (switchStudentBtn) switchStudentBtn.onclick = () => {
  if (!confirm('确定退出当前学生编号吗？已自动保存的记录不会丢失。')) return;
  App.clearParticipant();
  location.href = '/';
};
let state = null, chatOpened = false, sending = false, selectedChatImage = null, selectedChatImageUrl = '';
let autoSaveTimer = null;
let saveChain = Promise.resolve();

const esc = App.escapeHtml;
const fmtLatency = v => v == null ? '—' : `${Math.floor(v/60)}分${v%60}秒`;

// 表单草稿与 AI 聊天必须彼此独立：AI 更新时绝不能重建/清空学生正在填写的任务记录。
function draftKey(){ return state?.session?.id ? `task_draft:${id}:${state.session.id}` : ''; }
function readLocalDraft(){
  try { const key=draftKey(); return key ? (JSON.parse(sessionStorage.getItem(key)||'{}')||{}) : {}; }
  catch { return {}; }
}
function writeLocalDraft(fields){
  try { const key=draftKey(); if(key) sessionStorage.setItem(key, JSON.stringify(fields||{})); } catch {}
}
function clearLocalDraft(){ try { const key=draftKey(); if(key) sessionStorage.removeItem(key); } catch {} }
function displayTextFields(){ return { ...(state?.record?.text_fields||{}), ...readLocalDraft() }; }
function updateChatMeta(){
  const meta=document.getElementById('chatMeta');
  if(meta && state?.participant?.is_test){
    meta.textContent=`S00测试数据｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}`;
  }
}

function chatImageUrl(meta){
  return meta?.file_name ? `/express/api/chat-image/${encodeURIComponent(id)}/${encodeURIComponent(state.session.id)}/${encodeURIComponent(meta.file_name)}` : '';
}
function addMessage(role, content, attachments=[]) {
  document.getElementById('emptyChat')?.remove();
  const el = document.createElement('div');
  el.className = `message ${role}`;
  const text = document.createElement('div'); text.textContent = content; el.appendChild(text);
  for(const a of attachments || []){
    const src = a.preview_url || chatImageUrl(a);
    if(!src) continue;
    const img = document.createElement('img'); img.src = src; img.alt = '聊天中发送的图片'; img.className = 'message-image'; el.appendChild(img);
  }
  document.getElementById('messages').appendChild(el);
  document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight;
}
function renderMessages(messages=[]) {
  const box = document.getElementById('messages');
  const requiredOnce = Boolean(state?.session?.ai_use_required_once);
  box.innerHTML = messages.length ? '' : `<div class="empty-chat" id="emptyChat"><h3>${requiredOnce?'完成第一版判断后，和AI真实讨论一次':'需要时再问AI'}</h3><p>${requiredOnce?'请选择一个你真正不确定、最想比较或最需要反馈的点来问；之后是否继续使用由你自己决定。':'本节任务中可以使用AI设计助手，也可以不使用。'}</p></div>`;
  messages.forEach(m => addMessage(m.role, m.content, m.attachments || []));
}
function artifactUrl(a, sid=state.session.id){ return a ? App.photoUrl(id, sid, a.artifact_key, a) : ''; }
function taskCard(s){
  const resources=(s.resources||[]).length ? `<div class="resource-pack"><div class="resource-pack-head"><span class="eyebrow">任务资料包</span><h3>先看共同资料，再开始判断</h3><p class="small">所有同学看到相同资料。先依据资料形成自己的判断；遇到真正不确定的地方，再按本节要求使用AI。</p></div><div class="resource-grid">${s.resources.map(r=>`<article class="resource-card"><h4>${esc(r.title)}</h4><ul>${(r.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}</div></div>` : '';
  return `<section class="task-box"><span class="eyebrow">${esc(s.student_label)}</span><h1>${esc(s.title)}</h1><p class="lead">${esc(s.subtitle)}</p><div class="brief-list">${s.brief.map(x=>`<p>${esc(x)}</p>`).join('')}</div>${resources}<h3>本节要求</h3><ul class="requirements">${s.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function carryCard(carry){
  if(!carry) return '';
  const values = Object.entries(carry.record.text_fields||{}).filter(([,v])=>String(v||'').trim());
  const arts = Object.values(carry.record.artifacts||{});
  return `<details class="card compact"><summary><strong>查看上一阶段保存记录 · ${esc(carry.session.id)} ${esc(carry.session.title)}</strong></summary><div class="section">${values.map(([k,v])=>`<div class="answer-block"><strong>${esc(k)}</strong><p>${esc(v)}</p></div>`).join('')||'<p class="small">上一阶段暂无文字记录。</p>'}${arts.length?`<div class="photo-grid">${arts.map(a=>`<img src="${artifactUrl(a, carry.session.id)}" alt="上一阶段图片">`).join('')}</div>`:''}</div></details>`;
}

function fieldHtml(f, value=''){
  const req = f.required ? '<span class="req">必填</span>' : '<span class="optional">选填</span>';
  if(f.type==='text') return `<label>${esc(f.label)} ${req}<input data-field="${esc(f.key)}" value="${esc(value)}" placeholder="${esc(f.placeholder)}"></label>`;
  return `<label>${esc(f.label)} ${req}<textarea data-field="${esc(f.key)}" placeholder="${esc(f.placeholder)}">${esc(value)}</textarea>${f.helper?`<span class="small">${esc(f.helper)}</span>`:''}</label>`;
}
function artifactHtml(a, meta){
  const src=artifactUrl(meta); const req=a.required?'<span class="req">必交</span>':'<span class="optional">选交</span>';
  return `<div class="upload-card"><strong>${esc(a.label)} ${req}</strong><p class="small">${esc(a.helper)}</p>${src?`<div class="upload-preview"><img src="${src}" alt="已上传"></div>`:''}<div class="row" style="margin-top:12px"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${state.record.submitted_at?'disabled':''}><span class="small" data-upload-status="${esc(a.key)}">${src?'已上传 ✓':''}</span></div></div>`;
}

function chatPanel(){
  if(state.session.ai_mode==='none') return `<section class="card sticky-card"><span class="eyebrow">本节无需AI</span><h2>专注整理与反思</h2><p class="small">本节没有AI对话入口。</p></section>`;
  const variantBlocked=state.ai_variant==='unassigned';
  const variantLabel=state.participant.is_test ? `S00测试预览：${state.ai_variant}` : 'AI设计助手';
  const requiredOnce=Boolean(state.session.ai_use_required_once);
  const policyText=state.session.ai_instruction || '本节任务中可以使用AI设计助手，也可以不使用。';
  return `<section class="card sticky-card ai-card"><div class="row between"><div><span class="eyebrow">${esc(variantLabel)}</span><h2>AI设计助手</h2></div><span class="badge">${requiredOnce?'至少讨论1次':'可选'}</span></div>
    ${variantBlocked?'<div class="notice warn">本课已进入分组阶段，但当前编号还没有分组。请老师先在后台设置 A/B。</div>':`<p class="small">${esc(policyText)}</p>
    <button class="btn secondary" id="openAi">${state.record.first_ai_open_at?'继续使用AI':'打开AI助手'}</button>
    <div id="chatBox" class="chat-embed ${chatOpened?'':'hidden'}">
      ${state.participant.is_test?`<div class="chat-meta small" id="chatMeta">S00测试数据｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}</div>`:''}
      <div class="messages compact-messages" id="messages"></div>
      <div id="thinking" class="spinner hidden">AI正在查看并回复……</div><div id="sendError" class="notice warn hidden"></div>
      <div id="chatImagePreview" class="chat-image-preview hidden"><img id="chatImageThumb" alt="待发送图片"><div><strong>已选择图片</strong><p class="small">请用文字告诉AI你想让它帮你看什么。</p><button type="button" class="btn ghost mini" id="removeChatImage">移除图片</button></div></div>
      <div class="composer-tools"><label class="attach-btn ${state.record.submitted_at?'disabled':''}">＋ 添加草图 / 原型照片<input id="chatImage" type="file" accept="image/jpeg,image/png,image/webp" ${state.record.submitted_at?'disabled':''}></label><span class="small">每次最多1张，≤10MB</span></div>
      <div class="composer-wrap"><textarea id="message" placeholder="输入你现在想问AI的内容……" ${state.record.submitted_at?'disabled':''}></textarea><button class="btn" id="send" ${state.record.submitted_at?'disabled':''}>发送</button></div>
    </div>`}</section>`;
}


function questionnaireHtml(slot){
  const q=state?.questionnaire?.[slot];
  if(!q) return '<div class="notice warn">问卷暂时无法读取，请刷新页面。</div>';
  const scale=q.meta?.scale||[];
  const items=q.items||[];
  return `<section class="card questionnaire-card"><span class="eyebrow">${slot==='pre'?'正式前测':'正式后测'}</span><h1>${esc(q.meta?.title||'学业求助意图问卷')}</h1><p class="lead">${esc(q.meta?.instruction||'请按真实情况作答。')}</p><div class="notice"><strong>请注意：</strong>${slot==='pre'?'完成并提交问卷后才进入正式任务。问卷不用于决定你“好或不好”，也没有标准答案。':'请根据你现在真实的想法作答。没有标准答案。'}</div><form id="questionnaireForm" class="questionnaire-form">${items.map((item,idx)=>`<fieldset class="question-item"><legend>${idx+1}. ${esc(item.text)}</legend><div class="likert-row">${scale.map(opt=>`<label><input type="radio" name="q_${esc(item.id)}" value="${opt.value}" required><span>${opt.value}<small>${esc(opt.label)}</small></span></label>`).join('')}</div></fieldset>`).join('')}<div id="questionnaireError" class="notice warn hidden"></div><button class="btn orange" type="submit">提交${slot==='pre'?'前测':'后测'}问卷</button></form></section>`;
}

async function submitQuestionnaire(slot){
  const form=document.getElementById('questionnaireForm');
  const responses={};
  for(const item of state.questionnaire[slot].items||[]){
    const checked=form.querySelector(`input[name="q_${item.id}"]:checked`);
    if(!checked){ const e=document.getElementById('questionnaireError'); e.textContent='请完成所有题目后再提交。'; e.classList.remove('hidden'); return; }
    responses[item.id]=Number(checked.value);
  }
  if(!confirm(`确认提交${slot==='pre'?'前测':'后测'}问卷吗？提交后不能修改。`)) return;
  try{
    await App.api(`/questionnaire/${slot}`,{method:'POST',body:JSON.stringify({participantId:id,responses})});
    await load();
  }catch(x){ const e=document.getElementById('questionnaireError'); e.textContent=x.message; e.classList.remove('hidden'); }
}

function gateHtml(){
  if(state.task_gate==='questionnaire_pre') return `<div class="single-column-page">${questionnaireHtml('pre')}</div>`;
  if(state.task_gate==='questionnaire_post') return `<div class="single-column-page"><section class="card"><span class="eyebrow">W8正式项目已提交</span><h2>最后一步：完成后测问卷</h2><p>完成后测后，本阶段数据才完整。</p></section>${questionnaireHtml('post')}</div>`;
  if(state.task_gate==='awaiting_assignment') return `<div class="single-column-page"><section class="card"><span class="eyebrow">前测已完成</span><h1>等待老师完成随机分组</h1><p class="lead">请先不要使用其他AI。老师完成分组后，点击下面按钮进入正式任务。</p><button class="btn" id="refreshAssignment">刷新分组状态</button></section></div>`;
  return '';
}

function updateRevealKey(){ return state?.session?.id ? `mid_task_update:${id}:${state.session.id}` : ''; }
function updateIsRevealed(){
  if(!state?.session?.mid_task_update) return true;
  try { if(sessionStorage.getItem(updateRevealKey())==='1') return true; } catch {}
  const vals=displayTextFields();
  return (state.session.fields||[]).filter(f=>f.stage==='after_update').some(f=>String(vals?.[f.key]||'').trim());
}
function taskFieldsHtml(s){
  const vals=displayTextFields();
  const before=(s.fields||[]).filter(f=>f.stage!=='after_update');
  const after=(s.fields||[]).filter(f=>f.stage==='after_update');
  if(!s.mid_task_update || !after.length) return (s.fields||[]).map(f=>fieldHtml(f,vals?.[f.key]??'')).join('');
  const revealed=updateIsRevealed();
  const u=s.mid_task_update;
  const updateCard=`<div class="notice mid-task-update"><span class="eyebrow">任务进行到一半</span><h3>${esc(u.title||'收到新反馈')}</h3><p>${esc(u.intro||'')}</p><button type="button" class="btn secondary" id="revealUpdate" ${revealed?'disabled':''}>${revealed?'新反馈已查看 ✓':esc(u.button||'查看新反馈')}</button><div id="updateContent" class="${revealed?'':'hidden'}" style="margin-top:12px"><ul class="requirements">${(u.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  return `${before.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}${updateCard}<div id="afterUpdateFields" class="${revealed?'':'hidden'}">${after.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}</div>`;
}
async function revealMidTaskUpdate(){
  const u=state?.session?.mid_task_update; if(!u) return;
  const vals=collectFields();
  const missing=(u.after_fields||[]).map(k=>state.session.fields.find(f=>f.key===k)).filter(f=>f && !String(vals[f.key]||'').trim());
  if(missing.length){ alert(`请先完成：${missing[0].label}`); return; }
  try{ await persistCurrentFields({showStatus:true}); }catch{return;}
  try{ sessionStorage.setItem(updateRevealKey(),'1'); }catch{}
  document.getElementById('updateContent')?.classList.remove('hidden');
  document.getElementById('afterUpdateFields')?.classList.remove('hidden');
  const btn=document.getElementById('revealUpdate'); if(btn){btn.disabled=true;btn.textContent='新反馈已查看 ✓';}
  App.api('/session/event',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,type:'mid_task_update_revealed',data:{}})}).catch(()=>{});
}

function render(){
  const s=state.session,r=state.record;
  document.title=`${s.id} ${s.title}`;
  if(state.task_gate){
    document.getElementById('app').innerHTML=`<div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div></div>${gateHtml()}`;
    if(document.getElementById('questionnaireForm')) document.getElementById('questionnaireForm').onsubmit=e=>{e.preventDefault();submitQuestionnaire(state.task_gate==='questionnaire_post'?'post':'pre');};
    if(document.getElementById('refreshAssignment')) document.getElementById('refreshAssignment').onclick=()=>load();
    return;
  }
  document.getElementById('app').innerHTML=`
    <div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div class="row between"><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div>${r.submitted_at?'<span class="badge big">已提交</span>':''}</div></div>
    <div class="course-grid"><div class="course-main">${taskCard(s)}${carryCard(state.carry_from)}
      <section class="card"><span class="eyebrow">我的任务记录</span><h2>边做边记录，最后统一提交</h2><form id="taskForm" class="form">${taskFieldsHtml(s)}<div class="artifact-list">${s.artifacts.map(a=>artifactHtml(a,r.artifacts?.[a.key])).join('')}</div><div id="saveStatus" class="small"></div><div class="row"><button type="button" class="btn secondary" id="saveDraft" ${r.submitted_at?'disabled':''}>保存当前记录</button><button type="submit" class="btn orange" ${r.submitted_at?'disabled':''}>${r.submitted_at?'本节已提交':'提交本节任务'}</button></div></form></section>
    </div><aside class="course-side">${chatPanel()}</aside></div>`;
  wire();
}

function collectFields(){const x={};document.querySelectorAll('[data-field]').forEach(el=>x[el.dataset.field]=el.value);return x;}
function setSaveStatus(text=''){const b=document.getElementById('saveStatus');if(b)b.textContent=text;}
function cancelQueuedAutoSave(){if(autoSaveTimer){clearTimeout(autoSaveTimer);autoSaveTimer=null;}}
async function persistCurrentFields({showStatus=false}={}){
  if(!state?.session || state.record?.submitted_at || !document.querySelector('[data-field]')) return state?.record;
  cancelQueuedAutoSave();
  // 先同步写入浏览器草稿，哪怕网络慢/AI更新，界面也不会丢字。
  const fields=collectFields();
  writeLocalDraft(fields);
  const run=async()=>{
    if(showStatus)setSaveStatus('正在保存……');
    const r=await App.api('/session/save',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:fields})});
    state.record=r.record||state.record;
    if(showStatus)setSaveStatus('已保存 ✓');
    return state.record;
  };
  // 串行保存，防止“自动保存”和“发送AI”同时写 record.json，旧请求覆盖新内容。
  const job=saveChain.then(run,run);
  saveChain=job.catch(()=>{});
  try{return await job;}catch(e){if(showStatus)setSaveStatus(`保存失败：${e.message}`);throw e;}
}
function queueAutoSave(){
  if(state?.record?.submitted_at)return;
  writeLocalDraft(collectFields());
  cancelQueuedAutoSave();
  setSaveStatus('正在自动保存……');
  autoSaveTimer=setTimeout(async()=>{
    try{await persistCurrentFields();setSaveStatus('已自动保存 ✓');}
    catch(e){setSaveStatus(`自动保存失败：${e.message}`);}
  },1000);
}
async function saveDraft(){try{await persistCurrentFields({showStatus:true});}catch{}}
async function uploadArtifact(input){const key=input.dataset.artifact,status=document.querySelector(`[data-upload-status="${key}"]`),file=input.files?.[0];if(!file)return;status.textContent='正在上传……';try{await persistCurrentFields();}catch(e){status.textContent=`先保存文字失败：${e.message}`;input.value='';return;}const fd=new FormData();fd.append('participantId',id);fd.append('sessionId',state.session.id);fd.append('artifactKey',key);fd.append('image',file);try{await App.api('/upload',{method:'POST',body:fd});status.textContent='上传成功 ✓';await load(false);}catch(e){status.textContent=e.message;input.value='';}}
async function openAi(){
  try{
    await persistCurrentFields();
    const r=await App.api('/chat/open',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});
    chatOpened=true; state.record=r.record||state.record; state.chat_messages=r.messages||[];
    // 只更新聊天区，不再 render() 整个页面，因此任务表单不会被重建。
    document.getElementById('chatBox')?.classList.remove('hidden');
    const btn=document.getElementById('openAi'); if(btn) btn.textContent='继续使用AI';
    renderMessages(state.chat_messages); updateChatMeta();
  }catch(e){alert(e.message);}
}
function clearSelectedImage(){
  if(selectedChatImageUrl) URL.revokeObjectURL(selectedChatImageUrl);
  selectedChatImage=null; selectedChatImageUrl='';
  const input=document.getElementById('chatImage'); if(input) input.value='';
  document.getElementById('chatImagePreview')?.classList.add('hidden');
}
function selectChatImage(file){
  if(!file) return clearSelectedImage();
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){alert('聊天图片请选择 JPG、PNG 或 WEBP。');return clearSelectedImage();}
  if(file.size>10*1024*1024){alert('聊天图片不能超过10MB。');return clearSelectedImage();}
  if(selectedChatImageUrl) URL.revokeObjectURL(selectedChatImageUrl);
  selectedChatImage=file; selectedChatImageUrl=URL.createObjectURL(file);
  const preview=document.getElementById('chatImagePreview'),thumb=document.getElementById('chatImageThumb');
  if(preview&&thumb){thumb.src=selectedChatImageUrl;preview.classList.remove('hidden');}
}
async function send(){
  if(sending)return;
  const box=document.getElementById('message'),msg=box.value.trim();
  if(!msg){document.getElementById('sendError').textContent='请先写一句话，告诉AI你想让它帮你看什么。';document.getElementById('sendError').classList.remove('hidden');return;}
  sending=true; document.getElementById('send').disabled=true; document.getElementById('thinking').classList.remove('hidden'); document.getElementById('sendError').classList.add('hidden');
  const file=selectedChatImage, previewUrl=selectedChatImageUrl;
  try{
    // 发送 AI 前强制等待表单最新值保存完成。
    await persistCurrentFields();
    const fd=new FormData(); fd.append('participantId',id); fd.append('sessionId',state.session.id); fd.append('message',msg); if(file) fd.append('image',file);
    const r=await App.api('/chat/send',{method:'POST',body:fd});
    if(r.record) state.record=r.record;
    box.value='';
    addMessage('user',msg,r.attachment?[r.attachment]:(file?[{preview_url:previewUrl}]:[]));
    addMessage('assistant',r.message);
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    selectedChatImage=null; selectedChatImageUrl='';
    const input=document.getElementById('chatImage'); if(input) input.value='';
    document.getElementById('chatImagePreview')?.classList.add('hidden');
    updateChatMeta();
    // 关键：这里不再调用 load()/render()，AI回复只更新聊天区。
  }catch(e){const er=document.getElementById('sendError');er.textContent=e.message;er.classList.remove('hidden');}
  finally{sending=false;document.getElementById('thinking')?.classList.add('hidden');if(document.getElementById('send'))document.getElementById('send').disabled=false;}
}
function wire(){
  document.querySelectorAll('[data-field]').forEach(x=>{x.addEventListener('input',()=>{writeLocalDraft(collectFields());queueAutoSave();});x.addEventListener('blur',()=>{if(!state.record.submitted_at)persistCurrentFields().then(()=>setSaveStatus('已自动保存 ✓')).catch(e=>setSaveStatus(`自动保存失败：${e.message}`));});});
  document.querySelectorAll('[data-artifact]').forEach(x=>x.onchange=()=>uploadArtifact(x));
  document.getElementById('saveDraft').onclick=saveDraft;
  document.getElementById('taskForm').onsubmit=async e=>{e.preventDefault();if(!confirm('确认提交本节任务吗？提交后本节记录将锁定。'))return;try{cancelQueuedAutoSave();await saveChain;await App.api('/session/submit',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:collectFields()})});clearLocalDraft();await load();}catch(x){alert(x.message);}};
  if(document.getElementById('revealUpdate'))document.getElementById('revealUpdate').onclick=revealMidTaskUpdate;
  if(document.getElementById('openAi'))document.getElementById('openAi').onclick=openAi;
  if(chatOpened&&document.getElementById('messages'))renderMessages(state.chat_messages||[]);
  if(document.getElementById('chatImage'))document.getElementById('chatImage').onchange=e=>selectChatImage(e.target.files?.[0]);
  if(document.getElementById('removeChatImage'))document.getElementById('removeChatImage').onclick=clearSelectedImage;
  if(document.getElementById('send'))document.getElementById('send').onclick=send;
  if(document.getElementById('message'))document.getElementById('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
}
async function load(show=true, keepChat=false){try{const r=await App.api(`/session/current?participantId=${encodeURIComponent(id)}`);state=r;if(keepChat&&state.chat_messages?.length)chatOpened=true;render();}catch(e){document.getElementById('app').innerHTML=`<div class="notice warn">${esc(e.message)}</div>`;}}
load();
