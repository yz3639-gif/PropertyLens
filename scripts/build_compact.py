# Packs the full index into one lazily loaded script for the page (same decisions as the offline benchmark).
import json,sys
idx=json.load(open(sys.argv[1])); out=sys.argv[2]
D='0123456789abcdefghijklmnopqrstuvwxyz'
def b36(n):
    n=int(n); s=''
    if n==0: return '0'
    while n: s=D[n%36]+s; n//=36
    return s
P=[];pi={}
def pid(mb):
    if mb not in pi: pi[mb]=len(P); P.append(mb)
    return pi[mb]
for mb in idx['recs']: pid(mb)
Z=[];zi={}
A={}
for k,rows in idx['addr'].items():
    num,suf,name,ty=k.split('|'); sk=name+'|'+ty
    for mb,z,la,lo in rows:
        if z not in zi: zi[z]=len(Z); Z.append(z)
        A.setdefault(sk,[]).append(f"{b36(num)}{'.'+suf if suf else ''},{b36(pid(mb))},{b36(zi[z])},{b36(round((la-37.6)*1e5))},{b36(round((lo+122.6)*1e5))}")
R={}
for sk,rows in idx['ranges'].items():
    m={}
    for fr,to,par,mb,src in rows:
        k=(fr,to,mb); cur=m.get(k)
        if cur is None: m[k]=[par,src]
        else:
            if cur[1]!=src: cur[1]='B'
            if src=='P': cur[0]=par
    for (fr,to,mb),(par,src) in m.items(): R.setdefault(sk,[]).append(f"{b36(fr)},{b36(to-fr)},{par},{b36(pid(mb))},{src}")
U=[];ui={};N=[];ni={}
def ix(v,L,M):
    if v not in M: M[v]=len(L); L.append(v)
    return M[v]
C=[None]*len(P)
for mb,r in idx['recs'].items():
    if r['use']=='Single Family Residential': C[pi[mb]]=0; continue
    C[pi[mb]]=[ix(r['use'],U,ui),'; '.join(r['cls']),r['yb'] or 0,r['st'] or 0,r['un'] or 0,r['ct'] or '',r['ba'] or 0,r['la'] or 0,r['av'] or 0,ix(r['nb'],N,ni),r['situs'],r['lots']]
comp={'meta':idx['meta'],'Z':Z,'P':P,'U':U,'N':N,'A':{k:';'.join(v) for k,v in A.items()},'R':{k:';'.join(v) for k,v in R.items()},'C':C,'S':idx['streets']}
js='window.PL_INDEX_COMPACT='+json.dumps(comp,separators=(',',':'))+';'
open(out,'w').write(js); print(len(js)/1e6,'MB', {k:round(len(json.dumps(v,separators=(",",":")))/1e6,2) for k,v in comp.items()})
