const id = App.requireParticipant();
let state = null, chatOpened = false, sending = false, selectedChatImage = null, selectedChatImageUrl = '';

const esc = App.escapeHtml;
const fmtLatency = v => v == null ? '—' : `${Math.floor(v/60)}分${v%60}秒`;

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
  box.innerHTML = messages.length ? '' : '<div class="empty-chat" id="emptyChat"><h3>需要时再问AI</h3><p>本节任务中可以使用AI设计助手，也可以不使用。</p></div>';
  messages.forEach(m => addMessage(m.role, m.content, m.attachments || []));
}
function artifactUrl(a, sid=state.session.id){ return a ? App.photoUrl(id, sid, a.artifact_key, a) : ''; }
function taskCard(s){return `<section class="task-box"><span class="eyebrow">${esc(s.student_label)}</span><h1>${esc(s.title)}</h1><p class="lead">${esc(s.subtitle)}</p><div class="brief-list">${s.brief.map(x=>`<p>${esc(x)}</p>`).join('')}</div><h3>本节要求</h3><ul class="requirements">${s.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;}

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
  return `<section class="card sticky-card ai-card"><div class="row between"><div><span class="eyebrow">${esc(variantLabel)}</span><h2>AI设计助手</h2></div><span class="badge">可选</span></div>
    ${variantBlocked?'<div class="notice warn">本课已进入分组阶段，但当前编号还没有分组。请老师先在后台设置 A/B。</div>':`<p class="small">本节任务中可以使用AI设计助手，也可以不使用。</p>
    <button class="btn secondary" id="openAi">${state.record.first_ai_open_at?'继续使用AI':'打开AI助手'}</button>
    <div id="chatBox" class="chat-embed ${chatOpened?'':'hidden'}">
      ${state.participant.is_test?`<div class="chat-meta small">S00测试数据｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}</div>`:''}
      <div class="messages compact-messages" id="messages"></div>
      <div id="thinking" class="spinner hidden">AI正在查看并回复……</div><div id="sendError" class="notice warn hidden"></div>
      <div id="chatImagePreview" class="chat-image-preview hidden"><img id="chatImageThumb" alt="待发送图片"><div><strong>已选择图片</strong><p class="small">请用文字告诉AI你想让它帮你看什么。</p><button type="button" class="btn ghost mini" id="removeChatImage">移除图片</button></div></div>
      <div class="composer-tools"><label class="attach-btn ${state.record.submitted_at?'disabled':''}">＋ 添加草图 / 原型照片<input id="chatImage" type="file" accept="image/jpeg,image/png,image/webp" ${state.record.submitted_at?'disabled':''}></label><span class="small">每次最多1张，≤10MB</span></div>
      <div class="composer-wrap"><textarea id="message" placeholder="输入你现在想问AI的内容……" ${state.record.submitted_at?'disabled':''}></textarea><button class="btn" id="send" ${state.record.submitted_at?'disabled':''}>发送</button></div>
    </div>`}</section>`;
}

function render(){
  const s=state.session,r=state.record;
  document.title=`${s.id} ${s.title}`;
  document.getElementById('app').innerHTML=`
    <div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div class="row between"><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div>${r.submitted_at?'<span class="badge big">已提交</span>':''}</div></div>
    <div class="course-grid"><div class="course-main">${taskCard(s)}${carryCard(state.carry_from)}
      <section class="card"><span class="eyebrow">我的任务记录</span><h2>边做边记录，最后统一提交</h2><form id="taskForm" class="form">${s.fields.map(f=>fieldHtml(f,r.text_fields?.[f.key]||'')).join('')}<div class="artifact-list">${s.artifacts.map(a=>artifactHtml(a,r.artifacts?.[a.key])).join('')}</div><div id="saveStatus" class="small"></div><div class="row"><button type="button" class="btn secondary" id="saveDraft" ${r.submitted_at?'disabled':''}>保存当前记录</button><button type="submit" class="btn orange" ${r.submitted_at?'disabled':''}>${r.submitted_at?'本节已提交':'提交本节任务'}</button></div></form></section>
      ${(s.questionnaire_slot&&state.participant.is_test)?`<section class="card"><span class="eyebrow">${s.questionnaire_slot==='pre'?'前测问卷':'后测问卷'}</span><h2>问卷模块预留（仅S00预览）</h2><p>问卷正式中文版定稿后再接入。正式学生目前不会看到这一块。</p></section>`:''}
    </div><aside class="course-side">${chatPanel()}</aside></div>`;
  wire();
}

function collectFields(){const x={};document.querySelectorAll('[data-field]').forEach(el=>x[el.dataset.field]=el.value);return x;}
async function saveDraft(){const b=document.getElementById('saveStatus');b.textContent='正在保存……';try{await App.api('/session/save',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:collectFields()})});b.textContent='已保存 ✓';await load(false);}catch(e){b.textContent=e.message;}}
async function uploadArtifact(input){const key=input.dataset.artifact,status=document.querySelector(`[data-upload-status="${key}"]`),file=input.files?.[0];if(!file)return;status.textContent='正在上传……';const fd=new FormData();fd.append('participantId',id);fd.append('sessionId',state.session.id);fd.append('artifactKey',key);fd.append('image',file);try{await App.api('/upload',{method:'POST',body:fd});status.textContent='上传成功 ✓';await load(false);}catch(e){status.textContent=e.message;input.value='';}}
async function openAi(){try{const r=await App.api('/chat/open',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});chatOpened=true;state.record=r.record||state.record;state.chat_messages=r.messages||[];render();}catch(e){alert(e.message);}}
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
    const fd=new FormData(); fd.append('participantId',id); fd.append('sessionId',state.session.id); fd.append('message',msg); if(file) fd.append('image',file);
    const r=await App.api('/chat/send',{method:'POST',body:fd});
    box.value='';
    addMessage('user',msg,file?[{preview_url:previewUrl}]:[]); addMessage('assistant',r.message);
    selectedChatImage=null; selectedChatImageUrl='';
    await load(false,true);
  }catch(e){const er=document.getElementById('sendError');er.textContent=e.message;er.classList.remove('hidden');}
  finally{sending=false;document.getElementById('thinking')?.classList.add('hidden');if(document.getElementById('send'))document.getElementById('send').disabled=false;}
}
function wire(){
  document.querySelectorAll('[data-artifact]').forEach(x=>x.onchange=()=>uploadArtifact(x));
  document.getElementById('saveDraft').onclick=saveDraft;
  document.getElementById('taskForm').onsubmit=async e=>{e.preventDefault();if(!confirm('确认提交本节任务吗？提交后本节记录将锁定。'))return;try{await App.api('/session/submit',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:collectFields()})});await load();}catch(x){alert(x.message);}};
  if(document.getElementById('openAi'))document.getElementById('openAi').onclick=openAi;
  if(chatOpened&&document.getElementById('messages'))renderMessages(state.chat_messages||[]);
  if(document.getElementById('chatImage'))document.getElementById('chatImage').onchange=e=>selectChatImage(e.target.files?.[0]);
  if(document.getElementById('removeChatImage'))document.getElementById('removeChatImage').onclick=clearSelectedImage;
  if(document.getElementById('send'))document.getElementById('send').onclick=send;
  if(document.getElementById('message'))document.getElementById('message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
}
async function load(show=true, keepChat=false){try{const r=await App.api(`/session/current?participantId=${encodeURIComponent(id)}`);state=r;if(keepChat&&state.chat_messages?.length)chatOpened=true;render();}catch(e){document.getElementById('app').innerHTML=`<div class="notice warn">${esc(e.message)}</div>`;}}
load();
