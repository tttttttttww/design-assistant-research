import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getSessionConfig} from '../src/config/researchConfig.js';
const src=readFileSync(new URL('../public/js/lesson-wizard.js',import.meta.url),'utf8');
const task=readFileSync(new URL('../public/js/task.js',import.meta.url),'utf8');
const createContext=(s,variant='supported',completed=false)=>{
 const state={session:s,record:{submitted_at:null},session_locked:false,ai_variant:variant,
  artifact_versions:{},carry_from:s.id==='W7'?{session:{id:'W6'},record:{artifacts:{
    legacy_chat_image:{file_name:'unrelated.png',file_path:'unrelated-ai-chat-photo.png'},
    legacy_material_image:{file_name:'gloves.png',file_path:'unrelated-gloves.png'}
  }}}:null};
 const ctx={id:'S00',s,state,sessionStorage:{getItem:()=>null,setItem:()=>{}},
  esc:x=>String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  w8StepDone:key=>Boolean(completed),
  w8Count:()=>0,displayTextFields:()=>({}),
  fieldHtml:f=>'<div data-field="'+f.key+'">'+f.label+'</div>',
  artifactHtml:a=>'<div data-artifact="'+a.key+'">'+a.label+'</div>',
  lessonReviewHtml:()=>'<div id="lessonReview"></div>',
  scienceDiagramCardsHtml:()=>'<div>科学知识小图</div>',
  artifactUrl:()=>''};
 vm.createContext(ctx);
 // Exercise the actual W7-only compact upload UI, not a placeholder.
 const helper=task.slice(task.indexOf('function w7DrawingRevisionHtml(){'),task.indexOf('function compactW6EvidenceHtml('));
 vm.runInContext(helper,ctx);
 vm.runInContext(src,ctx);
 return ctx;
};
for(let n=6;n<=10;n++){
 const s=getSessionConfig('W'+n);
 const ctx=createContext(s);
 for(let page=0;page<=4;page++){
  vm.runInContext('wizardPage='+page+';wizardSessionId=s.id',ctx);
  const html=vm.runInContext('lessonWizardHtml(s,state.record)',ctx);
  assert.equal((html.match(/data-wizard-page=/g)||[]).length,5,'每次应有五个进度按钮');
  assert.equal((html.match(/class="wizard-current"/g)||[]).length,1,'每次只显示一个当前任务页面');
  assert.ok(html.includes('第'+n+'节'),'学生显示真实课次');
  assert.ok(!html.includes('实验组')&&!html.includes('对照组'),'学生端不能暴露分组');
  assert.ok(!html.includes('关联上一课作品')&&!html.includes('关联一条AI回复'),'去除技术性无效表单');
  if(page===0){if(n===7){assert.ok(html.includes('上传上节课的设计图纸'),'第七节必须提供明确的上节图纸上传入口');assert.ok(html.includes('data-artifact="l07_design_version"'),'第七节须有真实文件上传控件');assert.ok(!html.includes('查看上节已保存的成果')&&!html.includes('unrelated-ai-chat-photo.png')&&!html.includes('unrelated-gloves.png'),'不能混入上一课其他图片');}else assert.ok(html.includes('看'),'其他课次仍查看既有成果');}
  if(page===1)assert.equal((html.match(/data-field="l\d+_check[123]"/g)||[]).length,3,'自检选项只能出现一次');
  if(page===2&&n!==7)assert.ok(html.includes('data-w8-exchange-count="task1"'),'本页应计数当前对话');
  if(page===3&&n!==7)assert.ok(html.includes('data-w8-exchange-count="task2"'),'其他课次仍在当前阶段显示对话轮次');
  if(page===4)assert.ok(html.includes('id="lessonReview"'),'回顾只在结束页面显示');
  if(n===7 && page===2){assert.ok(html.includes('data-artifact="l07_design_version"'),'第7节图纸可自由上传');assert.ok(html.includes('图纸已满意'),'无需改图可继续制作');assert.ok(html.includes('改了哪里？')&&html.includes('选择修改后的图纸照片'),'第7节要直接显示修改说明与上传入口');assert.ok(!html.includes('这次主要参考什么？')&&!html.includes('AI建议最后怎样处理？'),'图纸迭代不可有冗余选择题');assert.equal((html.match(/data-artifact="l07_design_version"/g)||[]).length,1,'仅保留一个图纸上传入口');}
  if(n===7 && page===3){
    assert.ok(html.includes('原型迭代'),'第7节原型界面标题');
    assert.ok(html.includes('做了/改了哪里？'),'原型每版仅填写一句修改说明');
    assert.ok(html.includes('① 选择原型整体图') && html.includes('② 选择实际佩戴图'),'两张照片入口必须明显');
    assert.equal((html.match(/data-artifact="l07_prototype_overview"/g)||[]).length,1,'整体图仅一个上传入口');
    assert.equal((html.match(/data-artifact="l07_prototype_wear"/g)||[]).length,1,'佩戴图仅一个上传入口');
    assert.ok(html.includes('data-artifact="l07_process_photo"'),'制作未完时保留进度照片入口');
    assert.ok(!html.includes('这次主要参考什么？')&&!html.includes('AI建议最后怎样处理？')&&!html.includes('本节累计有效AI对话'),'原型页不再堆叠多余选项和轮数说明');
  }
 }
 const control=createContext(s,'free');
 vm.runInContext('wizardPage=0;wizardSessionId=s.id',control);
 assert.ok(!vm.runInContext('lessonWizardHtml(s,state.record)',control).includes('今天的求助方法'),'普通条件不显示额外求助支架');
}
assert.ok(task.includes('lessonWizardHtml(s,r)'),'任务页须真正调用翻页页面');
assert.ok(task.includes('wizardWire()'),'下一步按钮须连接翻页操作');
assert.ok(!task.includes('关联上一课作品'));
console.log('V12.1 WIZARD CHECK OK: five sequential pages, evidence questions once, real lesson numbers, no student group labels.');
