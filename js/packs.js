// Shape packs (bundled extras, user imports, online picks) and browser persistence (IndexedDB).
// Packs merge into the global Stencils registry, so every feature treats their shapes like built-ins.
// Drawings embed the definitions of the pack shapes they use, so a shared file always renders.

// ---------- IndexedDB store ----------
const Store=(()=>{
  let dbp=null;const ok=typeof indexedDB!=='undefined';
  function db(){return dbp??=new Promise((res,rej)=>{const r=indexedDB.open('port-network-studio',1);r.onupgradeneeded=()=>{const d=r.result;for(const s of['drawings','packs','kv'])if(!d.objectStoreNames.contains(s))d.createObjectStore(s,{keyPath:s==='kv'?'k':'id'})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);r.onblocked=()=>rej(Error('Storage is blocked by another tab'))})}
  async function run(store,mode,fn){const d=await db();return new Promise((res,rej)=>{const t=d.transaction(store,mode),s=t.objectStore(store);let out;const q=fn(s);if(q)q.onsuccess=()=>out=q.result;t.oncomplete=()=>res(out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error||Error('aborted'))})}
  const get=(s,k)=>run(s,'readonly',o=>o.get(k)),put=(s,v)=>run(s,'readwrite',o=>o.put(v)),del=(s,k)=>run(s,'readwrite',o=>o.delete(k)),all=(s)=>run(s,'readonly',o=>o.getAll());
  const kvGet=async k=>(await get('kv',k))?.v,kvSet=(k,v)=>put('kv',{k,v});
  async function persist(){try{return await navigator.storage?.persist?.()}catch{return false}}
  async function persisted(){try{return await navigator.storage?.persisted?.()}catch{return false}}
  async function estimate(){try{return await navigator.storage?.estimate?.()}catch{return null}}
  return{ok,get,put,del,all,kvGet,kvSet,persist,persisted,estimate};
})();

const Packs=(()=>{
  const C=Core,packs=new Map();
  const slug=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'shape';
  const hash=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};

  // ---------- registry ----------
  function install(pack){packs.set(pack.id,pack);const cats=pack.categories?.length?pack.categories:[{id:'pack:'+pack.id,name:pack.name}];
    for(const c of cats){const i=Stencils.categories.findIndex(x=>x.id===c.id);const cat={...c,pack:pack.id};if(i>=0)Stencils.categories[i]=cat;else Stencils.categories.push(cat)}
    for(const[id,s]of Object.entries(pack.shapes||{}))Stencils.shapes[id]={tier:5,...s,svg:noStroke(s.svg),cat:s.cat||cats[0].id,pack:pack.id};iconCache?.clear?.()}
  // pack icons are mostly filled glyphs: don't let the editor's default outline stroke thicken them
  const noStroke=svg=>/^<g [^>]*stroke=/.test(svg||'')?svg:`<g stroke="none">${svg}</g>`;
  function uninstall(id){const p=packs.get(id);if(!p)return;packs.delete(id);const used=new Set((S.doc?.pages||[]).flatMap(pg=>pg.items).filter(n=>n.kind==='node').map(n=>n.type));
    for(const sid of Object.keys(p.shapes||{}))if(!used.has(sid))delete Stencils.shapes[sid];else Stencils.shapes[sid].cat='doc-shapes';Stencils.categories=Stencils.categories.filter(c=>c.pack!==id);ensureDocCategory();iconCache?.clear?.()}
  function ensureDocCategory(){if(Object.values(Stencils.shapes).some(s=>s.cat==='doc-shapes')&&!Stencils.categories.some(c=>c.id==='doc-shapes'))Stencils.categories.push({id:'doc-shapes',name:'Shapes in this drawing'})}
  // A drawing carries copies of the pack shapes it uses.
  function embedUsed(doc){const used=new Set(doc.pages.flatMap(p=>p.items).filter(n=>n.kind==='node').map(n=>n.type)),out={};for(const t of used){const s=Stencils.shapes[t];if(s?.pack){const{pack,...rest}=s;out[t]=rest}}if(Object.keys(out).length)doc.stencils=out;else delete doc.stencils;return doc}
  function installDoc(doc){let added=0;for(const[id,s]of Object.entries(doc.stencils||{})){if(Stencils.shapes[id])continue;if(!isSafeMarkup(s.svg))continue;Stencils.shapes[id]={...s,svg:noStroke(s.svg),cat:'doc-shapes',pack:'doc'};added++}if(added)ensureDocCategory();iconCache?.clear?.();return added}
  const list=()=>[...packs.values()];

  // ---------- SVG sanitising ----------
  const DROP=new Set(['script','foreignobject','iframe','object','embed','audio','video','canvas','animate','animatemotion','animatetransform','set','handler','listener','metadata','title','desc','sodipodi:namedview','inkscape:perspective']);
  const ALLOWED_HREF=/^(#|data:image\/(png|jpe?g|gif|webp);base64,)/i;
  function isSafeMarkup(svg){return typeof svg==='string'&&!/<\s*(script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|javascript:/i.test(svg)}
  function cleanStyle(css){return String(css||'').replace(/@import[^;]+;?/gi,'').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi,'none').replace(/expression\s*\(/gi,'')}
  function sanitizeSvg(text,idPrefix){
    const doc=new DOMParser().parseFromString(text,'image/svg+xml'),root=doc.documentElement;if(!root||root.nodeName.toLowerCase()!=='svg'||doc.querySelector('parsererror'))throw Error('Not a valid SVG file.');
    const walk=el=>{for(const c of[...el.children]){const name=c.nodeName.toLowerCase();if(DROP.has(name)||name.includes(':')&&!name.startsWith('svg:')){c.remove();continue}
        for(const a of[...c.attributes]){const n=a.name.toLowerCase();if(n.startsWith('on')||/javascript:/i.test(a.value)){c.removeAttribute(a.name);continue}if((n==='href'||n==='xlink:href')&&!ALLOWED_HREF.test(a.value.trim()))c.removeAttribute(a.name);if(n==='style')c.setAttribute('style',cleanStyle(a.value));if(n.startsWith('xmlns:')||n.startsWith('inkscape:')||n.startsWith('sodipodi:'))c.removeAttribute(a.name)}
        if(name==='style')c.textContent=cleanStyle(c.textContent);walk(c)}};walk(root);
    // unique ids so gradients/clips from different icons never collide
    const ids=[...root.querySelectorAll('[id]')];for(const e of ids){const old=e.id,nu=idPrefix+'-'+old;e.id=nu;for(const r of root.querySelectorAll('*'))for(const a of[...r.attributes]){if(a.value.includes('#'+old))r.setAttribute(a.name,a.value.split('url(#'+old+')').join('url(#'+nu+')').replace(new RegExp('^#'+old.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'),'#'+nu))}for(const st of root.querySelectorAll('style'))st.textContent=st.textContent.split('#'+old).join('#'+nu)}
    let vb=root.getAttribute('viewBox');const W=parseFloat(root.getAttribute('width'))||0,H=parseFloat(root.getAttribute('height'))||0;if(!vb)vb=`0 0 ${W||24} ${H||24}`;const[,, vw,vh]=vb.split(/[\s,]+/).map(Number);if(!(vw>0&&vh>0))throw Error('SVG has no usable size.');
    // keep the root's presentation attributes on a wrapper group; default fill black → currentColor (recolourable)
    const keep=['fill','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','fill-rule','opacity','style','transform','color'],attrs=keep.map(k=>[k,root.getAttribute(k)]).filter(([,v])=>v!=null);
    if(!attrs.some(([k])=>k==='fill'))attrs.push(['fill','currentColor']);if(!attrs.some(([k])=>k==='stroke'))attrs.push(['stroke','none']);
    const inner=[...root.childNodes].map(n=>new XMLSerializer().serializeToString(n)).join('').replace(/\s+xmlns(:\w+)?="[^"]*"/g,'').replace(/>\s+</g,'><').trim();
    let markup=`<g ${attrs.map(([k,v])=>`${k}="${String(v).replace(/"/g,'&quot;')}"`).join(' ')}>${inner}</g>`;
    // monochrome icons become recolourable: their single colour maps to the accent colour
    const colors=new Set((markup.match(/(?:fill|stroke|stop-color|color)\s*[:=]\s*"?\s*(#[0-9a-f]{3,8}\b|rgb\([^)]*\)|black|white)/gi)||[]).map(m=>m.split(/[:=]/)[1].replace(/["\s]/g,'').toLowerCase()).filter(c=>!['white','#fff','#ffffff'].includes(c)));
    const recolor=colors.size<=1;if(recolor&&colors.size===1){const c=[...colors][0],re=new RegExp(c.replace(/[()#.,]/g,'\\$&'),'gi');markup=markup.replace(re,'currentColor')}
    if(!isSafeMarkup(markup))throw Error('SVG contains unsupported content.');
    return{vb:vb.split(/[\s,]+/).map(Number).join(' '),svg:markup,recolor,aspect:vw/vh}}
  function stencilFrom(name,vb,svg,{cat,tags='',source='',license='',recolor=true}={}){const[, ,vw,vh]=vb.split(' ').map(Number),k=Math.min(64/vw,64/vh),w=Math.max(16,Math.round(vw*k)),h=Math.max(16,Math.round(vh*k));return{name,cat,w,h,vb,svg,tier:5,tags:(tags+' '+name).toLowerCase(),source,license,recolor}}
  async function imageStencil(name,blob,opts){const url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(blob)});const img=new Image();img.src=url;await img.decode();const w=img.naturalWidth||64,h=img.naturalHeight||64;return stencilFrom(name,`0 0 ${w} ${h}`,`<image href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`,{...opts,recolor:false})}

  // ---------- importers ----------
  const prettyName=f=>f.replace(/\.[^.]+$/,'').replace(/^(Arch|Res|Icon|icon)[-_]/,'').replace(/[-_]+(16|24|32|48|64|128|light|dark)$/i,'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
  const sizeDir=/^(\d+|\d+x\d+|svg|png|icons?|light|dark|@?\dx|color|colour|mono|black|white)$/i;
  function catFromPath(p){const parts=p.split('/').slice(0,-1).filter(x=>x&&!sizeDir.test(x)&&x!=='__MACOSX');return(parts.at(-1)||'').replace(/^(Arch|Res)_/,'').replace(/[-_]+/g,' ').trim()}
  async function fromFiles(entries,packName){// entries: [{path, blob}]
    const pack={id:'u-'+hash(packName+Date.now()),name:packName,source:'import',created:new Date().toISOString(),categories:[],shapes:{}},seen=new Set();let skipped=0;
    const sorted=entries.filter(e=>!/(^|\/)(__MACOSX|\.)/.test(e.path)).sort((a,b)=>/64|48/.test(b.path)-/64|48/.test(a.path));
    for(const e of sorted){const file=e.path.split('/').pop(),ext=file.split('.').pop().toLowerCase(),name=prettyName(file),key=(catFromPath(e.path)+'|'+name).toLowerCase();if(seen.has(key))continue;
      const catName=catFromPath(e.path)||packName,catId='pack:'+pack.id+':'+slug(catName);if(!pack.categories.some(c=>c.id===catId))pack.categories.push({id:catId,name:catName===packName?packName:packName+' · '+catName});
      const id='u-'+hash(pack.id+e.path);
      try{if(ext==='svg'){const s=sanitizeSvg(await e.blob.text(),id);pack.shapes[id]=stencilFrom(name,s.vb,s.svg,{cat:catId,tags:catName,source:e.path,recolor:s.recolor})}else if(['png','jpg','jpeg','gif','webp'].includes(ext)){if(e.blob.size>2e6){skipped++;continue}pack.shapes[id]=await imageStencil(name,e.blob,{cat:catId,tags:catName,source:e.path})}else continue;seen.add(key)}catch{skipped++}}
    if(pack.categories.length>40){// very deep packs: collapse into one category
      const one='pack:'+pack.id;pack.categories=[{id:one,name:packName}];for(const s of Object.values(pack.shapes))s.cat=one}
    return{pack,skipped}}
  // all=true: every file as {path, bytes}; otherwise only images, as {path, blob}
  async function unzip(blob,all=false){const buf=new Uint8Array(await blob.arrayBuffer()),dv=new DataView(buf.buffer),out=[];let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-70000);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}if(eocd<0)throw Error('Not a ZIP file.');
    const count=dv.getUint16(eocd+10,true);let p=dv.getUint32(eocd+16,true);const dec=new TextDecoder();
    for(let i=0;i<count;i++){if(dv.getUint32(p,true)!==0x02014b50)break;const method=dv.getUint16(p+10,true),csize=dv.getUint32(p+20,true),nlen=dv.getUint16(p+28,true),xlen=dv.getUint16(p+30,true),clen=dv.getUint16(p+32,true),lho=dv.getUint32(p+42,true),name=dec.decode(buf.subarray(p+46,p+46+nlen));p+=46+nlen+xlen+clen;
      if(name.endsWith('/')||!all&&!/\.(svg|png|jpe?g|gif|webp)$/i.test(name))continue;const ln=dv.getUint16(lho+26,true),lx=dv.getUint16(lho+28,true),start=lho+30+ln+lx,data=buf.subarray(start,start+csize);
      let bytes;if(method===0)bytes=data;else if(method===8){bytes=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())}else continue;
      if(all){out.push({path:name,bytes});continue}
      out.push({path:name,blob:new Blob([bytes],{type:/\.svg$/i.test(name)?'image/svg+xml':'image/'+name.split('.').pop().toLowerCase().replace('jpg','jpeg')})})}
    return out}
  async function fromDrawioLibrary(text,packName){const m=/<mxlibrary>([\s\S]*)<\/mxlibrary>/.exec(text);if(!m)throw Error('Not a draw.io library (.xml exported from draw.io ▸ File ▸ Export library).');const arr=JSON.parse(m[1]);const entries=[];let skipped=0;
    for(const[i,e]of arr.entries()){let data=e.data;if(!data&&e.xml){try{let xml=e.xml;if(!xml.startsWith('<')){const bin=atob(xml),b=new Uint8Array(bin.length);for(let k=0;k<bin.length;k++)b[k]=bin.charCodeAt(k);xml=decodeURIComponent(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text())}const im=/image=(data:image\/[\w+.-]+[,;][^;"&]+)/.exec(xml.replace(/&amp;/g,'&'));if(im)data=im[1].includes(';base64')?im[1]:im[1].replace(/^data:image\/([\w+.-]+),/,'data:image/$1;base64,')}catch{}}
      if(!data){skipped++;continue}const blob=await (await fetch(data.replace(/^data:image\/svg\+xml,(?!PHN)/,'data:image/svg+xml;base64,'))).blob();const ext=blob.type.includes('svg')?'svg':(blob.type.split('/')[1]||'png');entries.push({path:(e.title||'Shape '+(i+1)).replace(/\//g,'-')+'.'+ext,blob})}
    const r=await fromFiles(entries,packName);r.skipped+=skipped;return r}
  async function importAny(files,packName){
    files=[...files];if(!files.length)return;
    const first=files[0],lower=first.name.toLowerCase();
    if(files.every(f=>Visio.isStencil(f.name))){let pack=null,skipped=0;for(const f of files){const r=await Visio.stencilToPack(f);skipped+=r.stats.skipped;if(!pack){pack=r.pack;pack.name=packName||pack.name;continue}pack.categories.push(...r.pack.categories);Object.assign(pack.shapes,r.pack.shapes)}return{pack,skipped}}
    if(files.some(f=>Visio.isLegacy(f.name)))throw Error('Old binary Visio files (.vss / .vsd) cannot be read in a browser — open them in Visio and save as .vssx (stencil) or .vsdx (drawing).');
    if(files.length===1&&lower.endsWith('.json')){const d=JSON.parse(await first.text());if(!d.portPack)throw Error('Not a Port shape pack.');for(const s of Object.values(d.pack.shapes))if(!isSafeMarkup(s.svg))throw Error('Pack contains unsafe markup.');d.pack.id='u-'+hash(d.pack.name+Date.now());const old=Object.entries(d.pack.shapes);d.pack.shapes={};const remap={};for(const[cid]of(d.pack.categories||[]).entries()){}d.pack.categories=(d.pack.categories||[{name:d.pack.name}]).map(c=>{const id='pack:'+d.pack.id+':'+slug(c.name);remap[c.id]=id;return{id,name:c.name}});for(const[sid,s]of old)d.pack.shapes[sid.startsWith('u-')?sid:'u-'+hash(d.pack.id+sid)]={...s,cat:remap[s.cat]||d.pack.categories[0].id};return{pack:d.pack,skipped:0}}
    if(files.length===1&&(lower.endsWith('.xml')||lower.endsWith('.drawio')))return fromDrawioLibrary(await first.text(),packName||first.name.replace(/\.[^.]+$/,''));
    const entries=[];for(const f of files){const n=f.name.toLowerCase();if(n.endsWith('.zip'))entries.push(...await unzip(f));else entries.push({path:f.webkitRelativePath||f.name,blob:f})}
    if(!entries.length)throw Error('No SVG or image files found.');return fromFiles(entries,packName)}
  async function save(pack){install(pack);try{await Store.put('packs',pack)}catch(err){notify('Pack installed for this session, but browser storage refused it: '+err.message)}}
  async function remove(id){uninstall(id);try{await Store.del('packs',id)}catch{}}
  async function loadAll(){if(typeof ExtendedPack!=='undefined')install(ExtendedPack);try{for(const p of await Store.all('packs'))install(p)}catch(err){console.warn('packs not loaded',err)}}
  function exportPack(id){const p=packs.get(id);if(!p)return;download(slug(p.name)+'.portpack.json',JSON.stringify({portPack:1,pack:p}),'application/json')}

  // ---------- online icons (Iconify: 200k+ open-source icons) ----------
  const API='https://api.iconify.design';let collections=null;
  const SETS={network:'carbon,tabler,mdi,material-symbols,fluent,ph,lucide,clarity,eos-icons,icon-park-outline,streamline',brands:'logos,simple-icons,devicon,skill-icons,vscode-icons',all:''};
  async function getCollections(){if(collections)return collections;const r=await fetch(API+'/collections');collections=await r.json();return collections}
  // Iconify rate-limits per-icon SVG URLs (HTTP 429) when a results grid asks for 100+ at once, so icon data is fetched
  // in batches — one JSON request per icon set — sanitised once, cached, and drawn inline.
  const searches=new Map(),iconData=new Map();
  const limitedError=()=>Object.assign(Error('Iconify is limiting requests from this network right now — try again in a few minutes. Bundled and imported shapes still work.'),{limited:true});
  async function search(query,set='network',limit=96){const pre=SETS[set]??set,key=query+'|'+pre+'|'+limit;if(searches.has(key))return searches.get(key);
    const r=await fetch(`${API}/search?query=${encodeURIComponent(query)}&limit=${limit}${pre?'&prefixes='+pre:''}`);if(r.status===429)throw limitedError();if(!r.ok)throw Error('Icon search failed ('+r.status+')');const j=await r.json();searches.set(key,j);return j}
  function iconFromSet(j,name,full){let ic=j.icons?.[name],al=null;if(!ic&&j.aliases?.[name]){al=j.aliases[name];ic=j.icons?.[al.parent]}if(!ic)return null;ic={...ic,...(al||{})};
    const w=ic.width||j.width||24,h=ic.height||j.height||24,vb=`${ic.left||j.left||0} ${ic.top||j.top||0} ${w} ${h}`;
    let body=ic.body;if(ic.hFlip||ic.vFlip||ic.rotate)body=`<g transform="${ic.rotate?`rotate(${ic.rotate*90} ${w/2} ${h/2})`:''}${ic.hFlip?` translate(${w} 0) scale(-1 1)`:''}${ic.vFlip?` translate(0 ${h}) scale(1 -1)`:''}">${body}</g>`;
    return sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`,'i-'+hash(full))}
  // Load many icons with a handful of requests; returns {limited} when Iconify said "too many requests".
  async function loadIcons(fulls){const by=new Map();for(const f of fulls){if(iconData.has(f))continue;const[p,n]=f.split(':');if(!by.has(p))by.set(p,[]);by.get(p).push(n)}
    const jobs=[];for(const[p,names]of by)for(let i=0;i<names.length;i+=60)jobs.push([p,names.slice(i,i+60)]);let limited=false,failed=false;
    const run=async([p,names])=>{try{const r=await fetch(`${API}/${p}.json?icons=${names.map(encodeURIComponent).join(',')}`);if(r.status===429){limited=true;return}if(!r.ok){failed=true;return}const j=await r.json();for(const n of names){try{const d=iconFromSet(j,n,p+':'+n);if(d)iconData.set(p+':'+n,d)}catch{}}}catch{failed=true}};
    for(let i=0;i<jobs.length&&!limited;i+=3)await Promise.all(jobs.slice(i,i+3).map(run));return{limited,failed}}
  const iconPreview=full=>iconData.get(full)||null;
  async function fetchIcon(full){const[prefix,name]=full.split(':');if(!iconData.has(full)){const r=await loadIcons([full]);if(r.limited)throw limitedError()}const s=iconData.get(full);if(!s)throw Error('Icon not found or not downloadable: '+full);const col=(await getCollections().catch(()=>({})))[prefix];
    return stencilFrom(name.replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase()),s.vb,s.svg,{tags:prefix+' '+name,source:full,license:col?.license?.spdx||'',recolor:/currentColor/.test(s.svg)})}
  async function addOnline(full){let pack=packs.get('online');if(!pack){pack={id:'online',name:'Online picks',source:'iconify',categories:[{id:'pack:online',name:'Online picks'}],shapes:{}}}const id='i-'+slug(full.replace(':','-'));if(!pack.shapes[id]){const st=await fetchIcon(full);st.cat='pack:online';pack.shapes[id]=st;await save(pack)}else install(pack);return id}
  const thumbUrl=(full,color='#2f5ea8')=>{const[p,n]=full.split(':');return`${API}/${p}/${n}.svg?color=${encodeURIComponent(color)}`};

  return{install,uninstall,list,embedUsed,installDoc,sanitizeSvg,isSafeMarkup,importAny,unzip,stencilFrom,save,remove,loadAll,exportPack,search,loadIcons,iconPreview,getCollections,addOnline,thumbUrl,SETS,get:id=>packs.get(id)};
})();
