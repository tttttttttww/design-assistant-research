window.App={
  apiBase:'/express/api',
  loginVersion:'11.12',
  participantId(){return sessionStorage.getItem('participant_id')||'';},
  cohortRevision(){return sessionStorage.getItem('cohort_revision')||'';},
  setParticipantId(id,revision=''){sessionStorage.setItem('participant_id',id);sessionStorage.setItem('participant_login_verified',this.loginVersion);sessionStorage.setItem('cohort_revision',revision||'');},
  clearParticipant(){sessionStorage.removeItem('participant_id');sessionStorage.removeItem('participant_login_verified');sessionStorage.removeItem('cohort_revision');},
  async api(path,options={}){const headers={...(options.headers||{})};const rev=this.cohortRevision();if(rev)headers['X-Cohort-Revision']=rev;if(!(options.body instanceof FormData))headers['Content-Type']=headers['Content-Type']||'application/json';const r=await fetch(this.apiBase+path,{...options,headers});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.error||data.message||'操作失败');e.data=data;e.status=r.status;if(r.status===409&&String(e.message).includes('名单已更新')){this.clearParticipant();if(location.pathname!=='/')location.href='/';}throw e;}return data;},
  escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));},
  requireParticipant(){const id=this.participantId(),verified=sessionStorage.getItem('participant_login_verified'),rev=this.cohortRevision();if(!id||verified!==this.loginVersion||(!rev&&id!=='S00')){this.clearParticipant();location.href='/';throw new Error('no verified participant');}document.querySelectorAll('[data-participant-tag]').forEach(x=>x.textContent=id);return id;},
  photoUrl(id,sessionId,artifactKey,photo){return photo?`/express/api/image/${id}/${sessionId}/${artifactKey}/${encodeURIComponent(photo.file_name)}`:'';},
};
