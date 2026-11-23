import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const task=readFileSync(new URL('../public/js/task.js',import.meta.url),'utf8');
const from=task.indexOf('// W8: full source dialogue + selectable decisions');
const to=task.indexOf('// W8 student view:',from);
assert.ok(from>=0&&to>from,'Quiz functions source section was not found');
const replies=[
 {role:'user',message_id:'u1',content:'我的夹笔装置会滑动，怎么办？'},
 {role:'assistant',message_id:'ai1',content:'1. 调整夹笔位置。\n2. 重新试画检查是否滑动。'},
 {role:'user',message_id:'u2',content:'还有没有其他办法？'},
 {role:'assistant',message_id:'ai2',content:'1. 改变固定结构。\n2. 比较材料防滑效果。'},
 {role:'assistant',message_id:'ai3',content:'先测量笔杆的位置。'},
];
const savedRows=[{message_id:'ai1',part_index:0,excerpt:'1. 调整夹笔位置。',decision:'已采纳并尝试'}];
const saved={l08_ai_suggestion_reviews_json:JSON.stringify(savedRows),l08_ai_review_complete:''};
const context={
 state:{chat_messages:replies,record:{submitted_at:null},session_locked:false,session:{fields:[]}},
 displayTextFields:()=>saved,
 w8StepDone:()=>true,
 esc:x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 chatImageUrl:()=>'',
};
vm.createContext(context);
const output=vm.runInContext(`${task.slice(from,to)}\n({bank:w8ReviewQuestionBank(),html:w8DialogueReviewHtml(),pageSize:W8_QUIZ_PAGE_SIZE})`,context);
assert.equal(output.pageSize,3);
assert.equal(output.bank.length,5,'2 numbered options per AI reply plus a single short reply');
assert.equal((output.html.match(/class="w8-quiz-question"/g)||[]).length,5,'each candidate is its own question');
assert.equal((output.html.match(/type="radio"/g)||[]).length,30,'each question provides six single-choice responses');
assert.match(output.html,/已答 1 \/ 5 题/);
assert.match(output.html,/第 1 \/ 2 页/);
assert.match(output.html,/data-w8-quiz-index="3" data-w8-quiz-page="1" hidden/,'second page must be initially hidden');
assert.match(output.html,/name="w8_quiz_0"/,'radio group must be per question');
assert.match(output.html,/data-w8-advice-message="ai1"/,'must persist real message references');
assert.match(output.html,/完整对话（5条学生\/AI消息）/,'full student + AI dialogue remains accessible');
assert.match(output.html,/id="w8QuizPrev"/);
assert.match(output.html,/id="w8QuizNext"/);
assert.ok(!output.html.includes('<select data-w8-advice-message'),'old drop-down choice UI removed');
assert.match(output.html,/data-field="l08_ai_suggestion_reviews_json"/);
assert.match(output.html,/data-field="l08_ai_review_complete"/);
console.log('W8 QUESTIONNAIRE RENDER TEST OK: real messages, 5 questions, 3/page, radio options, stored refs, transcript.');
