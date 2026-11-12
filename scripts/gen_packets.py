# Writes two synthetic submission packets as real text PDFs, plus the gold record for each.
# Packet A is the demo's Oak Street property. Packet B is a different fictional property with
# different layouts and label wording (tables, abbreviations, other date formats).
import json,os,sys,zlib
OUT=sys.argv[1]
def esc(t): return t.replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
def pdf(pages,path):
    objs=[];add=lambda b:(objs.append(b),len(objs))[1]
    add(b'');add(b'')
    f1=add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); f2=add(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
    kids=[]
    for rows in pages:
        y=742;ops=[]
        for r in rows:
            if r is None: y-=10; continue
            kind=r[0]
            if kind=='H': ops.append(f"BT /F2 13 Tf 56 {y} Td ({esc(r[1])}) Tj ET"); y-=22
            elif kind=='T': ops.append(f"BT /F1 10.5 Tf 56 {y} Td ({esc(r[1])}) Tj ET"); y-=15
            elif kind=='KV':
                ops.append(f"BT /F1 10.5 Tf 56 {y} Td ({esc(r[1])}) Tj ET"); ops.append(f"BT /F1 10.5 Tf {r[3] if len(r)>3 else 300} {y} Td ({esc(r[2])}) Tj ET"); y-=15
            elif kind=='ROW':
                for x,t in zip(r[1],r[2]): ops.append(f"BT /F1 9.5 Tf {x} {y} Td ({esc(t)}) Tj ET")
                y-=14
        s='\n'.join(ops).encode('latin-1')
        c=add(b'<< /Length %d >>\nstream\n'%len(s)+s+b'\nendstream')
        kids.append(add(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>'%(f1,f2,c)).encode()))
    objs[0]=b'<< /Type /Catalog /Pages 2 0 R >>'
    objs[1]=('<< /Type /Pages /Kids [%s] /Count %d >>'%(' '.join('%d 0 R'%k for k in kids),len(kids))).encode()
    out=b'%PDF-1.4\n';offs=[]
    for i,o in enumerate(objs,1): offs.append(len(out)); out+=b'%d 0 obj\n'%i+o+b'\nendobj\n'
    x=len(out); out+=b'xref\n0 %d\n0000000000 65535 f \n'%(len(objs)+1)+b''.join(b'%010d 00000 n \n'%o for o in offs)
    out+=b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'%(len(objs)+1,x)
    open(path,'wb').write(out)
FILL=['This section is provided for the intended user and intended use stated in the engagement letter.','The analysis relies on information furnished by the owner and on public sources believed to be reliable.','No responsibility is assumed for matters that are legal in nature or for hidden conditions.','Comparable data were confirmed with a party to each transaction where possible.','Photographs and maps are included in the addenda for reference only.']
def filler(title,n=9): return [('H',title),None]+[('T',FILL[i%len(FILL)]) for i in range(n)]
def write(packet,docs,gold):
    d=os.path.join(OUT,packet); os.makedirs(d,exist_ok=True)
    for name,pages in docs.items(): pdf(pages,os.path.join(d,name))
    json.dump(gold,open(os.path.join(d,'gold.json'),'w'),indent=1)
# ---------------- Packet A: Oak Street Apartments (matches the demo workspace) ----------------
A={}
A['Property_Appraisal.pdf']=[
 [('H','APPRAISAL REPORT'),None,('T','Oak Street Apartments'),('T','1420 Oak Street, Mesa Verde, CA'),None,('KV','Date of report:','March 21, 2025'),('KV','Effective date of value:','March 14, 2025'),('KV','Prepared for:','Harborline Lending'),('KV','Owner of record:','Oak Street Holdings LLC'),None,('T','SYNTHETIC SAMPLE DOCUMENT. Fictional property and values, created for the Property Risk Lens demo.')],
 filler('LETTER OF TRANSMITTAL'),
 [('H','SUBJECT PROPERTY'),None,('KV','Property address','1420 Oak Street, Mesa Verde, CA'),('KV',"Assessor's parcel number",'512-034-18'),('T','Current use: multifamily rental.'),('T','Unit count: 12 apartment units (8 two-bedroom, 4 one-bedroom).'),('KV','Year built','1978'),('KV','Number of stories','2'),('T','All units were occupied at the time of inspection.')],
 [('H','RECONCILIATION AND FINAL VALUE OPINION'),None,('T','The sales comparison and income approaches were given primary weight in the final reconciliation.'),('T','Final market value opinion (as is), effective March 14, 2025: $3,100,000.'),('T','This value includes land and site improvements and is not an insurable value.')],
 filler('MARKET AREA ANALYSIS'),
 [('H','IMPROVEMENTS DESCRIPTION'),None,('T','The subject consists of three two-story residential buildings on one parcel.'),('T','Gross building area: 12,000 sq. ft., including enclosed laundry and storage rooms.'),('T','Area was measured on site and reconciled to plans provided by the owner.'),('T','Exterior walls: reinforced concrete masonry.')],
 filler('HIGHEST AND BEST USE'),
 [('H','INCOME APPROACH'),None,('T','Gross potential rent: $360,000 per year, based on the current rent roll.'),('T','Vacancy and collection loss was estimated at five percent.')],
 filler('SALES COMPARISON APPROACH'),filler('SALES COMPARISON APPROACH, CONTINUED'),
 [('H','COST APPROACH'),None,('T','Replacement cost new was estimated from a national cost service with local multipliers applied.'),('T','Estimated replacement cost new of improvements: $2,400,000 (effective March 14, 2025).'),('T','Land value is excluded from this estimate.')],
 filler('CERTIFICATION')]
A['Insurance_Declarations.pdf']=[
 [('H','COMMERCIAL PROPERTY DECLARATIONS'),None,('KV','Policy number','CP-88213'),('KV','Insurer:','Golden Coast Mutual'),('T','Named insured: Oak Street Holdings LLC.'),('T','Policy period 07/01/2026 to 07/01/2027, 12:01 a.m. standard time at the described premises.'),None,('T','Coverage A - Building: Limit of insurance $2,000,000.'),('T','Valuation: Replacement cost. Deductible: $25,000 per occurrence.'),('KV','Coinsurance','90%'),('KV','Mortgagee:','Harborline Lending, ISAOA/ATIMA'),None,('KV','Date issued:','June 20, 2026'),('T','SYNTHETIC SAMPLE DOCUMENT. Not an insurance policy.')],
 [('H','SCHEDULE OF LOCATIONS'),None,('T','Location 1: 1420 Oak Street, Mesa Verde, CA.'),('T','Building 1 - Habitational, masonry construction. Total square footage: 10,000.'),('T','Square footage as reported by the applicant.')]]
A['Property_Tax_Bill.pdf']=[
 [('H','SECURED PROPERTY TAX BILL, FISCAL YEAR 2026-27'),None,('KV','APN','512-034-18'),('KV','Situs','1420 Oak Street, Mesa Verde, CA'),('KV','Bill date:','September 15, 2026'),None,('T','Total annual tax: $24,000.00.'),('T','First installment $12,000.00 due 11/01/2026.'),('T','Second installment $12,000.00 due 02/01/2027.'),('T','Payments received after a due date may be subject to penalty.'),('T','SYNTHETIC SAMPLE DOCUMENT.')],
 [('H','DETAIL OF CHARGES'),None,('KV','General levy (1%)','$19,200.00'),('KV','Voter-approved debt','$2,160.00'),('T','Special assessments:'),('KV','CFD 2019-1 Parks & Streets','$800.00'),('KV','PACE Clean Energy Assessment, contract 7741','$1,840.00'),('KV','Total of all charges','$24,000.00')]]
A['Inspection_Report.pdf']=[
 [('H','PROPERTY INSPECTION REPORT'),None,('KV','Inspection date:','August 4, 2026'),('KV','Property address:','1420 Oak Street, Mesa Verde, CA'),('T','SYNTHETIC SAMPLE DOCUMENT.')],
 [('H','STRUCTURE'),None,('T','Foundation: concrete slab on grade.'),('T','Exterior walls: reinforced concrete masonry units (CMU).'),('T','No significant cracking observed at accessible areas.')],
 filler('ELECTRICAL',6),filler('PLUMBING',6),
 [('H','ROOF'),None,('T','Covering: composition shingle; moderate granule loss observed.'),('T','Replacement date could not be determined from available records.'),('T','The owner did not provide permit history.'),None,('H','FIRE PROTECTION'),('T','Fire sprinklers: none observed. Smoke alarms present in units.')]]
goldA={'insured':'Oak Street Holdings LLC','address':'1420 Oak Street, Mesa Verde, CA','apn':'512-034-18','occupancy':'multifamily rental','units':12,'yearBuilt':1978,'construction':'masonry','stories':2,'area':12000,'roof':'composition shingle','roofYear':None,'sprinklers':'no','marketValue':3100000,'replacementCost':2400000,'insurer':'Golden Coast Mutual','policyNumber':'CP-88213','policyPeriod':'2026-07-01/2027-07-01','buildingLimit':2000000,'deductible':25000,'valuation':'RC','coinsurance':90,'mortgagee':'Harborline Lending, ISAOA/ATIMA','annualTax':24000,'installment1':12000,'installment2':12000,'lossCount':None,'lossTotal':None,'_conflicts':['area']}
write('packetA',A,goldA)
# ---------------- Packet B: different fictional property, different layouts and wording ----------------
B={}
B['Marina_SOV.pdf']=[
 [('H','STATEMENT OF VALUES'),None,('KV','Applicant name','Marina Way Retail LP'),('KV','As of','2026-05-02'),None,
  ('ROW',[56,90,250,300,345,400,450,515],['Loc','Address','Yr Blt','Stories','Const.','Occupancy','GBA (SF)','TIV']),
  ('ROW',[56,90,250,300,345,400,450,515],['1','88 Marina Way, Port Alder, CA','2004','1','Steel frame','Retail','28,400','$5,250,000']),None,
  ('KV','Year built','2004'),('KV','No. of stories','1'),('KV','Construction type','Steel frame, metal deck'),('KV','Occupancy','Neighborhood retail center, 6 suites'),('KV','Building size','28,400 SF'),('KV','Roof updated','2019'),('KV','Automatic sprinkler system','Yes, wet pipe system'),('KV','Total insured value (TIV)','$5,250,000'),None,('T','SYNTHETIC SAMPLE DOCUMENT.')]]
B['Marina_Policy_Dec_Page.pdf']=[
 [('H','COMMON POLICY DECLARATIONS'),None,('KV','POLICY NO.','CPP-55190',200),('KV','ISSUING COMPANY','Pacific Shoreline Insurance',200),('KV','NAMED INSURED','Marina Way Retail LP',200),('KV','POLICY PERIOD','From 10/30/2025 to 10/30/2026',200),('KV','PREMISES','88 Marina Way, Port Alder, CA',200),None,
  ('ROW',[56,180,300,400,480],['COVERAGE','LIMIT OF INSURANCE','DEDUCTIBLE','COINSURANCE','VALUATION']),
  ('ROW',[56,180,300,400,480],['Building','$5,200,000','$50,000','80%','RCV']),
  ('ROW',[56,180,300,400,480],['Business Income','$690,000','72 hours','','']),None,
  ('KV','MORTGAGEE','Harborline Lending, its successors and/or assigns',200),('KV','DATE ISSUED','Oct. 20, 2025',200),('T','SYNTHETIC SAMPLE DOCUMENT. Not an insurance policy.')]]
B['Marina_Appraisal_Summary.pdf']=[
 [('H','SUMMARY APPRAISAL REPORT'),None,('KV','Date of valuation','Jan. 20, 2026'),('KV','Subject address','88 Marina Way, Port Alder, CA'),('KV','Parcel No.','077-210-04')],
 filler('SCOPE OF WORK'),
 [('H','SUMMARY OF SALIENT FACTS'),None,('KV','Property type','Neighborhood retail center'),('T','The improvements were constructed in 2004 and contain 28,400 square feet of gross building area.'),('T','The building is a one-story steel-frame structure.'),('KV','As-is value conclusion','$6,900,000'),('KV','RCN (cost approach)','$5,000,000')],
 filler('ASSUMPTIONS AND LIMITING CONDITIONS')]
B['Marina_Loss_Runs.pdf']=[
 [('H','LOSS RUN REPORT'),None,('KV','Policy #','CPP-55190'),('KV','Valuation date','09/30/2026'),None,
  ('ROW',[56,150,260,400,490],['Date of loss','Claim number','Cause','Paid','Incurred']),
  ('ROW',[56,150,260,400,490],['03/14/2023','CL-20931','Water damage','$11,200','$11,200']),
  ('ROW',[56,150,260,400,490],['11/02/2024','CL-24418','Wind','$7,250','$7,250']),None,
  ('KV','Number of claims','2'),('KV','Total incurred','$18,450'),('T','SYNTHETIC SAMPLE DOCUMENT.')]]
B['Marina_Tax_Statement.pdf']=[
 [('H','ANNUAL PROPERTY TAX STATEMENT 2026-2027'),None,('KV','Parcel number','077-210-04'),('KV','Situs','88 Marina Way, Port Alder, CA'),('KV','Date of bill','09/12/2026'),None,
  ('ROW',[56,300,420],['Installment','Amount','Due']),('ROW',[56,300,420],['1st installment','$30,600.00','11/01/2026']),('ROW',[56,300,420],['2nd installment','$30,600.00','02/01/2027']),None,
  ('KV','TOTAL TAXES DUE','$61,200.00'),('KV','Lighting district direct charge','$412.00'),('T','SYNTHETIC SAMPLE DOCUMENT.')]]
goldB={'insured':'Marina Way Retail LP','address':'88 Marina Way, Port Alder, CA','apn':'077-210-04','occupancy':'Neighborhood retail center','units':None,'yearBuilt':2004,'construction':'steel','stories':1,'area':28400,'roof':None,'roofYear':2019,'sprinklers':'yes','marketValue':6900000,'replacementCost':5000000,'insurer':'Pacific Shoreline Insurance','policyNumber':'CPP-55190','policyPeriod':'2025-10-30/2026-10-30','buildingLimit':5200000,'deductible':50000,'valuation':'RC','coinsurance':80,'mortgagee':'Harborline Lending, its successors and/or assigns','annualTax':61200,'installment1':30600,'installment2':30600,'lossCount':2,'lossTotal':18450,'_conflicts':['replacementCost']}
write('packetB',B,goldB)
print('written')
