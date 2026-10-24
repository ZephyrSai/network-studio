// Event wiring and start-up.
function insertLibrary(id,x,y){const entry=S.library.find(e=>e.id===id);if(!entry)return;mutate(()=>{const a=C.duplicate(entry.items,0,0),b=C.bounds(a);a.forEach(n=>{n.locked=false;n.layer=S.activeLayer;C.move(n,grid(x-b.w/2)-b.x,grid(y-b.h/2)-b.y)});items().push(...a);a.forEach(e=>e.kind==='edge'&&Conn.markDirty(e.id));select(a.map(n=>n.id))})}
function wire(){
  document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon,17));
  const cv=$('canvas');
  cv.addEventListener('pointerdown',beginPointer);cv.addEventListener('pointermove',pointerMove);cv.addEventListener('pointerup',pointerUp);cv.addEventListener('pointercancel',()=>{S.drag=null;S.guideLines=[];render()});
  cv.addEventListener('pointerleave',()=>{if(!S.drag&&S.hoverId){S.hoverId=null;render('overlay')}S.cursor=null;renderRulers()});
  cv.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey||S.prefs.wheelZoom&&!e.shiftKey){const f=Math.exp(-e.deltaY*(e.ctrlKey&&!e.metaKey&&Math.abs(e.deltaY)<40?.012:.0022));zoomAt(f,point(e))}else{const dx=e.shiftKey&&!e.deltaX?e.deltaY:e.deltaX,dy=e.shiftKey&&!e.deltaX?0:e.deltaY;S.view.x+=dx/S.view.zoom;S.view.y+=dy/S.view.zoom;render('overlay')}},{passive:false});
  cv.addEventListener('contextmenu',canvasMenu);
  // global clicks: actions, modes, palette, tabs
  document.addEventListener('click',e=>{
    const t=e.target;
    const a=t.closest('[data-action]');if(a&&!a.disabled){hideMenus();actions[a.dataset.action]?.();return}
    const m=t.closest('[data-mode]');if(m){setMode(m.dataset.mode);return}
    if(t.closest('[data-file-menu]')){const fm=$('fileMenu');if(!fm.hidden){hideMenus();return}openFileMenu(t.closest('[data-file-menu]'));return}
    const rt=t.closest('[data-rtab]');if(rt){S.ribbonTab=rt.dataset.rtab;renderRibbon();return}
    const lt=t.closest('[data-ltab]');if(lt){S.ltab=lt.dataset.ltab;renderLeft();return}
    const sym=t.closest('[data-symbol]');if(sym&&!S.justDragged){const c=centerOfView();addNode(sym.dataset.symbol,c[0]+(Math.random()-.5)*40,c[1]+(Math.random()-.5)*40);bumpRecent(sym.dataset.symbol);return}
    const lib=t.closest('[data-library]');if(lib){insertLibrary(lib.dataset.library,...centerOfView());return}
    const ld=t.closest('[data-library-delete]');if(ld){if(confirm('Remove this item from your library?')){S.library=S.library.filter(x=>x.id!==ld.dataset.libraryDelete);saveLibrary()}return}
    const pt=t.closest('[data-page]');if(pt){const i=+pt.dataset.page;if(i!==S.pageIndex)gotoPage(i);return}
    const ex=t.closest('[data-explore]');if(ex){const[pi,id]=ex.dataset.explore.split(':');if(+pi!==S.pageIndex){S.pageIndex=+pi;clearTransient();fit()}select([id]);const n=find(id);if(n)Ins.ensureVisible(n);return}
    const th=t.closest('[data-theme-apply]');if(th&&!t.closest('#inspector')){mutate(()=>Shapes.applyTheme(S.doc,th.dataset.themeApply));renderRibbon();notify('Theme applied — Undo restores the previous look.');return}
    if(!t.closest('.menu'))hideMenus()});
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.menu')&&!e.target.closest('[data-file-menu]'))hideMenus()});
  // inspector
  const ins=$('inspector');ins.addEventListener('change',Ins.onChange);ins.addEventListener('input',Ins.onInput);ins.addEventListener('click',Ins.onClick);$('inspectorTabs').addEventListener('click',Ins.onClick);
  ins.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.tagName==='INPUT'){e.target.blur();e.target.focus()}});
  // ribbon controls
  $('ribbon').addEventListener('change',e=>{const t=e.target,id=t.id,sel=editable();
    if(id==='linkTypeSel'){S.linkType=t.value;const es=sel.filter(n=>n.kind==='edge');if(es.length)mutate(()=>es.forEach(x=>Shapes.applyLinkType(x,t.value)));renderRibbon();return}
    if(id==='routeSel'){S.routeStyle=t.value;const es=sel.filter(n=>n.kind==='edge');if(es.length&&t.value!=='curved')mutate(()=>es.forEach(x=>{x.routing=t.value;x.curve='straight';Conn.orthogonalize(x);Conn.markDirty(x.id)}));return}
    if(id==='fontSizeSel'&&t.value){const ls=S.activeLabel?[find(S.activeLabel.owner)?.labels.find(l=>l.id===S.activeLabel.id)]:sel.flatMap(n=>n.labels||[]);if(ls.length)mutate(()=>ls.forEach(l=>l&&(l.size=+t.value)));t.value='';return}
    if(id==='fontColor'){const ls=S.activeLabel?[find(S.activeLabel.owner)?.labels.find(l=>l.id===S.activeLabel.id)]:sel.flatMap(n=>n.labels||[]);if(ls.length)mutate(()=>ls.forEach(l=>l&&(l.color=t.value)));return}
    if(id==='displaySel'&&t.value){S.prefs.newDisplay=t.value;savePrefs();const ns=sel.filter(n=>n.kind==='node'&&Shapes.kindOf(n.type)==='device');if(ns.length)mutate(()=>ns.forEach(n=>n.display=t.value));else notify('New devices will use the '+t.value+' style.');t.value='';return}
    if(id==='strokeColor'||id==='fillColor'){if(!ensureEditable())return;mutate(()=>sel.forEach(n=>n[id==='strokeColor'?'stroke':'fill']=t.value));return}
    if(id==='paperSel'){mutate(()=>pg().paper=t.value);fit();return}
    if(id==='jumpSel'){mutate(()=>S.doc.display.jumpStyle=t.value);return}
    if(id==='colorBySel'){mutate(()=>S.doc.display.colorBy=t.value);return}
    if(id==='showFieldSel'&&t.value){const k=t.value;mutate(()=>{const f=S.doc.display.fields||=[];S.doc.display.fields=f.includes(k)?f.filter(x=>x!==k):[...f,k]});renderRibbon();return}
    if(id==='gridStepSel'){S.prefs.gridStep=+t.value;savePrefs();render();return}});
  $('docName').addEventListener('change',e=>{const v=e.target.value.trim()||'Untitled network';mutate(()=>S.doc.name=v);document.title=v+' · Port Network Studio'});
  $('docName').addEventListener('keydown',e=>{if(e.key==='Enter')e.target.blur()});
  // left panel
  $('search').addEventListener('input',renderPalette);$('search').addEventListener('keydown',e=>{if(e.key==='Enter'){const first=$('palette').querySelector('[data-symbol]');if(first)first.click()}if(e.key==='Escape'){e.target.value='';renderPalette()}});
  $('paletteDisplay').addEventListener('change',e=>{S.prefs.paletteDisplay=e.target.value;savePrefs();renderPalette()});
  $('palette').addEventListener('toggle',e=>{const d=e.target.closest('details[data-cat]');if(!d||$('search').value)return;S.prefs.catOpen??={};S.prefs.catOpen[d.dataset.cat]=d.open;savePrefs();if(d.open&&!d.querySelector('.palette')?.children.length)renderPalette()},true);
  $('explorerSearch').addEventListener('input',renderExplorer);
  $('palette').addEventListener('dragstart',e=>{const s=e.target.closest('[data-symbol]'),l=e.target.closest('[data-library]');if(s){e.dataTransfer.setData('application/x-port-symbol',s.dataset.symbol);e.dataTransfer.effectAllowed='copy'}if(l)e.dataTransfer.setData('application/x-port-library',l.dataset.library)});
  cv.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy'});
  cv.addEventListener('drop',e=>{e.preventDefault();const p=point(e),type=e.dataTransfer.getData('application/x-port-symbol'),lib=e.dataTransfer.getData('application/x-port-library'),ico=e.dataTransfer.getData('application/x-port-iconify');if(ico){Workspace.pickOnline(ico,p);return}if(type){addNode(type,p[0],p[1],{split:true});bumpRecent(type);S.justDragged=true;setTimeout(()=>S.justDragged=false,50);return}if(lib){insertLibrary(lib,...p);return}const f=e.dataTransfer.files?.[0];if(f)handleFile(f,null,p)});
  // layers pane
  const lp=$('layersPane');
  lp.addEventListener('click',e=>{const t=e.target;const act=t.closest('[data-layer-active]');if(act){S.activeLayer=act.dataset.layerActive;renderLayers();renderChrome();return}
    const tg=t.closest('[data-layer-toggle]');if(tg){const L=S.doc.layers.find(l=>l.id===tg.dataset.id),k=tg.dataset.layerToggle;mutate(()=>L[k]=k==='locked'?!L[k]:L[k]===false);renderLayers();return}
    const sl=t.closest('[data-layer-select]');if(sl){select(items().filter(n=>layerOf(n)?.id===sl.dataset.layerSelect).map(n=>n.id));return}
    const dl=t.closest('[data-layer-delete]');if(dl){if(S.doc.layers.length===1)return notify('Keep at least one layer.');const id=dl.dataset.layerDelete,n=S.doc.pages.flatMap(p=>p.items).filter(i=>i.layer===id).length;if(n&&!confirm(`Delete this layer? Its ${n} shape(s) move to “${S.doc.layers.find(l=>l.id!==id).name}”.`))return;mutate(()=>{S.doc.layers=S.doc.layers.filter(l=>l.id!==id);for(const p of S.doc.pages)for(const i of p.items)if(i.layer===id)i.layer=S.doc.layers[0].id;if(S.activeLayer===id)S.activeLayer=S.doc.layers[0].id});renderLayers();return}
    if(t.closest('[data-action-layer-add]')){const name=$('newLayer').value.trim()||'Layer '+(S.doc.layers.length+1);mutate(()=>{const l={id:C.uid(),name,visible:true,locked:false,print:true};S.doc.layers.push(l);S.activeLayer=l.id});renderLayers();return}
    if(t.closest('[data-layer-assign]')){setLayer(S.activeLayer);renderLayers();return}
    if(t.closest('[data-layer-preset]')){mutate(()=>{for(const name of['Physical','Logical (L3)','Management','Power','Security systems','Annotations'])if(!S.doc.layers.some(l=>l.name===name))S.doc.layers.push({id:C.uid(),name,visible:true,locked:false,print:true})});renderLayers();return}
    if(t.closest('[data-layer-solo]')){mutate(()=>S.doc.layers.forEach(l=>l.visible=true));renderLayers()}});
  lp.addEventListener('change',e=>{const id=e.target.dataset.layerName;if(id){const L=S.doc.layers.find(l=>l.id===id);mutate(()=>L.name=e.target.value||L.name);renderLayers()}});
  // page tabs
  const tabs=$('pageTabs');
  tabs.addEventListener('dblclick',e=>{if(e.target.closest('[data-page]'))renamePage()});
  tabs.addEventListener('contextmenu',e=>{const b=e.target.closest('[data-page]');if(b)tabMenu(e,+b.dataset.page)});
  tabs.addEventListener('dragstart',e=>{const b=e.target.closest('[data-page]');if(b)e.dataTransfer.setData('application/x-port-page',b.dataset.page)});
  tabs.addEventListener('dragover',e=>{const b=e.target.closest('[data-page]');if(b&&e.dataTransfer.types.includes('application/x-port-page')){e.preventDefault();tabs.querySelectorAll('.dragOver').forEach(x=>x.classList.remove('dragOver'));b.classList.add('dragOver')}});
  tabs.addEventListener('drop',e=>{const b=e.target.closest('[data-page]');const from=+e.dataTransfer.getData('application/x-port-page');if(!b||Number.isNaN(from))return;e.preventDefault();const to=+b.dataset.page;if(from===to)return;mutate(()=>{const[p]=S.doc.pages.splice(from,1);S.doc.pages.splice(to,0,p);S.pageIndex=to})});
  // status bar
  $('zoomRange').addEventListener('input',e=>setZoom(2**(+e.target.value/100)));
  $('layerSel').addEventListener('change',e=>{S.activeLayer=e.target.value;if(S.ltab==='layers')renderLayers();notify('New shapes go on layer “'+S.doc.layers.find(l=>l.id===S.activeLayer)?.name+'”.',1800)});
  // minimap
  const mm=$('minimap');let mmDrag=false;const mmMove=e=>{const svg=$('miniSvg'),vb=JSON.parse(svg.dataset.vb||'[0,0,1,1]'),r=svg.getBoundingClientRect(),k=Math.max(vb[2]/r.width,vb[3]/r.height),ox=(r.width-vb[2]/k)/2,oy=(r.height-vb[3]/k)/2,x=vb[0]+(e.clientX-r.left-ox)*k,y=vb[1]+(e.clientY-r.top-oy)*k,c=$('canvas');S.view.x=x-c.clientWidth/2/S.view.zoom;S.view.y=y-c.clientHeight/2/S.view.zoom;render('overlay')};
  mm.addEventListener('pointerdown',e=>{mmDrag=true;mm.setPointerCapture(e.pointerId);mmMove(e)});mm.addEventListener('pointermove',e=>{if(mmDrag)mmMove(e)});mm.addEventListener('pointerup',()=>mmDrag=false);
  // keyboard & clipboard
  window.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.querySelector('dialog[open]')&&!document.querySelector('dialog[open]').matches(':modal')){closeDialog();S.highlights.clear();render('overlay');return}onKey(e)});
  window.addEventListener('keyup',e=>{if(e.code==='Space'){S.space=false;$('canvas').style.cursor=S.mode==='pan'?'grab':S.mode==='select'?'default':'crosshair'}});
  window.addEventListener('blur',()=>S.space=false);
  const editingText=()=>['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||document.activeElement?.isContentEditable;
  document.addEventListener('copy',e=>{if(editingText())return;const j=copySelection();if(j){e.clipboardData.setData('text/plain',j);e.preventDefault();notify('Copied '+S.clipboard.length+' item(s).',1200)}});
  document.addEventListener('cut',e=>{if(editingText())return;const j=copySelection();if(j){e.clipboardData.setData('text/plain',j);e.preventDefault();erase()}});
  document.addEventListener('paste',e=>{if(editingText())return;const dt=e.clipboardData;if(!dt)return;const img=[...dt.items].find(i=>i.type.startsWith('image/'));if(img){e.preventDefault();importImage(img.getAsFile(),S.cursor);return}const txt=dt.getData('text/plain');if(txt){try{const d=JSON.parse(txt);if(d.portClipboard){e.preventDefault();pasteItems(d.items);return}if(d.version&&d.pages){e.preventDefault();loadDocument(C.migrate(d));return}}catch{}if(/^(name|hostname|device)[,;\t]/i.test(txt.trim())){e.preventDefault();openImportDialog({devices:txt});return}if(/Device[ -]ID|System Name:/i.test(txt)){e.preventDefault();openImportDialog({tab:'cdp'});setTimeout(()=>{$('cdpText').value=txt},50);return}e.preventDefault();const at=S.cursor||centerOfView();const t=mutate(()=>{const n=C.text(txt.slice(0,2000),grid(at[0]),grid(at[1]),300,60,13);n.labels[0].wrapWidth=280;n.layer=S.activeLayer;items().push(n);select([n.id]);return n});return}if(S.clipboard.length){e.preventDefault();pasteItems(S.clipboard)}});
  // files
  $('fileInput').addEventListener('change',async e=>{const f=e.target.files[0];if(f)await handleFile(f);e.target.value=''});
  $('imageInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)importImage(f);e.target.value=''});
  $('shapeInput').addEventListener('change',async e=>{const f=[...e.target.files];e.target.value='';await Workspace.importShapes(f)});
  $('folderInput').addEventListener('change',async e=>{const f=[...e.target.files];e.target.value='';await Workspace.importShapes(f)});
  Workspace.wireIcons();
  $('libraryInput').addEventListener('change',async e=>{const f=e.target.files[0];if(!f)return;try{importLibraryData(JSON.parse(await f.text()))}catch(err){notify(err.message)}e.target.value=''});
  document.body.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault()});
  document.body.addEventListener('drop',e=>{if(e.target.closest('#canvas'))return;const f=e.dataTransfer.files?.[0];if(f){e.preventDefault();handleFile(f)}});
  // window
  new ResizeObserver(()=>render()).observe($('workarea'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(S.prefs.theme==='auto')applyUiTheme()});
  window.addEventListener('beforeunload',e=>{clearTimeout(autosaveTimer);if(S.dirty)autosave()});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&S.dirty)Workspace.saveCurrent(true)});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&document.body.classList.contains('presenting')){document.body.classList.remove('presenting');setTimeout(fit,60)}});
}
async function boot(){
  try{Object.assign(S.prefs,JSON.parse(localStorage.getItem('port-v3-prefs')||'{}'))}catch{}
  try{const lib=JSON.parse(localStorage.getItem('port-v3-library')||'[]');if(Array.isArray(lib))S.library=lib}catch{}
  $('paletteDisplay').value=S.prefs.paletteDisplay||'symbol';
  applyUiTheme();applyLayoutPrefs();wire();
  await Packs.loadAll();
  try{const lib=await Store.kvGet('library');if(Array.isArray(lib)&&!S.library.length)S.library=lib}catch{}
  let doc=null,recovered=false;const ws=await Workspace.restoreLast();
  if(ws){doc=ws.doc;S.docId=ws.id;recovered=true}
  else try{const saved=localStorage.getItem('port-v3-recovery')||localStorage.getItem('port-v2-recovery');if(saved){doc=C.migrate(JSON.parse(saved));recovered=true}}catch(err){console.warn('recovery skipped',err)}
  if(!doc)doc=Templates.build('campus');S.docId??=Workspace.newId();Packs.installDoc(doc);
  S.doc=doc;S.pageIndex=Math.max(0,doc.pages.findIndex(p=>!p.isBackground));S.activeLayer=doc.layers[0].id;
  renderRibbon();renderLeft();setMode('select');document.title=S.doc.name+' · Port Network Studio';
  requestAnimationFrame(()=>{fit();if(recovered)setSaveState('Restored from this browser · File ▸ My drawings');else{setSaveState('Example drawing — File ▸ New for templates');S.dirty=false}});
  if(location.hash.startsWith('#doc='))await loadFromHash();
  else if(!recovered)setTimeout(()=>notify('Welcome! This is an example campus network. Try dragging devices, Analyze ▸ Check diagram, or File ▸ New from template.',7000),600);
  // make the router/layout modules optional: degrade gracefully when missing
  if(typeof Router==='undefined')console.warn('Router module missing — falling back to simple elbows.');
}
boot();
