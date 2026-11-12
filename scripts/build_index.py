# Builds the parcel index the matcher searches, from three San Francisco open-data tables.
import csv,json,re,sys,collections
D,OUT=sys.argv[1],sys.argv[2]
rd=lambda f:csv.DictReader(open(D+f,encoding='utf-8'))
def nname(n):  # "02ND" -> "2ND"
    return re.sub(r'^0+(?=\d)','',n.strip().upper())
RT={'AV':'AVE','BL':'BLVD','WY':'WAY','TR':'TER','CR':'CIR','HY':'HWY','AL':'ALY','PZ':'PLZ','LP':'LOOP','PK':'PARK','WK':'WALK','RW':'ROW','SW':'STWY','HL':'HL'}
m2={}; ranges=collections.defaultdict(list)
for p in rd('parcels.csv'):
    m2[p['blklot']]=p['mapblklot']
    if p['active']!='true' or not p['from_address_num'] or not p['street_name']: continue
    a,b=int(p['from_address_num']),int(p['to_address_num'] or p['from_address_num'])
    if a==0 and b==0: continue
    ranges[nname(p['street_name'])+'|'+p['street_type']].append([min(a,b),max(a,b),p['odd_even'] or '',p['mapblklot'],'P'])
recs={}; agg=collections.defaultdict(list)
for r in rd('roll2025.csv'):
    loc=r['property_location']
    loc=loc[:36]
    try: to,fr=int(loc[0:4]),int(loc[5:9])
    except ValueError: continue
    name=nname(loc[10:30]); ty=loc[30:32].strip(); ty=RT.get(ty,ty)
    mb=m2.get(r['parcel_number'],r['parcel_number'])
    agg[mb].append(r)
    if fr>0 and name:
        ranges[name+'|'+ty].append([fr,max(fr,to),'',mb,'R'])
f=lambda v:float(v) if v not in('',None) else 0.0
for mb,rs in agg.items():
    uses=collections.Counter(r['use_definition'] for r in rs)
    yb=[int(f(r['year_property_built'])) for r in rs if 1800<f(r['year_property_built'])<2030]
    loc=rs[0]['property_location']
    recs[mb]={'lots':len(rs),'use':uses.most_common(1)[0][0],'cls':sorted({r['property_class_code_definition'] for r in rs if r['property_class_code_definition']})[:3],
      'yb':min(yb) if yb else None,'st':int(max(f(r['number_of_stories']) for r in rs)) or None,'un':int(sum(f(r['number_of_units']) for r in rs)) or None,
      'ct':next((r['construction_type'] for r in rs if r['construction_type'] not in('','NA')),None),
      'ba':int(sum(f(r['property_area']) for r in rs)) or None,'la':int(max(f(r['lot_area']) for r in rs)) or None,
      'av':int(sum(f(r['assessed_improvement_value'])+f(r['assessed_land_value']) for r in rs)) or None,
      'nb':rs[0]['analysis_neighborhood'],'situs':re.sub(r'\s+',' ',loc[5:32]).strip().lstrip('0')}
addr=collections.defaultdict(dict); plain={}; streets=collections.defaultdict(set); nopar=0
for e in rd('eas.csv'):
    name=nname(e['street_name']); ty=e['street_type']; streets[name].add(ty)
    if not e['parcel_number']: nopar+=1; continue
    mb=m2.get(e['parcel_number'],e['parcel_number'])
    k=f"{e['address_number']}|{e['address_number_suffix']}|{name}|{ty}"
    addr[k].setdefault(mb,[e['zip_code'],round(float(e['latitude']),6),round(float(e['longitude']),6)])
    plain.setdefault(e['address'].upper().strip(),mb)
for k in ranges: streets[k.split('|')[0]].add(k.split('|')[1])
idx={'meta':{'source':'City and County of San Francisco open data (data.sf.gov)','tables':{'addresses':'Enterprise Addressing System base addresses (3mea-di5p)','parcels':'Parcels, active and retired (acdm-wktn)','roll':'Assessor secured property tax roll, closed roll year 2025 (wv5m-vpq2)'},'retrieved':'2026-11-11','addresses':len(addr),'parcels':len(recs)},
 'addr':{k:[[mb]+v for mb,v in d.items()] for k,d in addr.items()},'ranges':ranges,'recs':recs,'streets':{k:sorted(v) for k,v in streets.items()},'plain':plain}
json.dump(idx,open(OUT,'w'),separators=(',',':'))
print('addresses',len(addr),'streets',len(streets),'range streets',len(ranges),'records',len(recs),'eas rows without parcel',nopar)
