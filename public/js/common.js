window.App={
  apiBase:'/express/api',
  loginVersion:'11.9',
  participantId(){return sessionStorage.getItem('participant_id')||'';},
  setParticipantId(id){sessionStorage.setItem('participant_id',id);sessionStorage.setItem('participant_login_verified',this.loginVersion);},
  clearParticipant(){sessionStorage.removeItem('participant_id');sessionStorage.removeItem('participant_login_verified');},
  async api(path,options={}){const headers={...(options.headers||{})};if(!(options.body instanceof FormData))headers['Content-Type']=headers['Content-Type']||'application/json';const r=await fetch(this.apiBase+path,{...options,headers});let data={};try{data=await r.json();}catch{}if(!r.ok){const e=new Error(data.error||data.message||'操作失败');e.data=data;e.status=r.status;throw e;}return data;},
  escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));},
  requireParticipant(){const id=this.participantId(),verified=sessionStorage.getItem('participant_login_verified');if(!id||verified!==this.loginVersion){this.clearParticipant();location.href='/';throw new Error('no verified participant');}document.querySelectorAll('[data-participant-tag]').forEach(x=>x.textContent=id);return id;},
  photoUrl(id,sessionId,artifactKey,photo){return photo?`/express/api/image/${id}/${sessionId}/${artifactKey}/${encodeURIComponent(photo.file_name)}`:'';},
};
