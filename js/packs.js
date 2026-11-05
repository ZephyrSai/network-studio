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
  // Packs from storage or a backup are checked like any file: a bad entry goes, the rest stays.
  function install(pack){if(!okId(pack?.id))return false;packs.set(pack.id,pack);if(Array.isArray(pack.categories))pack.categories=pack.categories.filter(c=>okId(c?.id));else delete pack.categories;const cats=pack.categories?.length?pack.categories:[{id:'pack:'+pack.id,name:pack.name}];
    for(const c of cats){const i=Stencils.categories.findIndex(x=>x.id===c.id);const cat={...c,pack:pack.id};if(i>=0)Stencils.categories[i]=cat;else Stencils.categories.push(cat)}
    for(const[id,s]of Object.entries(pack.shapes||{})){const d=okId(id)&&cleanDef(s);if(!d){delete pack.shapes[id];continue}pack.shapes[id]=d;Stencils.shapes[id]={tier:5,...d,svg:noStroke(d.svg),cat:d.cat||cats[0].id,pack:pack.id}}iconCache?.clear?.();return true}
  // pack icons are mostly filled glyphs: don't let the editor's default outline stroke thicken them
  const noStroke=svg=>/^<g [^>]*stroke=/.test(svg||'')?svg:`<g stroke="none">${svg}</g>`;
  const usedTypes=()=>new Set((S.doc?.pages||[]).flatMap(pg=>pg.items).filter(n=>n.kind==='node').map(n=>n.type));
  function uninstall(id){const p=packs.get(id);if(!p)return;packs.delete(id);const used=usedTypes();
    for(const sid of Object.keys(p.shapes||{}))if(!used.has(sid))delete Stencils.shapes[sid];else Stencils.shapes[sid].cat='doc-shapes';Stencils.categories=Stencils.categories.filter(c=>c.pack!==id);ensureDocCategory();iconCache?.clear?.()}
  function ensureDocCategory(){if(Object.values(Stencils.shapes).some(s=>s.cat==='doc-shapes')&&!Stencils.categories.some(c=>c.id==='doc-shapes'))Stencils.categories.push({id:'doc-shapes',name:'Shapes in this drawing'})}
  // A drawing carries copies of the pack shapes it uses.
  function stencilsFor(list){const out={};for(const n of list){if(n.kind!=='node')continue;const s=Stencils.shapes[n.type];if(s?.pack){const{pack,...rest}=s;out[n.type]=rest}}return out}
  function embedUsed(doc){const out=stencilsFor(doc.pages.flatMap(p=>p.items));if(Object.keys(out).length)doc.stencils=out;else delete doc.stencils;return doc}
  function installDoc(doc){let added=0;for(const[id,s]of Object.entries(doc.stencils||{})){if(Stencils.shapes[id]||!okId(id))continue;const d=cleanDef(s);if(!d)continue;const rk=RKC.test(id)&&!!d.rackUnit;if(rk?!Shapes.rackItems[id]&&!registerRack(id,d):Shapes.rackItems[id])continue;const{rackUnit,...rest}=d;Stencils.shapes[id]=rk?{...rest,rackUnit,svg:noStroke(d.svg),cat:'rack-art',pack:'doc'}:{...rest,svg:noStroke(d.svg),cat:'doc-shapes',pack:'doc'};added++}if(added)ensureDocCategory();iconCache?.clear?.();return added}
  // ---------- rack form of a picture ----------
  // rkc-<art>: a derived type, so the source stays a normal resizable shape everywhere else. Only ever in documents (pack 'doc'), never in a pack, and listed nowhere (cat 'rack-art').
  const RKC=/^rkc-/;
  function registerRack(id,s){if(!RKC.test(id)||!s?.rackUnit||typeof s.name!=='string'||!s.name.trim()||Shapes.rackItems[id])return false;const r=s.rackUnit,fr=+r.frac;r.u=Math.max(1,Math.min(48,Math.round(+r.u)||1));r.frac=fr>0?Math.min(1,fr):1;Shapes.rackItems[id]={name:s.name,fam:s.name,u:r.u,face:'art'};return true}
  // d: {name,vb,svg,u,frac,from,fromDef:{vb,w,h,name,tags},tags} → the type's id. The same art always gets the same id, across reloads too.
  // Same art in the same viewBox is the same type. vb0 is the viewBox it was made with, when ShapeKit.trimLater has trimmed it since.
  function rackType(d){const vb=normVb(d.vb),art=safeArt(d.svg);if(!vb||art==null)return null;const svg=noStroke(art),name=String(d.name||'').trim()||'Rack equipment';let id='rkc-'+hash(svg);for(let s=Stencils.shapes[id];s&&(s.svg!==svg||(s.rackUnit?.vb0||s.vb)!==vb);s=Stencils.shapes[id])id+='x';if(Stencils.shapes[id])return id;
    const def={name,cat:'rack-art',w:Shapes.RACK.inner,vb,svg,tier:3,tags:d.tags||'',recolor:false,pack:'doc',rackUnit:{u:d.u,frac:d.frac,from:d.from,fromDef:d.fromDef}};if(!registerRack(id,def))return null;def.h=def.rackUnit.u*Shapes.RU;Stencils.shapes[id]=def;return id}
  // the height chosen with Remember for this shape travels with the document
  function rememberRack(id,u){const s=Stencils.shapes[id],r=Shapes.rackItems[id];if(!s?.rackUnit||!r)return;u=Math.max(1,Math.min(48,Math.round(+u)||1));s.rackUnit.u=r.u=u;s.h=u*Shapes.RU}
  // Saved files don't embed the source of a type all of whose shapes are in racks: the derived art is its art, so Back brings it back under its old id.
  function restoreSource(from,id){if(!from||Stencils.shapes[from]||Shapes.basic[from]||Shapes.rackItems[from]||from==='image'||/^rack\d*$/.test(from)||!/^[\w:.-]+$/.test(from))return false;const s=Stencils.shapes[id],d=s?.rackUnit?.fromDef;if(!s?.rackUnit)return false;Stencils.shapes[from]={name:String(d?.name||s.name),cat:'doc-shapes',w:sizeOf(d?.w)||64,h:sizeOf(d?.h)||64,vb:normVb(d?.vb)||s.vb,svg:s.svg,tier:5,tags:String(d?.tags||''),recolor:false,pack:'doc'};ensureDocCategory();iconCache?.clear?.();return true}
  const list=()=>[...packs.values()];

  // ---------- SVG sanitising ----------
  const DROP=new Set(['script','foreignobject','iframe','object','embed','audio','video','canvas','animate','animatemotion','animatetransform','set','handler','listener','metadata','title','desc','sodipodi:namedview','inkscape:perspective']);
  const ALLOWED_HREF=/^(#|data:image\/(png|jpe?g|bmp|gif|webp);base64,)/i;
  // A stencil's markup comes from files, and the app pastes it into its own HTML: what counts is what the HTML parser will read, so this reads it the same way.
  const ENT={tab:'\t',newline:'\n',colon:':',sol:'/',num:'#',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",lpar:'(',rpar:')',semi:';',comma:',',period:'.',equals:'=',nbsp:'\xa0'};
  const decode=s=>s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));?/gi,(m,d,x,n)=>{if(n)return Object.hasOwn(ENT,n.toLowerCase())?ENT[n.toLowerCase()]:m;const c=d?+d:parseInt(x,16);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'�'});
  const isWs=c=>c===' '||c==='\n'||c==='\t'||c==='\f'||c==='\r';
  // The tags in the markup, as the HTML tokenizer sees them. null: something is left open (a quote, a comment, a tag), which would swallow the app's markup after it.
  function tokens(s){const out=[],n=s.length;let i=0;
    while((i=s.indexOf('<',i))>=0){
      if(s.startsWith('<!--',i)){if(s.startsWith('>',i+4)||s.startsWith('->',i+4)){i=s.indexOf('>',i)+1;continue}const a=s.indexOf('-->',i+4),b=s.indexOf('--!>',i+4);if(a<0&&b<0)return null;i=a<0||b>=0&&b<a?b+4:a+3;continue}
      if(s.startsWith('<![CDATA[',i)){const e=s.indexOf(']]>',i+9);if(e<0)return null;i=e+3;continue}
      const c=s[i+1],close=c==='/',at=close?i+2:i+1;
      if(!/[a-z]/i.test(s[at]||'')){if(close||c==='!'||c==='?'){const e=s.indexOf('>',i);if(e<0)return null;i=e+1}else i++;continue}
      let j=at;while(j<n&&!isWs(s[j])&&s[j]!=='/'&&s[j]!=='>')j++;if(j>=n)return null;const name=s.slice(at,j).toLowerCase(),attrs=[];let self=false;
      for(;;){const st=j;while(j<n&&(isWs(s[j])||s[j]==='/'))j++;if(j>=n)return null;if(s[j]==='>'){self=j>st&&s[j-1]==='/';break}
        const from=j;let k=j+(s[j]==='='?1:0);while(k<n&&!isWs(s[k])&&s[k]!=='/'&&s[k]!=='>'&&s[k]!=='=')k++;const an=s.slice(j,k).toLowerCase();j=k;while(j<n&&isWs(s[j]))j++;let v='';
        if(s[j]==='='){j++;while(j<n&&isWs(s[j]))j++;const q=s[j];if(q==='"'||q==="'"){const e=s.indexOf(q,j+1);if(e<0)return null;v=s.slice(j+1,e);j=e+1}else if(q!=='>'){k=j;while(k<n&&!isWs(s[k])&&s[k]!=='>')k++;v=s.slice(j,k);j=k}}
        attrs.push({name:an,value:v,from,to:j})}
      out.push({name,close,self,attrs,at:i,end:j+1});i=j+1}
    return out}
  // Links may only stay inside the art or hold a picture; animations may not set a link at all. Decoded, and without what a URL parser ignores.
  function attrSafe(tag,name,value){const v=decode(value).replace(/[\x00-\x20\x7f-\xa0]/g,'');if(/^on/.test(name)||/(java|vb)script:/i.test(v))return false;
    // the app's own ids are plain words, and the palette comes before the canvas: art must not answer for $('canvas'). Art from the importers has a prefix with other characters in it.
    if(name==='id')return!/^[a-z]+$/i.test(v);
    if(/(^|:)href$/.test(name))return v[0]==='#'||tag!=='a'&&(!v||tag!=='use'&&/^data:image\//i.test(v));
    if(name==='to'||name==='from'||name==='by'||name==='values')return!/(^|;)[a-z][a-z0-9+.-]*:/i.test(v);
    return name!=='attributename'||!/^on/i.test(v)}
  // These leave SVG for HTML, or act on the page.
  const BAD_TAGS=new Set('script foreignobject iframe object embed link base b big blockquote body br center code dd div dl dt em h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var'.split(' '));
  function tagsSafe(svg){const t=tokens(svg);if(!t)return false;const open=[];
    for(let k=0;k<t.length;k++){const{name:n,close,self,attrs}=t[k];
      // an end tag with nothing to close here would close the app's own markup, and what follows it is HTML
      if(close){const o=open.lastIndexOf(n);if(o<0)return false;open.length=o;continue}
      if(BAD_TAGS.has(n)||n==='font'&&attrs.some(a=>/^(color|face|size)$/.test(a.name)))return false;
      for(const a of attrs)if(!attrSafe(n,a.name,a.value))return false;
      if(self)continue;
      // inside these the parser reads HTML: words only
      if((n==='title'||n==='desc')&&!(t[k+1]?.close&&t[k+1].name===n))return false;
      open.push(n)}
    return true}
  // What the browser's own parser makes of it, where there is one: all of it SVG, inside one root.
  function parsedSafe(svg){if(typeof document==='undefined'||!document.createElement)return true;const t=document.createElement('template');t.innerHTML=`<svg>${svg}</svg>`;if(t.content.childNodes.length!==1)return false;
    for(const e of t.content.firstChild.querySelectorAll('*')){if(e.namespaceURI!=='http://www.w3.org/2000/svg')return false;for(const a of e.attributes)if(!attrSafe(e.localName.toLowerCase(),a.name.toLowerCase(),a.value))return false}return true}
  function isSafeMarkup(svg){return typeof svg==='string'&&!/<\s*(script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|javascript:/i.test(svg)&&tagsSafe(svg)&&parsedSafe(svg)}
  function cleanStyle(css){return String(css||'').replace(/@import[^;]+;?/gi,'').replace(/url\(\s*['"]?(?!#)[^)]*\)/gi,'none').replace(/expression\s*\(/gi,'')}
  // ---------- <style> in a stencil ----------
  // A style element reaches the whole page, so only plain class rules stay, and their classes get a prefix made from the rules themselves, in the CSS and on the art.
  // Scoping scoped art changes nothing (a block whose prefix matches its rules is left as it is), so art keeps its hash, and art made of several stencils keeps each one's classes. No style, no change.
  const SCOPED=/^ps([0-9a-z]+)-(.+)$/,CLASS_RULE=/^\.[\w-]+(?:\s*\.[\w-]+)*$/;
  function cssRules(text){let t=cleanStyle(decode(text.replace(/<!\[CDATA\[|\]\]>|<!--[\s\S]*?-->/g,'')).replace(/\/\*[\s\S]*?(\*\/|$)/g,''));for(let p;p!==t;){p=t;t=t.replace(/@[^{};]*(;|\{(?:[^{}]|\{[^{}]*\})*\})/g,'')}
    const out=[];for(const m of t.matchAll(/([^{}]*)\{([^{}]*)\}/g)){const sel=m[1].split(',').map(x=>x.trim().replace(/\s+/g,' ')).filter(x=>CLASS_RULE.test(x)),decl=m[2].trim();if(sel.length&&decl&&!/[<&\\@]|image-set/i.test(decl))out.push({sel,decl})}return out}
  const cssText=(rules,f)=>rules.map(r=>r.sel.map(s=>s.replace(/\.([\w-]+)/g,(m,c)=>'.'+f(c))).join(',')+'{'+r.decl+'}').join('');
  function scopedBy(rules){const hs=new Set();for(const r of rules)for(const s of r.sel)for(const m of s.matchAll(/\.([\w-]+)/g)){const x=SCOPED.exec(m[1]);if(!x)return null;hs.add(x[1])}if(hs.size!==1)return null;const h=[...hs][0];return hash(cssText(rules,c=>SCOPED.exec(c)[2]))===h?h:null}
  function scopeStyle(svg){if(typeof svg!=='string'||!/<style/i.test(svg))return svg;const t=tokens(svg);if(!t)return svg;const blocks=[];
    for(let k=0;k<t.length;k++){const a=t[k];if(a.close||a.name!=='style')continue;let e=k;if(!a.self)for(e=k+1;e<t.length&&!(t[e].close&&t[e].name==='style');)e++;const shut=a.self||e<t.length,end=a.self?a.end:shut?t[e].end:svg.length;blocks.push({at:a.at,end,rules:cssRules(a.self?'':svg.slice(a.end,shut?t[e].at:svg.length))});k=e}
    const known=new Set();for(const b of blocks){b.h=scopedBy(b.rules);if(b.h)known.add(b.h)}
    const raw=blocks.filter(b=>!b.h),rules=raw.flatMap(b=>b.rules),P=rules.length?hash(cssText(rules,c=>c)):null,keep=c=>{const x=SCOPED.exec(c);return!!x&&known.has(x[1])},edits=[];
    blocks.forEach(b=>{const r=b.h?b.rules:b===raw[0]?rules:[],css=b.h?cssText(r,c=>c):cssText(r,c=>'ps'+P+'-'+c);edits.push({at:b.at,end:b.end,text:css?`<style>${css}</style>`:''})});
    if(P)for(const k of t){if(k.close||blocks.some(b=>k.at>=b.at&&k.at<b.end))continue;for(const a of k.attrs)if(a.name==='class')edits.push({at:a.from,end:a.to,text:`class="${decode(a.value).trim().split(/\s+/).filter(Boolean).map(c=>keep(c)?c:'ps'+P+'-'+c).join(' ').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')}"`})}
    edits.sort((a,b)=>a.at-b.at);let out='',p=0;for(const e of edits){out+=svg.slice(p,e.at)+e.text;p=e.end}return out+svg.slice(p)}
  // ---------- what a stencil must be, wherever it comes from ----------
  const okId=id=>typeof id==='string'&&/^(?!__proto__$)[\w:.-]+$/.test(id);
  // What scoping leaves is what reaches the page, so that is what gets checked. Art that scoping would change again had a tag put together by taking a style out (<<style></style>style>…).
  const safeArt=svg=>{const out=scopeStyle(svg);return scopeStyle(out)===out&&isSafeMarkup(out)?out:null};
  // exactly four finite numbers, in one spelling
  function normVb(vb){if(typeof vb!=='string')return null;const a=vb.trim().split(/[\s,]+/).map(Number);return a.length===4&&a.every(x=>Number.isFinite(x))?a.join(' '):null}
  // a size a drawing can hold, or 0
  const sizeOf=v=>(typeof v==='number'||typeof v==='string'&&v.trim())&&+v>0&&+v<1e7?+v:0;
  // A picture whose base64 padding reads as on…= isn't an attack: pad its bytes instead, as the importer does.
  function repadded(svg){try{return Visio.repad(svg)}catch{return svg}}
  // The stencil as it may be registered, or null. Nothing here trusts its input: the size and the viewBox end up in markup as they stand. A size that is left out comes from the viewBox.
  function cleanDef(s){if(!s||typeof s!=='object'||s.name!=null&&typeof s.name!=='string'||typeof s.svg!=='string')return null;const vb=normVb(s.vb),svg=vb&&(safeArt(s.svg)??safeArt(repadded(s.svg)));if(!vb||svg==null)return null;
    let w=sizeOf(s.w),h=sizeOf(s.h);if(s.w!=null&&!w||s.h!=null&&!h)return null;if(!w||!h){const q=stencilFrom('',vb,'');w||=q.w||64;h||=q.h||64}
    const d={...s,vb,w,h,svg},r=s.rackUnit;if(r!=null){if(typeof r!=='object')delete d.rackUnit;else{const f=r.fromDef;d.rackUnit={...r,fromDef:f&&typeof f==='object'?{...f,vb:normVb(f.vb)||undefined,w:sizeOf(f.w)||undefined,h:sizeOf(f.h)||undefined}:undefined}}}return d}
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
    markup=safeArt(markup);if(markup==null)throw Error('SVG contains unsupported content.');
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
    if(files.length===1&&lower.endsWith('.json')){const d=JSON.parse(await first.text());if(!d?.portPack||!d.pack||!d.pack.shapes||typeof d.pack.shapes!=='object')throw Error('Not a Port shape pack.');d.pack.id='u-'+hash(d.pack.name+Date.now());if(d.pack.source==='user')d.pack.source='import';const old=Object.entries(d.pack.shapes);d.pack.shapes={};const remap=Object.create(null);let skipped=0;d.pack.categories=(Array.isArray(d.pack.categories)&&d.pack.categories.length?d.pack.categories:[{name:d.pack.name}]).map(c=>{const id='pack:'+d.pack.id+':'+slug(c?.name);remap[c?.id]=id;return{id,name:String(c?.name??d.pack.name)}});for(const[sid,s]of old){const def=okId(sid)&&cleanDef(s);if(!def){skipped++;continue}d.pack.shapes[sid.startsWith('u-')?sid:'u-'+hash(d.pack.id+sid)]={...def,cat:remap[s.cat]||d.pack.categories[0].id}}return{pack:d.pack,skipped}}
    if(files.length===1&&(lower.endsWith('.xml')||lower.endsWith('.drawio')))return fromDrawioLibrary(await first.text(),packName||first.name.replace(/\.[^.]+$/,''));
    const entries=[];for(const f of files){const n=f.name.toLowerCase();if(n.endsWith('.zip'))entries.push(...await unzip(f));else entries.push({path:f.webkitRelativePath||f.name,blob:f})}
    if(!entries.length)throw Error('No SVG or image files found.');return fromFiles(entries,packName)}
  const whyRefused=err=>err?.message||err?.name||'it may be full or blocked';
  // My shapes says for itself what happened: these leave the change in place for this session and throw, marked err.session.
  const refused=err=>{throw Object.assign(Error(whyRefused(err)),{session:true})};
  async function storePack(pack){if(!install(pack))return;try{await Store.put('packs',pack)}catch(err){refused(err)}if(pack.id===USER)unsaved.clear()}
  async function unstorePack(id){uninstall(id);try{await Store.del('packs',id)}catch(err){refused(err)}}
  async function save(pack){try{await storePack(pack)}catch(err){notify('Pack installed for this session, but browser storage refused it: '+err.message)}}
  async function remove(id){try{await unstorePack(id)}catch(err){notify('Removed for this session, but browser storage refused it, so it comes back after a reload: '+err.message)}}
  async function loadAll(){if(typeof ExtendedPack!=='undefined')install(ExtendedPack);try{for(const p of await Store.all('packs'))install(p)}catch(err){console.warn('packs not loaded',err)}}
  function exportPack(id){const p=packs.get(id);if(!p)return;download(slug(p.name)+'.portpack.json',JSON.stringify({portPack:1,pack:p}),'application/json')}

  // ---------- My shapes: art kept from drawings ----------
  const USER='my-shapes',USER_CAT='pack:'+USER,artKey=svg=>hash(noStroke(svg||''));
  let userQueue=Promise.resolve();const inOrder=f=>{const r=userQueue.then(f,f);userQueue=r.catch(()=>{});return r};
  // the stored copy wins, so what another tab added or removed isn't undone; only what storage refused this session is ours to add to it
  const unsaved=new Set();
  async function userPack(){let p=null;try{p=await Store.get('packs',USER)}catch{}const mine=packs.get(USER);if(p)for(const id of unsaved)if(mine?.shapes?.[id])p.shapes[id]=mine.shapes[id];return p||mine||{id:USER,name:'My shapes',source:'user',created:new Date().toISOString(),categories:[{id:USER_CAT,name:'My shapes'}],shapes:{}}}
  // def: {name,vb,svg,w,h,recolor,tags,source,license,visio}. Same art = same shape; a derived rack type (rkc-) never goes in a pack.
  function userDef(pack,d){if(!d||d.rackUnit||/^rkc-/.test(d.id||''))return{id:null,refused:'rack'};const vb=normVb(d.vb),[,,vw,vh]=(vb||'').split(' ').map(Number),svg=safeArt(d.svg);if(!(vw>0&&vh>0)||svg==null)return{id:null,refused:'markup'};
    // kept before styles were scoped, under the hash it had then
    if(svg!==d.svg||/<style/i.test(svg))for(const[k,v]of Object.entries(pack.shapes))if(noStroke(scopeStyle(v?.svg))===noStroke(svg))return{id:k,added:false,name:v.name};
    let id='ms-'+artKey(svg);while(pack.shapes[id]&&noStroke(pack.shapes[id].svg)!==noStroke(svg))id+='x';if(pack.shapes[id])return{id,added:false,name:pack.shapes[id].name};
    const name=String(d.name||'').trim()||'Shape',st=stencilFrom(name,vb,svg,{cat:USER_CAT,tags:d.tags||'',source:d.source||'',license:d.license||'',recolor:d.recolor!==false}),w=sizeOf(d.w),h=sizeOf(d.h);if(w&&h){st.w=Math.max(4,Math.round(w));st.h=Math.max(4,Math.round(h))}if(d.visio)st.visio=true;pack.shapes[id]=st;return{id,added:true,name}}
  function addShapes(defs){return inOrder(async()=>{const pack=await userPack(),out=defs.map(d=>userDef(pack,d));if(out.some(r=>r.added))try{await storePack(pack)}catch(err){for(const r of out)if(r.added)unsaved.add(r.id);throw err}else install(pack);return out})}
  const addShape=def=>addShapes([def]).then(r=>r[0]);
  function renameShape(id,name){return inOrder(async()=>{const pack=await userPack(),s=pack.shapes[id];name=String(name||'').trim();if(!s||!name)return false;s.name=name;s.tags=((s.tags||'')+' '+name).toLowerCase();await storePack(pack);return true})}
  // As uninstall does: a shape the drawing (or its undo history) still uses stays, under "Shapes in this drawing".
  function removeShape(id){return inOrder(async()=>{const pack=await userPack();if(!pack.shapes[id])return null;delete pack.shapes[id];unsaved.delete(id);const key=`"type":"${id}"`,kept=usedTypes().has(id)||[...(S.history||[]),...(S.future||[])].some(h=>h.includes(key));
    if(!kept)delete Stencils.shapes[id];else if(Stencils.shapes[id])Object.assign(Stencils.shapes[id],{cat:'doc-shapes',pack:'doc'});packs.set(USER,pack);const done=()=>{ensureDocCategory();iconCache?.clear?.()};try{if(Object.keys(pack.shapes).length)await storePack(pack);else await unstorePack(USER)}catch(err){done();throw err}done();return{kept}})}

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

  return{install,uninstall,list,stencilsFor,embedUsed,installDoc,registerRack,rackType,rememberRack,restoreSource,hash,noStroke,artKey,ensureDocCategory,USER,USER_CAT,addShape,addShapes,renameShape,removeShape,sanitizeSvg,isSafeMarkup,scopeStyle,normVb,importAny,unzip,stencilFrom,save,remove,loadAll,exportPack,search,loadIcons,iconPreview,getCollections,addOnline,thumbUrl,SETS,get:id=>packs.get(id)};
})();
