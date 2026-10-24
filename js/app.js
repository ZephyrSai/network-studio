// Editor state, history, pointer/keyboard interaction and the action registry.
const $=id=>document.getElementById(id);
const DEFAULT_PREFS={grid:true,snap:true,guides:true,rulers:true,showPorts:false,minimap:true,autoConnect:true,wheelZoom:false,gridStep:10,theme:'auto',paletteDisplay:'symbol',newDisplay:'symbol',leftOpen:true,rightOpen:true,jumpStyle:'arc'};
const S={doc:null,pageIndex:0,selected:new Set(),activeLabel:null,segment:null,bend:null,mode:'select',view:{x:-40,y:-40,zoom:.8},drag:null,trace:null,hover:null,hoverId:null,snapPort:null,dropTarget:null,history:[],future:[],clipboard:[],space:false,dirty:false,guideLines:[],spacing:null,library:[],copiedStyle:null,highlights:new Set(),analysis:null,filterFn:null,filter:null,cursor:null,fileHandle:null,activeLayer:null,linkType:'eth',routeStyle:'auto',painter:false,lastClick:null,prefs:{...DEFAULT_PREFS}};
const pg=()=>S.doc.pages[S.pageIndex],items=()=>pg().items,find=id=>items().find(n=>n.id===id),picked=()=>items().filter(n=>S.selected.has(n.id));
const isLocked=n=>!!n.locked||!!layerOf(n)?.locked,editable=()=>picked().filter(n=>!isLocked(n));
const html=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const C=Core;

// ---------- history ----------
let autosaveTimer=null;
function snapshot(){return JSON.stringify({doc:S.doc,pageIndex:S.pageIndex})}
function remember(){S.history.push(snapshot());if(S.history.length>150)S.history.shift();S.future=[]}
function changed(){S.dirty=true;S.doc.meta.modified=new Date().toISOString();setSaveState('Unsaved changes');clearTimeout(autosaveTimer);autosaveTimer=setTimeout(autosave,700)}
function mutate(fn){remember();const r=fn();changed();render();return r}
function clearTransient(){S.selected.clear();S.activeLabel=null;S.segment=null;S.bend=null;S.trace=null;S.drag=null;S.snapPort=null;S.highlights.clear()}
function restore(s){const r=JSON.parse(s);S.doc=r.doc;S.pageIndex=Math.min(r.pageIndex,S.doc.pages.length-1);const keep=new Set([...S.selected].filter(id=>items().some(n=>n.id===id)));clearTransient();S.selected=keep;changed();render()}
function undo(){if(!S.history.length)return notify('Nothing to undo.');S.future.push(snapshot());restore(S.history.pop())}
function redo(){if(!S.future.length)return;S.history.push(snapshot());restore(S.future.pop())}
function setSaveState(t){const e=$('saveState');if(e)e.textContent=t}
function autosave(){try{Packs.embedUsed(S.doc);localStorage.setItem('port-v3-recovery',JSON.stringify(S.doc));setSaveState(S.fileHandle?'Unsaved · recovery copy kept':'Recovery copy saved in this browser')}catch{setSaveState('Quick recovery copy too large — kept in browser storage only')}Workspace.saveCurrent()}
function savePrefs(){try{localStorage.setItem('port-v3-prefs',JSON.stringify(S.prefs))}catch{}}

let toastTimer=null;
function notify(text,ms=3800){const t=$('toast');t.textContent=text;t.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.hidden=true,ms)}

// ---------- modes ----------
const HINTS={select:'Drag to move · Shift-click adds · Alt-drag duplicates · Drag a port or the blue arrows to connect · Double-click to edit text',connect:'Drag from a device to another to connect · or click a point, then click bends, Enter to finish (manual styles) · Alt = free point',zone:'Drag a rectangle to create a network zone (container). Members move with the zone.',text:'Click to add text, or drag to set the text box width.',port:'Click a device edge to add a connection point · drag existing points to move them.',pan:'Drag to pan · wheel / pinch to zoom.'};
function setMode(m){S.mode=m;S.trace=null;S.hover=null;S.snapPort=null;S.dropTarget=null;S.painter=false;document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));$('canvas').style.cursor=m==='pan'?'grab':m==='select'?'default':'crosshair';$('hint').textContent=HINTS[m]||'';render('overlay');render('panel')}

// ---------- coordinates & snapping ----------
function point(e){const r=$('canvas').getBoundingClientRect();return[S.view.x+(e.clientX-r.left)/S.view.zoom,S.view.y+(e.clientY-r.top)/S.view.zoom]}
function grid(v,e){return S.prefs.snap&&!(e&&(e.ctrlKey||e.metaKey))?Math.round(v/gridStep())*gridStep():v}
function routeTo(a,b){if(!a)return[b];const st=S.routeStyle;if(!['hv','vh'].includes(st)||Math.abs(a[0]-b[0])<.01||Math.abs(a[1]-b[1])<.01)return[b];return[st==='hv'?[b[0],a[1]]:[a[0],b[1]],b]}
const genericPort=name=>!name||/^(top|right|bottom|left|edge \d+|port \d+)$/i.test(name);
function endpointName(r){const n=find(r?.node);if(!n)return'Missing device';const p=r.port&&n.ports?.find(q=>q.id===r.port);return(resolveLabel(n,n.labels?.[0]||{text:''},makeCtx(pg()))||Shapes.nameOf(n.type))+(r.port?' / '+(p?.name||'Missing port'):' (auto)')}
function hoverPortLabel(t){return t.candidate?'Click to connect here':t.glue?'Connect to '+(resolveLabel(find(t.ref.node),find(t.ref.node)?.labels?.[0]||{text:''})||'device'):'Snap · '+endpointName(t.ref)}
function edgeCandidate(n,p){const[u,v]=C.localPoint(n,p);let x=Math.max(0,Math.min(1,u)),y=Math.max(0,Math.min(1,v));const d=[Math.abs(u),Math.abs(1-u),Math.abs(v),Math.abs(1-v)],side=d.indexOf(Math.min(...d));if(side===0)x=0;if(side===1)x=1;if(side===2)y=0;if(side===3)y=1;x=Math.round(x*40)/40;y=Math.round(y*40)/40;const q=C.portPoint(n,{x,y});return{p:q,ref:null,candidate:{node:n.id,x,y},distance:Math.hypot(q[0]-p[0],q[1]-p[1])}}
function nodesAt(p,pad=0){return[...items()].reverse().filter(n=>n.kind==='node'&&n.type!=='rack'&&itemVisible(n,{doc:S.doc})&&!isLocked(n)).filter(n=>{const b=C.box(n);return p[0]>=b.x-pad&&p[0]<=b.x+b.w+pad&&p[1]>=b.y-pad&&p[1]<=b.y+b.h+pad})}
function snapTarget(p,e,{exclude=null,glue=true}={}){
  S.snapPort=null;S.dropTarget=null;if(e?.altKey)return{p,ref:null};const z=S.view.zoom;
  const t=e?.target?.closest?.('[data-role="port"]');if(t&&t.dataset.id!==exclude){const n=find(t.dataset.id),port=n?.ports.find(q=>q.id===t.dataset.port);if(port){S.snapPort={p:C.portPoint(n,port),ref:{node:n.id,port:port.id}};return S.snapPort}}
  let best=14/z,res=null;for(const n of items())if(n.kind==='node'&&n.id!==exclude&&!isLocked(n)&&itemVisible(n,{doc:S.doc}))for(const port of n.ports||[]){const q=C.portPoint(n,port),d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<best){best=d;res={p:q,ref:{node:n.id,port:port.id}}}}
  if(res){S.snapPort=res;return res}
  for(const n of nodesAt(p,12/z)){if(n.id===exclude)continue;const c=edgeCandidate(n,p);if(c.distance<=11/z&&!(glue&&insideBox(n,p,12/z))){S.snapPort=c;return c}if(glue&&insideBox(n,p,0)){S.dropTarget=n.id;return{p:C.center(n),ref:{node:n.id,port:null},glue:true}}if(c.distance<=11/z){S.snapPort=c;return c}}
  return{p:[grid(p[0],e),grid(p[1],e)],ref:null}}
function insideBox(n,p,inset){const b=C.box(n);return p[0]>b.x+inset&&p[0]<b.x+b.w-inset&&p[1]>b.y+inset&&p[1]<b.y+b.h-inset}
function commitPort(t){if(!t?.candidate)return t;const c=t.candidate,n=find(c.node);if(!n)return t;let ex=n.ports.find(q=>Math.hypot(q.x-c.x,q.y-c.y)<.002);if(!ex){ex={id:C.uid(),name:'Edge '+(n.ports.length+1),x:c.x,y:c.y};n.ports.push(ex)}return{p:C.portPoint(n,ex),ref:{node:n.id,port:ex.id}}}

// ---------- selection ----------
function selection(id,add=false,individual=false){const n=find(id);if(!n)return;const ids=n.group&&!individual?items().filter(x=>x.group===n.group).map(x=>x.id):[id];if(!add)S.selected.clear();const remove=add&&ids.every(i=>S.selected.has(i));ids.forEach(i=>remove?S.selected.delete(i):S.selected.add(i));S.activeLabel=null;S.segment=null;S.bend=null}
function select(ids){S.selected=new Set(ids);S.activeLabel=null;S.segment=null;S.bend=null;render('overlay');render('panel')}
function ensureEditable(){if(!S.selected.size){notify('Select an element first.');return false}if(picked().some(isLocked)){notify('Unlock the selection (or its layer) before editing.');return false}return true}
// Everything that moves with the selection: container members, internal links.
function moveSet(ids){
  const all=items(),set=new Set(ids);let grew=true;
  while(grew){grew=false;for(const z of all.filter(n=>set.has(n.id)&&(n.kind==='zone'&&n.contain!==false||n.type==='rack'))){const zb=C.box(z);for(const n of all)if(!set.has(n.id)&&!isLocked(n)&&n.kind!=='edge'&&C.inside(C.box(n),zb,1)&&!(n.kind==='zone'&&n.w*n.h>=z.w*z.h)){set.add(n.id);grew=true}}}
  const nodes=new Set(all.filter(n=>set.has(n.id)&&n.kind!=='edge').map(n=>n.id)),zones=all.filter(n=>set.has(n.id)&&(n.kind==='zone'||n.type==='rack')).map(C.box);
  for(const e of all.filter(n=>n.kind==='edge')){const endOk=k=>e[k]?nodes.has(e[k].node):zones.some(b=>C.inside({x:(k==='from'?e.points[0]:e.points.at(-1))[0],y:(k==='from'?e.points[0]:e.points.at(-1))[1],w:0,h:0},b));const inner=endOk('from')&&endOk('to');if(set.has(e.id)&&!inner&&(e.from&&!nodes.has(e.from.node)||e.to&&!nodes.has(e.to.node)))set.delete(e.id);else if(!set.has(e.id)&&inner&&(e.from||e.to||zones.length))set.add(e.id)}
  return all.filter(n=>set.has(n.id)&&!isLocked(n))}

// ---------- pointer ----------
function beginPointer(e){
  if(e.button===2)return;if(!$('inlineText').hidden){$('inlineText').blur();return}
  hideMenus();const p=point(e),t=e.target.closest('[data-role]'),role=t?.dataset.role,id=t?.dataset.id,n=id&&find(id),now=Date.now(),key=role+':'+id+':'+(t?.dataset.label||t?.dataset.index||'');
  if(S.lastClick&&now-S.lastClick.time<380&&S.lastClick.key===key&&Math.hypot(e.clientX-S.lastClick.x,e.clientY-S.lastClick.y)<6&&S.mode==='select'){S.lastClick=null;onDoubleClick(e,p,t,n);return}
  S.lastClick={time:now,key,x:e.clientX,y:e.clientY};
  if(S.pickHandler){const h=S.pickHandler;S.pickHandler=null;if(n?.kind==='node'){h(n.id);return}notify('Path trace cancelled.',1500)}
  const capture=()=>$('canvas').setPointerCapture(e.pointerId);
  if(role==='guide'&&S.mode==='select'){remember();S.drag={kind:'guide',guide:t.dataset.guide};capture();return}
  if(S.space||S.mode==='pan'||e.button===1){e.preventDefault();S.drag={kind:'pan',start:[e.clientX,e.clientY],view:{...S.view}};$('canvas').style.cursor='grabbing';capture();return}
  if(S.painter){if(n){applyPainter(n);if(!S.painterSticky){S.painter=false;$('canvas').style.cursor='default'}}else{S.painter=false;$('canvas').style.cursor='default'}render();return}
  if(role==='autoconnect'){S.drag={kind:'autoconn',id,dir:t.dataset.dir,start:p,startClient:[e.clientX,e.clientY]};capture();return}
  if(role==='rotate'&&editable().length===1){remember();const m=picked()[0];S.drag={kind:'rotate',id:m.id,center:C.center(m),original:C.copy(m)};capture();return}
  if(role==='port'&&(S.mode==='select'||S.mode==='connect')&&n&&!isLocked(n)){const port=n.ports.find(q=>q.id===t.dataset.port);startConnect({p:C.portPoint(n,port),ref:{node:n.id,port:port.id}},p,e);capture();return}
  if(S.mode==='connect'){
    if(S.trace){let c=snapTarget(p,e);if(c.candidate){remember();c=commitPort(c);changed()}if(c.glue)c={p:c.p,ref:c.ref};S.trace.steps.push(S.trace.points.length);S.trace.points.push(...routeTo(S.trace.points.at(-1),c.p));S.trace.to=c.ref;if(c.ref){finishTrace();return}S.hover=null;render('overlay');return}
    const c=snapTarget(p,e);startConnect(c,p,e);capture();return}
  if(S.mode==='zone'){S.drag={kind:'zone',start:[grid(p[0]),grid(p[1])]};S.drag.current=S.drag.start;capture();return}
  if(S.mode==='text'){S.drag={kind:'textbox',start:p,current:p};capture();return}
  if(S.mode==='port'&&n?.kind==='node'&&!isLocked(n)){if(role==='port'){remember();S.drag={kind:'port',id:n.id,port:t.dataset.port};capture()}else{const c=edgeCandidate(n,p);mutate(()=>n.ports.push({id:C.uid(),name:'Port '+(n.ports.length+1),x:c.candidate.x,y:c.candidate.y}))}return}
  if(role==='resize'){if(!editable().length)return;remember();S.drag={kind:'resize',start:p,original:C.copy(editable()),box:C.bounds(picked()),hx:+t.dataset.hx,hy:+t.dataset.hy};capture();return}
  if(n){
    if(n.kind==='node'&&n.url&&(e.ctrlKey||e.metaKey)){followLink(n.url);return}
    if(e.shiftKey){selection(id,true,e.ctrlKey||e.metaKey);render('overlay');render('panel');return}
    if(!S.selected.has(id)||e.ctrlKey||e.metaKey)selection(id,false,e.ctrlKey||e.metaKey);
    if(isLocked(n)){render('overlay');render('panel');return}
    const kind=role==='label'?'label':role==='segment'?'segment':role==='bend'?'bend':'move';
    S.activeLabel=kind==='label'?{owner:id,id:t.dataset.label}:null;S.segment=kind==='segment'?{id,index:+t.dataset.index}:null;S.bend=kind==='bend'?{id,index:+t.dataset.index}:null;
    remember();
    let set=kind==='move'?moveSet([...S.selected].filter(i=>!isLocked(find(i)))):editable();
    if(kind==='move'&&e.altKey){const dup=C.duplicate(set,0,0);items().push(...dup);set=dup;S.selected=new Set(dup.map(x=>x.id));S.duplicated=true}
    S.drag={kind,start:p,id:kind==='move'&&e.altKey?set.find(x=>x.kind!=='edge')?.id:id,label:t.dataset.label,index:+t.dataset.index,original:C.copy(set),box:C.bounds(set.filter(x=>x.kind!=='edge').length?set.filter(x=>x.kind!=='edge'):set)};
  }else{if(!e.shiftKey)S.selected.clear();S.activeLabel=null;S.segment=null;S.bend=null;S.drag={kind:'box',start:p,current:p,add:e.shiftKey}}
  capture();render('overlay');render('panel')}

function startConnect(c,p,e){
  if(c.candidate){remember();c=commitPort(c);changed()}else remember();
  const lt=Shapes.linkTypes[S.linkType]||{};
  S.drag={kind:'connect',from:c.ref,fromP:c.p,start:p,startClient:[e.clientX,e.clientY],preview:[c.p,c.p],stroke:lt.stroke,width:lt.width,dash:lt.dash}}

function pointerMove(e){
  const p=point(e);S.cursor=p;updateCursorReadout(p);const d=S.drag;
  if(!d){
    if(S.mode==='connect'){if(S.trace){const t=snapTarget(p,e);S.hover=t.p}else snapTarget(p,e);S.hoverId=nodesAt(p)[0]?.id||null;render('overlay')}
    else if(S.mode==='select'||S.mode==='port'){const tgt=e.target.closest('[data-id]'),id=tgt?.dataset.id,n=id&&find(id);let h=n?.kind==='node'?n.id:null;if(!h&&S.hoverId){const o=find(S.hoverId);if(o){const b=C.box(o),pad=46/S.view.zoom;if(p[0]>b.x-pad&&p[0]<b.x+b.w+pad&&p[1]>b.y-pad&&p[1]<b.y+b.h+pad+30/S.view.zoom)h=o.id}}if(h!==S.hoverId){S.hoverId=h;render('overlay')}}
    else render('overlay');
    if(S.prefs.rulers)renderRulers();return}
  if(d.kind==='guide'){const g=pg().guideLines.find(x=>x.id===d.guide);g.pos=grid(p[g.axis==='x'?0:1]);d.moved=true;render('scene');return}
  if(d.kind==='pan'){S.view.x=d.view.x-(e.clientX-d.start[0])/S.view.zoom;S.view.y=d.view.y-(e.clientY-d.start[1])/S.view.zoom;render('overlay');return}
  if(['box','zone','textbox'].includes(d.kind)){d.current=d.kind==='zone'?[grid(p[0]),grid(p[1])]:p;render('overlay');return}
  if(d.kind==='autoconn'){if(Math.hypot(e.clientX-d.startClient[0],e.clientY-d.startClient[1])>5){const n=find(d.id);startConnect({p:C.center(n),ref:{node:n.id,port:null}},p,e);S.drag.autoFrom=true}return}
  if(d.kind==='connect'){const t=snapTarget(p,e,{exclude:d.from?.node});d.target=t;d.moved=d.moved||Math.hypot(e.clientX-d.startClient[0],e.clientY-d.startClient[1])>4;d.preview=previewRoute(d,t);render('overlay');return}
  let dx=p[0]-d.start[0],dy=p[1]-d.start[1];const n=find(d.id),o=d.original?.find?.(x=>x.id===d.id);
  if(d.kind==='port'){const port=n.ports.find(q=>q.id===d.port),[u,v]=C.localPoint(n,p);port.x=Math.max(0,Math.min(1,Math.round(u*40)/40));port.y=Math.max(0,Math.min(1,Math.round(v*40)/40))}
  if(d.kind==='label'){const l=n.labels.find(x=>x.id===d.label),old=o.labels.find(x=>x.id===d.label);if(l.anchor){l.anchor.dx=(old.anchor.dx||0)+dx;l.anchor.dy=(old.anchor.dy||0)+dy}else{l.x=grid(old.x+dx,e);l.y=grid(old.y+dy,e)}}
  if(d.kind==='move'){if(e.shiftKey){if(Math.abs(dx)>Math.abs(dy))dy=0;else dx=0}[dx,dy]=snapMove(d,dx,dy,e);d.original.forEach(old=>{const t=find(old.id);if(!t)return;Object.assign(t,C.copy(old));C.move(t,dx,dy)})}
  if(d.kind==='resize')doResize(d,p,e);
  if(d.kind==='rotate'){let a=Math.atan2(p[1]-d.center[1],p[0]-d.center[0])*180/Math.PI+90;if(!e.altKey)a=Math.round(a/15)*15;a=((a%360)+360)%360;n.rotation=a}
  if(d.kind==='bend'){n.points=C.copy(o.points);const i=d.index,end=i===0||i===n.points.length-1,q=end?snapTarget(p,e,{exclude:i===0?n.to?.node:n.from?.node,glue:true}):{p:[grid(p[0],e),grid(p[1],e)]};n.points[i]=q.p;if(end){if(i===0)n.from=q.ref;else n.to=q.ref;d.pending=q;if(n.routing==='auto'||n.routing==='straight')Conn.markDirty(n.id)}
    if(['hv','vh'].includes(n.routing)&&n.curve!=='smooth'&&!e.altKey){if(i>0){const prev=o.points[i-1],old=o.points[i];if(prev[0]===old[0])n.points[i-1][0]=q.p[0];else if(prev[1]===old[1])n.points[i-1][1]=q.p[1]}if(i<o.points.length-1){const next=o.points[i+1],old=o.points[i];if(next[0]===old[0])n.points[i+1][0]=q.p[0];else if(next[1]===old[1])n.points[i+1][1]=q.p[1]}}}
  if(d.kind==='segment'){if(n.routing==='auto'||n.routing==='straight'){if(!d.converted){n.routing='hv';d.converted=true;o.routing='hv';notify('Connector switched to manual right-angle routing.')}}n.points=C.copy(o.points);const i=d.index,a=o.points[i],b=o.points[i+1];let mx=grid(dx,e),my=grid(dy,e);if(Math.abs(a[0]-b[0])<.01)my=0;else if(Math.abs(a[1]-b[1])<.01)mx=0;
    const pts=n.points;pts[i]=[a[0]+mx,a[1]+my];pts[i+1]=[b[0]+mx,b[1]+my];
    // moving an end section of an attached link inserts a stub so the endpoint stays on its port
    if(mx||my){if(i===o.points.length-2&&n.to)pts.push([b[0],b[1]]);if(i===0&&n.from)pts.unshift([a[0],a[1]])}}
  d.moved=true;render('scene');render('overlay')}
function previewRoute(d,t){const a=d.fromP,b=t.p;if(S.routeStyle==='straight'||S.routeStyle==='free'||S.routeStyle==='curved')return[a,b];if(S.routeStyle==='hv'||S.routeStyle==='vh')return[a,...routeTo(a,b)];
  try{const byId=new Map(items().map(n=>[n.id,n])),fake={from:d.from,to:t.ref,points:[a,b],routing:'auto'},A=d.from?Conn.resolveEnd(fake,'from',byId):null,B=t.ref?Conn.resolveEnd(fake,'to',byId):null;return Router.route({x:(A?.p||a)[0],y:(A?.p||a)[1],dir:A?.dir||null},{x:(B?.p||b)[0],y:(B?.p||b)[1],dir:B?.dir||null},Conn.obstacleList(items()),{margin:14,stub:18,sourceId:A?.node.id,targetId:B?.node.id})}catch{return[a,b]}}

function snapMove(d,dx,dy,e){
  S.guideLines=[];S.spacing=null;d.rackSlot=null;const b=d.box,z=S.view.zoom,free=e.ctrlKey||e.metaKey;
  if(!free&&S.prefs.snap){dx=grid(b.x+dx)-b.x;dy=grid(b.y+dy)-b.y}
  // rack equipment snaps into U slots
  const movers=d.original.filter(x=>x.kind==='node');
  if(movers.length&&movers.every(m=>Shapes.rackItems[m.type])&&!free){const cx=b.x+b.w/2+dx,cy=b.y+b.h/2+dy,rack=items().find(r=>r.type==='rack'&&!d.original.some(o=>o.id===r.id)&&C.inside({x:cx,y:cy,w:0,h:0},Shapes.rackInner(r)));if(rack){const i=Shapes.rackInner(rack);let ny=i.y+Math.round((b.y+dy-i.y)/Shapes.RU)*Shapes.RU;ny=Math.max(i.y,Math.min(i.y+i.h-b.h,ny));dx=i.x-b.x;dy=ny-b.y;d.rackSlot={x:i.x,y:ny,w:i.w,h:b.h};return[dx,dy]}}
  if(S.prefs.guides&&!free){const th=6/z,others=items().filter(t=>!d.original.some(o=>o.id===t.id)&&t.kind!=='edge'&&itemVisible(t,{doc:S.doc})),ps=C.pageSize(pg());const xs=[],ys=[];
    for(const t of others){if(t.kind==='zone')continue;const tb=C.box(t);xs.push(tb.x,tb.x+tb.w/2,tb.x+tb.w);ys.push(tb.y,tb.y+tb.h/2,tb.y+tb.h)}xs.push(ps.w/2);ys.push(ps.h/2);for(const g of pg().guideLines||[])(g.axis==='x'?xs:ys).push(g.pos);
    let bx=null,by=null;for(const v of[b.x,b.x+b.w/2,b.x+b.w])for(const x of xs){const off=x-v-dx;if(Math.abs(off)<th&&(bx===null||Math.abs(off)<Math.abs(bx.off)))bx={off,x}}
    for(const v of[b.y,b.y+b.h/2,b.y+b.h])for(const y of ys){const off=y-v-dy;if(Math.abs(off)<th&&(by===null||Math.abs(off)<Math.abs(by.off)))by={off,y}}
    if(bx){dx+=bx.off;S.guideLines.push([bx.x,-5000,bx.x,5000])}if(by){dy+=by.off;S.guideLines.push([-5000,by.y,5000,by.y])}}
  return[dx,dy]}
function doResize(d,p,e){
  const b=d.box;let left=b.x,top=b.y,right=b.x+b.w,bottom=b.y+b.h;const dx=p[0]-d.start[0],dy=p[1]-d.start[1];
  if(d.hx===0)left=Math.min(grid(b.x+dx,e),right-8);if(d.hx===1)right=Math.max(grid(right+dx,e),left+8);if(d.hy===0)top=Math.min(grid(b.y+dy,e),bottom-8);if(d.hy===1)bottom=Math.max(grid(bottom+dy,e),top+8);
  let sx=(right-left)/b.w,sy=(bottom-top)/b.h;const corner=d.hx!==.5&&d.hy!==.5,single=d.original.length===1&&d.original[0].kind==='node'&&Shapes.kindOf(d.original[0].type)==='device';
  if(corner&&(single!==e.shiftKey)||!corner&&e.shiftKey){const s=d.hx===.5?sy:d.hy===.5?sx:Math.max(sx,sy);sx=sy=s;if(d.hx===0)left=right-b.w*s;else right=left+b.w*s;if(d.hy===0)top=bottom-b.h*s;else bottom=top+b.h*s}
  for(const old of d.original){const t=find(old.id);if(!t)continue;Object.assign(t,C.copy(old));
    if(t.kind==='node'||t.kind==='zone'||t.kind==='text'){const ob={x:old.x,y:old.y,w:old.w,h:old.h};const nx=left+(old.x-b.x)*sx,ny=top+(old.y-b.y)*sy;t.x=nx;t.y=ny;t.w=old.w*sx;t.h=old.h*sy;
      for(const l of t.labels||[]){const o2=old.labels.find(x=>x.id===l.id);if(t.kind==='zone'||t.kind==='text'){l.x=nx+(o2.x-ob.x)*(t.kind==='text'?1:Math.min(1,sx));l.y=ny+(o2.y-ob.y);if(t.kind==='text')l.wrapWidth=Math.max(30,t.w-20)}else if(o2.y>ob.y+ob.h){l.x=nx+t.w/2+(o2.x-ob.x-ob.w/2)*sx;l.y=ny+t.h+(o2.y-ob.y-ob.h)}else if(o2.y<ob.y){l.x=nx+t.w/2+(o2.x-ob.x-ob.w/2)*sx;l.y=ny+(o2.y-ob.y)}else{l.x=nx+(o2.x-ob.x)*sx;l.y=ny+(o2.y-ob.y)*sy;if(l.wrapWidth)l.wrapWidth*=sx}}}
    else{C.scale(t,b,sx,sy,false);C.move(t,left-b.x,top-b.y)}
    if(t.kind==='table'){t.cols=old.cols.map(c=>c*sx);t.rowH=Math.max(12,old.rowH*sy);t.x=left+(old.x-b.x)*sx;t.y=top+(old.y-b.y)*sy}}}

function pointerUp(e){
  const d=S.drag;if(!d)return;S.drag=null;S.guideLines=[];S.spacing=null;const p=point(e);$('canvas').style.cursor=S.mode==='pan'?'grab':S.mode==='select'?'default':'crosshair';
  if(d.kind==='box'){const q=d.current||d.start,x=Math.min(q[0],d.start[0]),y=Math.min(q[1],d.start[1]),w=Math.abs(q[0]-d.start[0]),h=Math.abs(q[1]-d.start[1]),cross=q[0]<d.start[0];if(w>2||h>2)for(const n of items()){if(!itemVisible(n,{doc:S.doc})||layerOf(n)?.locked)continue;const b=C.bounds([n]);if(cross?b.x<x+w&&b.x+b.w>x&&b.y<y+h&&b.y+b.h>y:b.x>=x&&b.y>=y&&b.x+b.w<=x+w&&b.y+b.h<=y+h){if(n.group)items().filter(t=>t.group===n.group).forEach(t=>S.selected.add(t.id));else S.selected.add(n.id)}}}
  else if(d.kind==='zone'){const q=d.current||d.start,w=Math.abs(q[0]-d.start[0]),h=Math.abs(q[1]-d.start[1]);if(w>20&&h>20)mutate(()=>{const z=C.zone('Network zone',Math.min(q[0],d.start[0]),Math.min(q[1],d.start[1]),w,h);z.layer=S.activeLayer;items().unshift(z);select([z.id])});setMode('select');if(w>20&&h>20)setTimeout(()=>editLabel(picked()[0].id,picked()[0].labels[0].id),30)}
  else if(d.kind==='textbox'){const q=d.current,w=Math.abs(q[0]-d.start[0]);const x=w>30?Math.min(q[0],d.start[0]):d.start[0],y=w>30?Math.min(q[1],d.start[1]):d.start[1];const n=mutate(()=>{const t=C.text('Text',x,y,w>30?w:240,60,14);if(w>30)t.labels[0].wrapWidth=w-20;t.layer=S.activeLayer;items().push(t);select([t.id]);return t});setMode('select');editLabel(n.id,n.labels[0].id,true)}
  else if(d.kind==='autoconn'){autoConnect(d.id,d.dir)}
  else if(d.kind==='connect'){finishConnect(d,e,p)}
  else if(d.moved){if(['bend','segment'].includes(d.kind)){const edge=find(d.id);if(edge?.kind==='edge'){if(d.pending?.candidate){const t=commitPort(d.pending);edge.points[d.index]=t.p;if(d.index===0)edge.from=t.ref;else edge.to=t.ref}if(d.pending?.glue||edge.routing==='auto'||edge.routing==='straight')Conn.markDirty(edge.id);Conn.orthogonalize(edge);edge.points=Conn.simplify(edge.points)}}
    if(d.kind==='move'&&d.rackSlot)notify('Placed at U'+Shapes.rackU(items().find(r=>r.type==='rack'&&C.inside({x:d.rackSlot.x+1,y:d.rackSlot.y+1,w:0,h:0},Shapes.rackInner(r))),{y:d.rackSlot.y,h:d.rackSlot.h})+'.',1800);
    S.snapPort=null;S.dropTarget=null;changed()}
  else if(d.kind!=='pan'&&d.kind!=='autoconn'){if(S.duplicated){changed()}else S.history.pop()}
  S.duplicated=false;S.snapPort=null;S.dropTarget=null;render()}

function finishConnect(d,e,p){
  const t=d.target||{p,ref:null};S.snapPort=null;S.dropTarget=null;
  if(!d.moved){if(S.mode==='connect'&&['hv','vh','free'].includes(S.routeStyle)){S.trace={points:[d.fromP],from:d.from,to:null,steps:[]};S.history.pop();render();return}S.history.pop();render();return}
  if(!t.ref&&d.from){quickAddMenu(e,p,d);return}
  let target=t;if(t.candidate)target=commitPort(t);
  if(target.ref&&d.from&&target.ref.node===d.from.node&&target.ref.port===d.from.port){S.history.pop();render();return}
  const edge=createEdge(d.from,target.ref,d.fromP,target.p);changed();select([edge.id]);render()}
function createEdge(from,to,a,b,mid=[]){
  const e=C.edge([a,...mid,b],from?{...from}:null,to?{...to}:null),st=S.routeStyle;e.routing=st==='curved'?'free':st;if(st==='curved'){e.curve='smooth';const dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy)||1;e.points=[a,[(a[0]+b[0])/2-dy/l*40,(a[1]+b[1])/2+dx/l*40],b]}
  Shapes.applyLinkType(e,S.linkType);e.layer=S.activeLayer;e.jumps=true;
  for(const[k,f]of[['from','fromIf'],['to','toIf']]){const r=e[k],n=r&&find(r.node),port=r?.port&&n?.ports.find(q=>q.id===r.port);if(port&&!genericPort(port.name))e[f]=port.name}
  if(['hv','vh'].includes(e.routing))Conn.orthogonalize(e);items().push(e);Conn.markDirty(e.id);return e}
function finishTrace(){const tr=S.trace;if(!tr||tr.points.length<2)return notify('Place at least two points.');mutate(()=>{const pts=C.copy(tr.points);const e=createEdge(tr.from,tr.to,pts[0],pts.at(-1),pts.slice(1,-1));e.routing=S.routeStyle;Conn.orthogonalize(e);select([e.id])});S.trace=null;S.hover=null;setMode('select')}
// AutoConnect: click a blue arrow to add a connected copy (or connect to the neighbour in that direction).
function autoConnect(id,dir){
  const n=find(id);if(!n)return;const b=C.box(n),v={up:[0,-1],down:[0,1],left:[-1,0],right:[1,0]}[dir],lab=n.labels?.[0]?C.labelMetrics(n.labels[0],resolveLabel(n,n.labels[0])).h+20:0;
  const neighbour=items().filter(m=>m.kind==='node'&&m.id!==n.id&&Shapes.kindOf(m.type)!=='rack').map(m=>{const c=C.center(m),o=C.center(n),dx=c[0]-o[0],dy=c[1]-o[1],along=dx*v[0]+dy*v[1],side=Math.abs(dx*v[1]-dy*v[0]);return{m,along,side}}).filter(x=>x.along>0&&x.side<Math.max(b.w,b.h)*.6&&x.along<420).sort((a,b)=>a.along-b.along)[0];
  remember();let target=neighbour?.m;
  if(!target){const gap=dir==='down'?110+lab*.4:dir==='up'?110+lab:130,nx=b.x+v[0]*(b.w+gap),ny=b.y+v[1]*(b.h+gap);target=C.copy(n);target.id=C.uid();target.labels.forEach(l=>{l.id=C.uid()});target.ports.forEach(q=>q.id=C.uid());target.data={...(n.data?.status?{status:n.data.status}:{})};delete target.group;delete target.url;C.move(target,nx-b.x,ny-b.y);target.x=grid(target.x);target.y=grid(target.y);if(target.labels[0])target.labels[0].text=nextName(n.labels[0].text);items().push(target)}
  const e=createEdge({node:n.id,port:null},{node:target.id,port:null},C.center(n),C.center(target));changed();select([target.id]);render()}
function nextName(s){const m=/(\d+)(\D*)$/.exec(s||'');return m?s.slice(0,m.index)+String(+m[1]+1).padStart(m[1].length,'0')+m[2]:(s?s+' 2':'')}
function quickAddMenu(e,p,d){
  const menu=$('contextMenu'),types=['switch','router','firewall','server','wap','camera','workstation','cloud'].filter(t=>Stencils?.shapes?.[t]);
  menu.innerHTML=`<div class="menuTitle">Add connected device</div><div class="quickGrid">${types.map(t=>`<button data-quick="${t}" title="${html(Shapes.nameOf(t))}">${Shapes.iconSvg(t,{size:30})}<span>${html(Shapes.nameOf(t))}</span></button>`).join('')}</div><button data-quick="">Leave unconnected end</button><button data-quick="cancel">Cancel</button>`;
  showMenu(menu,e.clientX,e.clientY);
  menu.onclick=ev=>{const b=ev.target.closest('[data-quick]');if(!b)return;menu.onclick=null;hideMenus();const type=b.dataset.quick;if(type==='cancel'){S.history.pop();render();return}
    if(!type){const edge=createEdge(d.from,null,d.fromP,[grid(p[0]),grid(p[1])]);changed();select([edge.id]);render();return}
    const n=Shapes.make(type,0,0);C.move(n,grid(p[0]-n.w/2)-n.x,grid(p[1]-n.h/2)-n.y);n.display=S.prefs.newDisplay==='symbol'?n.display:S.prefs.newDisplay;n.layer=S.activeLayer;items().push(n);createEdge(d.from,{node:n.id,port:null},d.fromP,C.center(n));changed();select([n.id]);render()}}

function onDoubleClick(e,p,t,n){
  const role=t?.dataset.role;if(n&&isLocked(n))return;
  if(role==='label'){editLabel(n.id,t.dataset.label);return}
  if(n?.kind==='edge'){if(['auto','straight'].includes(n.routing)||role==='edge'&&!S.selected.has(n.id)||e.altKey){editEdgeLabel(n);return}
    let best=Infinity,index=1,q=p;for(let i=1;i<n.points.length;i++){const a=n.points[i-1],b=n.points[i],vx=b[0]-a[0],vy=b[1]-a[1],r=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy||1))),c=[a[0]+r*vx,a[1]+r*vy],dd=Math.hypot(c[0]-p[0],c[1]-p[1]);if(dd<best){best=dd;index=i;q=c}}mutate(()=>{n.points.splice(index,0,q);S.bend={id:n.id,index}});return}
  if(n?.kind==='table'){const col=colAt(n,p[0]),row=Math.floor((p[1]-n.y)/n.rowH);if(row>=0&&row<n.rows.length&&col>=0)editCell(n,row,col);return}
  if(n?.kind==='legend'){select([n.id]);return}
  if(n){if(!n.labels?.length)mutate(()=>{const b=C.box(n);n.labels=[C.label('',b.x+b.w/2,n.kind==='node'&&Shapes.kindOf(n.type)==='device'?b.y+b.h+16:b.y+b.h/2+4)]});editLabel(n.id,n.labels[0].id);return}}
function colAt(n,x){let acc=n.x;for(let i=0;i<n.cols.length;i++){acc+=n.cols[i];if(x<acc)return i}return-1}
function editEdgeLabel(e){if(!e.labels.length)mutate(()=>{const q=Conn.pointAt(e,.5),l=C.label('',q[0],q[1]-8,11);l.anchor={t:.5,dx:0,dy:-8};l.background=true;e.labels.push(l)});editLabel(e.id,e.labels[0].id)}

// ---------- inline text editing ----------
function openEditor(x,y,value,onCommit,{width=260,mono=false}={}){
  const r=$('workarea').getBoundingClientRect(),cv=$('canvas').getBoundingClientRect(),ed=$('inlineText'),sx=cv.left-r.left+(x-S.view.x)*S.view.zoom,sy=cv.top-r.top+(y-S.view.y)*S.view.zoom;
  ed.hidden=false;ed.style.width=width+'px';ed.style.left=Math.max(8,Math.min(r.width-width-10,sx-width/2))+'px';ed.style.top=Math.max(8,Math.min(r.height-110,sy-18))+'px';ed.style.fontFamily=mono?Core.MONO:'';ed.value=value;ed.focus();ed.select();
  let done=false;const finish=commit=>{if(done)return;done=true;ed.hidden=true;ed.onblur=null;ed.onkeydown=null;if(commit&&ed.value!==value)onCommit(ed.value);render()};
  ed.onkeydown=ev=>{ev.stopPropagation();if(ev.key==='Escape'){finish(false)}else if(ev.key==='Enter'&&(ev.ctrlKey||ev.metaKey||!ev.shiftKey&&value.indexOf('\n')<0&&!ed.value.includes('\n')&&!ev.altKey&&ed.dataset.single==='1')){ev.preventDefault();finish(true)}else if(ev.key==='Tab'){ev.preventDefault();finish(true);ed.dispatchEvent(new CustomEvent('tabnext',{detail:ev.shiftKey?-1:1}))}};ed.onblur=()=>finish(true)}
function editLabel(owner,id,fresh=false){const n=find(owner),l=n?.labels?.find(x=>x.id===id);if(!l||isLocked(n))return;S.activeLabel={owner,id};S.selected=new Set([owner]);render('overlay');render('panel');$('inlineText').dataset.single='0';
  openEditor(l.x,l.y,fresh?'':l.text,v=>{if(fresh&&!v.trim()&&n.kind==='text'){pg().items=items().filter(i=>i.id!==n.id);S.selected.clear();changed();return}mutate(()=>l.text=v)},{width:Math.max(220,Math.min(420,(l.wrapWidth||0)*S.view.zoom))})}
function editCell(n,row,col){const x=n.x+n.cols.slice(0,col).reduce((a,b)=>a+b,0)+n.cols[col]/2,y=n.y+row*n.rowH+n.rowH/2;select([n.id]);$('inlineText').dataset.single='1';openEditor(x,y,String(n.rows[row][col]??''),v=>mutate(()=>{n.rows[row][col]=v}),{width:Math.max(140,n.cols[col]*S.view.zoom+20)});const ed=$('inlineText');ed.addEventListener('tabnext',ev=>{let c=col+ev.detail,r=row;if(c>=n.cols.length){c=0;r++}if(c<0){c=n.cols.length-1;r--}if(r>=0&&r<n.rows.length)setTimeout(()=>editCell(n,r,c),0)},{once:true})}

// ---------- editing operations ----------
function addNode(type,x,y,opts={}){
  if(type.startsWith('ann:'))return insertAnnotation(type.slice(4),x,y);
  const n=mutate(()=>{const n=Shapes.make(type,0,0);C.move(n,grid(x-n.w/2)-n.x,grid(y-n.h/2)-n.y);if(Shapes.kindOf(type)==='device'&&S.prefs.newDisplay!=='symbol')n.display=S.prefs.newDisplay;if(opts.image)n.image=opts.image;n.layer=S.activeLayer;applyThemeToNew(n);
    // dropped into a rack → snap to the slot under the pointer
    if(Shapes.rackItems[type]){const r=items().find(r=>r.type==='rack'&&C.inside({x,y,w:0,h:0},Shapes.rackInner(r)));if(r){const i=Shapes.rackInner(r);let ny=i.y+Math.round((n.y-i.y)/Shapes.RU)*Shapes.RU;ny=Math.max(i.y,Math.min(i.y+i.h-n.h,ny));C.move(n,i.x-n.x,ny-n.y)}}
    // dropped onto a connector → split it (Visio "drop on connector")
    const target=opts.split&&Shapes.kindOf(type)==='device'?items().find(e=>e.kind==='edge'&&!isLocked(e)&&Conn.nearestT(e,[x,y]).distance<10/S.view.zoom):null;
    items().push(n);if(target){const nb=new Map(items().map(i=>[i.id,i]));const second=C.copy(target);second.id=C.uid();second.labels=[];second.from={node:n.id,port:null};target.to={node:n.id,port:null};target.routing=target.routing==='straight'?'straight':'auto';second.routing=target.routing;second.fromIf='';target.toIf='';items().push(second);Conn.markDirty(target.id);Conn.markDirty(second.id)}
    select([n.id]);return n});if(S.mode!=='select')setMode('select');return n}
function applyThemeToNew(n){const t=Shapes.themes[S.doc.theme];if(!t||S.doc.theme==='port')return;if(Shapes.kindOf(n.type)==='device'){n.stroke=t.device.stroke==='category'?Shapes.CATEGORY[Stencils.shapes[n.type]?.cat]||'#2563eb':t.device.stroke;n.fill=t.device.fill;n.display=t.device.display}n.labels?.forEach(l=>{if(!Shapes.rackItems[n.type])l.color=t.label})}
function insertAnnotation(kind,x,y){
  if(kind==='zone'){const z=mutate(()=>{const z=C.zone('Network zone',grid(x-160),grid(y-100),320,200);z.layer=S.activeLayer;items().unshift(z);select([z.id]);return z});return z}
  if(kind==='text'){const t=mutate(()=>{const t=C.text('Text',grid(x-120),grid(y-20),240,50,14);t.layer=S.activeLayer;items().push(t);select([t.id]);return t});editLabel(t.id,t.labels[0].id,true);return t}
  if(kind==='callout'){const target=picked().find(n=>n.kind==='node');const t=mutate(()=>{const t=C.text('Callout text',grid(x),grid(y-100),190,46,12);t.fill='#ffffff';t.stroke='#64748b';t.labels[0].wrapWidth=170;if(target)t.target=target.id;t.layer=S.activeLayer;items().push(t);select([t.id]);return t});editLabel(t.id,t.labels[0].id,true);return t}
  if(kind==='table')return mutate(()=>{const t={id:C.uid(),kind:'table',x:grid(x-180),y:grid(y-60),cols:[120,120,120],rowH:24,size:11,header:true,rows:[['Column 1','Column 2','Column 3'],['','',''],['','','']],labels:[],stroke:'#94a3b8',headerFill:'#eef2f7',layer:S.activeLayer};tableLayout(t);items().push(t);select([t.id]);return t});
  if(kind==='legend')return mutate(()=>{const l={id:C.uid(),kind:'legend',x:grid(x-110),y:grid(y-80),w:220,h:160,title:'LEGEND',labels:[],counts:true,layer:S.activeLayer};items().push(l);select([l.id]);return l});
  if(kind==='title')return titleBlock();
  if(kind==='revision')return revisionTable(x,y)}
function titleBlock(){return mutate(()=>{const b=C.pageSize(pg()),m=pg().margin*C.PX,t={id:C.uid(),kind:'table',cols:[110,300],rowH:22,size:11,header:false,boldFirstCol:true,rows:[['Project','{{doc.name}}'],['Drawing','{{page.name}}'],['Company','{{doc.company}}'],['Prepared by','{{doc.author}}'],['Revision','{{doc.revision}}'],['Date','{{date}}'],['Sheet','{{page.number}} of {{page.count}}']],labels:[],stroke:'#64748b',headerFill:'#eef2f7',layer:S.activeLayer};tableLayout(t);t.x=b.w-m-t.w-10;t.y=b.h-m-t.h-10;items().push(t);select([t.id]);return t})}
function revisionTable(x,y){return mutate(()=>{const t={id:C.uid(),kind:'table',x:grid(x-200),y:grid(y-50),cols:[50,80,190,90],rowH:22,size:10.5,header:true,rows:[['Rev','Date','Description','By'],['{{doc.revision}}','{{date}}','Initial issue','{{doc.author}}'],['','','','']],labels:[],stroke:'#94a3b8',headerFill:'#eef2f7',layer:S.activeLayer};tableLayout(t);items().push(t);select([t.id]);return t})}
function erase(){
  if(S.activeLabel){const n=find(S.activeLabel.owner);if(!n||isLocked(n))return;mutate(()=>{n.labels=n.labels.filter(l=>l.id!==S.activeLabel.id);S.activeLabel=null});return}
  if(!ensureEditable())return;mutate(()=>{const gone=new Set(S.selected);pg().items=items().filter(n=>!gone.has(n.id));for(const e of items())if(e.kind==='edge')for(const k of['from','to'])if(e[k]&&gone.has(e[k].node))e[k]=null;for(const t of items())if(t.target&&gone.has(t.target))delete t.target;S.selected.clear();S.segment=null;S.bend=null})}
function copySelection(){if(!S.selected.size)return false;const set=picked(),ids=new Set(set.map(n=>n.id));for(const e of items())if(e.kind==='edge'&&!ids.has(e.id)&&e.from&&e.to&&ids.has(e.from.node)&&ids.has(e.to.node))set.push(e);S.clipboard=C.copy(set);return JSON.stringify({portClipboard:3,items:S.clipboard})}
function pasteItems(list,at=null){if(!list?.length)return;mutate(()=>{let a=C.duplicate(list,24,24);if(at){const b=C.bounds(a);a.forEach(n=>C.move(n,grid(at[0]-b.w/2)-b.x,grid(at[1]-b.h/2)-b.y))}a.forEach(n=>{if(!S.doc.layers.some(l=>l.id===n.layer))n.layer=S.activeLayer});items().push(...a);for(const e of a)if(e.kind==='edge')Conn.markDirty(e.id);S.clipboard=C.copy(a);select(a.map(n=>n.id))})}
function align(kind){const list=editable().filter(n=>n.kind!=='edge');if(list.length<2&&S.alignRef!=='page')return notify('Select at least two shapes.');if(!list.length)return;const first=find([...S.selected].find(id=>find(id)?.kind!=='edge')),m=pg().margin*C.PX,ps=C.pageSize(pg()),b=S.alignRef==='page'?{x:m,y:m,w:ps.w-2*m,h:ps.h-2*m}:S.alignRef==='selection'?C.bounds(list):C.bounds([first]);mutate(()=>list.forEach(n=>{const nb=C.box(n);let dx=0,dy=0;if(kind===0)dx=b.x-nb.x;if(kind===1)dx=b.x+b.w/2-nb.x-nb.w/2;if(kind===2)dx=b.x+b.w-nb.x-nb.w;if(kind===3)dy=b.y-nb.y;if(kind===4)dy=b.y+b.h/2-nb.y-nb.h/2;if(kind===5)dy=b.y+b.h-nb.y-nb.h;C.move(n,dx,dy)}))}
function distribute(axis){const a=editable().filter(n=>n.kind!=='edge'&&n.kind!=='zone');if(a.length<3)return notify('Select at least three shapes to distribute.');mutate(()=>{const size=axis==='x'?'w':'h';a.sort((p,q)=>p[axis]-q[axis]);const begin=a[0][axis],end=a.at(-1)[axis]+a.at(-1)[size],gap=(end-begin-a.reduce((s,n)=>s+n[size],0))/(a.length-1);let pos=begin;for(const n of a){C.move(n,axis==='x'?pos-n[axis]:0,axis==='y'?pos-n[axis]:0);pos+=n[size]+gap}})}
function sameSize(axis){const list=editable().filter(n=>n.kind==='node'||n.kind==='zone'||n.kind==='text'),ref=find([...S.selected][0]);if(list.length<2||!ref||ref.kind==='edge')return notify('Select two or more shapes; the first selected sets the size.');mutate(()=>list.forEach(n=>{const b=C.box(n);if(axis!=='h'){n.w=ref.w}if(axis!=='w'){n.h=ref.h}const dx=(n.w-b.w)/2;(n.labels||[]).forEach(l=>{if(n.kind==='node')l.x+=dx;if(n.kind==='node'&&l.y>b.y+b.h)l.y+=n.h-b.h})}))}
function order(where){if(!ensureEditable())return;mutate(()=>{const sel=picked(),rest=items().filter(n=>!S.selected.has(n.id));if(where==='front')pg().items=[...rest,...sel];else if(where==='back')pg().items=[...sel,...rest];else{const arr=items(),dir=where==='forward'?1:-1;const idx=arr.map((n,i)=>S.selected.has(n.id)?i:-1).filter(i=>i>=0);if(dir>0)idx.reverse();for(const i of idx){const j=i+dir;if(j<0||j>=arr.length||S.selected.has(arr[j].id))continue;[arr[i],arr[j]]=[arr[j],arr[i]]}}})}
function wrapInZone(){const list=editable().filter(n=>n.kind!=='edge');if(!list.length)return notify('Select the devices to wrap in a zone.');const b=C.bounds(list,true);mutate(()=>{const z=C.zone('Network zone',grid(b.x-30),grid(b.y-50),grid(b.w+60),grid(b.h+80));z.layer=S.activeLayer;const first=items().findIndex(n=>list.includes(n));items().splice(Math.max(0,first),0,z);select([z.id])});const z=picked()[0];editLabel(z.id,z.labels[0].id)}
function fitZone(){const zones=editable().filter(n=>n.kind==='zone');if(!zones.length)return notify('Select a zone.');mutate(()=>{for(const z of zones){const members=items().filter(n=>n!==z&&n.kind!=='edge'&&n.kind!=='zone'&&C.overlaps(C.box(n),C.box(z)));if(!members.length)continue;const b=C.bounds(members,true),nx=b.x-30,ny=b.y-50,dx=nx-z.x,dy=ny-z.y;z.labels.forEach(l=>{l.x+=dx;l.y+=dy});z.x=nx;z.y=ny;z.w=b.w+60;z.h=b.h+80}})}
function setLayer(id){if(!ensureEditable())return;mutate(()=>picked().forEach(n=>n.layer=id));notify('Moved to layer “'+(S.doc.layers.find(l=>l.id===id)?.name)+'”.')}
function applyPainter(n){const c=S.copiedStyle;if(!c)return;const targets=n.group?items().filter(x=>x.group===n.group):[n];mutate(()=>{for(const t of targets){if(isLocked(t))continue;if(t.kind===c.kind||c.kind==='node'&&t.kind==='node'){for(const[k,v]of Object.entries(c.appearance))t[k]=C.copy(v)}else if(c.appearance.stroke)t.stroke=c.appearance.stroke;if(c.label)t.labels?.forEach(l=>Object.assign(l,C.copy(c.label)))}})}
function copyFormat(){const n=picked()[0];if(!n)return notify('Select a source shape or connector.');const keys=n.kind==='edge'?['stroke','strokeWidth','dash','double','curve','startMarker','endMarker','jumps','linkType','routing']:n.kind==='zone'?['stroke','fill','strokeWidth','dash','style','headerFill']:['stroke','fill','strokeWidth','display','dash'];const appearance={};keys.forEach(k=>{if(n[k]!==undefined)appearance[k]=C.copy(n[k])});const l=S.activeLabel?find(S.activeLabel.owner)?.labels.find(x=>x.id===S.activeLabel.id):n.labels?.[0];S.copiedStyle={kind:n.kind,appearance,label:l?{size:l.size,color:l.color,bold:!!l.bold,italic:!!l.italic,background:!!l.background,font:l.font}:null};return true}
function followLink(url){if(url.startsWith('#page:')){const i=S.doc.pages.findIndex(p=>p.id===url.slice(6));if(i>=0)gotoPage(i);return}window.open(url,'_blank','noopener')}
function gotoPage(i){S.pageIndex=i;clearTransient();S.analysis=null;fit();render()}

// ---------- view ----------
function fit(selection=false){const svg=$('canvas'),cw=svg.clientWidth||900,ch=svg.clientHeight||600;const all=items();let b=selection&&S.selected.size?C.bounds(picked(),true):{x:0,y:0,...C.pageSize(pg())};if(!selection&&all.length){const e=C.bounds(all,true);if(e.x<0||e.y<0||e.x+e.w>b.w||e.y+e.h>b.h){const x=Math.min(0,e.x),y=Math.min(0,e.y);b={x,y,w:Math.max(b.w,e.x+e.w)-x,h:Math.max(b.h,e.y+e.h)-y}}}const pad=selection?60:30,z=Math.min(cw/(b.w+pad*2),ch/(b.h+pad*2));S.view.zoom=Math.max(.05,Math.min(8,z));S.view.x=b.x+b.w/2-cw/2/S.view.zoom;S.view.y=b.y+b.h/2-ch/2/S.view.zoom;render()}
function zoomAt(factor,p=null){const svg=$('canvas'),cw=svg.clientWidth,ch=svg.clientHeight;p=p||[S.view.x+cw/2/S.view.zoom,S.view.y+ch/2/S.view.zoom];const z=Math.max(.05,Math.min(8,S.view.zoom*factor)),k=S.view.zoom/z;S.view.x=p[0]-(p[0]-S.view.x)*k;S.view.y=p[1]-(p[1]-S.view.y)*k;S.view.zoom=z;render('scene');render('overlay')}
function setZoom(z){zoomAt(z/S.view.zoom)}
function updateCursorReadout(p){const e=$('cursorPos');if(e)e.textContent=`${(p[0]/C.PX).toFixed(1)} , ${(p[1]/C.PX).toFixed(1)} mm`}

// ---------- menus ----------
function showMenu(menu,x,y){menu.hidden=false;const r=menu.getBoundingClientRect();menu.style.left=Math.max(4,Math.min(x,innerWidth-r.width-6))+'px';menu.style.top=Math.max(4,Math.min(y,innerHeight-r.height-6))+'px'}
function hideMenus(){for(const id of['contextMenu','fileMenu','dropMenu'])if($(id))$(id).hidden=true}

// ---------- keyboard ----------
function onKey(e){
  const tag=document.activeElement?.tagName;if(['INPUT','TEXTAREA','SELECT'].includes(tag)||document.activeElement?.isContentEditable||document.querySelector('dialog[open]'))return;
  const k=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  if(document.body.classList.contains('presenting')){if(k==='escape')actions.present();else if(['arrowright','pagedown',' '].includes(k))presentStep(1);else if(['arrowleft','pageup'].includes(k))presentStep(-1);return}
  if(mod){const map={z:()=>e.shiftKey?redo():undo(),y:redo,a:()=>{select(items().filter(n=>itemVisible(n,{doc:S.doc})&&!layerOf(n)?.locked).map(n=>n.id))},d:actions.duplicate,s:()=>e.shiftKey?saveAs():save(),o:actions.open,p:actions.print,g:()=>e.shiftKey?actions.ungroup():actions.group(),f:actions.find,h:actions.find,k:actions.palette,l:()=>e.shiftKey?actions.unlock():actions.lock(),']':()=>order(e.shiftKey?'front':'forward'),'[':()=>order(e.shiftKey?'back':'backward'),'=':()=>zoomAt(1.2),'+':()=>zoomAt(1.2),'-':()=>zoomAt(1/1.2),'0':()=>fit(),'1':()=>setZoom(1),e:actions.exportPng,b:()=>actions.bold(),i:()=>actions.italic()};
    if(map[k]){e.preventDefault();map[k]();return}if(['c','x','v'].includes(k))return;return}
  if(e.code==='Space'){e.preventDefault();if(!S.space){S.space=true;$('canvas').style.cursor='grab'}return}
  if(k==='escape'){if(S.drag&&S.history.length&&!['box','pan','zone','textbox'].includes(S.drag.kind)){const s=S.history.pop();S.drag=null;restore(s)}S.drag=null;hideMenus();if(S.analysis||S.highlights.size||S.filter){S.analysis=null;S.highlights.clear();setFilter(null);render();return}setMode('select');S.selected.clear();S.activeLabel=null;S.painter=false;$('printPreview').hidden=true;render();return}
  if(S.mode==='connect'&&S.trace&&k==='backspace'){e.preventDefault();if(S.trace.steps.length)S.trace.points.splice(S.trace.steps.pop());else S.trace=null;render('overlay');return}
  if(k==='enter'&&S.mode==='connect'&&S.trace){finishTrace();return}
  if((k==='enter'||k==='f2')&&S.selected.size===1){e.preventDefault();const n=picked()[0];if(n.kind==='edge')editEdgeLabel(n);else if(n.kind==='table')editCell(n,0,0);else onDoubleClick(e,C.center(n),null,n);return}
  if(['delete','backspace'].includes(k)){e.preventDefault();if(S.segment)actions.deleteSegment();else if(S.bend)actions.deleteBend();else erase();return}
  if(k.startsWith('arrow')&&S.selected.size){e.preventDefault();if(!ensureEditable())return;const s=e.shiftKey?10:1,dx=k==='arrowright'?s:k==='arrowleft'?-s:0,dy=k==='arrowdown'?s:k==='arrowup'?-s:0;mutate(()=>{if(S.activeLabel){const l=find(S.activeLabel.owner).labels.find(x=>x.id===S.activeLabel.id);if(l.anchor){l.anchor.dx+=dx;l.anchor.dy+=dy}else{l.x+=dx;l.y+=dy}}else moveSet([...S.selected]).forEach(n=>C.move(n,dx,dy))});return}
  if(e.shiftKey&&k==='!'||e.shiftKey&&e.code==='Digit1'){fit();return}if(e.shiftKey&&(k==='@'||e.code==='Digit2')){fit(true);return}
  const tools={v:'select',c:'connect',z:'zone',t:'text',p:'port',h:'pan'};if(tools[k]&&!e.shiftKey&&!e.altKey){setMode(tools[k]);return}
  if(k==='?'){actions.shortcuts();return}
  if(k==='l'&&!e.shiftKey){actions.layoutHier();return}
  if(k==='f'&&!e.shiftKey){fit(S.selected.size>0);return}}
