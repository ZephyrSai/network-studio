// Rack engine: which equipment sits in which rack and U, free space, placing / resizing / moving by U (never on top of
// something else), U locks, rack units linked to drawing devices, and power / heat / depth checks.
const Racks=(()=>{
const C=Core;
const RU=()=>Shapes.RU,inner=r=>Shapes.rackInner(r);
const isRack=n=>n?.type==='rack',isItem=n=>n?.kind==='node'&&!!Shapes.rackItems[n.type];
const heightU=n=>Math.max(1,Math.round(n.h/RU()));
const units=r=>r.units||42;
function contents(r,items){const i=inner(r);return items.filter(n=>isItem(n)&&C.inside(C.box(n),{x:i.x-1,y:i.y-1,w:i.w+2,h:i.h+2}))}
function rackOf(n,items){const c=C.center(n);return items.find(r=>isRack(r)&&(()=>{const i=inner(r);return c[0]>=i.x-1&&c[0]<=i.x+i.w+1&&c[1]>=i.y-1&&c[1]<=i.y+i.h+1})())||null}
const uOf=(r,n)=>Shapes.rackU(r,n);// lowest U the item occupies (1 = bottom)
function occupied(r,items,except){const set=new Map();for(const n of contents(r,items)){if(except?.has(n.id))continue;const u=uOf(r,n);for(let k=0;k<heightU(n);k++)set.set(u+k,n)}return set}
function fits(r,items,u,h,except){if(u<1||u+h-1>units(r))return false;const occ=occupied(r,items,except);for(let k=0;k<h;k++)if(occ.has(u+k))return false;return true}
// A free run of h U: from the top (default), the bottom, or nearest to a U.
function findSlot(r,items,h,{order='top',near=null,except}={}){const c=[];for(let u=1;u+h-1<=units(r);u++)if(fits(r,items,u,h,except))c.push(u);if(!c.length)return null;if(near!=null)return c.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near)||b-a)[0];return order==='top'?c.at(-1):c[0]}
function freeU(r,items){return units(r)-[...occupied(r,items).keys()].length}
// Put n so its lowest U is u.
function placeAt(r,n,u){const i=inner(r),h=heightU(n)*RU();n.h=h;n.w=i.w;C.move(n,i.x-n.x,i.y+i.h-(u-1)*RU()-h-n.y);const l=n.labels?.[0];if(l&&!l.anchor){l.align='start';l.x=n.x+12;l.size=heightU(n)>1?10:8.5;l.y=n.y+n.h/2+l.size*.36}}
// New height, keeping the top U where it was if there is room, else the bottom U, else the nearest free run.
function setHeight(r,n,hU,items){const cur=uOf(r,n),top=cur+heightU(n)-1,exc=new Set([n.id]);let u=[top-hU+1,cur].find(x=>fits(r,items,x,hU,exc));if(u==null)u=findSlot(r,items,hU,{near:cur,except:exc});if(u==null)return null;n.h=hU*RU();placeAt(r,n,u);return u}
function moveTo(r,n,u,items){if(!fits(r,items,u,heightU(n),new Set([n.id])))return false;placeAt(r,n,u);return true}
const isLocked=(n,r)=>!!(n.uLock||r?.lockItems);

// Which rack unit stands for a drawing device: [type pattern, rack item, U].
const MAP=[[/firewall|utm|ngfw|waf/,'rk-firewall',1],[/router|sdwan|wan|vpn/,'rk-router',2],[/l3switch|coreswitch|core|switch|hub/,'rk-switch',1],
  [/nvr|vms|recorder/,'rk-nvr',2],[/san|storage|nas|backup|tape/,'rk-storage',2],[/hypervisor|esx|blade/,'rk-server2',2],[/server|dns|dhcp|ad|mail|web|app|db|sql|proxy|ids|ips|siem|nms|syslog|controller|wlc|load|lb|scada|historian/,'rk-server',1],
  [/ups/,'rk-ups',2],[/pdu|power/,'rk-pdu',1],[/patch/,'rk-patch',1],[/fib|odf/,'rk-fiber',1],[/kvm|console/,'rk-kvm',1],[/media|converter/,'rk-shelf',2]];
function rackTypeFor(n){const t=(n.type+' '+(n.labels?.[0]?.text||'')).toLowerCase();if(Shapes.rackItems[n.type])return[n.type,Shapes.rackItems[n.type].u];
  for(const[re,rt,u]of MAP)if(re.test(t))return[/24/.test(t)&&rt==='rk-switch'?'rk-switch24':rt,u];return['rk-server',1]}

// Typical draw (W) and depth (mm) when the device does not say; marked as estimates in reports.
const TYPICAL={'rk-server':[350,700],'rk-server2':[550,750],'rk-blade':[3000,800],'rk-storage':[600,650],'rk-nvr':[180,500],'rk-switch':[150,350],'rk-switch24':[70,300],'rk-router':[250,450],'rk-firewall':[90,350],'rk-patch':[0,120],'rk-fiber':[0,250],'rk-cable':[0,90],'rk-ups':[0,650],'rk-pdu':[0,60],'rk-kvm':[35,650],'rk-shelf':[0,500],'rk-blank':[0,20],'rk-brush':[0,40],'rk-fan':[60,350],'rk-ats':[10,300],'rk-drawer':[0,500],'rk-monitor':[40,650],'rk-kvmsw':[20,250],'rk-tray':[0,600]};
function specs(n,find){const a=n.ref&&find?.(n.ref),own=+n.data?.power,ref=+a?.data?.power,tp=TYPICAL[n.type]||[0,400];
  return{power:own||ref||tp[0],estimated:!own&&!ref&&tp[0]>0,depth:+n.data?.depth||+a?.data?.depth||tp[1],capacity:+n.data?.capacityVA||+a?.data?.capacityVA||0,asset:a}}
// Space, power, heat and depth for one rack.
function summary(r,items,find){const eq=contents(r,items).sort((a,b)=>uOf(r,b)-uOf(r,a)),rows=eq.map(n=>({n,u:uOf(r,n),h:heightU(n),...specs(n,find)}));
  const power=rows.reduce((s,x)=>s+x.power,0),v=+r.data?.voltage||230,budget=+r.data?.powerBudget||0,depth=+r.data?.depth||1000,usable=depth-150,ups=rows.filter(x=>x.n.type==='rk-ups').reduce((s,x)=>s+x.capacity*.9,0);
  const used=rows.reduce((s,x)=>s+x.h,0),deep=rows.filter(x=>x.depth>usable),warn=[];
  if(budget&&power>budget)warn.push(`Power ${power} W is over the ${budget} W budget.`);else if(budget&&power>budget*.8)warn.push(`Power is at ${Math.round(power/budget*100)}% of the budget (keep under 80%).`);
  if(ups&&power>ups)warn.push(`Load ${power} W is more than the UPS can carry (${Math.round(ups)} W).`);
  for(const x of deep)warn.push(`${x.asset?.labels?.[0]?.text||x.n.labels?.[0]?.text||x.n.type} is ${x.depth} mm deep — more than the ${usable} mm usable in a ${depth} mm rack.`);
  if(rows.some(x=>x.estimated))warn.push('Some power figures are typical values — enter Power draw (W) on the device for exact numbers.');
  return{rack:r,rows,units:units(r),used,free:units(r)-used,power,amps:+(power/v).toFixed(1),volts:v,btu:Math.round(power*3.412),budget,ups:Math.round(ups),depth,usable,deepest:Math.max(0,...rows.map(x=>x.depth)),warn}}

return{isRack,isItem,heightU,contents,rackOf,uOf,occupied,fits,findSlot,freeU,placeAt,setHeight,moveTo,isLocked,rackTypeFor,specs,summary,TYPICAL};
})();
if(typeof module!=='undefined')module.exports=Racks;
