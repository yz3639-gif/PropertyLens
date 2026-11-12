# Builds the two shareable variants from PropertyLens.html:
#   site/PropertyLens.html              page for hosting as an Artifact (index published beside it)
#   PropertyLens-standalone.html        one file with the parcel index and PDF reader inside; works offline
import io,sys,os
src,libs=sys.argv[1],sys.argv[2]
s=io.open(src,encoding='utf-8').read()
lines=s.split('\n')
assert lines[0].startswith('<!doctype html>') and lines[0].rstrip().endswith('<body>')
body='\n'.join(lines[1:]).rstrip()
assert body.endswith('</body></html>'); body=body[:-len('</body></html>')].rstrip()
os.makedirs('site',exist_ok=True)
hosted=body.replace('<title>PropertyLens</title>','<title>PropertyLens</title>\n<script>window.PL_HOSTED=true</script>',1)
io.open('site/PropertyLens.html','w',encoding='utf-8').write(hosted+'\n')
inert=lambda i,t:'<script type="text/plain" id="%s">%s</script>\n'%(i,t.replace('</script','<\\/script').replace('<!--','<\\!--'))
rd=lambda f:io.open(f,encoding='utf-8').read()
extra=inert('plIndexSrc',rd('parcel-index.js'))+inert('plPdfSrc',rd(os.path.join(libs,'pdf.min.js')))+inert('plPdfWorkerSrc',rd(os.path.join(libs,'pdf.worker.min.js')))
io.open('PropertyLens-standalone.html','w',encoding='utf-8').write(lines[0]+'\n'+body+'\n'+extra+'</body></html>\n')
print(os.path.getsize('site/PropertyLens.html'),os.path.getsize('PropertyLens-standalone.html'))
