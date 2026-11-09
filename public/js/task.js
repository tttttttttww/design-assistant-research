const id = App.requireParticipant();
const switchStudentBtn = document.getElementById('switchStudent');
if (switchStudentBtn) switchStudentBtn.onclick = () => {
  if (!confirm('确定退出当前学生编号吗？已自动保存的记录不会丢失。')) return;
  App.clearParticipant();
  location.href = '/';
};
let state = null, chatOpened = false, sending = false, selectedChatImage = null, selectedChatImageUrl = '', lastTaskFieldKey = '';
let activeW8Step = null, prototypeVersionIndexByKey = {};
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
function currentW8ChatStep(){
  if(!state?.session?.task_flow)return 'task1';
  return w8StepDone('task1') ? 'task2' : 'task1';
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
  const taskPhase = state?.session?.task_flow?.steps?.find(x=>x.key===currentW8ChatStep())?.task_phase || '';
  return {
    field_key:field?.key||'',
    task_phase:taskPhase,
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
    meta.textContent=`${id}测试预览｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}`;
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
  const resources=(s.resources||[]).length && !s.task_flow ? `<div class="resource-pack"><div class="resource-pack-head"><span class="eyebrow">任务资料包</span><h3>先看共同资料，再开始判断</h3><p class="small">所有同学看到相同资料。请根据资料完成任务；右侧AI助手全程可用。</p></div><div class="resource-grid">${s.resources.map(r=>`<article class="resource-card"><h4>${esc(r.title)}</h4><ul>${(r.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}</div></div>` : '';
  const materials=!s.task_flow?materialBankHtml(s.materials||[]):'';
  if(s.task_flow)return `<section class="task-box"><h1>${esc(s.title)}</h1><p class="lead">${esc(s.subtitle)}</p><p class="small">每节先检查真实成果，再完成当前任务；下课前回顾今天的AI交流。没做完可以保存。</p></section>`;
  return `<section class="task-box"><span class="eyebrow">${esc(s.student_label)}</span><h1>${esc(s.title)}</h1><p class="lead">${esc(s.subtitle)}</p><div class="brief-list">${s.brief.map(x=>`<p>${esc(x)}</p>`).join('')}</div>${resources}${materials}<h3>本节你需要完成的内容</h3><ul class="requirements">${s.requirements.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`;
}

function carryCard(carry){
  if(!carry) return '';
  const values = Object.entries(carry.record.text_fields||{}).filter(([,v])=>String(v||'').trim());
  const arts = Object.values(carry.record.artifacts||{});
  return `<details class="card compact"><summary><strong>查看上一阶段保存记录 · ${esc(carry.session.id)} ${esc(carry.session.title)}</strong></summary><div class="section">${values.map(([k,v])=>`<div class="answer-block"><strong>${esc(k)}</strong><p>${esc(v)}</p></div>`).join('')||'<p class="small">上一阶段暂无文字记录。</p>'}${arts.length?`<div class="photo-grid">${arts.map(a=>`<img src="${artifactUrl(a, carry.session.id)}" alt="上一阶段图片">`).join('')}</div>`:''}</div></details>`;
}

function fieldHtml(f, value='', forceDisabled=false){
  const req = f.required ? '<span class="req">必填</span>' : '<span class="optional">选填</span>';
  const disabled=(state.record.submitted_at||state.session_locked||forceDisabled)?'disabled':'';
  if(f.type==='text') return `<label>${esc(f.label)} ${req}<input data-field="${esc(f.key)}" value="${esc(value)}" placeholder="${esc(f.placeholder)}" ${disabled}></label>`;
  if(f.type==='select'){
    const older={'符合，已有依据':'我检查了，暂时没发现问题','发现问题':'我发现一个需要解决的问题','尚未验证':'我还没有检查，不确定','还没有验证':'我还没有检查，不确定','尚未完成':'我还没做到这一步','尚未完成，无法检查':'我还没做到这一步'};
    const selected=/^l\d{2}_check[123]$/.test(f.key)?(older[String(value)]||String(value)):String(value);
    return `<label>${esc(f.label)} ${req}<select data-field="${esc(f.key)}" ${disabled}><option value="">还没选择</option>${(f.choices||[]).map(x=>`<option value="${esc(x)}" ${selected===String(x)?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`;
  }
  return `<label>${esc(f.label)} ${req}<textarea data-field="${esc(f.key)}" placeholder="${esc(f.placeholder)}" ${disabled}>${esc(value)}</textarea>${f.helper?`<span class="small">${esc(f.helper)}</span>`:''}</label>`;
}
function artifactStepForKey(key){
  return (state?.session?.task_flow?.steps||[]).find(step=>(step.required_artifacts||[]).includes(key)||(step.required_any_artifact_keys||[]).includes(key))||null;
}
function artifactStepCompleted(key){
  const step=artifactStepForKey(key);
  return Boolean(step&&state?.task_progress?.completed_steps?.includes(step.key));
}
function artifactRequiredForCurrentFlow(key){
  return Boolean(artifactStepForKey(key));
}
function artifactQuestionnaireHtml(a,versions,carryOptions,options){
  const disabled=(state.record.submitted_at||state.session_locked||artifactStepCompleted(a.key))?'disabled':'';
  const key=esc(a.key),first=!versions.length;
  return `<div class="form version-questionnaire">
    <input type="hidden" data-artifact-kind="${first?'draft':'revision'}">
    <input type="hidden" data-artifact-status="${key}" value="${first?'first_version':'modified'}">
    <label>${first?'这次做出了什么？（一句话）':'与上一版相比，具体改了什么？（一句话）'}
      <textarea rows="2" data-artifact-note="${key}" maxlength="250" placeholder="${first?'例如：做出了固定画笔的结构。':'例如：把原来的橡皮筋改成魔术贴。'}" ${disabled}></textarea></label>
    <label>这次主要参考什么？<select data-artifact-source="${key}" ${disabled}>
      <option value="self">自己观察或测试</option>
      <option value="peer">同伴的建议</option>
      <option value="ai">AI的建议</option>
      <option value="teacher">课堂资料或老师</option>
      <option value="mixed">结合了多种来源</option>
      <option value="unknown">还没确定</option>
    </select></label>
    <label>AI建议最后怎样处理？<select data-artifact-ai-role="${key}" ${disabled}>
      <option value="not_used">这次没有参考AI建议</option>
      <option value="direct_adopt">直接采用</option>
      <option value="adapted">修改后采用</option>
      <option value="viewed_not_adopted">看过但没采用</option>
      <option value="unsure">还没决定</option>
    </select></label>
  </div>`;
}
function artifactUploadPanelHtml(a, versions, carryOptions, options, hidden=false){
  const disabled=(state.record.submitted_at||state.session_locked||artifactStepCompleted(a.key))?'disabled':'';
  if(String(a.key||'').includes('wear'))return `<div class="prototype-upload-editor ${hidden?'hidden':''}" data-prototype-upload="${esc(a.key)}" data-artifact-card="${esc(a.key)}"><p class="small">只需上传与该版对应的真实佩戴照片，不用重复填写修改说明。</p><input type="hidden" data-artifact-kind="${versions.length?'revision':'draft'}"><div class="row"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?'继续上传配套照片':'尚未上传'}</span></div><button type="button" class="btn ghost mini" data-cancel-prototype="${esc(a.key)}">取消</button></div>`;
  return `<div class="prototype-upload-editor ${hidden?'hidden':''}" data-prototype-upload="${esc(a.key)}" data-artifact-card="${esc(a.key)}">
    <h4>${versions.length?'上传新增版本':`上传${esc(a.book_item_label||'设计/原型')}`}</h4>
    <p class="small">写一句变化、选好依据，再上传照片；旧版保留。</p>
    ${artifactQuestionnaireHtml(a,versions,carryOptions,options)}
    <div class="row"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?`已有${versions.length}条版本记录`:'尚未上传'}</span></div>
    <button type="button" class="btn ghost mini" data-cancel-prototype="${esc(a.key)}">暂不上传，继续编辑</button>
  </div>`;
}
function prototypeVersionPageHtml(versions, index, itemLabel='作品'){
  if(!versions.length) return `<div class="prototype-empty"><div class="prototype-empty-icon"><icon>+</icon></div><h3>尚未上传${esc(itemLabel)}</h3><p class="small">上传当前真实的设计/制作状态。未完成的部分如实说明，之后可以继续迭代。</p></div>`;
  const v=versions[index]||versions[versions.length-1];
  const label=v.kind==='correction'?'误传更正记录':`${itemLabel}版本记录 ${v.version_no||index+1}`;
  const bases=Array.isArray(v.change_bases)?v.change_bases:[];
  const roleLabels={not_used:'没有参考AI建议',direct_adopt:'直接采用',adapted:'调整后采用',inspired:'受到启发，形成不同方案',viewed_not_adopted:'看过但未采用',unsure:'不确定/无法判断'};
  const statusLabels={first_version:'首次原型版本',modified:'设计/结构发生修改',not_modified:'未改变设计，仅补充呈现',tested_no_change:'测试后暂未修改'};
  return `<div class="prototype-page"><div class="prototype-page-meta"><strong>${esc(label)}</strong><span>${index+1} / ${versions.length}</span></div><img class="prototype-page-image" src="${artifactUrl(v)}" alt="${esc(label)}照片"><p class="small">上传时间：${esc(String(v.uploaded_at||'').slice(0,16))}</p>${v.modification_status?`<p class="small">版本性质：${esc(statusLabels[v.modification_status]||v.modification_status)}</p>`:''}${v.change_note?`<div class="answer-block"><strong>本版变化/制作状态</strong><p>${esc(v.change_note)}</p></div>`:''}${bases.length?`<p class="small">形成依据：${bases.map(esc).join('、')}</p>`:''}${v.ai_usage_role?`<p class="small">AI建议处理方式：${esc(roleLabels[v.ai_usage_role]||v.ai_usage_role)}</p>`:''}</div>`;
}
function prototypeVersionBookHtml(a, meta){
  const versions=state.artifact_versions?.[a.key] || (meta?[meta]:[]);
  const itemLabel=a.book_item_label||'作品';
  const required=(a.required||artifactRequiredForCurrentFlow(a.key))?'<span class="req">本任务必交</span>':'<span class="optional">选交</span>';
  const disabled=(state.record.submitted_at||state.session_locked||artifactStepCompleted(a.key))?'disabled':'';
  const safeIndex=Math.min(Math.max(0,prototypeVersionIndexByKey[a.key]??Math.max(0,versions.length-1)),Math.max(0,versions.length-1));
  prototypeVersionIndexByKey[a.key]=safeIndex;
  const recentReplies=(state.chat_messages||[]).filter(m=>m.role==='assistant'&&m.message_id).slice(-12).reverse();
  const carryId=state.carry_from?.session?.id||'';
  const carryVersions=Object.entries(state.carry_artifact_versions||{}).flatMap(([key,entries])=>entries.map((v,i)=>({...v,carry_key:key,ordinal:i+1})));
  const carryOptions=carryVersions.map(v=>`<option value="${esc(`${carryId}:${v.version_id}`)}">${esc(carryId)} · ${esc(v.carry_key)} · ${v.original_order_unknown?'旧图（顺序未知）':`第${v.ordinal}版`}</option>`).join('');
  const viewer=prototypeVersionPageHtml(versions,safeIndex,itemLabel);
  return `<div class="upload-card prototype-book-card" data-prototype-book="${esc(a.key)}" data-prototype-item-label="${esc(itemLabel)}"><div class="row between"><div><strong>${esc(a.label)} ${required}</strong><p class="small">${esc(a.helper)}；有实际修改才上传新版本，旧版保留。</p></div><span class="badge">${versions.length?`已保存 ${versions.length} 张照片`:'尚无记录'}</span></div>
    <div data-prototype-viewer="${esc(a.key)}">${viewer}</div>
    <div class="row prototype-page-controls"><button type="button" class="btn secondary mini" data-prototype-prev="${esc(a.key)}" ${!versions.length||safeIndex===0?'disabled':''}>上一版</button><button type="button" class="btn secondary mini" data-prototype-next="${esc(a.key)}" ${!versions.length||safeIndex>=versions.length-1?'disabled':''}>下一版</button><button type="button" class="btn orange mini" data-prototype-iterate="${esc(a.key)}" ${disabled}>${versions.length?'上传更新后的照片':`上传${esc(itemLabel)}`}</button></div>
    ${artifactUploadPanelHtml(a,versions,carryOptions,recentReplies,!(!versions.length))}
  </div>`;
}
function artifactHtml(a, meta){
  const versions=state.artifact_versions?.[a.key] || (meta?[meta]:[]);
  const req=(a.required||artifactRequiredForCurrentFlow(a.key))?'<span class="req">本任务必交</span>':'<span class="optional">选交</span>';
  const disabled=(state.record.submitted_at||state.session_locked||artifactStepCompleted(a.key))?'disabled':'';
  const recentReplies=(state.chat_messages||[]).filter(m=>m.role==='assistant'&&m.message_id).slice(-12).reverse();
  const options=recentReplies;
  const carryId=state.carry_from?.session?.id||'';
  const carryVersions=Object.entries(state.carry_artifact_versions||{}).flatMap(([key,entries])=>entries.map((v,i)=>({...v,carry_key:key,ordinal:i+1})));
  const carryOptions=carryVersions.map(v=>`<option value="${esc(`${carryId}:${v.version_id}`)}">${esc(carryId)} · ${esc(v.carry_key)} · ${v.original_order_unknown?'旧图（顺序未知）':`第${v.ordinal}版`}</option>`).join('');
  if(a.version_book) return prototypeVersionBookHtml(a,meta);
  if((state.session?.paired_artifacts||[]).some(p=>p.wear===a.key)){
    const gallery=versions.map((v,i)=>`<div class="upload-preview"><img src="${artifactUrl(v)}" alt="第${i+1}版佩戴图"><p class="small">第${i+1}版佩戴图</p></div>`).join('');
    return `<div class="upload-card" data-artifact-card="${esc(a.key)}"><strong>${esc(a.label)}</strong><p class="small">请把对应原型真正戴在手上拍摄，与本版整体图配对保存。不要上传未佩戴的照片。</p><div class="photo-grid">${gallery}</div><input type="hidden" data-artifact-kind="${esc(a.key)}" value="${versions.length?'revision':'draft'}"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?'已有'+versions.length+'张':'尚未上传'}</span></div>`;
  }
  if(a.progress_only){
    const gallery=versions.length?`<div class="photo-grid" style="margin:10px 0">${versions.map((v,i)=>`<div class="upload-preview"><img src="${artifactUrl(v)}" alt="制作进度记录"><p class="small">进度记录 ${i+1} · ${esc(String(v.uploaded_at||'').slice(0,16))}</p>${v.change_note?`<p class="small">${esc(v.change_note)}</p>`:''}</div>`).join('')}</div>`:'';
    return `<div class="upload-card" data-artifact-card="${esc(a.key)}"><strong>${esc(a.label)} ${req}</strong><p class="small">${esc(a.helper)}；仅用于记录制作进度，不代表设计发生迭代。</p>${gallery}<div class="row"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?`已保存${versions.length}条进度记录`:'尚未上传'}</span></div><input type="hidden" data-artifact-kind="${esc(a.key)}" value="progress"></div>`;
  }
  const gallery=versions.length?`<div class="photo-grid" style="margin:10px 0">${versions.map((v,i)=>`<div class="upload-preview"><img src="${artifactUrl(v)}" alt="第${i+1}版图纸"><p class="small">第${i+1}版 · ${v.original_order_unknown?'旧图（顺序未知）':v.kind==='correction'?'误传更正':v.kind==='revision'?'修改版':v.kind==='draft'?'初稿':'旧版'} · ${esc(String(v.uploaded_at||'').slice(0,16))}</p>${v.change_note?`<p class="small">${esc(v.change_note)}</p>`:''}</div>`).join('')}</div>`:'';
  const standardQuestionnaire=a.version_questionnaire?artifactQuestionnaireHtml(a,versions,carryOptions,options):`<input type="hidden" data-artifact-kind="${versions.length?'revision':'draft'}">`;
  return `<div class="upload-card" data-artifact-card="${esc(a.key)}"><strong>${esc(a.label)} ${req}</strong><p class="small">${esc(a.helper)}；历史版本不会删除。</p>${gallery}<div class="row" style="margin-top:12px"><input type="file" data-artifact="${esc(a.key)}" accept="image/jpeg,image/png,image/webp" ${disabled}><span class="small" data-upload-status="${esc(a.key)}">${versions.length?`已有${versions.length}条记录，仍可再传`:'尚未上传'}</span></div>${standardQuestionnaire}<p class="small">选照片后自动保存，旧照片不会被删除。</p></div>`;
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
  const variantLabel=state.participant.is_test ? `${id}测试预览` : 'AI设计助手';
  const requiredOnce=Boolean(state.session.ai_use_required_once);
  const activeFlowStep=state.session.task_flow?.steps?.find(x=>x.key===currentW8ChatStep());
  const flowBadge=activeFlowStep?`本阶段至少${Number(activeFlowStep.min_ai_exchanges||0)}轮完整对话`:'';
  const policyText=state.session.ai_instruction || '本节任务中可以使用AI设计助手，也可以不使用。';
  const chatImageEnabled=state.session.chat_image_enabled!==false;
  return `${reminder}<section class="card sticky-card ai-card"><div class="row between"><div><span class="eyebrow">${esc(variantLabel)}</span><h2>AI设计助手</h2></div><span class="badge">${esc(flowBadge|| (requiredOnce?'本节至少使用1次':'可选'))}</span></div>
    ${variantBlocked?'<div class="notice warn">本节内容还在准备中，请稍等老师完成课堂设置。</div>':`<p class="small">${esc(policyText)}</p>
    <button class="btn secondary" id="openAi">${state.record.first_ai_open_at?'继续使用AI':'打开AI助手'}</button>
    <div id="chatBox" class="chat-embed ${chatOpened?'':'hidden'}">
      ${state.participant.is_test?`<div class="chat-meta small" id="chatMeta">${id}测试预览｜首次打开：${fmtLatency(state.record.first_ai_open_latency_seconds)}｜首次发送：${fmtLatency(state.record.first_user_message_latency_seconds)}</div>`:''}
      <div class="messages compact-messages" id="messages"></div>
      <div id="thinking" class="spinner hidden">AI正在查看并回复……</div><div id="sendError" class="notice warn hidden"></div>
      ${chatImageEnabled?`<div id="chatImagePreview" class="chat-image-preview hidden"><img id="chatImageThumb" alt="待发送图片"><div><strong>已选择图片</strong><p class="small">请用文字告诉AI你想让它帮你看什么。</p><button type="button" class="btn ghost mini" id="removeChatImage">移除图片</button></div></div>
      <div class="composer-tools"><label class="attach-btn ${(state.record.submitted_at||state.session_locked)?'disabled':''}">＋ 添加草图 / 原型照片<input id="chatImage" type="file" accept="image/jpeg,image/png,image/webp" ${(state.record.submitted_at||state.session_locked)?'disabled':''}></label><span class="small">每次最多1张，≤10MB</span></div>`:'<p class="small">本节不需要上传图片，请直接使用文字与AI交流。</p>'}
      <div class="composer-wrap"><textarea id="message" placeholder="输入你现在想问AI的内容……" ${(state.record.submitted_at||state.session_locked)?'disabled':''}></textarea><button class="btn" id="send" ${(state.record.submitted_at||state.session_locked)?'disabled':''}>发送</button></div>
    </div>`}</section>`;
}


const DEFAULT_NO_HISTORY_REASONS = [
  {value:'no_ai',label:'上一次没有使用 AI。'},
  {value:'no_question',label:'上一次没有遇到需要向 AI 求助的问题。'},
  {value:'no_record',label:'上一次使用了 AI，但没有留下可回顾的对话记录。'},
  {value:'other',label:'其他原因。'},
];
// v11.58: 题目与选项分层、单选按钮固定宽度、长文字自然换行；页面不返回也不渲染评分依据字段。
function quizFieldsetHtml(q, index, saved){
  return `<fieldset class="micro-question"><legend><span class="micro-question-index">${index+1}.</span> ${esc(q.question)}</legend>
    <div class="micro-options">${(q.options||[]).map((opt,j)=>`<label class="micro-option"><input type="radio" name="orientation_${esc(q.id)}" value="${j}" ${Number(saved?.[q.id])===j?'checked':''}><span>${esc(opt)}</span></label>`).join('')}</div>
  </fieldset>`;
}
function reflectionOrientationHtml(o){
  const saved=o.saved_answers||{};
  const opts=o.personal_query_options||[];
  const hasHistory=Boolean(o.has_prior_history)&&opts.length>0;
  const cards=o.cards||[];
  const practice=o.strategy_micro_lesson?`<section class="micro-lesson" aria-label="求助小练习"><h2>① 求助小练习</h2><p class="small">读一读下面的情境，选择你认为更合适的一种做法。</p>${(o.checks||[]).map((q,i)=>quizFieldsetHtml(q,i,saved)).join('')}</section>`:'';
  let reviewHtml='';
  if(hasHistory){
    const pairs=opts.map((ref,i)=>({ref:`${ref.session_id}:${ref.message_index}`,title:`上次对话 ${i+1} · ${ref.session_id}`,body:cards[i]?.body||[]}));
    const renderExchange=(p,i)=>{
      const checked=(saved.personal_ref&&saved.personal_ref===p.ref)||(!saved.personal_ref&&i===0);
      return `<label class="reflection-exchange ref-choosable">
        <input type="radio" name="reflectionReference" value="${esc(p.ref)}" ${checked?'checked':''} aria-label="选择${esc(p.title)}">
        <span class="reflection-exchange-content"><strong>${esc(p.title)}</strong>
          ${(p.body||[]).map((msg,j)=>`<span class="reflection-bubble ${j===0?'student':'assistant'}">${esc(msg)}</span>`).join('')}
          <span class="reflection-picked">选这段对话作回顾</span>
        </span></label>`;
    };
    reviewHtml=`<div class="reflection-layout">
      <section class="reflection-history" aria-label="上次与AI的交流记录"><h2>② 回顾上次与 AI 交流的情况</h2>
        <p class="small">下面是你自己上一次与 AI 的真实对话。选择其中一条，再简单写一写当时的情况。</p>
        <div class="reflection-exchanges">${pairs.map(renderExchange).join('')}</div></section>
      <section class="reflection-form" aria-label="回顾问题"><h2>③ 想一想当时是怎样处理的</h2>
        <div class="reflection-step"><label for="reflectionDifficulty"><strong>1. 当时你遇到的具体困难是什么？</strong></label>
          <textarea id="reflectionDifficulty" maxlength="600" rows="2" placeholder="简单写一句当时的困难">${esc(saved.reflection_difficulty||'')}</textarea></div>
        <div class="reflection-step"><label for="reflectionReplyReview"><strong>2. AI 的回复帮到了什么？后来你是怎么做的？</strong></label>
          <textarea id="reflectionReplyReview" maxlength="600" rows="2" placeholder="写一条具体的帮助，以及你后来的处理">${esc(saved.reflection_reply_review||'')}</textarea></div>
        <div class="reflection-step"><label for="reflectionRevised"><strong>3. 如果再问一次，你会怎样问？</strong></label>
          <textarea id="reflectionRevised" maxlength="600" rows="2" placeholder="写出你自己的问法">${esc(saved.revised_question||'')}</textarea>
          <label for="reflectionReason" class="small">为什么想这样问？</label>
          <textarea id="reflectionReason" maxlength="600" rows="2" placeholder="简单说一句理由">${esc(saved.reflection_reason||'')}</textarea></div>
      </section></div>`;
  }else{
    const reasons=(o.no_history_reason_options&&o.no_history_reason_options.length)?o.no_history_reason_options:DEFAULT_NO_HISTORY_REASONS;
    const chosen=String(saved.no_history_reason||'');
    reviewHtml=`<section class="no-history-panel" aria-label="上次与AI交流的情况"><h2>② 回顾上次与 AI 交流的情况</h2>
      <p class="no-history-note">${esc(o.no_history_note||'暂时没有找到你上一次与 AI 交流的记录。可以根据实际情况选择下面的原因。')}</p>
      <fieldset class="micro-question no-history-question"><legend>选择符合自己实际情况的选项</legend>
        <div class="micro-options">${reasons.map(r=>`<label class="micro-option"><input type="radio" name="noHistoryReason" value="${esc(r.value)}" ${chosen===r.value?'checked':''}><span>${esc(r.label)}</span></label>`).join('')}</div>
        <label class="no-history-detail ${chosen==='other'?'':'hidden'}" id="noHistoryDetailWrap">请简单补充说明<textarea id="noHistoryDetail" maxlength="300" rows="2" placeholder="用一两句话说明实际情况即可">${esc(saved.no_history_reason_detail||'')}</textarea></label>
      </fieldset>
      <p class="small">没有找到记录不影响你继续完成本环节，按实际情况选择即可。</p>
    </section>`;
  }
  return `<div class="single-column-page"><section class="card orientation-shell reflection-shell">
    <span class="eyebrow">进入本节任务前</span>
    <h1>${esc(o.title||'求助小练习与上次交流回顾')}</h1><p class="lead">${esc(o.intro||'')}</p>
    ${practice}${reviewHtml}
    <div id="orientationError" class="notice warn hidden" role="alert"></div>
    <div class="orientation-actions"><button class="btn orange" id="completeOrientation" type="button">${esc(o.button||'保存，进入下一节')}</button><span class="small">保存后继续下一项任务</span></div>
  </section></div>`;
}

function orientationHtml(){
  const o=state?.orientation;
  if(!o) return '<div class="notice warn">本节内容暂时无法读取，请刷新页面。</div>';
  if(o.reflection_activity && o.mode==='supported') return reflectionOrientationHtml(o);
  const saved=o.saved_answers||{};
  const cards=(o.cards||[]).map(c=>`<article class="orientation-card"><h3>${esc(c.title||'')}</h3>${(c.body||[]).map(x=>`<p>${esc(x)}</p>`).join('')}${c.example_bad?`<div class="orientation-example muted-example">${esc(c.example_bad)}</div>`:''}${c.example_good?`<div class="orientation-example good-example">${esc(c.example_good)}</div>`:''}</article>`).join('');
  let activity='';
  if(o.mode==='supported' && (o.checks||[]).length){
    activity=`<div class="orientation-checks"><h3>求助小练习</h3><p class="small">读一读下面的情境，选择你认为更合适的一种做法。</p>${(o.checks||[]).map((q,i)=>quizFieldsetHtml(q,i,saved)).join('')}</div>`;
  }else if(o.mode==='control'){
    activity=`<div class="orientation-checks"><h3>确认一下</h3>${o.neutral_design_note_required?`<label>${esc(o.neutral_label_1||'本节你准备观察装置的什么具体表现？')}<textarea id="neutralObservation" rows="3" maxlength="600" placeholder="按真实情况简单填写"></textarea></label><label>${esc(o.neutral_label_2||'如果测试结果与预想不同，你打算先做什么检查？')}<textarea id="neutralNextstep" rows="3" maxlength="600" placeholder="按真实情况简单填写"></textarea></label>`:''}${(o.acknowledgements||[]).map((x,i)=>`<label class="orientation-ack"><input type="checkbox" name="orientation_ack_${i}"><span>${esc(x)}</span></label>`).join('')}</div>`;
  }
  return `<div class="single-column-page"><section class="card orientation-shell"><span class="eyebrow">进入本节任务前</span><h1>${esc(o.title||'求助小练习')}</h1><p class="lead">${esc(o.intro||'')}</p><div class="orientation-grid">${cards}</div>${activity}<div id="orientationError" class="notice warn hidden" role="alert"></div><div class="orientation-actions"><button class="btn orange" id="completeOrientation" type="button">${esc(o.button||'保存，进入下一节')}</button><span class="small">保存后继续下一项任务</span></div></section></div>`;
}
// v11.58: 开始记录与提交记录必须串行，避免异步 start 请求在 complete 之后覆盖答案和完成状态。
let orientationStartPromise = Promise.resolve();
let orientationStartKey = '';
function startOrientationIfNeeded(){
  const key=`${id}:${state?.session?.id||''}`;
  if(orientationStartKey===key) return orientationStartPromise;
  orientationStartKey=key;
  if(!state?.learning_gate || state?.orientation?.started_at){orientationStartPromise=Promise.resolve();return orientationStartPromise;}
  orientationStartPromise=(async()=>{
    try{
      const r=await App.api('/session/orientation/start',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});
      if(r?.orientation && state?.orientation) state.orientation={...state.orientation,started_at:r.orientation.started_at||state.orientation.started_at};
    }catch(e){orientationErrorMessage(e.message);}
  })();
  return orientationStartPromise;
}
function orientationErrorMessage(message){
  const box=document.getElementById('orientationError');
  if(box){box.textContent=message||'保存失败，请稍后重试。';box.classList.remove('hidden');}
}
async function completeOrientation(){
  const o=state?.orientation; if(!o) return;
  const box=document.getElementById('orientationError'); if(box)box.classList.add('hidden');
  const answers={};
  const hasHistory=Boolean(o.has_prior_history)&&(o.personal_query_options||[]).length>0;
  if(o.mode==='supported'){
    if(o.reflection_activity){
      if(hasHistory){
        answers.personal_ref=document.querySelector('input[name="reflectionReference"]:checked')?.value||'';
        if(!answers.personal_ref) return orientationErrorMessage('请先选择一条上次与 AI 的对话。');
        answers.reflection_difficulty=document.getElementById('reflectionDifficulty')?.value||'';
        answers.reflection_reply_review=document.getElementById('reflectionReplyReview')?.value||'';
        answers.revised_question=document.getElementById('reflectionRevised')?.value||'';
        answers.reflection_reason=document.getElementById('reflectionReason')?.value||'';
        if(!answers.reflection_difficulty.trim()) return orientationErrorMessage('请简单写下当时遇到的具体困难。');
        if(!answers.reflection_reply_review.trim()) return orientationErrorMessage('请简单写下AI回复帮到了什么、你后来怎样处理。');
        if(!answers.revised_question.trim()) return orientationErrorMessage('请写一句如果再问一次你会怎样问。');
        if(!answers.reflection_reason.trim()) return orientationErrorMessage('请简单说明为什么这样改。');
      }else{
        answers.no_history_reason=document.querySelector('input[name="noHistoryReason"]:checked')?.value||'';
        if(!answers.no_history_reason) return orientationErrorMessage('请选择一个符合自己实际情况的原因。');
        answers.no_history_reason_detail=document.getElementById('noHistoryDetail')?.value||'';
        if(answers.no_history_reason==='other'&&!answers.no_history_reason_detail.trim()) return orientationErrorMessage('选择了“其他原因”，请简单补充说明。');
      }
    }
    for(const q of o.checks||[]){
      const checked=document.querySelector(`input[name="orientation_${q.id}"]:checked`);
      if(!checked) return orientationErrorMessage('请先完成全部求助小练习。');
      answers[q.id]=Number(checked.value);
    }
  }else{
    if(o.neutral_design_note_required){answers.neutral_observation=document.getElementById('neutralObservation')?.value||'';answers.neutral_nextstep=document.getElementById('neutralNextstep')?.value||'';}
    answers.acknowledged=(o.acknowledgements||[]).map((_,i)=>Boolean(document.querySelector(`input[name="orientation_ack_${i}"]`)?.checked));
    if(answers.acknowledged.some(v=>!v)) return orientationErrorMessage('请先确认已经阅读全部说明。');
  }
  const btn=document.getElementById('completeOrientation');
  if(btn){btn.disabled=true;btn.textContent='正在保存……';}
  try{
    await orientationStartPromise;
    const r=await App.api('/session/orientation/complete',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,answers})});
    if(!r?.completed) throw new Error('保存没有完成，请重试一次。');
    // 保存成功后先明确更新本地学习状态，再重新拉取服务端状态进入下一环节。
    state.orientation={...(state.orientation||{}),completed:true,completed_at:r.orientation?.completed_at||new Date().toISOString(),saved_answers:answers};
    state.learning_gate='';
    await load();
    if(state.learning_gate==='orientation') orientationErrorMessage('内容已保存，但页面还没有更新，请刷新页面重试。');
  }catch(e){
    orientationErrorMessage(e.message);
    if(btn){btn.disabled=false;btn.textContent=o.button||'保存，进入下一节';}
  }
}
function wireOrientation(){
  document.getElementById('completeOrientation')?.addEventListener('click',completeOrientation);
  document.querySelectorAll('input[name="noHistoryReason"]').forEach(r=>r.addEventListener('change',()=>{
    const chosen=document.querySelector('input[name="noHistoryReason"]:checked')?.value||'';
    const wrap=document.getElementById('noHistoryDetailWrap');
    if(wrap)wrap.classList.toggle('hidden',chosen!=='other');
  }));
  startOrientationIfNeeded();
}


function questionnaireHtml(slot){
  const q=state?.questionnaire?.[slot];
  if(!q) return '<div class="notice warn">问卷暂时无法读取，请刷新页面。</div>';
  const scale=q.meta?.scale||[];
  const items=q.items||[];
  return `<section class="card questionnaire-card"><span class="eyebrow">课堂小问卷</span><h1>${esc(q.meta?.title||'课堂小问卷')}</h1><p class="lead">${esc(q.meta?.instruction||'请按真实情况作答。')}</p><div class="notice"><strong>请注意：</strong>请按真实情况选择，没有正确或错误答案。</div><form id="questionnaireForm" class="questionnaire-form">${items.map((item,idx)=>`<fieldset class="question-item"><legend>${idx+1}. ${esc(item.text)}</legend><div class="likert-row">${scale.map(opt=>`<label><input type="radio" name="q_${esc(item.id)}" value="${opt.value}" required><span>${opt.value}<small>${esc(opt.label)}</small></span></label>`).join('')}</div></fieldset>`).join('')}<div id="questionnaireError" class="notice warn hidden"></div><button class="btn orange" type="submit">提交小问卷</button></form></section>`;
}

async function submitQuestionnaire(slot){
  const form=document.getElementById('questionnaireForm');
  const responses={};
  for(const item of state.questionnaire[slot].items||[]){
    const checked=form.querySelector(`input[name="q_${item.id}"]:checked`);
    if(!checked){ const e=document.getElementById('questionnaireError'); e.textContent='请完成所有题目后再提交。'; e.classList.remove('hidden'); return; }
    responses[item.id]=Number(checked.value);
  }
  if(!confirm('确认提交小问卷吗？提交后不能修改。')) return;
  try{
    await App.api(`/questionnaire/${slot}`,{method:'POST',body:JSON.stringify({participantId:id,responses})});
    await load();
  }catch(x){ const e=document.getElementById('questionnaireError'); e.textContent=x.message; e.classList.remove('hidden'); }
}

function gateHtml(){
  if(state.task_gate==='questionnaire_pre') return `<div class="single-column-page">${questionnaireHtml('pre')}</div>`;
  if(state.task_gate==='questionnaire_post') return `<div class="single-column-page"><section class="card"><span class="eyebrow">本节任务已完成</span><h2>课末小问卷</h2><p>请按真实情况完成下面的小问卷。</p></section>${questionnaireHtml('post')}</div>`;
  if(state.task_gate==='awaiting_assignment') return `<div class="single-column-page"><section class="card"><span class="eyebrow">本节任务暂未开放</span><h1>请稍等老师完成课堂设置</h1><p class="lead">老师正在准备本节内容，设置完成后点击下面按钮刷新即可。</p><button class="btn" id="refreshAssignment">刷新状态</button></section></div>`;
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

function w8StepDone(stepKey){return Boolean(state?.task_progress?.completed_steps?.includes(stepKey));}
function w8Count(stepKey){return Number(state?.task_progress?.ai_exchange_counts?.[stepKey]||0);}
function updateW8ExchangeCounter(){
  if(!state?.session?.task_flow)return;
  for(const step of state.session.task_flow.steps||[]){
    const el=document.querySelector(`[data-w8-exchange-count="${step.key}"]`);
    if(el)el.textContent=String(w8Count(step.key));
  }
}
function w8Artifact(key){return (state?.session?.artifacts||[]).find(a=>a.key===key);}

function scienceDiagramCardsHtml(){
 const cards=[
  ['摩擦与防滑','<svg viewBox="0 0 230 100" aria-label="摩擦与防滑示意图"><rect x="42" y="23" width="145" height="52" rx="18" fill="#e3e9e7"/><rect x="68" y="40" width="98" height="17" rx="7" fill="#d5a76a"/><path d="M78 40v17m16-17v17m16-17v17m16-17v17m16-17v17" stroke="#8a6e45" stroke-width="2"/><text x="115" y="17" text-anchor="middle">接触与固定</text><text x="115" y="95" text-anchor="middle">检查是否滑动</text></svg>','接触面间的摩擦可帮助固定，是否防滑需实际检验。'],
  ['弹性与松紧','<svg viewBox="0 0 230 100" aria-label="弹性示意图"><rect x="26" y="30" width="32" height="42" rx="8" fill="#c8dce8"/><rect x="174" y="30" width="32" height="42" rx="8" fill="#c8dce8"/><path d="M57 49Q75 15 93 49T129 49T175 49" fill="none" stroke="#c98d64" stroke-width="8"/><text x="115" y="17" text-anchor="middle">松紧带</text><text x="115" y="95" text-anchor="middle">过紧过松都要调整</text></svg>','弹性材料可拉伸和恢复，固定时也要兼顾舒适。'],
  ['接触面积与压力','<svg viewBox="0 0 230 100" aria-label="接触面积示意图"><rect x="25" y="38" width="70" height="33" rx="14" fill="#eeddb8"/><rect x="40" y="49" width="43" height="10" rx="5" fill="#cc875d"/><rect x="137" y="32" width="70" height="45" rx="14" fill="#eeddb8"/><rect x="152" y="40" width="43" height="28" rx="5" fill="#cc875d"/><text x="61" y="23" text-anchor="middle">窄带</text><text x="172" y="23" text-anchor="middle">宽带</text><text x="115" y="95" text-anchor="middle">比较压力与接触面积</text></svg>','在受力相近时，扩大接触面积通常能减小平均压强。'],
  ['结构与支撑','<svg viewBox="0 0 230 100" aria-label="结构支撑示意图"><rect x="30" y="48" width="70" height="10" fill="#d2b18c"/><path d="M133 65L145 38L159 65L173 38L187 65L201 38L212 65" fill="none" stroke="#b68c65" stroke-width="6"/><text x="66" y="24" text-anchor="middle">平板</text><text x="175" y="24" text-anchor="middle">折叠结构</text><text x="115" y="95" text-anchor="middle">比较形状与支撑效果</text></svg>','材料和结构形状都会影响支撑效果，需要实际比较。']
 ];
 return '<div class="science-mini-grid">'+cards.map(x=>'<article class="science-mini-card"><strong>'+x[0]+'</strong>'+x[1]+'<p>'+x[2]+'</p></article>').join('')+'</div>';
}
function compactTaskHeader(s){return '<section class="card lesson-compact-head"><span class="eyebrow">'+esc(s.student_label||'本节任务')+'</span><h1>'+esc(s.title)+'</h1><p>'+esc(s.subtitle||'按实际进度继续。')+'</p></section>';}
function w8TaskFlowHtml(s,r){
  const done1=w8StepDone('task1'),done2=w8StepDone('task2');
  if(!done1)activeW8Step='task1';
  else if(!activeW8Step)activeW8Step='task2';
  const step=activeW8Step;
  const step1ScienceFields=(s.fields||[]).filter(f=>f.stage==='task1'&&['l06_science_point','l06_science_application'].includes(f.key)).map(f=>fieldHtml(f,displayTextFields()?.[f.key]??'',done1)).join('');
  const checkFields=(s.fields||[]).filter(f=>f.stage==='task1'&&f.key.startsWith('l06_check')).map(f=>fieldHtml(f,displayTextFields()?.[f.key]??'',done1)).join('');
  const peerFields=(s.fields||[]).filter(f=>f.stage==='task1'&&['l06_check_evidence','l06_peer','l06_focus'].includes(f.key)).map(f=>fieldHtml(f,displayTextFields()?.[f.key]??'',done1)).join('');
  const step1MaterialFields=(s.fields||[]).filter(f=>f.stage==='task1'&&f.key==='l06_material_plan').map(f=>fieldHtml(f,displayTextFields()?.[f.key]??'',done1)).join('');
  const step2Fields=(s.fields||[]).filter(f=>f.stage==='task2').map(f=>fieldHtml(f,displayTextFields()?.[f.key]??'',!done1||done2)).join('');
  const previousSheet=w8Artifact('l06_previous_task_sheet');
  const scienceSheet=w8Artifact('l06_science_learning_sheet');
  const designVersion=w8Artifact('l06_design_version');
  const prototypeVersions=w8Artifact('l06_prototype_versions');
  const prototypeWear=w8Artifact('l06_wear_versions');
  const buildProgress=w8Artifact('l06_build_progress');
  const counts1=w8Count('task1'),counts2=w8Count('task2');
  const min1=Number(s.task_flow?.steps?.find(x=>x.key==='task1')?.min_ai_exchanges||10);
  const min2=Number(s.task_flow?.steps?.find(x=>x.key==='task2')?.min_ai_exchanges||5);
  const disabled=(state.record.submitted_at||state.session_locked)?'disabled':'';
  const task1Panel=`<section class="card w8-step-panel ${step==='task1'?'':'hidden'}" data-w8-step-panel="task1">
    <div class="row between"><div><span class="eyebrow">任务一 · 设计完善</span><h2>把科学知识用进自己的设计图</h2></div><span class="badge">${done1?'已提交':'进行中'}</span></div>
    <p>先上传上一节课的任务单/设计记录，再阅读教师提供的科学知识资料。至少选择一个知识点，标注它在设计图中的具体位置和作用；随后从教师提供的材料中选择要使用的材料，并写明用途。</p>
    <div class="notice">AI助手在本任务全程可用。提交前必须完成至少10轮完整对话（你发送一条消息并收到AI回复算一轮）。清楚的问题直接问，不要为了次数发送无意义内容。</div>
    <h3>1. 查看已有成果并检查</h3><p class="small">先检查原图和材料，再请同伴提出一条具体意见。没有发现缺点时，说清哪些还没有验证。</p><div class="artifact-list">${previousSheet?artifactHtml(previousSheet,r.artifacts?.[previousSheet.key]):''}</div><div class="form">${checkFields}${peerFields}</div>
    <h3>2. 学习科学知识并标注应用</h3>${scienceDiagramCardsHtml()}<p class="small">先阅读下面的简明知识卡，再对照教师发放的课堂资料。至少选择一个确实适用于自己设计的知识点；不要只抄名称，要说明它用在图纸的哪个位置、帮助解决什么问题。</p><div class="resource-pack"><div class="resource-pack-head"><span class="eyebrow">科学知识</span><h3>本节可参考的知识点</h3><p class="small">配图和说明全部使用中文；请选择真正能用在自己设计中的知识。</p><img src="/assets/science-guide-zh.svg" alt="中文科学图示：摩擦与防滑、弹性与固定、接触面积与压强、材料结构支撑" style="width:100%;height:auto;border-radius:12px;display:block;margin:12px 0"></div><div class="resource-grid">${(s.resources||[]).map(r=>`<article class="resource-card"><h4>${esc(r.title)}</h4><ul>${(r.items||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></article>`).join('')}</div></div><div class="form">${step1ScienceFields}</div>
    <h3>3. 选择材料并标注用途</h3><p class="small">材料不要求全部使用。请先查看教师提供的材料清单，再选择真正需要的材料，并在学习单和设计图上标出使用位置和用途。</p>${materialBankHtml(s.materials||[])}<div class="form">${step1MaterialFields}</div><h3>4. 上传完成标注的学习单</h3><p class="small">请上传已写明科学知识应用位置、材料选择和用途的学习单照片。纸质学习单原件请保留。</p><div class="artifact-list">${scienceSheet?artifactHtml(scienceSheet,r.artifacts?.[scienceSheet.key]):''}</div>
    <h3>5. 上传完善后的设计图</h3><div class="artifact-list">${designVersion?artifactHtml(designVersion,r.artifacts?.[designVersion.key]):''}</div>
    <div class="w8-counter"><div><strong>AI完整对话轮次</strong><span><b data-w8-exchange-count="task1">${counts1}</b> / ${min1}</span></div><div class="w8-meter"><i style="width:${Math.min(100,counts1/min1*100)}%"></i></div><p class="small">只有学生消息和对应AI回复都成功保存，才计为一轮。历史课次聊天、AI单独回复和未成功获得回复的消息不计入；轮次门槛只用于本节提交，不代表求助质量。</p></div>
    ${done1?'<div class="notice ok">任务一已提交，任务二已解锁。</div>':`<div class="row"><button type="button" class="btn orange" id="submitW8Task1" ${disabled}>提交任务一，进入任务二</button></div><p class="small">提交时平台会检查必填记录、图片和10轮完整AI对话。未完成时可以先保存进度并下节课继续，不会丢失已填内容。</p>`}
  </section>`;
  const task2Panel=`<section class="card w8-step-panel ${step==='task2'?'':'hidden'}" data-w8-step-panel="task2">
    <div class="row between"><div><span class="eyebrow">任务二 · 原型制作</span><h2>领取材料，开始制作第一版原型</h2></div><span class="badge">${done2?'已提交':'进行中'}</span></div>
    ${!done1?'<div class="notice warn">请先完成并提交任务一，才能进入任务二。</div>':''}
    <p>任务一提交后，到老师处领取材料。根据完善后的设计图制作第一版实体原型。制作过程中遇到真实问题，可以随时向AI求助。</p>
    <div class="notice">制作阶段提交前必须完成至少5轮完整AI对话（你发送一条消息并收到AI回复算一轮）。未完成可以保存进度，下一节课继续制作。</div>
    <div class="form">${step2Fields}</div>${materialBankHtml(s.materials||[])}
    <h3>原型版本页</h3><p class="small">作品确实发生结构变化后再上传新版本，系统自动编号并保留以前的照片。每个正式版本都需要整体图和戴在手上的照片；只是制作进度时，使用“进度照片”。</p>
    <div class="artifact-list">${prototypeVersions?artifactHtml(prototypeVersions,r.artifacts?.[prototypeVersions.key]):''}${prototypeWear?artifactHtml(prototypeWear,r.artifacts?.[prototypeWear.key]):''}${prototypeWear?artifactHtml(prototypeWear,r.artifacts?.[prototypeWear.key]):''}</div><p class="small">同一版必须同时保存整体图和佩戴图；尚未完成时可以先保存进度照片，不用冒充正式版本。</p>
    <h3>本节制作进度（非设计迭代）</h3><div class="artifact-list">${buildProgress?artifactHtml(buildProgress,r.artifacts?.[buildProgress.key]):''}</div>
    <div class="w8-counter"><div><strong>AI完整对话轮次</strong><span><b data-w8-exchange-count="task2">${counts2}</b> / ${min2}</span></div><div class="w8-meter"><i style="width:${Math.min(100,counts2/min2*100)}%"></i></div><p class="small">本阶段累计统计；上传V2、V3不需要每次重新累计5轮。只有学生消息和AI回复成功配对才计数；轮次门槛只用于本节提交，不代表求助质量。</p></div>
    ${done2?'<div class="notice ok">任务二已提交。本节记录已完成；后续课时仍可继续追加新的设计/原型版本。</div>':`<div class="row"><button type="button" class="btn orange" id="submitW8Task2" ${!done1||disabled?'disabled':''}>提交任务二，完成本节记录</button></div><p class="small">提交时检查真实的原型整体图、对应佩戴图、5轮完整AI对话及本节回顾。只做了部分的可保存进度。未达到条件时仍可保存退出，下一节课继续。</p>`}
  </section>`;
  const exitAction=state.record.submitted_at&&!state.session_locked
    ? '<button type="button" class="btn secondary" id="reopenSession">继续修改本课记录</button>'
    : '<button type="button" class="btn secondary" id="saveAndExit" '+(state.session_locked?'disabled':'')+'>保存进度并退出</button>';
  return `<section class="card w8-flow-shell"><div class="w8-step-tabs"><button type="button" class="w8-step-tab ${step==='task1'?'active':''} ${done1?'done':''}" id="w8GoTask1">1. 设计完善 ${done1?'✓':''}</button><button type="button" class="w8-step-tab ${step==='task2'?'active':''} ${done1?'':'locked'}" id="w8GoTask2" ${done1?'':'disabled'}>2. 原型制作 ${done2?'✓':''}</button></div>${task1Panel}${task2Panel}${lessonReviewHtml(s)}<div class="row between w8-save-row"><span id="saveStatus" class="small"></span>${exitAction}</div></section>`;
}

// 每节课结束前只回顾当前真实对话，不回忆一周前的对话。课中可以随时保存反思，不影响保存未完成任务。
function lessonReviewHtml(s){
  if(!s?.task_flow || !['W6','W7','W8','W9','W10'].includes(s.id))return '';
  const saved=displayTextFields(),disabled=(state.record.submitted_at||state.session_locked)?'disabled':'';
  const phases=new Set((s.task_flow?.steps||[]).map(x=>x.task_phase));
  const messages=(state.chat_messages||[]).filter(m=>m.role==='assistant' && m.message_id && phases.has(m.task_context?.task_phase));
  const chosen=String(saved.lesson_review_reference||'');
  const selected=messages.filter((m,i)=>i>=messages.length-8 || m.message_id===chosen);
  const has=messages.length>0;
  const neutral=state.ai_variant!=='supported';
  const personal=neutral ? `<p class="small">今天做到了什么、还准备做什么？</p><div class="form">${fieldHtml((s.fields||[]).find(f=>f.key==='lesson_exit_note')||{key:'lesson_exit_note',label:'本节进度简述',required:false},saved.lesson_exit_note||'')}</div>` :
    `<p class="small">选一段本节真实AI回答，简单写下有没有帮助、你怎样处理，以及下次如何把问题说清楚。</p>
     ${has?`<label>本节要回顾的AI回答<select data-field="lesson_review_reference" ${disabled}><option value="">选择真实回答</option>${selected.map(m=>`<option value="${esc(m.message_id)}" ${chosen===m.message_id?'selected':''}>${esc(String(m.content||'').slice(0,70))}</option>`).join('')}</select></label>`:
     `<label>本节未找到可回顾的AI对话<select data-field="lesson_no_history_reason" ${disabled}><option value="">请选择实际原因</option>${['今天没有向AI提问','提问了，但没收到有效回复','平台记录没有显示','其他原因'].map(x=>`<option value="${esc(x)}" ${saved.lesson_no_history_reason===x?'selected':''}>${esc(x)}</option>`).join('')}</select></label>`}
     <div class="form">${(s.fields||[]).filter(f=>(has?['lesson_review_use','lesson_review_next']:['lesson_review_next']).includes(f.key)).map(f=>fieldHtml(f,saved[f.key]||'')).join('')}</div>`;
  return `<section class="card lesson-review" id="lessonReview"><span class="eyebrow">下课前</span><h2>回顾今天的AI交流</h2>${personal}
   <div class="row"><button type="button" class="btn secondary" id="saveLessonReview" ${disabled}>保存本节回顾</button><button type="button" class="btn ghost mini" id="refreshLessonReview">更新本节对话</button><span id="reviewSaveStatus" class="small">${(saved.lesson_review_use||saved.lesson_exit_note)?'已填写':'待填写'}</span></div></section>`;
}
function weeklyTaskFlowHtml(s,r){
  const done1=w8StepDone('task1'),done2=w8StepDone('task2');
  if(!done1)activeW8Step='task1'; else if(!activeW8Step)activeW8Step='task2';
  const selected=activeW8Step||'task1',steps=s.task_flow.steps||[],vals=displayTextFields();
  const panels=steps.map(step=>{
    const done=w8StepDone(step.key),unlocked=step.key==='task1'||done1,disabled=(state.session_locked||r.submitted_at||done||!unlocked);
    const fields=(s.fields||[]).filter(f=>f.stage===step.key).map(f=>fieldHtml(f,vals[f.key]||'',disabled)).join('');
    const related=step.key==='task2'?(s.artifacts||[]).map(a=>artifactHtml(a,r.artifacts?.[a.key])).join(''):'';
    const count=w8Count(step.key),minimum=Number(step.min_ai_exchanges||0);
    const message=step.key==='task1'?'查看已保存的成果，按观察事实自检；与同伴复核，再和AI讨论需要解决或验证的事项。':s.subtitle;
    return `<section class="card w8-step-panel ${selected===step.key?'':'hidden'}">
      <div class="row between"><h2>${esc(step.label)}</h2><span class="badge">${done?'已完成':'进行中'}</span></div>
      <p>${esc(message)}</p><div class="form">${fields}</div>
      ${related?`<div class="artifact-list">${related}</div><p class="small">如产生新版本，请配套上传原型整体图与佩戴图；未改动不必虚构新版本。</p>`:''}
      <div class="w8-counter"><div><strong>本任务已完成AI问答</strong><span><b data-w8-exchange-count="${step.key}">${count}</b> / ${minimum}</span></div></div>
      ${done?'<p class="small">本任务已经完成。</p>':`<div class="row"><button type="button" class="btn orange" id="${step.key==='task1'?'submitW8Task1':'submitW8Task2'}" ${disabled?'disabled':''}>${step.key==='task1'?'完成检查，进入本节任务':'完成本节任务'}</button></div>`}
    </section>`;
  }).join('');
  const tabs=`<div class="w8-step-tabs">${steps.map((step,i)=>`<button type="button" class="w8-step-tab ${selected===step.key?'active':''}" id="${step.key==='task1'?'w8GoTask1':'w8GoTask2'}" ${i>0&&!done1?'disabled':''}>${i+1}. ${esc(step.label)} ${w8StepDone(step.key)?'✓':''}</button>`).join('')}</div>`;
  const exitAction=r.submitted_at&&!state.session_locked?'<button type="button" class="btn secondary" id="reopenSession">继续修改本课记录</button>':`<button type="button" class="btn secondary" id="saveAndExit" ${state.session_locked?'disabled':''}>保存进度并退出</button>`;
  return `<section class="card w8-flow-shell">${tabs}${panels}${lessonReviewHtml(s)}<div class="row between w8-save-row"><span id="saveStatus" class="small"></span>${exitAction}</div></section>`;
}
async function submitW8Step(stepKey){
  if(state.session_locked||state.record.submitted_at)return;
  const step=state.session.task_flow?.steps?.find(x=>x.key===stepKey);
  if(!step)return;
  const count=w8Count(stepKey), minimum=Number(step.min_ai_exchanges||0);
  if(count<minimum){alert(`当前已完成${count}轮完整AI对话，还需要${minimum-count}轮。你可以继续与AI讨论，也可以先保存进度并下节课继续。`);return;}
  if(!confirm(`确认提交${step.label}吗？提交后${stepKey==='task1'?'将解锁任务二。':'本课记录将标记为完成并锁定AI对话。'}未完成的内容请先保存进度。`))return;
  try{
    cancelQueuedAutoSave();await saveChain;await persistCurrentFields({showStatus:true,saveReason:`${stepKey}_submit`});
    const result=await App.api('/session/step-submit',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,stepKey,textFields:collectFields(),saveContext:saveContext(`${stepKey}_submit`)})});
    state.record=result.record||state.record;state.task_progress=result.task_progress||state.task_progress;
    if(stepKey==='task1')activeW8Step='task2';
    wizardAfterSubmit(stepKey);
    clearLocalDraft();await load();
  }catch(e){alert(e.message);await load(false);}
}
function wireTaskFlowControls(){
  if(!state?.session?.task_flow)return;
  const done1=w8StepDone('task1');
  const t1=document.getElementById('w8GoTask1'),t2=document.getElementById('w8GoTask2');
  if(t1)t1.onclick=()=>{if(!done1){activeW8Step='task1';render();}else{activeW8Step='task1';render();}};
  if(t2)t2.onclick=()=>{if(done1){activeW8Step='task2';render();}};
  const s1=document.getElementById('submitW8Task1');if(s1)s1.onclick=()=>submitW8Step('task1');
  const s2=document.getElementById('submitW8Task2');if(s2)s2.onclick=()=>submitW8Step('task2');
}
function wirePrototypeBook(){
  document.querySelectorAll('[data-prototype-book]').forEach(book=>{
    const key=book.dataset.prototypeBook;
    const versions=state.artifact_versions?.[key]||[];
    const itemLabel=book.dataset.prototypeItemLabel||'作品';
    const viewer=book.querySelector(`[data-prototype-viewer="${key}"]`);
    const prev=book.querySelector(`[data-prototype-prev="${key}"]`);
    const next=book.querySelector(`[data-prototype-next="${key}"]`);
    const iterate=book.querySelector(`[data-prototype-iterate="${key}"]`);
    const editor=book.querySelector(`[data-prototype-upload="${key}"]`);
    const cancel=book.querySelector(`[data-cancel-prototype="${key}"]`);
    const index=()=>Math.min(Math.max(0,prototypeVersionIndexByKey[key]??Math.max(0,versions.length-1)),Math.max(0,versions.length-1));
    const update=()=>{
      const current=index();
      prototypeVersionIndexByKey[key]=current;
      if(viewer)viewer.innerHTML=prototypeVersionPageHtml(versions,current,itemLabel);
      if(prev)prev.disabled=!versions.length||current===0;
      if(next)next.disabled=!versions.length||current>=versions.length-1;
    };
    if(!Object.prototype.hasOwnProperty.call(prototypeVersionIndexByKey,key))prototypeVersionIndexByKey[key]=Math.max(0,versions.length-1);
    if(prev)prev.onclick=()=>{prototypeVersionIndexByKey[key]=Math.max(0,index()-1);update();};
    if(next)next.onclick=()=>{prototypeVersionIndexByKey[key]=Math.min(versions.length-1,index()+1);update();};
    if(iterate)iterate.onclick=()=>editor?.classList.remove('hidden');
    if(cancel)cancel.onclick=()=>editor?.classList.add('hidden');
  });
}

function render(){
  const s=state.session,r=state.record;
  document.title=`${s.student_label||s.title} · 设计思维工作坊`;
  if(state.learning_gate==='orientation'){
    document.getElementById('app').innerHTML=`<div class="course-header"><span class="eyebrow">${esc(s.student_label||s.title)}</span><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div></div>${orientationHtml()}`;
    wireOrientation();
    return;
  }
  if(state.task_gate){
    document.getElementById('app').innerHTML=`<div class="course-header"><span class="eyebrow">${esc(s.student_label||s.title)}</span><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div></div>${gateHtml()}`;
    if(document.getElementById('questionnaireForm')) document.getElementById('questionnaireForm').onsubmit=e=>{e.preventDefault();submitQuestionnaire(state.task_gate==='questionnaire_post'?'post':'pre');};
    if(document.getElementById('refreshAssignment')) document.getElementById('refreshAssignment').onclick=()=>load();
    return;
  }
  const isW8Flow=Boolean(s.task_flow);
  if(isW8Flow)wizardInit(s);
  document.getElementById('app').innerHTML=`
    <div class="course-header ${isW8Flow?'hidden':''}"><span class="eyebrow">${esc(s.student_label||s.title)}</span><div class="row between"><div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)}</p></div>${state.session_locked?'<span class="badge big">教师已结束本阶段</span>':r.submitted_at?'<span class="badge big">已标记完成</span>':''}</div></div>
    <div class="course-grid"><div class="course-main">${isW8Flow?'':taskCard(s)}${isW8Flow?'':carryCard(state.carry_from)}
      ${isW8Flow?`<form id="taskForm" class="form">${lessonWizardHtml(s,r)}</form>`:`<section class="card"><span class="eyebrow">我的任务记录</span><h2>边做边记录，内容会及时自动保存</h2><p class="small">今天没做完就点“保存进度并退出”，下次老师继续开放本任务时，用同一编号和姓名进入即可接着做。完成按钮只是标记你认为本阶段已完成；在老师统一结束并锁定前，即使误点，也可以回来继续修改。</p>${state.session_locked?'<div class="notice"><strong>本阶段已由老师结束并锁定。</strong>现在可以查看已有记录，但不能继续修改。</div>':r.submitted_at?'<div class="notice"><strong>你已将本阶段标记为完成。</strong>如需继续修改，请点击“继续修改”。</div>':''}<form id="taskForm" class="form">${taskFieldsHtml(s)}${bonusTaskHtml(s)}<div class="artifact-list">${s.artifacts.map(a=>artifactHtml(a,r.artifacts?.[a.key])).join('')}</div><div id="saveStatus" class="small"></div><div class="row">${r.submitted_at&&!state.session_locked?'<button type="button" class="btn secondary" id="reopenSession">继续修改</button>':`<button type="button" class="btn secondary" id="saveAndExit" ${state.session_locked?'disabled':''}>保存进度并退出</button><button type="submit" class="btn orange" ${(r.submitted_at||state.session_locked)?'disabled':''}>${state.session_locked?'教师已结束本阶段':'完成本阶段'}</button>`}</div></form></section>`}
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
async function uploadArtifact(input){
  const key=input.dataset.artifact,status=document.querySelector(`[data-upload-status="${key}"]`),file=input.files?.[0];
  if(!file)return;
  const root=input.closest('[data-artifact-card]');
  const note=root?.querySelector(`[data-artifact-note="${key}"]`)?.value||'';
  if(root?.querySelector(`[data-artifact-status="${key}"]`) && !root.querySelector(`[data-artifact-note="${key}"]`)?.value.trim()){
    alert('请先简单说明本次版本具体做了什么变化/目前做出了什么。');input.value='';return;
  }
  if(root?.querySelector(`[data-artifact-basis="${key}"]`) && !root.querySelector(`[data-artifact-basis="${key}"]:checked`)){
    alert('请至少选择一项本次设计/原型形成依据；不确定时可选择“其他”。');input.value='';return;
  }
  const hasAiBasis=Boolean(root?.querySelector(`[data-artifact-basis="${key}"][value="AI建议"]:checked`));
  const aiRole=root?.querySelector(`[data-artifact-ai-role="${key}"]`)?.value||'not_used';
  if(root?.querySelector(`[data-artifact-source="${key}"]`)?.value==='ai' && aiRole==='not_used'){alert('如果这次主要参考AI建议，请选择实际采纳方式。');input.value='';return;}

  status.textContent='正在上传……';
  try{await persistCurrentFields({saveReason:'before_artifact_upload'});}catch(e){status.textContent=`先保存文字失败：${e.message}`;input.value='';return;}
  const fd=new FormData();fd.append('participantId',id);fd.append('sessionId',state.session.id);fd.append('artifactKey',key);fd.append('image',file);
  fd.append('kind',root?.querySelector('[data-artifact-kind]')?.value||'draft');
  fd.append('changeSource',root?.querySelector('[data-artifact-source]')?.value||'unknown');
  fd.append('changeNote',note);
  fd.append('modificationStatus',root?.querySelector(`[data-artifact-status="${key}"]`)?.value||'');
  fd.append('aiUsageRole',root?.querySelector(`[data-artifact-ai-role="${key}"]`)?.value||'');
  root?.querySelectorAll(`[data-artifact-basis="${key}"]:checked`).forEach(x=>fd.append('changeBases',x.value));
  root?.querySelectorAll(`[data-artifact-ai="${key}"]:checked`).forEach(x=>fd.append('aiMessageIds',x.value));
  const singleAI=root?.querySelector(`[data-artifact-ai-single="${key}"]`)?.value||'';if(singleAI)fd.append('aiMessageId',singleAI);
  fd.append('basedOnVersionRef',root?.querySelector(`[data-artifact-based-on="${key}"]`)?.value||'');
  try{const pendingChatText=document.getElementById('message')?.value||'';await App.api('/upload',{method:'POST',body:fd});status.textContent='上传成功 ✓';delete prototypeVersionIndexByKey[key];await load(false);const currentChatBox=document.getElementById('message');if(currentChatBox&&pendingChatText)currentChatBox.value=pendingChatText;}catch(e){status.textContent=e.message;input.value='';}
}
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
    const sentPhase=userRow?.task_context?.task_phase||chatTaskContext().task_phase;
    if(state.task_progress?.ai_exchange_counts && sentPhase){
      const stepKey=state.session.task_flow?.steps?.find(x=>x.task_phase===sentPhase)?.key||'';
      if(stepKey)state.task_progress.ai_exchange_counts[stepKey]=Number(state.task_progress.ai_exchange_counts[stepKey]||0)+1;
    }
    updateW8ExchangeCounter();
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
  document.querySelectorAll('[data-field]').forEach(x=>{if(x.tagName==='SELECT')x.addEventListener('change',()=>{writeLocalDraft(collectFields());queueAutoSave();});x.addEventListener('focus',()=>{rememberTaskField(x.dataset.field);startTaskFieldTrace(x);});x.addEventListener('input',()=>{rememberTaskField(x.dataset.field);bumpTaskFieldTrace(x);writeLocalDraft(collectFields());queueAutoSave();});x.addEventListener('paste',e=>postTraceEvent('task_field_paste',{field_key:x.dataset.field||'',pasted_chars:String(e.clipboardData?.getData('text')||'').length}));x.addEventListener('blur',()=>{rememberTaskField(x.dataset.field);endTaskFieldTrace(x,'blur');if(!state.record.submitted_at)persistCurrentFields({saveReason:'blur'}).then(()=>setSaveStatus('已自动保存 ✓')).catch(e=>setSaveStatus(`自动保存失败：${e.message}`));});});
  document.querySelectorAll('[data-artifact]').forEach(x=>x.onchange=()=>uploadArtifact(x));
  if(document.getElementById('saveAndExit'))document.getElementById('saveAndExit').onclick=saveAndExit;
  if(document.getElementById('reopenSession'))document.getElementById('reopenSession').onclick=async()=>{try{await App.api('/session/reopen',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id})});await load();}catch(x){alert(x.message);}};
  document.getElementById('taskForm').onsubmit=async e=>{e.preventDefault();if(state.session_locked)return;if(state.session.task_flow)return;if(!confirm('确认将本阶段标记为“已完成”吗？\n\n如果今天还没做完，请选择“取消”，再点“保存进度并退出”。\n\n即使误点，在老师统一结束并锁定本阶段前，你仍可以回来点击“继续修改”。'))return;try{cancelQueuedAutoSave();await saveChain;markAiDraftLeft('session_mark_complete');await App.api('/session/submit',{method:'POST',body:JSON.stringify({participantId:id,sessionId:state.session.id,textFields:collectFields(),saveContext:saveContext('mark_complete')})});clearLocalDraft();await load();}catch(x){alert(x.message);}};
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
  if(document.getElementById('saveLessonReview'))document.getElementById('saveLessonReview').onclick=async()=>{
    const indicator=document.getElementById('reviewSaveStatus');
    try{
      const vals=collectFields();
      if(state.ai_variant==='supported'){
        const phases=new Set((state.session.task_flow?.steps||[]).map(x=>x.task_phase));
        const has=(state.chat_messages||[]).some(m=>m.role==='assistant'&&phases.has(m.task_context?.task_phase));
        if(has&&!String(vals.lesson_review_reference||'').trim())throw new Error('请从本节真实对话中选择一条AI回复。');
        if(!has&&!String(vals.lesson_no_history_reason||'').trim())throw new Error('请说明本节没有可回顾对话的原因。');
        if(has&&(!String(vals.lesson_review_use||'').trim()||!String(vals.lesson_review_next||'').trim()))throw new Error('请简短说明AI帮助与下次如何求助。');
      }else if(!String(vals.lesson_exit_note||'').trim())throw new Error('请写一句今天的实际进度。');
      await persistCurrentFields({saveReason:'lesson_review'});
      await postTraceEvent('lesson_review_saved',{message_id:vals.lesson_review_reference||'',reflection_type:state.ai_variant==='supported'?'ai_help_review':'task_progress_review',has_personal_chat:Boolean((state.chat_messages||[]).length)});
      if(indicator)indicator.textContent='本节回顾已保存 ✓';
    }catch(e){if(indicator)indicator.textContent=e.message;}
  };
  if(document.getElementById('refreshLessonReview'))document.getElementById('refreshLessonReview').onclick=async()=>{try{await persistCurrentFields({saveReason:'refresh_lesson_reflection'});await load();}catch(e){alert(e.message);}};
  wireTaskFlowControls();
  wizardWire();
  wirePrototypeBook();
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
