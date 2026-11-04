// Join lines: many Visio drawings draw one cable as several separate lines laid end to end. This finds those chains and
// merges each into one connector that looks the same, keeps the glue of its far ends and follows a moved device.
// Used by the Visio importer, Home ▸ Connector ▸ Join lines and the Check rule. Pure (Core only), so it is node-tested.
const JoinLines=(()=>{
const C=Core,TOL=1.2,SEL_TOL=3;
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]),lengthOf=p=>{let s=0;for(let i=1;i<p.length;i++)s+=dist(p[i],p[i-1]);return s};
const tolOf=page=>Number.isFinite(page?.joinTol)&&page.joinTol>0?page.joinTol:TOL,scaleOf=page=>tolOf(page)/TOL;
const sampled=e=>e.curve==='smooth'&&typeof Conn!=='undefined'?Conn.sample(e):e.points.map(p=>p.slice());
const endKey=end=>end?'to':'from',inset=(q,n)=>Math.min(q[0]-n.x,n.x+n.w-q[0],q[1]-n.y,n.y+n.h-q[1]),clamp01=v=>Math.max(0,Math.min(1,v));

// ---------- panels and glue targets ----------
// A panel is a background box that holds other shapes (a building, a floor): lines run across it without connecting to it.
const holds=(o,i)=>i!==o&&i.x>=o.x-.5&&i.y>=o.y-.5&&i.x+i.w<=o.x+o.w+.5&&i.y+i.h<=o.y+o.h+.5;
function isPanel(n,nodes){if(n.kind!=='node')return false;let k=0;for(const i of nodes)if(i.kind==='node'&&holds(n,i)&&++k>=3)return true;return false}
function panelSet(nodes){const list=nodes.filter(n=>n.kind==='node');return new Set(list.filter(n=>isPanel(n,list)))}
// The shape a line's free end belongs to: the smallest one under it; a panel only when the end is at its edge.
function pickTarget(q,nodes,{s=1,panels}={}){const m=1.5*s,P=panels||panelSet(nodes);let best=null,area=Infinity;
  for(const n of nodes){if(n.kind!=='node'||n.rotation||n.w<=2||n.h<=2||q[0]<n.x-m||q[0]>n.x+n.w+m||q[1]<n.y-m||q[1]>n.y+n.h+m)continue;if(P.has(n)&&inset(q,n)>3*s)continue;const a=n.w*n.h;if(a<area){area=a;best=n}}return best}
// Put a line's end on point pp; on a right-angle path its neighbour slides too, so the last segment stays exact.
function setEnd(e,end,pp){const p=e.points,i=end?p.length-1:0,o=p[i],q=p[end?i-1:1];if(q&&(e.routing==='hv'||e.routing==='vh')){if(Math.abs(o[0]-q[0])<=.6)q[0]=pp[0];else if(Math.abs(o[1]-q[1])<=.6)q[1]=pp[1]}p[i]=pp.slice()}
// Glue a free end to node t, at a connection point exactly where it ends (full precision: rounding it would kink the line later).
function glueEnd(e,end,t){const q=end?e.points.at(-1):e.points[0],g=C.glyphBox(t)||{x:0,y:0,w:t.w,h:t.h},lx=(q[0]-t.x-t.w/2)*(t.flipX?-1:1)+t.w/2,ly=(q[1]-t.y-t.h/2)*(t.flipY?-1:1)+t.h/2,rx=clamp01((lx-g.x)/g.w),ry=clamp01((ly-g.y)/g.h);
  let port=(t.ports||[]).find(o=>Math.abs(o.x-rx)*g.w<1&&Math.abs(o.y-ry)*g.h<1);if(!port){port={id:C.uid(),x:rx,y:ry,name:''};(t.ports??=[]).push(port)}
  e[endKey(end)]={node:t.id,port:port.id};setEnd(e,end,C.portPoint(t,port));return port}

// ---------- which ends pair ----------
const candidate=(e,page)=>e.kind==='edge'&&!e.locked&&!e._ports&&(!page||e.curve!=='smooth');
const unnamedPort=(r,byId)=>byId?.get(r.node)?.ports?.find(q=>q.id===r.port)?.name==='';
const marked=a=>{const m=a.k==='to'?a.e.endMarker:a.e.startMarker;return!!m&&m!=='none'};
// The way a line runs from one of its ends (points closer than .5 px say nothing about it).
function away(a){const P=a.e.points;for(let i=1;i<P.length;i++){const q=a.k==='to'?P[P.length-1-i]:P[i],d=dist(a.p,q);if(d>.5)return[(q[0]-a.p[0])/d,(q[1]-a.p[1])/d]}return null}
// Two lines running the same way from where they touch would merge into a hairpin: a duplicate, or two cables side by side.
const hairpin=(a,c)=>{const u=away(a),v=away(c);return!!u&&!!v&&u[0]*v[0]+u[1]*v[1]>.9};
// Where a line stops at a shape, so two lines meeting there are two links: a shape's centre or named connection point. Not an
// unnamed port: the older importer made those at the joints.
const stopsOf=nodes=>{const P=panelSet(nodes);return nodes.filter(n=>!P.has(n)).flatMap(n=>[C.center(n),...(n.ports||[]).filter(q=>q.name!=='').map(q=>C.portPoint(n,q))])};
// Page rules: same look, no arrowhead in the middle, no hairpin, an end attached to a shape is a terminal. Except what the older
// importer did: it glued both touching ends to one unnamed port on the shape under them, and that glue means nothing.
function refused(a,c,byId,onStop){const x=a.e,y=c.e;if(x.stroke!==y.stroke||x.strokeWidth!==y.strokeWidth||(x.dash||'')!==(y.dash||'')||x.layer!==y.layer||(x.linkType||'')!==(y.linkType||''))return'style';if(marked(a)||marked(c))return'marker';
  const g=x[a.k],h=y[c.k];if(g||h){if(!g||!h||g.node!==h.node||!g.port||g.port!==h.port||!unnamedPort(g,byId))return'glue'}if(hairpin(a,c))return'hairpin';return onStop?.(a,c)?'device':null}
// Two ends pair when each is the other's nearest and any third end is clearly farther away; otherwise it is a junction.
function pairs(E,tol,accept){const cell=Math.max(2*tol,.5),grid=new Map(),cellOf=v=>Math.floor(v/cell);for(const a of E){const k=cellOf(a.p[0])+','+cellOf(a.p[1]);let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(a)}
  const near=a=>{const out=[],cx=cellOf(a.p[0]),cy=cellOf(a.p[1]);for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const b of grid.get(x+','+y)||[])if(b.i!==a.i)out.push(b);return out};
  const best=new Map();for(const a of E){let m=null,md=Infinity;for(const b of near(a)){const d=dist(a.p,b.p);if(d<=tol&&d<md){md=d;m=b}}best.set(a,m)}
  const link=new Map();for(const a of E){const c=best.get(a);if(!c||best.get(c)!==a||link.has(a)||a.n>c.n)continue;const lim=Math.max(2*dist(a.p,c.p),.5);
    const by=[...near(a),...near(c)].filter(t=>t.i!==c.i&&t.i!==a.i&&(dist(t.p,a.p)<=lim||dist(t.p,c.p)<=lim));if(by.length){accept(a,c,'junction',by);continue}if(!accept(a,c))continue;link.set(a,c);link.set(c,a)}return link}
// plan(edges,{mode,tol,items}) → chains: each is a list of {e,rev} in path order (a single line is a chain of one).
// mode 'page' applies the page rules; 'selection' takes what it is given, for lines the user picked. chains.rejects says what stayed apart.
function plan(edges,opt={}){const page=opt.mode!=='selection',tol=opt.tol??(page?TOL:SEL_TOL),byId=page&&opt.items?new Map(opt.items.filter(n=>n.kind==='node').map(n=>[n.id,n])):null,list=edges.filter(e=>candidate(e,page)),E=[],rejects=[];
  list.forEach((e,i)=>{E.push({i,n:2*i,e,k:'from',p:e.points[0]},{i,n:2*i+1,e,k:'to',p:e.points.at(-1)})});
  let stops=null;const onStop=byId&&((a,c)=>(stops??=stopsOf([...byId.values()])).some(q=>dist(q,a.p)<=tol||dist(q,c.p)<=tol));
  const link=pairs(E,tol,(a,c,why,by=[])=>{why??=page?refused(a,c,byId,onStop):null;if(why)rejects.push({why,ids:[a.e.id,c.e.id,...by.map(t=>t.e.id)]});return!why}),other=a=>E[a.n^1],seen=new Set(),chains=[];
  const walk=s=>{const ch=[{e:s.e,rev:s.k==='to'}];seen.add(s.i);let cur=other(s);while(link.has(cur)){const nx=link.get(cur);if(seen.has(nx.i))break;seen.add(nx.i);ch.push({e:nx.e,rev:nx.k==='to'});cur=other(nx)}chains.push(ch)};
  for(const s of E)if(!link.has(s)&&!seen.has(s.i))walk(s);
  for(const s of E)if(!seen.has(s.i))walk(s);// closed loops: start anywhere, the last touch stays open
  chains.rejects=rejects;return chains}
// The lines a page join may touch: not on a hidden or locked layer.
const layerIn=(doc,e)=>doc?.layers?.find(l=>l.id===e.layer)||doc?.layers?.[0];
function planPage(doc,page,opt={}){return plan(page.items.filter(e=>e.kind==='edge'&&layerIn(doc,e)?.visible!==false&&!layerIn(doc,e)?.locked),{mode:'page',tol:tolOf(page),items:page.items,...opt})}
// Two lines that do not touch: the chain that joins their nearest ends with a new segment.
function bridge(a,b){const c=[[0,0],[0,1],[1,0],[1,1]].map(([ra,rb])=>({ra,rb,d:dist(ra?a.points[0]:a.points.at(-1),rb?b.points.at(-1):b.points[0])})).sort((u,v)=>u.d-v.d)[0],ch=[{e:a,rev:!!c.ra},{e:b,rev:!!c.rb}];ch.bridge=true;return ch}

// ---------- merging ----------
const axis=(p,q)=>Math.abs(p[0]-q[0])<=.6?'V':Math.abs(p[1]-q[1])<=.6?'H':'D';
function tidy(p,eps){const r=[];for(const v of p){const w=r.at(-1);if(w&&dist(w,v)<=eps)continue;if(r.length>=2){const u=r.at(-2),ax=w[0]-u[0],ay=w[1]-u[1],bx=v[0]-w[0],by=v[1]-w[1],la=Math.hypot(ax,ay)||1;if(ax*bx+ay*by>0&&Math.abs(ax*by-ay*bx)/la<=Math.max(eps,1e-9)){r[r.length-1]=v;continue}}r.push(v)}if(r.length<2)r.push(r[0].slice());return r}
// Points of the joined path. At a corner the two runs meet where they cross, so neither moves; collinear runs stay on one line
// (a real offset becomes a small step); only a diagonal side falls back to the midpoint. Remaining skew up to .5 px is snapped
// to exact equality: Conn.orthogonalize and Conn.follow compare exactly, and a skew would sprout a corner at every later edit.
function pathOf(chain){let p=[];for(const c of chain){const q=sampled(c.e);if(c.rev)q.reverse();if(!p.length){p=q;continue}const a=p.at(-1),z=q[0];if(chain.bridge){p.push(...q);continue}if(dist(a,z)<=.01){p.push(...q.slice(1));continue}
    const da=axis(p.at(-2),a),dz=axis(z,q[1]),mid=[(a[0]+z[0])/2,(a[1]+z[1])/2];
    if(da==='H'&&dz==='V')p[p.length-1]=[z[0],a[1]];else if(da==='V'&&dz==='H')p[p.length-1]=[a[0],z[1]];
    else if(da==='H'&&dz==='H'&&Math.abs(a[1]-z[1])>.5)p.splice(-1,1,[mid[0],a[1]],[mid[0],z[1]]);else if(da==='V'&&dz==='V'&&Math.abs(a[0]-z[0])>.5)p.splice(-1,1,[a[0],mid[1]],[z[0],mid[1]]);else p[p.length-1]=mid;
    p.push(...q.slice(1))}
  if(chain.some(c=>c.e.curve==='smooth'))return tidy(p,.01);
  p=tidy(p,.01).map(q=>q.slice());for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(Math.abs(a[0]-b[0])<=.5)b[0]=a[0];else if(Math.abs(a[1]-b[1])<=.5)b[1]=a[1]}return tidy(p,1e-9)}
const exactHV=p=>p.every((q,i)=>!i||q[0]===p[i-1][0]||q[1]===p[i-1][1]);
// Where each piece sits along the joined path, to move anchored labels and comment pins with it.
function spans(chain){let run=0,prev=null;const map=new Map();for(const c of chain){const q=sampled(c.e);if(c.rev)q.reverse();if(chain.bridge&&prev)run+=dist(prev,q[0]);const len=lengthOf(q);map.set(c.e.id,{run,len,rev:c.rev});run+=len;prev=q.at(-1)}return{map,total:run||1}}
const along=(sp,id,t)=>{const s=sp.map.get(id);return+((s.run+(s.rev?1-t:t)*s.len)/sp.total).toFixed(6)};
// merge(chain) → the joined edge. Style from the longest piece; id, layer and link from the first; glue, interface names and arrowheads from the far ends.
function merge(chain){const pieces=chain.map(c=>c.e),base=pieces.reduce((m,e)=>lengthOf(sampled(e))>lengthOf(sampled(m))?e:m,pieces[0]),first=chain[0],last=chain.at(-1),far=(c,atStart,k0,k1)=>(atStart?c.rev:!c.rev)?c.e[k1]:c.e[k0];
  const out=C.copy(base);out.id=first.e.id;out.layer=first.e.layer;if(first.e.url)out.url=first.e.url;else delete out.url;delete out.locked;
  const put=(k,v)=>{if(v===undefined)delete out[k];else out[k]=C.copy(v)};put('from',far(first,true,'from','to')??null);put('to',far(last,false,'from','to')??null);put('fromIf',far(first,true,'fromIf','toIf'));put('toIf',far(last,false,'fromIf','toIf'));put('startMarker',far(first,true,'startMarker','endMarker')??'none');put('endMarker',far(last,false,'startMarker','endMarker')??'none');
  const sp=spans(chain);out.labels=pieces.flatMap(e=>(e.labels||[]).map(l=>{const n=C.copy(l);if(n.anchor)n.anchor.t=along(sp,e.id,n.anchor.t??.5);return n}));
  const data={};for(const e of pieces)for(const[k,v]of Object.entries(e.data||{}))if(data[k]==null||data[k]==='')data[k]=C.copy(v);out.data=data;
  if(!pieces.every(e=>e.group&&e.group===first.e.group))delete out.group;
  out.points=pathOf(chain);out.curve='straight';out.routing=exactHV(out.points)&&!pieces.some(e=>e.curve==='smooth')?'hv':'free';return out}

// ---------- applying it to a page ----------
// Merges the chains in place: a joined link keeps its first piece's id and takes its topmost piece's place in the stacking order
// (a run drawn over a faceplate stays over it), what pointed at a piece now points at the link, and unnamed connection points
// that only those pieces used or that lost the older importer's glue go away, except on a locked shape. Returns the counts.
function applyPage(doc,page,opt={}){const chains=opt.chains||planPage(doc,page),todo=chains.filter(c=>c.length>1),s=scaleOf(page);if(!todo.length)return{merged:0,pieces:0,links:page.items.filter(e=>e.kind==='edge').length,survivors:[],absorbed:[]};
  const index=new Map(page.items.map((n,i)=>[n.id,i])),tops=new Map(),pieces=new Set(),gone=new Map(),merged=new Map(),spare=new Set(),mark=r=>spare.add(r.node+'|'+r.port);for(const ch of todo){const e=merge(ch),sp=spans(ch);tops.set(ch.reduce((m,c)=>index.get(c.e.id)>index.get(m.e.id)?c:m).e.id,e);merged.set(ch,e);for(const c of ch){pieces.add(c.e.id);if(c!==ch[0])gone.set(c.e.id,e.id);for(const k of['from','to'])if(c.e[k]?.port)mark(c.e[k]);for(const r of doc?.review?.comments||[])if(r.target===c.e.id){r.rel=[along(sp,c.e.id,r.rel?.[0]??.5)];r.target=e.id}}}
  page.items=page.items.filter(n=>tops.has(n.id)||!pieces.has(n.id)).map(n=>tops.get(n.id)||n);for(const t of page.items)if(t.target&&gone.has(t.target))t.target=gone.get(t.target);
  for(const id of gone.keys()){if(doc?.revBaseline?.items)delete doc.revBaseline.items[id];if(doc?.review?.baseline){delete doc.review.baseline.items?.[id];delete doc.review.baseline.boxes?.[id]}}
  const nodes=page.items.filter(n=>n.kind==='node'),byId=new Map(nodes.map(n=>[n.id,n]));let panels=null;
  for(const ch of chains){const e=merged.get(ch)||ch[0].e;for(const end of[0,1]){const key=endKey(end),r=e[key],n=r&&byId.get(r.node),port=r?.port&&n?.ports?.find(q=>q.id===r.port);if(!port)continue;const q=end?e.points.at(-1):e.points[0];
      if(port.name===''&&inset(q,n)>3*s&&(panels??=panelSet(nodes)).has(n)){mark(r);e[key]=null;continue}// the older importer's glue to a background panel
      if(merged.has(ch)){const pp=C.portPoint(n,port);if(dist(pp,q)<=2*s)setEnd(e,end,pp)}}}
  const used=new Set();for(const e of page.items)if(e.kind==='edge')for(const k of['from','to'])if(e[k]?.port)used.add(e[k].port);
  const stray=(n,q)=>q.name===''&&spare.has(n.id+'|'+q.id)&&!used.has(q.id);for(const n of nodes)if(!n.locked&&!layerIn(doc,n)?.locked&&n.ports?.some(q=>stray(n,q)))n.ports=n.ports.filter(q=>!stray(n,q));
  return{merged:todo.length,pieces:todo.reduce((k,c)=>k+c.length,0),links:page.items.filter(e=>e.kind==='edge').length,survivors:[...merged.values()].map(e=>e.id),absorbed:[...gone.keys()]}}
// What a page join would do, for the Check rule: how many links are in pieces, and where the first joint is.
function pending(doc,page){const todo=planPage(doc,page).filter(c=>c.length>1);if(!todo.length)return null;const c=todo[0][0];return{links:todo.length,pieces:todo.reduce((k,x)=>k+x.length,0),at:(c.rev?c.e.points[0]:c.e.points.at(-1)).slice()}}
// Why touching ends stayed apart, in words.
function why(rejects=[]){const n=w=>rejects.filter(r=>r.why===w).length,of=(k,one,many)=>k?`${k} touching pair${k>1?'s':''} ${k>1?many:one}`:'',out=[of(n('style'),'differs in style or layer','differ in style or layer'),of(n('marker'),'has an arrowhead at the joint','have arrowheads at the joint'),of(n('glue'),'is attached to a shape','are attached to shapes'),of(n('device'),'ends on a device','end on a device'),of(n('hairpin'),'doubles back on itself','double back on themselves')].filter(Boolean),j=n('junction');if(j)out.push(`${j} junction${j>1?'s':''} where 3 or more ends meet`);return out.join(', ')}

return{TOL,SEL_TOL,tolOf,scaleOf,isPanel,panelSet,pickTarget,setEnd,glueEnd,plan,planPage,bridge,merge,spans,applyPage,pending,why};
})();
if(typeof module!=='undefined')module.exports=JoinLines;
