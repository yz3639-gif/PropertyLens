/* Property Risk Lens · submission document extractor
   Reads the text layer of submission PDFs and fills a property profile. Every populated field keeps the
   document, page and line it came from; a field with no supporting line stays "unknown". Nothing is inferred.
   Deterministic label-and-value rules: no model, so the same documents always give the same profile.
   Works in the browser (with pdf.js supplying page text) and in Node (given page lines directly). */
(function(root){
const MONTHS={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12};
const pad=n=>String(n).padStart(2,'0');
function parseDate(s){
  let m=/\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);if(m)return {iso:`${m[1]}-${m[2]}-${m[3]}`,i:m.index,len:m[0].length};
  m=/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(s);if(m){const y=m[3].length===2?'20'+m[3]:m[3];return {iso:`${y}-${pad(m[1])}-${pad(m[2])}`,i:m.index,len:m[0].length}}
  m=/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(s);
  if(m)return {iso:`${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(m[2])}`,i:m.index,len:m[0].length};
  return null;
}
const num=s=>+String(s).replace(/,/g,'');
/* value readers: each returns {norm, show, i, len} for the first value of its kind in `s`, or null */
const READ={
  money(s){
    let m=/\$\s?(\d[\d,]*(?:\.\d+)?)\s*(million|mm|m|k)?\b/i.exec(s);
    if(!m){m=/\b(\d{1,3}(?:,\d{3})+(?:\.\d{2})?)\b(?!\s*(?:sq|sf|square|units?\b|%))/i.exec(s);if(!m)return null}
    let v=num(m[1]);const u=(m[2]||'').toLowerCase();if(u==='million'||u==='mm'||u==='m')v*=1e6;else if(u==='k')v*=1e3;
    return {norm:Math.round(v),show:'$'+Math.round(v).toLocaleString('en-US'),i:m.index,len:m[0].length};
  },
  area(s){
    let m=/\b(\d[\d,]{2,})\s*(?:sq\.?\s*ft\.?|square\s+f(?:ee|oo)t|s\.?f\.?)(?![a-z])/i.exec(s)||/\b(\d{1,3}(?:,\d{3})+|\d{4,6})\b/.exec(s);
    if(!m)return null;return {norm:num(m[1]),show:num(m[1]).toLocaleString('en-US')+' sq. ft.',i:m.index,len:m[0].length};
  },
  int(s){const W={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12};
    let m=/\b(\d{1,4})\b/.exec(s),w=/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.exec(s);
    if(m&&(!w||m.index<w.index))return {norm:+m[1],show:m[1],i:m.index,len:m[0].length};
    if(w)return {norm:W[w[1].toLowerCase()],show:String(W[w[1].toLowerCase()]),i:w.index,len:w[0].length};return null},
  year(s){const m=/\b((?:18|19|20)\d{2})\b/.exec(s);return m?{norm:+m[1],show:m[1],i:m.index,len:m[0].length}:null},
  pct(s){const m=/\b(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/i.exec(s);return m?{norm:+m[1],show:m[1]+'%',i:m.index,len:m[0].length}:null},
  date(s){const d=parseDate(s);return d?{norm:d.iso,show:d.iso,i:d.i,len:d.len}:null},
  period(s){const a=parseDate(s);if(!a)return null;const rest=s.slice(a.i+a.len),b=parseDate(rest);if(!b)return null;
    return {norm:a.iso+'/'+b.iso,show:a.iso+' to '+b.iso,i:a.i,len:a.len+b.i+b.len}},
  dedu(s){const p=READ.pct(s),m=READ.money(s);if(m&&(!p||m.i<p.i))return m;return p||m},
  text(s){const m=/^[\s:.\-–—#]*([^\s].*?)(?=\s{2,}|\.\s|\.$|;|$)/.exec(s);if(!m||!m[1])return null;const v=m[1].trim().replace(/[,:]$/,'');
    return v.length>=2?{norm:v.toLowerCase(),show:v.slice(0,90),i:s.indexOf(m[1]),len:m[1].length}:null},
  token(s){const m=/^[\s:.\-–—#]*([A-Z0-9][A-Z0-9\-\/]{3,})/i.exec(s);return m?{norm:m[1].toUpperCase(),show:m[1],i:s.indexOf(m[1]),len:m[1].length}:null},
  apn(s){const m=/\b(\d{2,4}[-\s]\d{2,4}[-\s]\d{1,4}(?:[-\s]\d{1,4})?|\d{7,12})\b/.exec(s);return m?{norm:m[1].replace(/\s/g,'-'),show:m[1],i:m.index,len:m[0].length}:null},
  address(s){const m=/(\d{1,6}(?:-\d+)?\s+[A-Za-z0-9.'’ ]{2,40}?\b(?:street|st|avenue|ave|boulevard|blvd|drive|dr|way|road|rd|lane|ln|court|ct|place|pl|terrace|ter|circle|cir|highway|hwy|plaza|broadway)\b\.?(?:,?\s+(?:suite|ste|unit|#)\s*[\w-]+)?(?:,\s*[A-Za-z .]+)?(?:,\s*[A-Z]{2})?(?:\s+\d{5})?)/i.exec(s);
    if(!m)return null;const v=m[1].trim().replace(/[.,]$/,'');return {norm:v.toLowerCase().replace(/[.,]/g,'').replace(/\s+/g,' '),show:v,i:m.index,len:m[1].length}},
  construction(s){const m=/\b(fire[- ]resistive|non[- ]?combustible|reinforced (?:concrete )?masonry(?: units)?(?: \(cmu\))?|joisted masonry|masonry non[- ]?combustible|concrete block|cmu|masonry|brick|tilt[- ]up|reinforced concrete|steel[- ]frame|steel|wood[- ]frame|frame|heavy timber)\b/i.exec(s);
    if(!m)return null;const t=m[1].toLowerCase();const cls=/masonry|cmu|brick|block/.test(t)?'masonry':/wood|frame|timber/.test(t)&&!/steel/.test(t)?'frame':/steel/.test(t)?'steel':/concrete|tilt|fire/.test(t)?'concrete':'noncombustible';
    return {norm:cls,show:m[1],i:m.index,len:m[0].length}},
  yesno(s){const m=/\b(none|no|not (?:present|installed|sprinklered)|yes|fully sprinklered|partially sprinklered|sprinklered|wet(?: pipe)? system|monitored)\b/i.exec(s);
    if(!m)return null;return {norm:/^(none|no|not)/i.test(m[1])?'no':'yes',show:m[1],i:m.index,len:m[0].length}},
  valuation(s){const m=/\b(replacement cost|actual cash value|acv|rcv|agreed value|functional replacement)\b/i.exec(s);
    if(!m)return null;const t=m[1].toLowerCase();return {norm:/actual|acv/.test(t)?'ACV':/agreed/.test(t)?'agreed':'RC',show:m[1],i:m.index,len:m[0].length}}
};
/* field rules. `label` finds the line; the value is read from the text after the label (or the next line).
   `whole:true` reads the value from the whole line instead. `docs` ranks which document type wins as primary. */
const F=(key,label,group,type,rx,o={})=>({key,label,group,type,rx,...o});
const FIELDS=[
 F('insured','Named insured / owner','Identity','text',[/named insured/i,/insured name/i,/owner of record/i,/\bborrower\b/i,/\bapplicant name\b/i],{req:true,docs:['declarations','application','appraisal']}),
 F('address','Property address','Identity','address',[/(?:property|location|premises|subject|situs|risk) (?:address|location)/i,/\blocation\s*(?:no\.?\s*)?\d+\b/i,/\bsitus\b/i,/\bpremises\b/i,/address of (?:property|subject)/i],{req:true,docs:['declarations','appraisal','sov','application','inspection','tax']}),
 F('apn','Assessor parcel number','Identity','apn',[/\bAPN\b/,/assessor'?s?’?s? parcel (?:number|no\.?)/i,/\bparcel (?:number|no\.?|id)\b/i],{docs:['tax','appraisal']}),
 F('occupancy','Occupancy / use','Building','text',[/\boccupancy\b/i,/current use/i,/property type/i,/\bclass of business\b/i],{req:true,docs:['appraisal','sov','declarations','application']}),
 F('units','Units','Building','int',[/unit count/i,/(?:number|no\.?|#) of units/i,/\btotal units\b/i],{docs:['appraisal','sov'],alt:[/\b(\d{1,4})[- ]unit\b/i,/\b(\d{1,4})\s+(?:apartment|residential|rental|dwelling) units\b/i]}),
 F('yearBuilt','Year built','Building','year',[/year built/i,/\byr\.? ?(?:blt|built)\b/i,/date of construction/i,/\bconstructed in\b/i,/\bbuilt in\b/i],{req:true,docs:['appraisal','sov','inspection','application']}),
 F('construction','Construction','Building','construction',[/construction (?:type|class)/i,/exterior walls?/i,/\bconstruction\b/i,/\bframing\b/i],{req:true,whole:false,docs:['inspection','appraisal','sov','declarations']}),
 F('stories','Stories','Building','int',[/(?:number|no\.?|#) of stories/i,/\bstories\b/i],{req:true,docs:['appraisal','sov','inspection'],alt:[/\b(one|two|three|four|five|six|\d{1,2})[- ]stor(?:y|ey)\b/i]}),
 F('area','Building area','Building','area',[/gross building area/i,/\bGBA\b/,/total (?:building )?square footage/i,/building (?:area|size)/i,/\bsquare footage\b/i,/\btotal area\b/i],{req:true,docs:['appraisal','inspection','sov','declarations']}),
 F('roof','Roof','Building','text',[/roof (?:covering|type|system)/i,/^\s*covering\b/i,/\broof(?:ing)?\s*:/i],{docs:['inspection','appraisal','sov']}),
 F('roofYear','Roof replaced','Building','year',[/roof (?:replaced|replacement|installed|updated|year)/i,/re-?roof(?:ed)?/i,/roof.{0,20}(?:replaced|installed) in/i,/\broof age\b/i],{req:true,docs:['inspection','sov','application']}),
 F('sprinklers','Sprinklers','Building','yesno',[/(?:fire )?sprinklers?(?: system)?/i,/automatic sprinkler/i],{req:true,docs:['inspection','sov','application','declarations']}),
 F('marketValue','Market value','Valuation','money',[/market value/i,/final value (?:opinion|conclusion)/i,/as[- ]is value/i,/appraised value/i,/value (?:opinion|conclusion)/i],{docs:['appraisal']}),
 F('replacementCost','Replacement cost','Valuation','money',[/replacement cost new/i,/\bRCN\b/,/(?:estimated |total )?replacement cost(?! valuation)(?!\.)/i,/insurable (?:value|replacement cost)/i,/reconstruction cost/i,/\bTIV\b/,/total insur(?:ed|able) value/i],{req:true,docs:['appraisal','sov','application']}),
 F('insurer','Insurer','Insurance','text',[/\binsurer\b/i,/insurance company/i,/\bcarrier\b/i,/\bissuing company\b/i,/\bcompany name\b/i],{docs:['declarations']}),
 F('policyNumber','Policy number','Insurance','token',[/policy (?:number|no\.?|#)/i],{docs:['declarations','lossrun']}),
 F('policyPeriod','Policy period','Insurance','period',[/policy period/i,/\bperiod\b.{0,12}from/i,/effective.{0,40}(?:to|through|expir)/i],{req:true,whole:true,docs:['declarations']}),
 F('buildingLimit','Building limit','Insurance','money',[/coverage a\b.{0,20}building/i,/building.{0,40}limit(?: of insurance)?/i,/limit of insurance.{0,20}building/i,/building coverage/i,/\bbldg\.? limit\b/i,/\bbuilding\b\s{2,}/i],{req:true,docs:['declarations','sov']}),
 F('deductible','Deductible','Insurance','dedu',[/\bdeductible\b/i,/\bded\.\s/i],{req:true,docs:['declarations']}),
 F('valuation','Valuation basis','Insurance','valuation',[/\bvaluation\b/i,/loss settlement/i],{docs:['declarations']}),
 F('coinsurance','Coinsurance','Insurance','pct',[/co-?insurance/i],{docs:['declarations']}),
 F('mortgagee','Mortgagee / loss payee','Insurance','text',[/mortgagee(?: clause| name)?/i,/loss payee/i,/mortgage holder/i,/lienholder/i],{req:true,docs:['declarations']}),
 F('annualTax','Annual property tax','Taxes','money',[/total (?:annual )?tax(?:es)?(?: due)?\b/i,/total amount due/i,/total of all charges/i,/annual tax/i],{req:true,docs:['tax']}),
 F('installment1','First installment','Taxes','money',[/(?:first|1st) install?ment/i],{docs:['tax']}),
 F('installment2','Second installment','Taxes','money',[/(?:second|2nd) install?ment/i],{docs:['tax']}),
 F('lossCount','Claims in loss history','Loss history','int',[/(?:number|no\.?|#) of (?:claims|losses)/i,/total claims/i,/claim count/i],{req:true,docs:['lossrun','application']}),
 F('lossTotal','Total incurred losses','Loss history','money',[/total incurred/i,/total (?:paid|losses)/i,/incurred total/i],{docs:['lossrun','application']})
];
const LIST=[ /* fields that collect every matching line rather than one value */
 {key:'assessments',label:'Special assessments on the tax bill',group:'Taxes',rx:/\b(PACE|CFD|Mello[- ]Roos|special assessment|direct charge|community facilities|lighting district|sewer service)\b/i,docs:['tax']}
];
const TYPES=[
 ['appraisal','Appraisal report',[/apprais/i,/value opinion|opinion of value/i,/sales comparison/i,/cost approach/i,/highest and best use/i,/income approach/i]],
 ['declarations','Insurance declarations',[/declarations/i,/named insured/i,/policy (?:number|no)/i,/limit of insurance/i,/policy period/i,/premium/i]],
 ['tax','Property tax bill',[/tax bill/i,/install?ment/i,/tax collector/i,/assessed value/i,/fiscal year/i,/levy/i]],
 ['inspection','Inspection report',[/inspection/i,/inspector/i,/observed/i,/deficien/i,/condition/i,/roof covering|covering:/i]],
 ['sov','Statement of values',[/statement of values/i,/schedule of values/i,/\bSOV\b/,/\bTIV\b/,/total insur(?:ed|able) value/i]],
 ['lossrun','Loss runs',[/loss run/i,/date of loss/i,/total incurred/i,/claim (?:number|no)/i,/valuation date/i]],
 ['application','Application',[/\bACORD\b/,/applicant/i,/application/i,/prior carrier/i]]
];
function classify(doc){
  const text=doc.pages.map(p=>p.lines.join('\n')).join('\n'),head=doc.pages.slice(0,1).map(p=>p.lines.slice(0,12).join('\n')).join('\n');
  let best=null;
  for(const [k,label,rx] of TYPES){let sc=0;rx.forEach(r=>{if(r.test(text))sc++;if(r.test(head))sc+=2});if(r_name(doc.name,k))sc+=3;if(!best||sc>best.sc)best={k,label,sc}}
  return best&&best.sc>=2?{type:best.k,label:best.label}:{type:'other',label:'Unclassified'};
}
function r_name(n,k){return ({appraisal:/apprais/i,declarations:/declar|dec[ _-]?page|policy/i,tax:/tax/i,inspection:/inspect/i,sov:/sov|values/i,lossrun:/loss/i,application:/acord|applic/i})[k].test(n||'')}
function docDate(doc,type){
  const want={appraisal:[/effective date/i,/date of (?:value|valuation)/i,/date of report/i],declarations:[/date issued/i,/issue date/i,/policy period/i],tax:[/bill date/i,/date of bill/i,/mailed/i],inspection:[/inspection date/i,/date of inspection/i,/inspected on/i],sov:[/as of/i,/valuation date/i],lossrun:[/valuation date/i,/as of/i],application:[/date/i]}[type]||[];
  for(const rx of want)for(const p of doc.pages)for(const l of p.lines){const m=rx.exec(l);if(m){const d=parseDate(l.slice(m.index));if(d)return d.iso}}
  for(const p of doc.pages.slice(0,2))for(const l of p.lines){const d=parseDate(l);if(d)return d.iso}
  return null;
}
const LABELWORD=/\b(NAME|NUMBER|NO|DATE|TIME|ADDRESS|LOCATION|LIMITS?|PREMIUMS?|DEDUCTIBLE|COVERAGE|COUNTY|CODE|PERIOD|INSURED|TYPE|AMOUNT|DUE|VALUE|YEAR|CONSTRUCTION|OCCUPANCY|DESCRIPTION|FORM|EDITION|INTEREST|TERRITORY|AGENCY|AGENT)\b/;
function cellsOf(line){const out=[];const rx=/\S(?:.*?\S)?(?=\s{2,}|$)/g;let m;while((m=rx.exec(line)))out.push({text:m[0],at:m.index});return out.length?out:[{text:'',at:0}]}
const capsCell=t=>/[A-Z]/.test(t)&&!/[a-z0-9]/.test(t);
const labelLike=t=>capsCell(t)&&LABELWORD.test(t);
function isHeader(cells){return cells.length>=2&&cells.every(c=>capsCell(c.text))&&cells.filter(c=>LABELWORD.test(c.text)).length>=2}
function extract(docs){
  const meta=docs.map(d=>{const c=classify(d);return {name:d.name,type:c.type,typeLabel:c.label,date:docDate(d,c.type),pages:d.pages.length,lines:d.pages.reduce((a,p)=>a+p.lines.length,0),textless:d.pages.filter(p=>!p.lines.length).length}});
  const cands={},warnings=[];const push=(key,c)=>(cands[key]=cands[key]||[]).push(c);
  /* tables: a header row whose cells are field labels, followed by rows with the same number of cells */
  docs.forEach((d,di)=>d.pages.forEach(p=>p.lines.forEach((line,li)=>{
    const cells=line.split(/\s{2,}/);if(cells.length<3)return;
    const map=cells.map(c=>FIELDS.find(f=>c.length<40&&f.rx.some(r=>r.test(c)))||null);
    if(map.filter(Boolean).length<2)return;
    let rows=0;
    for(let k=li+1;k<p.lines.length&&k<=li+12;k++){
      const row=p.lines[k],rc=row.split(/\s{2,}/);if(rc.length!==cells.length)break;rows++;
      if(rows>1)continue;
      let pos=0;rc.forEach((cell,ci)=>{const at=row.indexOf(cell,pos);pos=at+cell.length;const f=map[ci];if(!f)return;const v=READ[f.type](cell);
        if(v)push(f.key,{di,page:p.n,line:k,snippet:row,s:at+v.i,e:at+v.i+v.len,norm:v.norm,show:v.show,rank:10,date:null})});
    }
    if(rows>1)warnings.push(`${d.name} p.${p.n}: table has ${rows} rows; only the first was read into the profile`);
  })));
  docs.forEach((d,di)=>d.pages.forEach(p=>p.lines.forEach((line,li)=>{
    const cells=cellsOf(line),header=isHeader(cells);
    const prev=li>0?cellsOf(p.lines[li-1]):null;
    const dataRow=prev&&isHeader(prev)&&prev.length===cells.length; /* a row under a header is data, not labels */
    if(header){ /* coverage grid: a LIMIT column crossed with a "Building" row */
      const lc=cells.findIndex(c=>/\bLIMITS?\b/.test(c.text));
      if(lc>0)for(let k=li+1;k<p.lines.length&&k<=li+8;k++){const rc=cellsOf(p.lines[k]);if(rc.length!==cells.length)break;
        if(/^building\b(?!.*personal)/i.test(rc[0].text)){const v=READ.money(rc[lc].text);if(v)push('buildingLimit',{di,page:p.n,line:k,snippet:p.lines[k],s:rc[lc].at+v.i,e:rc[lc].at+v.i+v.len,norm:v.norm,show:v.show,rank:1,date:null});break}}
    }
    const next=p.lines[li+1]!=null?cellsOf(p.lines[li+1]):null;
    for(const f of FIELDS){
      if(dataRow)break;
      const texty=['text','token','address'].includes(f.type);
      for(let ri=0;ri<f.rx.length;ri++){
        const m=f.rx[ri].exec(line);if(!m)continue;
        const ci=cells.findIndex(c=>m.index>=c.at&&m.index<c.at+c.text.length+2),cell=cells[ci<0?0:ci];
        if(texty&&m.index-cell.at>3)continue; /* a name or address label must start its cell, not sit inside a sentence */
        const after=Math.min(m.index+m[0].length,cell.at+cell.text.length),rest=line.slice(after,cell.at+cell.text.length);
        let v=null,src=line,off=0,ln=li;
        const below=()=>{if(!next)return;const nl=p.lines[li+1];src=nl;ln=li+1;
          if(f.whole){v=READ[f.type](nl);off=0}
          else if(next.length===cells.length&&ci>=0){v=READ[f.type](next[ci].text);off=next[ci].at}
          else if(cells.length===1){v=READ[f.type](nl);off=0}};
        if(header)below();
        else if(f.whole){v=READ[f.type](line)}
        else{
          v=READ[f.type](rest);off=after;
          if(!v&&(!texty||/^[\s:.\-–—#]*$/.test(rest))){
            if(cells[ci+1]){v=READ[f.type](cells[ci+1].text);off=cells[ci+1].at}
            else below();
          }
          if(!v&&['construction','yesno','year','area'].includes(f.type)){v=READ[f.type](line.slice(cell.at,m.index));off=cell.at;src=line;ln=li}
        }
        if(v&&texty&&f.type!=='address'&&((f.type==='text'&&/^[\d\s#.\-\/*]+$/.test(v.show))||labelLike(v.show)||v.show.length>80))v=null; /* never show a label, a bare number or a paragraph as a name */
        if(v){push(f.key,{di,page:p.n,line:ln,snippet:src,s:off+v.i,e:off+v.i+v.len,norm:v.norm,show:v.show,rank:ri,date:(parseDate(src)||{}).iso||null});break}
      }
      (f.alt||[]).forEach((rx,ai)=>{const m=rx.exec(line);if(!m)return;const v=READ[f.type](m[1]);if(v)push(f.key,{di,page:p.n,line:li,snippet:line,s:m.index,e:m.index+m[0].length,norm:v.norm,show:v.show,rank:20+ai,date:null})});
    }
    for(const L of LIST){if(L.rx.test(line)){const v=READ.money(line);if(v)push(L.key,{di,page:p.n,line:li,snippet:line,s:v.i,e:v.i+v.len,norm:v.norm,show:line.slice(0,v.i).replace(/[\s:.\-–—]+$/,'').trim()+' · '+v.show,rank:0,date:null})}}
  })));
  const fields=FIELDS.map(f=>{
    const cs=(cands[f.key]||[]).slice();
    /* one value per document: the most specific label, then the earliest line */
    const perDoc=[];docs.forEach((d,di)=>{const c=cs.filter(x=>x.di===di).sort((a,b)=>a.rank-b.rank||a.page-b.page||a.line-b.line)[0];if(c)perDoc.push(c)});
    const pr=c=>{const i=(f.docs||[]).indexOf(meta[c.di].type);return i<0?99:i};
    perDoc.sort((a,b)=>pr(a)-pr(b)||a.rank-b.rank);
    const sources=perDoc.map(c=>({di:c.di,line:c.line,doc:meta[c.di].name,docType:meta[c.di].typeLabel,page:c.page,pages:meta[c.di].pages,snippet:c.snippet,s:c.s,e:c.e,value:c.show,norm:c.norm,date:c.date||meta[c.di].date}));
    let status='missing',value=null,norm=null,diff=null;
    if(sources.length){status='sourced';value=sources[0].value;norm=sources[0].norm;
      const numeric=['money','area','int','year','pct'].includes(f.type);
      const other=sources.find(x=>numeric?Math.abs(x.norm-norm)>Math.max(Math.abs(norm)*0.005,0):(['construction','yesno','valuation','apn','token','period'].includes(f.type)&&x.norm!==norm));
      if(other){status='conflicting';if(numeric&&norm)diff=Math.abs(other.norm-norm)/Math.max(Math.abs(other.norm),Math.abs(norm))*100}}
    return {key:f.key,label:f.label,group:f.group,type:f.type,required:!!f.req,status,value,norm,diff,sources};
  });
  const lists=LIST.map(L=>({key:L.key,label:L.label,group:L.group,items:(cands[L.key]||[]).filter((c,i,a)=>a.findIndex(x=>x.show===c.show)===i).map(c=>({di:c.di,line:c.line,doc:meta[c.di].name,docType:meta[c.di].typeLabel,page:c.page,pages:meta[c.di].pages,snippet:c.snippet,s:c.s,e:c.e,value:c.show,norm:c.norm,date:meta[c.di].date}))}));
  const req=fields.filter(f=>f.required);
  return {docs:meta,fields,lists,warnings,summary:{populated:fields.filter(f=>f.status!=='missing').length,total:fields.length,requiredFound:req.filter(f=>f.status!=='missing').length,required:req.length,conflicts:fields.filter(f=>f.status==='conflicting').length}};
}
/* pdf.js text items -> lines. Items on one baseline are joined left to right; a wide gap becomes two spaces
   so a label and its value in separate table columns stay distinguishable. */
function linesFromItems(items){
  const rows=[];
  items.filter(it=>it.str&&it.str.trim()).forEach(it=>{
    const x=it.transform[4],y=it.transform[5],h=Math.abs(it.transform[3])||it.height||10;
    let r=rows.find(r=>Math.abs(r.y-y)<=Math.max(2,h*0.35));if(!r){r={y,parts:[]};rows.push(r)}
    r.parts.push({x,w:it.width||0,str:it.str,h});
  });
  rows.sort((a,b)=>b.y-a.y);
  return rows.map(r=>{r.parts.sort((a,b)=>a.x-b.x);let out='',end=null;
    r.parts.forEach(p=>{if(end!=null){const gap=p.x-end;out+=gap>p.h*0.8?'  ':gap>p.h*0.12&&!/\s$/.test(out)&&!/^\s/.test(p.str)?' ':''}out+=p.str;end=p.x+p.w});
    return out.replace(/ /g,' ').trimEnd()}).filter(l=>l.trim());
}
const api={extract,classify,linesFromItems,parseDate,FIELDS,READ};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PLExtract=api;
})(typeof globalThis!=='undefined'?globalThis:this);
