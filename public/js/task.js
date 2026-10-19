const id = App.requireParticipant();
const switchStudentBtn = document.getElementById('switchStudent');
if (switchStudentBtn) switchStudentBtn.onclick = () => {
  if (!confirm('确定退出当前学生编号吗？已自动保存的记录不会丢失。')) return;
  App.clearParticipant();
  location.href = '/';
};
let state = null, chatOpened = false, sending = false, selectedChatImage = null, selectedChatImageUrl = '', lastTaskFieldKey = '';
let autoSaveTimer = null;
let saveChain = Promise.resolve();
let aiDraftTrace = { active:false, startedAt:0, maxChars:0, editCount:0, leftLogged:false };
let revisitTimer = null, revisitLogged = false;
let taskFieldTrace = null;
let aiOpenTrace = { active:false, openedAt:0, messageCountAtOpen:0, sent:false, leftLogged:false };

const esc = App.escapeHtml;
const fmtLatency = v => v == null ? '—' : `${Math.floor(v/60)}分${v%60}秒`;

function postTraceEvent(type, data={}, {keepalive=false}={}){
  if(!state?.session?.id || !type) return Promise.resolve();
  const headers={'Content-Type':'application/json'};
  const rev=App.cohortRevision(); if(rev) headers['X-Cohort-Revision']=rev;
  const context=chatTaskContext();
  const field=(state?.session?.fields||[]).find(f=>f.key===context.field_key);
  const lastAi=lastAssistantMessage();
  const traceData={
    task_field_key:context.field_key||'',
    task_field_label:field?.label||'',
    task_field_stage:field?.stage||'',
    last_ai_message_id:lastAi?.message_id||'',
    last_ai_message_at:lastAi?.created_at||'',
    ...data,
  };
  return fetch(`${App.apiBase}/session/event`,{
    method:'POST', headers, keepalive,
    body:JSON.stringify({participantId:id,sessionId:state.session.id,type,data:traceData}),
  }).catch(()=>{});
}
function lastAssistantMessage(){
  const arr=state?.chat_messages||[];
  for(let i=arr.length-1;i>=0;i--) if(arr[i]?.role==='assistant') return arr[i];
  return null;
}
function saveContext(reason='save'){
  const m=lastAssistantMessage();
  return { reason, last_ai_message_id:m?.message_id||'', last_ai_message_at:m?.created_at||'' };
}
function lastTaskFieldStorageKey(){ return state?.session?.id ? `last_task_field:${id}:${state.session.id}` : ''; }
function rememberTaskField(key=''){
  lastTaskFieldKey=String(key||'');
  try{ const k=lastTaskFieldStorageKey(); if(k) sessionStorage.setItem(k,lastTaskFieldKey); }catch{}
}
function restoreTaskField(){
  try{ const k=lastTaskFieldStorageKey(); if(k) lastTaskFieldKey=sessionStorage.getItem(k)||''; }catch{}
}
function chatTaskContext(){
  const vals=collectFields();
  const fields=state?.session?.fields||[];
  const mainUpdate=updateIsRevealed(), bonus=bonusIsRevealed(), bonusUpdate=bonusUpdateIsRevealed();
  const visible=fields.filter(f=>{
    const stage=String(f.stage||'');
    if(stage==='after_update') return mainUpdate;
    if(stage==='bonus_before') return bonus;
    if(stage==='bonus_after') return bonus&&bonusUpdate;
    return !stage.startsWith('bonus_');
  });
  let field=fields.find(f=>f.key===lastTaskFieldKey);
  if(!field || !visible.some(v=>v.key===field.key)) field=visible.find(f=>!String(vals?.[f.key]||'').trim()) || visible.at(-1);
  return {
    field_key:field?.key||'',
    completed_field_keys:Object.entries(vals||{}).filter(([,v])=>String(v||'').trim()).map(([k])=>k),
    main_update_revealed:mainUpdate,
    bonus_task_revealed:bonus,
    bonus_update_revealed:bonusUpdate,
  };
}
function draftTraceData(extra={}){
  const now=Date.now();
  return { duration_ms:aiDraftTrace.startedAt?Math.max(0,now-aiDraftTrace.startedAt):0, max_chars:aiDraftTrace.maxChars||0, edit_count:aiDraftTrace.editCount||0, ...extra };
}
function resetAiDraftTrace(){ aiDraftTrace={active:false,startedAt:0,maxChars:0,editCount:0,leftLogged:false}; }
function onAiDraftInput(el){
  const text=String(el?.value||'');
  if(!aiDraftTrace.active && text.length){
    aiDraftTrace={active:true,startedAt:Date.now(),maxChars:text.length,editCount:1,leftLogged:false};
    postTraceEvent('ai_draft_started',{initial_chars:text.length});
    return;
  }
  if(!aiDraftTrace.active) return;
  aiDraftTrace.editCount+=1;
  aiDraftTrace.maxChars=Math.max(aiDraftTrace.maxChars,text.length);
  aiDraftTrace.leftLogged=false;
  if(!text.length){
    if(aiDraftTrace.maxChars>=2) postTraceEvent('ai_draft_deleted_unsent',draftTraceData());
    resetAiDraftTrace();
  }
}
function markAiDraftSent(finalText=''){
  if(aiDraftTrace.active){
    postTraceEvent('ai_draft_sent',draftTraceData({final_chars:String(finalText||'').length}));
    resetAiDraftTrace();
  }
}
function markAiDraftLeft(reason='page_hidden', keepalive=false){
  const el=document.getElementById('message');
  const text=String(el?.value||'');
  if(!aiDraftTrace.active || !text.length || aiDraftTrace.leftLogged) return;
  aiDraftTrace.leftLogged=true;
  postTraceEvent('ai_draft_left_unsent',draftTraceData({current_chars:text.length,reason}),{keepalive});
}

function startTaskFieldTrace(el){
  if(!el) return;
  taskFieldTrace={key:String(el.dataset.field||''),startedAt:Date.now(),startChars:String(el.value||'').length,editCount:0};
}
function bumpTaskFieldTrace(el){
  if(!el) return;
  if(!taskFieldTrace || taskFieldTrace.key!==String(el.dataset.field||'')) startTaskFieldTrace(el);
  taskFieldTrace.editCount=(taskFieldTrace.editCount||0)+1;
}
function endTaskFieldTrace(el, reason='blur'){
  if(!el || !taskFieldTrace || taskFieldTrace.key!==String(el.dataset.field||'')) return;
  const endChars=String(el.value||'').length;
  postTraceEvent('task_field_interaction',{
    field_key:taskFieldTrace.key,
    duration_ms:Math.max(0,Date.now()-taskFieldTrace.startedAt),
    start_chars:taskFieldTrace.startChars,
    end_chars:endChars,
    edit_count:taskFieldTrace.editCount||0,
    changed:endChars!==taskFieldTrace.startChars || (taskFieldTrace.editCount||0)>0,
    reason,
  });
  taskFieldTrace=null;
}
function markAiOpenStart(){
  aiOpenTrace={active:true,openedAt:Date.now(),messageCountAtOpen:(state?.chat_messages||[]).length,sent:false,leftLogged:false};
}
function markAiOpenSent(){
  if(!aiOpenTrace.active) return;
  aiOpenTrace.sent=true;
  postTraceEvent('ai_open_to_send',{duration_ms:Math.max(0,Date.now()-aiOpenTrace.openedAt),message_count_at_open:aiOpenTrace.messageCountAtOpen});
}
function markAiOpenLeft(reason='page_hidden', keepalive=false){
  if(!aiOpenTrace.active || aiOpenTrace.sent || aiOpenTrace.leftLogged) return;
  aiOpenTrace.leftLogged=true;
  postTraceEvent('ai_open_no_send',{duration_ms:Math.max(0,Date.now()-aiOpenTrace.openedAt),message_count_at_open:aiOpenTrace.messageCountAtOpen,reason},{keepalive});
}
function wireChatRevisit(){
  const box=document.getElementById('messages');
  if(!box || box.dataset.revisitWired==='1') return;
  box.dataset.revisitWired='1';
  box.addEventListener('scroll',()=>{
    const distance=Math.max(0,box.scrollHeight-box.clientHeight-box.scrollTop);
    if(distance>160 && (state?.chat_messages||[]).length>=4 && !revisitLogged){
      clearTimeout(revisitTimer);
      revisitTimer=setTimeout(()=>{
        const d=Math.max(0,box.scrollHeight-box.clientHeight-box.scrollTop);
        if(d>160){
          revisitLogged=true;
          postTraceEvent('chat_history_revisit',{distance_from_bottom:Math.round(d),message_count:(state?.chat_messages||[]).length,dwell_ms:2000});
        }
      },2000);
    }else if(distance<=60){
      clearTimeout(revisitTimer); revisitTimer=null; revisitLogged=false;
    }
  });
}

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
    meta.textContent=`${id}测试数据｜${state.ai_variant==='supported'?'实验组':'对照组'}｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}`;
  }
}

function chatImageUrl(meta){
  return meta?.file_name ? `/express/api/chat-image/${encodeURIComponent(id)}/${encodeURIComponent(state.session.id)}/${encodeURIComponent(meta.file_name)}` : '';
}
function addMessage(role, content, attachments=[], meta={}) {
  document.getElementById('emptyChat')?.remove();
  const el = document.createElement('div');
  el.className = `message ${role}`;
  if(meta?.message_id) el.dataset.messageId=meta.message_id;
  if(meta?.message_index) el.dataset.messageIndex=String(meta.message_index);
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
  box.innerHTML = messages.length ? '' : `<div class="empty-chat" id="emptyChat"><h3>${requiredOnce?'本节需要实际使用AI助手':'AI设计助手'}</h3><p>${requiredOnce?'至少使用1次即可；什么时候使用、问什么、之后是否继续使用，由你自己决定。':'本节任务中可以使用AI设计助手，也可以不使用。'}</p></div>`;
  messages.forEach(m => addMessage(m.role, m.content, m.attachments || [], m));
  wireChatRevisit();
  const messageArea=document.getElementById('messages');
  if(messageArea && messageArea.dataset.copyWired!=='1'){messageArea.dataset.copyWired='1';messageArea.addEventListener('copy',()=>{const n=String(window.getSelection?.()?.toString()||'').length;if(n>0)postTraceEvent('chat_text_copied',{copied_chars:n});});}
}
function artifactUrl(a, sid=state.session.id){ return a ? App.photoUrl(id, sid, a.artifact_key, a) : ''; }

function materialBankHtml(groups=[]){
  if(!(groups||[]).length) return '';
  return `<div class="material-pack"><div class="material-pack-head"><span class="eyebrow">材料图示</span><h3>你可以使用的材料</h3><p class="small">先认一认材料，再开始想方案。你的设计要尽量在这些材料范围内完成。</p></div>${groups.map(g=>`<div class="material-group"><h4>${esc(g.group||'')}</h4><div class="material-grid">${(g.items||[]).map(it=>`<div class="material-card"><div class="material-thumb">${esc(it.icon||'')}</div><div class="material-name">${esc(it.label||'')}</div></div>`).join('')}</div></div>`).join('')}</div>`;
}
function taskCard(s){
  const resources=(s.resources||[]).length ? `<div class="resource-pack"><div class="resource-pack-head"><span class="eyebrow">任务资料包</span><h3>先看共同资料，再开始判断</h3><p class="small">所有同学看到相同资料。请根据资料完成任务；右侧AI助手全程可用。</p></div><div class="resource-grid">${s.resources.map(r=>`<article class="resource-card"><h4>${esc(r.title)}</h4><ul>${(r.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}</div></div>` : '';
  return `<section class="task-box"><span class="eyebrow">${esc(s.student_label)}</span><h1>${esc(s.title)}</h1><p class="lead">${esc(s.subtitle)}</p><div class="brief-list">${s.brief.map(x=>`<p>${esc(x)}</p>`).join('')}</div>${resources}${materialBankHtml(s.materials||[])}<h3>本节你需要完成的内容</h3><ul class="requirements">${s.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function carryCard(carry){
  if(!carry) return '';
  const values = Object.entries(carry.record.text_fields||{}).filter(([,v])=>String(v||'').trim());
  const arts = Object.values(carry.record.artifacts||{});
  return `<details class="card compact"><summary><strong>查看上一阶段保存记录 · ${esc(carry.session.id)} ${esc(carry.session.title)}</strong></summary><div class="section">${values.map(([k,v])=>`<div class="answer-block"><strong>${esc(k)}</strong><p>${esc(v)}</p></div>`).join('')||'<p class="small">上一阶段暂无文字记录。</p>'}${arts.length?`<div class="photo-grid">${arts.map(a=>`<img src="${artifactUrl(a, carry.session.id)}" alt="上一阶段图片">`).join('')}</div>`:''}</div></details>`;
}

function fieldHtml(f, value=''){
  const req = f.required ? '<span class="req">必填</span>' : '<span class="optional">选填</span>';
  const disabled=(state.record.submitted_at||state.session_locked)?'disabled':'';
  if(f.type==='text') return `<label>${esc(f.label)} ${req}<input data-field="${esc(f.key)}" value="${esc(value)}" placeholder="${esc(f.placeholder)}" ${disabled}></label>`;
  return `<label>${esc(f.label)} ${req}<textarea data-field="${esc(f.key)}" placeholder="${esc(f.placeholder)}" ${disabled}>${esc(value)}</textarea>${f.helper?`<span class="small">${esc(f.helper)}</span>`:''}</label>`;
}
function artifactHtml(a, meta){
  const versions=state.artifact_versions?.[a.key] || (meta?[meta]:[]);
  const req=a.required?'<span class="req">必交</span>':'<span class="optional">选交</span>';
  const disabled=(state.record.submitted_at||state.session_locked)?'disabled':'';
  const recentReplies=(state.chat_messages||[]).filter(m=>m.role==='assistant'&&m.message_id).slice(-12).reverse();
  const options=recentReplies.map(m=>`<option value="${esc(m.message_id)}">${esc(String(m.content||'').slice(0,46))} (${esc(String(m.created_at||'').slice(5,16))})</option>`).join('');
  const carryId=state.carry_from?.session?.id||'';
  const carryVersions=Object.entries(state.carry_artifact_versions||{}).flatMap(([key,entries])=>entries.map((v,i)=>({...v,carry_key:key,ordinal:i+1}))) ;
  const carryOptions=carryVersions.map(v=>`<option value="${esc(`${carryId}:${v.version_id}`)}" ${v===([...carryVersions].reverse().find(x=>!x.original_order_unknown)||carryVersions.at(-1))?'selected':''}>${esc(carryId)} · ${esc(v.carry_key)} · ${v.original_order_unknown?'旧图（顺序未知）':`第${v.ordinal}版`}</option>`).join('');
  const gallery=versions.length?`<div class="photo-grid" style="margin:10px 0">${versions.map((v,i)=>`<div class="upload-preview"><img src="${artifactUrl(v)}" alt="第${i+1}版图纸"><p class="small">第${i+1}版 · ${v.original_order_unknown?'旧图（顺序未知）':v.kind==='correction'?'误传更正':v.kind==='revision'?'修改版':v.kind==='draft'?'初稿':'旧版'} · ${esc(String(v.uploaded_at||'').slice(0,16))}</p>${v.change_note?`<p class="small">${esc(v.change_note)}</p>`:''}</div>`).join('')}</div>`:'';
  return `<div class="upload-card" data-artifact-card="${esc(a.key)}"><strong>${esc(a.label)} ${req}</strong><p class="small">${esc(a.helper)}；支持初稿、修改版1/2/3…及误传更正。历史版本不会删除。</p>${gallery}
  <div class="row" style="margin-top:12px"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?`已有${versions.length}版，仍可再传`:'尚未上传'}</span></div>
  <div class="form" style="margin-top:8px;gap:7px"><label>本次上传性质<select data-artifact-kind="${esc(a.key)}" ${disabled}><option value="${versions.length?'revision':'draft'}">${versions.length?'新增修改版本':'第一次上传/初稿'}</option>${versions.length?'<option value="correction">更正误传图片（旧图保留存档）</option>':''}</select></label>
  <label>这次修改主要参考什么？（自述，不代表研究者已核实）<select data-artifact-source="${esc(a.key)}" ${disabled}><option value="unknown">未说明/不确定</option><option value="self">自己思考/测试</option><option value="ai">AI建议</option><option value="mixed">AI+自己/其他来源</option><option value="teacher">教师</option><option value="peer">同伴</option></select></label>
  <label>修改了哪里、为什么？（选填）<textarea data-artifact-note="${esc(a.key)}" rows="2" maxlength="500" placeholder="请按实际情况写：这版和上一版有什么不同？为什么这样修改？" ${disabled}></textarea></label>
  <label>这张图在修改哪张上一节课的图？（可选）<select data-artifact-based-on="${esc(a.key)}" ${disabled}><option value="">不是上一课作品的修改/无法确定</option>${carryOptions}</select></label>
  <label>如确实参考了本课AI回复，可选关联哪条AI消息<select data-artifact-ai="${esc(a.key)}" ${disabled}><option value="">未关联；不强制</option>${options}</select></label></div>
  <p class="small">先填写说明，再选图片。需要重传时选择新的图片即可；“更正误传”只修改当前展示版本，不抹去旧文件。</p></div>`;
}

function supportCardHtml(){
  const c=state?.support_card;
  if(!c) return '';
  return `<section class="card support-reminder-card"><span class="eyebrow">任务中的小提醒</span><h3>${esc(c.title||'AI求助提醒')}</h3><ul>${(c.lines||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;
}
function chatPanel(){
  const reminder=supportCardHtml();
  if(state.session.ai_mode==='none') return `${reminder}<section class="card sticky-card"><span class="eyebrow">本节无需AI</span><h2>专注整理与反思</h2><p class="small">本节没有AI对话入口。</p></section>`;
  const variantBlocked=state.ai_variant==='unassigned';
  const variantLabel=state.participant.is_test ? `${id}测试预览｜${state.ai_variant==='supported'?'实验组':'对照组'}` : 'AI设计助手';
  const requiredOnce=Boolean(state.session.ai_use_required_once);
  const policyText=state.session.ai_instruction || '本节任务中可以使用AI设计助手，也可以不使用。';
  const chatImageEnabled=state.session.chat_image_enabled!==false;
  return `${reminder}<section class="card sticky-card ai-card"><div class="row between"><div><span class="eyebrow">${esc(variantLabel)}</span><h2>AI设计助手</h2></div><span class="badge">${requiredOnce?'本节至少使用1次':'可选'}</span></div>
    ${variantBlocked?'<div class="notice warn">本课已进入分组阶段，但当前编号还没有分组。请老师先在后台设置 A/B。</div>':`<p class="small">${esc(policyText)}</p>
    <button class="btn secondary" id="openAi">${state.record.first_ai_open_at?'继续使用AI':'打开AI助手'}</button>
    <div id="chatBox" class="chat-embed ${chatOpened?'':'hidden'}">
      ${state.participant.is_test?`<div class="chat-meta small" id="chatMeta">${id}测试数据｜${state.ai_variant==='supported'?'实验组':'对照组'}｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}</div>`:''}
      <div class="messages compact-messages" id="messages"></div>
      <div id="thinking" class="spinner hidden">AI正在查看并回复……</div><div id="sendError" class="notice warn hidden"></div>
      ${chatImageEnabled?`<div id="chatImagePreview" class="chat-image-preview hidden"><img id="chatImageThumb" alt="待发送图片"><div><strong>已选择图片</strong><p class="small">请用文字告诉AI你想让它帮你看什么。</p><button type="button" class="btn ghost mini" id="removeChatImage">移除图片</button></div></div>
      <div class="composer-tools"><label class="attach-btn ${(state.record.submitted_at||state.session_locked)?'disabled':''}">＋ 添加草图 / 原型照片<input id="chatImage" type="file" accept="image/jpeg,image/png,image/webp" ${(state.record.submitted_at||state.session_locked)?'disabled':''}></label><span class="small">每次最多1张，≤10MB</span></div>`:'<p class="small">本节不需要上传图片，请直接使用文字与AI交流。</p>'}
      <div class="composer-wrap"><textarea id="message" placeholder="输入你现在想问AI的内容……" ${(state.record.submitted_at||state.session_locked)?'disabled':''}></textarea><button class="btn" id="send" ${(state.record.submitted_at||state.session_locked)?'disabled':''}>发送</button></div>
    </div>`}</section>`;
}


function reflectionOrientationHtml(o){
  const opts=o.personal_query_options||[];
  const hasOwn=opts.length>0;
  const cards=o.cards||[];
  const fallback=o.reflection_fallback_case||{title:'统一练习案例',body:['学生：我想直接要一个完整设计。','AI：你已经尝试过哪些材料？需要解决哪一步困难？']};
  const pairs=hasOwn?opts.map((ref,i)=>({
    ref:`${ref.session_id}:${ref.message_index}`,
    title:`历史对话 ${i+1} · ${ref.session_id}`,
    body:cards[i]?.body||[],
  })):[{ref:'',title:fallback.title||'统一练习案例',body:fallback.body||[]}];
  const renderExchange=(p,i)=>`<label class="reflection-exchange ${hasOwn?'ref-choosable':''}">
    ${hasOwn?`<input type="radio" name="reflectionReference" value="${esc(p.ref)}" ${i===0?'checked':''} aria-label="选择${esc(p.title)}">`:''}
    <span class="reflection-exchange-content"><strong>${esc(p.title)}</strong>
      ${(p.body||[]).map((msg,j)=>`<span class="reflection-bubble ${j===0?'student':'assistant'}">${esc(msg)}</span>`).join('')}
      ${hasOwn?'<span class="reflection-picked">选这段对话作回顾</span>':''}
    </span>
  </label>`;
  return `<div class="single-column-page"><section class="card orientation-shell reflection-shell">
    <span class="eyebrow">进入本节任务前 · 约6—8分钟</span>
    <h1>${esc(o.title||'个人对话回顾')}</h1><p class="lead">${esc(o.intro||'')}</p>
    ${o.strategy_micro_lesson?`<section class="micro-lesson" aria-label="求助辨析小练习"><h2>① 看情境，练一练</h2><p class="small">遇到困难时先找具体卡点，向AI要解释、比较依据或局部建议；得到回复后根据真实条件作判断。选好答案后可以展开理由，练习不是考试。</p>${(o.checks||[]).map((q,i)=>`<fieldset class="micro-question"><legend>${i+1}. ${esc(q.question)}</legend>${(q.options||[]).map((opt,j)=>`<label><input type="radio" name="orientation_${esc(q.id)}" value="${j}"><span>${esc(opt)}</span></label>`).join('')}<details class="micro-reason"><summary>我选好了，查看解析</summary><p>${esc(q.explanation)}</p></details></fieldset>`).join('')}</section>`:''}
    <div class="reflection-layout">
      <section class="reflection-history" aria-label="历史AI对话">
        <h2>${o.strategy_micro_lesson?'②':'①'} 看上节课的一次求助</h2><p class="small">${hasOwn?(o.case_selection_reason==='personal_IHS_neutral_review'?'这是你上节课的真实求助，可能本来就很好。请观察哪些地方表达得清楚，哪些还可以补充，不必硬找错误。':'这是上节课值得重新审视的候选求助，请自己判断；系统筛选不等于判定你问错了。'):o.prior_chat_count>0?'你上节课有AI对话，但没有找到适合作求助回顾的消息，因此使用统一案例；不表示你问得不好。':'上节课没有可供回顾的已发送AI求助，请分析统一案例，不必编造经历。'}</p>
        <div class="reflection-exchanges">${pairs.map(renderExchange).join('')}</div>
      </section>
      <section class="reflection-form" aria-label="引导回顾问题">
        <h2>${o.strategy_micro_lesson?'③':'②'} 找问题、检查回复、改写</h2>
        <div class="reflection-step"><label for="reflectionDifficulty"><strong>1. 原提问哪里值得改进？</strong><span class="small">指出一句具体内容：是否没有说清困难、已有尝试，或把本应自己决定的事交给了AI？如没有问题，也可以说明。</span></label>
          <textarea id="reflectionDifficulty" maxlength="600" rows="3" placeholder="例如：原提问没有交代……"></textarea></div>
        <div class="reflection-step"><label for="reflectionReplyReview"><strong>2. 这次AI回复给了什么帮助？还缺什么判断？</strong><span class="small">指出回复中的一条具体内容，并说明你后来是否采纳、检查或没有使用。没有做过的事不必编造。</span></label>
          <textarea id="reflectionReplyReview" maxlength="600" rows="3" placeholder="指出回复中的一条具体建议，以及你怎样判断"></textarea></div>
        <div class="reflection-step"><label for="reflectionRevised"><strong>3. 如果再问一次，你会怎样修改这个问题？</strong><span class="small">写一句新的问法，不要求套固定模板。</span></label>
          <textarea id="reflectionRevised" maxlength="600" rows="3" placeholder="可以写出具体困难、已经尝试的方法和需要的帮助"></textarea>
          <label for="reflectionReason" class="small">简单说一句：为什么这样改？</label>
          <textarea id="reflectionReason" maxlength="600" rows="2" placeholder="说出你补充了什么或希望自己保留哪个判断"></textarea></div>
      </section>
    </div>
    <p class="small reflection-note">本活动属于实验组的计划内学习环节，不是问卷，也不要求此刻再向AI提问。回答只用于研究求助策略，不用于评价作品美观。</p>
    <div id="orientationError" class="notice warn hidden" role="alert"></div>
    <button class="btn orange" id="completeOrientation" type="button">${esc(o.button||'保存回顾，进入设计任务')}</button>
  </section></div>`;
}

function orientationHtml(){
  const o=state?.orientation;
  if(!o) return '<div class="notice warn">平台小练习暂时无法读取，请刷新页面。</div>';
  if(o.reflection_activity && o.mode==='supported') return reflectionOrientationHtml(o);
  const cards=(o.cards||[]).map(c=>`<article class="orientation-card"><h3>${esc(c.title||'')}</h3>${(c.body||[]).map(x=>`<p>${esc(x)}</p>`).join('')}${c.example_bad?`<div class="orientation-example muted-example">${esc(c.example_bad)}</div>`:''}${c.example_good?`<div class="orientation-example good-example">${esc(c.example_good)}</div>`:''}</article>`).join('');
  let activity='';
  if(o.mode==='supported' && (o.checks||[]).length){
    const personalQueryOptions=o.personal_query_options||[];
    const hasPersonalQueries=personalQueryOptions.length>0;
    const reflectionCase= o.reflection_fallback_case || {title:'标准练习案例（不是你的真实对话）',body:['学生：直接给我一个能帮助人画画的完整装置，材料和制作步骤都写好。','AI：我可以帮你分析，但要先了解实际需要。你希望装置帮助使用者完成画画的哪一步？目前最困难的动作是什么？你已经尝试过什么？']};
    activity=`<div class="orientation-checks"><h3>先看一个具体例子，再完成回顾</h3><p class="small">只需完成三个核心问题。重点是从真实消息或案例中找证据，不是写“AI很好用”这类笼统评价。</p>${o.reflection_activity?`<div class="orientation-question"><h3>${hasPersonalQueries?'你的真实历史对话':'标准练习案例'}</h3>${hasPersonalQueries?`<p class="small">下方展示的是你以前真实发送的消息及匹配回复。请选择一条作为主要分析对象。</p><label>本次主要回顾哪一条？<select id="reflectionRef"><option value="">请选择一条真实对话</option>${personalQueryOptions.map((q,i)=>`<option value="${esc(q.session_id+':'+q.message_index)}">第${i+1}条 · ${esc(q.session_id)}</option>`).join('')}</select></label>`:`<p class="small">前几周没有已发送的AI求助消息可供回看，所以使用下面的标准案例练习。请不要把它写成自己的真实经历。</p>`}</div>${!hasPersonalQueries?`<article class="orientation-card"><h3>${esc(reflectionCase.title)}</h3>${(reflectionCase.body||[]).map(x=>`<p>${esc(x)}</p>`).join('')}</article>`:''}<label>① 这条提问想解决的具体问题是什么？原提问有没有说清自己的卡点、已经尝试的办法或限制？<textarea id="reflectionDifficulty" rows="2" maxlength="600" placeholder="写出一处具体信息；分析标准案例时，就分析案例里的提问"></textarea></label><label>② AI回复后，学生实际做了什么或接下来应怎样处理？请指出一条具体建议，并说明是采纳、修改、拒绝/暂不使用，还是还需要核实。<textarea id="reflectionReplyReview" rows="3" maxlength="600" placeholder="结合真实回复；若是标准案例，说明还缺什么信息、如何核实建议"></textarea></label><label>③ 如果重新提问，你会怎样改写？<textarea id="reflectionRevised" rows="2" maxlength="600" placeholder="写出你自己的具体问法，不要求套模板"></textarea></label><label>为什么这个改写更可能得到有用帮助，而不是让AI替你完成整个任务？<textarea id="reflectionReason" rows="2" maxlength="600" placeholder="简要说明一个理由即可"></textarea></div>`:''}${(o.checks||[]).map((q,idx)=>`<fieldset class="orientation-question"><legend>${idx+1}. ${esc(q.question)}</legend>${(q.options||[]).map((opt,i)=>`<label><input type="radio" name="orientation_${esc(q.id)}" value="${i}"><span>${esc(opt)}</span></label>`).join('')}</fieldset>`).join('')}</div>`;
  }else if(o.mode==='control'){
    activity=`<div class="orientation-checks"><h3>确认一下</h3>${o.neutral_design_note_required?`<label>${esc(o.neutral_label_1||'本节你准备观察装置的什么具体表现？')}<textarea id="neutralObservation" rows="3" maxlength="600" placeholder="按真实情况简单填写"></textarea></label><label>${esc(o.neutral_label_2||'如果测试结果与预想不同，你打算先做什么检查？')}<textarea id="neutralNextstep" rows="3" maxlength="600" placeholder="按真实情况简单填写"></textarea></label>`:''}${(o.acknowledgements||[]).map((x,i)=>`<label class="orientation-ack"><input type="checkbox" name="orientation_ack_${i}"><span>${esc(x)}</span></label>`).join('')}</div>`;
  }
  return `<div class="single-column-page"><section class="card orientation-shell"><span class="eyebrow">进入本节任务前</span><h1>${esc(o.title||'平台小练习')}</h1><p class="lead">${esc(o.intro||'')}</p><div class="orientation-grid">${cards}</div>${activity}<div id="orientationError" class="notice warn hidden"></div><button class="btn orange" id="completeOrientation" type="button">${esc(o.button||'进入设计任务')}</button></section></div>`;
}
async function startOrientationIfNeeded(){
  if(!state?.learning_gate || state?.orientation?.started_at) return;
  try{
    const r=await App.api('/session/orientation/start',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});
    if(r?.orientation) state.orientation={...state.orientation,started_at:r.orientation.started_at||state.orientation.started_at};
  }catch(e){
    const box=document.getElementById('orientationError'); if(box){box.textContent=e.message;box.classList.remove('hidden');}
  }
}
async function completeOrientation(){
  const o=state?.orientation; if(!o) return;
  const answers={};
  if(o.mode==='supported'){
    if(o.reflection_activity){answers.personal_ref=document.querySelector('input[name="reflectionReference"]:checked')?.value||document.getElementById('reflectionRef')?.value||'';answers.reflection_source=answers.personal_ref?'personal_chat':'standard_case';answers.reflection_difficulty=document.getElementById('reflectionDifficulty')?.value||'';answers.reflection_reply_review=document.getElementById('reflectionReplyReview')?.value||'';answers.revised_question=document.getElementById('reflectionRevised')?.value||'';answers.reflection_reason=document.getElementById('reflectionReason')?.value||'';
      if((o.personal_query_options||[]).length&&!answers.personal_ref){const box=document.getElementById('orientationError');box.textContent='请先选择一条真实历史对话作为主要回顾对象。';box.classList.remove('hidden');return;}
    }
    for(const q of o.checks||[]){
      const checked=document.querySelector(`input[name="orientation_${q.id}"]:checked`);
      if(!checked){ const box=document.getElementById('orientationError'); box.textContent='请先完成全部快速判断。'; box.classList.remove('hidden'); return; }
      answers[q.id]=Number(checked.value);
    }
  }else{
    if(o.neutral_design_note_required){answers.neutral_observation=document.getElementById('neutralObservation')?.value||'';answers.neutral_nextstep=document.getElementById('neutralNextstep')?.value||'';}
    answers.acknowledged=(o.acknowledgements||[]).map((_,i)=>Boolean(document.querySelector(`input[name="orientation_ack_${i}"]`)?.checked));
    if(answers.acknowledged.some(v=>!v)){ const box=document.getElementById('orientationError'); box.textContent='请先确认已经阅读全部平台操作说明。'; box.classList.remove('hidden'); return; }
  }
  const btn=document.getElementById('completeOrientation');
  try{
    btn.disabled=true; btn.textContent='正在进入任务…';
    await App.api('/session/orientation/complete',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,answers})});
    await load();
  }catch(e){
    const box=document.getElementById('orientationError'); box.textContent=e.message; box.classList.remove('hidden');
    btn.disabled=false; btn.textContent=o.button||'进入设计任务';
  }
}
function wireOrientation(){
  document.getElementById('completeOrientation')?.addEventListener('click',completeOrientation);
  startOrientationIfNeeded();
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
  if(state.task_gate==='questionnaire_post') return `<div class="single-column-page"><section class="card"><span class="eyebrow">W10正式干预已完成</span><h2>后测问卷</h2><p>教师已在后台启用候选后测问卷，请按真实情况完成。</p></section>${questionnaireHtml('post')}</div>`;
  if(state.task_gate==='awaiting_assignment') return `<div class="single-column-page"><section class="card"><span class="eyebrow">正式干预尚未开放</span><h1>等待老师确认实验组 / 对照组</h1><p class="lead">W4开始正式干预前，老师需要在后台确认你的组别。平台不会自动强制分成固定人数。完成后点击下面按钮刷新。</p><button class="btn" id="refreshAssignment">刷新分组状态</button></section></div>`;
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
  const main=(s.fields||[]).filter(f=>!String(f.stage||'').startsWith('bonus_'));
  const before=main.filter(f=>f.stage!=='after_update');
  const after=main.filter(f=>f.stage==='after_update');
  if(!s.mid_task_update || !after.length) return main.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('');
  const revealed=updateIsRevealed();
  const u=s.mid_task_update;
  const updateCard=`<div class="notice mid-task-update"><span class="eyebrow">任务进行到一半</span><h3>${esc(u.title||'收到新反馈')}</h3><p>${esc(u.intro||'')}</p><button type="button" class="btn secondary" id="revealUpdate" ${revealed?'disabled':''}>${revealed?'新反馈已查看 ✓':esc(u.button||'查看新反馈')}</button><div id="updateContent" class="${revealed?'':'hidden'}" style="margin-top:12px"><ul class="requirements">${(u.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`;
  return `${before.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}${updateCard}<div id="afterUpdateFields" class="${revealed?'':'hidden'}">${after.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}</div>`;
}

function bonusRevealKey(){ return state?.session?.id ? `bonus_task:${id}:${state.session.id}` : ''; }
function bonusUpdateKey(){ return state?.session?.id ? `bonus_task_update:${id}:${state.session.id}` : ''; }
function bonusIsRevealed(){
  if(!state?.session?.bonus_task) return false;
  try { if(sessionStorage.getItem(bonusRevealKey())==='1') return true; } catch {}
  const vals=displayTextFields();
  return (state.session.fields||[]).filter(f=>String(f.stage||'').startsWith('bonus_')).some(f=>String(vals?.[f.key]||'').trim());
}
function bonusUpdateIsRevealed(){
  if(!state?.session?.bonus_task?.update) return true;
  try { if(sessionStorage.getItem(bonusUpdateKey())==='1') return true; } catch {}
  const vals=displayTextFields();
  return (state.session.fields||[]).filter(f=>f.stage==='bonus_after').some(f=>String(vals?.[f.key]||'').trim());
}
function bonusTaskHtml(s){
  const b=s.bonus_task; if(!b) return '';
  const vals=displayTextFields();
  const revealed=bonusIsRevealed();
  if(!revealed){
    return `<div class="bonus-task-card"><span class="eyebrow">可选加练</span><h3>${esc(b.title||'加练任务')}</h3><p>${esc(b.subtitle||'')}</p><button type="button" class="btn secondary" id="revealBonus">${esc(b.button||'进入加练任务')}</button><p class="small">如果课堂时间不够，可以不做这一部分，不影响主任务提交。</p></div>`;
  }
  const before=(s.fields||[]).filter(f=>f.stage==='bonus_before');
  const after=(s.fields||[]).filter(f=>f.stage==='bonus_after');
  const update=b.update;
  const updateRevealed=bonusUpdateIsRevealed();
  const updateCard=update?`<div class="notice mid-task-update"><span class="eyebrow">加练第二轮</span><h3>${esc(update.title||'新增条件')}</h3><button type="button" class="btn secondary" id="revealBonusUpdate" ${updateRevealed?'disabled':''}>${updateRevealed?'新增条件已查看 ✓':esc(update.button||'查看新增条件')}</button><div id="bonusUpdateContent" class="${updateRevealed?'':'hidden'}" style="margin-top:12px"><ul class="requirements">${(update.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div></div>`:'';
  return `<div class="bonus-task-card active"><span class="eyebrow">可选加练</span><h3>${esc(b.title||'加练任务')}</h3><p>${esc(b.subtitle||'')}</p>${b.source_course?`<p class="small">课程来源：${esc(b.source_course)}</p>`:''}<div class="brief-list">${(b.brief||[]).map(x=>`<p>${esc(x)}</p>`).join('')}</div>${before.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}${updateCard}<div id="bonusAfterFields" class="${updateRevealed?'':'hidden'}">${after.map(f=>fieldHtml(f,vals?.[f.key]??'')).join('')}</div></div>`;
}
async function revealMidTaskUpdate(){
  const u=state?.session?.mid_task_update; if(!u) return;
  const vals=collectFields();
  const missing=(u.after_fields||[]).map(k=>state.session.fields.find(f=>f.key===k)).filter(f=>f && !String(vals[f.key]||'').trim());
  if(missing.length){ alert(`请先完成：${missing[0].label}`); return; }
  try{ await persistCurrentFields({showStatus:true,saveReason:'before_main_update'}); }catch{return;}
  try{ sessionStorage.setItem(updateRevealKey(),'1'); }catch{}
  document.getElementById('updateContent')?.classList.remove('hidden');
  document.getElementById('afterUpdateFields')?.classList.remove('hidden');
  const btn=document.getElementById('revealUpdate'); if(btn){btn.disabled=true;btn.textContent='新反馈已查看 ✓';}
  App.api('/session/event',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,type:'mid_task_update_revealed',data:{}})}).catch(()=>{});
}

async function revealBonusTask(){
  const b=state?.session?.bonus_task; if(!b) return;
  const vals=collectFields();
  const missing=(b.unlock_after||[]).map(k=>state.session.fields.find(f=>f.key===k)).filter(f=>f && !String(vals[f.key]||'').trim());
  if(missing.length){ alert(`请先完成主任务：${missing[0].label}`); return; }
  try{ await persistCurrentFields({showStatus:true,saveReason:'before_bonus'}); }catch{return;}
  try{ sessionStorage.setItem(bonusRevealKey(),'1'); }catch{}
  postTraceEvent('bonus_task_revealed',{bonus_task_id:b.id||'bonus'});
  render();
}
async function revealBonusUpdate(){
  const b=state?.session?.bonus_task, u=b?.update; if(!u) return;
  const vals=collectFields();
  const missing=(u.after_fields||[]).map(k=>state.session.fields.find(f=>f.key===k)).filter(f=>f && !String(vals[f.key]||'').trim());
  if(missing.length){ alert(`请先完成：${missing[0].label}`); return; }
  try{ await persistCurrentFields({showStatus:true,saveReason:'before_bonus_update'}); }catch{return;}
  try{ sessionStorage.setItem(bonusUpdateKey(),'1'); }catch{}
  document.getElementById('bonusUpdateContent')?.classList.remove('hidden');
  document.getElementById('bonusAfterFields')?.classList.remove('hidden');
  const btn=document.getElementById('revealBonusUpdate'); if(btn){btn.disabled=true;btn.textContent='新增条件已查看 ✓';}
  postTraceEvent('bonus_task_update_revealed',{bonus_task_id:b.id||'bonus'});
}

function render(){
  const s=state.session,r=state.record;
  document.title=`${s.id} ${s.title}`;
  if(state.learning_gate==='orientation'){
    document.getElementById('app').innerHTML=`<div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div></div>${orientationHtml()}`;
    wireOrientation();
    return;
  }
  if(state.task_gate){
    document.getElementById('app').innerHTML=`<div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div></div>${gateHtml()}`;
    if(document.getElementById('questionnaireForm')) document.getElementById('questionnaireForm').onsubmit=e=>{e.preventDefault();submitQuestionnaire(state.task_gate==='questionnaire_post'?'post':'pre');};
    if(document.getElementById('refreshAssignment')) document.getElementById('refreshAssignment').onclick=()=>load();
    return;
  }
  document.getElementById('app').innerHTML=`
    <div class="course-header"><span class="eyebrow">${esc(s.id)} · ${esc(s.date)}</span><div class="row between"><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div>${state.session_locked?'<span class="badge big">教师已结束本阶段</span>':r.submitted_at?'<span class="badge big">已标记完成</span>':''}</div></div>
    <div class="course-grid"><div class="course-main">${taskCard(s)}${carryCard(state.carry_from)}
      <section class="card"><span class="eyebrow">我的任务记录</span><h2>边做边记录，内容会及时自动保存</h2><p class="small">今天没做完就点“保存进度并退出”，下次老师继续开放本任务时，用同一编号和姓名进入即可接着做。完成按钮只是标记你认为本阶段已完成；在老师统一结束并锁定前，即使误点，也可以点击“继续修改”恢复。</p>${state.session_locked?'<div class="notice"><strong>本阶段已由老师结束并锁定。</strong>现在可以查看已有记录，但不能继续修改。</div>':r.submitted_at?'<div class="notice"><strong>你已将本阶段标记为完成。</strong>如果误点或还想继续完善，可以点击“继续修改”，之前的文字、图片和AI对话都不会丢失。</div>':''}<form id="taskForm" class="form">${taskFieldsHtml(s)}${bonusTaskHtml(s)}<div class="artifact-list">${s.artifacts.map(a=>artifactHtml(a,r.artifacts?.[a.key])).join('')}</div><div id="saveStatus" class="small"></div><div class="row">${r.submitted_at&&!state.session_locked?'<button type="button" class="btn secondary" id="reopenSession">继续修改</button>':`<button type="button" class="btn secondary" id="saveAndExit" ${state.session_locked?'disabled':''}>保存进度并退出</button><button type="submit" class="btn orange" ${(r.submitted_at||state.session_locked)?'disabled':''}>${state.session_locked?'教师已结束本阶段':'完成本阶段'}</button>`}</div></form></section>
    </div><aside class="course-side">${chatPanel()}</aside></div>`;
  wire();
}

function collectFields(){const x={};document.querySelectorAll('[data-field]').forEach(el=>x[el.dataset.field]=el.value);return x;}
function setSaveStatus(text=''){const b=document.getElementById('saveStatus');if(b)b.textContent=text;}
function cancelQueuedAutoSave(){if(autoSaveTimer){clearTimeout(autoSaveTimer);autoSaveTimer=null;}}
async function persistCurrentFields({showStatus=false,saveReason='autosave'}={}){
  if(!state?.session || state.record?.submitted_at || state.session_locked || !document.querySelector('[data-field]')) return state?.record;
  cancelQueuedAutoSave();
  // 先同步写入浏览器草稿，哪怕网络慢/AI更新，界面也不会丢字。
  const fields=collectFields();
  writeLocalDraft(fields);
  const run=async()=>{
    if(showStatus)setSaveStatus('正在保存……');
    const r=await App.api('/session/save',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:fields,saveContext:saveContext(saveReason)})});
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
  if(state?.record?.submitted_at||state?.session_locked)return;
  writeLocalDraft(collectFields());
  cancelQueuedAutoSave();
  setSaveStatus('正在自动保存……');
  autoSaveTimer=setTimeout(async()=>{
    try{await persistCurrentFields();setSaveStatus('已自动保存 ✓');}
    catch(e){setSaveStatus(`自动保存失败：${e.message}`);}
  },900);
}
function saveFieldsOnExit(reason='page_exit'){
  if(!state?.session || state.record?.submitted_at || state.session_locked || !document.querySelector('[data-field]')) return;
  const fields=collectFields();
  writeLocalDraft(fields);
  const headers={'Content-Type':'application/json'};
  const rev=App.cohortRevision(); if(rev) headers['X-Cohort-Revision']=rev;
  try{fetch(`${App.apiBase}/session/save`,{method:'POST',headers,body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:fields,saveContext:saveContext(reason)}),keepalive:true}).catch(()=>{});}catch{}
}
async function saveAndExit(){
  try{
    await persistCurrentFields({showStatus:true,saveReason:'progress_exit'});
    await postTraceEvent('progress_saved_and_exit',{saved_at:state?.record?.saved_at||new Date().toISOString()});
    App.clearParticipant();
    location.href='/';
  }catch(e){setSaveStatus(`保存失败：${e.message}`);}
}
async function uploadArtifact(input){const key=input.dataset.artifact,status=document.querySelector(`[data-upload-status="${key}"]`),file=input.files?.[0];if(!file)return;status.textContent='正在上传……';try{await persistCurrentFields({saveReason:'before_artifact_upload'});}catch(e){status.textContent=`先保存文字失败：${e.message}`;input.value='';return;}const fd=new FormData();fd.append('participantId',id);fd.append('sessionId',state.session.id);fd.append('artifactKey',key);fd.append('image',file);const root=input.closest('[data-artifact-card]');fd.append('kind',root?.querySelector('[data-artifact-kind]')?.value||'draft');fd.append('changeSource',root?.querySelector('[data-artifact-source]')?.value||'unknown');fd.append('changeNote',root?.querySelector('[data-artifact-note]')?.value||'');fd.append('aiMessageId',root?.querySelector('[data-artifact-ai]')?.value||'');fd.append('basedOnVersionRef',root?.querySelector('[data-artifact-based-on]')?.value||'');try{const pendingChatText=document.getElementById('message')?.value||'';await App.api('/upload',{method:'POST',body:fd});status.textContent='上传成功 ✓';await load(false);const currentChatBox=document.getElementById('message');if(currentChatBox&&pendingChatText)currentChatBox.value=pendingChatText;}catch(e){status.textContent=e.message;input.value='';}}
async function openAi(){
  try{
    await persistCurrentFields({saveReason:'before_ai_open'});
    const r=await App.api('/chat/open',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});
    chatOpened=true; state.record=r.record||state.record; state.chat_messages=r.messages||[];
    // 只更新聊天区，不再 render() 整个页面，因此任务表单不会被重建。
    document.getElementById('chatBox')?.classList.remove('hidden');
    const btn=document.getElementById('openAi'); if(btn) btn.textContent='继续使用AI';
    renderMessages(state.chat_messages); updateChatMeta(); markAiOpenStart();
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
    await persistCurrentFields({saveReason:'before_ai_send'});
    const fd=new FormData(); fd.append('participantId',id); fd.append('sessionId',state.session.id); fd.append('message',msg); fd.append('clientSentAt',new Date().toISOString()); fd.append('taskContext',JSON.stringify(chatTaskContext())); if(file) fd.append('image',file);
    const r=await App.api('/chat/send',{method:'POST',body:fd});
    if(r.record) state.record=r.record;
    markAiDraftSent(msg); markAiOpenSent();
    box.value='';
    const userRow=r.user_message||{role:'user',content:msg,attachments:r.attachment?[r.attachment]:[],created_at:new Date().toISOString()};
    const assistantRow=r.assistant_message_row||{role:'assistant',content:r.message,attachments:[],created_at:new Date().toISOString()};
    state.chat_messages=[...(state.chat_messages||[]),userRow,assistantRow];
    addMessage('user',msg,r.attachment?[r.attachment]:(file?[{preview_url:previewUrl}]:[]),userRow);
    addMessage('assistant',r.message,[],assistantRow);
    wireChatRevisit();
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
  document.querySelectorAll('[data-field]').forEach(x=>{x.addEventListener('focus',()=>{rememberTaskField(x.dataset.field);startTaskFieldTrace(x);});x.addEventListener('input',()=>{rememberTaskField(x.dataset.field);bumpTaskFieldTrace(x);writeLocalDraft(collectFields());queueAutoSave();});x.addEventListener('paste',e=>postTraceEvent('task_field_paste',{field_key:x.dataset.field||'',pasted_chars:String(e.clipboardData?.getData('text')||'').length}));x.addEventListener('blur',()=>{rememberTaskField(x.dataset.field);endTaskFieldTrace(x,'blur');if(!state.record.submitted_at)persistCurrentFields({saveReason:'blur'}).then(()=>setSaveStatus('已自动保存 ✓')).catch(e=>setSaveStatus(`自动保存失败：${e.message}`));});});
  document.querySelectorAll('[data-artifact]').forEach(x=>x.onchange=()=>uploadArtifact(x));
  if(document.getElementById('saveAndExit'))document.getElementById('saveAndExit').onclick=saveAndExit;
  if(document.getElementById('reopenSession'))document.getElementById('reopenSession').onclick=async()=>{try{await App.api('/session/reopen',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});await load();}catch(x){alert(x.message);}};
  document.getElementById('taskForm').onsubmit=async e=>{e.preventDefault();if(state.session_locked)return;if(!confirm('确认将本阶段标记为“已完成”吗？\n\n如果今天还没做完，请选择“取消”，再点“保存进度并退出”。\n\n即使误点，在老师统一结束并锁定本阶段前，你仍可以回来点击“继续修改”。'))return;try{cancelQueuedAutoSave();await saveChain;markAiDraftLeft('session_mark_complete');await App.api('/session/submit',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:collectFields(),saveContext:saveContext('mark_complete')})});clearLocalDraft();await load();}catch(x){alert(x.message);}};
  if(document.getElementById('revealUpdate'))document.getElementById('revealUpdate').onclick=revealMidTaskUpdate;
  if(document.getElementById('revealBonus'))document.getElementById('revealBonus').onclick=revealBonusTask;
  if(document.getElementById('revealBonusUpdate'))document.getElementById('revealBonusUpdate').onclick=revealBonusUpdate;
  if(document.getElementById('openAi'))document.getElementById('openAi').onclick=openAi;
  if(chatOpened&&document.getElementById('messages'))renderMessages(state.chat_messages||[]);
  if(document.getElementById('chatImage'))document.getElementById('chatImage').onchange=e=>selectChatImage(e.target.files?.[0]);
  if(document.getElementById('removeChatImage'))document.getElementById('removeChatImage').onclick=clearSelectedImage;
  if(document.getElementById('send'))document.getElementById('send').onclick=send;
  if(document.getElementById('message')){
    const msgBox=document.getElementById('message');
    msgBox.addEventListener('input',()=>onAiDraftInput(msgBox));
    msgBox.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
  }
  wireChatRevisit();
  const messageArea=document.getElementById('messages');
  if(messageArea && messageArea.dataset.copyWired!=='1'){messageArea.dataset.copyWired='1';messageArea.addEventListener('copy',()=>{const n=String(window.getSelection?.()?.toString()||'').length;if(n>0)postTraceEvent('chat_text_copied',{copied_chars:n});});}
}
function logResumeIfNeeded(){
  if(!state?.session?.id || state?.record?.submitted_at || !state?.record?.saved_at) return;
  const key=`resume_logged:${id}:${state.session.id}`;
  try{ if(sessionStorage.getItem(key)==='1') return; }catch{}
  const last=Date.parse(state.record.saved_at||'');
  const delta=Number.isFinite(last)?Math.max(0,Math.floor((Date.now()-last)/1000)):null;
  postTraceEvent('session_resumed',{last_saved_at:state.record.saved_at||'',seconds_since_last_save:delta});
  try{sessionStorage.setItem(key,'1');}catch{}
}
async function load(show=true, keepChat=false){try{const r=await App.api(`/session/current?participantId=${encodeURIComponent(id)}`);state=r;restoreTaskField();if((keepChat||state.chat_messages?.length)&&state.chat_messages?.length)chatOpened=true;render();logResumeIfNeeded();}catch(e){document.getElementById('app').innerHTML=`<div class="notice warn">${esc(e.message)}</div>`;}}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){saveFieldsOnExit('page_hidden');markAiDraftLeft('page_hidden',true);markAiOpenLeft('page_hidden',true);}});
window.addEventListener('pagehide',()=>saveFieldsOnExit('pagehide'));
window.addEventListener('beforeunload',()=>saveFieldsOnExit('beforeunload'));
window.addEventListener('pagehide',()=>{markAiDraftLeft('pagehide',true);markAiOpenLeft('pagehide',true);});

load();
