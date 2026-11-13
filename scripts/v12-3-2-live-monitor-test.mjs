import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('public/js/admin.js');
const route=read('src/routes/admin.js');
const storage=read('src/services/storageService.js');
const begin=admin.indexOf('async function fetchLiveStatusPage(');
const end=admin.indexOf('\nfunction scheduleLiveTimer(){',begin);
assert.ok(begin>=0&&end>begin,'Live polling implementation must exist');
assert.match(admin,/startLiveTimer\(\);\s*void loadParticipantDashboard\(\);/,
  'Monitor should start independently before expensive full student list loads');
assert.ok(admin.includes("live_status:'pending',user_turn_count:null"),
  'Unknown students must show unread rather than zero');
assert.ok(admin.includes("x.user_turn_count==null?'待读取'"),
  'Live panel must not invent zero turns before reading actual data');
assert.ok(route.includes('const targetIds=ids.slice(offset,offset+limit);'),
  'Cloud function must only read a small page of students');
assert.ok(route.includes('Math.min(6,parsedLimit)'),
  'Cloud status page limit must be capped');
assert.ok(route.includes('requireAdmin'),
  'Live data endpoint must keep admin authentication');
assert.ok(storage.includes("course-v11-enhanced"),
  'Blob namespace must remain unchanged');

// Exercise the actual front-end batch polling code with an in-memory fake API.
// No student data, Blob object, login, or server is modified.
const ids=['S00','S99',...Array.from({length:30},(_,i)=>'S'+String(i+1).padStart(2,'0'))];
async function scenario(badOffset=null,hidden=false){
 const rows=ids.map(participant_id=>({participant_id,user_turn_count:null,live_status:'pending'}));
 const states=[],requests=[];let renders=0;
 const button={disabled:false,textContent:'立即刷新'};
 const ctx={
   LIVE_IDS:ids,liveAutoRefresh:true,liveRefreshing:false,liveRefreshQueued:false,
   liveSelectedParticipantId:'',liveLastRefreshAt:'',
   settings:{active_session_id:'W6'},
   document:{hidden,getElementById:id=>id==='liveRefresh'?button:null},
   AbortController,Date,Promise,
   setTimeout:()=>1,clearTimeout:()=>{},
   refreshClockText:()=> '09:30:00',
   loadLiveParticipant:async()=>{},
   setLiveRefreshState:(message,kind)=>states.push({message,kind}),
   renderLiveParticipantList:()=>{renders++;},
   mergeLiveStatuses:data=>{
     for(const result of data.rows||[]){
       const student=rows.find(x=>x.participant_id===result.participant_id);
       assert.ok(student,'Unknown student ID in monitor');
       Object.assign(student,result);
     }
   },
   api:async path=>{
     requests.push(path);
     const u=new URL(path,'https://example.invalid');
     const offset=Number(u.searchParams.get('offset'));
     const limit=Number(u.searchParams.get('limit'));
     if(offset===badOffset)throw new Error('fake Cloud timeout');
     return {
       session_id:'W6',server_time:'2026-11-13T09:30:00+08:00',
       failed_count:0,partial:false,
       rows:ids.slice(offset,offset+limit).map(participant_id=>({
         participant_id,user_turn_count:2,assistant_turn_count:2,live_status:'replied'
       }))
     };
   }
 };
 vm.createContext(ctx);
 vm.runInContext(admin.slice(begin,end),ctx);
 await vm.runInContext('refreshLiveMonitor()',ctx);
 return {rows,states,requests,renders,button,ctx};
}

const success=await scenario();
assert.equal(success.requests.length,8,'32 IDs must use eight 4-person requests');
assert.ok(success.requests.every(x=>x.includes('limit=4')));
assert.ok(success.rows.every(x=>x.live_status==='replied'&&x.user_turn_count===2));
assert.equal(success.button.disabled,false);
assert.ok(success.states.at(-1).message.includes('已更新'));
assert.ok(success.renders>=8,'Each page must immediately render incremental students');
const partial=await scenario(8);
assert.equal(partial.requests.length,8,'Other pages must finish even if one page fails');
assert.equal(partial.rows.filter(x=>x.live_status==='read_error').length,4);
assert.ok(partial.rows.filter(x=>x.live_status==='read_error').every(x=>x.user_turn_count===null),
  'Failed reads must never silently become zero');
assert.ok(partial.states.at(-1).message.includes('失败'),'Failure must be visible');
const hidden=await scenario(null,true);
assert.equal(hidden.requests.length,0,'Do not poll a hidden teacher tab');
console.log('V12.3.2 LIVE MONITOR CHECK OK: nonblocking boot, eight bounded requests, partial failures, no false zeros, hidden-tab pause.');
