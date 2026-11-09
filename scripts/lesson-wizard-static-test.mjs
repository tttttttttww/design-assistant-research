import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getSessionConfig} from '../src/config/researchConfig.js';
const src=readFileSync(new URL('../public/js/lesson-wizard.js',import.meta.url),'utf8');
const task=readFileSync(new URL('../public/js/task.js',import.meta.url),'utf8');
const createContext=(s,variant='supported',completed=false)=>{
 const state={session:s,record:{submitted_at:null},session_locked:false,ai_variant:variant,carry_from:null};
 const ctx={id:'S00',s,state,sessionStorage:{getItem:()=>null,setItem:()=>{}},
  esc:x=>String(x||'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  w8StepDone:key=>Boolean(completed),
  w8Count:()=>0,displayTextFields:()=>({}),
  fieldHtml:f=>'<div data-field="'+f.key+'">'+f.label+'</div>',
  artifactHtml:a=>'<div data-artifact="'+a.key+'">'+a.label+'</div>',
  lessonReviewHtml:()=>'<div id="lessonReview"></div>',
  scienceDiagramCardsHtml:()=>'<div>科学知识小图</div>',
  artifactUrl:()=>''};
 vm.createContext(ctx);vm.runInContext(src,ctx);
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
  if(page===0)assert.ok(html.includes('看'),'第一页须查看既有成果');
  if(page===1)assert.equal((html.match(/data-field="l\\d+_check[123]"/g)||[]).length,3,'自检选项只能出现一次');
  if(page===2)assert.ok(html.includes('data-w8-exchange-count="task1"'),'本页应计数任务一对话');
  if(page===3)assert.ok(html.includes('data-w8-exchange-count="task2"'),'本页应计数任务二对话');
  if(page===4)assert.ok(html.includes('id="lessonReview"'),'回顾只在结束页面显示');
 }
 const control=createContext(s,'free');
 vm.runInContext('wizardPage=0;wizardSessionId=s.id',control);
 assert.ok(!vm.runInContext('lessonWizardHtml(s,state.record)',control).includes('今天的求助方法'),'普通条件不显示额外求助支架');
}
assert.ok(task.includes('lessonWizardHtml(s,r)'),'任务页须真正调用翻页页面');
assert.ok(task.includes('wizardWire()'),'下一步按钮须连接翻页操作');
assert.ok(!task.includes('关联上一课作品'));
console.log('V12.1 WIZARD CHECK OK: five sequential pages, evidence questions once, real lesson numbers, no student group labels.');
