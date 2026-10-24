// Port Network Studio v3 — document model and geometry.
// Evolved from the Port v2 "Network Architecture Studio" model: a drawing is a list of pages,
// each page a flat list of items (node | edge | zone | text | table | legend) with absolute labels.
const Core=(()=>{
const copy=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const uid=()=>globalThis.crypto?.randomUUID?.()||'id-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
const PX=96/25.4; // px per mm at 96 dpi
const FONT="Segoe UI, Inter, system-ui, -apple-system, Helvetica, Arial, sans-serif";
const MONO="Cascadia Mono, Consolas, SFMono-Regular, Menlo, monospace";
const PAPERS={A4:[210,297],A3:[297,420],A2:[420,594],A1:[594,841],A0:[841,1189],Letter:[215.9,279.4],Legal:[215.9,355.6],Tabloid:[279.4,431.8]};
const KINDS=['node','edge','zone','text','table','legend'];

// ---------- text measurement ----------
let ctx2d=null;const widths=new Map();
function textWidth(s,size=13,bold=false,font=FONT,italic=false){
  s=String(s??'');const key=s+'\u0001'+size+(bold?'b':'')+(italic?'i':'')+font;let w=widths.get(key);if(w!==undefined)return w;
  if(typeof document!=='undefined'){ctx2d??=document.createElement('canvas').getContext('2d');ctx2d.font=`${italic?'italic ':''}${bold?'650 ':''}${size}px ${font||FONT}`;w=ctx2d.measureText(s).width}else w=s.length*size*.55;
  if(widths.size>20000)widths.clear();widths.set(key,w);return w}
function textLines(l,text=l.text){const max=l.wrapWidth||0;return String(text??'').split('\n').flatMap(line=>{if(!max||textWidth(line,l.size,l.bold,l.font,l.italic)<=max)return[line];const out=[];let cur='';for(const word of line.split(/\s+/)){const next=cur?cur+' '+word:word;if(cur&&textWidth(next,l.size,l.bold,l.font,l.italic)>max){out.push(cur);cur=word}else cur=next}out.push(cur);return out})}
// Box of a label relative to its anchor (x,y = baseline of first line), before rotation.
function labelMetrics(l,text){const lines=textLines(l,text),w=Math.max(1,...lines.map(t=>textWidth(t,l.size,l.bold,l.font,l.italic))),lh=l.size*1.25,h=(lines.length-1)*lh+l.size*1.2,left=l.align==='start'?0:l.align==='end'?-w:-w/2;return{lines,w,h,lh,left,top:-l.size*.95}}
let resolveText=(owner,l)=>l.text; // replaced by the app to substitute {{fields}}
function setResolver(fn){resolveText=fn}

// ---------- boxes and bounds ----------
function corners(n){const r=n.rotation||0;if(!r)return[[n.x,n.y],[n.x+n.w,n.y],[n.x+n.w,n.y+n.h],[n.x,n.y+n.h]];const a=r*Math.PI/180,cx=n.x+n.w/2,cy=n.y+n.h/2;return[[-n.w/2,-n.h/2],[n.w/2,-n.h/2],[n.w/2,n.h/2],[-n.w/2,n.h/2]].map(([x,y])=>[cx+x*Math.cos(a)-y*Math.sin(a),cy+x*Math.sin(a)+y*Math.cos(a)])}
function labelCorners(owner,l){const m=labelMetrics(l,resolveText(owner,l)),a=(l.rotation||0)*Math.PI/180,pad=4;return[[m.left-pad,m.top-pad],[m.left+m.w+pad,m.top-pad],[m.left+m.w+pad,m.top+m.h+pad],[m.left-pad,m.top+m.h+pad]].map(([x,y])=>[l.x+x*Math.cos(a)-y*Math.sin(a),l.y+x*Math.sin(a)+y*Math.cos(a)])}
let samplePoints=e=>e.points; // replaced by connectors.js for curves
function setSampler(fn){samplePoints=fn}
function points(n,labels=false){const pts=n.kind==='edge'?samplePoints(n):corners(n);if(labels)for(const l of n.labels||[])pts.push(...labelCorners(n,l));return pts}
function bounds(items,labels=false){const pts=items.flatMap(n=>points(n,labels));if(!pts.length)return{x:0,y:0,w:1,h:1};let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const[x,y]of pts){if(x<x0)x0=x;if(y<y0)y0=y;if(x>x1)x1=x;if(y>y1)y1=y}return{x:x0,y:y0,w:Math.max(1,x1-x0),h:Math.max(1,y1-y0)}}
const box=n=>n.kind==='edge'?bounds([n]):{x:n.x,y:n.y,w:n.w,h:n.h};
const inside=(a,b,tol=0)=>a.x>=b.x-tol&&a.y>=b.y-tol&&a.x+a.w<=b.x+b.w+tol&&a.y+a.h<=b.y+b.h+tol;
const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
const center=n=>{const b=box(n);return[b.x+b.w/2,b.y+b.h/2]};

// ---------- transforms ----------
function move(n,dx,dy){if(n.kind==='edge')n.points=n.points.map(p=>[p[0]+dx,p[1]+dy]);else{n.x+=dx;n.y+=dy}(n.labels||[]).forEach(l=>{if(!l.anchor){l.x+=dx;l.y+=dy}})}
function scale(n,b,sx,sy,fonts=true,weights=false){const tr=p=>[b.x+(p[0]-b.x)*sx,b.y+(p[1]-b.y)*sy],k=Math.min(Math.abs(sx),Math.abs(sy));
  if(n.kind==='edge')n.points=n.points.map(tr);else{[n.x,n.y]=tr([n.x,n.y]);n.w*=sx;n.h*=sy}
  if(n.kind==='table'){n.cols=n.cols.map(c=>c*sx);n.rowH*=sy;if(fonts)n.size*=k}
  (n.labels||[]).forEach(l=>{if(!l.anchor)[l.x,l.y]=tr([l.x,l.y]);if(fonts)l.size=Math.max(4,l.size*k);if(l.wrapWidth)l.wrapWidth*=Math.abs(sx)});if(weights&&n.strokeWidth)n.strokeWidth*=k}
function rotateVec([x,y],deg){const a=deg*Math.PI/180;return[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]}
function portPoint(n,p){const[x,y]=rotateVec([(p.x-.5)*n.w*(n.flipX?-1:1),(p.y-.5)*n.h*(n.flipY?-1:1)],n.rotation||0);return[n.x+n.w/2+x,n.y+n.h/2+y]}
// Direction a connector leaves a port: outward normal of the nearest side, after flip/rotation.
function portDir(n,p){const d=[p.x,1-p.x,p.y,1-p.y],m=Math.min(...d);if(m>.35)return null;const i=d.indexOf(m);let v=[[-1,0],[1,0],[0,-1],[0,1]][i];v=[v[0]*(n.flipX?-1:1),v[1]*(n.flipY?-1:1)];v=rotateVec(v,n.rotation||0);return Math.abs(v[0])>=Math.abs(v[1])?(v[0]>0?'right':'left'):(v[1]>0?'down':'up')}
// Convert a page point to normalised local coordinates of a node (inverse of portPoint).
function localPoint(n,p){const[x,y]=rotateVec([p[0]-n.x-n.w/2,p[1]-n.y-n.h/2],-(n.rotation||0));return[.5+x/n.w*(n.flipX?-1:1),.5+y/n.h*(n.flipY?-1:1)]}

// ---------- factories ----------
function label(text,x,y,size=12){return{id:uid(),text,x,y,size,color:'#34465e',rotation:0,bold:false,background:false,align:'middle'}}
const defaultPorts=()=>[{id:uid(),x:.5,y:0,name:'Top'},{id:uid(),x:1,y:.5,name:'Right'},{id:uid(),x:.5,y:1,name:'Bottom'},{id:uid(),x:0,y:.5,name:'Left'}];
function node(type,x,y,name,w=64,h=64){return{id:uid(),kind:'node',type,x,y,w,h,rotation:0,stroke:'#2f5ea8',strokeWidth:2,fill:'#ffffff',display:'symbol',ports:defaultPorts(),labels:[label(name??type,x+w/2,y+h+16)],data:{}}}
function edge(points,from=null,to=null){return{id:uid(),kind:'edge',points,from,to,routing:'auto',stroke:'#4a6fa5',strokeWidth:2,dash:'',startMarker:'none',endMarker:'none',labels:[],data:{}}}
function zone(name,x,y,w,h,fill='#eef4fb',stroke='#9fb4ce'){const l=label(name,x+16,y+26,15);l.align='start';l.bold=true;return{id:uid(),kind:'zone',x,y,w,h,fill,stroke,strokeWidth:1.5,dash:'7 5',style:'plain',labels:[l],data:{}}}
function text(t,x,y,w=240,h=60,size=13){const l=label(t,x+10,y+size+8,size);l.align='start';return{id:uid(),kind:'text',x,y,w,h,labels:[l]}}
function page(name='Page 1'){return{id:uid(),name,paper:'A3',orientation:'landscape',margin:10,printSizing:'fit',customW:420,customH:297,bg:'#ffffff',background:null,isBackground:false,guideLines:[],items:[]}}
// Device fields. `scope` limits a field to stencil ids (empty = every device).
const SWITCHES=['switch','l3switch','industrialswitch','poe','rk-switch'],POE_LOADS=['camera','domecamera','ptzcamera','anpr','thermal','wap','ipphone','accesscontrol','intercom','sensor','iotgateway','display','thinclient'],CAMERAS=['camera','domecamera','ptzcamera','anpr','thermal'],RECORDERS=['nvr','storage','nas','rk-nvr','rk-storage'];
const FIELDS=[{key:'hostname',label:'Hostname'},{key:'ip',label:'IP address'},{key:'mgmtIp',label:'Management IP'},{key:'vlan',label:'VLAN'},{key:'model',label:'Model'},{key:'vendor',label:'Vendor'},{key:'serial',label:'Serial no.'},{key:'os',label:'OS / firmware'},{key:'location',label:'Location'},{key:'status',label:'Status',options:['Existing','New','Planned','To remove','Spare']},{key:'owner',label:'Owner'},{key:'power',label:'Power draw (W)',type:'number'},{key:'poeBudget',label:'PoE budget (W)',type:'number',scope:SWITCHES},{key:'poeDraw',label:'PoE draw (W)',type:'number',scope:POE_LOADS},{key:'bitrate',label:'Stream bitrate (Mbps)',type:'number',scope:CAMERAS},{key:'retention',label:'Retention (days)',type:'number',scope:RECORDERS},{key:'storageTB',label:'Usable storage (TB)',type:'number',scope:RECORDERS},{key:'unitPrice',label:'Unit price',type:'number'},{key:'notes',label:'Notes',multiline:true}];
const LINK_FIELDS=[{key:'speed',label:'Speed'},{key:'media',label:'Media'},{key:'vlans',label:'VLANs'},{key:'cableId',label:'Cable ID'},{key:'circuit',label:'Circuit ID'},{key:'provider',label:'Provider'},{key:'notes',label:'Notes',multiline:true}];
const ZONE_FIELDS=[{key:'subnet',label:'Subnet (CIDR)'},{key:'vlan',label:'VLAN ID'},{key:'gateway',label:'Gateway'},{key:'security',label:'Security level'},{key:'notes',label:'Notes',multiline:true}];
function newDoc(name='Untitled network'){const now=new Date().toISOString();return{version:3,name,meta:{author:'',company:'',revision:'1.0',description:'',created:now,modified:now},theme:'port',layers:[{id:uid(),name:'Main',visible:true,locked:false,print:true}],fields:copy(FIELDS),linkFields:copy(LINK_FIELDS),display:{fields:[],colorBy:'',showIfLabels:true},vlans:[],pages:[page('Page 1')]}}

// ---------- structure helpers ----------
function duplicate(items,dx=30,dy=30){const map=new Map(items.map(n=>[n.id,uid()])),groups=new Map();return items.map(o=>{const n=copy(o);n.id=map.get(n.id);if(n.group){if(!groups.has(n.group))groups.set(n.group,uid());n.group=groups.get(n.group)}(n.labels||[]).forEach(l=>l.id=uid());if(n.ports){const pm=new Map();n.ports.forEach(p=>{const id=uid();pm.set(p.id,id);p.id=id});n._portMap=pm}return n}).map((n,_,all)=>{if(n.kind==='edge')for(const k of['from','to']){const r=n[k];if(!r)continue;const t=all.find(x=>x.id===map.get(r.node));n[k]=t?{node:t.id,port:r.port?t._portMap?.get(r.port)??null:null}:null}if(n.target&&map.has(n.target))n.target=map.get(n.target);return n}).map(n=>{delete n._portMap;move(n,dx,dy);return n})}
function splitEdge(e,index){return[e.points.slice(0,index+1),e.points.slice(index+1)].map((p,i)=>p.length<2?null:{...copy(e),id:uid(),points:p,routing:e.routing==='auto'?'hv':e.routing,labels:[],from:i===0?copy(e.from):null,to:i===1?copy(e.to):null}).filter(Boolean).map((p,i)=>{if(i===0)p.labels=copy(e.labels);return p})}
function join(a,b){const c=[[false,false,a.points.at(-1),b.points[0]],[false,true,a.points.at(-1),b.points.at(-1)],[true,false,a.points[0],b.points[0]],[true,true,a.points[0],b.points.at(-1)]];c.sort((u,v)=>Math.hypot(u[2][0]-u[3][0],u[2][1]-u[3][1])-Math.hypot(v[2][0]-v[3][0],v[2][1]-v[3][1]));const[ra,rb]=c[0],ap=copy(a.points),bp=copy(b.points);if(ra)ap.reverse();if(rb)bp.reverse();if(Math.hypot(ap.at(-1)[0]-bp[0][0],ap.at(-1)[1]-bp[0][1])<.01)bp.shift();return{...copy(a),id:uid(),routing:a.routing==='auto'?'hv':a.routing,points:[...ap,...bp],from:copy(ra?a.to:a.from),to:copy(rb?b.from:b.to),labels:[...copy(a.labels),...copy(b.labels)]}}
function dimensions(p){const a=p.paper==='Custom'?[p.customW,p.customH]:PAPERS[p.paper]||PAPERS.A4;return p.paper==='Custom'?a:p.orientation==='landscape'?[Math.max(...a),Math.min(...a)]:[Math.min(...a),Math.max(...a)]}
function pageSize(p){const[w,h]=dimensions(p);return{w:w*PX,h:h*PX}}

// ---------- validation and migration ----------
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e7;
function validate(d){
  if(!d||d.version!==3||!Array.isArray(d.pages)||!d.pages.length)throw Error('This is not a Port v3 drawing.');
  const ids=new Set();
  for(const p of d.pages){
    if(!p.id||!Array.isArray(p.items)||!(p.paper in PAPERS||p.paper==='Custom')||!['landscape','portrait'].includes(p.orientation)||!finite(p.margin)||p.margin<0||p.margin>60)throw Error('Invalid page data.');
    for(const n of p.items){
      if(!n.id||ids.has(n.id))throw Error('Duplicate or missing object ID.');ids.add(n.id);
      if(!KINDS.includes(n.kind))throw Error('Unknown object type: '+n.kind);
      if(n.kind==='edge'){if(!Array.isArray(n.points)||n.points.length<2||!n.points.every(q=>Array.isArray(q)&&q.length===2&&q.every(finite)))throw Error('Invalid connector.')}
      else if(![n.x,n.y,n.w,n.h].every(finite)||n.w<=0||n.h<=0)throw Error('Invalid shape dimensions.');
      if(!Array.isArray(n.labels)||!n.labels.every(l=>typeof l.text==='string'&&[l.x,l.y,l.size,l.rotation||0].every(finite)&&l.size>0))throw Error('Invalid labels.');
      if(n.image&&!/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/i.test(n.image))throw Error('Only embedded images are accepted.');
      if(n.ports&&!n.ports.every(q=>finite(q.x)&&finite(q.y)&&q.id))throw Error('Invalid ports.');
      if(n.kind==='table'&&(!Array.isArray(n.rows)||!Array.isArray(n.cols)))throw Error('Invalid table.');
    }
  }
  d.meta??={};d.layers=Array.isArray(d.layers)&&d.layers.length?d.layers:newDoc().layers;d.fields??=copy(FIELDS);d.linkFields??=copy(LINK_FIELDS);d.display??={fields:[],colorBy:'',showIfLabels:true};d.vlans??=[];
  for(const f of FIELDS)if(!d.fields.some(x=>x.key===f.key))d.fields.push(copy(f));
  return d}
// Port v1 (nodes/edges) → v2 → v3. v2 drawings from the original Network Architecture Studio open unchanged.
function migrate(d){
  if(d?.version===3)return validate(d);
  if(d?.version!==2){if(!Array.isArray(d?.nodes)||!Array.isArray(d?.edges))throw Error('Unsupported drawing format.');d=v1to2(d)}
  const out=newDoc(d.name||'Imported network');out.pages=d.pages.map(p=>({...page(p.name),...copy(p),bg:'#ffffff',background:null,isBackground:false,guideLines:p.guideLines||[]}));
  const typeMap={box:'roundrect',image:'image'};
  for(const p of out.pages)for(const n of p.items){
    n.data??={};
    if(n.kind==='node'){n.display=n.card?'card':'symbol';delete n.card;n.type=typeMap[n.type]||n.type;if(n.type==='roundrect')n.v2box=true}
    if(n.kind==='edge'){n.routing=n.routing||'free';delete n.routingExplicit;if(n.startMarker===undefined)n.startMarker=n.arrow==='both'?'arrow':'none';if(n.endMarker===undefined)n.endMarker=['end','both'].includes(n.arrow)?'arrow':'none';delete n.arrow;n.linkType='custom'}
    if(n.kind==='zone')n.style??='plain';
  }
  return validate(out)}
function v1to2(d){const p=page('Imported drawing'),map=new Map();p.items=d.nodes.map(o=>{const n=node(o.type,o.x,o.y,o.label,o.w,o.h);n.card=o.appearance!=='symbol';n.stroke=o.color||n.stroke;n.image=o.image;n.labels=[label(o.label||'',o.lx,o.ly,o.font||13)];n.ports=(o.ports||[]).map((q,i)=>({...q,id:uid(),name:'Port '+(i+1)}));map.set(o.id,n.id);return n});for(const o of d.edges){if(o.pts?.length>=2){const e=edge(o.pts);e.routing='free';e.labels=o.label?[label(o.label,o.lx,o.ly,o.font||13)]:[];e.stroke=o.color||'#ef6b32';p.items.push(e)}else if(o.label)p.items.push(text(o.label,o.lx,o.ly,200,50,o.font||13))}if(d.pageSettings){p.paper=d.pageSettings.paper;p.orientation=d.pageSettings.orientation;p.margin=d.pageSettings.margin;p.printSizing=d.pageSettings.sizing}return{version:2,name:'Imported network',pages:[p]}}

// ---------- IPv4 helpers ----------
function ip2int(s){const m=/^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(String(s??''));if(!m)return null;const p=m.slice(1).map(Number);if(p.some(x=>x>255))return null;return((p[0]<<24)>>>0)+(p[1]<<16)+(p[2]<<8)+p[3]}
const int2ip=n=>[n>>>24,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
function cidr(s){const m=/^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(String(s??''));if(!m)return null;const ip=ip2int(m[1]),bits=+m[2];if(ip==null||bits>32)return null;const mask=bits?(~0<<(32-bits))>>>0:0,net=(ip&mask)>>>0,bc=(net|(~mask>>>0))>>>0,size=2**(32-bits);return{ip,bits,mask,net,broadcast:bc,first:bits>=31?net:net+1,last:bits>=31?bc:bc-1,size,hosts:bits>=31?size:size-2,text:int2ip(net)+'/'+bits,maskText:int2ip(mask)}}
const inCidr=(ip,c)=>((ip&c.mask)>>>0)===c.net;
// All IPv4 addresses mentioned in a field value ("10.0.0.1/24, 10.0.1.1").
const ipsIn=s=>(String(s??'').match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)||[]).filter(x=>ip2int(x)!=null);
function fillFields(s,lookup){return String(s??'').replace(/\{\{\s*([\w.]+)\s*\}\}/g,(m,k)=>{const v=lookup(k);return v==null?m:String(v)})}

return{copy,uid,PX,FONT,MONO,PAPERS,KINDS,textWidth,textLines,labelMetrics,setResolver,setSampler,resolve:(o,l)=>resolveText(o,l),corners,bounds,box,inside,overlaps,center,move,scale,rotateVec,portPoint,portDir,localPoint,label,defaultPorts,node,edge,zone,text,page,newDoc,FIELDS,LINK_FIELDS,ZONE_FIELDS,SWITCHES,POE_LOADS,CAMERAS,RECORDERS,duplicate,splitEdge,join,dimensions,pageSize,validate,migrate,ip2int,int2ip,cidr,inCidr,ipsIn,fillFields};
})();
if(typeof module!=='undefined')module.exports=Core;
