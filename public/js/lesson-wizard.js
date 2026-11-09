// Student-focused page-wise lesson flow. Data, upload and chat services stay in task.js.

let wizardPage=null, wizardSessionId='';

function wizardInit(s){
  if(wizardSessionId===s.id && Number.isInteger(wizardPage))return;
  wizardSessionId=s.id;
  let remembered=NaN;
  try{remembered=Number(sessionStorage.getItem(`lesson-wizard:${id}:${s.id}`));if(sessionStorage.getItem(`lesson-wizard:${id}:${s.id}`)===null)remembered=NaN;}catch{}
  wizardPage=Number.isInteger(remembered)&&remembered>=0&&remembered<=4?remembered:
     (state.record?.submitted_at?4:w8StepDone('task1')?3:0);
  if(wizardPage===3&&!w8StepDone('task1'))wizardPage=2;
}

function wizardAfterSubmit(stepKey){
  wizardPage=stepKey==='task1'?3:4;
  try{sessionStorage.setItem(`lesson-wizard:${id}:${state.session.id}`,String(wizardPage));}catch{}
}

async function wizardGo(target){
  const page=Number(target);
  if(!Number.isInteger(page)||page<0||page>4)return;
  if(page===3&&!w8StepDone('task1')){alert('请先完成任务一，才能进入制作或新任务。');return;}
  if(page===2&&!w8StepDone('task1')){
    const values={...displayTextFields(),...collectFields()},fields=state.session.fields||[];
    const needed=fields.filter(f=>f.stage==='task1'&&(/_check[123]$|_check_evidence$|_peer$|_focus$/.test(f.key)));
    const missing=needed.find(f=>!String(values[f.key]||'').trim());
    if(missing){alert('请先完成第2步“找问题”：'+missing.label+'。没做过就如实选择。');return;}
  }
  const chatDraft=document.getElementById('message')?.value||'';
  if(!state.record.submitted_at&&!state.session_locked)try{await persistCurrentFields({saveReason:'wizard_page_change'});}catch(e){alert('当前内容保存失败，请检查网络：'+e.message);return;}
  wizardPage=page;
  try{sessionStorage.setItem(`lesson-wizard:${id}:${state.session.id}`,String(page));}catch{}
  render();
  if(chatDraft&&document.getElementById('message'))document.getElementById('message').value=chatDraft;
  document.getElementById('app')?.scrollIntoView({block:'start'});
}

function wizardPriorHtml(){
  const carry=state.carry_from;
  if(!carry)return '<p class="small">这里还没有上节课的照片。你可以直接拿出自己的纸质图纸或原型检查。</p>';
  const photos=Object.values(carry.record?.artifacts||{}).filter(v=>v&&v.file_name).slice(-4);
  return `<details class="wizard-carry"><summary>查看上节已保存的成果（${photos.length}张）</summary><div class="wizard-image-grid">${photos.length?photos.map((p,i)=>`<img src="${artifactUrl(p,carry.session.id)}" alt="上节作品照片${i+1}" loading="lazy">`).join(''):'<p class="small">上节没有保存照片，请参考纸质学习单或实物。</p>'}</div></details>`;
}

function lessonWizardHtml(s,r){
  wizardInit(s);
  const lesson=Number(s.actual_lesson||0),isSix=lesson===6,firstDone=w8StepDone('task1'),secondDone=w8StepDone('task2');
  const hasHelpScaffold=state.ai_variant==='supported';
  const min1=Number(s.task_flow.steps[0].min_ai_exchanges||0),min2=Number(s.task_flow.steps[1].min_ai_exchanges||0);
  const labels=['看已有成果','找问题','AI讨论与任务一','做今天的任务','回顾与提交'];
  const tabs=labels.map((label,i)=>`<button type="button" class="wizard-tab ${i===wizardPage?'current':''}" data-wizard-page="${i}" ${i===3&&!firstDone?'disabled':''}><span>${i+1}</span><small>${esc(label)}</small></button>`).join('');
  const vals=displayTextFields(), all=s.fields||[];
  const renderFields=arr=>arr.map(f=>fieldHtml(f,vals[f.key]??'',Boolean(r.submitted_at||state.session_locked||(firstDone&&f.stage==='task1')))).join('');
  const a=key=>{const art=(s.artifacts||[]).find(x=>x.key===key);return art?artifactHtml(art,r.artifacts?.[key]):'';};
  const checkFields=all.filter(f=>f.stage==='task1'&&/_check[123]$/.test(f.key));
  const notes=all.filter(f=>f.stage==='task1'&&/(_check_evidence|_peer|_focus)$/.test(f.key));
  const task2Fields=all.filter(f=>f.stage==='task2');
  const counter=(step,min)=>`<div class="wizard-counter">AI对话：<b data-w8-exchange-count="${step}">${w8Count(step)}</b> / ${min} 轮 <span>（一问一答算1轮）</span></div>`;
  const btn=(text,page,kind='orange')=>`<button type="button" class="btn ${kind}" data-wizard-next="${page}">${text}</button>`;
  const note='<p class="small">实事求是。没有做到的内容可以保留空白或写清楚未完成，保存后下节继续。</p>';
  let pageHtml='';
  if(wizardPage===0){
    const help=hasHelpScaffold?`<div class="wizard-help"><strong>今天的求助方法</strong><p>先检查自己做到了什么，弄清楚不确定的地方；向AI说明现象和已尝试的方法，再判断AI建议是否可行。</p><span class="small">如果不确定怎么问，可以按这三个步骤整理自己的问题。</span></div>`:'';
    pageHtml=`<h2>先看看上节做到了哪里</h2><p>拿出已有图纸或实物。已上传的照片不用再传一遍。</p>${help}${wizardPriorHtml()}
       ${isSix?`<h3>上节学习单或设计记录</h3>${a('l06_previous_task_sheet')}`:''}
       <div class="wizard-nav">${btn('下一步：检查设计',1)}</div>`;
  }else if(wizardPage===1){
    pageHtml=`<h2>自己检查，再请同伴看看</h2><p>逐项选真实情况，未制作或未测试都可以如实选择，不必硬找缺点。</p>
      <div class="wizard-checks">${renderFields(checkFields)}</div><div class="wizard-short-fields">${renderFields(notes)}</div>
      <div class="wizard-nav">${btn('上一步',0,'secondary')}${btn('保存检查，下一步',2)}</div>`;
  }else if(wizardPage===2){
    const W6=science=>{
      return `<details class="wizard-info"><summary>需要时展开科学知识小图</summary>${scienceDiagramCardsHtml()}</details>
       <div class="wizard-short-fields">${renderFields(all.filter(f=>f.stage==='task1'&&/^l06_(science_point|science_application|material_plan)$/.test(f.key)))}</div>
       <h3>提交两份不同的成果</h3><p class="small">① 填写完整的科学知识与材料学习单；② 标出科学知识、材料和用途的新版设计图。每项各选择一次照片，系统自动保存；没有新修改不必重复上传。</p><div class="wizard-files">${a('l06_science_learning_sheet')}${a('l06_design_version')}</div>`;
    };
    pageHtml=`<h2>${isSix?'任务一：完善设计图':'把检查结果告诉AI'}</h2>
      <p>${isSix?(hasHelpScaffold?'选一个适合自己设计的科学知识，说明应用位置。向AI求助时可以结合自己的真实图纸说明困难。':'选一个适合自己设计的科学知识，说明应用位置和用途，再完成设计图。'):(hasHelpScaffold?'把检查结果、不确定的地方或同伴的意见告诉AI，结合实际情况判断。':'根据今天的任务，自主选择需要讨论的设计问题，继续完成作品。')}</p>
      ${isSix?W6():(hasHelpScaffold?`<div class="wizard-help"><strong>求助提示</strong><p>“我检查到……，已经试过……，但还不确定……。应该先检查什么？”</p><span class="small">不需要照抄，根据自己的情况提问。</span></div>`:'')}
      ${counter('task1',min1)}<div class="wizard-nav">${btn('返回检查',1,'secondary')}
      ${firstDone?btn('进入今天的新任务',3):'<button type="button" class="btn orange" id="submitW8Task1">完成任务一，进入下一步</button>'}</div>`;
  }else if(wizardPage===3){
    const photoHtml=isSix?
      `<h3>照片记录</h3><p class="small">完成正式原型时分别上传整体图和真实佩戴图；没做完先上传进度照。</p>
       <div class="wizard-files">${a('l06_prototype_versions')}${a('l06_wear_versions')}</div><details class="wizard-info"><summary>还没有完成正式原型？上传制作进度</summary>${a('l06_build_progress')}</details>`:
      `<h3>作品与测试照片</h3><p class="small">没有改变结构就不必生成新版本；真实修改后才上传新照片。</p><div class="wizard-files">${s.artifacts.filter(x=>!x.key.endsWith('_v2_photo')).map(x=>a(x.key)).join('')}</div>`;
    pageHtml=`<h2>${isSix?'任务二：动手制作原型':esc(s.task_flow.steps[1].label)}</h2>
      <p>${esc(s.subtitle||'根据当前进度继续制作、测试或改进。')}</p>
      <div class="wizard-short-fields">${renderFields(task2Fields)}</div>${photoHtml}${counter('task2',min2)}
      <div class="wizard-nav">${btn('上一步',2,'secondary')}${btn('下一步：回顾今天',4)}</div>`;
  }else{
    pageHtml=`<h2>${hasHelpScaffold?'下课前回顾AI求助':'下课前记录任务进度'}</h2><p>${hasHelpScaffold?'选择本节真实AI对话，想想建议是否有用、自己怎样处理。':'简单写下今天做到了哪里，下一步准备做什么；没有完成也可以保存。'}</p>
      ${lessonReviewHtml(s)}
      <div class="wizard-summary">${counter('task1',min1)}${counter('task2',min2)}</div>
      ${secondDone?'<p class="wizard-complete">这节课已经完成并提交。</p>':
       `<div class="wizard-nav">${btn('返回继续任务',firstDone?3:2,'secondary')}<button type="button" class="btn orange" id="submitW8Task2" ${firstDone&&!r.submitted_at&&!state.session_locked?'':'disabled'}>检查并提交本节</button></div><p class="small">还没完成对话或作品要求时，先保存进度即可。</p>`}`;
  }
  const exit=r.submitted_at&&!state.session_locked?'<button type="button" class="btn secondary" id="reopenSession">继续修改本节记录</button>':`<button type="button" class="btn secondary" id="saveAndExit" ${state.session_locked?'disabled':''}>保存进度并退出</button>`;
  return `<section class="lesson-wizard"><div class="wizard-heading"><div><span class="eyebrow">第${lesson}节 · 每节60分钟</span><h1>${esc(s.title)}</h1><p>一次只做一步。没做完也可以保存。</p></div><span class="wizard-badge">${secondDone?'已完成':firstDone?'已进入任务二':'进行中'}</span></div>
   <nav class="wizard-tabs" aria-label="本节学习步骤">${tabs}</nav>
   <div class="wizard-current" data-wizard-current="${wizardPage}">${pageHtml}</div>
   <div class="wizard-bottom"><span class="small" id="saveStatus"></span>${exit}</div></section>`;
}

function wizardWire(){
  if(!state?.session?.task_flow)return;
  document.querySelectorAll('[data-wizard-page],[data-wizard-next]').forEach(el=>
    el.addEventListener('click',()=>wizardGo(el.dataset.wizardPage??el.dataset.wizardNext)));
}
