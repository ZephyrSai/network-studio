// Shapes from the drawing: art of a node or a selection as a stencil definition (My shapes), and the rack height a picture suggests.
const ShapeKit=(()=>{
  const MAX_ART=8e6,PRE='msart_';
  // Rack size from a picture's size. Vendor Visio masters are true scale in inches (some 1:10); anything else goes by its aspect.
  function rackHint(wIn,hIn,isVisio){const w=+wIn,h=+hIn,clampU=u=>Math.max(1,Math.min(48,u));if(!(w>0&&h>0))return{u:1,frac:1,plate:true};const a=w/h;let s=0;
    if(isVisio){if(w>=5)s=1;else if(a>=2.5&&w*10>=5&&w*10<=20)s=10}
    let u,frac=1;if(s){u=clampU(Math.round(h*s/1.75));frac=Math.min(1,w*s/19)}else if(a>=2.5)u=clampU(Math.round(10.86/a));else return{u:1,frac:1,plate:true};
    const fit=a/(10.86/u);return{u,frac,plate:frac<.9||fit<.5||fit>2}}

  // ---------- art ----------
  const cleanName=(t,or='Shape')=>String(t||'').replace(/\s+/g,' ').trim().slice(0,80)||or,attr=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  // base64 '=' can read as on…= to the markup filter: pad the bytes instead (image decoders ignore trailing bytes, XML trailing spaces)
  const repad=svg=>Visio.repad(svg).replace(/(data:image\/svg\+xml;base64,)([A-Za-z0-9+/]+)(=+)/g,(m,h,b,p)=>{const bin=atob(b+p);return h+btoa(bin+' '.repeat((3-bin.length%3)%3))});
  function checked(a){if(!Packs.isSafeMarkup(a.svg))throw Error('This shape holds content that can’t be kept as a shape.');if(a.svg.length>MAX_ART)throw Error('This is too large to keep as one shape. Add fewer shapes at once.');return a}
  function stencilArt(n){const s=Stencils.shapes[n.type],from=s.rackUnit?.fromDef;
    // built-in icons are drawn in the outline drawNode gives them: say so here, a pack would otherwise take the outline away
    return{vb:Packs.normVb(from?.vb)||s.vb,svg:s.pack?s.svg:`<g stroke="currentColor">${s.svg}</g>`,recolor:s.recolor!==false,w:from?.w||n.w||s.w,h:from?.h||n.h||s.h,tags:s.tags||'',source:s.source||'',license:s.license||'',visio:/^vs-/.test(n.type)||!!s.visio}}
  // the same picture at any size is the same art
  function imageArt(n){if(!Core.IMAGE_RE.test(n.image))throw Error('Only embedded images can be kept as shapes.');const H=+(100*n.h/n.w).toFixed(1);return{vb:`0 0 100 ${H}`,svg:repad(`<image href="${attr(n.image)}" x="0" y="0" width="100" height="${H}" preserveAspectRatio="xMidYMid meet"/>`),recolor:false,w:n.w,h:n.h,tags:'image'}}
  // Anything else draws through the app's own renderer, rebased to the origin so its place on the page doesn't change the markup.
  function sceneArt(list){const copies=Core.copy(list),single=copies.length===1&&copies[0].kind==='node',r3=v=>Math.round(v*1e3)/1e3;
    for(const n of copies){if(n.data?.status)delete n.data.status}
    if(single){const n=copies[0];delete n.flipX;delete n.flipY;n.rotation=0;n.labels=[];n.data={}}
    const b=Core.bounds(copies,!single);for(const n of copies){Core.move(n,-b.x,-b.y);if(n.kind!=='edge'){n.x=r3(n.x);n.y=r3(n.y)}else n.points=n.points.map(p=>[r3(p[0]),r3(p[1])]);for(const l of n.labels||[])if(!l.anchor){l.x=r3(l.x);l.y=r3(l.y)}}
    const doc={...S.doc,layers:S.doc.layers.map(l=>({...l,visible:true,print:true})),display:{...S.doc.display,colorBy:'',...(single?{fields:[]}:{})}},root=sceneSvg({...pg(),items:copies,background:null},{doc,print:false,pad:2,area:{x:0,y:0,w:b.w,h:b.h},prefix:PRE});
    root.firstElementChild.remove();const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);for(let t=walk.nextNode();t;t=walk.nextNode())t.data=t.data.replace(/=/g,'').replace(/:/g,'');
    const ser=new XMLSerializer();let svg=[...root.childNodes].map(c=>ser.serializeToString(c)).join('').replace(/\s+xmlns(:\w+)?="[^"]*"/g,'').replace(//g,'&#61;').replace(//g,'&#58;');
    // paint as a standalone SVG does, whatever the wrapper around a stencil sets
    svg=repad(`<g fill="#000" stroke="none" color="#000" stroke-width="1" stroke-linecap="butt" stroke-linejoin="miter">${svg}</g>`);svg=svg.split(PRE).join('m'+Packs.hash(svg)+'_');
    // the viewBox has the renderer's 2 px padding on each side: the size must too, or the art comes back smaller
    return{vb:root.getAttribute('viewBox'),svg,recolor:false,w:b.w+4,h:b.h+4,tags:''}}
  // target: one item (without its label; rotation and flips don't count) or several, with labels, as they stand. → {vb,svg,recolor,name,w,h,tags,visio…}
  function artOf(target,{name}={}){const list=Array.isArray(target)?target:[target],n=list[0];if(!n)throw Error('Select a shape first.');
    if(list.length>1)return checked({...sceneArt(list),name:cleanName(name,'Custom shape')});const a=n.kind==='node'&&n.image?imageArt(n):n.kind==='node'&&Stencils.shapes[n.type]?stencilArt(n):sceneArt([n]);return checked({...a,name:cleanName(name||Analysis.nameOf(n))})}
  // What a selection draws: its members, what they carry, and nothing on a hidden layer; a single node stands for itself.
  function artFor(sel){const ids=sel.map(n=>n.id),set=new Set([...moveSet(ids),...sel].map(n=>n.id)),vis=items().filter(n=>set.has(n.id)&&itemVisible(n,{doc:S.doc})),list=vis.length?vis:sel,parts=list.filter(n=>n.kind!=='edge');
    if(sel.length===1&&parts.length<=1)return artOf(sel[0]);if(list.length===1)return artOf(list[0]);return artOf(list,{name:parts[0]&&Analysis.nameOf(parts[0])})}

  // ---------- rack form ----------
  // What a stencil really draws, in its own units (Visio: inches). Its viewBox, cut to the art; the art alone when the viewBox says nothing (Dell masters report Height .001). Stray lines outside don't count.
  const sized=new Map(),fix=v=>+v.toFixed(4);
  function sizeOf(type){let m=sized.get(type);if(m)return m;const s=Stencils.shapes[type],[x,y,w,h]=s.vb.split(/[\s,]+/).map(Number),g=typeof glyphFrac==='function'?glyphFrac(type,0):null,k=Math.max(w,h);m={x,y,w,h};
    if(g){if(!(w>0&&h>0)||Math.min(w,h)-.0566*k<.005*k)m={x:g.x,y:g.y,w:g.w,h:g.h};else{const x0=Math.max(x,g.x),y0=Math.max(y,g.y),x1=Math.min(x+w,g.x+g.w),y1=Math.min(y+h,g.y+g.h);if(x1-x0>k*.01&&y1-y0>k*.01)m={x:x0,y:y0,w:x1-x0,h:y1-y0}}}
    m.key='rkc-'+Packs.artKey(s.pack?s.svg:`<g stroke="currentColor">${s.svg}</g>`);sized.set(type,m);return m}
  const rackKey=n=>n.image?'image:'+Packs.hash(n.image):n.type;
  // The rack size a shape suggests, measured lazily, so stencils imported earlier benefit too. A height remembered for the shape (this browser, or carried by its type in the document) wins.
  function hintOf(n){const s=!n.image&&Stencils.shapes[n.type],m=s&&sizeOf(n.type),h=s?rackHint(m.w,m.h,/^vs-/.test(n.type)||!!s.visio):rackHint(n.w,n.h,false),carried=()=>{try{return+Stencils.shapes['rkc-'+Packs.artKey(artOf(n,{name:'Shape'}).svg)]?.rackUnit?.u}catch{return 0}},own=+S.prefs?.rackU?.[rackKey(n)]||(m?+Stencils.shapes[m.key]?.rackUnit?.u:carried())||0;return own?{...h,u:Math.max(1,Math.min(48,Math.round(own)))}:h}
  // The derived type showing this shape's own picture; registered only when something is about to use it.
  function rackTypeOf(n){const s=!n.image&&Stencils.shapes[n.type];if(s?.rackUnit)return n.type;const a=artOf(n,{name:'Shape'}),m=s&&sizeOf(n.type),hint=hintOf(n),name=s?.name||(n.image?'Image':Shapes.nameOf(n.type)),id=Packs.rackType({name,vb:m?[m.x,m.y,m.w,m.h].map(fix).join(' '):a.vb,svg:a.svg,u:hint.u,frac:hint.frac,from:n.type,tags:s?.tags||'',fromDef:{vb:s?.vb||a.vb,w:s?.w||n.w,h:s?.h||n.h,name:s?.name||name,tags:s?.tags||''}});if(!id)throw Error('This shape can’t be drawn as rack equipment.');return id}

  // A picture often carries an empty margin the geometry can't show: the 3% a stencil import adds, or blank space inside a metafile. Measured once per type from the painted pixels, so a unit
  // really reaches the rails, drawings saved earlier too. It only changes the rack type's viewBox, which travels with the file. Left as it is if the browser won't let us read the pixels.
  const trimmed=new Set(),trimQ=[];let trimming=false;
  function trimLater(type){if(trimmed.has(type)||typeof document==='undefined'||typeof Image==='undefined')return;trimmed.add(type);if(!Stencils.shapes[type]?.rackUnit)return;trimQ.push(type);if(!trimming)pumpTrim()}
  async function pumpTrim(){trimming=true;let any=false;while(trimQ.length){const t=trimQ.shift();try{if(await trimType(t))any=true}catch{}}trimming=false;if(any&&typeof render==='function')render()}
  // the box of what's painted: blank is transparent, or white up to the first real mark in from each side
  function paintBox(d,W,H,isBlank){let x0=W,y0=H,x1=-1,y1=-1;for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=(y*W+x)*4;if(isBlank(d[k],d[k+1],d[k+2],d[k+3]))continue;if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return x1<0?null:{x0,y0,x1:x1+1,y1:y1+1}}
  function trimBox(d,W,H){const clear=(r,g,b,a)=>a<24,white=(r,g,b,a)=>a<24||r>=248&&g>=248&&b>=248,ok=(q,min)=>q&&(q.x1-q.x0)/W>=min&&(q.y1-q.y0)/H>=min,w=paintBox(d,W,H,white);if(ok(w,.7))return w;const c=paintBox(d,W,H,clear);return ok(c,.5)?c:null}
  async function trimType(type){const s=Stencils.shapes[type];if(!s?.rackUnit)return false;const[vx,vy,vw,vh]=s.vb.split(/[\s,]+/).map(Number);if(!(vw>0&&vh>0))return false;const a=vw/vh,W=Math.max(16,Math.round(a>=1?1200:1200*a)),H=Math.max(16,Math.round(a>=1?1200/a:1200));
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vx} ${vy} ${vw} ${vh}" width="${W}" height="${H}" preserveAspectRatio="none"><g fill="#ffffff" stroke="#475569" color="#475569" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.svg}</g></svg>`;
    const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0,W,H);const q=trimBox(g.getImageData(0,0,W,H).data,W,H);if(!q)return false;
    const fx=(q.x1-q.x0)/W,fy=(q.y1-q.y0)/H;if(fx>.995&&fy>.995)return false;s.rackUnit.vb0??=s.vb;s.vb=[vx+q.x0/W*vw,vy+q.y0/H*vh,vw*fx,vh*fy].map(fix).join(' ');return true}

  // ---------- adding ----------
  function reveal(){S.prefs.catOpen??={};S.prefs.catOpen[Packs.USER_CAT]=true;savePrefs();S.ltab='shapes';const q=$('search');if(q?.value)q.value='';renderLeft();document.querySelector(`[data-cat="${Packs.USER_CAT}"]`)?.scrollIntoView?.({block:'nearest'})}
  const WHERE='My shapes (Shapes panel, on the left)',SESSION=(what,err)=>`${what} for this session only: browser storage refused it (${err.message}), so that’s undone after a reload.`;
  function told(r){const ok=r.filter(x=>x.id),a=ok.filter(x=>x.added),dup=ok.length-a.length;if(ok.length===1)return a.length?`“${a[0].name}” added to ${WHERE}.`:`“${ok[0].name}” is already in My shapes.`;if(!a.length)return`All ${dup} are already in My shapes.`;return`${a.length} shapes added to ${WHERE}${dup?`; ${dup} ${dup===1?'was':'were'} already there`:''}.`}
  async function commit(defs){try{const r=await Packs.addShapes(defs);if(!r.some(x=>x.id))return notify('These can’t be kept as shapes.',5000);reveal();notify(told(r),5000);return r}catch(err){if(!err.session)return notify('Could not add to My shapes: '+err.message,6000);reveal();notify(SESSION('Added',err),8000)}}
  // preview: the stencil as drawNode wraps it
  function preview(a,maxW=480,maxH=140){const[vx,vy,vw,vh]=String(a.vb).split(/[\s,]+/).map(Number),k=Math.min(maxW/vw,maxH/vh);return`<svg viewBox="${vx} ${vy} ${vw} ${vh}" width="${Math.max(1,Math.round(vw*k))}" height="${Math.max(1,Math.round(vh*k))}" preserveAspectRatio="xMidYMid meet" overflow="visible"><g fill="#ffffff" stroke="currentColor" color="#2f5ea8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${a.svg}</g></svg>`}
  function openAdd(){const sel=picked();if(!sel.length)return notify('Select a shape first.');const parts=sel.filter(n=>n.kind!=='edge'),many=parts.length>1;let whole,each=null,mode='one';try{whole=artFor(sel)}catch(err){return notify(err.message,5000)}
    const HINT={one:'It stays in this browser, and drawings that use it carry a copy.',each:'Each takes its name from its label or shape name. Right-click one in the palette to rename it.'};
    const d=openDialog('Add to My shapes',`<div class="shapePrev" id="skPrev">${preview(whole)}</div>${many?`<div class="seg"><button data-sk-mode="one" class="active">One shape</button><button data-sk-mode="each">${parts.length} separate shapes</button></div>`:''}<label class="fld" id="skNameFld"><span>Name</span><input id="skName" maxlength="80" value="${html(whole.name)}"></label><p class="muted" id="skHint">${HINT.one}</p><footer><button data-close>Cancel</button><button class="primary" data-sk-add>Add to My shapes</button></footer>`);
    const add=async()=>{const defs=mode==='each'?each:[{...whole,name:$('skName').value.trim()||whole.name}];closeDialog();await commit(defs)};
    const name=$('skName');name.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();add()}};name.focus();name.select();
    d.onclick=e=>{const t=e.target;if(t.closest('[data-close]'))return closeDialog();if(t.closest('[data-sk-add]'))return add();const m=t.closest('[data-sk-mode]');if(!m||m.dataset.skMode===mode)return;mode=m.dataset.skMode;d.querySelectorAll('[data-sk-mode]').forEach(b=>b.classList.toggle('active',b===m));
      if(mode==='each'&&!each)each=parts.flatMap(n=>{try{return[artFor([n])]}catch{return[]}});$('skNameFld').hidden=mode==='each';$('skHint').textContent=HINT[mode];const p=$('skPrev');p.classList.toggle('grid',mode==='each');
      p.innerHTML=mode==='one'?preview(whole):each.slice(0,12).map(a=>`<figure>${preview(a,110,48)}<figcaption>${html(a.name)}</figcaption></figure>`).join('')+(each.length>12?`<figure class="more">+${each.length-12} more</figure>`:'')}}
  function keepAll(){const all=Object.entries(Stencils.shapes).filter(([,s])=>s.cat==='doc-shapes'&&!s.rackUnit);if(!all.length)return notify('No shapes from this drawing to keep.');const nodes=S.doc.pages.flatMap(p=>p.items).filter(n=>n.kind==='node');
    return commit(all.map(([t,s])=>{const n=s.name==='Visio shape'&&nodes.find(x=>x.type===t&&x.labels?.[0]?.text);return{...stencilArt({type:t,w:s.w,h:s.h}),name:n?cleanName(Analysis.nameOf(n)):s.name}}))}

  // ---------- palette menu ----------
  function paletteItems(t){if(t.startsWith('ann:')||t==='rack'||/^rack\d+$/.test(t)||Shapes.rackItems[t])return'';const s=Stencils.shapes[t];const rack=s&&!S.reviewMode?'<button data-pm="rack">Make rack equipment…</button>':'';if(s?.pack===Packs.USER)return'<button data-pm="rename">Rename…</button>'+rack+'<button data-pm="remove">Remove from My shapes</button>';return s||Shapes.basic[t]?'<button data-pm="add">Add to My shapes</button>'+rack:''}
  function paletteMenu(t,e){const h=paletteItems(t),m=$('contextMenu');if(!h)return hideMenus();m.innerHTML=h;showMenu(m,e.clientX,e.clientY);
    m.onclick=async ev=>{const c=ev.target.closest('[data-pm]')?.dataset.pm;if(!c)return;hideMenus();const s=Stencils.shapes[t];
      if(c==='rack')return actions.makeRack({type:t});
      if(c==='add'){let a;try{a=artOf(s?{kind:'node',type:t}:Shapes.make(t,0,0,''))}catch(err){return notify(err.message,5000)}if(s)a.w=s.w,a.h=s.h;return commit([a])}
      if(c==='rename'){const v=prompt('Shape name',s.name);if(!v?.trim()||v.trim()===s.name)return;try{await Packs.renameShape(t,v)}catch(err){renderPalette();return notify(SESSION('Renamed',err),8000)}renderPalette();return notify(`Renamed to “${v.trim()}”.`)}
      if(!confirm(`Remove “${s.name}” from My shapes?`))return;let r;try{r=await Packs.removeShape(t)}catch(err){renderPalette();return notify(SESSION('Removed',err),8000)}renderPalette();notify(r?.kept?`Removed from My shapes. It stays under “Shapes in this drawing” while the drawing uses it.`:`“${s.name}” removed from My shapes.`,5000)}}

  return{rackHint,artOf,artFor,preview,openAdd,keepAll,paletteMenu,paletteItems,sizeOf,hintOf,rackKey,rackTypeOf,trimLater,trimBox};
})();
if(typeof module!=='undefined')module.exports=ShapeKit;
