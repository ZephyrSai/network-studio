// Rack engine: which equipment sits in which rack and U, free space, placing / resizing / moving by U (never on top of
// something else), U locks, rack units linked to drawing devices, and power / heat / depth checks.
const Racks=(()=>{
const C=Core;
const RU=()=>Shapes.RU,inner=r=>Shapes.rackInner(r);
const isRack=n=>n?.type==='rack',isItem=n=>n?.kind==='node'&&!!Shapes.rackItems[n.type];
// 'u' sits in U slots; 'side' is a vertical 0U PDU in a side channel; 'roof' is the fan tray on the cabinet roof
const mountOf=n=>Shapes.rackItems[typeof n==='string'?n:n?.type]?.mount||'u';
const isU=n=>isItem(n)&&mountOf(n)==='u',isZeroU=n=>isItem(n)&&mountOf(n)!=='u';
const heightU=n=>Math.max(1,Math.round(n.h/RU()));
const units=r=>r.units||42;
const within=(c,b)=>c[0]>=b.x-1&&c[0]<=b.x+b.w+1&&c[1]>=b.y-1&&c[1]<=b.y+b.h+1;
// the front cabinet only (r.w also covers the rear and plan views)
const frontRect=r=>{const f=Shapes.rackFrame(r);return{x:r.x,y:r.y,w:f.w,h:f.h}};
function contents(r,items){const i=inner(r);return items.filter(n=>isU(n)&&C.inside(C.box(n),{x:i.x-1,y:i.y-1,w:i.w+2,h:i.h+2}))}
// 0U PDUs and the roof fan tray standing on a rack's front cabinet (mounted or not — see where())
function extras(r,items){const b=frontRect(r);return items.filter(n=>isZeroU(n)&&within(C.center(n),b))}
function rackOf(n,items){const c=C.center(n),z=isZeroU(n);return items.find(r=>isRack(r)&&within(c,z?frontRect(r):inner(r)))||null}
const channel=(r,side)=>{const f=Shapes.rackFrame(r),i=inner(r);return{x:side==='left'?r.x:r.x+f.w-f.side,y:i.y,w:f.side,h:i.h}};
// How an item is mounted in r: {mount:'u'|'left'|'right'|'roof'|'loose', u, h}
function where(r,n){const m=mountOf(n);if(m==='u')return{mount:'u',u:uOf(r,n),h:heightU(n)};
  if(m==='side'){if(r.sides)for(const side of['left','right'])if(C.inside(C.box(n),channel(r,side),1))return{mount:side,u:uOf(r,n),h:heightU(n)};return{mount:'loose'}}
  return r.roof&&C.center(n)[1]<r.y+Shapes.rackFrame(r).roof?{mount:'roof'}:{mount:'loose'}}
const fansOf=n=>Math.max(1,Math.min(6,Math.round(+n.data?.fans||4)));
const span=(u,h)=>`U${u}${h>1?'–'+(u+h-1):''}`;
function position(r,n){const w=where(r,n);return w.mount==='u'?span(w.u,w.h):w.mount==='left'||w.mount==='right'?`0U ${w.mount} · ${span(w.u,w.h)}`:w.mount==='roof'?`Roof · ${fansOf(n)} fan${fansOf(n)>1?'s':''}`:'not mounted'}
const uOf=(r,n)=>Shapes.rackU(r,n);// lowest U the item occupies (1 = bottom)
function occupied(r,items,except){const set=new Map();for(const n of contents(r,items)){if(except?.has(n.id))continue;const u=uOf(r,n);for(let k=0;k<heightU(n);k++)set.set(u+k,n)}return set}
function fits(r,items,u,h,except){if(u<1||u+h-1>units(r))return false;const occ=occupied(r,items,except);for(let k=0;k<h;k++)if(occ.has(u+k))return false;return true}
// A free run of h U: from the top (default), the bottom, or nearest to a U.
function findSlot(r,items,h,{order='top',near=null,except}={}){const c=[];for(let u=1;u+h-1<=units(r);u++)if(fits(r,items,u,h,except))c.push(u);if(!c.length)return null;if(near!=null)return c.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near)||b-a)[0];return order==='top'?c.at(-1):c[0]}
function freeU(r,items){return units(r)-[...occupied(r,items).keys()].length}
// ---------- 0U side channels and the roof ----------
function sideOccupied(r,items,side,except){const m=new Map();for(const n of extras(r,items)){if(except?.has(n.id))continue;const w=where(r,n);if(w.mount===side)for(let k=0;k<w.h;k++)m.set(w.u+k,n)}return m}
function sideFits(r,items,side,u,len,except){if(u<1||u+len-1>units(r))return false;const occ=sideOccupied(r,items,side,except);for(let k=0;k<len;k++)if(occ.has(u+k))return false;return true}
// A free run for a PDU of len U: on the preferred side, then the other; shorten: else the longest free run (≥ 4U).
function findSide(r,items,len,{prefer='left',near=null,except,shorten=false}={}){const sides=[prefer,prefer==='left'?'right':'left'];len=Math.min(len,units(r));
  for(const side of sides){const c=[];for(let u=1;u+len-1<=units(r);u++)if(sideFits(r,items,side,u,len,except))c.push(u);if(c.length)return{side,u:near!=null?c.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near)||a-b)[0]:c[0],len}}
  if(shorten)for(const side of sides){const occ=sideOccupied(r,items,side,except);let best=null,start=null;for(let u=1;u<=units(r)+1;u++){const free=u<=units(r)&&!occ.has(u);if(free&&start==null)start=u;if(!free&&start!=null){if(u-start>=4&&(!best||u-start>best.len))best={side,u:start,len:u-start};start=null}}if(best)return best}
  return null}
function placeSide(r,n,side,u,len){const ch=channel(r,side),i=inner(r);n.w=Shapes.rackItems[n.type]?.w||20;n.h=len*RU();C.move(n,ch.x+4-n.x,i.y+i.h-(u-1)*RU()-n.h-n.y);
  const l=n.labels?.[0];if(l&&!l.anchor){l.rotation=-90;l.align='middle';l.size=l.size||8.5;l.x=n.x+8+l.size*.36;l.y=n.y+n.h/2}if(len>=units(r))n.fullHeight=true;else delete n.fullHeight}
// Where a side PDU of a new length goes: its lowest U if there is room, else its top U, else the nearest free run on
// that side (null if none).
function sideLength(r,items,n,len){const w=where(r,n);if(w.mount!=='left'&&w.mount!=='right')return null;const H=units(r),ex=new Set([n.id]);len=Math.max(1,Math.min(H,Math.round(+len)||0));
  const u=[Math.min(w.u,H-len+1),w.u+w.h-len].find(u=>u>=1&&sideFits(r,items,w.mount,u,len,ex));if(u!=null)return{side:w.mount,u,len};
  const c=[];for(let k=1;k+len-1<=H;k++)if(sideFits(r,items,w.mount,k,len,ex))c.push(k);c.sort((a,b)=>Math.abs(a-w.u)-Math.abs(b-w.u)||a-b);return c.length?{side:w.mount,u:c[0],len}:null}
const roofItem=(r,items)=>extras(r,items).find(n=>where(r,n).mount==='roof')||null;
function placeRoof(r,n){const i=inner(r),t=Shapes.rackItems[n.type];n.w=t?.w||170;n.h=t?.h||16;C.move(n,i.x+10-n.x,r.y+3-n.y);const l=n.labels?.[0];if(l&&!l.anchor){l.rotation=0;l.align='start';l.size=l.size||8.5;l.x=n.x+6;l.y=n.y+n.h/2+l.size*.36}}
function resize(r){const D=Shapes.rackDims(r);r.w=D.w;r.h=D.h}
// Rear labels sit where the unit is drawn in the rear view; keep them there when the cabinet changes shape.
const rearSpots=(r,items)=>contents(r,items).flatMap(n=>(n.labels||[]).filter(l=>l.view==='rear').map(l=>({n,l,dx:l.x-(r.x+Shapes.rearX(r,n))})));
const reRear=(r,spots)=>{for(const s of spots)s.l.x=r.x+Shapes.rearX(r,s.n)+s.dx};
// Turn the 0U side channels / roof band on or off. Side channels widen the cabinet outwards so units, ports and
// links stay put — unless something stands in the way on the left, then everything in the rack shifts right
// instead. The roof grows upwards so the floor line stays. Off is refused while something is mounted there.
// → {ok, reason, blockers, moved:[ids], dx, band}; the caller makes room for the growth and re-routes links.
// What stands in the way of the cabinet growing into band — not its own equipment, links, pinned blocks, the item
// being mounted (ignore), zones (they grow around their members) or a shape the rack stands on.
function inWay(r,items,band,ignore){const own=new Set([r.id,...contents(r,items).map(n=>n.id),...extras(r,items).map(n=>n.id),...(ignore||[])]),f=frontRect(r),mid=[f.x+f.w/2,f.y+f.h/2];
  return items.filter(n=>{if(own.has(n.id)||n.kind==='edge'||n.kind==='zone'||n.pin)return false;const b=C.bounds([n]);return!within(mid,b)&&C.overlaps(b,band)})}
function setFrame(r,items,want={},{margin=0,ignore}={}){const out={ok:true,moved:[],dx:0,band:null},own=new Set([r.id,...contents(r,items).map(n=>n.id),...extras(r,items).map(n=>n.id)]);
  if(want.sides!=null&&!!want.sides!==!!r.sides){const spots=rearSpots(r,items),S0=Shapes.RACK.side;
    if(want.sides){const f=Shapes.rackFrame(r),band={x:r.x-S0,y:r.y,w:S0,h:f.h},blocked=r.x-S0<margin||inWay(r,items,band,ignore).length>0;
      if(blocked){const mv=items.filter(n=>own.has(n.id)&&n.id!==r.id);for(const n of mv)C.move(n,S0,0);for(const l of r.labels||[])l.x+=S0;out.moved=mv.map(n=>n.id);out.dx=S0}else r.x-=S0;r.sides=true}
    else{const on=extras(r,items).filter(n=>{const m=where(r,n).mount;return m==='left'||m==='right'});if(on.length)return{...out,ok:false,reason:'side',blockers:on};r.x+=S0;delete r.sides}
    resize(r);reRear(r,spots)}
  if(want.roof!=null&&!!want.roof!==!!r.roof){const R0=Shapes.RACK.roof;
    if(want.roof){r.y-=R0;for(const l of r.labels||[])if(l.y<=r.y+R0+2)l.y-=R0;r.roof=true;resize(r);out.band={x:r.x,y:r.y,w:r.w,h:R0}}
    else{const t=roofItem(r,items);if(t)return{...out,ok:false,reason:'roof',blockers:[t]};delete r.roof;r.y+=R0;for(const l of r.labels||[])if(l.y<=r.y+2)l.y+=R0;resize(r)}}
  return out}
// New rack height with the floor where it is (U numbers count from the bottom); full-height PDUs follow.
function setUnits(r,u,items){u=Math.round(+u);if(!(u>=1))return{ok:false,blocker:'Enter a height in U.'};if(u<units(r)){const all=[...contents(r,items),...extras(r,items)];
    for(const n of all){const w=where(r,n);if(w.u!=null&&w.u+w.h-1>u&&!(n.fullHeight&&w.u===1))return{ok:false,blocker:`${n.labels?.[0]?.text||Shapes.nameOf(n.type)} ${mountOf(n)==='side'?'reaches':'is at'} U${w.u+w.h-1} — ${mountOf(n)==='side'?'shorten it':'move it down'} first.`}}}
  const side=extras(r,items).filter(n=>n.fullHeight&&(where(r,n).mount==='left'||where(r,n).mount==='right')).map(n=>[n,where(r,n).mount]),roof=roofItem(r,items),f0=Shapes.rackFrame(r).h;
  r.units=u;const dy=f0-Shapes.rackFrame(r).h;r.y+=dy;for(const l of r.labels||[])l.y+=dy;if(roof)C.move(roof,0,dy);resize(r);for(const[n,sd]of side)placeSide(r,n,sd,1,u);return{ok:true}}
// Put n so its lowest U is u.
function placeAt(r,n,u){const i=inner(r),h=heightU(n)*RU();n.h=h;n.w=i.w;C.move(n,i.x-n.x,i.y+i.h-(u-1)*RU()-h-n.y);const l=n.labels?.find(x=>x.view!=='rear');if(l&&!l.anchor){l.align='start';l.x=n.x+12;l.size=heightU(n)>1?10:8.5;l.y=n.y+n.h/2+l.size*.36;for(const b of n.labels)if(b.view==='rear'){b.size=l.size;b.y=l.y}}}
// Rear view labels: a unit in a rack that shows its rear view carries a second, real label there — movable and
// editable like the front one. It repeats the front text until it is edited, and goes when the view does.
function syncRear(items){let changed=false;for(const n of items){if(!isItem(n))continue;if(isZeroU(n)){const k=(n.labels||[]).findIndex(l=>l.view==='rear');if(k>=0){n.labels.splice(k,1);changed=true}continue}const r=rackOf(n,items),on=!!r?.views?.rear,i=(n.labels||[]).findIndex(l=>l.view==='rear');
  if(!on){if(i>=0){n.labels.splice(i,1);changed=true}continue}const front=n.labels?.find(l=>l.view!=='rear');if(!front)continue;
  if(i<0){n.labels.push({...C.copy(front),id:C.uid(),view:'rear',src:front.text,anchor:undefined,align:'start',x:n.x+Shapes.rackDims(r).rear+12,y:front.y});changed=true}
  else{const l=n.labels[i];if(l.src===l.text&&front.text!==l.text){l.text=l.src=front.text;changed=true}}}return changed}
// New height, keeping the top U where it was if there is room, else the bottom U, else the nearest free run.
function setHeight(r,n,hU,items){const cur=uOf(r,n),top=cur+heightU(n)-1,exc=new Set([n.id]);let u=[top-hU+1,cur].find(x=>fits(r,items,x,hU,exc));if(u==null)u=findSlot(r,items,hU,{near:cur,except:exc});if(u==null)return null;n.h=hU*RU();placeAt(r,n,u);return u}
function moveTo(r,n,u,items){if(!fits(r,items,u,heightU(n),new Set([n.id])))return false;placeAt(r,n,u);return true}
const isLocked=(n,r)=>!!(n.uLock||r?.lockItems);

// Which rack unit stands for a drawing device: [type pattern, rack item, U].
const MAP=[[/firewall|utm|ngfw|waf/,'rk-firewall',1],[/router|sdwan|wan|vpn/,'rk-router',2],[/l3switch|coreswitch|core|switch|hub/,'rk-switch',1],
  [/nvr|vms|recorder/,'rk-nvr',2],[/san|storage|nas|backup|tape/,'rk-storage',2],[/hypervisor|esx|blade/,'rk-server2',2],[/server|dns|dhcp|ad|mail|web|app|db|sql|proxy|ids|ips|siem|nms|syslog|controller|wlc|load|lb|scada|historian/,'rk-server',1],
  [/ups/,'rk-ups',2],[/pdu|power/,'rk-pdu',1],[/patch/,'rk-patch',1],[/fib|odf/,'rk-fiber',1],[/kvm|console/,'rk-kvm',1],[/media|converter/,'rk-shelf',2]];
const VPDU=/vertical|\b0 ?u\b|zero-?u|vpdu/,ROOFFAN=t=>/roof|top[- ]mount/.test(t)&&/fan|cool/.test(t);
function rackTypeFor(n){const t=(n.type+' '+(n.labels?.[0]?.text||'')).toLowerCase();if(Shapes.rackItems[n.type])return[n.type,Shapes.rackItems[n.type].u];
  if(/pdu|power/.test(t)&&VPDU.test(t))return['rk-vpdu',0];for(const[re,rt,u]of MAP)if(re.test(t))return[/24/.test(t)&&rt==='rk-switch'?'rk-switch24':rt,u];return['rk-server',1]}
// Families: rack equipment named without a height ('Server' is rk-server or rk-server2 by height).
const family=type=>Shapes.rackItems[type]?.fam||'';
const families=()=>[...new Set(Object.values(Shapes.rackItems).map(x=>x.fam))];
function typeFor(fam,hU){const c=Object.entries(Shapes.rackItems).filter(([,v])=>v.fam===fam);return(c.find(([,v])=>v.u===hU)||c[0])?.[0]||null}
// Rack equipment named in free text (a spreadsheet, a device name): {type, guessed}
const MORE=[[/blank/,'rk-blank'],[/brush/,'rk-brush'],[/shelf/,'rk-shelf'],[/drawer/,'rk-drawer'],[/vented|cable tray/,'rk-tray'],[/fan/,'rk-fan'],[/cable ?man|cable mgmt|cable organi[sz]er/,'rk-cable'],[/ats|transfer switch/,'rk-ats'],[/monitor|lcd/,'rk-monitor'],[/blade/,'rk-blade']];
function guessType(text){const t=String(text||'').toLowerCase();if(/pdu|power strip|power bar/.test(t)&&VPDU.test(t))return{type:'rk-vpdu',guessed:true};if(ROOFFAN(t))return{type:'rk-rooffan',guessed:true};
  for(const[re,rt]of MORE)if(re.test(t))return{type:rt,guessed:true};for(const[re,rt]of MAP)if(re.test(t))return{type:/24/.test(t)&&rt==='rk-switch'?'rk-switch24':rt,guessed:true};return{type:'rk-server',guessed:true}}

// Typical draw (W) and depth (mm) when the device does not say; marked as estimates in reports.
const TYPICAL={'rk-server':[350,700],'rk-server2':[550,750],'rk-blade':[3000,800],'rk-storage':[600,650],'rk-nvr':[180,500],'rk-switch':[150,350],'rk-switch24':[70,300],'rk-router':[250,450],'rk-firewall':[90,350],'rk-patch':[0,120],'rk-fiber':[0,250],'rk-cable':[0,90],'rk-ups':[0,650],'rk-pdu':[0,60],'rk-kvm':[35,650],'rk-shelf':[0,500],'rk-blank':[0,20],'rk-brush':[0,40],'rk-fan':[60,350],'rk-ats':[10,300],'rk-drawer':[0,500],'rk-monitor':[40,650],'rk-kvmsw':[20,250],'rk-tray':[0,600],'rk-vpdu':[0,60]};
function specs(n,find){const a=n.ref&&find?.(n.ref),own=+n.data?.power,ref=+a?.data?.power,tp=n.type==='rk-rooffan'?[30*fansOf(n),0]:TYPICAL[n.type]||[0,400];
  return{power:own||ref||tp[0],estimated:!own&&!ref&&tp[0]>0,depth:+n.data?.depth||+a?.data?.depth||tp[1],capacity:+n.data?.capacityVA||+a?.data?.capacityVA||0,asset:a}}
// Space, power, heat and depth for one rack.
function summary(r,items,find){const eq=contents(r,items).sort((a,b)=>uOf(r,b)-uOf(r,a)),rows=eq.map(n=>({n,u:uOf(r,n),h:heightU(n),...specs(n,find)}));
  const order={roof:0,left:1,right:2,loose:3},ex=extras(r,items).map(n=>({n,mount:where(r,n).mount,where:position(r,n),...specs(n,find)})).sort((a,b)=>order[a.mount]-order[b.mount]||C.box(a.n).y-C.box(b.n).y);
  const power=rows.reduce((s,x)=>s+x.power,0)+ex.reduce((s,x)=>s+x.power,0),v=+r.data?.voltage||230,budget=+r.data?.powerBudget||0,depth=+r.data?.depth||1000,usable=depth-150,ups=rows.filter(x=>x.n.type==='rk-ups').reduce((s,x)=>s+x.capacity*.9,0);
  const used=rows.reduce((s,x)=>s+x.h,0),deep=rows.filter(x=>x.depth>usable),warn=[];
  if(budget&&power>budget)warn.push(`Power ${power} W is over the ${budget} W budget.`);else if(budget&&power>budget*.8)warn.push(`Power is at ${Math.round(power/budget*100)}% of the budget (keep under 80%).`);
  if(ups&&power>ups)warn.push(`Load ${power} W is more than the UPS can carry (${Math.round(ups)} W).`);
  for(const x of deep)warn.push(`${x.asset?.labels?.[0]?.text||x.n.labels?.[0]?.text||x.n.type} is ${x.depth} mm deep — more than the ${usable} mm usable in a ${depth} mm rack.`);
  if(rows.some(x=>x.estimated)||ex.some(x=>x.estimated))warn.push('Some power figures are typical values — enter Power draw (W) on the device for exact numbers.');
  return{rack:r,rows,extras:ex,units:units(r),used,free:units(r)-used,power,amps:+(power/v).toFixed(1),volts:v,btu:Math.round(power*3.412),budget,ups:Math.round(ups),depth,usable,deepest:Math.max(0,...rows.map(x=>x.depth)),warn}}

return{isRack,isItem,isU,isZeroU,mountOf,heightU,contents,extras,frontRect,rackOf,channel,where,position,fansOf,uOf,occupied,fits,findSlot,freeU,placeAt,
  sideOccupied,sideFits,findSide,placeSide,sideLength,inWay,roofItem,placeRoof,resize,setFrame,setUnits,syncRear,setHeight,moveTo,isLocked,rackTypeFor,family,families,typeFor,guessType,specs,summary,TYPICAL};
})();
if(typeof module!=='undefined')module.exports=Racks;
