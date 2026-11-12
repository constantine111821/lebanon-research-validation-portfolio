"""Standalone package consumer: Python standard library only; no application imports."""
import csv
import hashlib
import io
import json
import re
import sys
import urllib.parse
import zipfile


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def canonical_bytes(value):
    # Match exporter JSON.stringify pretty output for semantic hashing (UTF-8).
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       separators=(',', ': ')) + '\n').encode('utf-8')


def verify(filename):
    with zipfile.ZipFile(filename) as archive:
        names = archive.namelist()
        required = {'manifest.json', 'research_export.json', 'validated_incidents.csv',
                    'incident_facilities.geojson', 'SCHEMA.md', 'verify_export.py'}
        require(set(names) == required and len(names) == len(required), 'Unexpected, duplicate or missing package file')
        payloads = {name: archive.read(name) for name in names}
    manifest = json.loads(payloads['manifest.json'])
    require(manifest['schema_version'] == manifest['package_version'] == '1.0.0', 'Unsupported package/schema version')
    require(manifest['csv_schema_version'] == '2.0.0', 'Unsupported CSV version')
    require(manifest['export_policy_version'] == 'supervisor-acceptance-008/finishing-1', 'Unsupported export policy')
    require(re.fullmatch('[a-f0-9]{40}', manifest['app_commit']), 'Exact application commit missing')
    entries = manifest['files']
    require({e['name'] for e in entries} == required - {'manifest.json'} and len(entries) == 5, 'Manifest payload list mismatch')
    for entry in entries:
        content = payloads[entry['name']]
        require(len(content) == entry['size_bytes'], 'Size mismatch: ' + entry['name'])
        require(hashlib.sha256(content).hexdigest() == entry['sha256'], 'SHA-256 mismatch: ' + entry['name'])
    data = json.loads(payloads['research_export.json'])
    metadata = data.pop('metadata')
    # Hash canonical source bytes by deleting only the metadata member, avoiding
    # Python/JS float formatting differences. Canonical serialization is checked by JS tests.
    text = payloads['research_export.json'].decode('utf-8')
    # Metadata is a top-level sorted-key object; its boundaries are JSON parsed first.
    metadata_text = json.dumps(metadata, ensure_ascii=False, sort_keys=True, indent=2)
    indented = '\n'.join('  ' + line for line in metadata_text.splitlines())
    semantic_text = text.replace('  "metadata": ' + indented.lstrip() + ',\n', '', 1)
    require(semantic_text != text, 'Canonical metadata block missing')
    semantic = hashlib.sha256(semantic_text.encode('utf-8')).hexdigest()
    require(semantic == metadata['semantic_sha256'] == manifest['semantic_sha256'], 'Semantic digest mismatch')
    require(metadata['dataset_context'] == manifest['dataset_context'] and metadata['app_commit'] == manifest['app_commit'] and metadata['generated_at'] == manifest['generated_at'], 'Generation metadata mismatch')
    for key in ['schema_version', 'csv_schema_version', 'export_policy_version']:
        require(data[key] == manifest[key], 'Data version mismatch: ' + key)
    require(set(data) == {'schema_version','csv_schema_version','export_policy_version','incidents','reference_incidents','facilities','incident_facilities','facts','sources','fact_sources','tasks','disposition_history','history','waivers'}, 'Unexpected/private research table')
    keys = {'incidents':'incident_id', 'reference_incidents':'incident_id', 'facilities':'facility_id',
            'incident_facilities':'incident_facility_id', 'facts':'claim_id', 'sources':'source_id', 'fact_sources':'claim_source_id'}
    tables = {}
    for name, key in keys.items():
        table = {row[key]: row for row in data[name]}
        require(None not in table and len(table) == len(data[name]), 'Duplicate/missing ID: ' + name)
        tables[name] = table
    eligible, refs = tables['incidents'], tables['reference_incidents']
    require(not (eligible.keys() & refs.keys()), 'Reference incident incorrectly eligible')
    require(sorted(eligible) == sorted(manifest['eligible_incident_ids']), 'Eligible population mismatch')
    require(all(r['reference_only'] is True and r['approved_for_validated_output'] is False for r in refs.values()), 'Reference authority expanded')
    for incident in eligible.values():
        approval, completion = incident['acceptance']['approval'], incident['acceptance']['completion']
        require(incident['output_eligible'] is True and approval['status'] == 'APPROVED' and approval['approved_incident_revision'] == incident['revision'] and completion['completion_revision'] == incident['revision'], 'Stale or unauthorized eligible incident')
    all_incidents = eligible.keys() | refs.keys()
    gaps, citations, findings = [], [], []
    for link in data['incident_facilities']:
        require(link['incident_id'] in eligible and link['facility_id'] in tables['facilities'], 'Broken incident-facility reference')
    for fact in data['facts']:
        require(fact['incident_id'] is None or fact['incident_id'] in all_incidents, 'Broken fact origin reference')
        require(fact['facility_id'] is None or fact['facility_id'] in tables['facilities'], 'Broken fact facility reference')
        if fact['value'] is None: gaps.append({'claim_id':fact['claim_id'], 'gap':'UNKNOWN_RECORDED_VALUE'})
        if fact['value_type'] == 'DATE' and fact['date_precision'] in [None, 'UNKNOWN']: gaps.append({'claim_id':fact['claim_id'], 'gap':'DATE_PRECISION_NOT_ESTABLISHED'})
        require(fact['disposition'] in ['ACTIVE','APPROVED','DEFERRED'], 'Invalid fact disposition')
        expected_value = fact['value'] if fact['lab_review_state']=='REVIEWED' and not fact['waived'] and fact['validation_state'] in ['SUPPORTED','NOT_SUPPORTED'] and fact['value'] is not None and fact['value'] != '' else None
        require(fact['export_value'] == expected_value, 'Certified value contradicts recorded review/waiver state')
        findings.append({k:fact[k] for k in ['claim_id','claim_family','fact_label','subject','scope','value','export_value','value_type','date_precision','quantitative_unit','validation_state','lab_review_state','disposition','waived']})
    for link in data['fact_sources']:
        require(link['claim_id'] in tables['facts'] and link['source_id'] in tables['sources'], 'Broken fact-source reference')
        require(link['support_direction'] in ['SUPPORTS','CONTRADICTS','LIMITS','CONTEXT_ONLY'], 'Invalid evidence direction')
        source = tables['sources'][link['source_id']]
        for field in ['title','publisher_platform']:
            if not source.get(field): gaps.append({'source_id':source['source_id'],'gap':'MISSING_'+field.upper()})
        pub=source.get('publication_date')
        if pub is None or (isinstance(pub,dict) and (pub.get('value') is None or pub.get('precision')=='UNKNOWN')):
            gaps.append({'source_id':source['source_id'],'gap':'PUBLICATION_DATE_NOT_ESTABLISHED'})
        for key in ['original_url','canonical_url']:
            url = source.get(key)
            if not url:
                gaps.append({'source_id':source['source_id'],'gap':'MISSING_'+key.upper()})
            elif re.match(r'^https?:', str(url), re.I):
                try:
                    parsed = urllib.parse.urlsplit(str(url))
                except ValueError:
                    parsed = urllib.parse.urlsplit('')
                if parsed.scheme not in ['http','https'] or not parsed.netloc or re.search(r'\s', str(url)):
                    gaps.append({'source_id':source['source_id'],'gap':'HISTORICALLY_MALFORMED_'+key.upper(),'recorded':url})
        if any(source.get(k) for k in ['original_url','canonical_url']) and not any(re.match(r'^https?:',str(source.get(k) or ''),re.I) for k in ['original_url','canonical_url']):
            gaps.append({'source_id':source['source_id'],'gap':'URL_UNAVAILABLE_PRESERVED_IDENTIFIER'})
        locators = link.get('evidence_locator') or []
        if not any(any(x.get(k) is not None and x.get(k) != '' for k in ['locator','value','page','paragraph','timestamp','frame','section']) for x in locators): gaps.append({'claim_source_id':link['claim_source_id'],'gap':'MISSING_LOCATOR'})
        if not any(x.get('excerpt') or x.get('visual_description') for x in locators): gaps.append({'claim_source_id':link['claim_source_id'],'gap':'MISSING_EXCERPT_OR_VISUAL_DESCRIPTION'})
        citations.append({'claim_id':link['claim_id'],'source_id':source['source_id'],'title':source['title'],'publisher_account':source['publisher_platform'],'original_url_or_identifier':source['original_url'],'canonical_url':source['canonical_url'],'url_status':'RECORDED_VERBATIM' if any(re.match(r'^https?:',str(source.get(k) or ''),re.I) for k in ['original_url','canonical_url']) else 'URL_UNAVAILABLE_PRESERVED_IDENTIFIER' if source['original_url'] or source['canonical_url'] else 'MISSING_NOT_RECORDED','direction':link['support_direction'],'locator_excerpt':locators,'limitations':link['limitations'],'preservation':source['content_preservation_status']})
    for task in data['tasks']:
        require(task['incident_id'] in eligible and (not task.get('claim_id') or task['claim_id'] in tables['facts']), 'Broken task reference')
    for history in data['disposition_history']:
        require(history['incident_id'] in all_incidents, 'Broken disposition history origin')
        require(history['target_id'] in (all_incidents if history['target_type']=='incident' else tables['facts']), 'Broken disposition history target')
    csv.field_size_limit(20 * 1024 * 1024)
    records = list(csv.DictReader(io.StringIO(payloads['validated_incidents.csv'].decode('utf-8-sig'))))
    require(len(records) == len(eligible) and {r['incident_id'] for r in records} == set(eligible), 'CSV eligible population mismatch')
    for row in records:
        iid = row['incident_id']
        require(row['csv_schema_version'] == '2.0.0' and row['record_type'] == eligible[iid]['classification']['canonical'], 'CSV version/classification mismatch')
        csv_links = json.loads(row['incident_facility_links_json'])
        expected_links = [l for l in data['incident_facilities'] if l['incident_id'] == iid and l.get('is_current') is not False]
        require(csv_links == expected_links, 'CSV multi-facility link mismatch')
        csv_facts = json.loads(row['facts_and_provenance_json']) + json.loads(row['facility_facts_and_provenance_json'])
        csv_citations = json.loads(row['citations_json'])
        require(csv_citations == [{'claim_id':f['claim_id'],'citations':f['citations']} for f in csv_facts], 'Primary CSV citation grouping mismatch')
        for fact in csv_facts:
            original = tables['facts'][fact['claim_id']]
            for ck, jk in [('value','export_value'),('recorded_value','value'),('evidence_state','validation_state'),('lab_review_state','lab_review_state'),('disposition','disposition'),('waived','waived'),('scope','scope'),('subject','subject'),('unit','quantitative_unit'),('date_precision','date_precision')]:
                require(fact[ck] == original[jk], 'CSV finding mismatch: '+fact['claim_id']+'/'+ck)
            require(fact['citations'] == original['citations'], 'CSV citation metadata mismatch')
    for fact in data['facts']:
        related = [l for l in data['fact_sources'] if l['claim_id'] == fact['claim_id']]
        require(set(fact['source_ids']) == {l['source_id'] for l in related} and set(fact['claim_source_ids']) == {l['claim_source_id'] for l in related}, 'Fact evidence ID mismatch')
        require({c['claim_source_id'] for c in fact['citations']} == {l['claim_source_id'] for l in related}, 'Missing per-finding citation')
        for c in fact['citations']:
            source, link = tables['sources'][c['source_id']], tables['fact_sources'][c['claim_source_id']]
            for k in ['title','publisher_platform','original_url','canonical_url','content_preservation_status']:
                require(c[k] == source[k], 'Exporter changed source metadata: '+k)
            for k in ['support_direction','evidence_locator','limitations','dependency_group_id','dependency_provenance']:
                require(c[k] == link[k], 'Exporter changed evidence relationship: '+k)
    geo = json.loads(payloads['incident_facilities.geojson'])
    require(geo['type'] == 'FeatureCollection' and len(geo['features']) == len(data['incident_facilities']), 'GeoJSON association count mismatch')
    require({f['id'] for f in geo['features']} == set(tables['incident_facilities']), 'GeoJSON ID mismatch')
    for feature in geo['features']:
        props, geometry = feature['properties'], feature['geometry']
        link = tables['incident_facilities'][feature['id']]
        require(all(props[k] == v for k,v in link.items()), 'GeoJSON link changed')
        require(props['classification'] == eligible[link['incident_id']]['classification'], 'GeoJSON classification mismatch')
        facility = tables['facilities'][link['facility_id']]
        p = facility['location']
        require(props['coordinate_scope'] == 'FACILITY_ONLY' and props['coordinate_provenance'] == p, 'Geometry provenance mismatch')
        lat, lon = p['latitude'], p['longitude']
        valid = isinstance(lat,(int,float)) and not isinstance(lat,bool) and isinstance(lon,(int,float)) and not isinstance(lon,bool) and abs(lat)<=90 and abs(lon)<=180
        if valid: require(geometry == {'type':'Point','coordinates':[lon,lat]}, 'Geometry changed recorded facility coordinates')
        else:
            require(geometry is None and bool(props['geometry_missing_reason']), 'Missing geometry silently dropped/substituted')
            gaps.append({'incident_facility_id':feature['id'],'gap':'MISSING_OR_INVALID_FACILITY_COORDINATES'})
    require(sum(f['geometry'] is not None for f in geo['features']) == manifest['geometry_present'] and sum(f['geometry'] is None for f in geo['features']) == manifest['geometry_null'], 'Manifest geometry counts mismatch')
    for name, count in manifest['counts'].items(): require(len(data[name]) == count, 'Manifest count mismatch: '+name)
    require({w['claim_id'] for w in data['waivers']} == {f['claim_id'] for f in data['facts'] if f['waived']}, 'Waiver population mismatch')
    for waiver in data['waivers']: require(waiver['factual_certification'] is False and bool(waiver['reason']), 'Waiver confused with certification')
    gaps=list({json.dumps(g,sort_keys=True,ensure_ascii=False):g for g in gaps}.values())
    gap_counts={name:sum(g['gap']==name for g in gaps) for name in sorted({g['gap'] for g in gaps})}
    return {'status':'PASS','consumer':'Python standard library; package only; no database/app/network','app_commit':manifest['app_commit'],'dataset_context':manifest['dataset_context'],'counts':manifest['counts'],'geometry_present':manifest['geometry_present'],'geometry_null':manifest['geometry_null'],'classification_counts':{k:sum(i['classification']['group']==k for i in eligible.values()) for k in ['attack','context','unresolved']},'multisite_incidents':[iid for iid in eligible if sum(l['incident_id']==iid for l in data['incident_facilities'])>1],'reconstructed_incidents':data['incidents'],'reference_incidents':data['reference_incidents'],'reconstructed_facilities':[{'facility_id':f['facility_id'],'canonical_name':f['canonical_name'],'identity_status':f['identity_status'],'location':f['location'],'source_described_types':f['source_described_types']} for f in data['facilities']],'reconstructed_associations':geo['features'],'waivers':data['waivers'],'tasks':data['tasks'],'findings':findings,'citations':citations,'data_quality_gaps':gaps,'gap_counts':gap_counts}


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    try:
        print(json.dumps(verify(sys.argv[1]), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, TypeError, IndexError, zipfile.BadZipFile) as error:
        print(json.dumps({'status':'FAIL','error':str(error)}))
        sys.exit(1)
