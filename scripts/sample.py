# Draws the 50-address test set from the business-registration filings: 43 at random, 7 from hard-case classes.
# Fixed seed; drawn before the matcher was tuned and never used for tuning.
import csv,json,re,random,sys
D,OUT=sys.argv[1],sys.argv[2]
biz=[b for b in csv.DictReader(open(D+'biz.csv',encoding='utf-8')) if b['full_business_address'].strip()]
TY=r'(st|street|ave|avenue|blvd|boulevard|dr|drive|way|ter|terrace|ct|court|ln|lane|pl|place|rd|road|cir|hwy|aly|alley|plz|plaza|park|loop|walk|row)'
UNIT=r'\s+(ste|suite|unit|apt|fl|floor|rm|room|bldg|#).*$'
def cls(a):
    base=re.sub(UNIT,'',a,flags=re.I).strip()
    if re.match(r'^\d+\s*-\s*\d+\s',a): return 'range'
    if re.search(r'\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b',a,re.I): return 'spelled ordinal'
    if re.match(r'^\d+\s?[A-Za-z]\s+\S+\s+\S',a) and not re.match(r'^\d+\s[NSEWnsew]\s',a): return 'letter suffix'
    if re.match(r'^(one|two|three|four|five|six)\s',a,re.I): return 'number written as a word'
    if re.match(r'^\d+\s[NSEW]\.?\s',a,re.I): return 'abbreviated direction'
    if re.search(r'\s&\s|\sand\s|/',a,re.I) and not re.match(r'^\d',a): return 'intersection'
    if re.match(r'^\d+\s',a) and not re.search(r'\b'+TY+r'\.?$',base,re.I) and len(base.split())<=3 and not re.search(r'broadway|embarcadero|\d$',base,re.I): return 'no street type'
    return None
random.seed(206)
random.shuffle(biz)
hard={};rest=[]
for b in biz:
    c=cls(b['full_business_address'])
    if c and c not in hard: hard[c]=b
    elif not c: rest.append(b)
order=['range','spelled ordinal','letter suffix','number written as a word','abbreviated direction','intersection','no street type']
test=[dict(b,hard=None) for b in rest[:43]]+[dict(hard[c],hard=c) for c in order]
random.shuffle(test)
ids={t['ttxid'] for t in test}
out=[]
for i,t in enumerate(test,1):
    m=re.match(r'POINT \((\S+) (\S+)\)',t['location'])
    out.append({'id':i,'address':t['full_business_address'],'zip':t['business_zip'],'business':t['dba_name'],'naics':t['self_reported_naics_code'],'hard':t['hard'],'filingId':t['ttxid'],'filingLon':float(m[1]),'filingLat':float(m[2])})
json.dump(out,open(OUT+'test50.json','w'),indent=1)
dev=[]
for b in biz:
    if b['ttxid'] in ids: continue
    m=re.match(r'POINT \((\S+) (\S+)\)',b['location'])
    dev.append({'address':b['full_business_address'],'zip':b['business_zip'],'lon':float(m[1]),'lat':float(m[2])})
json.dump(dev,open(OUT+'dev.json','w'))
print(len(out),len(dev),[ (o['id'],o['hard'],o['address']) for o in out if o['hard']])
