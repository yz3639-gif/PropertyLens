/* Property Risk Lens · address-to-parcel matcher
   Links an address as written on a submission to one county parcel record, or flags it for review.
   Design rule: a wrong link is worse than no link, so anything ambiguous is flagged, never guessed.
   Works in the browser and in Node. `index` is built by build_index.py from county open data. */
(function(root){
const TYPES={STREET:'ST',ST:'ST',STR:'ST',AVENUE:'AVE',AVE:'AVE',AV:'AVE',BOULEVARD:'BLVD',BLVD:'BLVD',BL:'BLVD',DRIVE:'DR',DR:'DR',WAY:'WAY',WY:'WAY',
  TERRACE:'TER',TER:'TER',TERR:'TER',COURT:'CT',CT:'CT',LANE:'LN',LN:'LN',PLACE:'PL',PL:'PL',ROAD:'RD',RD:'RD',CIRCLE:'CIR',CIR:'CIR',
  HIGHWAY:'HWY',HWY:'HWY',ALLEY:'ALY',ALY:'ALY',PLAZA:'PLZ',PLZ:'PLZ',PARK:'PARK',LOOP:'LOOP',WALK:'WALK',ROW:'ROW'};
const DIRS={N:'NORTH',S:'SOUTH',E:'EAST',W:'WEST',NO:'NORTH',SO:'SOUTH'};
const NUMW={ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5,SIX:6,SEVEN:7,EIGHT:8,NINE:9,TEN:10};
const ORDW={FIRST:'1ST',SECOND:'2ND',THIRD:'3RD',FOURTH:'4TH',FIFTH:'5TH',SIXTH:'6TH',SEVENTH:'7TH',EIGHTH:'8TH',NINTH:'9TH',TENTH:'10TH',ELEVENTH:'11TH',TWELFTH:'12TH'};
const UNITW=new Set(['STE','SUITE','UNIT','APT','APTS','APARTMENT','FL','FLR','FLOOR','RM','ROOM','BLDG','BUILDING','SPC','SPACE','DEPT','PMB','BOX','LBBY','LOBBY','PH','MEZZ','MEZZANINE','BSMT','BASEMENT',
  'OFC','OFFICE','GROUND','GRD','LOWR','LWR','LOWER','UPPR','UPPER','FRNT','FRONT','REAR','LOFT','STUDIO','LEVEL','STOP']);
const TYPO=[['STREET','ST'],['AVENUE','AVE'],['BOULEVARD','BLVD'],['DRIVE','DR']];
function ordinal(n){const t=n%100,u=n%10;return n+(t>=11&&t<=13?'TH':u===1?'ST':u===2?'ND':u===3?'RD':'TH')}
const ALIAS={'EMBARCADERO':'THE EMBARCADERO'};

function lev(a,b,max){ /* edit distance with early exit */
  if(Math.abs(a.length-b.length)>max)return max+1;
  let prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const cur=[i];let best=i;
    for(let j=1;j<=b.length;j++){cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));if(cur[j]<best)best=cur[j]}
    if(best>max)return max+1;prev=cur}
  return prev[b.length];
}
function tokens(s){
  return String(s||'').toUpperCase().replace(/[.,;]/g,' ').replace(/#\s*/g,' # ').replace(/\s+/g,' ').trim().split(' ').filter(Boolean);
}
function normTok(t){ /* 02ND -> 2ND, THIRD -> 3RD */
  if(ORDW[t])return ORDW[t];
  if(/^0+\d/.test(t))return t.replace(/^0+/,'');
  return t;
}
/* Split "1840-42 Jefferson St #42" into number(s), suffix letter and the remaining street tokens. */
function parseNumber(tk){
  if(!tk.length)return null;
  let t=tk[0],rest=tk.slice(1),num=null,to=null,suf='';
  if(NUMW[t]!=null){num=NUMW[t]}
  else{
    let m=/^(\d+)-(\d+)$/.exec(t);
    if(m){num=+m[1];let b=m[2];if(b.length<m[1].length)b=m[1].slice(0,m[1].length-b.length)+b;to=+b}
    else if((m=/^(\d+)([A-Z])?$/.exec(t))){num=+m[1];suf=m[2]||''}
    else if((m=/^(\d+)(1\/2|½)$/.exec(t))){num=+m[1];suf='½'}
    else return null;
  }
  if(to==null&&rest.length>=2&&rest[0]==='-'&&/^\d+$/.test(rest[1])){to=+rest[1];rest=rest.slice(2)}
  else if(to==null&&rest.length>=1&&/^-\d+$/.test(rest[0])){to=+rest[0].slice(1);rest=rest.slice(1)} /* "431 -433 Clement St" */
  if(to!=null&&to<num){const a=String(num),b=String(to);if(b.length<a.length)to=+(a.slice(0,a.length-b.length)+b)}
  let badRange=false;
  if(to!=null&&(to<num||to-num>200)){to=null;badRange=true}
  return {num,to,suf,rest,badRange};
}
function make(index){
  const names=Object.keys(index.streets);
  const byLen={};names.forEach(n=>(byLen[n.length]=byLen[n.length]||[]).push(n));
  const hasStreet=n=>Object.prototype.hasOwnProperty.call(index.streets,n);

  /* Find the street inside the remaining tokens by testing every split against the county's street list. */
  function findStreet(rest){
    const cut=rest.findIndex((t,i)=>i>0&&(t==='#'||UNITW.has(t)));
    const st=(cut>0?rest.slice(0,cut):rest).map(normTok);
    const unit=cut>0?rest.slice(cut).join(' '):'';
    const out=[];
    for(let j=st.length;j>=1;j--){
      const head=st.slice(0,j),tailT=st.slice(j),tail=tailT.join(' ');
      const badTail=tailT.length&&/^[A-Z]{2,}$/.test(tailT[0])?tailT[0]:null; /* a word we did not understand, e.g. "Embarcadero CTR" */
      const variants=[];
      const last=head[head.length-1];
      if(head.length>1){
        if(TYPES[last])variants.push({nameT:head.slice(0,-1),type:TYPES[last]});
        else{const ty=last.length>=5&&TYPO.find(([w])=>lev(last,w,1)<=1);if(ty)variants.push({nameT:head.slice(0,-1),type:ty[1]})}
      }
      variants.push({nameT:head,type:null});
      for(const v of variants){
        const base=v.nameT.join(' '),tiers=[[base]];
        if(v.type&&v.nameT.length===1&&/^[1-9]\d?$/.test(base))tiers[0].push(ordinal(+base)); /* "24 St" for 24th St */
        if(ALIAS[base])tiers[0].push(ALIAS[base]);
        if(DIRS[v.nameT[0]]&&v.nameT.length>1){
          tiers.push([[DIRS[v.nameT[0]],...v.nameT.slice(1)].join(' ')]);
          tiers.push([v.nameT.slice(1).join(' ')]); /* a direction prefix the county does not use; only if nothing else fits */
        }
        for(const tier of tiers){
          const found=tier.filter(hasStreet);
          if(found.length){found.forEach(name=>out.push({name,type:v.type,extra:[tail,unit].filter(Boolean).join(' '),fuzzy:false,raw:base,badTail:v.type?null:badTail}));break}
        }
        if(out.length)break;
      }
      if(out.length)return out;
    }
    /* No exact street name: allow one typo (two for long names), and only if it points to a single street. */
    for(let j=st.length;j>=1;j--){
      const head=st.slice(0,j),last=head[head.length-1];
      const v=head.length>1&&TYPES[last]?{nameT:head.slice(0,-1),type:TYPES[last]}:{nameT:head,type:null};
      const q=v.nameT.join(' ');if(q.length<5||/^\d/.test(q))continue;
      const max=q.length>=9?2:1,hits=[];
      for(let L=q.length-max;L<=q.length+max;L++)(byLen[L]||[]).forEach(n=>{const d=lev(q,n,max);if(d<=max)hits.push([d,n])});
      if(hits.length){hits.sort((a,b)=>a[0]-b[0]);
        const best=hits.filter(h=>h[0]===hits[0][0]);
        return best.map(h=>({name:h[1],type:v.type,extra:[st.slice(j).join(' '),unit].filter(Boolean).join(' '),fuzzy:true,raw:q}));
      }
    }
    return [];
  }
  const streetZips={};
  const zipBox={}; /* where each street lies inside each ZIP, to tell a ZIP-boundary slip from a different place */
  for(const k in index.addr){const p=k.split('|'),sk=p[2]+'|'+p[3];const z=streetZips[sk]||(streetZips[sk]=new Set());
    index.addr[k].forEach(r=>{if(!r[1])return;z.add(r[1]);for(const key of [sk+'|'+r[1],'*|'+r[1]]){const b=zipBox[key]||(zipBox[key]=[r[2],r[2],r[3],r[3]]);
      if(r[2]<b[0])b[0]=r[2];if(r[2]>b[1])b[1]=r[2];if(r[3]<b[2])b[2]=r[3];if(r[3]>b[3])b[3]=r[3]}})}
  function metresToBox(lat,lon,b){const dy=lat<b[0]?b[0]-lat:lat>b[1]?lat-b[1]:0,dx=lon<b[2]?b[2]-lon:lon>b[3]?lon-b[3]:0;return Math.hypot(dy*111000,dx*88000)}
  /* true when the street (any of the given types) has addresses in `zip` that are far from the matched point */
  function elsewhere(name,types,zip,h){return types.some(ty=>{const b=zipBox[name+'|'+ty+'|'+zip];return b&&(h.lat==null||metresToBox(h.lat,h.lon,b)>1000)})}
  const coversRoll=(mb,name,type,num)=>(index.ranges[name+'|'+type]||[]).some(r=>r[4]!=='P'&&r[3]===mb&&num>=r[0]&&num<=r[1]);
  function lookupOne(num,suf,street,zip){
    const allTypes=index.streets[street.name];
    let types,notes=[],guess=false;
    if(street.type&&allTypes.includes(street.type))types=[street.type];
    else if(allTypes.length===1){types=allTypes;if(street.type&&allTypes[0])notes.push(`Written as ${street.name} ${street.type}; county records have ${street.name} ${allTypes[0]}`)}
    else if(street.type){types=allTypes;guess=true;notes.push(`Street type “${street.type}” is not on record for ${street.name}; tried ${allTypes.join(', ')}`)}
    else{types=allTypes;guess=true;notes.push(`No street type given; ${street.name} exists as ${allTypes.map(t=>t||'(none)').join(', ')}`)}
    let hits=[];
    for(const ty of types){
      let rows=index.addr[`${num}|${suf}|${street.name}|${ty}`],via='address';
      if(!rows&&suf){rows=index.addr[`${num}||${street.name}|${ty}`];if(rows)notes.push(`Number suffix “${suf}” not on record; matched the base number`)}
      if(rows)rows.forEach(r=>hits.push({mb:r[0],zip:r[1],lat:r[2],lon:r[3],type:ty,via}));
    }
    if(!hits.length){ /* fall back to the address ranges carried on parcel and assessor records */
      for(const ty of types)(index.ranges[street.name+'|'+ty]||[]).forEach(r=>{
        if(num<r[0]||num>r[1])return;
        if(r[2]==='O'&&num%2===0||r[2]==='E'&&num%2===1)return;
        if(!hits.some(h=>h.mb===r[3]&&h.type===ty))hits.push({mb:r[3],zip:null,type:ty,via:'range'});
      });
    }
    if(zip&&hits.some(h=>h.zip===zip)&&hits.some(h=>h.zip&&h.zip!==zip)){
      const n=hits.length;hits=hits.filter(h=>h.zip===zip||!h.zip);
      if(hits.length<n)notes.push(`ZIP ${zip} used to choose between same-named addresses`);
    }
    return {hits,notes,guess};
  }
  function match(input,zip){
    const res={input,zip:zip||null,status:'unmatched',parcel:null,method:null,notes:[],candidates:[],confirmed:[],parsed:null};
    const done=(status,why)=>{res.status=status;if(why)res.notes.unshift(why);return res};
    const tk=tokens(input);
    if(!tk.length)return done('unmatched','Empty address');
    if(tk.includes('&')||tk.includes('AND')&&!/^\d/.test(tk[0])||tk.includes('/')&&!/^\d/.test(tk[0]))return done('review','Looks like an intersection or a described location, not a street address');
    if(/^(PO|P O|POB)\b/.test(tk.join(' '))||tk[0]==='BOX')return done('review','Post-office box; no property location');
    const pn=parseNumber(tk);
    if(!pn)return done('review','No street number found');
    let streets=findStreet(pn.rest),suf=pn.suf;
    if(!streets.length&&!suf&&pn.rest.length>1&&/^[A-Z]$/.test(pn.rest[0])){ /* "1247 A 11th Ave" */
      streets=findStreet(pn.rest.slice(1));if(streets.length)suf=pn.rest[0];
    }
    if(!streets.length)return done('review','Street name not found in county records');
    const uniq=[...new Map(streets.map(s=>[s.name+'|'+s.type,s])).values()];
    res.parsed={number:pn.num,rangeTo:pn.to,suffix:suf,street:uniq.map(s=>s.name+(s.type?' '+s.type:'')).join(' / '),unit:uniq[0].extra||''};
    if(uniq.every(s=>s.badTail))return done('review',`Words after the street name were not understood: “${uniq[0].badTail}”`);
    if(uniq.length>1&&uniq.some(s=>s.fuzzy))return done('review',`Street name “${uniq[0].raw}” is not on record; closest are ${uniq.map(s=>s.name).join(', ')}`);
    const nums=pn.to!=null&&pn.to!==pn.num?[pn.num,pn.to]:[pn.num];
    let hits=[],guess=false;
    for(const s of uniq)for(const n of nums){
      const r=lookupOne(n,suf,s,zip);guess=guess||r.guess;r.notes.forEach(x=>res.notes.includes(x)||res.notes.push(x));
      r.hits.forEach(h=>hits.push({...h,name:s.name,num:n,fuzzy:s.fuzzy}));
    }
    if(pn.badRange)res.notes.push(`The second number of the written range could not be read; only ${pn.num} was used`);
    if(nums.length>1)res.notes.push(`Written as a range ${nums[0]}–${nums[1]}; both ends checked`);
    const parcels=[...new Set(hits.map(h=>h.mb))];
    res.candidates=parcels.slice(0,6).map(mb=>{const h=hits.find(x=>x.mb===mb),rec=index.recs[mb];return {parcel:mb,address:`${h.num} ${h.name}${h.type?' '+h.type:''}`,zip:h.zip,via:h.via,use:rec?rec.use:null}});
    if(!parcels.length){
      const s=uniq[0],near=[];
      for(const ty of index.streets[s.name])for(const d of [2,-2,4,-4,6,-6]){if(index.addr[`${pn.num+d}||${s.name}|${ty}`])near.push(`${pn.num+d} ${s.name} ${ty}`)}
      return done('review',`${pn.num} is not an address on ${s.name} in county records`+(near.length?`; nearest on record: ${near.slice(0,3).join(', ')}`:''));
    }
    if(parcels.length>1){
      const tys=[...new Set(hits.map(h=>h.type))];
      return done('review',tys.length>1?`Ambiguous: this number exists on ${hits[0].name} ${tys.join(' and ')}`:`Ambiguous: ${parcels.length} different parcels carry this address`);
    }
    const h=hits[0];let mb=parcels[0];
    if(!index.recs[mb]){
      /* The address system can point at a parcel that was retired (merged, split into condominiums) and has no
         current assessor record. Link to its successor only if exactly one current parcel on the same block
         carries this number in its recorded address range; otherwise a person decides. */
      const block=mb.slice(0,-3),succ=new Set();
      (index.ranges[h.name+'|'+h.type]||[]).forEach(r=>{
        if(r[3]===mb||r[3].slice(0,-3)!==block||!index.recs[r[3]])return;
        if(h.num<r[0]||h.num>r[1])return;
        if(r[2]==='O'&&h.num%2===0||r[2]==='E'&&h.num%2===1)return;
        succ.add(r[3]);
      });
      if(succ.size!==1){res.candidates=[...succ].slice(0,6).map(p=>({parcel:p,address:index.recs[p].situs,use:index.recs[p].use,via:'range'}));
        return done('review',`County address system links this address to parcel ${mb}, which has no record on the current assessor roll (retired or not yet assessed)`+(succ.size?`; ${succ.size} possible successors on the block`:''))}
      res.notes.push(`Address system points to retired parcel ${mb}; linked to its successor on the same block`);
      mb=[...succ][0];h.via='successor';
    }
    if(h.fuzzy){
      res.notes.push(`Street spelled “${uniq[0].raw}”; county records have ${h.name}`);
      if(!(zip&&h.zip===zip&&h.via==='address'))return done('review','Spelling correction needs a matching ZIP and an exact address to link automatically');
    }
    if(zip&&h.zip&&h.zip!==zip){
      res.notes.push(`ZIP on submission ${zip}; county record ${h.zip}`);
      if(guess)return done('review','Street type was inferred and the ZIP disagrees');
      if(res.notes.some(n=>/^Written as/.test(n)))return done('review','Street type differs from county records and the ZIP disagrees');
      const zb=zipBox['*|'+zip];
      if(zb&&h.lat!=null&&metresToBox(h.lat,h.lon,zb)>1500)return done('review',`ZIP ${zip} is a different part of the county from ${h.num} ${h.name} ${h.type}`.trim());
      const others=index.streets[h.name].filter(t=>t!==h.type);
      if(elsewhere(h.name,others,zip,h))return done('review',`ZIP ${zip} points to ${h.name} ${others.join(' or ')}, not ${h.name} ${h.type}; the other street may have been meant`);
      if(elsewhere(h.name,[h.type],zip,h))return done('review',`ZIP disagrees: another stretch of ${h.name} ${h.type} lies in ${zip}, where this number is not on record`);
    }
    if(guess&&!(zip&&h.zip===zip))return done('review','Street type missing or wrong, and nothing confirms which street was meant');
    res.parcel=mb;res.method={address:'Exact address in the county address system',range:'Number falls inside one parcel’s recorded address range',successor:'Successor of a retired parcel, by recorded address range'}[h.via];
    res.confirmed.push({address:'County address system (EAS)',range:'Parcel address range',successor:'Parcel address range'}[h.via]);
    if(coversRoll(mb,h.name,h.type,h.num))res.confirmed.push('Assessor roll situs');
    res.matchedAddress=`${h.num}${suf&&!res.notes.some(n=>/suffix/.test(n))?suf:''} ${h.name}${h.type?' '+h.type:''}`;
    res.lat=h.lat;res.lon=h.lon;res.record=index.recs[mb];
    return done('matched');
  }
  /* The baseline the plan compares against: uppercase the string and look it up as-is. */
  function plain(input){const mb=(index.plain||{})[String(input||'').toUpperCase().trim().replace(/\s+/g,' ')];return mb||null}
  return {match,plain,meta:index.meta};
}
const api={make,tokens,parseNumber};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PLMatcher=api;
})(typeof globalThis!=='undefined'?globalThis:this);
