// Drawing-quality checks behind Analyze ▸ Check and Review mode:
//  • connection integrity — lines attached to nothing, loose ends (and the device they stop at), self-connections,
//    one port carrying several cables;
//  • labels & data — free text that sits on a device or link without belonging to it, empty {{field}} labels,
//    duplicate names and identifiers, labels that say something other than the shape data;
//  • readability — overlapping labels or links, text hidden behind shapes, unreadable on its background or too small,
//    connectors drawn through devices, content off the page.
// Each finding carries a stable key (for open / resolved / accepted status) and the fixes that apply to it.
// Pure (Core + Shapes): the app passes nothing in, so the rules are node-tested.
const Checks=(()=>{
const C=Core;
const CATS=[['connectivity','Connection integrity'],['labels','Labels'],['data','Device data'],['readability','Readability'],['design','Network design']];
const RULE_CAT={unattached:'connectivity',dangling:'connectivity',selfloop:'connectivity',reuse:'connectivity',broken:'connectivity',isolated:'connectivity',pagelink:'connectivity',
  freelabel:'labels',mismatch:'labels',labelonly:'labels',placeholder:'labels',
  dupname:'data',dupid:'data',duphost:'data',dupip:'data',ipfmt:'data',hostfmt:'data',subnet:'data',netaddr:'data',gw:'data',cidr:'data',cidrnet:'data',gwout:'data',vlan:'data',
  labeloverlap:'readability',linkoverlap:'readability',hiddentext:'readability',tinytext:'readability',through:'readability',offpage:'readability',overlap:'readability',
  overlapnet:'design',poe:'design',rack:'design',util:'design',spof:'design',bridge:'design'};
const catOf=rule=>RULE_CAT[rule]||'design';
const key=i=>`${i.rule}|${[...new Set(i.ids)].sort().join(',')}|${i.sub??''}`;
const GENERIC=/^(top|right|bottom|left|edge \d+|port \d+)$/i,NEAR=24;
const MARKUP=new Set(['revcloud','revdelta']);

// ---------- geometry ----------
const gap=(a,b)=>Math.hypot(Math.max(0,a.x-(b.x+b.w),b.x-(a.x+a.w)),Math.max(0,a.y-(b.y+b.h),b.y-(a.y+a.h)));
const gapPt=(b,p)=>Math.hypot(Math.max(b.x-p[0],0,p[0]-b.x-b.w),Math.max(b.y-p[1],0,p[1]-b.y-b.h));
const inBox=(p,b)=>p[0]>=b.x&&p[0]<=b.x+b.w&&p[1]>=b.y&&p[1]<=b.y+b.h;
const shrink=(b,d)=>({x:b.x+d,y:b.y+d,w:b.w-2*d,h:b.h-2*d});
function segDist(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],L=vx*vx+vy*vy||1,t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/L));return{d:Math.hypot(a[0]+t*vx-p[0],a[1]+t*vy-p[1]),t,q:[a[0]+t*vx,a[1]+t*vy]}}
// Nearest point on a polyline, with its position along it (0–1).
function nearestOn(pts,p){let best={d:Infinity},run=0,total=0;const lens=[];for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);lens.push(l);total+=l}
  for(let i=1;i<pts.length;i++){const s=segDist(p,pts[i-1],pts[i]);if(s.d<best.d)best={d:s.d,q:s.q,at:run+s.t*lens[i-1]};run+=lens[i-1]}return{d:best.d,p:best.q||pts[0],t:total?best.at/total:.5}}
// Where segment a→b enters box b (Liang–Barsky), or null.
function segBox(a,c,b){let t0=0,t1=1;const dx=c[0]-a[0],dy=c[1]-a[1];for(const[p,q]of[[-dx,a[0]-b.x],[dx,b.x+b.w-a[0]],[-dy,a[1]-b.y],[dy,b.y+b.h-a[1]]]){if(p===0){if(q<0)return null;continue}const r=q/p;if(p<0){if(r>t1)return null;if(r>t0)t0=r}else{if(r<t0)return null;if(r<t1)t1=r}}return t1-t0>1e-6?[a[0]+t0*dx,a[1]+t0*dy]:null}
const midOf=pts=>{let total=0;for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);let run=0;for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(run+l>=total/2){const t=l?(total/2-run)/l:0;return[pts[i-1][0]+t*(pts[i][0]-pts[i-1][0]),pts[i-1][1]+t*(pts[i][1]-pts[i-1][1])]}run+=l}return pts[0]};
const pathOf=e=>typeof Conn!=='undefined'&&Conn.sample?Conn.sample(e):e.points;

// ---------- text ----------
const txt=(n,l)=>String(C.resolve(n,l)??'').trim();
const short=s=>{s=String(s).replace(/\s*\n\s*/g,' · ');return s.length>40?s.slice(0,38)+'…':s};
const nameOf=n=>{if(!n)return'';const l=n.labels?.[0],t=l?txt(n,l).split('\n')[0]:'';return t||n.data?.hostname||(n.kind==='node'?Shapes.nameOf(n.type):n.kind==='zone'?'Zone':n.kind==='text'?'Text':n.kind)};
function labelBox(n,l){const t=C.resolve(n,l);if(!String(t??'').trim())return null;const m=C.labelMetrics(l,t),a=(l.rotation||0)*Math.PI/180;if(!a)return{x:l.x+m.left,y:l.y+m.top,w:m.w,h:m.h};
  const pts=[[m.left,m.top],[m.left+m.w,m.top],[m.left+m.w,m.top+m.h],[m.left,m.top+m.h]].map(([x,y])=>[l.x+x*Math.cos(a)-y*Math.sin(a),l.y+x*Math.sin(a)+y*Math.cos(a)]),xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  return{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)}}
const isDev=n=>n.kind==='node'&&Shapes.isDevice(n)&&!Shapes.rackItems[n.type]&&n.type!=='rack';

// ---------- colour ----------
function rgba(c){if(!c||c==='none'||c==='transparent')return null;let m=/^#([\da-f])([\da-f])([\da-f])$/i.exec(c);if(m)return[...m.slice(1).map(h=>parseInt(h+h,16)),1];m=/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})([\da-f]{2})?$/i.exec(c);if(m)return[parseInt(m[1],16),parseInt(m[2],16),parseInt(m[3],16),m[4]?parseInt(m[4],16)/255:1];return null}
function over(top,under,alpha=1){const t=rgba(top),u=rgba(under)||[255,255,255,1];if(!t)return under;const a=t[3]*alpha;return'#'+[0,1,2].map(i=>Math.round(t[i]*a+u[i]*(1-a)).toString(16).padStart(2,'0')).join('')}
function lum(c){const v=rgba(c);if(!v)return 1;const f=x=>{x/=255;return x<=.03928?x/12.92:((x+.055)/1.055)**2.4};return .2126*f(v[0])+.7152*f(v[1])+.0722*f(v[2])}
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05)};

// ---------- the checks ----------
function run(doc){
  const out=[],all=new Map();for(const p of doc.pages)for(const n of p.items)all.set(n.id,n);
  const hidden=new Set((doc.layers||[]).filter(l=>l.visible===false).map(l=>l.id)),vis=n=>!hidden.has(n.layer);
  for(const page of doc.pages){if(page.isBackground)continue;const pi=doc.pages.indexOf(page);
    const add=(severity,ids,message,rule,extra={})=>out.push({severity,page:pi,ids:[].concat(ids).filter(Boolean),message,rule,cat:catOf(rule),...extra});
    const items=page.items.filter(vis);connectivity(items,add);labelsData(items,add,doc,all);readability(items,add,page)}
  identifiers(doc,out,vis);
  for(const i of out)i.key=key(i);return out}

function connectivity(items,add){
  const byId=new Map(items.map(n=>[n.id,n])),targets=items.filter(n=>n.kind==='node'&&n.type!=='rack'&&!n.pin&&!MARKUP.has(n.type));
  const nearest=(p,skip)=>{let best=null,bd=NEAR,ba=Infinity;for(const n of targets){if(skip.has(n.id))continue;const b=C.box(n),d=gapPt(b,p),a=b.w*b.h;if(d<bd||d===bd&&a<ba){bd=d;ba=a;best=n}}return best};
  const ports=new Map();
  for(const e of items){if(e.kind!=='edge')continue;const P=[e.points[0],e.points.at(-1)],refs=[e.from,e.to];
    if(!e.from&&!e.to){const a=nearest(P[0],new Set()),b=a&&nearest(P[1],new Set([a.id]));
      add('warning',e.id,a&&b?`A line runs from “${nameOf(a)}” to “${nameOf(b)}” without being attached to either.`:'A line is not attached to anything.','unattached',{at:midOf(e.points),fixes:[...(a&&b?[{id:'attach',label:'Attach both ends'}]:[]),{id:'delete',label:'Delete the line'}],fix:{a:a?.id,b:b?.id}})}
    else for(const k of[0,1]){if(refs[k])continue;const o=byId.get(refs[1-k]?.node),dev=nearest(P[k],new Set(o?[o.id]:[])),from=o?`from “${nameOf(o)}” `:'';
      add('warning',e.id,dev?`The connector ${from}stops at “${nameOf(dev)}” but is not attached to it.`:`The connector ${from}has a loose end.`,'dangling',{sub:k?'to':'from',at:P[k],fixes:[...(dev?[{id:'attach',label:`Attach to ${short(nameOf(dev))}`}]:[]),{id:'delete',label:'Delete'}],fix:{end:k?'to':'from',node:dev?.id}})}
    if(e.from&&e.to&&e.from.node===e.to.node){const n=byId.get(e.from.node);add('warning',e.id,`A connector starts and ends on “${n?nameOf(n):'the same device'}”.`,'selfloop',{fixes:[{id:'delete',label:'Delete the connector'}]})}
    if(e.linkType==='logical'||e.linkType==='power')continue;
    for(const k of[0,1]){const r=refs[k],n=r&&byId.get(r.node);if(!n)continue;const pt=r.port&&n.ports?.find(q=>q.id===r.port),names=new Map(),norm=s=>String(s).toLowerCase().replace(/\s+/g,'');
      if(pt&&pt.name&&!GENERIC.test(pt.name))names.set(norm(pt.name),pt.name);const ifn=String((k?e.toIf:e.fromIf)||'').trim();if(ifn)names.set(norm(ifn),ifn);
      for(const[nk,label]of names){const id=n.id+'|'+nk;let g=ports.get(id);if(!g)ports.set(id,g={n,label,edges:new Set()});g.edges.add(e.id)}}}
  // a patch panel port takes the patch cord at the front and the permanent link at the back
  for(const g of ports.values()){const max=/patch|odf|fib/i.test(g.n.type)?2:1;if(g.edges.size>max)add('warning',[g.n.id,...g.edges],`Port “${g.label}” on “${nameOf(g.n)}” is used by ${g.edges.size} connectors.`,'reuse',{sub:g.label.toLowerCase().replace(/\s+/g,'')})}}

const CIDR_RE=/\b\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}\b/g,PLACE_RE=/\{\{[^}]*\}\}/g,VLAN_RE=/\bVLAN[\s#:-]*(\d{1,4})\b/gi,SPEED_RE=/\b(\d+(?:\.\d+)?)\s*([KMGT])(?:b(?:ps|\/s|it\/s)?|bE|E)?\b/gi;
const literal=s=>String(s||'').replace(PLACE_RE,'');
const ipsShown=s=>[...new Set(C.ipsIn(literal(s).replace(CIDR_RE,'')))];
function labelsData(items,add,doc,all){
  const devs=items.filter(isDev),edges=items.filter(n=>n.kind==='edge'),byId=new Map(items.map(n=>[n.id,n]));
  // free text sitting on a device or a link without belonging to it
  for(const t of items){if(t.kind!=='text'||t.target||t.pin||t.revTable||!t.labels?.[0])continue;const l=t.labels[0],s=txt(t,l);if(!s||s.length>48||s.split('\n').length>3||l.size>=18)continue;const b=labelBox(t,l);if(!b)continue;
    let best=null,bd=14;for(const d of devs){const g=gap(b,C.bounds([d],true));if(g<bd){bd=g;best=d}}
    if(!best){let ed=12;const c=[b.x+b.w/2,b.y+b.h/2];for(const e of edges){const q=nearestOn(pathOf(e),c);if(q.d<ed){ed=q.d;best=e}}}
    if(best)add('warning',[t.id,best.id],`The text “${short(s)}” sits on ${best.kind==='edge'?`the link ${edgeName(best,byId)}`:`“${nameOf(best)}”`} but is not attached to it, so it will not move with it.`,'freelabel',{fixes:[{id:'attach',label:'Attach it'}],fix:{owner:best.id,text:t.id}})}
  // labels that say something other than the data
  for(const n of items){if(!n.labels?.length||n.kind==='text'||n.kind==='table'||n.kind==='legend')continue;const nm=nameOf(n);
    const labelWith=re=>n.labels.find(l=>re(literal(l.text)));
    if(isDev(n)){const ips=[...C.ipsIn(n.data?.ip),...C.ipsIn(n.data?.mgmtIp)],main=C.ipsIn(n.data?.ip)[0]||ips[0];
      for(const ip of ipsShown(n.labels.map(l=>l.text).join('\n'))){if(ips.includes(ip))continue;const l=labelWith(s=>ipsShown(s).includes(ip));
        if(ips.length)add('warning',n.id,`“${nm}”: the label shows ${ip}, but the IP address in its data is ${main}.`,'mismatch',{sub:'ip:'+ip,fixes:[{id:'useData',label:`Show ${main}`},{id:'useLabel',label:`Set the IP to ${ip}`}],fix:{label:l?.id,field:'ip',from:ip,to:main}});
        else add('info',n.id,`“${nm}”: the label shows ${ip}, but the device has no IP address in its data.`,'labelonly',{sub:'ip:'+ip,fixes:[{id:'useLabel',label:`Set the IP to ${ip}`}],fix:{label:l?.id,field:'ip',from:ip}})}}
    if(isDev(n)||n.kind==='zone'){const want=String(n.data?.vlan??'').split(/[,;\s]+/).filter(Boolean);
      if(want.length)for(const m of new Set([...literal(n.labels.map(l=>l.text).join('\n')).matchAll(VLAN_RE)].map(m=>String(+m[1]))))if(!want.includes(m)){const l=labelWith(s=>[...s.matchAll(VLAN_RE)].some(x=>String(+x[1])===m));
        add('warning',n.id,`“${nm}”: the label says VLAN ${m}, but its data says VLAN ${want.join(', ')}.`,'mismatch',{sub:'vlan:'+m,fixes:[{id:'useData',label:`Show VLAN ${want[0]}`},{id:'useLabel',label:`Set the VLAN to ${m}`}],fix:{label:l?.id,field:'vlan',from:m,to:want[0]}})}}
    if(n.kind==='zone'&&C.cidr(n.data?.subnet)){const want=C.cidr(n.data.subnet).text;for(const s of new Set(literal(n.labels.map(l=>l.text).join('\n')).match(CIDR_RE)||[])){const c=C.cidr(s);if(c&&c.text!==want){const l=labelWith(x=>x.includes(s));
      add('warning',n.id,`“${nm}”: the label shows ${s}, but the zone's subnet is ${want}.`,'mismatch',{sub:'subnet:'+s,fixes:[{id:'useData',label:`Show ${want}`},{id:'useLabel',label:`Set the subnet to ${s}`}],fix:{label:l?.id,field:'subnet',from:s,to:want}})}}}
    if(n.kind==='edge'&&Shapes.speedMbps(n.data?.speed)){const want=Shapes.speedMbps(n.data.speed);for(const m of new Set(literal(n.labels.map(l=>l.text).join('\n')).match(SPEED_RE)||[])){const v=Shapes.speedMbps(m);if(v&&Math.abs(v-want)>want*1e-6){const l=labelWith(x=>x.includes(m));
      add('warning',n.id,`The link ${edgeName(n,byId)}: the label says ${m.trim()}, but its speed is ${n.data.speed}.`,'mismatch',{sub:'speed:'+m.trim().toLowerCase(),fixes:[{id:'useData',label:`Show ${n.data.speed}`},{id:'useLabel',label:`Set the speed to ${m.trim()}`}],fix:{label:l?.id,field:'speed',from:m.trim(),to:n.data.speed}})}}}
    // {{field}} that shows nothing
    const fields=n.kind==='edge'?doc.linkFields||[]:n.kind==='zone'?C.ZONE_FIELDS||[]:doc.fields||[],asset=n.ref&&all.get(n.ref),seen=new Set();
    for(const l of n.labels)for(const m of String(l.text||'').matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)){let k=m[1],src={...(asset?.data||{}),...(n.data||{})};if(k.startsWith('asset.')){k=k.slice(6);src=asset?.data||{}}const f=fields.find(x=>x.key===k);if(!f||seen.has(k))continue;seen.add(k);
      if(String(src[k]??'').trim()==='')add('info',n.id,`“${nm}”: the label shows {{${k}}}, but ${f.label} is empty, so nothing appears there.`,'placeholder',{sub:k,fixes:[{id:'editData',label:`Fill in ${f.label}`}]})}}
  // the same name twice on one page — for names that identify a device (SW-01, Core switch 2), not default or
  // descriptive ones (Camera, LTE backup)
  const names=new Map();for(const n of devs){const nm=nameOf(n);if(!nm||nm===Shapes.nameOf(n.type)||/[×x]\s*\d+\s*$/.test(nm)||/\s/.test(nm)&&!/\d/.test(nm))continue;const k=nm.toLowerCase();if(!names.has(k))names.set(k,[]);names.get(k).push(n)}
  for(const list of names.values())if(list.length>1)add('warning',list.map(n=>n.id),`${list.length} devices on this page are named “${nameOf(list[0])}”.`,'dupname',{sub:nameOf(list[0]).toLowerCase()})}

// Serial numbers, MAC addresses, asset tags, cable and circuit IDs must be unique across the drawing.
function identifiers(doc,out,vis){
  const groups=[[n=>isDev(n),(doc.fields||[]).filter(f=>!f.multiline&&/serial|mac|asset|tag/i.test(f.key+' '+f.label))],[n=>n.kind==='edge',(doc.linkFields||[]).filter(f=>/cable|circuit/i.test(f.key+' '+f.label))]];
  for(const[want,fields]of groups)for(const f of fields){const seen=new Map();for(const p of doc.pages){if(p.isBackground)continue;for(const n of p.items){if(!vis(n)||!want(n))continue;const v=String(n.data?.[f.key]??'').trim();if(!v)continue;const k=v.toLowerCase();if(!seen.has(k))seen.set(k,{v,list:[]});seen.get(k).list.push({n,p})}}
    for(const{v,list}of seen.values())if(list.length>1){const i={severity:'error',page:doc.pages.indexOf(list[0].p),ids:list.map(x=>x.n.id),message:`${f.label} “${v}” is used ${list.length} times (${list.map(x=>x.n.kind==='edge'?'a link':nameOf(x.n)).slice(0,4).join(', ')}${list.length>4?'…':''}).`,rule:'dupid',cat:'data',sub:f.key+':'+v.toLowerCase()};out.push(i)}}}

function edgeName(e,byId){const a=byId?.get(e.from?.node),b=byId?.get(e.to?.node);return a&&b?`“${nameOf(a)}” – “${nameOf(b)}”`:a?`from “${nameOf(a)}”`:b?`to “${nameOf(b)}”`:'(unattached)'}
const band=n=>n.kind==='zone'?0:n.kind==='node'&&n.type==='rack'?1:n.kind==='edge'?2:n.kind==='node'&&Shapes.rackItems[n.type]?3:4;
function readability(items,add,page){
  const byId=new Map(items.map(n=>[n.id,n])),z=new Map(items.map((n,i)=>[n.id,band(n)*1e6+i])),L=[];
  for(const n of items){if(n.kind==='table'||n.kind==='legend'||MARKUP.has(n.type))continue;for(const l of n.labels||[]){const b=labelBox(n,l);if(b&&b.w>0&&b.h>0)L.push({n,l,b,a:b.w*b.h})}}
  // overlapping labels
  const rank=x=>x.n.kind==='text'?0:x.n.kind==='edge'?1:x.n.kind==='zone'?3:2;
  const S=[...L].sort((p,q)=>p.b.x-q.b.x);
  for(let i=0;i<S.length;i++){const A=S[i];for(let j=i+1;j<S.length&&S[j].b.x<A.b.x+A.b.w;j++){const B=S[j],ox=Math.min(A.b.x+A.b.w,B.b.x+B.b.w)-Math.max(A.b.x,B.b.x),oy=Math.min(A.b.y+A.b.h,B.b.y+B.b.h)-Math.max(A.b.y,B.b.y);
    if(ox<=1||oy<=1||ox*oy<Math.min(A.a,B.a)*.2)continue;
    const mv=rank(A)!==rank(B)?(rank(A)<rank(B)?A:B):z.get(A.n.id)>=z.get(B.n.id)?A:B,ot=mv===A?B:A,down=mv.b.y+mv.b.h/2>=ot.b.y+ot.b.h/2,dy=down?ot.b.y+ot.b.h-mv.b.y+3:ot.b.y-(mv.b.y+mv.b.h)-3;
    add('warning',A.n===B.n?A.n.id:[A.n.id,B.n.id],`Labels overlap: “${short(txt(A.n,A.l))}” and “${short(txt(B.n,B.l))}”.`,'labeloverlap',{sub:[A.l.id,B.l.id].sort().join(','),at:[Math.max(A.b.x,B.b.x)+ox/2,Math.max(A.b.y,B.b.y)+oy/2],fixes:[{id:'apart',label:'Move apart'}],fix:{owner:mv.n.id,label:mv.l.id,dy:Math.round(dy*10)/10}})}}
  // hidden text: on a background of nearly the same colour, behind a shape, or too small to read
  const zones=items.filter(n=>n.kind==='zone').sort((a,b)=>b.w*b.h-a.w*a.h),opaque=n=>n.kind==='table'||n.kind==='legend'||n.kind==='node'&&(!!n.image||!!Shapes.basic[n.type]&&!!rgba(n.fill)&&rgba(n.fill)[3]>.5||isDev(n)&&['card','tile','circle'].includes(n.display));
  const covers=items.filter(n=>opaque(n)&&!MARKUP.has(n.type));
  for(const{n,l,b}of L){const s=short(txt(n,l)),c=[b.x+b.w/2,b.y+b.h/2];
    if(!l.background){let bg=page.bg||'#ffffff';for(const zn of zones)if(zn!==n&&inBox(c,zn)&&zn.style!=='outline')bg=over(zn.fill,bg);
      if(n.kind==='zone'){if(n.style!=='outline')bg=over(n.fill,bg);if((n.style==='header'||n.style==='tab')&&c[1]<n.y+36)bg=over(n.headerFill||n.stroke,bg,n.style==='tab'?.22:n.headerFill?1:.3)}
      else if(n.kind==='node'&&Shapes.basic[n.type]&&inBox(c,n))bg=over(n.fill,bg);
      const fg=l.color||'#34465e';if(contrast(fg,bg)<1.6)add('warning',n.id,`“${s}” is hard to read: its colour is almost the same as the background.`,'hiddentext',{sub:'contrast:'+l.id,fixes:[{id:'contrast',label:'Fix the colour'}],fix:{owner:n.id,label:l.id,color:lum(bg)>.18?'#1f2f47':'#ffffff'}})}
    for(const m of covers){if(m===n||z.get(m.id)<=z.get(n.id))continue;const mb=C.box(m),ox=Math.min(b.x+b.w,mb.x+mb.w)-Math.max(b.x,mb.x),oy=Math.min(b.y+b.h,mb.y+mb.h)-Math.max(b.y,mb.y);
      if(ox>0&&oy>0&&ox*oy>=b.w*b.h*.5){add('warning',[n.id,m.id],`“${s}” is hidden behind “${nameOf(m)}”.`,'hiddentext',{sub:'covered:'+l.id,fixes:band(n)>=band(m)?[{id:'front',label:'Bring it to the front'}]:[],fix:{owner:n.id,label:l.id}});break}}
    if(l.size<5)add('info',n.id,`“${s}” is ${l.size} px — too small to read when printed.`,'tinytext',{sub:l.id,fixes:[{id:'enlarge',label:'Make it 7 px'}],fix:{owner:n.id,label:l.id}})}
  // connectors drawn through devices
  const solid=items.filter(n=>n.kind==='node'&&n.type!=='rack'&&!Shapes.rackItems[n.type]&&!n.pin&&!MARKUP.has(n.type)&&(isDev(n)||opaque(n)));
  for(const e of items){if(e.kind!=='edge')continue;const pts=pathOf(e),ends=new Set([e.from?.node,e.to?.node].filter(Boolean));
    for(const m of solid){if(ends.has(m.id))continue;const b=shrink(C.box(m),Math.min(4,C.box(m).w/4,C.box(m).h/4));if(b.w<=0||b.h<=0||pts.some(p=>inBox(p,b)))continue;
      for(let i=1;i<pts.length;i++){const hit=segBox(pts[i-1],pts[i],b);if(hit){add('warning',[e.id,m.id],`The link ${edgeName(e,byId)} passes through “${nameOf(m)}”.`,'through',{at:hit,fixes:[{id:'reroute',label:'Route it around'}],fix:{edges:[e.id]}});break}}}}
  // connectors that run on top of each other (links sharing a device may share a trunk on purpose)
  const H=new Map(),V=new Map(),push=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v)};
  for(const e of items){if(e.kind!=='edge'||e.curve==='smooth')continue;const p=e.points;for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];
    if(Math.abs(a[1]-b[1])<.5&&Math.abs(a[0]-b[0])>1)push(H,Math.round(a[1]/2),{e,c:a[1],lo:Math.min(a[0],b[0]),hi:Math.max(a[0],b[0])});
    else if(Math.abs(a[0]-b[0])<.5&&Math.abs(a[1]-b[1])>1)push(V,Math.round(a[0]/2),{e,c:a[0],lo:Math.min(a[1],b[1]),hi:Math.max(a[1],b[1])})}}
  const pairs=new Map();
  for(const[m,horiz]of[[H,true],[V,false]])for(const[k,list]of m){const near=[...list,...(m.get(k+1)||[])];for(const s of list)for(const t of near){if(s.e===t.e||Math.abs(s.c-t.c)>1.5)continue;const A=s.e,B=t.e;if(A.id>B.id&&list.includes(t))continue;
    const shared=[A.from?.node,A.to?.node].filter(Boolean).some(id=>id===B.from?.node||id===B.to?.node);if(shared)continue;const len=Math.min(s.hi,t.hi)-Math.max(s.lo,t.lo);if(len<=16)continue;
    const pk=[A.id,B.id].sort().join('|'),mid=(Math.max(s.lo,t.lo)+Math.min(s.hi,t.hi))/2,cur=pairs.get(pk);if(!cur||cur.len<len)pairs.set(pk,{A,B,len,at:horiz?[mid,s.c]:[s.c,mid]})}}
  for(const{A,B,len,at}of pairs.values())add('warning',[A.id,B.id],`The links ${edgeName(A,byId)} and ${edgeName(B,byId)} run on top of each other for ${Math.round(len/C.PX)} mm.`,'linkoverlap',{at,fixes:[{id:'reroute',label:'Re-route both'}],fix:{edges:[A.id,B.id]}});
  // content off the page
  const ps=C.pageSize(page);for(const n of items){if(n.pin||MARKUP.has(n.type))continue;const b=C.bounds([n],true);if(b.x<-1||b.y<-1||b.x+b.w>ps.w+1||b.y+b.h>ps.h+1)add('warning',n.id,`“${n.kind==='edge'?edgeName(n,byId):nameOf(n)}” is outside the printable page.`,'offpage',{fixes:[{id:'fitpage',label:'Fit the page'},...(n.kind!=='edge'?[{id:'movein',label:'Move it onto the page'}]:[])]})}}

// ---------- fixes ----------
// Applies one fix to the document; returns what happened, or null when the fix no longer applies.
// env.markDirty(id) asks the router to re-route a connector.
function apply(doc,issue,fixId,env={}){const page=doc.pages[issue.page];if(!page)return null;const byId=new Map(page.items.map(n=>[n.id,n])),f=issue.fix||{},first=byId.get(issue.ids[0]),dirty=id=>env.markDirty?.(id);
  const lbl=(o,id)=>o?.labels?.find(l=>l.id===id)||o?.labels?.[0],drop=n=>{const i=page.items.indexOf(n);if(i>=0)page.items.splice(i,1)};
  const edgesOf=id=>page.items.filter(e=>e.kind==='edge'&&(e.from?.node===id||e.to?.node===id));
  switch(issue.rule+':'+fixId){
    case'unattached:delete':case'dangling:delete':case'selfloop:delete':if(!first)return null;drop(first);return'Deleted.';
    case'unattached:attach':if(!first||!byId.get(f.a)||!byId.get(f.b))return null;first.from={node:f.a,port:null};first.to={node:f.b,port:null};dirty(first.id);return'Both ends attached.';
    case'dangling:attach':if(!first||!byId.get(f.node))return null;first[f.end]={node:f.node,port:null};dirty(first.id);return`Attached to ${nameOf(byId.get(f.node))}.`;
    case'freelabel:attach':{const t=byId.get(f.text),o=byId.get(f.owner);if(!t||!o)return null;const l={...C.copy(t.labels[0]),id:C.uid()};
      if(o.kind==='edge'){const q=nearestOn(pathOf(o),[l.x,l.y]);l.anchor={t:q.t,dx:l.x-q.p[0],dy:l.y-q.p[1]}}
      o.labels=[...(o.labels||[]),l];drop(t);return`Attached — it now moves with ${o.kind==='edge'?'the link':nameOf(o)}.`}
    case'mismatch:useData':{const l=lbl(first,f.label);if(!l)return null;const esc=String(f.from).replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
      l.text=f.field==='vlan'?l.text.replace(new RegExp('(\\bVLAN[\\s#:-]*)0*'+esc+'\\b','i'),'$1'+f.to):l.text.replace(new RegExp(f.field==='speed'?esc:'(?<![\\d.])'+esc+'(?![\\d.]|/\\d)'),f.to);return'Label updated.'}
    case'mismatch:useLabel':case'labelonly:useLabel':{if(!first)return null;first.data??={};const cur=String(first.data[f.field]??'');
      first.data[f.field]=f.field==='ip'&&f.to&&cur.includes(f.to)?cur.replace(f.to,f.from):f.from;return'Data updated.'}
    case'labeloverlap:apart':{const o=byId.get(f.owner),l=lbl(o,f.label);if(!l)return null;if(l.anchor)l.anchor.dy=(l.anchor.dy||0)+f.dy;else l.y+=f.dy;return'Moved apart.'}
    case'hiddentext:contrast':{const l=lbl(byId.get(f.owner),f.label);if(!l)return null;l.color=f.color;return'Colour changed.'}
    case'hiddentext:front':{const o=byId.get(f.owner);if(!o)return null;drop(o);page.items.push(o);return'Brought to the front.'}
    case'tinytext:enlarge':{const l=lbl(byId.get(f.owner),f.label);if(!l)return null;l.size=7;return'Text enlarged.'}
    case'through:reroute':case'linkoverlap:reroute':{let k=0;for(const id of f.edges||[]){const e=byId.get(id);if(!e)continue;e.routing='auto';dirty(id);k++}return k?'Re-routed.':null}
    case'offpage:movein':{if(!first||first.kind==='edge')return null;const ps=C.pageSize(page),m=(page.margin||10)*C.PX,b=C.bounds([first],true);
      const dx=b.x<m?m-b.x:b.x+b.w>ps.w-m?Math.max(m-b.x,ps.w-m-(b.x+b.w)):0,dy=b.y<m?m-b.y:b.y+b.h>ps.h-m?Math.max(m-b.y,ps.h-m-(b.y+b.h)):0;
      const set=[first];if(first.kind==='zone'){const zb=C.box(first);for(const n of page.items)if(n!==first&&n.kind!=='edge'&&C.inside(C.box(n),zb,1))set.push(n)}
      for(const n of set)C.move(n,dx,dy);for(const n of set)for(const e of edgesOf(n.id))dirty(e.id);return'Moved onto the page.'}}
  return null}

return{run,apply,key,catOf,CATS,RULE_CAT,labelBox,nameOf,contrast,nearestOn,segBox};
})();
if(typeof module!=='undefined')module.exports=Checks;
