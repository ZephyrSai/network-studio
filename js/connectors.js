// Connector geometry shared by the editor, exports and print: curve sampling, line jumps,
// manual right-angle paths (from Port v2), dynamic glue, and Visio-style auto-routing via Router.
const Conn=(()=>{
const C=Core,dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const DIRV={left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]};

function sample(e){const p=e.points;if(e.curve!=='smooth'||p.length<3)return p.map(q=>[...q]);const out=[p[0]];for(let i=0;i<p.length-1;i++){const a=p[Math.max(0,i-1)],b=p[i],c=p[i+1],d=p[Math.min(p.length-1,i+2)];for(let s=1;s<=20;s++){const t=s/20,t2=t*t,t3=t2*t;out.push([0,1].map(k=>.5*((2*b[k])+(-a[k]+c[k])*t+(2*a[k]-5*b[k]+4*c[k]-d[k])*t2+(-a[k]+3*b[k]-3*c[k]+d[k])*t3)))}}return out}
function metric(points){const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+dist(points[i],points[i-1]));return{points,lengths,total:lengths.at(-1)}}
function at(m,s){s=Math.max(0,Math.min(m.total,s));for(let i=1;i<m.points.length;i++)if(m.lengths[i]>=s){const a=m.points[i-1],b=m.points[i],t=(s-m.lengths[i-1])/(m.lengths[i]-m.lengths[i-1]||1);return[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]}return m.points.at(-1)}
function tangent(m,s){const a=at(m,Math.max(0,s-1)),b=at(m,Math.min(m.total,s+1)),l=dist(a,b)||1;return[(b[0]-a[0])/l,(b[1]-a[1])/l]}
function intersections(m,other){const out=[];for(let i=1;i<m.points.length;i++){const a=m.points[i-1],b=m.points[i],rx=b[0]-a[0],ry=b[1]-a[1];for(let j=1;j<other.length;j++){const c=other[j-1],d=other[j],sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx;if(Math.abs(den)<1e-8)continue;const qx=c[0]-a[0],qy=c[1]-a[1],t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;if(t>=0&&t<=1&&u>=0&&u<=1){const x=a[0]+t*rx,y=a[1]+t*ry;if(dist([x,y],other[0])<8||dist([x,y],other.at(-1))<8)continue;out.push(m.lengths[i-1]+t*(m.lengths[i]-m.lengths[i-1]))}}}return out}
// SVG path with arcs ("line jumps") where this connector crosses connectors drawn before it.
function path(e,previous=[],style='arc'){const m=metric(sample(e)),p=m.points;if(!p.length)return'';const jumps=[];
  if(e.jumps!==false&&style!=='none'){const r=Number(e.jumpSize)||6,bb=C.bounds([e]);const near=previous.filter(o=>{const b=C.bounds([o]);return C.overlaps({x:bb.x-2,y:bb.y-2,w:bb.w+4,h:bb.h+4},b)});const cross=near.flatMap(o=>intersections(m,sample(o))).sort((a,b)=>a-b);for(const s of cross)if(s>r+3&&s<m.total-r-3&&(!jumps.length||s-jumps.at(-1).s>r*2+3))jumps.push({s,r})}
  let d=`M ${p[0].map(v=>+v.toFixed(2)).join(' ')}`,cursor=0;const fmt=q=>q.map(v=>+v.toFixed(2)).join(' ');
  const to=end=>{for(let i=1;i<p.length;i++)if(m.lengths[i]>cursor+1e-6&&m.lengths[i]<end-1e-6)d+=` L ${fmt(p[i])}`;d+=` L ${fmt(at(m,end))}`;cursor=end};
  for(const j of jumps){to(j.s-j.r);const a=at(m,j.s-j.r),b=at(m,j.s+j.r),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy)||1;
    if(style==='gap')d+=` M ${fmt(b)}`;else{const c=[(a[0]+b[0])/2+dy/len*j.r*1.9,(a[1]+b[1])/2-dx/len*j.r*1.9];d+=` Q ${fmt(c)} ${fmt(b)}`}cursor=j.s+j.r}
  to(m.total);return d}
function orthogonalize(e){if(!['hv','vh'].includes(e.routing)||e.curve==='smooth')return;const out=[e.points[0].slice()];for(let i=1;i<e.points.length;i++){const a=out.at(-1),b=e.points[i].slice();if(Math.abs(a[0]-b[0])<1e-7)b[0]=a[0];if(Math.abs(a[1]-b[1])<1e-7)b[1]=a[1];if(a[0]!==b[0]&&a[1]!==b[1])out.push(e.routing==='vh'?[a[0],b[1]]:[b[0],a[1]]);if(a[0]!==b[0]||a[1]!==b[1])out.push(b)}e.points=out.length>1?out:[out[0],out[0].slice()]}
function simplify(points){const out=[];for(const q of points){if(out.length&&dist(out.at(-1),q)<.01)continue;if(out.length>=2){const a=out.at(-2),b=out.at(-1);if((Math.abs(a[0]-b[0])<.01&&Math.abs(b[0]-q[0])<.01)||(Math.abs(a[1]-b[1])<.01&&Math.abs(b[1]-q[1])<.01)){out[out.length-1]=q;continue}}out.push(q)}if(out.length===1)out.push(out[0].slice());return out}

// ---------- endpoint resolution (port glue or dynamic shape glue) ----------
function refPoint(e,key,byId){const r=e[key],n=r&&byId.get(r.node);if(!n)return key==='from'?e.points[0]:e.points.at(-1);if(r.port){const p=n.ports?.find(q=>q.id===r.port);if(p)return C.portPoint(n,p)}return C.center(n)}
function boundaryPoint(n,toward){const g=!n.rotation&&C.glyphBox(n),c=g?[n.x+g.x+g.w/2,n.y+g.y+g.h/2]:C.center(n),dx=toward[0]-c[0],dy=toward[1]-c[1];if(!dx&&!dy)return c;const hw=(g?g.w:n.w)/2+1,hh=(g?g.h:n.h)/2+1,round=n.display==='circle'||n.type==='ellipse';if(round){const r=Math.min(hw,hh),l=Math.hypot(dx,dy);return[c[0]+dx/l*r,c[1]+dy/l*r]}const k=Math.min(hw/Math.abs(dx||1e-9),hh/Math.abs(dy||1e-9));return[c[0]+dx*k,c[1]+dy*k]}
const slots=new Map();
function resolveEnd(e,key,byId){
  const r=e[key];if(!r)return null;const n=byId.get(r.node);if(!n)return null;
  if(!r.port&&e.routing==='auto'){const s=slots.get(e.id+':'+key);if(s&&s.node===n.id)return{p:C.portPoint(n,s),dir:C.portDir(n,s),node:n}}
  if(r.port){const p=n.ports?.find(q=>q.id===r.port);if(!p)return null;return{p:C.portPoint(n,p),dir:C.portDir(n,p),node:n}}
  const other=refPoint(e,key==='from'?'to':'from',byId);
  if(e.routing==='straight'||(e.routing==='free'&&e.points.length===2))return{p:boundaryPoint(n,e.points.length>2&&e.routing!=='straight'?(key==='from'?e.points[1]:e.points.at(-2)):other),dir:null,node:n};
  const c=C.center(n),ports=n.ports?.length?n.ports:C.defaultPorts();let best=null;
  for(const p of ports){const q=C.portPoint(n,p),dir=C.portDir(n,p),v=DIRV[dir]||[0,0],face=(other[0]-c[0])*v[0]+(other[1]-c[1])*v[1],s=dist(q,other)+(face<0?2000:0);if(!best||s<best.s)best={s,p:q,dir,node:n}}
  return best}

// Dynamic-glue ends of auto-routed links are spread along the device side that faces the other end
// (vertical sides win when the other end is mostly above/below, giving tidy tree layouts).
function sideFor(n,other){const c=C.center(n);let[dx,dy]=C.rotateVec([other[0]-c[0],other[1]-c[1]],-(n.rotation||0));if(n.flipX)dx=-dx;if(n.flipY)dy=-dy;const vx=Math.abs(dx)-n.w/2,vy=Math.abs(dy)-n.h/2;return vy>0&&(vy>=vx*.6||vy>=60&&vy*4>=vx)||vx<=0?(dy>0?'down':'up'):(dx>0?'right':'left')}
function assignSlots(edges,byId){slots.clear();const groups=new Map();
  for(const e of edges){if(e.routing!=='auto')continue;for(const k of['from','to']){const r=e[k];if(!r||r.port)continue;const n=byId.get(r.node);if(!n||n.kind!=='node')continue;const other=refPoint(e,k==='from'?'to':'from',byId),side=sideFor(n,other),g=n.id+'|'+side;if(!groups.has(g))groups.set(g,{n,side,list:[]});groups.get(g).list.push({e,k,other})}}
  for(const{n,side,list}of groups.values()){const horiz=side==='up'||side==='down',c=C.center(n);list.sort((a,b)=>{const pa=C.rotateVec([a.other[0]-c[0],a.other[1]-c[1]],-(n.rotation||0)),pb=C.rotateVec([b.other[0]-c[0],b.other[1]-c[1]],-(n.rotation||0));return(horiz?pa[0]-pb[0]:pa[1]-pb[1])||(a.e.id<b.e.id?-1:1)});
    const m=list.length,step=Math.min(.8/m,.2);list.forEach((it,i)=>{let t=.5+(i-(m-1)/2)*step;if(horiz&&n.flipX||!horiz&&n.flipY)t=1-t;const pos=side==='up'?{x:t,y:0}:side==='down'?{x:t,y:1}:side==='left'?{x:0,y:t}:{x:1,y:t};slots.set(it.e.id+':'+it.k,{...pos,node:n.id})})}}

// ---------- routing ----------
const dirty=new Set();
function markDirty(id){dirty.add(id)}
function elbow(a,b){const pts=[[a.x,a.y]],ax=DIRV[a.dir]||[0,0],bx=DIRV[b.dir]||[0,0],s=18,p1=[a.x+ax[0]*s,a.y+ax[1]*s],p2=[b.x+bx[0]*s,b.y+bx[1]*s];if(a.dir)pts.push(p1);const h=!a.dir||a.dir==='left'||a.dir==='right';pts.push(h?[p2[0],p1[1]]:[p1[0],p2[1]]);if(b.dir)pts.push(p2);pts.push([b.x,b.y]);return simplify(pts)}
function obstacleList(items){const out=[];for(const n of items){if(n.kind!=='node'||n.type==='rack'||n.type==='frame')continue;const b=C.bounds([n]);out.push({x:b.x,y:b.y,w:b.w,h:b.h,id:n.id});
  // device names are obstacles too, so links don't run through other devices' labels
  const l=n.labels?.[0];if(l&&!l.rotation&&(l.y>b.y+b.h||l.y<b.y)){const m=C.labelMetrics(l,C.resolve(n,l)),extra=l.y>b.y+b.h?labelExtra(n):0;out.push({x:l.x+m.left-2,y:l.y+m.top-1,w:Math.max(m.w,extra?60:0)+4,h:m.h+2+extra,id:n.id+'#label'})}}return out}
let labelExtra=()=>0;function setLabelExtra(fn){labelExtra=fn}
function route(e,items,byId,obstacles,avoid){
  const A=resolveEnd(e,'from',byId),B=resolveEnd(e,'to',byId);
  const pa=A?.p||e.points[0],pb=B?.p||e.points.at(-1);
  if(e.routing==='straight'){e.points=[pa,pb];return}
  const a={x:pa[0],y:pa[1],dir:A?.dir||null},b={x:pb[0],y:pb[1],dir:B?.dir||null};
  let pts=null;
  const others=(obstacles||[]).filter(o=>o.id!==A?.node.id&&o.id!==B?.node.id),hits=q=>q&&q.some((p,i)=>i&&others.some(o=>segHitsBox(q[i-1],p,o)));
  try{if(typeof Router!=='undefined'){pts=Router.route(a,b,obstacles,{margin:14,stub:18,bendPenalty:40,sourceId:A?.node.id,targetId:B?.node.id,avoidSegments:avoid});
    // tightly packed devices: retry with smaller clearances rather than cutting through a neighbour
    if(hits(pts)){const t=Router.route(a,b,obstacles,{margin:5,stub:8,bendPenalty:40,sourceId:A?.node.id,targetId:B?.node.id,avoidSegments:avoid});if(!hits(t))pts=t}}}catch(err){console.warn('route failed',err)}
  if(!pts||pts.length<2||pts.some(q=>!Number.isFinite(q[0])||!Number.isFinite(q[1])))pts=elbow(a,b);
  e.points=simplify(pts.map(q=>[+q[0].toFixed(2),+q[1].toFixed(2)]))}
// Sibling links fanning out from one side of a device (switch → row of endpoints) get nested bend levels:
// the outermost link turns nearest the device, so the fan never crosses itself.
function nestFans(edges,byId,obstacles){const groups=new Map(),opp={up:'down',down:'up',left:'right',right:'left'};
  for(const e of edges){if(e.routing!=='auto')continue;for(const k of['from','to']){const r=e[k];if(!r||r.port)continue;const sl=slots.get(e.id+':'+k);if(!sl)continue;const n=byId.get(r.node),side=C.portDir(n,sl),ok=k==='from'?'to':'from';if(!side)continue;
    const A=resolveEnd(e,k,byId),B=resolveEnd(e,ok,byId);if(!A||!B||B.dir!==opp[side])continue;const v=side==='up'||side==='down',sign=side==='down'||side==='right'?1:-1,ax=v?0:1,ay=v?1:0;if(sign*(B.p[ay]-A.p[ay])<60||Math.abs(B.p[ax]-A.p[ax])<1)continue;
    const g=n.id+'|'+side;if(!groups.has(g))groups.set(g,[]);groups.get(g).push({e,k,a:A.p,d:B.p,n,other:B.node,v,sign,ax,ay})}}
  for(const all of groups.values()){if(all.length<2)continue;const{v,sign,ax,ay}=all[0];
    // only siblings that end on the same row as most of the fan (a switch feeding a row of devices)
    const lv=all.map(it=>it.d[ay]).sort((p,q)=>p-q),med=lv[Math.floor(lv.length/2)],list=all.filter(it=>Math.abs(it.d[ay]-med)<40);if(list.length<2)continue;
    for(const half of[list.filter(it=>it.d[ax]<it.a[ax]),list.filter(it=>it.d[ax]>it.a[ax])]){if(!half.length)continue;half.sort((p,q)=>Math.abs(q.d[ax]-q.a[ax])-Math.abs(p.d[ax]-p.a[ax]));
      let base=Math.max(...half.map(it=>sign*it.a[ay]))*sign+sign*22;const lab=obstacles.find(o=>o.id===half[0].n.id+'#label');if(lab&&v){if(sign>0&&lab.y>=half[0].a[1]-1)base=Math.max(base,lab.y+lab.h+10);if(sign<0&&lab.y+lab.h<=half[0].a[1]+1)base=Math.min(base,lab.y-10)}
      const paths=half.map((it,i)=>{const lv=base+sign*i*10;if(sign*(it.d[ay]-sign*16-lv)<0)return null;const p1=v?[it.a[0],lv]:[lv,it.a[1]],p2=v?[it.d[0],lv]:[lv,it.d[1]];const pts=[it.a,p1,p2,it.d],own=o=>o.id===it.n.id||o.id===it.other.id||o.id.startsWith(it.n.id+'#')||o.id.startsWith(it.other.id+'#');for(let j=1;j<4;j++)if(obstacles.some(o=>!own(o)&&segHitsBox(pts[j-1],pts[j],o)))return null;return pts});
      if(paths.some(x=>!x))continue;half.forEach((it,i)=>{const q=paths[i].map(p=>[+p[0].toFixed(2),+p[1].toFixed(2)]);it.e.points=it.k==='from'?q:q.reverse()})}}}
function segHitsBox(p,q,o){const x0=Math.min(p[0],q[0]),x1=Math.max(p[0],q[0]),y0=Math.min(p[1],q[1]),y1=Math.max(p[1],q[1]);return x1>o.x+1&&x0<o.x+o.w-1&&y1>o.y+1&&y0<o.y+o.h-1}
function segmentsOf(edges){const out=[];for(const e of edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i];out.push([a[0],a[1],b[0],b[1]])}return out}
function crossesBox(e,b){for(let i=1;i<e.points.length;i++){const p=e.points[i-1],q=e.points[i],sb={x:Math.min(p[0],q[0])-1,y:Math.min(p[1],q[1])-1,w:Math.abs(p[0]-q[0])+2,h:Math.abs(p[1]-q[1])+2};if(C.overlaps(sb,b))return true}return false}

// Manual connectors: attached endpoints follow devices, adjacent right-angle bends adjust locally (Port v2 behaviour).
function follow(e,byId,moved){
  if(e.follow===false)return;const ups=[];
  for(const key of['from','to']){const r=e[key];if(!r||!moved.has(r.node))continue;const res=resolveEnd(e,key,byId);if(!res)continue;const next=res.p,i=key==='from'?0:e.points.length-1,old=e.points[i];if(dist(old,next)<1e-7)continue;
    if(e.points.length>=3&&e.curve!=='smooth'&&['hv','vh'].includes(e.routing)){const nb=key==='from'?1:e.points.length-2,q=e.points[nb];if(Math.abs(q[0]-old[0])<1e-7)q[0]=next[0];else if(Math.abs(q[1]-old[1])<1e-7)q[1]=next[1]}
    ups.push({i,next})}
  ups.forEach(u=>e.points[u.i]=u.next);if(ups.length)orthogonalize(e)}

// Called before every render: detect moved devices, then follow / re-route the connectors that depend on them.
const geos=new Map();
function sync(items,{rerouteAll=false,pageId='default'}={}){
  if(!geos.has(pageId))geos.set(pageId,new Map());const geo=geos.get(pageId);
  const byId=new Map(items.map(n=>[n.id,n])),moved=new Set(),boxes=[],seen=new Set();
  for(const n of items){if(n.kind!=='node')continue;seen.add(n.id);const key=n.x+','+n.y+','+n.w+','+n.h+','+(n.rotation||0)+(n.flipX?'x':'')+(n.flipY?'y':'')+JSON.stringify(n.ports),prev=geo.get(n.id);if(prev&&prev.key!==key){moved.add(n.id);boxes.push(prev.box,C.box(n))}geo.set(n.id,{key,box:C.box(n)})}
  for(const id of geo.keys())if(!seen.has(id)&&!byId.has(id)){boxes.push(geo.get(id).box);geo.delete(id)}
  const edges=items.filter(n=>n.kind==='edge');let obstacles=null;const todo=[];assignSlots(edges,byId);
  for(const e of edges){
    const attachedMoved=(e.from&&moved.has(e.from.node))||(e.to&&moved.has(e.to.node));
    if(e.routing==='auto'){const slotMoved=['from','to'].some(k=>{const sl=e[k]&&!e[k].port&&slots.get(e.id+':'+k);if(!sl)return false;const n=byId.get(sl.node),q=C.portPoint(n,sl),p=k==='from'?e.points[0]:e.points.at(-1);return dist(p,q)>.5});if(rerouteAll||dirty.has(e.id)||attachedMoved||slotMoved||boxes.some(b=>crossesBox(e,b)))todo.push(e)}
    else if(e.routing==='straight'){if(rerouteAll||dirty.has(e.id)||attachedMoved)route(e,items,byId,null,null)}
    else{if(dirty.has(e.id)){for(const k of['from','to'])if(e[k]){const r=resolveEnd(e,k,byId);if(r)e.points[k==='from'?0:e.points.length-1]=r.p}orthogonalize(e)}else if(attachedMoved){follow(e,byId,moved);
      // dynamic-glue manual links may pick a better side as devices move
      for(const k of['from','to'])if(e[k]&&!e[k].port){const r=resolveEnd(e,k,byId);if(r)e.points[k==='from'?0:e.points.length-1]=r.p}}}
  }
  if(todo.length){obstacles=obstacleList(items);const others=edges.filter(e=>!todo.includes(e));const avoid=segmentsOf(others);for(const e of todo){route(e,items,byId,obstacles,avoid);avoid.push(...segmentsOf([e]))}nestFans(edges,byId,obstacles)}
  for(const e of edges)dirty.delete(e.id);return moved}
function reset(){geos.clear();dirty.clear()}

// ---------- positions along a connector ----------
function pointAt(e,t){const m=metric(sample(e));return at(m,m.total*t)}
function nearestT(e,p){const m=metric(sample(e));let best=Infinity,bs=0;for(let i=1;i<m.points.length;i++){const a=m.points[i-1],b=m.points[i],vx=b[0]-a[0],vy=b[1]-a[1],len2=vx*vx+vy*vy||1,r=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/len2)),q=[a[0]+r*vx,a[1]+r*vy],d=dist(q,p);if(d<best){best=d;bs=m.lengths[i-1]+r*(m.lengths[i]-m.lengths[i-1])}}return{t:m.total?bs/m.total:.5,distance:best,point:at(m,bs)}}
// Place anchored labels (midpoint labels that ride along with re-routed connectors).
function placeLabels(e){if(!e.labels?.length)return;let m=null;for(const l of e.labels)if(l.anchor){m??=metric(sample(e));const q=at(m,m.total*l.anchor.t);l.x=q[0]+(l.anchor.dx||0);l.y=q[1]+(l.anchor.dy||0)}}
// Interface-name label positions near each end of a connector.
function endLabelPos(e,key,offset=16,center=null){const m=metric(sample(e));if(m.total<4)return null;const s=key==='from'?Math.min(offset,m.total/3):Math.max(m.total-offset,m.total*2/3),q=at(m,s),t=tangent(m,s),vertical=Math.abs(t[1])>Math.abs(t[0]);
  // labels sit beside vertical runs (outward from the device centre) and above/below horizontal runs
  if(vertical){const right=center?q[0]>=center[0]-.5:true;return{x:q[0]+(right?5:-5),y:q[1]+3,anchor:right?'start':'end'}}const below=center?q[1]>center[1]+.5:false;return{x:q[0],y:q[1]+(below?12:-5),anchor:'middle'}}

return{setLabelExtra,sample,metric,at,path,orthogonalize,simplify,resolveEnd,boundaryPoint,route,sync,reset,markDirty,pointAt,nearestT,placeLabels,endLabelPos,obstacleList,elbow};
})();
if(typeof Core!=='undefined')Core.setSampler(Conn.sample);
