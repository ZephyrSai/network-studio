// Add a template, a saved drawing, or part of one (a page or a zone "block") to the open drawing.
// Everything is copied with fresh ids. Layers merge by name, VLANs by id, custom fields by key and embedded
// shapes by type; subnets that clash with the drawing can move to free ones, with device IPs following.
const Merge=(()=>{
const C=Core;
const nameOf=n=>String(n?.labels?.[0]?.text||'').trim();
const drawingPages=doc=>doc.pages.filter(p=>!p.isBackground);
const within=(b,z,s=1)=>b.x>=z.x-s&&b.y>=z.y-s&&b.x+b.w<=z.x+z.w+s&&b.y+b.h<=z.y+z.h+s;
const centreIn=(b,z)=>{const cx=b.x+b.w/2,cy=b.y+b.h/2;return cx>=z.x&&cx<=z.x+z.w&&cy>=z.y&&cy<=z.y+z.h};
const ptIn=(p,z)=>p[0]>=z.x&&p[0]<=z.x+z.w&&p[1]>=z.y&&p[1]<=z.y+z.h;

// A zone plus everything drawn inside it, and the links whose both ends are inside.
function blockItems(page,z){const set=new Set([z.id]);
  for(const n of page.items){if(n===z||n.kind==='edge'||n.kind==='legend'||n.pin)continue;const b=C.box(n);if(n.kind==='zone'?within(b,z):centreIn(b,z))set.add(n.id)}
  for(const e of page.items)if(e.kind==='edge'){const a=e.from?.node,b=e.to?.node;if(a||b?a&&b&&set.has(a)&&set.has(b):e.points.every(p=>ptIn(p,z)))set.add(e.id)}
  return page.items.filter(n=>set.has(n.id))}
// Top-level zones (not inside another zone) that hold at least one device.
function blocks(page){const zs=page.items.filter(n=>n.kind==='zone'&&!n.pin);
  return zs.filter(z=>!zs.some(o=>o!==z&&within(z,o,0)&&!within(o,z,0))).map(z=>{const its=blockItems(page,z);return{id:z.id,name:nameOf(z)||'Zone',devices:its.filter(n=>n.kind==='node').length,items:its.length}}).filter(b=>b.devices)}
// What a source drawing offers: its drawing pages, and the blocks on each.
function parts(doc){return drawingPages(doc).map(p=>({id:p.id,name:p.name,devices:p.items.filter(n=>n.kind==='node').length,items:p.items.filter(n=>!n.pin).length,blocks:blocks(p)}))}
function pick(doc,{page=null,block=null}={}){const p=doc.pages.find(x=>x.id===page)||drawingPages(doc)[0];if(!p)return{page:null,items:[]};
  const z=block&&p.items.find(n=>n.id===block&&n.kind==='zone');return{page:p,items:z?blockItems(p,z):p.items.filter(n=>n.pin!=='frame')}}
// Unpinned content of a page (pinned legends, frames and title blocks follow the page instead).
function contentBounds(page){const its=page.items.filter(n=>!n.pin);return its.length?C.bounds(its,true):null}
// Size of what would be inserted, for the drop footprint.
function footprint(doc,o={}){const{items}=pick(doc,o),its=items.filter(n=>!n.pin);return its.length?C.bounds(its,true):null}

// VLAN ids the copied items refer to (zone VLAN, link VLAN lists like "10,20,30-32"); null means all of them.
function vlanRefs(out){const ids=new Set();for(const n of out)for(const k of['vlan','vlans','nativeVlan','voiceVlan']){const v=n.data?.[k];if(v==null||v==='')continue;const s=String(v);if(/\ball\b/i.test(s))return null;for(const m of s.matchAll(/(\d+)\s*-\s*(\d+)|(\d+)/g)){if(m[3])ids.add(m[3]);else for(let i=+m[1];i<=Math.min(+m[2],+m[1]+4094);i++)ids.add(String(i))}}return ids}
function mergeMeta(target,src,out,o,report){
  const lmap=new Map(),has=id=>target.layers.some(l=>l.id===id),fallback=has(o.activeLayer)?o.activeLayer:target.layers[0].id;
  for(const n of out){if(o.layers==='active'||!n.layer){n.layer=fallback;continue}if(lmap.has(n.layer)){n.layer=lmap.get(n.layer);continue}
    const sl=(src.layers||[]).find(l=>l.id===n.layer);let tl=sl&&target.layers.find(l=>l.name.trim().toLowerCase()===sl.name.trim().toLowerCase());
    if(!tl&&sl){tl={...C.copy(sl),id:C.uid()};target.layers.push(tl);report.layers.push(tl.name)}
    const id=tl?.id||fallback;lmap.set(n.layer,id);n.layer=id}
  for(const k of['fields','linkFields']){target[k]??=[];for(const f of src[k]||[])if(!target[k].some(x=>x.key===f.key)){target[k].push(C.copy(f));report.fields++}}
  const vlans=[],refs=o.allVlans?null:vlanRefs(out);target.vlans??=[];for(const v of src.vlans||[])if((!refs||refs.has(String(v.id)))&&!target.vlans.some(x=>String(x.id)===String(v.id))){const c=C.copy(v);target.vlans.push(c);vlans.push(c);report.vlans.push(String(v.id))}
  const used=new Set(out.filter(n=>n.kind==='node').map(n=>n.type));for(const[t,s]of Object.entries(src.stencils||{}))if(used.has(t)&&!target.stencils?.[t]){(target.stencils??={})[t]=C.copy(s)}
  return vlans}

// Keep a moved subnet inside the private block it came from (or its /8), so 192.168.x never turns public.
function parentOf(c){for(const b of['10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','100.64.0.0/10']){const p=C.cidr(b);if(c.net>=p.net&&c.broadcast<=p.broadcast&&c.bits>=p.bits)return p}return C.cidr(C.int2ip(c.net)+'/'+Math.min(8,c.bits))}
const overlap=(a,b)=>a.net<=b.broadcast&&b.net<=a.broadcast;
function usedSubnets(target,skip){const used=[];for(const p of target.pages)for(const n of p.items)if(n.kind==='zone'&&n.data?.subnet){const c=C.cidr(n.data.subnet);if(c)used.push(c)}
  for(const v of target.vlans||[])if(!skip.includes(v)){const c=C.cidr(v.subnet);if(c)used.push(c)}return used}
function renumber(target,out,vlans,report){
  // largest subnets first: a subnet inside another one from the same template moves with it (keeps the hierarchy)
  const existing=usedSubnets(target,vlans),taken=[],done=[],moves=[],inside=(c,p)=>c.net>=p.net&&c.broadcast<=p.broadcast;
  // zone subnets plus the subnets of VLANs this insert brings along
  const subs=[...new Map([...out.filter(z=>z.kind==='zone'&&z.data?.subnet).map(z=>z.data.subnet),...vlans.map(v=>v.subnet)].map(t=>C.cidr(t)).filter(Boolean).map(c=>[c.text,c])).values()].sort((a,b)=>a.bits-b.bits||a.net-b.net);
  for(const c of subs){const parent=done.find(d=>inside(c,d.from));if(parent)continue;
    // a new home must not land on the drawing, on what this insert already placed, or on this template's other subnets (no chain reactions)
    const pending=subs.filter(p=>p!==c&&!inside(p,c)&&!done.some(d=>d.from===p)),free=x=>!existing.some(u=>overlap(u,x))&&!taken.some(u=>overlap(u,x))&&!pending.some(u=>overlap(u,x));
    if(!existing.some(u=>overlap(u,c))&&!taken.some(u=>overlap(u,c))){taken.push(c);done.push({from:c,to:c});continue}
    // next free subnet of the same size after this one, wrapping round inside the parent block
    const par=parentOf(c),slots=Math.max(1,Math.floor(par.size/c.size)),start=(c.net-par.net)/c.size;let to=null;
    for(let k=1;k<slots&&k<65536;k++){const net=par.net+((start+k)%slots)*c.size,cand=C.cidr(C.int2ip(net>>>0)+'/'+c.bits);if(free(cand)){to=cand;break}}
    if(!to){taken.push(c);done.push({from:c,to:c});continue}taken.push(to);done.push({from:c,to});moves.push({from:c,to})}
  const mapIp=ip=>{const v=C.ip2int(ip);if(v==null)return null;for(const m of moves)if(v>=m.from.net&&v<=m.from.broadcast)return C.int2ip((v-m.from.net+m.to.net)>>>0);return null};
  const fix=s=>typeof s==='string'?s.replace(/\b(\d{1,3}(?:\.\d{1,3}){3})(\/\d{1,2})?\b/g,(all,ip,bits)=>{const r=mapIp(ip);return r?r+(bits||''):all}):s;
  if(moves.length){for(const n of out){if(n.data)for(const k of Object.keys(n.data))n.data[k]=fix(n.data[k]);for(const l of n.labels||[])l.text=fix(l.text);if(n.kind==='table')n.rows=n.rows.map(r=>r.map(fix))}
    for(const v of vlans){v.subnet=fix(v.subnet);v.gateway=fix(v.gateway)}}
  report.subnets=moves.map(m=>[m.from.text,m.to.text])}
// Devices whose address is already taken get the next free host address in the same subnet (zone or VLAN), skipping gateways.
function readdress(target,out,vlans,report){const used=new Set(),subnets=[],ip=n=>C.ip2int(String(n.data?.ip??'').trim());
  for(const p of target.pages)for(const n of p.items){if(n.kind==='node'&&n.data?.ip&&!out.includes(n)){const v=ip(n);if(v!=null)used.add(v)}if(n.kind==='zone'){const c=C.cidr(n.data?.subnet);if(c)subnets.push(c);const g=C.ip2int(n.data?.gateway);if(g!=null)used.add(g)}}
  for(const v of target.vlans||[]){const c=C.cidr(v.subnet);if(c)subnets.push(c);const g=C.ip2int(v.gateway);if(g!=null&&!vlans.includes(v))used.add(g)}
  for(const z of out)if(z.kind==='zone'){const c=C.cidr(z.data?.subnet);if(c)subnets.push(c)}
  const clash=[];for(const n of out)if(n.kind==='node'&&n.data?.ip){const v=ip(n);if(v==null)continue;if(used.has(v))clash.push(n);else used.add(v)}
  for(const n of clash){const v=ip(n),c=subnets.filter(s=>v>=s.first&&v<=s.last).sort((a,b)=>b.bits-a.bits)[0];if(!c)continue;const span=c.last-c.first+1;
    for(let k=1;k<span;k++){const cand=c.first+((v-c.first+k)%span);if(!used.has(cand)){n.data.ip=C.int2ip(cand);used.add(cand);report.readdressed++;break}}}}
// Device IPs already used in the drawing (left as they are; Check diagram lists them).
function countClashes(target,out,report){const ips=new Set();for(const p of target.pages)for(const n of p.items)if(n.kind==='node'&&n.data?.ip)ips.add(String(n.data.ip).trim());
  report.ipClashes=out.filter(n=>n.kind==='node'&&n.data?.ip&&ips.has(String(n.data.ip).trim())).length}

function prefixNames(out,prefix,report){const names=new Map();
  for(const n of out)if((n.kind==='node'||n.kind==='zone')&&n.labels?.[0]){const t=n.labels[0].text;if(t&&!t.includes('{{')&&!t.startsWith(prefix)){names.set(t,prefix+t);n.labels[0].text=prefix+t;report.renamed++}}
  for(const n of out)if(n.data?.streamTo&&names.has(n.data.streamTo))n.data.streamTo=names.get(n.data.streamTo)}

// Hostnames are identities too: a name prefix becomes a hostname prefix, and clashes get -2, -3…
function uniqueHosts(target,out,o,report){const taken=new Set(),map=new Map(),slug=String(o.prefix||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  for(const p of target.pages)for(const n of p.items)if(n.kind==='node'&&n.data?.hostname&&!out.includes(n))taken.add(String(n.data.hostname).toLowerCase());
  for(const n of out){const h=n.data?.hostname;if(n.kind!=='node'||!h)continue;let v=String(h);if(slug&&!v.toLowerCase().startsWith(slug+'-'))v=slug+'-'+v;
    if(o.uniqueHosts!==false&&taken.has(v.toLowerCase())){let i=2;while(taken.has((v+'-'+i).toLowerCase()))i++;v=v+'-'+i}if(v!==h){map.set(h,v);n.data.hostname=v;report.hostnames++}taken.add(v.toLowerCase())}
  if(map.size)for(const n of out)if(n.data?.streamTo&&map.has(n.data.streamTo))n.data.streamTo=map.get(n.data.streamTo)}
function newReport(){return{layers:[],vlans:[],fields:0,subnets:[],ipClashes:0,readdressed:0,renamed:0,hostnames:0}}
function prepare(target,src,out,o,report){const vlans=mergeMeta(target,src,out,o,report);if(o.avoidClash!==false){renumber(target,out,vlans,report);readdress(target,out,vlans,report)}countClashes(target,out,report);if(o.prefix)prefixNames(out,o.prefix,report);uniqueHosts(target,out,o,report)}

// Copy a page or block of `src` onto `page` of `target`.
// o: {page, block, place:'at'|'right'|'below', at:[x,y], anchor:'topleft'|'center' (for 'at'), legend:'auto'|'yes'|'no', layers:'keep'|'active', activeLayer,
//     avoidClash, prefix, wrap:'' | zone name, group, gap, step (grid), theme zone colours [fill,stroke]}
function insert(target,page,src,o={}){
  const{items:raw}=pick(src,o);if(!raw.length)return null;
  const hasLegend=page.items.some(n=>n.kind==='legend'),keepLegend=o.legend==='yes'||o.legend!=='no'&&!hasLegend;
  const out=C.duplicate(raw.filter(n=>n.kind!=='legend'||keepLegend),0,0),report=newReport();
  prepare(target,src,out,o,report);
  for(const n of out)if(n.pin&&!(n.kind==='legend'&&!hasLegend))delete n.pin;
  const free=out.filter(n=>!n.pin);if(!free.length)return null;
  const b=C.bounds(free,true),gap=o.gap??60,step=o.step||1,snap=v=>Math.round(v/step)*step,content=contentBounds(page);let dx,dy;
  if(o.place==='at'&&o.at){const c=o.anchor==='center';dx=o.at[0]-(c?b.x+b.w/2:b.x);dy=o.at[1]-(c?b.y+b.h/2:b.y)}
  else if(!content){const m=(page.margin??10)*C.PX+20;dx=m-b.x;dy=m-b.y}
  else if(o.place==='below'){dx=content.x-b.x;dy=content.y+content.h+gap-b.y}
  else{dx=content.x+content.w+gap-b.x;dy=content.y-b.y}
  dx=snap(dx);dy=snap(dy);for(const n of free)C.move(n,dx,dy);
  if(o.wrap){const fb=C.bounds(free,true),pad=30,[f,s]=o.colors||['#f4f7fb','#9fb3cc'],z=C.zone(typeof o.wrap==='string'?o.wrap:'Zone',fb.x-pad,fb.y-pad-26,fb.w+2*pad,fb.h+2*pad+26,f,s);z.style='header';z.layer=free[0].layer;z.data={};out.unshift(z);free.unshift(z)}
  if(o.group){const g=C.uid();for(const n of free)if(n.kind!=='edge')n.group=g}
  let at=-1;page.items.forEach((n,i)=>{if(n.kind==='zone')at=i});
  page.items.splice(at+1,0,...out.filter(n=>n.kind==='zone'));page.items.push(...out.filter(n=>n.kind!=='zone'));
  return{items:out,report,bounds:C.bounds(free,true)}}

const uniqueName=(target,name)=>{const names=new Set(target.pages.map(p=>p.name));if(!names.has(name))return name;let i=2;while(names.has(`${name} (${i})`))i++;return`${name} (${i})`};
// Copy all drawing pages of `src` into `target` after page index `after`. Pages keep the drawing's background page if it has one.
function insertPages(target,src,o={}){
  const report=newReport(),bgT=target.pages.find(p=>p.isBackground),pmap=new Map(),bgs=[],pages=[];
  const clone=sp=>({...C.copy({...sp,items:[]}),id:C.uid(),items:C.duplicate(sp.items,0,0)});
  const list=o.page?src.pages.filter(p=>p.id===o.page&&!p.isBackground):drawingPages(src);
  if(!bgT)for(const id of new Set(list.map(p=>p.background).filter(Boolean))){const sp=src.pages.find(p=>p.id===id);if(!sp)continue;const np=clone(sp);np.name=uniqueName(target,np.name);pmap.set(id,np.id);bgs.push(np)}
  for(const sp of list){const np=clone(sp);np.name=uniqueName({pages:[...target.pages,...pages]},o.prefix&&!sp.name.startsWith(o.prefix)?o.prefix+sp.name:sp.name);np.background=sp.background?bgT?.id||pmap.get(sp.background)||null:null;pages.push(np)}
  if(!pages.length)return null;
  prepare(target,src,[...pages,...bgs].flatMap(p=>p.items),{...o,allVlans:!o.page},report);
  const after=Math.min(o.after??target.pages.length-1,target.pages.length-1);target.pages.splice(after+1,0,...pages);target.pages.push(...bgs);
  return{pages,backgrounds:bgs,report}}

// A one-page document holding `items` (a selection) — used to save a selection as a template.
function docFrom(doc,items,name){const d=C.newDoc(name);d.theme=doc.theme;d.layers=C.copy(doc.layers);d.fields=C.copy(doc.fields);d.linkFields=C.copy(doc.linkFields);d.vlans=C.copy(doc.vlans||[]);d.display=C.copy(doc.display);
  const p=d.pages[0];p.name=name;const its=C.duplicate(items,0,0),b=C.bounds(its,true),m=p.margin*C.PX+20;for(const n of its){delete n.pin;C.move(n,m-b.x,m-b.y)}p.items=its;if(doc.stencils)d.stencils=C.copy(doc.stencils);return d}

return{parts,blocks,blockItems,pick,footprint,contentBounds,insert,insertPages,docFrom,parentOf};
})();
if(typeof module!=='undefined')module.exports=Merge;
