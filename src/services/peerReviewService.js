// Separate append-only namespace for the W8 class gallery. Existing participants/* and uploads/* remain unchanged.
import { randomUUID } from 'node:crypto';
import { storageService } from './storageService.js';
const formal=Array.from({length:30},(_,i)=>`S${String(i+1).padStart(2,'0')}`);
const test=['S00','S99'];
const valid=id=>formal.includes(id)||test.includes(id);
const reviewKey=(from,to)=>`class-peer-review/v1/W8/${from}/${to}.json`;
const err=(msg,status=400)=>Object.assign(new Error(msg),{status});
export function peerReviewCandidates(requester){return test.includes(requester)?test:formal;}
export async function reviewsByAuthor(author){
  if(!valid(author))throw err('编号无效',403);
  const peers=peerReviewCandidates(author).filter(target=>target!==author);
  const results=await Promise.all(peers.map(async target=>{
    const raw=await storageService.getObject(reviewKey(author,target));
    try{return raw?JSON.parse(raw):null;}catch{return null;}
  }));
  return results.filter(Boolean);
}
export async function reviewsForTarget(target){
  if(!valid(target))throw err('编号无效',403);
  const authors=peerReviewCandidates(target).filter(x=>x!==target);
  const results=await Promise.all(authors.map(async author=>{
    const raw=await storageService.getObject(reviewKey(author,target));
    try{return raw?JSON.parse(raw):null;}catch{return null;}
  }));
  return results.filter(Boolean);
}
export async function savePeerReview({from,to,strength,question,suggestion,allowedTargets}){
  if(!valid(from)||!valid(to)||!peerReviewCandidates(from).includes(to))throw err('同伴编号无效',403);
  if(from===to)throw err('不能评价自己的作品');
  if(!allowedTargets?.includes(to))throw err('该作品尚未发布，暂不能评价');
  const clean=value=>String(value||'').trim().slice(0,350);
  const data={strength:clean(strength),question:clean(question),suggestion:clean(suggestion)};
  if(Object.values(data).some(x=>x.length<4))throw err('请分别写出具体优点、需要核实的问题和修改建议，每项至少4个字。');
  const raw=await storageService.getObject(reviewKey(from,to));
  let previous=null;try{previous=raw?JSON.parse(raw):null;}catch{}
  const now=new Date().toISOString();
  const row={from,to,session_id:'W8',...data,created_at:previous?.created_at||now,updated_at:now,revision:Number(previous?.revision||0)+1};
  // Snapshot previous and new review on every edit; never rewrite student task records.
  await storageService.putObject(`class-peer-review-audit/v1/W8/${from}/${to}/${Date.now()}_${randomUUID()}.json`,JSON.stringify({previous,next:row}));
  await storageService.putObject(reviewKey(from,to),JSON.stringify(row));
  return row;
}
export async function allPeerReviews(){
  const rows=await Promise.all(formal.map(reviewsByAuthor));return rows.flat();
}
