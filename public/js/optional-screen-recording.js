/* Optional local-only screen recording. Must be started by an authorized user gesture.
 * No video data leaves this device; existing research APIs and Blob namespace unchanged. */
(() => {
  'use strict';
  const start = document.getElementById('screenRecordingStart');
  const stop = document.getElementById('screenRecordingStop');
  const download = document.getElementById('screenRecordingDownload');
  const consent = document.getElementById('screenRecordingConsent');
  const info = document.getElementById('screenRecordingStatus');
  const parent = document.getElementById('screenRecordingTools');
  const toggle = document.getElementById('screenRecordingToggle');
  if (!start || !stop || !download || !consent || !info || !parent) return;
  let recorder=null, stream=null, chunks=[], videoBlob=null, mime='video/webm', currentStart='', timer=null;
  let recording=false, latestSaved=false;
  const SECURE=window.isSecureContext;
  const supported=SECURE && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
  const update=message => {info.textContent=message;};
  const canStart=()=>supported && consent.checked && !recording;
  const refresh=()=>{
    start.disabled=!canStart();
    start.classList.toggle('hidden',recording);
    stop.classList.toggle('hidden',!recording);
    stop.disabled=!recording;
    download.classList.toggle('hidden',!videoBlob);
    parent.classList.toggle('recording-active',recording);
    toggle.textContent=recording?'● 正在录屏':'可选录屏';
  };
  if(!supported) {
    update(!SECURE?'当前链接不是 HTTPS，无法使用网页录屏；请使用学校认可的设备自带录屏功能。':'当前浏览器不支持网页录屏；可以使用学校认可的设备自带录屏功能。');
  }
  consent.addEventListener('change',refresh);
  function pickMime(){
    const types=['video/webm;codecs=vp8','video/webm','video/mp4'];
    return types.find(t=>MediaRecorder.isTypeSupported?.(t))||'';
  }
  function cleanupStream(){try{stream?.getTracks().forEach(t=>t.stop());}catch{} stream=null;}
  function finishRecording(){
    if(!recorder || recorder.state==='inactive')return;
    clearTimeout(timer);timer=null;
    try{recorder.stop();}catch(e){update('录屏停止失败：'+e.message);}
    cleanupStream(); recording=false; refresh();
  }
  start.addEventListener('click', async () => {
    if (!canStart())return;
    if(videoBlob && !latestSaved){update('上一段录像还未保存，请先点击“保存录像”。');return;}
    let acquired=null;
    try {
      // Required to be called directly inside a user gesture. Permission cannot be silently persisted.
      acquired = await navigator.mediaDevices.getDisplayMedia({
        video:{displaySurface:'browser',frameRate:12},audio:false,preferCurrentTab:true,monitorTypeSurfaces:'exclude',surfaceSwitching:'exclude'
      });
      const track=acquired.getVideoTracks()[0];
      const surface=track?.getSettings?.()?.displaySurface;
      if(surface!=='browser'){
        acquired.getTracks().forEach(t=>t.stop());
        update('为保护隐私，只允许录制浏览器标签页。请重新开始并选择当前平台标签页；如设备不支持标签页录制，请改用学校批准的系统录屏。');
        return;
      }
      const type=pickMime();
      chunks=[];videoBlob=null;latestSaved=false;
      mime=type||'video/webm';
      recorder=new MediaRecorder(acquired,type?{mimeType:type,videoBitsPerSecond:650000}:{videoBitsPerSecond:650000});
      stream=acquired; recording=true; currentStart=new Date().toISOString().replace(/[:.]/g,'-');
      recorder.addEventListener('dataavailable',event=>{if(event.data?.size)chunks.push(event.data);});
      recorder.addEventListener('stop',()=>{
        clearTimeout(timer);timer=null;
        if(chunks.length){videoBlob=new Blob(chunks,{type:recorder.mimeType||mime});update('录制已结束。请点击“保存录像”下载到本设备，再关闭或离开页面。录像不会自动上传。');}
        else update('录制已结束，但浏览器未产生可保存的数据，请使用设备自带录屏功能。');
        chunks=[];recording=false;cleanupStream();refresh();
      },{once:true});
      track.addEventListener('ended',finishRecording,{once:true});
      recorder.start(3000);
      timer=setTimeout(()=>{finishRecording();update('已达到55分钟录制上限。请保存本次录像。');},55*60*1000);
      update('正在录制当前浏览器标签页（无声音）。结束后务必点击“停止录屏”和“保存录像”。');
      refresh();
    }catch(e){
      acquired?.getTracks?.().forEach(t=>t.stop());
      recorder=null;recording=false;cleanupStream();refresh();
      update(e?.name==='NotAllowedError'?'未获得录屏授权，本节仍可正常学习。':`无法开始录屏：${e?.message||'设备或浏览器不支持'}`);
    }
  });
  stop.addEventListener('click',finishRecording);
  download.addEventListener('click',()=>{
    if(!videoBlob)return;
    const safeId=(typeof App!=='undefined'&&App.requireParticipant)?String(App.requireParticipant()).replace(/[^A-Za-z0-9_-]/g,''):'student';
    const extension=(videoBlob.type.includes('mp4')?'mp4':'webm');
    const a=document.createElement('a'); const url=URL.createObjectURL(videoBlob);
    a.href=url;a.download=`workshop_${safeId}_${currentStart}.${extension}`;
    document.body.append(a);a.click();a.remove();
    latestSaved=true;
    update('已请求浏览器下载录像，请到本设备“下载”文件夹核对文件是否真正保存，然后交由获授权的教师管理。');
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  });
  window.addEventListener('beforeunload',e=>{
    if(recording || (videoBlob&&!latestSaved)){e.preventDefault();e.returnValue='';}
  });
  refresh();
})();
