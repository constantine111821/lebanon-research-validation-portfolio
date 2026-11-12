import { createHash } from 'node:crypto';
import { repositoryRecords, projectFact, facilityLocation, csvRecord, csvTable, CSV_COLUMNS, CSV_SCHEMA_VERSION } from '../../../apps/web/src/approved/phase2-data.js';
import { pick, sourceFields, relationFields } from '../../../apps/web/src/approved/citations.js';
import { tasks } from '../../../apps/web/src/approved/shared.js';

export const SCHEMA_VERSION = '1.0.0', EXPORT_POLICY_VERSION = 'supervisor-acceptance-008/finishing-1';
const rows = (s,k)=>s.records?.[k]||[];
const sorted = (a,k)=>a.sort((x,y)=>String(x[k]).localeCompare(String(y[k])));
const canonical = x => Array.isArray(x) ? x.map(canonical) : x && typeof x==='object' ? Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])) : x;
export const stableJSON = x=>JSON.stringify(canonical(x),null,2)+'\n';
export const sha256 = bytes=>createHash('sha256').update(bytes).digest('hex');
const factKeys = ['is_current','identity_purpose','source_described_type','validation_origin','individual_human_factual_adjudication','current_value_authority','legacy_refs','ai_original_value','ai_original_provenance','attack_claim_id','effect_claim_id','supersedes_claim_revision'];
const facilityKeys = ['facility_id','canonical_name','aliases','identity_status','identity_notes','source_described_types','human_observed_type','locality_governorate','geo','location_review','legacy_refs'];
const incidentKeys = ['incident_id','incident_label','incident_type','event_start','event_end','date_precision','clustering_status','clustering_basis','temporal_eligibility','legacy_case_refs','incident_coordinates','strike_coordinates'];
const historyKeys = ['activity_id','incident_id','facility_id','entity_type','entity_id','action_type','actor','actor_role','timestamp','reason','before_ref','after_ref','legacy_refs'];

export function researchDataset(s, { records = repositoryRecords(s), checkBudget = () => {} } = {}) {
  const eligible = [...records].sort((a,b)=>a.incident_id.localeCompare(b.incident_id));
  const eligibleIds = new Set(eligible.map(i=>i.incident_id));
  const links = sorted(rows(s,'INCIDENT_FACILITY').filter(l=>eligibleIds.has(l.incident_id)), 'incident_facility_id');
  const facilityIds = new Set(links.map(l=>l.facility_id));
  // Shared facility findings are relevant across cases, without approving their origin incident.
  const facts = sorted(rows(s,'CLAIM').filter(c=>eligibleIds.has(c.incident_id) || (facilityIds.has(c.facility_id) && (c.incident_id==null || ['IDENTITY','FACILITY_TYPE'].includes(c.claim_family)))), 'claim_id').map(c=>{
    checkBudget();
    return {...pick(c,factKeys),...projectFact(s,c),requirement_category:s.requirement_categories?.[c.claim_id]??null};
  });
  const factIds = new Set(facts.map(c=>c.claim_id));
  const factSources = sorted(rows(s,'CLAIM_SOURCE').filter(l=>factIds.has(l.claim_id)), 'claim_source_id').map(l=>pick(l,relationFields));
  const sourceIds = new Set(factSources.map(l=>l.source_id));
  const facilities = sorted(rows(s,'FACILITY').filter(f=>facilityIds.has(f.facility_id)), 'facility_id').map(f=>({...pick(f,facilityKeys),location:facilityLocation(s,f)}));
  // Location evidence and recorded dependencies are preserved without adding unrelated findings.
  for (const f of facilities) for (const id of [f.geo?.source_id,f.geo?.source,f.location_review?.source_id]) if (rows(s,'SOURCE').some(x=>x.source_id===id)) sourceIds.add(id);
  for (const l of factSources) for (const id of [l.dependency_provenance?.underlying_source_id,l.dependency_provenance?.underlying_source,l.dependency_provenance?.underlying]) if (rows(s,'SOURCE').some(x=>x.source_id===id)) sourceIds.add(id);
  const sources = sorted(rows(s,'SOURCE').filter(x=>sourceIds.has(x.source_id)), 'source_id').map(x=>pick(x,sourceFields));
  const history = sorted(rows(s,'ACTIVITY_LOG').filter(h=>eligibleIds.has(h.incident_id) || (factIds.has(h.entity_id) || facilityIds.has(h.entity_id))), 'activity_id').map(h=>pick(h,historyKeys));
  // No command payloads, drafts, sessions or unbounded nested disposition snapshots.
  const dispositionHistory = (s.disposition_history||[]).filter(h=>eligibleIds.has(h.incident_id)||factIds.has(h.target_id)).map(h=>pick(h,['id','operation_id','incident_id','target_type','target_id','actor','action','prior_state','new_state','reason','revision','request_id','occurred_at','invalidation']));
  const originIds = new Set([...facts.map(c=>c.incident_id),...history.map(h=>h.incident_id),...dispositionHistory.map(h=>h.incident_id)].filter(id=>id&&!eligibleIds.has(id)));
  const referenceIncidents = [...originIds].sort().map(id=>({incident_id:id,incident_label:rows(s,'INCIDENT').find(i=>i.incident_id===id)?.incident_label??null,reference_only:true,approved_for_validated_output:false,reason:'Origin of an included shared finding or relevant history; no output authority conferred.'}));
  const incidents = eligible.map(r=>({...pick(r.incident,incidentKeys),classification:r.record_type,revision:r.incident_revision,acceptance:{approval:r.approval,completion:r.completion,readiness:r.acceptance},output_eligible:true,limitations:r.limitations}));
  return {schema_version:SCHEMA_VERSION,csv_schema_version:CSV_SCHEMA_VERSION,export_policy_version:EXPORT_POLICY_VERSION,incidents,reference_incidents:referenceIncidents,facilities,incident_facilities:links,facts,sources,fact_sources:factSources,tasks:[...eligibleIds].flatMap(id=>tasks(s,id)),disposition_history:dispositionHistory,history,waivers:facts.filter(f=>f.waived).map(f=>({claim_id:f.claim_id,incident_id:f.incident_id,reason:f.disposition_reason,waiver:true,factual_certification:false}))};
}

export function featureCollection(data) {
  return {type:'FeatureCollection',features:data.incident_facilities.map(l=>{
    const f=data.facilities.find(f=>f.facility_id===l.facility_id), p=f?.location;
    const valid=Number.isFinite(p?.latitude)&&Number.isFinite(p?.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
    return {type:'Feature',id:l.incident_facility_id,geometry:valid?{type:'Point',coordinates:[p.longitude,p.latitude]}:null,properties:{...l,classification:data.incidents.find(i=>i.incident_id===l.incident_id)?.classification,coordinate_scope:'FACILITY_ONLY',coordinate_provenance:p??null,geometry_missing_reason:valid?null:'Facility coordinates missing or invalid; no incident/strike substitution.'}};
  })};
}

// ZIP method 0, UTF-8 names, fixed DOS timestamp. No dependency or file extraction.
function crc32(bytes) { let crc=0xffffffff; for(const b of bytes){crc^=b;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0; }
export class ResearchPackageSizeError extends Error {}

// Check projected JSON before expanding repeated source fields into strings.
// This counts a lower bound. The ZIP check uses the exact encoded size.
function checkProjectionSize(value, maxBytes, checkBudget) {
  if (!Number.isFinite(maxBytes)) return 0;
  let bytes = 0;
  function visit(item) {
    checkBudget();
    if (Array.isArray(item)) {
      for (const value of item) visit(value);
    } else if (item !== null && typeof item === "object") {
      for (const [key, value] of Object.entries(item)) {
        bytes += Buffer.byteLength(key);
        visit(value);
      }
    } else if (typeof item === "string") bytes += Buffer.byteLength(item);
    else if (item !== undefined) bytes++;
    if (bytes > maxBytes) throw new ResearchPackageSizeError();
  }
  visit(value);
  return bytes;
}

function* boundedCSVRecords(records, maxBytes, checkBudget) {
  for (const record of records) {
    checkBudget();
    checkProjectionSize([record.facts, record.facility_facts], maxBytes, checkBudget);
    yield csvRecord(record);
  }
}

export function zipFiles(files, { maxBytes = Infinity, checkBudget = () => {} } = {}) {
  const size = Object.entries(files).reduce(
    (total, [name, payload]) => total + 76 + 2 * Buffer.byteLength(name) + Buffer.byteLength(payload),
    22,
  );
  if (size > maxBytes) throw new ResearchPackageSizeError();
  const local=[],central=[];let offset=0;
  for(const [name,payload] of Object.entries(files).sort(([a],[b])=>a.localeCompare(b))) {
    checkBudget();
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw Error('Unsafe package filename');
    const n=Buffer.from(name), b=Buffer.from(payload), crc=crc32(b), h=Buffer.alloc(30),c=Buffer.alloc(46);
    h.writeUInt32LE(0x04034b50); h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt16LE(33,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);
    c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(33,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    local.push(h,n,b);central.push(c,n);offset+=h.length+n.length+b.length;
  }
  const tail=Buffer.alloc(22), directory=Buffer.concat(central);tail.writeUInt32LE(0x06054b50);tail.writeUInt16LE(Object.keys(files).length,8);tail.writeUInt16LE(Object.keys(files).length,10);tail.writeUInt32LE(directory.length,12);tail.writeUInt32LE(offset,16);
  return Buffer.concat([...local,directory,tail]);
}

export function buildResearchPackage(s,{appCommit="",generatedAt=new Date().toISOString(),schema="",consumer="",datasetContext="CURRENT_ELIGIBLE_LOCAL_WORKSPACE",maxArchiveBytes=Infinity,checkBudget=()=>{}}={}) {
  if(!/^[a-f0-9]{40}$/.test(appCommit||''))throw Error('Export requires exact application commit');
  if(!schema||!consumer)throw Error('Schema and standalone verifier are required');
  checkBudget();
  let projectedBytes = 0;
  const records = repositoryRecords(s, {
    checkBudget,
    checkRecord(record) {
      const fields = [...record.facts, ...record.facility_facts].map(fact => [fact.claim_id, fact.citations]);
      projectedBytes += checkProjectionSize(fields, maxArchiveBytes - projectedBytes, checkBudget);
    },
  });
  const data = researchDataset(s, { records, checkBudget });
  checkBudget();
  const geo = featureCollection(data);
  checkProjectionSize(data, maxArchiveBytes, checkBudget);
  checkProjectionSize(geo, maxArchiveBytes, checkBudget);
  const semantic = sha256(stableJSON(data));
  let csvBytes = 0;
  const csv = csvTable(CSV_COLUMNS, boundedCSVRecords(records, maxArchiveBytes, checkBudget), row => {
    checkBudget();
    csvBytes += Buffer.byteLength(row) + 2;
    if (csvBytes > maxArchiveBytes) throw new ResearchPackageSizeError();
  });
  checkBudget();
  const files={'research_export.json':stableJSON({...data,metadata:{app_commit:appCommit,generated_at:generatedAt,semantic_sha256:semantic,dataset_context:datasetContext}}),'validated_incidents.csv':csv,'incident_facilities.geojson':stableJSON(geo),'SCHEMA.md':schema,'verify_export.py':consumer};
  const manifest={package_version:SCHEMA_VERSION,schema_version:SCHEMA_VERSION,csv_schema_version:CSV_SCHEMA_VERSION,export_policy_version:EXPORT_POLICY_VERSION,app_commit:appCommit,generated_at:generatedAt,semantic_sha256:semantic,dataset_context:datasetContext,eligible_incident_ids:data.incidents.map(i=>i.incident_id),counts:Object.fromEntries(['incidents','reference_incidents','facilities','incident_facilities','facts','sources','fact_sources','tasks','waivers'].map(k=>[k,data[k].length])),geometry_present:geo.features.filter(f=>f.geometry).length,geometry_null:geo.features.filter(f=>!f.geometry).length,encoding:'UTF-8; CSV RFC 4180 quoting, nested arrays as JSON',limitations:['Acceptance is not factual certification or corpus mapping authority.','Reference-only incidents excluded from eligible counts, CSV and GeoJSON.','Recorded citation gaps remain research data-quality gaps.','Missing modeling inputs remain unknown; no impact model.'],files:Object.entries(files).map(([name,content])=>({name,size_bytes:Buffer.byteLength(content),sha256:sha256(content)}))};
  files['manifest.json']=stableJSON(manifest);
  checkBudget();
  const bytes = zipFiles(files, { maxBytes: maxArchiveBytes, checkBudget });
  checkBudget();
  return {bytes,files,manifest,data,filename:`research-export-${SCHEMA_VERSION}-${semantic.slice(0,12)}.zip`};
}
