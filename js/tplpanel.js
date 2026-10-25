// Templates panel: drag a template, a drawing saved in this browser, one of their pages or a zone block onto the
// page to add it to the open drawing. Also the "Add to this drawing" options dialog and "Save as template".
const TplLib=(()=>{
const KEY='userTemplates',built=new Map(),cache=new Map(),files=new Map();
let user=[],drawings=[],dragging=null,loaded=false;
const DEF={place:'right',legend:'auto',layers:'keep',avoidClash:true,uniqueHosts:true,wrap:false,group:false};
const prefs=()=>({...DEF,...S.prefs.tplInsert});
const kindOf=key=>key.slice(0,1),idOf=key=>key.slice(2);

async function load(){try{user=(await Store.kvGet(KEY))||[]}catch{user=[]}
  try{drawings=(await Store.all('drawings')).filter(r=>r.id!==S.docId).sort((a,b)=>String(b.modified).localeCompare(String(a.modified))).map(({doc,...r})=>r)}catch{drawings=[]}loaded=true}
const saveUser=()=>Store.kvSet(KEY,user).catch(err=>notify('Could not save templates in this browser: '+err.message));

function meta(key){const k=kindOf(key),id=idOf(key);
  if(k==='b'){const t=Templates.list().find(x=>x.id===id);return t&&{name:t.name,description:t.description}}
  if(k==='u'){const t=user.find(x=>x.id===id);return t&&{name:t.name,description:t.description||''}}
  if(k==='f'){const f=files.get(id);return f&&{name:f.name,description:'Dropped file'}}
  const r=drawings.find(x=>x.id===id);return r&&{name:r.name,description:`Saved ${new Date(r.modified).toLocaleDateString()}`}}
// Source documents are only read, never changed: Merge copies what it inserts.
function docNow(key){const k=kindOf(key),id=idOf(key);
  if(k==='b'){if(!built.has(id))built.set(id,Templates.build(id));return built.get(id)}
  if(k==='u'){if(!cache.has(key)){const t=user.find(x=>x.id===id);if(!t)return null;cache.set(key,C.migrate(C.copy(t.doc)))}return cache.get(key)}
  if(k==='f')return files.get(id)?.doc||null;
  return cache.get(key)||null}
async function docOf(key){const d=docNow(key);if(d||kindOf(key)!=='d')return d;const r=await Store.get('drawings',idOf(key)).catch(()=>null);if(!r)return null;const doc=C.migrate(r.doc);cache.set(key,doc);return doc}
const stat=doc=>{const ps=Merge.parts(doc),dev=ps.reduce((s,p)=>s+p.devices,0);return`${ps.length} page${ps.length===1?'':'s'} · ${dev} device${dev===1?'':'s'}`};

// ---------- panel ----------
function render(){const pane=$('templatesPane');if(!pane||pane.hidden)return;
  if(!pane.firstChild)pane.innerHTML=`<input id="tplSearch" placeholder="Search templates and drawings…" autocomplete="off"><p class="hintTxt">Drag onto the page to add it to this drawing. Open a card's <b>Pages &amp; blocks</b> to drag just one page or zone.</p><div id="tplList"></div>`;
  if(!loaded){load().then(render);return}
  const q=($('tplSearch').value||'').toLowerCase().trim(),hit=m=>!q||(m.name+' '+m.description).toLowerCase().includes(q);
  const b=Templates.list().filter(hit).map(t=>card('b:'+t.id,t));
  const u=user.filter(t=>hit({name:t.name,description:t.description||''})).map(t=>card('u:'+t.id,{name:t.name,description:t.description||''},true));
  const d=drawings.filter(r=>hit({name:r.name,description:''})).slice(0,30).map(r=>card('d:'+r.id,{name:r.name,description:`${r.pages||1} page${r.pages===1?'':'s'} · saved ${new Date(r.modified).toLocaleDateString()}`},false,r.thumb));
  $('tplList').innerHTML=`<h4 class="tplHead">Built-in <em>${b.length}</em></h4>${b.join('')||'<p class="muted">No match.</p>'}
  <h4 class="tplHead">My templates <em>${user.length}</em></h4><div class="tplBtns"><button data-tpl-save title="Save this page, the selection or the whole drawing as a reusable template">＋ Save as template…</button><button data-tpl-import title="Import a template or a Port drawing (.json)">Import…</button></div>${u.join('')||`<p class="muted small">Save a page or a selection as a template to reuse it in any drawing — a standard branch, a camera cluster, a rack row.</p>`}
  <h4 class="tplHead">My drawings <em>${drawings.length}</em></h4>${d.join('')||'<p class="muted small">Other drawings saved in this browser show up here, ready to drop into this one.</p>'}`;
  thumbs()}
function card(key,m,mine=false,thumb=null){const doc=kindOf(key)==='d'?null:(kindOf(key)==='b'?built.get(idOf(key)):docNow(key));
  return`<div class="tcard" draggable="true" data-tsrc="${key}" title="Drag onto the page to add it to this drawing">
  <div class="tthumb" data-tthumb="${key}">${thumb?`<img alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumb)}">`:''}</div>
  <b>${html(m.name)}</b><span class="tmeta" data-tmeta="${key}">${html(doc?stat(doc):m.description)}</span>
  <div class="tact"><button data-tadd="${key}" title="Choose what to add and where">＋ Add…</button><button data-topen="${key}" title="Open as a new drawing">Open</button>${mine?`<button data-texport="${key}" title="Download this template (.json)">⤓</button><button data-tdel="${key}" title="Delete this template">×</button>`:''}</div>
  <details class="tparts" data-tparts="${key}"><summary>Pages &amp; blocks</summary><div class="tchips"></div></details></div>`}
let thumbJob=0;
function thumbs(){const job=++thumbJob,hosts=[...document.querySelectorAll('[data-tthumb]')].filter(h=>!h.firstChild);let i=0;
  const next=()=>{if(job!==thumbJob||i>=hosts.length)return;const h=hosts[i++],key=h.dataset.tthumb;
    if(kindOf(key)!=='d')try{const doc=docNow(key);if(doc){Packs.installDoc(doc);h.append(thumbnail(doc,doc.pages.find(p=>!p.isBackground)||doc.pages[0],220,120));const mt=document.querySelector(`[data-tmeta="${key}"]`);if(mt)mt.textContent=stat(doc)}}catch(err){console.warn('template thumbnail',err)}
    setTimeout(next,16)};setTimeout(next,0)}
async function fillParts(det){const box=det.querySelector('.tchips');if(box.childElementCount)return;box.innerHTML='<span class="muted small">Loading…</span>';const key=det.dataset.tparts,doc=await docOf(key);if(!doc){box.textContent='Not available.';return}
  const ps=Merge.parts(doc);box.innerHTML=(ps.length>1?`<button class="tchip all" draggable="true" data-tsrc="${key}" data-tall="1" title="Adds every page as new pages in this drawing">▦ All ${ps.length} pages as new pages</button>`:'')+
    ps.map(p=>`<button class="tchip" draggable="true" data-tsrc="${key}" data-tpage="${p.id}" title="Drag this page's content onto the page">▤ ${html(p.name)} <em>${p.devices}</em></button>`+p.blocks.map(b=>`<button class="tchip blk" draggable="true" data-tsrc="${key}" data-tpage="${p.id}" data-tblock="${b.id}" title="Drag this zone and everything in it">▢ ${html(b.name)} <em>${b.devices}</em></button>`).join('')).join('')}
const specOf=el=>({src:el.dataset.tsrc,page:el.dataset.tpage||null,block:el.dataset.tblock||null,all:!!el.dataset.tall});

// ---------- drag and drop ----------
function dragStart(e){const el=e.target.closest('[data-tsrc]');if(!el)return;const spec=specOf(el);dragging=spec;e.dataTransfer.setData('application/x-port-template',JSON.stringify(spec));e.dataTransfer.effectAllowed='copy';if(kindOf(spec.src)==='d')docOf(spec.src)}
function dragOver(e,p){if(!dragging)return false;const doc=docNow(dragging.src);let label=meta(dragging.src)?.name||'Template';
  const fp=doc&&!dragging.all?Merge.footprint(doc,dragging):null;if(dragging.all)label+=' — every page as new pages';else if(dragging.block&&doc)label=Merge.parts(doc).flatMap(x=>x.blocks).find(b=>b.id===dragging.block)?.name||label;
  // the insert hangs from the cursor (top-left corner at the drop point), like the page growing right and down
  S.dropGhost=fp?{x:p[0],y:p[1],w:fp.w,h:fp.h,label}:{x:p[0],y:p[1],w:120,h:60,label};render('overlay');return true}
function dragEnd(){dragging=null;if(S.dropGhost){S.dropGhost=null;render('overlay')}}
async function drop(spec,p){dragEnd();const o=prefs();if(spec.all)return add(spec,{...o,mode:'pages'});return add(spec,{...o,place:'at',at:p,anchor:'topleft'})}

// ---------- insert ----------
const zoneColors=()=>(Shapes.themes[S.doc.theme]||Shapes.themes.port).zones?.[0];
function summary(name,res,o){const r=res.report,its=res.items||res.pages.flatMap(p=>p.items),dev=its.filter(n=>n.kind==='node').length,links=its.filter(n=>n.kind==='edge').length,bits=[];
  bits.push(res.pages?`Added ${res.pages.length} page${res.pages.length===1?'':'s'} from “${name}”`:`Added “${name}” — ${dev} device${dev===1?'':'s'}, ${links} link${links===1?'':'s'}`);
  if(r.subnets.length)bits.push('moved '+r.subnets.map(([a,b])=>a+' → '+b).join(', ')+' to avoid clashes');
  if(r.readdressed)bits.push(`${r.readdressed} device${r.readdressed>1?'s':''} given free IP addresses`);
  if(r.hostnames)bits.push(`${r.hostnames} hostname${r.hostnames>1?'s':''} renamed to stay unique`);
  if(r.layers.length)bits.push('new layer'+(r.layers.length>1?'s ':' ')+r.layers.join(', '));if(r.vlans.length)bits.push('VLAN'+(r.vlans.length>1?'s ':' ')+r.vlans.join(', '));
  if(r.ipClashes)bits.push(`${r.ipClashes} device IP${r.ipClashes>1?'s are':' is'} already used (Analyze ▸ Check diagram)`);if(o.firstOnly)bits.push(`page 1 of ${o.firstOnly} — use ＋ Add… for the rest`);
  return bits.join(' · ')+'. Ctrl+Z undoes.'}
function newPageLike(cur,name){const p=C.page(name);for(const k of['paper','orientation','customW','customH','margin','bg','autoSize'])if(cur[k]!==undefined)p[k]=cur[k];if(cur.background)p.background=cur.background;return p}
function partName(src,spec,name){const ps=Merge.parts(src);if(spec.block){const b=ps.flatMap(p=>p.blocks).find(x=>x.id===spec.block);if(b)return`${b.name}” from “${name}`}if(spec.page&&ps.length>1){const p=ps.find(x=>x.id===spec.page);if(p)return`${p.name}” from “${name}`}return name}
async function add(spec,o){const src=await docOf(spec.src),tname=meta(spec.src)?.name||'Template';if(!src)return notify('That template is no longer available.');Packs.installDoc(src);
  if(narrowScreen()&&document.body.matches('.showLeft,.showRight')){document.body.classList.remove('showLeft','showRight');renderRibbon()}const name=partName(src,spec,tname);
  if(o.mode==='pages'){const res=mutate(()=>Merge.insertPages(S.doc,src,{after:S.pageIndex,page:spec.all?null:spec.page,avoidClash:o.avoidClash,uniqueHosts:o.uniqueHosts,prefix:o.prefix,layers:o.layers,activeLayer:S.activeLayer}));
    if(!res)return notify('That template has no drawing pages.');gotoPage(S.doc.pages.indexOf(res.pages[0]));notify(summary(tname,res,o),7000);return res}
  const pick=Merge.pick(src,spec);if(!pick.items.length)return notify('Nothing to add from “'+name+'”.');
  if(pg().isBackground&&o.place!=='newpage')return notify('This is a background page — switch to a drawing page first.');
  const pages=Merge.parts(src).length,firstOnly=!spec.page&&!spec.block&&pages>1&&o.place==='at'?pages:0;
  const res=mutate(()=>{let page=pg();if(o.place==='newpage'){const blk=spec.block&&Merge.parts(src).flatMap(x=>x.blocks).find(b=>b.id===spec.block);page=newPageLike(pg(),blk?.name||pick.page?.name||name);S.doc.pages.splice(S.pageIndex+1,0,page);S.pageIndex++;clearTransient()}
    const r=Merge.insert(S.doc,page,src,{...o,page:spec.page,block:spec.block,activeLayer:S.activeLayer,step:gridStep(),colors:zoneColors(),wrap:o.wrap?(o.wrapName||tname):''});
    if(r){for(const n of r.items)if(n.kind==='edge')Conn.markDirty(n.id);select(r.items.filter(n=>!n.pin).map(n=>n.id))}return r});
  if(!res)return notify('Nothing to add from “'+name+'”.');
  if(o.place!=='at')fit();notify(summary(name,res,{...o,firstOnly}),7000);return res}

// ---------- options dialog ----------
async function openAdd(spec){const src=await docOf(spec.src),m=meta(spec.src);if(!src)return notify('That template is no longer available.');Packs.installDoc(src);
  const ps=Merge.parts(src),o=prefs(),opt=(v,t,cur)=>`<option value="${v}" ${String(cur)===String(v)?'selected':''}>${t}</option>`;
  const what=spec.all?'all':spec.block?`b:${spec.page}:${spec.block}`:spec.page?`p:${spec.page}`:(ps[0]?`p:${ps[0].id}`:'all');
  const whatOpts=(ps.length>1?opt('all',`All ${ps.length} pages — as new pages`,what):'')+ps.map(p=>opt('p:'+p.id,`Page: ${html(p.name)} (${p.devices} devices)`,what)+p.blocks.map(b=>opt(`b:${p.id}:${b.id}`,`   Zone: ${html(b.name)} (${b.devices})`,what)).join('')).join('');
  const places=[['right','Beside the drawing →'],['below','Below the drawing ↓'],['center','Centre of the view'],['newpage','On a new page']];
  const d=openDialog(`Add “${html(m?.name||'Template')}” to this drawing`,`<div class="addGrid"><div class="tthumb big" id="addThumb"></div><div>
  <label class="fld"><span>What to add</span><select id="addWhat">${whatOpts}</select></label>
  <div class="fld" id="addWhere"><span>Where</span><div class="seg">${places.map(([v,t])=>`<button data-add-place="${v}" class="${o.place===v?'active':''}">${t}</button>`).join('')}</div></div>
  <div class="row"><label class="fld"><span>Legend</span><select data-add="legend">${opt('auto','Only if this page has none',o.legend)}${opt('yes','Always bring its legend',o.legend)}${opt('no','Never',o.legend)}</select></label>
  <label class="fld"><span>Layers</span><select data-add="layers">${opt('keep','Keep its layers (merge by name)',o.layers)}${opt('active','Put everything on the active layer',o.layers)}</select></label></div>
  <label class="check"><input type="checkbox" data-add="avoidClash" ${o.avoidClash?'checked':''}>Avoid IP clashes — move clashing subnets (device IPs and gateways follow) and give taken addresses the next free one</label>
  <label class="check"><input type="checkbox" data-add="uniqueHosts" ${o.uniqueHosts!==false?'checked':''}>Keep hostnames unique (adds -2, -3… to clashes; a name prefix also prefixes hostnames)</label>
  <div class="row"><label class="fld"><span>Name prefix (optional)</span><input data-add="prefix" placeholder="e.g. B2 – " value=""></label><span></span></div>
  <label class="check"><input type="checkbox" data-add="wrap" ${o.wrap?'checked':''}>Wrap it in a zone named <input data-add="wrapName" class="inline" value="${html(m?.name||'')}"></label>
  <label class="check"><input type="checkbox" data-add="group" ${o.group?'checked':''}>Group it so it moves as one block</label>
  <p class="fitResult" id="addResult"></p></div></div>
  <footer><button data-close>Cancel</button><button class="primary" data-add-go>Add to drawing</button></footer>`,{wide:true});
  let place=places.some(([v])=>v===o.place)?o.place:'right';
  const read=()=>{const r={place};d.querySelectorAll('[data-add]').forEach(i=>r[i.dataset.add]=i.type==='checkbox'?i.checked:i.value);const w=$('addWhat').value;
    const s=w==='all'?{src:spec.src,all:true}:w.startsWith('b:')?{src:spec.src,page:w.split(':')[1],block:w.split(':')[2]}:{src:spec.src,page:w.slice(2)};if(place==='center'){r.place='at';r.at=centerOfView();r.anchor='center'}return{r,s}};
  const preview=()=>{const{r,s}=read();$('addWhere').hidden=!!s.all;const host=$('addThumb');host.replaceChildren();
    try{if(s.all){const p=src.pages.find(x=>!x.isBackground);if(p)host.append(thumbnail(src,p,300,200))}else{const tmp=C.newDoc();tmp.theme=src.theme;tmp.layers=src.layers;tmp.pages[0].items=Merge.pick(src,s).items.filter(n=>!n.pin);host.append(thumbnail(tmp,tmp.pages[0],300,200))}}catch(err){console.warn(err)}
    const copy=C.copy(S.doc),page=copy.pages[S.pageIndex],res=s.all?Merge.insertPages(copy,src,{avoidClash:r.avoidClash,uniqueHosts:r.uniqueHosts,prefix:r.prefix}):Merge.insert(copy,r.place==='newpage'?C.page('x'):page,src,{...r,page:s.page,block:s.block,activeLayer:S.activeLayer,wrap:r.wrap?(r.wrapName||m?.name||'Zone'):''});
    if(!res){$('addResult').textContent='Nothing to add.';return}const its=res.items||res.pages.flatMap(p=>p.items),rp=res.report;
    $('addResult').innerHTML=`Adds <b>${res.pages?res.pages.length+' page'+(res.pages.length>1?'s':'')+', ':''}${its.filter(n=>n.kind==='node').length} devices and ${its.filter(n=>n.kind==='edge').length} links</b>`+
      (rp.subnets.length?` · moves ${rp.subnets.map(([a,b])=>`${a} → ${b}`).join(', ')}`:'')+(rp.readdressed?` · re-addresses ${rp.readdressed} device${rp.readdressed>1?'s':''}`:'')+(rp.hostnames?` · renames ${rp.hostnames} hostname${rp.hostnames>1?'s':''}`:'')+(rp.layers.length?` · new layer ${html(rp.layers.join(', '))}`:'')+(rp.vlans.length?` · VLAN ${rp.vlans.join(', ')}`:'')+(rp.ipClashes?` · <span class="warnTxt">${rp.ipClashes} device IP${rp.ipClashes>1?'s':''} already in use</span>`:'')};
  d.oninput=preview;d.onchange=preview;preview();
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const pb=e.target.closest('[data-add-place]');if(pb){place=pb.dataset.addPlace;d.querySelectorAll('[data-add-place]').forEach(b=>b.classList.toggle('active',b===pb));preview();return}
    if(e.target.closest('[data-add-go]')){const{r,s}=read();S.prefs.tplInsert={place,legend:r.legend,layers:r.layers,avoidClash:r.avoidClash,uniqueHosts:r.uniqueHosts,wrap:r.wrap,group:r.group};savePrefs();closeDialog();add(s,s.all?{...r,mode:'pages'}:r)}}}

// ---------- save / import / export ----------
function openSave(){const sel=picked().filter(n=>!n.pin),p=pg();
  const d=openDialog('Save as template',`<p class="muted">Templates are kept in this browser and listed under <b>Templates ▸ My templates</b>. Drag them into any drawing; ⤓ downloads one to share.</p>
  <label class="fld"><span>Name</span><input id="tplName" value="${html(sel.length?'My block':p.name)}"></label>
  <label class="fld"><span>Description</span><input id="tplDesc" placeholder="What it is for"></label>
  <div class="fld"><span>Save</span><div class="seg"><button data-tpl-what="page" class="${sel.length?'':'active'}">This page</button><button data-tpl-what="sel" class="${sel.length?'active':''}" ${sel.length?'':'disabled'}>Selection (${sel.length})</button><button data-tpl-what="doc">Whole drawing</button></div></div>
  <footer><button data-close>Cancel</button><button class="primary" data-tpl-go>Save template</button></footer>`);
  let what=sel.length?'sel':'page';setTimeout(()=>$('tplName').select(),20);
  d.onclick=async e=>{if(e.target.closest('[data-close]'))return closeDialog();const w=e.target.closest('[data-tpl-what]');if(w&&!w.disabled){what=w.dataset.tplWhat;d.querySelectorAll('[data-tpl-what]').forEach(b=>b.classList.toggle('active',b===w));if(what!=='sel'&&$('tplName').value==='My block')$('tplName').value=what==='doc'?S.doc.name:p.name;return}
    if(!e.target.closest('[data-tpl-go]'))return;const name=$('tplName').value.trim()||'Template';let doc;
    if(what==='sel'){const ids=new Set(sel.map(n=>n.id)),its=[...sel,...items().filter(e=>e.kind==='edge'&&!ids.has(e.id)&&e.from&&e.to&&ids.has(e.from.node)&&ids.has(e.to.node))];doc=Merge.docFrom(S.doc,its,name)}
    else{doc=C.copy(Packs.embedUsed(S.doc));doc.name=name;if(what==='page'){const keep=new Set([p.id,p.background].filter(Boolean));doc.pages=doc.pages.filter(x=>keep.has(x.id))}}
    Packs.embedUsed(doc);await store({name,description:$('tplDesc').value.trim(),doc});closeDialog();S.ltab='templates';renderLeft();notify(`Saved template “${name}”. Drag it from Templates ▸ My templates into any drawing.`,4500)}}
async function store({name,description='',doc}){if(!loaded)await load();const t={id:C.uid(),name,description,created:new Date().toISOString(),doc:JSON.parse(JSON.stringify(doc))};user.unshift(t);await saveUser();render();return t}
function importFile(){const inp=document.createElement('input');inp.type='file';inp.accept='.json,application/json';inp.onchange=async()=>{try{const t=await importData(JSON.parse(await inp.files[0].text()),inp.files[0].name);notify(`Imported template “${t.name}”.`)}catch(err){notify(err.message||'Not a template or drawing file.')}};inp.click()}
async function importData(data,file=''){const doc=C.migrate(data.portTemplate?data.doc:data);return store({name:data.name||doc.name||file.replace(/\.json$/i,'')||'Template',description:data.description||doc.meta?.description||'',doc})}
// A drawing or template file dropped onto the canvas: offer to add it here instead of replacing the drawing.
async function fileDropped(data,file,at){if(data.portTemplate){const t=await importData(data,file);await add({src:'u:'+t.id},{...prefs(),place:'at',at,anchor:'topleft'});return true}
  if(!items().length)return false;const doc=C.migrate(data);
  const d=openDialog('Drawing dropped',`<p>Add <b>${html(file)}</b> to this drawing, or open it instead?</p><footer><button data-dd="open">Open instead</button><button data-dd="tpl">Keep as template</button><button class="primary" data-dd="add">Add here</button></footer>`);
  d.onclick=async e=>{if(e.target.closest('[data-close]'))return closeDialog();const b=e.target.closest('[data-dd]');if(!b)return;closeDialog();
    if(b.dataset.dd==='open'){if(S.dirty&&!confirm('Open “'+file+'”? Unsaved changes stay recoverable with Undo.'))return;loadDocument(doc,{name:file});return}
    if(b.dataset.dd==='add'){const id=C.uid();files.set(id,{name:doc.name||file,doc});add({src:'f:'+id},{...prefs(),place:'at',at,anchor:'topleft'});return}
    const t=await store({name:doc.name||file,description:'Imported from '+file,doc});notify(`“${t.name}” is in Templates ▸ My templates — drag it into any drawing.`)};return true}

function onClick(e){const t=e.target;
  if(t.closest('[data-tpl-save]'))return openSave();if(t.closest('[data-tpl-import]'))return importFile();
  const a=t.closest('[data-tadd]');if(a)return openAdd({src:a.dataset.tadd});
  const o=t.closest('[data-topen]');if(o){docOf(o.dataset.topen).then(doc=>{if(!doc)return;if(S.dirty&&!confirm('Open it as a new drawing? Unsaved changes stay recoverable with Undo.'))return;loadDocument(C.copy(doc),{name:'template'});if(kindOf(o.dataset.topen)==='b')built.delete(idOf(o.dataset.topen))});return}
  const x=t.closest('[data-texport]');if(x){const u=user.find(v=>'u:'+v.id===x.dataset.texport);if(u)download(safeName(u.name)+'.template.json',JSON.stringify({portTemplate:1,name:u.name,description:u.description,doc:u.doc}),'application/json');return}
  const del=t.closest('[data-tdel]');if(del){const u=user.find(v=>'u:'+v.id===del.dataset.tdel);if(u&&confirm(`Delete the template “${u.name}”?`)){user=user.filter(v=>v!==u);cache.delete(del.dataset.tdel);saveUser();render()}return}
  const chip=t.closest('.tchip');if(chip)return openAdd(specOf(chip))}
function init(){const pane=$('templatesPane');if(!pane)return;pane.addEventListener('click',onClick);pane.addEventListener('dragstart',dragStart);pane.addEventListener('dragend',dragEnd);
  pane.addEventListener('toggle',e=>{const det=e.target.closest?.('[data-tparts]');if(det?.open)fillParts(det)},true);
  pane.addEventListener('input',e=>{if(e.target.id==='tplSearch')render()});load()}
// Reload the lists (e.g. after another drawing is saved) the next time the panel is shown.
function invalidate(){loaded=false;for(const k of[...cache.keys()])if(kindOf(k)==='d')cache.delete(k)}

return{init,render,invalidate,openAdd,openSave,add,drop,dragOver,dragEnd,fileDropped,importData,list:()=>user,docOf,meta};
})();
