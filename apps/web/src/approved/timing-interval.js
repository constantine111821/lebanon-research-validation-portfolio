import {claims, evidenceFor, eligible, reviewed} from './shared.js';

const day=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
  const n=Date.parse(value+'T00:00:00Z');
  return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;
};
function bounds(c){
  if(c.date_precision==='DAY'){const n=day(c.current_verified_value);return n===null?null:[n,n];}
  if(c.date_precision==='RANGE'){
    const a=day(c.current_verified_value?.start),b=day(c.current_verified_value?.end);
    return a!==null&&b!==null&&b>=a?[a,b]:null;
  }
  if(c.date_precision==='MONTH'&&typeof c.current_verified_value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(c.current_verified_value)){
    const a=day(c.current_verified_value+'-01'),date=new Date(a);date.setUTCMonth(date.getUTCMonth()+1);
    return [a,date.getTime()-86400000];
  }
  return null;
}
function scopeKey(c){const scope=c.effect_claim_id??c.effect_scope??c.scope;return typeof scope==='string'&&scope.trim()&&!/^(unknown|not established|not recorded|unspecified|n\/?a|not applicable)$/i.test(scope.trim())?scope.trim():null;}

// A read-only date-bound calculation, never a canonical finding or a service
// inference. Ambiguous scopes/endpoints, reopened reviews and missing evidence
// withhold the interval. Calendar bounds retain the recorded date precision.
export function timingIntervals(s,id){
  const all=claims(s,id).filter(c=>c.claim_family==='EFFECT_ONSET'||(c.claim_family==='RESTORATION_DATE'&&['DATE','DATE_RANGE'].includes(c.value_type)));
  const facilities=new Set((s.records.INCIDENT_FACILITY||[]).filter(l=>l.incident_id===id&&l.is_current!==false).map(l=>l.facility_id));
  const binding=c=>{const scope=scopeKey(c);return scope&&(c.facility_id||facilities.size<=1)?JSON.stringify([c.facility_id||null,scope]):null;};
  const bindings=[...new Set(all.map(binding).filter(Boolean))],intervals=[];
  for(const key of bindings){
    const same=all.filter(c=>binding(c)===key),starts=same.filter(c=>c.claim_family==='EFFECT_ONSET'),ends=same.filter(c=>c.claim_family==='RESTORATION_DATE');
    if(starts.length!==1||ends.length!==1)continue;
    const [start,end]=[starts[0],ends[0]];
    if(![start,end].every(c=>eligible(c,s)&&reviewed(c,s)&&evidenceFor(s,c.claim_id).some(p=>p.relation.support_direction==='SUPPORTS')))continue;
    const a=bounds(start),b=bounds(end);if(!a||!b||b[0]<a[1])continue;
    intervals.push({scope:scopeKey(start),facility_id:start.facility_id||null,start_claim_id:start.claim_id,end_claim_id:end.claim_id,min_days:(b[0]-a[1])/86400000,max_days:(b[1]-a[0])/86400000,start_precision:start.date_precision,end_precision:end.date_precision});
  }
  return intervals;
}
