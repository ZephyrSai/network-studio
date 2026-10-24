// Scene rendering. One renderer serves the editor canvas, background pages, exports, print and thumbnails.
let RCTX=null; // context of the scene currently being drawn (for {{field}} substitution)

function layerOf(n,doc=S.doc){return doc.layers.find(l=>l.id===n.layer)||doc.layers[0]}
function itemVisible(n,ctx){const L=layerOf(n,ctx.doc);if(L&&L.visible===false)return false;if(ctx.print&&L&&L.print===false)return false;return true}
function makeCtx(page,{doc=S.doc,interactive=false,print=false,prefix='v',tag=false,fieldPage=null}={}){
  const pageIndex=doc.pages.indexOf(page),fg=doc.pages.filter(p=>!p.isBackground),fp=fieldPage||page;
  return{doc,page,fieldPage:fp,interactive,print,prefix,tag,pageIndex,pageNumber:Math.max(1,fg.indexOf(fp)+1),pageCount:fg.length,byId:new Map(page.items.map(n=>[n.id,n])),colors:colorMap(doc,page),bg:page.bg||'#ffffff',dim:interactive?S.filterFn:null,analysis:interactive?S.analysis:null}}

// ---------- {{field}} substitution ----------
function resolveLabel(owner,l,ctx=RCTX){
  const text=l.text??'';if(!text.includes('{{'))return text;ctx??=makeCtx(pg());const d=ctx.doc,p=ctx.fieldPage||ctx.page;
  return Core.fillFields(text,k=>{
    if(k==='date')return new Date().toLocaleDateString('en-GB');
    if(k.startsWith('doc.')){const key=k.slice(4);return key==='name'?d.name:d.meta?.[key]??''}
    if(k.startsWith('page.')){const key=k.slice(5);return key==='name'?p.name:key==='number'?ctx.pageNumber:key==='count'?ctx.pageCount:p[key]}
    if(!owner)return null;if(k==='type')return Shapes.nameOf(owner.type);if(k==='name')return owner.labels?.[0]&&owner.labels[0]!==l?resolveLabel(owner,owner.labels[0],ctx):owner.data?.hostname??'';
    if(k==='rackU'){const r=rackOf(owner,ctx.page);return r?'U'+Shapes.rackU(r,owner):''}
    return owner.data?.[k]??''})}
Core.setResolver((owner,l)=>resolveLabel(owner,l,RCTX));
// data lines shown under device names count as part of the label when routing around it
Conn.setLabelExtra(n=>{const d=(RCTX?.doc||S.doc)?.display;if(!d?.fields?.length||!Shapes.isDevice(n)||Shapes.rackItems[n.type])return 0;const k=d.fields.filter(f=>n.data?.[f]!==undefined&&String(n.data[f]).trim()!=='').length;return k?k*(n.labels[0].size*.84*1.22)+2:0});

// ---------- colour by data ("data graphics") ----------
function colorMap(doc,page){const key=doc.display?.colorBy;if(!key)return null;const map=new Map();
  if(key==='_category'){for(const[k,v]of Object.entries(Shapes.CATEGORY))map.set(k,v);return{key,map}}
  if(key==='vlan')for(const v of doc.vlans||[])if(v.color)map.set(String(v.id),v.color);
  if(key==='status')for(const[k,v]of Object.entries(Shapes.STATUS))map.set(k,v);
  const values=[...new Set(doc.pages.flatMap(p=>p.items).filter(n=>n.kind==='node').map(n=>String(n.data?.[key]??'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  let i=0;for(const v of values)if(!map.has(v))map.set(v,Shapes.PALETTE[i++%Shapes.PALETTE.length]);return{key,map}}
function colorFor(n,ctx){const c=ctx.colors;if(!c||!Shapes.isDevice(n))return null;if(c.key==='_category')return c.map.get(Stencils?.shapes?.[n.type]?.cat)||null;const v=String(n.data?.[c.key]??'');return v?c.map.get(v)||null:'#cbd5e1'}

// ---------- icon templates (parsed once, cloned per render) ----------
const iconCache=new Map();
function iconTemplate(type){let t=iconCache.get(type);if(t)return t;const s=Stencils?.shapes?.[type];if(!s)return null;t=el('g');t.innerHTML=s.svg;iconCache.set(type,t);return t}

function drawScene(parent,page,ctx){
  RCTX=ctx;const list=page.items.filter(n=>itemVisible(n,ctx));
  const band=n=>n.kind==='zone'?0:n.kind==='node'&&n.type==='rack'?1:n.kind==='edge'?2:n.kind==='node'&&Shapes.rackItems[n.type]?3:4;
  const area=n=>n.kind==='zone'?-(n.w*n.h):0,ordered=list.map((n,i)=>[n,i]).sort((a,b)=>band(a[0])-band(b[0])||area(a[0])-area(b[0])||a[1]-b[1]).map(a=>a[0]);
  const defs=el('defs',{},parent),edgesSoFar=[],zones=list.filter(n=>n.kind==='zone'&&n.fill&&n.fill!=='none').sort((a,b)=>a.w*a.h-b.w*b.h);
  ctx.bgAt=(x,y)=>{for(const z of zones)if(x>=z.x&&x<=z.x+z.w&&y>=z.y&&y<=z.y+z.h)return z.fill;return ctx.bg};
  for(const n of ordered){
    const dim=ctx.dim&&!ctx.dim(n);
    const g=el('g',{'data-id':ctx.interactive||ctx.tag?n.id:null,opacity:dim?.16:n.opacity??null},parent);
    if(n.kind==='edge'){Conn.placeLabels(n);drawEdge(n,g,defs,ctx,edgesSoFar);edgesSoFar.push(n)}
    else if(n.kind==='zone')drawZone(n,g,ctx);
    else if(n.kind==='node')drawNode(n,g,ctx);
    else if(n.kind==='text')drawTextItem(n,g,ctx);
    else if(n.kind==='table')drawTable(n,g,ctx);
    else if(n.kind==='legend')drawLegend(n,g,ctx,page);
    for(const l of n.labels||[])drawLabel(n,l,g,ctx);
    if(n.kind==='node')drawDataLines(n,g,ctx);
  }
  RCTX=null}

function hitRect(n,parent,ctx,x=0,y=0,w=n.w,h=n.h){if(ctx.interactive)el('rect',{x,y,width:w,height:h,fill:'transparent','data-id':n.id,'data-role':'object'},parent)}

function drawNode(n,g,ctx){
  const t=el('g',{transform:`translate(${n.x+n.w/2} ${n.y+n.h/2})${n.rotation?` rotate(${n.rotation})`:''}${n.flipX||n.flipY?` scale(${n.flipX?-1:1} ${n.flipY?-1:1})`:''} translate(${-n.w/2} ${-n.h/2})`},g);
  const kind=Shapes.kindOf(n.type),accent=colorFor(n,ctx)||n.stroke||'#2f5ea8',w=n.w,h=n.h;
  if(n.image){if(n.display==='card')el('rect',{x:0,y:0,width:w,height:h,rx:8,fill:n.fill||'#fff',stroke:accent,'stroke-width':1},t);el('image',{href:n.image,x:n.display==='card'?6:0,y:n.display==='card'?6:0,width:n.display==='card'?w-12:w,height:n.display==='card'?h-12:h,preserveAspectRatio:'xMidYMid meet'},t)}
  else if(kind==='basic'){const b=Shapes.basic[n.type];for(const p of b.paths(w,h))el('path',{d:p.d,fill:p.open||n.fill==='none'?'none':n.fill||'#fff',stroke:accent,'stroke-width':n.strokeWidth??1.75,'stroke-dasharray':n.dash||null,'stroke-linejoin':'round'},t)}
  else if(kind==='rack')Shapes.drawRack(n,t);
  else if(kind==='rackitem')Shapes.drawFace({...n,stroke:colorFor(n,ctx)||n.stroke},t);
  else{
    const s=Stencils?.shapes?.[n.type],mode=n.display||'symbol';
    if(mode==='card')el('rect',{x:0,y:0,width:w,height:h,rx:Math.min(10,w*.15),fill:n.fill||'#fff',stroke:accent,'stroke-width':1.2,'stroke-opacity':.55},t);
    else if(mode==='tile')el('rect',{x:0,y:0,width:w,height:h,rx:Math.min(w,h)*.2,fill:accent},t);
    else if(mode==='circle')el('ellipse',{cx:w/2,cy:h/2,rx:w/2,ry:h/2,fill:accent},t);
    const inset=mode==='card'?.15:mode==='tile'?.16:mode==='circle'?.22:0,tpl=iconTemplate(n.type);
    if(tpl&&s){const box=el('svg',{x:w*inset,y:h*inset,width:w*(1-2*inset),height:h*(1-2*inset),viewBox:s.vb,preserveAspectRatio:'xMidYMid meet',overflow:'visible'},t);const solid=mode==='tile'||mode==='circle';const ig=tpl.cloneNode(true);ig.setAttribute('fill',solid?accent:n.fill||'#fff');ig.setAttribute('stroke','currentColor');ig.setAttribute('color',solid?'#ffffff':accent);ig.setAttribute('stroke-width',n.strokeWidth??2);ig.setAttribute('stroke-linecap','round');ig.setAttribute('stroke-linejoin','round');box.append(ig)}
    else el('rect',{x:2,y:2,width:w-4,height:h-4,rx:6,fill:n.fill||'#fff',stroke:accent,'stroke-width':1.5,'stroke-dasharray':'4 3'},t);
    if(n.data?.status==='To remove'&&ctx.doc.display?.statusMarks!==false)el('path',{d:`M4 4L${w-4} ${h-4}M${w-4} 4L4 ${h-4}`,stroke:'#dc2626','stroke-width':2.5,'stroke-linecap':'round',opacity:.85},t);
  }
  if(n.data?.status==='Planned'&&ctx.doc.display?.statusMarks!==false&&kind==='device')el('rect',{x:-4,y:-4,width:w+8,height:h+8,rx:8,fill:'none',stroke:'#2563eb','stroke-width':1.2,'stroke-dasharray':'4 3'},t);
  hitRect(n,t,ctx);
  if(ctx.interactive&&n.url){const b=el('g',{transform:`translate(${n.x+n.w-4} ${n.y-2})`,'pointer-events':'none'},g);el('circle',{cx:0,cy:0,r:6.5,fill:'#fff',stroke:'#376be5'},b);el('path',{d:'M-2.5 1.5l5-5M-1 -3.5h3.5V0',stroke:'#376be5','stroke-width':1.3,fill:'none'},b)}
}
function rackOf(n,page){if(!Shapes.rackItems[n.type])return null;const b=Core.box(n),c=[b.x+b.w/2,b.y+b.h/2];return page.items.find(r=>r.kind==='node'&&r.type==='rack'&&Core.inside({x:c[0],y:c[1],w:0,h:0},Shapes.rackInner(r)))||null}

function drawDataLines(n,g,ctx){
  const keys=ctx.doc.display?.fields;if(!keys?.length||!Shapes.isDevice(n)||Shapes.rackItems[n.type]||!n.labels?.length)return;
  const vals=keys.map(k=>n.data?.[k]).filter(v=>v!==undefined&&v!==null&&String(v).trim()!=='');if(!vals.length)return;
  const l=n.labels[0],m=Core.labelMetrics(l,resolveLabel(n,l,ctx)),size=Math.max(7,l.size*.84),lh=size*1.22,y=l.y+m.top+m.h+size*.95;
  const hb=ctx.bgAt?ctx.bgAt(l.x,y):ctx.bg,dw=Math.max(...vals.map(v=>Core.textWidth(String(v),size))),dl=l.align==='start'?l.x:l.align==='end'?l.x-dw:l.x-dw/2;el('rect',{x:dl-2,y:y-size,width:dw+4,height:(vals.length-1)*lh+size*1.25,rx:2,fill:hb,'pointer-events':'none'},g);const t=el('text',{x:l.x,y,'text-anchor':l.align||'middle','font-family':Core.FONT,'font-size':size,fill:l.color||'#34465e','fill-opacity':.75,'pointer-events':'none'},g);
  vals.forEach((v,i)=>{const s=el('tspan',{x:l.x,dy:i?lh:0},t);s.textContent=String(v)})}

function drawZone(n,g,ctx){
  const r=n.rx??8,st=n.style||'plain',common={stroke:n.stroke,'stroke-width':n.strokeWidth??1.5,'stroke-dasharray':n.dash||null};
  if(st==='tab'){const tw=Math.min(n.w*.6,Math.max(120,Core.textWidth(resolveLabel(n,n.labels?.[0]||{text:''},ctx),15,true)+36)),th=30;el('path',{d:`M${n.x} ${n.y+th}V${n.y+6}Q${n.x} ${n.y} ${n.x+6} ${n.y}H${n.x+tw-8}L${n.x+tw+6} ${n.y+th}`,fill:n.headerFill||n.stroke,'fill-opacity':.22,...common},g);el('rect',{x:n.x,y:n.y+th,width:n.w,height:n.h-th,rx:4,fill:n.fill||'none',...common},g)}
  else{el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:r,fill:st==='outline'?'none':n.fill||'#eef4fb',...common},g);
    if(st==='header'){const hh=Math.min(36,n.h/3);el('path',{d:`M${n.x} ${n.y+hh}V${n.y+r}Q${n.x} ${n.y} ${n.x+r} ${n.y}H${n.x+n.w-r}Q${n.x+n.w} ${n.y} ${n.x+n.w} ${n.y+r}V${n.y+hh}Z`,fill:n.headerFill||n.stroke,'fill-opacity':n.headerFill?1:.3,stroke:'none'},g)}}
  if(ctx.interactive)el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:r,fill:'transparent',stroke:'transparent','stroke-width':10,'data-id':n.id,'data-role':'object'},g);
  if(n.showMeta!==false&&(n.data?.subnet||n.data?.vlan)){const t=el('text',{x:n.x+n.w-12,y:n.y+22,'text-anchor':'end','font-family':Core.FONT,'font-size':11,fill:n.labels?.[0]?.color||'#475569','fill-opacity':.8,'pointer-events':'none'},g);t.textContent=[n.data.vlan?'VLAN '+n.data.vlan:'',n.data.subnet||''].filter(Boolean).join(' · ')}
}

function drawTextItem(n,g,ctx){
  if(n.target){const tgt=ctx.byId.get(n.target);if(tgt&&itemVisible(tgt,ctx)){const c=[n.x+n.w/2,n.y+n.h/2],tb=Core.box(tgt),tc=[tb.x+tb.w/2,tb.y+tb.h/2];const a=Conn.boundaryPoint({...n,display:''},tc),b=Conn.boundaryPoint(tgt,c);el('path',{d:`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`,stroke:n.stroke||'#64748b','stroke-width':1.3,fill:'none'},g);el('circle',{cx:b[0],cy:b[1],r:3,fill:n.stroke||'#64748b'},g)}}
  if(n.fill||n.stroke)el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:n.rx??6,fill:n.fill||'none',stroke:n.stroke||'none','stroke-width':n.strokeWidth??1,'stroke-dasharray':n.dash||null},g);
  hitRect(n,g,ctx,n.x,n.y)}

function tableLayout(n){n.w=n.cols.reduce((a,b)=>a+b,0);n.h=Math.max(1,n.rows.length)*n.rowH}
function fitText(s,size,max,bold){if(Core.textWidth(s,size,bold)<=max)return s;let lo=0,hi=s.length;while(lo<hi){const mid=(lo+hi+1)>>1;if(Core.textWidth(s.slice(0,mid)+'…',size,bold)<=max)lo=mid;else hi=mid-1}return s.slice(0,lo)+'…'}
function drawTable(n,g,ctx){
  tableLayout(n);const s=n.stroke||'#94a3b8',size=n.size||11;el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,fill:n.fill||'#fff',stroke:s,'stroke-width':1},g);
  n.rows.forEach((row,r)=>{const y=n.y+r*n.rowH,head=n.header!==false&&r===0;if(head)el('rect',{x:n.x,y,width:n.w,height:n.rowH,fill:n.headerFill||'#eef2f7'},g);if(r)el('line',{x1:n.x,y1:y,x2:n.x+n.w,y2:y,stroke:s,'stroke-width':.7},g);
    let x=n.x;n.cols.forEach((cw,c)=>{if(c)el('line',{x1:x,y1:n.y,x2:x,y2:n.y+n.h,stroke:s,'stroke-width':.7},g);const v=resolveLabel(null,{text:String(row[c]??'')},ctx),t=el('text',{x:x+6,y:y+n.rowH/2+size*.36,'font-family':Core.FONT,'font-size':size,'font-weight':head||(n.boldFirstCol&&c===0)?650:400,fill:n.color||'#1e293b','pointer-events':'none'},g);t.textContent=fitText(v,size,cw-10,head);x+=cw})});
  if(ctx.interactive){el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,fill:'transparent','data-id':n.id,'data-role':'object'},g)}}

function legendRows(n,page,ctx){
  const rows=[],count=new Map(),links=new Map(),items=page.items.filter(i=>itemVisible(i,ctx));
  if(n.devices!==false)for(const i of items)if(i.kind==='node'&&Shapes.isDevice(i)&&i.type!=='image'){const k=i.type;count.set(k,(count.get(k)||0)+1)}
  if(n.links!==false)for(const i of items)if(i.kind==='edge'){const k=Shapes.linkTypes[i.linkType]?i.linkType:'_'+i.stroke+'|'+(i.dash||'')+'|'+(i.double?1:0);const e=links.get(k)||{n:0,e:i};e.n++;links.set(k,e)}
  for(const[k,c]of[...count].sort((a,b)=>Shapes.nameOf(a[0]).localeCompare(Shapes.nameOf(b[0]))))rows.push({kind:'device',type:k,text:Shapes.nameOf(k),count:c});
  for(const[k,v]of links)rows.push({kind:'link',edge:v.e,text:Shapes.linkTypes[k]?.name||'Connector',count:v.n});
  if(n.colors!==false&&ctx.colors&&ctx.colors.key!=='_category'){const used=new Set(ctx.doc.pages.flatMap(p=>p.items).map(i=>String(i.data?.[ctx.colors.key]??'')));for(const[k,v]of ctx.colors.map)if(used.has(k))rows.push({kind:'swatch',color:v,text:(ctx.doc.fields.find(f=>f.key===ctx.colors.key)?.label||ctx.colors.key)+': '+k})}
  return rows}
function legendMeasure(n,page,ctx){const rows=legendRows(n,page,ctx),size=11.5,counts=n.counts!==false,per=Math.max(3,n.maxRows||8),cols=Math.max(1,Math.ceil(rows.length/per)),inCol=Math.ceil(rows.length/cols)||1,cw=Math.max(150,...rows.map(r=>Core.textWidth(r.text+(counts&&r.count?'  ×'+r.count:''),size)+86));n.w=Math.max(n.minW||0,cols*cw+12);n.h=44+inCol*24+4;return{rows,size,counts,cols,inCol,cw}}
function drawLegend(n,g,ctx,page){
  const{rows,size,counts,inCol,cw}=legendMeasure(n,page,ctx),rh=24;
  el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:6,fill:n.fill||ctx.bg,stroke:n.stroke||'#a2b2c6','stroke-width':1},g);
  const title=el('text',{x:n.x+14,y:n.y+24,'font-family':Core.FONT,'font-size':13,'font-weight':700,fill:n.color||'#34465e','letter-spacing':.6},g);title.textContent=n.title||'LEGEND';
  rows.forEach((r,i)=>{const col=Math.floor(i/inCol),x0=n.x+6+col*cw,y=n.y+38+(i%inCol)*rh,cy=y+rh/2;
    if(col)el('line',{x1:x0-3,y1:n.y+38,x2:x0-3,y2:n.y+n.h-8,stroke:n.stroke||'#a2b2c6','stroke-opacity':.5},g);
    if(r.kind==='device'){const holder=el('g',{transform:`translate(${x0+8} ${y+2})`},g);holder.innerHTML=Shapes.iconSvg(r.type,{size:30,display:'symbol',accent:ctx.doc.theme==='noc'||ctx.doc.theme==='blueprint'?'#7dd3fc':'#2f5ea8',fill:ctx.bg})}
    else if(r.kind==='link'){const e=r.edge,d=`M${x0+8} ${cy}H${x0+42}`;if(e.double){el('path',{d,stroke:e.stroke,'stroke-width':(e.strokeWidth||2)*2.6},g);el('path',{d,stroke:ctx.bg,'stroke-width':(e.strokeWidth||2)*1.05},g)}else el('path',{d,stroke:e.stroke,'stroke-width':e.strokeWidth||2,'stroke-dasharray':e.dash||null},g)}
    else el('rect',{x:x0+14,y:cy-7,width:22,height:14,rx:3,fill:r.color},g);
    const t=el('text',{x:x0+54,y:cy+4,'font-family':Core.FONT,'font-size':size,fill:n.color||'#34465e'},g);t.textContent=r.text;
    if(counts&&r.count){const c=el('text',{x:x0+cw-14,y:cy+4,'text-anchor':'end','font-family':Core.FONT,'font-size':size,fill:n.color||'#34465e','fill-opacity':.6},g);c.textContent='×'+r.count}});
  if(ctx.interactive)el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,fill:'transparent','data-id':n.id,'data-role':'object'},g)}

function markerDef(e,type,side,defs,ctx,color){if(!type||type==='none')return null;const id=`${ctx.prefix}-m-${e.id}-${side}`,m=el('marker',{id,viewBox:'-8 -6 12 12',refX:0,refY:0,markerWidth:7,markerHeight:7,markerUnits:'strokeWidth',orient:'auto-start-reverse',overflow:'visible'},defs);
  if(type==='dot')el('circle',{cx:-2,cy:0,r:3.2,fill:color},m);else if(type==='circle')el('circle',{cx:-3,cy:0,r:3,fill:ctx.bg,stroke:color,'stroke-width':1.3},m);else if(type==='diamond')el('path',{d:'M0 0L-4 -3L-8 0L-4 3Z',fill:color},m);else if(type==='openArrow')el('path',{d:'M-7 -4L0 0L-7 4',fill:'none',stroke:color,'stroke-width':1.4},m);else if(type==='bar')el('path',{d:'M-1 -4.5V4.5',stroke:color,'stroke-width':1.6},m);else el('path',{d:'M1 0L-7 -4L-7 4Z',fill:color},m);return`url(#${id})`}
function drawEdge(e,g,defs,ctx,before){
  const d=Conn.path(e,before,ctx.doc.display?.jumpStyle||'arc'),w=e.strokeWidth||2,load=ctx.analysis?.loads?.get(e.id),color=load?load.color:e.stroke||'#4a6fa5';
  if(ctx.interactive)el('path',{d,fill:'none',stroke:'transparent','stroke-width':Math.max(12,w+10),'data-id':e.id,'data-role':'edge'},g);
  const ms=markerDef(e,e.startMarker,'s',defs,ctx,color),me=markerDef(e,e.endMarker,'e',defs,ctx,color);
  if(e.double){el('path',{d,fill:'none',stroke:color,'stroke-width':w*2.6,'stroke-linejoin':'round','pointer-events':'none'},g);el('path',{d,fill:'none',stroke:ctx.bg,'stroke-width':w*1.05,'stroke-linejoin':'round','pointer-events':'none'},g);if(ms||me)el('path',{d,fill:'none',stroke:'transparent','stroke-width':w*1.6,'marker-start':ms,'marker-end':me,'pointer-events':'none'},g)}
  else el('path',{d,fill:'none',stroke:color,'stroke-width':w,'stroke-dasharray':e.dash||null,'stroke-linejoin':'round','stroke-linecap':e.dash?'butt':'round','marker-start':ms,'marker-end':me,'pointer-events':'none'},g);
  if(ctx.doc.display?.showIfLabels!==false)for(const[key,txt]of[['from',e.fromIf],['to',e.toIf]]){if(!txt)continue;const att=e[key]&&ctx.byId.get(e[key].node);let off=18;if(att?.labels?.[0]){const end=key==='from'?e.points[0]:e.points.at(-1),l0=att.labels[0];if(l0.y>att.y+att.h&&end[1]>=att.y+att.h-1){const lm=Core.labelMetrics(l0,resolveLabel(att,l0,ctx));off=Math.max(off,l0.y+lm.top+lm.h-(att.y+att.h)+16)}}const p=Conn.endLabelPos(e,key,off,att?Core.center(att):null);if(!p)continue;const t=el('text',{x:p.x,y:p.y,'text-anchor':p.anchor,'font-family':Core.FONT,'font-size':9,fill:ctx.doc.theme==='noc'||ctx.doc.theme==='blueprint'?'#e2e8f0':'#334155',stroke:ctx.bg,'stroke-width':3,'paint-order':'stroke','stroke-linejoin':'round','pointer-events':'none'},g);t.textContent=txt}
}

function drawLabel(owner,l,parent,ctx){
  const text=resolveLabel(owner,l,ctx);if(!text&&!ctx.interactive)return;const m=Core.labelMetrics(l,text||' ');
  const g=el('g',{transform:l.rotation?`rotate(${l.rotation} ${l.x} ${l.y})`:null,'data-id':ctx.interactive?owner.id:null,'data-role':ctx.interactive?'label':null,'data-label':ctx.interactive||ctx.tag?l.id:null,cursor:ctx.interactive?'move':null},parent);
  if(l.background)el('rect',{x:l.x+m.left-4,y:l.y+m.top-3,width:m.w+8,height:m.h+6,rx:3,fill:l.bgColor||ctx.bg,'fill-opacity':.94},g);
  else if(ctx.interactive&&!text)el('rect',{x:l.x-20,y:l.y-l.size,width:40,height:l.size*1.3,fill:'transparent'},g);
  const halo=!l.background&&owner&&(owner.kind==='node'||owner.kind==='edge')&&!Shapes.rackItems[owner.type]&&!(owner.kind==='node'&&Shapes.kindOf(owner.type)==='basic')?(ctx.bgAt?ctx.bgAt(l.x,l.y):ctx.bg):null;
  if(halo&&text)el('rect',{x:l.x+m.left-2,y:l.y+m.top-1,width:m.w+4,height:m.h+2,rx:2,fill:halo},g);
  const t=el('text',{x:l.x,y:l.y,'text-anchor':l.align||'middle','font-family':l.font||Core.FONT,'font-size':l.size,'font-weight':l.bold?650:null,'font-style':l.italic?'italic':null,'text-decoration':l.underline?'underline':null,fill:l.color||'#34465e'},g);
  m.lines.forEach((line,i)=>{const s=el('tspan',{x:l.x,dy:i?m.lh:null},t);s.textContent=line||' '})}

// ---------- standalone SVG (export, print, thumbnails) ----------
function sceneSvg(page,{doc=S.doc,print=true,pad=15,area=null,prefix='o'}={}){
  const root=document.createElementNS(NS,'svg');root.setAttribute('xmlns',NS);
  const ctx=makeCtx(page,{doc,print,prefix}),bgPage=page.background&&doc.pages.find(p=>p.id===page.background);
  RCTX=ctx;for(const n of page.items)if(n.kind==='legend')legendMeasure(n,page,ctx);RCTX=null;
  const all=[...page.items,...(bgPage?bgPage.items:[])].filter(n=>itemVisible(n,ctx));
  const b=area||(all.length?Core.bounds(all,true):{x:0,y:0,...Core.pageSize(page)});const vb=[b.x-pad,b.y-pad,b.w+pad*2,b.h+pad*2];
  root.setAttribute('viewBox',vb.map(v=>+v.toFixed(2)).join(' '));root.setAttribute('width',+vb[2].toFixed(2));root.setAttribute('height',+vb[3].toFixed(2));
  el('rect',{x:vb[0],y:vb[1],width:vb[2],height:vb[3],fill:page.bg||'#fff'},root);
  if(bgPage)drawScene(el('g',{},root),bgPage,makeCtx(bgPage,{doc,print,prefix:prefix+'b',fieldPage:page}));
  drawScene(el('g',{},root),page,ctx);return root}

// ---------- editor canvas ----------
const need={scene:true,overlay:true,panel:true};let frame=0,frameTimer=0;
// rAF pauses in background tabs, so a timer backs it up
function render(part){if(part)need[part]=true;else{need.scene=need.overlay=need.panel=true}if(!frame){frame=requestAnimationFrame(renderNow);frameTimer=setTimeout(renderNow,150)}}
function renderNow(){
  cancelAnimationFrame(frame);clearTimeout(frameTimer);frame=0;const svg=$('canvas');if(!svg||!S.doc)return;const cw=svg.clientWidth||800,ch=svg.clientHeight||600,z=S.view.zoom;
  svg.setAttribute('viewBox',`${S.view.x} ${S.view.y} ${cw/z} ${ch/z}`);
  if(need.scene){
    Conn.sync(items(),{pageId:pg().id});const world=$('scene'),bgl=$('bgLayer'),pl=$('pageLayer');
    pl.replaceChildren();bgl.replaceChildren();world.replaceChildren();
    const b=Core.pageSize(pg()),m=pg().margin*Core.PX,dark=document.documentElement.dataset.theme==='dark';
    el('rect',{x:-50000,y:-50000,width:100000,height:100000,fill:'transparent','data-role':'background'},pl);
    el('rect',{x:4,y:5,width:b.w,height:b.h,fill:dark?'#00000055':'#c9d3e055','pointer-events':'none'},pl);
    el('rect',{x:0,y:0,width:b.w,height:b.h,fill:pg().bg||'#fff','data-role':'background'},pl);
    if(S.prefs.grid){const step=gridStep(),k=step*z<7?5:1,gs=step*k,p=el('pattern',{id:'gridPattern',width:gs,height:gs,patternUnits:'userSpaceOnUse'},el('defs',{},pl));const light=isDarkColor(pg().bg);el('path',{d:`M${gs} 0H0V${gs}`,fill:'none',stroke:light?'#ffffff':'#3b5b8c','stroke-opacity':light?.08:.09,'stroke-width':1/z},p);el('rect',{x:0,y:0,width:b.w,height:b.h,fill:'url(#gridPattern)','pointer-events':'none'},pl)}
    el('rect',{x:m,y:m,width:b.w-2*m,height:b.h-2*m,fill:'none',stroke:'#93a9c6','stroke-opacity':.7,'stroke-dasharray':'5 5','stroke-width':1/z,'pointer-events':'none'},pl);
    if(S.prefs.guides)for(const gl of pg().guideLines||[])el('line',{x1:gl.axis==='x'?gl.pos:-5000,y1:gl.axis==='y'?gl.pos:-5000,x2:gl.axis==='x'?gl.pos:5000,y2:gl.axis==='y'?gl.pos:5000,stroke:'#9b70c6','stroke-width':1.2/z,'stroke-dasharray':`${8/z} ${5/z}`,'data-role':'guide','data-guide':gl.id,cursor:gl.axis==='x'?'ew-resize':'ns-resize'},pl);
    const bgPage=pg().background&&S.doc.pages.find(p=>p.id===pg().background);if(bgPage&&bgPage!==pg())drawScene(el('g',{opacity:.9},bgl),bgPage,makeCtx(bgPage,{prefix:'bg',fieldPage:pg()}));
    drawScene(world,pg(),makeCtx(pg(),{interactive:true}));scheduleMinimap();
  }
  renderOverlay();renderRulers();updateMinimapView();
  if(need.panel){updatePanel();renderChrome()}
  need.scene=need.overlay=need.panel=false}
const isDarkColor=c=>{const m=/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})/i.exec(c||'#fff');if(!m)return false;const[r,g,b]=m.slice(1).map(h=>parseInt(h,16));return(r*299+g*587+b*114)/1000<110};
const gridStep=()=>Math.max(1,+S.prefs.gridStep||10);

// ---------- overlay: selection, handles, previews ----------
function renderOverlay(){
  const o=$('overlay');o.replaceChildren();const z=S.view.zoom,hs=8/z,sw=1/z,blue='#3774e8';
  // analysis overlays
  const A=S.analysis;
  if(A){for(const id of A.edges||[]){const e=find(id);if(e)el('path',{d:Conn.path(e),fill:'none',stroke:A.color||'#16a34a','stroke-width':(e.strokeWidth||2)+8/z,'stroke-opacity':.35,'stroke-linecap':'round','pointer-events':'none'},o)}
    for(const id of A.nodes||[]){const n=find(id);if(n){const b=Core.box(n);el('rect',{x:b.x-6/z,y:b.y-6/z,width:b.w+12/z,height:b.h+12/z,rx:8/z,fill:A.color||'#16a34a','fill-opacity':.12,stroke:A.color||'#16a34a','stroke-width':2/z,'pointer-events':'none'},o)}}
    if(A.loads)for(const[id,L]of A.loads){const e=find(id);if(!e)continue;const q=Conn.pointAt(e,.5),txt=L.text,w=Core.textWidth(txt,10.5)/1+12;const g=el('g',{transform:`translate(${q[0]} ${q[1]}) scale(${1/z})`,'pointer-events':'none'},o);el('rect',{x:-w/2,y:-9,width:w,height:18,rx:9,fill:L.color},g);const t=el('text',{x:0,y:4,'text-anchor':'middle','font-size':10.5,'font-family':Core.FONT,fill:'#fff','font-weight':650},g);t.textContent=txt}}
  for(const id of S.highlights){const n=find(id);if(n){const b=Core.bounds([n],n.kind!=='edge');el('rect',{x:b.x-5/z,y:b.y-5/z,width:b.w+10/z,height:b.h+10/z,rx:4/z,fill:'#f59e0b','fill-opacity':.12,stroke:'#f59e0b','stroke-width':2/z,'pointer-events':'none'},o)}}
  // broken endpoints
  const byIdAll=new Map(items().map(n=>[n.id,n]));for(const e of items())if(e.kind==='edge')for(const k of['from','to'])if(e[k]&&!Conn.resolveEnd(e,k,byIdAll)){const p=k==='from'?e.points[0]:e.points.at(-1);el('circle',{cx:p[0],cy:p[1],r:5/z,fill:'#fff4e6',stroke:'#e49a25','stroke-width':2/z,'pointer-events':'none'},o)}
  // hover
  const hov=S.hoverId&&find(S.hoverId);
  if(hov&&!S.drag&&hov.kind==='node'&&!isLocked(hov)&&['select','connect','port'].includes(S.mode)){const b=Core.box(hov);el('rect',{x:b.x-3/z,y:b.y-3/z,width:b.w+6/z,height:b.h+6/z,rx:4/z,fill:'none',stroke:blue,'stroke-opacity':.45,'stroke-width':sw,'pointer-events':'none'},o);
    if(S.mode==='select'&&!S.selected.has(hov.id)||S.mode==='select'&&S.selected.size===1)drawPorts(hov,o,z);
    if(S.mode==='select'&&S.prefs.autoConnect&&Shapes.kindOf(hov.type)==='device')drawAutoArrows(hov,o,z)}
  if(S.mode==='connect'||S.mode==='port'||S.drag?.kind==='bend'||S.drag?.kind==='connect')for(const n of items())if(n.kind==='node'&&itemVisible(n,{doc:S.doc})&&!isLocked(n))drawPorts(n,o,z);
  // selection
  const sel=picked();
  if(sel.length){
    if(sel.length>1)for(const n of sel){if(n.kind==='edge')el('path',{d:Conn.path(n),fill:'none',stroke:blue,'stroke-width':(n.strokeWidth||2)+3/z,'stroke-opacity':.35,'pointer-events':'none'},o);else{const b=Core.box(n);el('rect',{x:b.x,y:b.y,width:b.w,height:b.h,fill:'none',stroke:blue,'stroke-opacity':.6,'stroke-width':sw,'pointer-events':'none'},o)}}
    if(sel.length===1&&sel[0].kind==='edge')drawEdgeHandles(sel[0],o,z);
    else{const b=Core.bounds(sel);el('rect',{x:b.x-4/z,y:b.y-4/z,width:b.w+8/z,height:b.h+8/z,fill:'none',stroke:blue,'stroke-dasharray':`${4/z} ${3/z}`,'stroke-width':sw,'pointer-events':'none'},o);
      const ed=editable();if(ed.length===sel.length&&!S.drag){for(const[hx,hy]of[[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5]]){if((hx===.5&&b.w*z<44)||(hy===.5&&b.h*z<44))continue;el('rect',{x:b.x+b.w*hx-hs/2,y:b.y+b.h*hy-hs/2,width:hs,height:hs,rx:1.5/z,fill:'#fff',stroke:blue,'stroke-width':1.2/z,'data-role':'resize','data-hx':hx,'data-hy':hy,cursor:(hx===.5?'ns':hy===.5?'ew':hx===hy?'nwse':'nesw')+'-resize'},o)}
        if(sel.length===1&&sel[0].kind==='node'&&sel[0].type!=='rack'&&!Shapes.rackItems[sel[0].type]){const cx=b.x+b.w/2,cy=b.y-24/z;el('line',{x1:cx,y1:b.y-4/z,x2:cx,y2:cy,stroke:blue,'stroke-width':sw,'pointer-events':'none'},o);el('circle',{cx,cy,r:5/z,fill:'#fff',stroke:blue,'stroke-width':1.2/z,'data-role':'rotate',cursor:'grab'},o)}}
      if(sel.some(isLocked)){const t=el('text',{x:b.x,y:b.y-9/z,fill:'#8c97a8','font-size':11/z,'font-family':Core.FONT,'pointer-events':'none'},o);t.textContent='🔒 Locked'}}
    if(S.prefs.showPorts&&sel.length===1&&sel[0].kind==='node')drawPorts(sel[0],o,z,true)}
  // active label
  if(S.activeLabel){const n=find(S.activeLabel.owner),l=n?.labels?.find(x=>x.id===S.activeLabel.id);if(l){const m=Core.labelMetrics(l,resolveLabel(n,l,makeCtx(pg())));const g=el('g',{transform:l.rotation?`rotate(${l.rotation} ${l.x} ${l.y})`:null},o);el('rect',{x:l.x+m.left-4,y:l.y+m.top-3,width:m.w+8,height:m.h+6,fill:'none',stroke:blue,'stroke-dasharray':`${3/z} ${3/z}`,'stroke-width':sw,'pointer-events':'none'},g)}}
  // trace / connect preview
  if(S.trace){let pts=[...S.trace.points];if(S.hover)pts.push(...routeTo(pts.at(-1),S.hover));el('polyline',{points:pts.map(p=>p.join(',')).join(' '),fill:'none',stroke:blue,'stroke-width':2/z,'stroke-dasharray':`${5/z} ${4/z}`,'pointer-events':'none'},o)}
  if(S.drag?.kind==='connect'&&S.drag.preview)el('polyline',{points:S.drag.preview.map(p=>p.join(',')).join(' '),fill:'none',stroke:S.drag.stroke||blue,'stroke-width':(S.drag.width||2),'stroke-dasharray':S.drag.dash||null,'stroke-opacity':.85,'pointer-events':'none'},o);
  if(S.dropTarget){const n=find(S.dropTarget);if(n){const b=Core.box(n);el('rect',{x:b.x-4/z,y:b.y-4/z,width:b.w+8/z,height:b.h+8/z,rx:6/z,fill:'#25b889','fill-opacity':.08,stroke:'#159c70','stroke-width':2/z,'pointer-events':'none'},o)}}
  if(S.snapPort){const q=S.snapPort.p,r=9/z;el('circle',{cx:q[0],cy:q[1],r,fill:'#25b889','fill-opacity':.18,stroke:'#159c70','stroke-width':2/z,'pointer-events':'none'},o);const t=el('text',{x:q[0]+r+5/z,y:q[1]-r,fill:'#128461','font-size':11/z,'font-family':Core.FONT,'pointer-events':'none',stroke:'#fff','stroke-width':3/z,'paint-order':'stroke'},o);t.textContent=hoverPortLabel(S.snapPort)}
  for(const gl of S.guideLines)el('line',{x1:gl[0],y1:gl[1],x2:gl[2],y2:gl[3],stroke:'#e0559b','stroke-width':sw,'stroke-dasharray':`${4/z} ${3/z}`,'pointer-events':'none'},o);
  if(S.spacing)for(const s of S.spacing){el('line',{x1:s[0],y1:s[1],x2:s[2],y2:s[3],stroke:'#e0559b','stroke-width':sw,'pointer-events':'none'},o)}
  const d=S.drag;if(d&&['box','zone','textbox','rackdraw'].includes(d.kind)){const p=d.current||d.start,cross=d.kind==='box'&&p[0]<d.start[0];el('rect',{x:Math.min(p[0],d.start[0]),y:Math.min(p[1],d.start[1]),width:Math.abs(p[0]-d.start[0]),height:Math.abs(p[1]-d.start[1]),fill:blue,'fill-opacity':.07,stroke:blue,'stroke-dasharray':cross?`${5/z} ${3/z}`:null,'stroke-width':sw,'pointer-events':'none'},o)}
  if(d?.kind==='move'&&d.rackSlot){const r=d.rackSlot;el('rect',{x:r.x,y:r.y,width:r.w,height:r.h,fill:'#25b889','fill-opacity':.25,stroke:'#159c70','stroke-width':sw,'pointer-events':'none'},o)}
}
function drawPorts(n,o,z,named=false){for(const p of n.ports||[]){const q=Core.portPoint(n,p);const c=el('circle',{cx:q[0],cy:q[1],r:4/z,fill:'#fff',stroke:'#3779db','stroke-width':1.5/z,'data-id':n.id,'data-role':'port','data-port':p.id,cursor:'crosshair'},o);const t=el('title',{},c);t.textContent=p.name||'Port';if(named&&p.name){const tx=el('text',{x:q[0]+6/z,y:q[1]-6/z,'font-size':9/z,fill:'#3779db','font-family':Core.FONT,'pointer-events':'none'},o);tx.textContent=p.name}}}
function drawAutoArrows(n,o,z){const b=Core.box(n),gap=14/z,s=7/z;for(const[dir,x,y,rot]of[['up',b.x+b.w/2,b.y-gap,0],['right',b.x+b.w+gap,b.y+b.h/2,90],['down',b.x+b.w/2,b.y+b.h+gap+(n.labels?.length?Core.labelMetrics(n.labels[0],resolveLabel(n,n.labels[0])).h+8/z:0),180],['left',b.x-gap,b.y+b.h/2,270]]){const g=el('g',{transform:`translate(${x} ${y}) rotate(${rot})`,'data-role':'autoconnect','data-id':n.id,'data-dir':dir,cursor:'pointer'},o);el('circle',{cx:0,cy:0,r:s*1.5,fill:'transparent'},g);el('path',{d:`M${-s} ${s*.5}L0 ${-s*.7}L${s} ${s*.5}Z`,fill:'#3774e8','fill-opacity':.55},g);const t=el('title',{},g);t.textContent='Click: add a connected copy · Drag: connect'}}
function drawEdgeHandles(e,o,z){const blue='#3774e8',hs=8/z,locked=isLocked(e);el('path',{d:Conn.path(e),fill:'none',stroke:blue,'stroke-width':(e.strokeWidth||2)+3/z,'stroke-opacity':.25,'pointer-events':'none'},o);if(locked)return;
  const manual=e.routing!=='auto'&&e.routing!=='straight';
  e.points.slice(1).forEach((p,i)=>{const a=e.points[i],act=S.segment?.id===e.id&&S.segment.index===i;if(!manual&&!act){el('line',{x1:a[0],y1:a[1],x2:p[0],y2:p[1],stroke:'transparent','stroke-width':10/z,'data-id':e.id,'data-role':'segment','data-index':i,cursor:a[0]===p[0]?'ew-resize':'ns-resize'},o);return}el('line',{x1:a[0],y1:a[1],x2:p[0],y2:p[1],stroke:act?'#e39a33':blue,'stroke-width':(act?4:1.5)/z,'stroke-dasharray':`${5/z} ${3/z}`,'data-id':e.id,'data-role':'segment','data-index':i,cursor:a[0]===p[0]?'ew-resize':a[1]===p[1]?'ns-resize':'move'},o);if(manual){const m=[(a[0]+p[0])/2,(a[1]+p[1])/2];el('rect',{x:m[0]-hs*.35,y:m[1]-hs*.35,width:hs*.7,height:hs*.7,fill:blue,'fill-opacity':.5,'data-id':e.id,'data-role':'segment','data-index':i,cursor:'move','pointer-events':'all'},o)}});
  e.points.forEach((p,i)=>{const end=i===0||i===e.points.length-1;if(!manual&&!end)return;const att=end&&(i===0?e.from:e.to);if(end)el('circle',{cx:p[0],cy:p[1],r:hs*.65,fill:att?'#25b889':'#fff',stroke:att?'#0f7a57':blue,'stroke-width':1.4/z,'data-id':e.id,'data-role':'bend','data-index':i,cursor:'move'},o);else el('rect',{x:p[0]-hs/2,y:p[1]-hs/2,width:hs,height:hs,fill:S.bend?.id===e.id&&S.bend.index===i?'#ffb14c':'#fff',stroke:blue,'stroke-width':1.2/z,'data-id':e.id,'data-role':'bend','data-index':i,cursor:'move'},o)})}

// ---------- rulers ----------
function renderRulers(){
  for(const axis of['x','y']){const c=$(axis==='x'?'rulerX':'rulerY');if(!c)continue;if(!S.prefs.rulers){c.hidden=true;continue}c.hidden=false;const dpr=devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight;if(c.width!==w*dpr||c.height!==h*dpr){c.width=w*dpr;c.height=h*dpr}const g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
    const css=getComputedStyle(document.documentElement);g.fillStyle=css.getPropertyValue('--ruler').trim()||'#f6f8fb';g.fillRect(0,0,w,h);g.strokeStyle=css.getPropertyValue('--ruler-tick').trim()||'#9aabc1';g.fillStyle=css.getPropertyValue('--muted').trim()||'#7c8da4';g.font='9px '+Core.FONT;
    const z=S.view.zoom,ppm=Core.PX*z,origin=axis==='x'?S.view.x:S.view.y,len=axis==='x'?w:h;let step=[1,2,5,10,20,50,100,200,500,1000].find(s=>s*ppm>=48)||1000;const minor=step/(String(step)[0]==='2'?4:5);
    // selection band
    const sel=picked();if(sel.length){const b=Core.bounds(sel),a0=((axis==='x'?b.x:b.y)-origin)*z,a1=a0+(axis==='x'?b.w:b.h)*z;g.fillStyle='#3774e833';if(axis==='x')g.fillRect(a0,0,a1-a0,h);else g.fillRect(0,a0,w,a1-a0);g.fillStyle=css.getPropertyValue('--muted').trim()||'#7c8da4'}
    const startMM=Math.floor(origin/Core.PX/minor)*minor;g.beginPath();
    for(let mm=startMM;;mm+=minor){const pos=(mm*Core.PX-origin)*z;if(pos>len)break;if(pos<0)continue;const major=Math.abs(mm/step-Math.round(mm/step))<1e-6,tk=major?(axis==='x'?h:w)*.55:(axis==='x'?h:w)*.25;if(axis==='x'){g.moveTo(pos+.5,h);g.lineTo(pos+.5,h-tk)}else{g.moveTo(w,pos+.5);g.lineTo(w-tk,pos+.5)}
      if(major){const label=String(Math.round(mm));if(axis==='x')g.fillText(label,pos+3,9);else{g.save();g.translate(9,pos+3);g.rotate(-Math.PI/2);g.textAlign='right';g.fillText(label,0,0);g.restore()}}}
    g.stroke();if(S.cursor){const pos=((axis==='x'?S.cursor[0]:S.cursor[1])-origin)*z;g.strokeStyle='#e0559b';g.beginPath();if(axis==='x'){g.moveTo(pos,0);g.lineTo(pos,h)}else{g.moveTo(0,pos);g.lineTo(w,pos)}g.stroke()}}}

// ---------- minimap ----------
let miniTimer=null;
function scheduleMinimap(){clearTimeout(miniTimer);miniTimer=setTimeout(drawMinimap,180)}
function drawMinimap(){const m=$('minimap');if(!m||!S.prefs.minimap){if(m)m.hidden=true;return}m.hidden=false;const svg=$('miniSvg'),b=Core.pageSize(pg()),all=items(),ext=all.length?Core.bounds(all):{x:0,y:0,w:b.w,h:b.h},x0=Math.min(0,ext.x)-40,y0=Math.min(0,ext.y)-40,x1=Math.max(b.w,ext.x+ext.w)+40,y1=Math.max(b.h,ext.y+ext.h)+40;
  svg.setAttribute('viewBox',`${x0} ${y0} ${x1-x0} ${y1-y0}`);svg.dataset.vb=JSON.stringify([x0,y0,x1-x0,y1-y0]);const g=$('miniScene');g.replaceChildren();el('rect',{x:0,y:0,width:b.w,height:b.h,fill:pg().bg||'#fff',stroke:'#94a3b8','stroke-width':4},g);
  for(const n of all){if(!itemVisible(n,{doc:S.doc}))continue;if(n.kind==='zone')el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,fill:n.fill||'#eef4fb',stroke:n.stroke,'stroke-width':3},g);else if(n.kind==='edge')el('polyline',{points:n.points.map(p=>p.join(',')).join(' '),fill:'none',stroke:n.stroke,'stroke-width':4},g);else if(n.kind==='node')el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,rx:6,fill:n.display==='tile'||n.display==='circle'?n.stroke:'#fff',stroke:n.stroke,'stroke-width':4},g);else el('rect',{x:n.x,y:n.y,width:n.w,height:n.h,fill:'#94a3b833'},g)}updateMinimapView()}
function updateMinimapView(){const r=$('miniView'),svg=$('canvas');if(!r||!S.prefs.minimap)return;const z=S.view.zoom;r.setAttribute('x',S.view.x);r.setAttribute('y',S.view.y);r.setAttribute('width',svg.clientWidth/z);r.setAttribute('height',svg.clientHeight/z);r.setAttribute('stroke-width',Math.max(3,(svg.clientWidth/z)/90))}

// ---------- thumbnails ----------
function thumbnail(doc,page,w=260,h=170){const svg=sceneSvg(page,{doc,print:true,pad:20});svg.setAttribute('width',w);svg.setAttribute('height',h);svg.setAttribute('preserveAspectRatio','xMidYMid meet');return svg}
