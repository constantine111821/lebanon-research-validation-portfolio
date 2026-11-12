// Presentation-only guidance. No research state, storage or transaction access.
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let serial=0;
export function guidance(id,html,{warn=false}={}){
 return warn?`<div class="callout warning guide-note" data-guidance="${escape(id)}">${html}</div>`:`<p class="subtle guide-note" data-guidance="${escape(id)}">${html}</p>`;
}
export function help(id,label,html){
 const bodyId=`guide-help-${id}-${++serial}`;
 return `<details class="guidance-help" data-help="${escape(id)}"><summary aria-controls="${escape(bodyId)}">${escape(label)}</summary><div class="guidance-help-body" id="${escape(bodyId)}">${html}<button type="button" class="text-button" data-help-close aria-label="Close help: ${escape(label)}">Close help</button></div></details>`;
}
export function incidentHelp(id, label, html) {
 const popupId = escape(`incident-help-${id}-${++serial}`);
 const title = escape(label);
 return `<div class="incident-step-help">
  <button type="button" class="incident-help-trigger" popovertarget="${popupId}" aria-label="Help: ${title}"><span aria-hidden="true">?</span></button>
  <section class="incident-help-popover" id="${popupId}" popover="auto" aria-labelledby="${popupId}-title">
   <h3 id="${popupId}-title">${title}</h3>
   ${html}
   <button type="button" popovertarget="${popupId}" popovertargetaction="hide" autofocus>Close help</button>
  </section>
 </div>`;
}
const bound=new WeakSet();
export function bindGuidance(root=document){
 if(bound.has(root))return;bound.add(root);
 const close=details=>{if(!details)return;details.open=false;details.querySelector('summary')?.focus()};
 root.addEventListener('click',event=>{const button=event.target.closest?.('[data-help-close]');if(button){event.preventDefault();close(button.closest('details[data-help]'))}});
 root.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const details=event.target.closest?.('details[data-help][open]');if(details){event.preventDefault();event.stopPropagation();close(details)}},true);
}
