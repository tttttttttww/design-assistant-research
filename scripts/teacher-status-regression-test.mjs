import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getSessionConfig} from '../src/config/researchConfig.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const cfg=getSessionConfig('W7');
assert.ok(cfg,'第7节课不能消失');
assert.equal(cfg.actual_lesson,7);
assert.equal(cfg.archived,false);
assert.match(cfg.title,/第7节/);
const browser=read('public/js/admin.js');
const routes=read('src/routes/admin.js');
const html=read('public/admin.html');
new vm.Script(browser,{filename:'public/js/admin.js'});
for(const marker of ['showAdminWarning','read_error','读取失败','loaded=await loadParticipants()','settings.active_session_id!==requested','refreshLiveMonitor({force:true})']){
  assert.ok(browser.includes(marker),'缺少学生读取与课次切换容错：'+marker);
}
assert.ok(!routes.includes("return res.status(503).json({error:'云端学生数据读取失败"),'一个学生异常不得阻止读取整班');
for(const marker of ['Promise.allSettled','X-Student-Read-Failures',"user_turn_count:null","live_status:'read_error'"]){
 assert.ok(routes.includes(marker),'后端缺少单人读取失败隔离：'+marker);
}
assert.ok(html.includes('adminDataWarning'),'教师后台必须可见错误，而非静默无响应');
assert.ok(read('src/services/storageService.js').includes("course-v11-enhanced"),'不得改变原数据前缀');
console.log('TEACHER STATUS CHECK OK: W7 available; errors visible; unknown status not reported as zero; stored keys unchanged.');
