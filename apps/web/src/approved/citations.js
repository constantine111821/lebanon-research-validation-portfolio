// Read-only public research projection. No draft/profile/auth payloads.
export const pick = (row, keys) => Object.fromEntries(keys.map(k => [k, row?.[k] ?? null]));
export const sourceFields = ['source_id','source_type','title','publisher_platform','original_url','canonical_url','publication_date','retrieval_date','retrieval_body_status','content_preservation_status','evidence_locator','limitations','social_fields','legacy_refs'];
export const relationFields = ['claim_source_id','claim_id','source_id','support_direction','directness','originality','dependency_group_id','dependency_provenance','evidence_locator','limitations'];
export function citation(source, relation) {
  return {...pick(source, sourceFields), ...pick(relation, relationFields),
    source_evidence_locator: source?.evidence_locator ?? null,
    source_limitations: source?.limitations ?? null,
    url_status: [source?.original_url,source?.canonical_url].some(v=>/^https?:/i.test(String(v||''))) ? 'RECORDED_VERBATIM' : source?.original_url || source?.canonical_url ? 'URL_UNAVAILABLE_PRESERVED_IDENTIFIER' : 'MISSING_NOT_RECORDED'};
}
export function factCitations(s, id) {
  return (s.records?.CLAIM_SOURCE || []).filter(r=>r.claim_id===id).map(r=>{
    const source = s.records.SOURCE.find(x=>x.source_id===r.source_id);
    if (!source) throw Error('Export source reference missing: '+r.source_id);
    return citation(source,r);
  }).sort((a,b)=>String(a.claim_source_id).localeCompare(String(b.claim_source_id)));
}
