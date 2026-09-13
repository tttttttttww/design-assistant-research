document.getElementById('loginForm').onsubmit=async e=>{
  e.preventDefault();
  const id=document.getElementById('participantId').value.trim().toUpperCase();
  const studentName=document.getElementById('studentName').value.trim();
  const box=document.getElementById('error');
  box.classList.add('hidden');
  try{
    const r=await App.api('/validate',{method:'POST',body:JSON.stringify({participantId:id,studentName})});
    App.setParticipantId(r.participant_id);
    location.href='/task.html';
  }catch(x){
    box.textContent=x.message;
    box.classList.remove('hidden');
  }
};
