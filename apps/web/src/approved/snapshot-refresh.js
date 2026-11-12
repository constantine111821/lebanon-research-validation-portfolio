// Read-only refresh scheduling. No factual state, cache, or persistence lives here.
// Foreground submissions retain their existing immediate snapshot refresh.
export function installSnapshotRefresh({refresh, onError, dialog, intervalMs=15000}) {
  let running=false;
  async function check(){
    if(running||document.visibilityState==='hidden')return;
    running=true;
    try{await refresh();}catch(error){onError?.(error);}finally{running=false;}
  }
  const afterDialog=()=>setTimeout(check,0);
  const timer=setInterval(check,intervalMs);
  window.addEventListener('focus',check);
  document.addEventListener('visibilitychange',check);
  dialog?.addEventListener('close',afterDialog);
  return ()=>{
    clearInterval(timer);
    window.removeEventListener('focus',check);
    document.removeEventListener('visibilitychange',check);
    dialog?.removeEventListener('close',afterDialog);
  };
}
