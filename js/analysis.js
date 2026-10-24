// Network analysis on the drawn topology: resilience (SPOF), path trace, stream traffic & link utilisation,
// PoE budgets, CCTV storage, rack capacity, IP plan, design-rule checks and reports (inventory, cables, BOM).
const Analysis=(()=>{
const C=Core;
const nameOf=n=>{if(!n)return'';const l=n.labels?.[0];const t=l?resolveLabel(n,l,makeCtx(pageOfItem(n)||pg())):'';return(t||n.data?.hostname||Shapes.nameOf(n.type)).replace(/\n/g,' ')};
const pageOfItem=n=>S.doc.pages.find(p=>p.items.includes(n));
const tier=n=>Stencils?.shapes?.[n.type]?.tier??(Shapes.rackItems[n.type]?3:5);
const DEFAULT_POE={camera:6.5,domecamera:7,ptzcamera:25,anpr:12,thermal:12,wap:15,ipphone:5,accesscontrol:8,intercom:10,sensor:3,iotgateway:8,display:25,thinclient:12};
const RECORDER=new Set(['nvr','rk-nvr','storage','rk-storage','nas']);

function graph(page){
  const nodes=page.items.filter(n=>n.kind==='node'&&(Shapes.isDevice(n)||Shapes.kindOf(n.type)==='basic')),ids=new Set(nodes.map(n=>n.id)),adj=new Map(nodes.map(n=>[n.id,[]])),edges=[];
  for(const e of page.items)if(e.kind==='edge'&&e.from&&e.to&&ids.has(e.from.node)&&ids.has(e.to.node)&&e.from.node!==e.to.node&&!(e.linkType==='power'||e.linkType==='logical')){edges.push(e);adj.get(e.from.node).push({to:e.to.node,edge:e});adj.get(e.to.node).push({to:e.from.node,edge:e})}
  return{nodes,byId:new Map(nodes.map(n=>[n.id,n])),adj,edges}}
function zoneOf(n,page){const c=C.center(n);let best=null;for(const z of page.items)if(z.kind==='zone'&&z!==n&&C.inside({x:c[0],y:c[1],w:0,h:0},C.box(z))&&(!best||z.w*z.h<best.w*best.h))best=z;return best}
const zoneName=z=>z?(resolveLabel(z,z.labels?.[0]||{text:''})||'Zone').replace(/\n/g,' '):'';

// ---------- resilience: articulation points & bridges (Tarjan) ----------
function spof(page){
  const G=graph(page),disc=new Map(),low=new Map(),aps=new Map(),bridges=[];let time=0;const size=new Map();
  function dfs(u,parentEdge){disc.set(u,++time);low.set(u,time);let children=0;size.set(u,1);
    for(const{to:v,edge}of G.adj.get(u)){if(edge===parentEdge)continue;if(!disc.has(v)){children++;dfs(v,edge);size.set(u,size.get(u)+size.get(v));low.set(u,Math.min(low.get(u),low.get(v)));if(low.get(v)>disc.get(u))bridges.push({edge,below:size.get(v)});if(parentEdge!==null&&low.get(v)>=disc.get(u))aps.set(u,(aps.get(u)||0)+size.get(v))}else low.set(u,Math.min(low.get(u),disc.get(v)))}
    if(parentEdge===null&&children>1)aps.set(u,size.get(u)-1)}
  for(const n of G.nodes)if(!disc.has(n.id))dfs(n.id,null);
  const nodes=[...aps].filter(([id])=>tier(G.byId.get(id))<=4).map(([id,cut])=>({id,cut}));
  const crit=bridges.filter(b=>{const a=G.byId.get(b.edge.from.node),c=G.byId.get(b.edge.to.node);return Math.min(G.adj.get(a.id).length,G.adj.get(c.id).length)>1&&tier(a)<=4&&tier(c)<=4});
  return{nodes,bridges:crit,graph:G}}

// ---------- path trace ----------
function path(page,a,b){const G=graph(page),prev=new Map([[a,null]]),q=[a];while(q.length){const u=q.shift();if(u===b)break;for(const{to,edge}of G.adj.get(u)||[])if(!prev.has(to)){prev.set(to,{u,edge});q.push(to)}}if(!prev.has(b))return null;const nodes=[b],edges=[];let cur=b;while(prev.get(cur)){const{u,edge}=prev.get(cur);edges.push(edge.id);nodes.push(u);cur=u}return{nodes:nodes.reverse(),edges:edges.reverse()}}
function allPaths(G,a,b,limit=3){const res=[];const visit=(u,seenN,seenE,pathE)=>{if(res.length>=limit*4)return;if(u===b){res.push([...pathE]);return}for(const{to,edge}of G.adj.get(u)||[]){if(seenN.has(to)||seenE.has(edge.id))continue;if(pathE.length>12)continue;seenN.add(to);seenE.add(edge.id);pathE.push(edge.id);visit(to,seenN,seenE,pathE);pathE.pop();seenN.delete(to);seenE.delete(edge.id)}};visit(a,new Set([a]),new Set(),[]);return res.sort((x,y)=>x.length-y.length).slice(0,limit)}

// ---------- traffic: camera / stream flows to recorders ----------
function capacity(e){return Shapes.speedMbps(e.data?.speed)||Shapes.speedMbps(Shapes.linkTypes[e.linkType]?.speed)||null}
function traffic(page){
  const G=graph(page),loads=new Map(),flows=[],recorders=G.nodes.filter(n=>RECORDER.has(n.type)||/vms|nvr|record/i.test(n.data?.role||''));
  const findDest=src=>{const want=src.data?.streamTo;if(want){const t=G.nodes.find(n=>[n.data?.hostname,nameOf(n)].some(v=>v&&v.toLowerCase()===String(want).toLowerCase()));if(t)return t}
    const prev=new Map([[src.id,null]]),q=[src.id];while(q.length){const u=q.shift();const un=G.byId.get(u);if(u!==src.id&&recorders.includes(un))return un;for(const{to,edge}of G.adj.get(u))if(!prev.has(to)){prev.set(to,edge);q.push(to)}}return null};
  for(const src of G.nodes){const mbps=+src.data?.bitrate||(C.CAMERAS.includes(src.type)?+(S.doc.display?.defaultBitrate||4):0);if(!mbps)continue;const dst=findDest(src);if(!dst)continue;const p=path(page,src.id,dst.id);if(!p)continue;flows.push({src,dst,mbps,edges:p.edges});for(const id of p.edges)loads.set(id,(loads.get(id)||0)+mbps)}
  const out=new Map();for(const[id,mbps]of loads){const e=G.edges.find(x=>x.id===id),cap=capacity(e),pct=cap?mbps/cap*100:null;out.set(id,{mbps,cap,pct,color:pct==null?'#2563eb':pct>=80?'#dc2626':pct>=50?'#d97706':'#16a34a',text:(mbps>=1000?(mbps/1000).toFixed(2)+' Gb/s':Math.round(mbps)+' Mb/s')+(pct!=null?` · ${Math.round(pct)}%`:'')})}
  const perRec=new Map();for(const f of flows){const r=perRec.get(f.dst.id)||{rec:f.dst,cams:0,mbps:0};r.cams++;r.mbps+=f.mbps;perRec.set(f.dst.id,r)}
  return{loads:out,flows,recorders:[...perRec.values()]}}
function storageTB(mbps,days){return mbps*86400*days/8/1e6}

// ---------- PoE budget ----------
function poe(page){const G=graph(page),rows=[];for(const sw of G.nodes){if(!C.SWITCHES.includes(sw.type)&&!(+sw.data?.poeBudget))continue;let draw=0,count=0;const loads=[];for(const{to}of G.adj.get(sw.id)){const n=G.byId.get(to);if(!(C.POE_LOADS.includes(n.type)||+n.data?.poeDraw))continue;if(tier(n)<tier(sw))continue;const w=+n.data?.poeDraw||DEFAULT_POE[n.type]||0;draw+=w;count++;loads.push(n)}if(!count&&!(+sw.data?.poeBudget))continue;const budget=+sw.data?.poeBudget||null;rows.push({sw,count,draw,budget,pct:budget?draw/budget*100:null,loads})}return rows}

// ---------- racks ----------
function racks(page){return page.items.filter(n=>n.type==='rack').map(r=>{const inner=Shapes.rackInner(r),eq=page.items.filter(n=>n.kind==='node'&&Shapes.rackItems[n.type]&&C.inside(C.box(n),{x:inner.x-1,y:inner.y-1,w:inner.w+2,h:inner.h+2})),used=eq.reduce((s,n)=>s+Math.round(n.h/Shapes.RU),0),power=eq.reduce((s,n)=>s+(+n.data?.power||0),0);
  const overlaps=[];for(let i=0;i<eq.length;i++)for(let j=i+1;j<eq.length;j++){const a=C.box(eq[i]),b=C.box(eq[j]);if(a.y<b.y+b.h-1&&a.y+a.h>b.y+1)overlaps.push([eq[i],eq[j]])}
  return{rack:r,units:r.units||42,used,free:(r.units||42)-used,power,eq:eq.sort((a,b)=>Shapes.rackU(r,b)-Shapes.rackU(r,a)),overlaps}})}

// ---------- IP plan ----------
function ipPlan(doc){const rows=[];for(const p of doc.pages)for(const z of p.items.filter(n=>n.kind==='zone'&&C.cidr(n.data?.subnet))){const c=C.cidr(z.data.subnet),devices=p.items.filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&zoneOf(n,p)===z),used=new Set();for(const n of devices)for(const ip of C.ipsIn(n.data?.ip).concat(C.ipsIn(n.data?.mgmtIp))){const v=C.ip2int(ip);if(C.inCidr(v,c))used.add(v)}const gw=C.ip2int(z.data.gateway);if(gw!=null)used.add(gw);let next=null;for(let v=c.first;v<=c.last&&v<c.first+65536;v++)if(!used.has(v)){next=C.int2ip(v);break}rows.push({page:p,zone:z,cidr:c,devices,used:used.size,next,vlan:z.data.vlan||''})}return rows}
function nextFreeIp(n,page){const z=zoneOf(n,page),c=z&&C.cidr(z.data?.subnet);if(!c)return null;const plan=ipPlan(S.doc).find(r=>r.zone===z);return plan?.next||null}

// ---------- design-rule check ----------
function check(doc){
  const issues=[],add=(severity,page,ids,message,rule)=>issues.push({severity,page:doc.pages.indexOf(page),ids:[].concat(ids).filter(Boolean),message,rule});
  const hostnames=new Map(),ips=new Map(),seenSubnets=[];
  for(const page of doc.pages){if(page.isBackground)continue;const byId=new Map(page.items.map(n=>[n.id,n])),ps=C.pageSize(page),G=graph(page);
    for(const n of page.items){
      if(n.kind==='edge'){for(const k of['from','to']){if(!n[k])add('warning',page,n.id,`Connector end is not attached (${k==='from'?'start':'end'}).`,'loose');else if(!Conn.resolveEnd(n,k,byId))add('error',page,n.id,'Connector is attached to a device or port that no longer exists.','broken')}if(n.from&&n.to&&n.from.node===n.to.node)add('warning',page,n.id,'Connector loops back to the same device.','loop')}
      const b=C.bounds([n],true);if(b.x<0||b.y<0||b.x+b.w>ps.w||b.y+b.h>ps.h)add('warning',page,n.id,`“${nameOf(n)||n.kind}” is outside the printable page.`,'offpage');
      if(n.kind!=='node'||!Shapes.isDevice(n))continue;
      const nm=nameOf(n),h=(n.data?.hostname||'').trim();
      if(h){const k=h.toLowerCase();if(hostnames.has(k))add('error',page,[n.id,hostnames.get(k).id],`Duplicate hostname “${h}”.`,'duphost');else hostnames.set(k,n);if(/\s/.test(h))add('info',page,n.id,`Hostname “${h}” contains spaces.`,'hostfmt')}
      for(const field of['ip','mgmtIp']){const raw=n.data?.[field];if(!raw)continue;const found=C.ipsIn(raw);if(!found.length)add('error',page,n.id,`“${nm}”: “${raw}” is not a valid IPv4 address.`,'ipfmt');for(const ip of found){if(ips.has(ip))add('error',page,[n.id,ips.get(ip).id],`Duplicate IP address ${ip} (${nm} and ${nameOf(ips.get(ip))}).`,'dupip');else ips.set(ip,n);
        const z=zoneOf(n,page),c=z&&C.cidr(z.data?.subnet);if(c&&field==='ip'){const v=C.ip2int(ip);if(!C.inCidr(v,c))add('warning',page,n.id,`${nm}: ${ip} is outside zone “${zoneName(z)}” subnet ${c.text}.`,'subnet');else if(c.bits<31&&(v===c.net||v===c.broadcast))add('error',page,n.id,`${nm}: ${ip} is the ${v===c.net?'network':'broadcast'} address of ${c.text}.`,'netaddr');const gw=C.ip2int(z.data?.gateway);if(gw!=null&&gw===v&&!['router','firewall','l3switch','rk-router','rk-firewall'].includes(n.type))add('warning',page,n.id,`${nm} uses the zone gateway address ${ip}.`,'gw')}}}
      if(!G.adj.get(n.id)?.length&&!Shapes.rackItems[n.type])add('info',page,n.id,`“${nm}” has no connections.`,'isolated');
    }
    // overlapping devices
    const devs=page.items.filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Shapes.rackItems[n.type]);for(let i=0;i<devs.length;i++)for(let j=i+1;j<devs.length;j++){const a=C.box(devs[i]),c=C.box(devs[j]);const ox=Math.min(a.x+a.w,c.x+c.w)-Math.max(a.x,c.x),oy=Math.min(a.y+a.h,c.y+c.h)-Math.max(a.y,c.y);if(ox>a.w*.3&&oy>a.h*.3)add('warning',page,[devs[i].id,devs[j].id],`“${nameOf(devs[i])}” overlaps “${nameOf(devs[j])}”.`,'overlap')}
    // zones: subnet sanity
    for(const z of page.items.filter(n=>n.kind==='zone')){const s=z.data?.subnet;if(!s)continue;const c=C.cidr(s);if(!c){add('error',page,z.id,`Zone “${zoneName(z)}”: “${s}” is not a valid CIDR subnet.`,'cidr');continue}if(c.ip!==c.net)add('info',page,z.id,`Zone “${zoneName(z)}”: ${s} is not the network address (did you mean ${c.text}?).`,'cidrnet');const gw=C.ip2int(z.data?.gateway);if(z.data?.gateway&&(gw==null||!C.inCidr(gw,c)))add('error',page,z.id,`Zone “${zoneName(z)}”: gateway ${z.data.gateway} is not inside ${c.text}.`,'gwout');for(const o of seenSubnets)if(o.z!==z&&((c.net&o.c.mask)>>>0)===o.c.net||((o.c.net&c.mask)>>>0)===c.net&&o.z!==z)add('warning',page,[z.id,o.z.id],`Subnets overlap: ${c.text} (${zoneName(z)}) and ${o.c.text} (${zoneName(o.z)}).`,'overlapnet');seenSubnets.push({z,c})}
    for(const r of poe(page))if(r.budget&&r.draw>r.budget)add('error',page,r.sw.id,`PoE budget exceeded on ${nameOf(r.sw)}: ${r.draw.toFixed(1)} W of ${r.budget} W (${r.count} powered devices).`,'poe');else if(r.budget&&r.pct>85)add('warning',page,r.sw.id,`${nameOf(r.sw)} PoE budget at ${Math.round(r.pct)}% (${r.draw.toFixed(1)} / ${r.budget} W).`,'poe');
    for(const r of racks(page)){for(const[a,c]of r.overlaps)add('error',page,[a.id,c.id],`Rack “${nameOf(r.rack)}”: ${nameOf(a)} and ${nameOf(c)} occupy the same U.`,'rack');if(r.used>r.units)add('error',page,r.rack.id,`Rack “${nameOf(r.rack)}” is over capacity (${r.used}/${r.units} U).`,'rack')}
    if(page.items.some(n=>C.CAMERAS.includes(n.type))){const t=traffic(page);for(const[id,L]of t.loads)if(L.pct!=null&&L.pct>=80)add('warning',page,id,`Link carries ${L.text} of camera streams (${L.cap>=1000?L.cap/1000+'G':L.cap+'M'} link).`,'util')}
    const sp=spof(page);for(const a of sp.nodes)add('info',page,a.id,`Single point of failure: losing “${nameOf(sp.graph.byId.get(a.id))}” isolates ${a.cut} device(s).`,'spof');for(const b of sp.bridges)add('info',page,b.edge.id,`Non-redundant link between ${nameOf(sp.graph.byId.get(b.edge.from.node))} and ${nameOf(sp.graph.byId.get(b.edge.to.node))}.`,'bridge');
  }
  const vids=new Map();for(const v of doc.vlans||[]){if(vids.has(String(v.id)))issues.push({severity:'error',page:-1,ids:[],message:`VLAN ${v.id} is defined twice (${vids.get(String(v.id))} / ${v.name}).`,rule:'vlan'});vids.set(String(v.id),v.name);if(!(+v.id>=1&&+v.id<=4094))issues.push({severity:'error',page:-1,ids:[],message:`VLAN ID ${v.id} is outside 1–4094.`,rule:'vlan'})}
  const order={error:0,warning:1,info:2};return issues.sort((a,b)=>order[a.severity]-order[b.severity])}

// ---------- reports ----------
function allDevices(doc,{currentOnly=false}={}){const out=[];for(const p of currentOnly?[pg()]:doc.pages)for(const n of p.items)if(n.kind==='node'&&Shapes.isDevice(n))out.push({p,n});return out}
function inventory(doc,opt){const fields=doc.fields,cols=['Page','Name','Type','Zone',...fields.filter(f=>f.key!=='notes').map(f=>f.label),'Rack / U','Links'];
  const rows=allDevices(doc,opt).map(({p,n})=>{const G=graph(p),r=rackOf(n,p);return[p.name,nameOf(n),Shapes.nameOf(n.type),zoneName(zoneOf(n,p)),...fields.filter(f=>f.key!=='notes').map(f=>n.data?.[f.key]??''),r?nameOf(r)+' / U'+Shapes.rackU(r,n):'',G.adj.get(n.id)?.length||0]});return{title:'Device inventory',columns:cols,rows}}
function cables(doc,opt){const cols=['Cable ID','Page','From device','From port','To device','To port','Link type','Speed','Media','VLANs','Label'],rows=[];let k=1;
  for(const p of opt?.currentOnly?[pg()]:doc.pages){const byId=new Map(p.items.map(n=>[n.id,n]));for(const e of p.items){if(e.kind!=='edge')continue;const end=key=>{const r=e[key],n=r&&byId.get(r.node);if(!n)return['(unconnected)',''];const port=r.port&&n.ports?.find(q=>q.id===r.port);return[nameOf(n),(key==='from'?e.fromIf:e.toIf)||(port&&!/^(top|right|bottom|left|edge \d+)$/i.test(port.name)?port.name:'')]};const[a,ap]=end('from'),[b,bp]=end('to');rows.push([e.data?.cableId||'C-'+String(k).padStart(3,'0'),p.name,a,ap,b,bp,Shapes.linkTypes[e.linkType]?.name||'Custom',e.data?.speed||'',e.data?.media||'',e.data?.vlans||'',(e.labels||[]).map(l=>resolveLabel(e,l)).join(' ')]);k++}}return{title:'Cable schedule',columns:cols,rows}}
function bom(doc,opt){const map=new Map();for(const{n}of allDevices(doc,opt)){const key=[Shapes.nameOf(n.type),n.data?.vendor||'',n.data?.model||''].join('|');const r=map.get(key)||{type:Shapes.nameOf(n.type),vendor:n.data?.vendor||'',model:n.data?.model||'',qty:0,price:+n.data?.unitPrice||0};r.qty++;if(+n.data?.unitPrice)r.price=+n.data.unitPrice;map.set(key,r)}
  const rows=[...map.values()].sort((a,b)=>a.type.localeCompare(b.type)).map(r=>[r.type,r.vendor,r.model,r.qty,r.price?r.price.toFixed(2):'',r.price?(r.price*r.qty).toFixed(2):'']);const total=[...map.values()].reduce((s,r)=>s+r.price*r.qty,0);if(total)rows.push(['Total','','',[...map.values()].reduce((s,r)=>s+r.qty,0),'',total.toFixed(2)]);return{title:'Bill of materials',columns:['Item','Vendor','Model','Qty','Unit price','Extended'],rows}}
function ipReport(doc){const rows=ipPlan(doc).map(r=>[r.page.name,zoneName(r.zone),r.vlan,r.cidr.text,r.cidr.maskText,r.zone.data.gateway||'',r.cidr.hosts,r.used,(r.used/Math.max(1,r.cidr.hosts)*100).toFixed(1)+'%',r.next||'(full)']);for(const v of doc.vlans||[])if(!rows.some(r=>String(r[2])===String(v.id)))rows.push(['','(VLAN registry) '+(v.name||''),v.id,v.subnet||'','','',v.subnet&&C.cidr(v.subnet)?C.cidr(v.subnet).hosts:'','','','']);return{title:'IP address plan',columns:['Page','Zone','VLAN','Subnet','Mask','Gateway','Usable','Used','Utilisation','Next free'],rows}}
function rackReport(doc){const rows=[];for(const p of doc.pages)for(const r of racks(p)){rows.push([p.name,nameOf(r.rack),'','',`${r.used}/${r.units} U used`,r.power?r.power+' W':'']);for(const n of r.eq)rows.push([p.name,nameOf(r.rack),'U'+Shapes.rackU(r.rack,n)+(n.h>Shapes.RU*1.5?'–'+(Shapes.rackU(r.rack,n)+Math.round(n.h/Shapes.RU)-1):''),nameOf(n),Shapes.nameOf(n.type)+' · '+Math.round(n.h/Shapes.RU)+'U',n.data?.power?n.data.power+' W':''])}return{title:'Rack elevations',columns:['Page','Rack','U','Equipment','Type','Power'],rows}}
function poeReport(doc){const rows=[];for(const p of doc.pages)for(const r of poe(p))rows.push([p.name,nameOf(r.sw),r.count,r.draw.toFixed(1)+' W',r.budget?r.budget+' W':'(not set)',r.pct!=null?Math.round(r.pct)+'%':'',r.budget&&r.draw>r.budget?'OVER BUDGET':'OK']);return{title:'PoE budget',columns:['Page','Switch','Powered devices','Estimated draw','Budget','Utilisation','Status'],rows}}
function cctvReport(doc){const rows=[];for(const p of doc.pages){const t=traffic(p);for(const r of t.recorders){const days=+r.rec.data?.retention||30,need=storageTB(r.mbps,days),have=+r.rec.data?.storageTB||null;rows.push([p.name,nameOf(r.rec),r.cams,r.mbps.toFixed(1)+' Mb/s',days,need.toFixed(1)+' TB',have?have+' TB':'(not set)',have?(have>=need?'OK':'SHORT by '+(need-have).toFixed(1)+' TB'):''])}}return{title:'CCTV recording & storage',columns:['Page','Recorder','Cameras','Ingest','Retention (days)','Storage required','Storage available','Status'],rows}}
function vlanReport(doc){return{title:'VLAN registry',columns:['VLAN','Name','Subnet','Gateway','Zones','Devices'],rows:(doc.vlans||[]).map(v=>{const zones=doc.pages.flatMap(p=>p.items.filter(z=>z.kind==='zone'&&String(z.data?.vlan)===String(v.id)).map(zoneName));const devs=doc.pages.flatMap(p=>p.items).filter(n=>n.kind==='node'&&String(n.data?.vlan||'').split(/[,\s]+/).includes(String(v.id))).length;return[v.id,v.name||'',v.subnet||'',v.gateway||'',zones.join(', '),devs]})}}
function toCSV(r){const q=v=>{const s=String(v??'');return/[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};return[r.columns,...r.rows].map(row=>row.map(q).join(',')).join('\r\n')}
function toTSV(r){return[r.columns,...r.rows].map(row=>row.map(v=>String(v??'').replace(/[\t\n]/g,' ')).join('\t')).join('\n')}

return{graph,zoneOf,zoneName,nameOf,spof,path,allPaths,traffic,capacity,storageTB,poe,racks,ipPlan,nextFreeIp,check,inventory,cables,bom,ipReport,rackReport,poeReport,cctvReport,vlanReport,toCSV,toTSV,DEFAULT_POE};
})();
