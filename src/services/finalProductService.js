// Optional W10 final physical-product assessment. Completely separate from EDP process portfolio
// and from help-seeking coding. Scores are independent per rater and never change raw student data.
import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
const IDS=Array.from({length:30},(_,i)=>`S${String(i+1).padStart(2,'0')}`);
export const PRODUCT_DIMENSIONS=[
  {key:'functionality',label:'功能有效性',definition:'使用统一的铅笔与纸张测试可否固定并进行基本绘画动作'},
  {key:'stability_safety',label:'结构稳定与安全',definition:'部件连接牢固，使用时不会明显松脱，且无明显安全风险'},
  {key:'user_fit',label:'适用性',definition:'装置是否降低精细握持要求、能否在合理条件下穿戴/拆卸；不得宣称已在真实障碍群体中验证'},
  {key:'novelty',label:'设计新颖性',definition:'与常规固定方式相比是否存在适切且有价值的独到结构/组合'},
];
const key=(id,rater)=>`research-final-product/v1/W10/${id}/${rater}.json`;
const fail=(s)=>Object.assign(new Error(s),{status:400});
export async function getFinalProductScores(id){
 if(!IDS.includes(id))throw fail('正式编号无效');
 const keys=await storageService.listObjects(`research-final-product/v1/W10/${id}/`);
 const rows=await Promise.all(keys.map(async k=>{const str=await storageService.getObject(k.key);try{return JSON.parse(str)}catch{return null}}));
 return rows.filter(Boolean).sort((a,b)=>a.rater_id.localeCompare(b.rater_id));
}
export async function putFinalProductScore(input){
 const id=String(input?.participant_id||'').toUpperCase();
 const rater=String(input?.rater_id||'').trim().toLowerCase();
 if(!IDS.includes(id)||!/^[a-z0-9_-]{2,24}$/.test(rater))throw fail('请选择正式编号及2-24位评分者代号（英文数字）');
 const evidence=String(input?.observation_level||'unknown');
 if(!['physical_test','physical_no_test','photo_only','unknown'].includes(evidence))throw fail('观察条件不合法');
 const vals={};
 for(const d of PRODUCT_DIMENSIONS){
  const raw=input?.scores?.[d.key];
  if(raw==null||raw===''){ vals[d.key]=null; continue; }
  const n=Number(raw); if(!Number.isInteger(n)||n<0||n>3)throw fail('评分必须0-3，未观察到请留空，不要打0');
  vals[d.key]=n;
 }
 const scoreComplete=Object.values(vals).every(v=>v!==null);
 const previous=await storageService.getObject(key(id,rater));
 const old=previous?JSON.parse(previous):null;
 const now=new Date().toISOString();
 const row={participant_id:id,session_id:'W10',rater_id:rater,observation_level:evidence,
  scores:vals,complete:scoreComplete,total:scoreComplete?Object.values(vals).reduce((a,b)=>a+b,0):null,
  note:String(input?.note||'').slice(0,1000),rubric_id:'final_product_4dim_research_adaptation_v1',
  updated_at:now,revision:Number(old?.revision||0)+1};
 await storageService.putObject(`research-final-product-audit/v1/W10/${id}/${rater}/${Date.now()}_${randomUUID()}.json`,JSON.stringify({previous:old,next:row}));
 await storageService.putObject(key(id,rater),JSON.stringify(row));
 return row;
}
export async function finalProductDataset(){
 const all=await Promise.all(IDS.map(getFinalProductScores));
 return all.flat().map(r=>({participant_id:r.participant_id,session_id:'W10',rater_id:r.rater_id,
    observation_level:r.observation_level,score_functionality:r.scores.functionality,
    score_stability_safety:r.scores.stability_safety,score_user_fit:r.scores.user_fit,
    score_novelty:r.scores.novelty,score_complete:r.complete,total:r.total,
    note:r.note,rubric_id:r.rubric_id,updated_at:r.updated_at,revision:r.revision}));
}
export const productScoreHeaders=['participant_id','session_id','rater_id','observation_level','score_functionality','score_stability_safety','score_user_fit','score_novelty','score_complete','total','note','rubric_id','updated_at','revision'];
