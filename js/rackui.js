// Rack interactions: add drawing devices to a rack as linked rack units, change a unit's height, move it to a U, lock it
// there, rack views (front / rear / top), accessories, and the power & space dialog.
const RackUI=(()=>{
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const allItems=()=>S.doc.pages.flatMap(p=>p.items);
const pageOf=n=>S.doc.pages.find(p=>p.items.includes(n));
const findAny=id=>allItems().find(x=>x.id===id);
const name=n=>(Analysis.nameOf(n)||Shapes.nameOf(n.type)).split('\n')[0];
const ACCESSORIES=['rk-cable','rk-cable2','rk-tray','rk-shelf','rk-drawer','rk-kvm','rk-monitor','rk-kvmsw','rk-patch','rk-fiber','rk-pdu','rk-vpdu','rk-ats','rk-fan','rk-rooffan','rk-blank','rk-blank2','rk-brush'];
const PDU='PDU 0U (vertical)';
const unitOf=dev=>allItems().find(x=>x.ref===dev.id&&Racks.isItem(x));
function resizeRack(r){const D=Shapes.rackDims(r);r.w=D.w;r.h=D.h}

// ---------- add drawing devices to a rack ----------
function openAdd(devs=picked().filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Racks.isItem(n))){if(!devs.length)return notify('Select the devices to put in a rack.');
  const racks=S.doc.pages.flatMap(p=>p.items.filter(Racks.isRack).map(r=>({r,p}))),fams=Racks.families().filter(f=>f!=='Roof fan tray');
  const rows=devs.map(d=>{const[t,u]=Racks.rackTypeFor(d),cur=unitOf(d),cr=cur&&Racks.rackOf(cur,pageOf(cur)?.items||[]);return{d,t,fam:Racks.family(t),u:u||1,cur,where:cur&&cr?`${name(cr)} · ${Racks.position(cr,cur)}`:''}});
  const opt=(v,t,cur)=>`<option value="${v}" ${String(v)===String(cur)?'selected':''}>${t}</option>`;
  const dlg=openDialog(`Add ${plural(devs.length,'device')} to a rack`,`<p class="muted">Each device becomes a rack unit with its own height. Linked units keep the device's name and data, and the inventory shows where it is mounted.</p>
    <div class="tableWrap rkTable"><table class="report"><thead><tr><th></th><th>Device</th><th>Mounted as</th><th>Height</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td><input type="checkbox" data-rk-on="${i}" ${x.cur?'':'checked'}></td><td>${html(name(x.d))}<br><em class="muted">${html(Shapes.nameOf(x.d.type))}</em></td><td><select data-rk-type="${i}">${fams.map(f=>opt(f,f,x.fam)).join('')}</select></td><td><select data-rk-u="${i}" ${x.fam===PDU?'disabled':''}>${[1,2,3,4,5,6,7,8,10].map(u=>opt(u,u+'U',x.u)).join('')}</select></td><td>${x.cur?`<em class="warnTxt">already in ${html(x.where)}</em>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div class="fld"><span>Rack</span><div class="seg"><button data-rk-dest="existing" class="${racks.length?'active':''}" ${racks.length?'':'disabled'}>Existing rack</button><button data-rk-dest="new" class="${racks.length?'':'active'}">New rack</button></div></div>
    <div id="rkExisting" ${racks.length?'':'hidden'}><select id="rkRack">${racks.map(({r,p},i)=>opt(i,`${html(name(r))} — ${Racks.freeU(r,p.items)} of ${r.units||42} U free · ${html(p.name)}`)).join('')}</select></div>
    <div id="rkNew" class="row r3" ${racks.length?'hidden':''}><label class="fld"><span>Name</span><input id="rkName" value="Rack ${racks.length+1}"></label><label class="fld"><span>Height</span><select id="rkUnits">${[12,18,24,42,45,47,48].map(u=>opt(u,u+'U',42)).join('')}</select></label><label class="fld"><span>Put it on</span><select id="rkWhere"><option value="page">a new “Racks” page</option><option value="here">this page, beside the drawing</option></select></label></div>
    <div class="fld"><span>Fill</span><div class="seg"><button data-rk-fill="top" class="active">From the top</button><button data-rk-fill="bottom">From the bottom</button></div></div>
    <label class="check"><input type="checkbox" id="rkLink" checked>Keep each unit linked to its device (name and data follow)</label>
    <footer><button data-close>Cancel</button><button class="primary" data-rk-go>Add to rack</button></footer>`,{wide:true});
  let dest=racks.length?'existing':'new',fill='top';
  // a vertical PDU hangs in a side channel at full height — it has no U height to choose
  dlg.onchange=e=>{const i=e.target.dataset.rkType;if(i!=null)dlg.querySelector(`[data-rk-u="${i}"]`).disabled=e.target.value===PDU};
  dlg.onclick=e=>{const t=e.target;if(t.closest('[data-close]'))return closeDialog();const ds=t.closest('[data-rk-dest]');if(ds&&!ds.disabled){dest=ds.dataset.rkDest;dlg.querySelectorAll('[data-rk-dest]').forEach(b=>b.classList.toggle('active',b===ds));$('rkExisting').hidden=dest!=='existing';$('rkNew').hidden=dest!=='new';return}
    const fl=t.closest('[data-rk-fill]');if(fl){fill=fl.dataset.rkFill;dlg.querySelectorAll('[data-rk-fill]').forEach(b=>b.classList.toggle('active',b===fl));return}
    if(!t.closest('[data-rk-go]'))return;const chosen=rows.map((x,i)=>{const fam=dlg.querySelector(`[data-rk-type="${i}"]`).value,u=+dlg.querySelector(`[data-rk-u="${i}"]`).value;return{...x,on:dlg.querySelector(`[data-rk-on="${i}"]`).checked,t:Racks.typeFor(fam,u)||'rk-server',u}}).filter(x=>x.on);
    if(!chosen.length)return notify('Tick at least one device.');const link=$('rkLink').checked;closeDialog();
    let target,page,made=[],missed=[];
    mutate(()=>{if(dest==='existing'){({r:target,p:page}=racks[+$('rkRack').value])}
      else{const where=$('rkWhere').value;if(where==='page'){page=S.doc.pages.find(p=>p.name==='Racks'&&!p.isBackground);if(!page){page=C.page('Racks');const cur=pg();for(const k of['paper','orientation','margin','bg','autoSize','customW','customH','minPaper','minW','minH'])if(cur[k]!==undefined)page[k]=cur[k];if(cur.background)page.background=cur.background;S.doc.pages.push(page)}}else page=pg();
        target=Shapes.make('rack'+$('rkUnits').value,0,0,$('rkName').value.trim()||'Rack');target.layer=S.activeLayer;const others=page.items.filter(n=>!n.pin),b=others.length?C.bounds(others):null,m=(page.margin||10)*C.PX+40;
        C.move(target,(b?b.x+b.w+80:m)-target.x,(b?b.y:m+30)-target.y);page.items.push(target)}
      for(const x of chosen){const it=Shapes.make(x.t,0,0,link?'{{asset}}':name(x.d));it.layer=target.layer||S.activeLayer;if(link)it.ref=x.d.id;else it.data={...C.copy(x.d.data||{})};
        if(Racks.mountOf(it)==='side'){page.items.push(it);if(mountNew(target,it,'left',page,true))made.push(it);else{page.items.splice(page.items.indexOf(it),1);missed.push(name(x.d))}continue}
        it.h=x.u*Shapes.RU;const u=Racks.findSlot(target,page.items,x.u,{order:fill});if(u==null){missed.push(name(x.d));continue}page.items.push(it);Racks.placeAt(target,it,u);made.push(it)}});
    const pi=S.doc.pages.indexOf(page);if(pi!==S.pageIndex)gotoPage(pi);select(made.map(n=>n.id));fit(true);
    notify(`Added ${plural(made.length,'unit')} to ${name(target)}${missed.length?` · no room for ${missed.join(', ')} (${Racks.freeU(target,page.items)} U free)`:''}. Right-click a unit to change its height, move it to a U or lock it there.`,6000)}}

// ---------- unit commands ----------
function rackFor(n){return Racks.rackOf(n,items())}
function setHeight(n,hU){const r=rackFor(n);if(!r){mutate(()=>{n.h=hU*Shapes.RU});return}if(Racks.isLocked(n,r))return notify('This unit is locked in its U — unlock it first.');
  let res=null;mutate(()=>{res=Racks.setHeight(r,n,hU,items())});if(res==null)notify(`No room for a ${hU}U unit in ${name(r)} — free some space first.`);else notify(`${name(n)} is now ${hU}U at U${res}${hU>1?'–'+(res+hU-1):''}.`,2200)}
function openMoveTo(n){const r=rackFor(n);if(!r)return notify('This unit is not in a rack.');if(Racks.isLocked(n,r))return notify('This unit is locked in its U — unlock it first.');
  const w=Racks.where(r,n),side=w.mount==='left'||w.mount==='right'?w.mount:null;if(Racks.isZeroU(n)&&!side)return notify('Drag it into a side channel of the rack first.');
  const ex=new Set([n.id]),fits=u=>side?Racks.sideFits(r,items(),side,u,h,ex):Racks.fits(r,items(),u,h,ex),taken=u=>side?[...Racks.sideOccupied(r,items(),side,ex)]:[...Racks.occupied(r,items(),ex)];
  const cur=Racks.uOf(r,n),h=Racks.heightU(n),d=openDialog(`Move ${html(name(n))}`,`<div class="row"><label class="fld"><span>${side?'Starts at U (bottom)':'To U (lowest U it occupies)'}</span><input id="rkTo" type="number" min="1" max="${(r.units||42)-h+1}" value="${cur}"></label><div class="fld"><span>&nbsp;</span><label class="check"><input type="checkbox" id="rkLockToo">Lock it there</label></div></div><p class="muted" id="rkMsg">Now at U${cur}${h>1?'–'+(cur+h-1):''} of ${r.units||42}.</p><footer><button data-close>Cancel</button><button class="primary" data-rk-mv>Move</button></footer>`);
  setTimeout(()=>$('rkTo').select(),20);d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(!e.target.closest('[data-rk-mv]'))return;const u=+$('rkTo').value;
    if(!fits(u)){const who=taken(u).filter(([k])=>k>=u&&k<u+h).map(([,x])=>name(x));$('rkMsg').innerHTML=`<span class="warnTxt">U${u}${h>1?'–'+(u+h-1):''} is ${u<1||u+h-1>(r.units||42)?'outside the rack':'taken by '+html([...new Set(who)].join(', '))}.</span>`;return}
    const lock=$('rkLockToo').checked;closeDialog();mutate(()=>{if(side)Racks.placeSide(r,n,side,u,h);else Racks.moveTo(r,n,u,items());if(lock)n.uLock=true});notify(`${name(n)} moved to U${u}${lock?' and locked there':''}.`,2200)}}
function toggleLock(list){const on=!list.every(n=>n.uLock);mutate(()=>list.forEach(n=>{if(on)n.uLock=true;else delete n.uLock}));notify(on?`Locked in place — ${plural(list.length,'unit')} stay in their U when dragged (the rack still carries them).`:'Unlocked.',2600)}
function gotoAsset(n){const a=findAny(n.ref);if(!a)return notify('The linked device is no longer in the drawing.');gotoPage(S.doc.pages.indexOf(pageOf(a)));select([a.id]);fit(true)}
function gotoUnit(dev){const u=unitOf(dev);if(!u)return;gotoPage(S.doc.pages.indexOf(pageOf(u)));select([u.id]);fit(true)}

// ---------- rack commands ----------
// Turning a view on widens the rack; whatever stands to its right moves along so nothing ends up underneath.
function setView(r,k){mutate(()=>{const edge=r.x+r.w,top=r.y,h0=r.h;r.views={...r.views,[k]:!r.views?.[k]};resizeRack(r);const dx=r.x+r.w-edge;if(dx)makeRoom(r,edge,dx,top,top+Math.max(h0,r.h))})}
const own=(r,all)=>new Set([r.id,...Racks.contents(r,all).map(n=>n.id),...Racks.extras(r,all).map(n=>n.id)]);
const carry=(n,all,set)=>{set.add(n.id);if(Racks.isRack(n))for(const u of[...Racks.contents(n,all),...Racks.extras(n,all)])set.add(u.id)};
// Move a set of items: links between two moved items move with them, free links only when free(e) says so; links
// with one end moved re-route.
function shift(all,set,dx,dy,free){for(const n of all)if(set.has(n.id))C.move(n,dx,dy);
  for(const e of all){if(e.kind!=='edge')continue;const a=set.has(e.from?.node),b=set.has(e.to?.node);if(a&&b||!e.from&&!e.to&&free(e))C.move(e,dx,dy);else if(a||b)Conn.markDirty(e.id)}}
function makeRoom(r,edge,dx,top,bottom,page=pg()){const all=page.items,mine=own(r,all),set=new Set();
  for(const n of all){if(mine.has(n.id)||n.kind==='edge'||n.pin)continue;const b=C.bounds([n]);if(b.x>=edge-2&&b.y<bottom&&b.y+b.h>top)carry(n,all,set)}
  shift(all,set,dx,0,e=>e.points.every(p=>p[0]>=edge-2))}
// The roof grows upwards: whatever stands in its band moves up out of the way.
function pushUp(r,band,page=pg()){const all=page.items,set=new Set();for(const n of Racks.inWay(r,all,band))carry(n,all,set);if(set.size)shift(all,set,0,-band.h,()=>false)}

// ---------- cabinet: 0U side channels and the roof ----------
// Inside a mutate (or a drag): change the cabinet and make room for it → Racks.setFrame's result, or null if locked.
function frame(r,want,page=pg(),ignore=null){if(isLocked(r)){notify(`Unlock ${name(r)} (or its layer) to change the cabinet.`,3000);return null}
  const all=page.items,edge=r.x+r.w,top=r.y,bottom=r.y+r.h,res=Racks.setFrame(r,all,want,{margin:(page.margin??10)*C.PX,ignore});if(!res.ok)return res;
  const grow=r.x+r.w-edge;if(grow>.5)makeRoom(r,edge,grow,Math.min(top,r.y),Math.max(bottom,r.y+r.h),page);if(res.band)pushUp(r,res.band,page);
  for(const e of all)if(e.kind==='edge'&&res.moved.some(id=>e.from?.node===id||e.to?.node===id))Conn.markDirty(e.id);return res}
const mounted=(r,list)=>list.filter(n=>{const m=Racks.where(r,n).mount;return m==='left'||m==='right'||m==='roof'});
function toggleFrame(r,k){if(isLocked(r))return notify(`Unlock ${name(r)} (or its layer) to change the cabinet.`,3000);
  if(!r[k]){mutate(()=>frame(r,{[k]:true}));return notify(k==='sides'?`${name(r)} now has 0U side channels — drag a ${PDU} to either side.`:`${name(r)} now has a roof — drag a Roof fan tray onto it.`,3200)}
  const on=mounted(r,Racks.extras(r,items())).filter(n=>(Racks.mountOf(n)==='side')===(k==='sides'));if(!on.length){mutate(()=>frame(r,{[k]:false}));return}
  const list=on.map(n=>`${name(n)} (${Racks.position(r,n)})`).join(', '),d=openDialog(k==='sides'?`Remove the side channels from ${html(name(r))}?`:`Remove the roof from ${html(name(r))}?`,
    `<p>${k==='sides'?`${plural(on.length,'vertical PDU')} ${on.length>1?'are':'is'} mounted there: ${html(list)}.`:`The roof fan tray is mounted there: ${html(list)}.`} Linked devices stay in the drawing.</p><footer><button data-close>Cancel</button><button class="primary" data-rk-rm>${k==='sides'?`Delete ${plural(on.length,'PDU')} and remove the channels`:'Delete it and remove the roof'}</button></footer>`);
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(!e.target.closest('[data-rk-rm]'))return;closeDialog();mutate(()=>{removeItems(pg(),on.map(n=>n.id));frame(r,{[k]:false})});notify(k==='sides'?'Side channels removed.':'Roof removed.',2000)}}
// Default names: PDU A on the left, PDU B on the right (A2, B2… for more on one side); names the user typed stay.
function pduName(r,n,side,page=pg()){const l=n.labels?.[0];if(!l||!(l.text===Shapes.rackItems[n.type]?.name||/^PDU [AB]\d*$/.test(l.text)))return;const base=side==='left'?'PDU A':'PDU B',taken=new Set(Racks.extras(r,page.items).filter(x=>x!==n).map(x=>x.labels?.[0]?.text));let k=1,t=base;while(taken.has(t))t=base+(++k);l.text=t}
// The rack a 0U PDU / fan tray dropped at (x,y) goes on: {r, prefer} — or {refuse} when there is no room for it.
function dropTarget(type,x,y){const m=Racks.mountOf(type),RA=Shapes.RACK,r=items().find(r=>{if(!Racks.isRack(r))return false;const f=Racks.frontRect(r),gx=m==='side'&&!r.sides?RA.side:0,gy=m==='roof'&&!r.roof?RA.roof:0;return x>=f.x-gx&&x<=f.x+f.w+gx&&y>=f.y-gy&&y<=f.y+f.h});if(!r)return null;
  if((m==='side'?!r.sides:!r.roof)&&isLocked(r))return{refuse:`Unlock ${name(r)} (or its layer) to change the cabinet.`};
  if(m==='roof')return Racks.roofItem(r,items())?{refuse:`${name(r)} already has a roof fan tray — right-click it ▸ Fans to change how many.`}:{r};
  const i=Shapes.rackInner(r),prefer=x<i.x+i.w/2?'left':'right';return!r.sides||Racks.findSide(r,items(),r.units||42,{prefer,shorten:true})?{r,prefer}:{refuse:`Both side channels of ${name(r)} are full — shorten a PDU first (right-click ▸ Length).`}}
// A new 0U PDU / fan tray (palette drop, Add accessory, Add to rack): adds the channels or roof the rack lacks, then
// mounts it — a PDU at full height on the preferred side, else the other, else the longest free run. Inside a mutate.
function mountNew(r,n,prefer='left',page=pg(),quiet=false){const m=Racks.mountOf(n),grows=m==='side'?!r.sides:!r.roof;
  if(m==='roof'&&Racks.roofItem(r,page.items.filter(x=>x!==n))){if(!quiet)notify(`${name(r)} already has a roof fan tray — right-click it ▸ Fans to change how many.`,3200);return false}
  if(grows&&!frame(r,m==='side'?{sides:true}:{roof:true},page,[n.id])?.ok)return false;
  if(m==='roof'){Racks.placeRoof(r,n);if(!quiet)notify(`Roof fan tray (${Racks.fansOf(n)} fans) added to ${name(r)}${grows?' — it now has a roof':''}. Right-click it ▸ Fans to change how many.`,3600);return true}
  const f=Racks.findSide(r,page.items,r.units||42,{prefer,shorten:true,except:new Set([n.id])});if(!f){if(!quiet)notify(`Both side channels of ${name(r)} are full.`,2600);return false}
  Racks.placeSide(r,n,f.side,f.u,f.len);pduName(r,n,f.side,page);if(!quiet)notify(`${name(n)} mounted on the ${f.side} side, U${f.u}–${f.u+f.len-1} — right-click ▸ Length to shorten it.${grows?` ${name(r)} now has 0U side channels; shapes to its right moved over.`:''}`,4200);return true}
// A dragged 0U PDU / fan tray let go on a rack (app.js pointerUp, inside the drag's undo step).
function mountDropped(r,n,sl){if(sl.mount==='roof'){if(!r.roof&&!frame(r,{roof:true},pg(),[n.id])?.ok)return;Racks.placeRoof(r,n);return notify(`${name(n)} on the roof of ${name(r)}${sl.ghost?' — it now has a roof':''}.`,2400)}
  if(!r.sides&&!frame(r,{sides:true},pg(),[n.id])?.ok)return;const ex=new Set([n.id]);let{side,u,len}=sl;if(!Racks.sideFits(r,items(),side,u,len,ex)){const f=Racks.findSide(r,items(),len,{prefer:side,near:u,except:ex});if(!f)return notify('No room left in the side channels.',2400);({side,u,len}=f)}
  Racks.placeSide(r,n,side,u,len);pduName(r,n,side);notify(`${name(n)} on the ${side} side, U${u}–${u+len-1}${sl.ghost?` — ${name(r)} now has 0U side channels`:''}.`,2400)}
// The free run of len U on one side nearest to U near (null if none).
function nearOnSide(r,side,len,near,ex){const c=[];for(let u=1;u+len-1<=(r.units||42);u++)if(Racks.sideFits(r,items(),side,u,len,ex))c.push(u);return c.sort((a,b)=>Math.abs(a-near)-Math.abs(b-near)||a-b)[0]??null}
function pduAt(n){const r=rackFor(n),w=r&&Racks.where(r,n);if(!w||w.mount!=='left'&&w.mount!=='right'){notify('Drag the PDU into a side channel of a rack first.');return null}if(Racks.isLocked(n,r)){notify('This PDU is locked in place — unlock it first.');return null}return{r,w}}
// New length, keeping its lowest U when there is room, else its top U, else the nearest free run on that side.
function setLength(n,len){const a=pduAt(n);if(!a)return;const{r,w}=a;if(!(Math.round(+len)>=1))return;const p=Racks.sideLength(r,items(),n,len);if(!p)return notify(`No ${Math.round(+len)}U run is free on the ${w.mount} side.`);
  mutate(()=>Racks.placeSide(r,n,p.side,p.u,p.len));notify(`${name(n)} is now ${p.len}U long, U${p.u}–${p.u+p.len-1}.`,2200)}
function openLength(n){const a=pduAt(n);if(!a)return;const d=openDialog(`Length of ${html(name(n))}`,`<label class="fld"><span>Length (U)</span><input id="rkLen" type="number" min="1" max="${a.r.units||42}" value="${a.w.h}"></label><footer><button data-close>Cancel</button><button class="primary" data-rk-len>Set length</button></footer>`);
  setTimeout(()=>$('rkLen').select(),20);d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(e.target.closest('[data-rk-len]')){const v=+$('rkLen').value;closeDialog();setLength(n,v)}}}
function switchSide(n){const a=pduAt(n);if(!a)return;const{r,w}=a,to=w.mount==='left'?'right':'left',u=nearOnSide(r,to,w.h,w.u,new Set([n.id]));if(u==null)return notify(`No ${w.h}U run is free on the ${to} side.`);
  mutate(()=>{Racks.placeSide(r,n,to,u,w.h);pduName(r,n,to)});notify(`${name(n)} moved to the ${to} side, U${u}–${u+w.h-1}.`,2200)}
function setFans(n,k){mutate(()=>{n.data={...n.data,fans:k}});notify(`${name(n)}: ${plural(k,'fan')}.`,1600)}
function addAccessory(r,type){const m=Racks.mountOf(type);
  if(m!=='u'){const f=Racks.frontRect(r),t=dropTarget(type,...(m==='roof'?[f.x+f.w/2,f.y+10]:[f.x+5,f.y+f.h/2]));if(t?.refuse)return notify(t.refuse,3200);mutate(()=>{const it=Shapes.make(type,0,0);it.layer=r.layer||S.activeLayer;items().push(it);if(mountNew(r,it,'left'))select([it.id]);else items().splice(items().indexOf(it),1)});return}
  const h=Shapes.rackItems[type].u,u=Racks.findSlot(r,items(),h,{order:'top'});if(u==null)return notify(`No ${h}U space left in ${name(r)}.`);
  mutate(()=>{const it=Shapes.make(type,0,0);it.layer=r.layer||S.activeLayer;items().push(it);Racks.placeAt(r,it,u);select([it.id])});notify(`${Shapes.rackItems[type].name} added at U${u}.`,1800)}
function openPower(r){const sm=()=>Racks.summary(r,items(),findAny);let s=sm();
  const row=x=>`<tr><td>U${x.u}${x.h>1?'–'+(x.u+x.h-1):''}</td><td>${html(name(x.n))}</td><td>${html(Shapes.rackItems[x.n.type]?.name||'')}</td><td class="num">${x.power?x.power+' W':'—'}${x.estimated?' <em class="muted">typ.</em>':''}</td><td class="num">${x.depth} mm</td></tr>`;
  const extra=x=>`<tr><td>${html(x.where)}</td><td>${html(name(x.n))}</td><td>${html(Shapes.rackItems[x.n.type]?.name||'')}</td><td class="num">${x.power?x.power+' W':'—'}${x.estimated?' <em class="muted">typ.</em>':''}</td><td class="num">—</td></tr>`;
  const body=()=>`<div class="kpis"><div><b>${s.used}/${s.units} U</b><span>${s.free} U free</span></div><div><b>${s.power.toLocaleString()} W</b><span>${s.amps} A at ${s.volts} V</span></div><div><b>${s.btu.toLocaleString()} BTU/h</b><span>heat to remove</span></div><div><b>${s.budget?Math.round(s.power/s.budget*100)+'%':'—'}</b><span>${s.budget?'of '+s.budget+' W budget':'no budget set'}</span></div><div><b>${s.deepest} mm</b><span>deepest · ${s.usable} mm usable</span></div></div>
    ${s.warn.length?`<ul class="rkWarn">${s.warn.map(w=>`<li>${html(w)}</li>`).join('')}</ul>`:'<p class="okTxt">✓ Fits: space, power and depth are within limits.</p>'}
    <div class="tableWrap"><table class="report"><thead><tr><th>U</th><th>Unit</th><th>Type</th><th class="num">Power</th><th class="num">Depth</th></tr></thead><tbody>${s.extras.filter(x=>x.mount==='roof').map(extra).join('')}${s.rows.map(row).join('')}${s.extras.filter(x=>x.mount!=='roof').map(extra).join('')}</tbody></table></div>`;
  const d=openDialog(`${html(name(r))} — space & power`,`<div class="row r3"><label class="fld"><span>Power budget (W)</span><input data-rk-p="powerBudget" type="number" min="0" value="${r.data?.powerBudget||''}" placeholder="e.g. 5000"></label><label class="fld"><span>Supply voltage (V)</span><input data-rk-p="voltage" type="number" value="${r.data?.voltage||230}"></label><label class="fld"><span>Rack depth (mm)</span><input data-rk-p="depth" type="number" value="${r.data?.depth||1000}"></label></div><div id="rkBody">${body()}</div>
    <footer><button data-rk-tbl>Insert as a table</button><span class="spacer"></span><button class="primary" data-close>Done</button></footer>`,{wide:true});
  d.oninput=e=>{const k=e.target.dataset.rkP;if(!k)return;r.data??={};const v=+e.target.value;if(v)r.data[k]=v;else delete r.data[k];s=sm();$('rkBody').innerHTML=body()};
  d.onchange=e=>{if(e.target.dataset.rkP){changed();render();if(e.target.dataset.rkP==='depth'){resizeRack(r);render()}}};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(e.target.closest('[data-rk-tbl]')){closeDialog();insertReportTable({title:`${name(r)} — space & power`,columns:['U','Unit','Type','Power (W)','Depth (mm)'],rows:[...s.rows.map(x=>[`U${x.u}${x.h>1?'–'+(x.u+x.h-1):''}`,name(x.n),Shapes.rackItems[x.n.type]?.name||'',x.power||'',x.depth]),...s.extras.map(x=>[x.where,name(x.n),Shapes.rackItems[x.n.type]?.name||'',x.power||'','']),['','Total',`${s.used}/${s.units} U`,s.power,`${s.btu} BTU/h`]]},false)}}}

// ---------- spreadsheet: a rack to Excel and back ----------
// resolved first label line; one render context per page and one answer per item for the life of an env (big drawings)
function namer(){const home=new Map(),ctx=new Map(),got=new Map();for(const p of S.doc.pages)for(const n of p.items)home.set(n,p);
  return n=>{if(got.has(n))return got.get(n);const l=n.labels?.find(x=>x.view!=='rear'),p=home.get(n)||pg();let c=ctx.get(p);if(!c){c=makeCtx(p);ctx.set(p,c)}const v=l?String(resolveLabel(n,l,c)??'').split('\n')[0]:'';got.set(n,v);return v}}
function sheetEnv(page=pg()){return{find:findAny,doc:S.doc,page,unitOf,layer:S.activeLayer,nameOf:namer(),margin:(page.margin??10)*C.PX,setFrame:(r,f)=>frame(r,f,page),removeItems,
  devices:S.doc.pages.flatMap(p=>p.items.filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Racks.isItem(n)).map(n=>({n,page:p})))}}
// the selected rack, the rack of a selected unit, else the only rack on the page
function sheetRack(){const sel=picked(),r=sel.find(Racks.isRack)||sel.map(n=>Racks.isItem(n)&&Racks.rackOf(n,items())).find(Boolean);if(r)return r;const all=items().filter(Racks.isRack);return all.length===1?all[0]:null}
const rackAt=at=>at&&items().find(r=>Racks.isRack(r)&&C.inside({x:at[0],y:at[1],w:0,h:0},Racks.frontRect(r)))||null;
function saveSheet(t,fmt){const base=safeName(t.name||'Rack')+' - rack';if(fmt==='csv'){const c=RackSheet.toCSV(t);download(base+'.csv',c.startsWith('﻿')?c:'﻿'+c,'text/csv')}else download(base+'.xlsx',new Blob([RackSheet.toXlsx(t)],{type:Xlsx.MIME}),Xlsx.MIME);
  notify(`“${base}.${fmt}” downloaded. Fill in the free rows, then drop the file on the rack (or right-click the rack ▸ Spreadsheet ▸ Import…).`,6500)}
// Download straight away when it is clear which rack; otherwise ask (or offer a blank rack to plan from scratch).
function exportSheet(r=sheetRack(),fmt='xlsx',blank=false){if(r)return saveSheet(RackSheet.exportTable(r,items(),sheetEnv()),fmt);const all=items().filter(Racks.isRack);blank=blank||!all.length;
  const d=openDialog('Export a rack to Excel',`<label class="fld"><span>Rack</span><select id="rkXr">${all.map((x,i)=>`<option value="${i}">${html(name(x))}</option>`).join('')}<option value="blank" ${blank?'selected':''}>A blank rack…</option></select></label>
    <div id="rkXb" class="row" ${blank?'':'hidden'}><label class="fld"><span>Name</span><input id="rkXn" value="Rack ${all.length+1}"></label><label class="fld"><span>Height</span><select id="rkXu">${[12,18,24,42,45,47,48].map(u=>`<option value="${u}" ${u===42?'selected':''}>${u}U</option>`).join('')}</select></label></div>
    <div class="fld"><span>Format</span><div class="seg"><button data-fmt="xlsx" class="active">Excel (.xlsx)</button><button data-fmt="csv">CSV</button></div></div>
    <p class="muted">One row per U, highest first, with drop-down lists for the equipment. Fill it in or update it in Excel, then drop the file on the rack — you see what will change before anything does.</p>
    <footer><button data-close>Cancel</button><button class="primary" data-rk-x>Download</button></footer>`);
  let f=fmt;d.onchange=e=>{if(e.target.id==='rkXr')$('rkXb').hidden=e.target.value!=='blank'};
  d.onclick=e=>{const b=e.target.closest('[data-fmt]');if(b){f=b.dataset.fmt;d.querySelectorAll('[data-fmt]').forEach(x=>x.classList.toggle('active',x===b));return}if(e.target.closest('[data-close]'))return closeDialog();if(!e.target.closest('[data-rk-x]'))return;
    const v=$('rkXr').value,t=v==='blank'?RackSheet.blankTable(+$('rkXu').value,$('rkXn').value.trim()||'Rack',sheetEnv()):RackSheet.exportTable(all[+v],items(),sheetEnv());closeDialog();saveSheet(t,f)}}
// The file picker opens inside the click (Safari only allows it there). Only a rack the user picked is taken as the
// target here; otherwise the import works it out from the file (About tab, Row IDs) or the page.
function importSheet(r=picked().find(Racks.isRack)||picked().map(n=>Racks.isItem(n)&&Racks.rackOf(n,items())).find(Boolean)||null){if(S.reviewMode)return ReviewUI.blocked();const inp=document.createElement('input');inp.type='file';inp.accept='.xlsx,.csv,.tsv,.txt';inp.onchange=()=>{const f=inp.files?.[0];if(f)openImport(f,{rack:r})};inp.click()}
function notRack(file,csv){const d=openDialog('This isn’t a rack spreadsheet',`<p>No U and Name columns were found in “${html(file.name)}”. Export one from a rack (right-click ▸ Spreadsheet ▸ Export to Excel), fill it in and import it back.</p>
  <footer><button data-close>Close</button><span class="spacer"></span>${csv?'<button data-nr="dev">Open it as a device import</button>':''}<button class="primary" data-nr="blank">Download a blank rack sheet</button></footer>`);
  d.onclick=async e=>{const a=e.target.closest('[data-nr]')?.dataset.nr;if(e.target.closest('[data-close]'))return closeDialog();if(!a)return;closeDialog();if(a==='dev')openImportDialog({devices:await file.text()});else exportSheet(null,'xlsx',true)}}
// Read a spreadsheet and show what importing it into a rack would do; nothing changes until Import is pressed.
async function openImport(file,{rack=null,at=null}={}){if(S.reviewMode)return ReviewUI.blocked();let book;try{book=await RackSheet.read(file,file.name,{doc:S.doc})}catch(err){return notify(err.message||'This file could not be read.',8000)}
  if(!book.tabs.some(t=>t.rack))return notRack(file,book.format==='csv');
  const all=S.doc.pages.flatMap(p=>p.items.filter(Racks.isRack).map(r=>({r,p}))),here=items().filter(Racks.isRack),from=book.about?.id&&all.find(x=>x.r.id===book.about.id)?.r;
  // a CSV has no About tab: the rack most of its Row IDs belong to tells where it came from
  const ids=new Set(RackSheet.fromRows((book.tabs[book.tab]||book.tabs.find(t=>t.rack)).rows,{doc:S.doc}).rows.map(x=>x.rowId).filter(Boolean)),owner=ids.size?all.map(x=>({r:x.r,k:[...Racks.contents(x.r,x.p.items),...Racks.extras(x.r,x.p.items)].filter(n=>ids.has(n.id)).length})).sort((a,b)=>b.k-a.k)[0]:null;
  const target=rackAt(at)||rack||from||(owner?.k?owner.r:null)||(here.length===1?here[0]:null)||null,fams=Racks.families();
  // a new rack is named after the sheet (About, else the tab or file name) unless the user types a name
  const tabName=i=>book.about?.name||String(book.tabs[i]?.name||'').replace(/\s*-\s*rack$/i,'').trim()||`Rack ${all.length+1}`;
  const st={tab:book.tabs[book.tab]?.rack?book.tab:book.tabs.findIndex(t=>t.rack),into:all.findIndex(x=>x.r===target),newName:null,newUnits:0,where:'page',showSame:false,
    o:{resolve:{},off:[],types:{},updateLinked:true,linkByName:true,alsoLocked:false,removeMissing:false,growTo:null,about:book.about,rackChanges:true}};
  let src,P,R,page;
  const compute=()=>{src=RackSheet.fromRows(book.tabs[st.tab].rows,{doc:S.doc});if(st.into>=0){({r:R,p:page}=all[st.into]);P=RackSheet.plan(R,page.items,src,{...st.o,newRack:false},sheetEnv(page));return}
    // its height: the one chosen, else the sheet's (About, else the run of U rows it was exported with), else the smallest that fits
    const need=Math.max(0,...src.rows.map(x=>(+x.u||0)+(+x.h||1)-1)),run=+src.tops?.[0]||0,units=st.newUnits||+book.about?.units||(run>=need&&run?run:0)||[12,18,24,42,45,47,48].find(h=>h>=need)||need||42;
    R=Shapes.make('rack'+units,0,0,st.newName??tabName(st.tab));page=null;P=RackSheet.plan(R,[R],src,{...st.o,newRack:true},sheetEnv())};
  const rows=()=>P.rows.filter(x=>st.showSame||x.status!=='same'),same=P=>P.rows.filter(x=>x.status==='same').length;
  const row=x=>{const sel=x.kind==='new'&&x.on?`<select data-rs-type="${x.line}">${fams.map(f=>`<option ${f===x.fam?'selected':''}>${html(f)}</option>`).join('')}</select>${x.guessed?' <em class="muted">guessed</em>':''}`:html(x.fam||'');
    const notes=[...(x.problems||[]),...(x.skipped||[]).map(c=>c.text||c)].map(t=>`<div class="warnTxt">${html(t)}</div>`).join('')+(x.notes||[]).map(t=>`<div class="muted">${html(t)}</div>`).join('');
    const cf=x.conflict&&x.on?`<div class="warnTxt">${html(x.conflict.text)}</div><select data-rs-res="${x.line}">${x.conflict.options.map(o=>`<option value="${o.v}" ${o.v===x.conflict.choice?'selected':''}>${html(o.text)}</option>`).join('')}</select>`:'';
    return`<tr class="${x.on?'':'muted'}"><td><input type="checkbox" data-rs-on="${x.line}" ${x.on?'checked':''}></td><td class="num">${x.line}</td><td>${html(x.position||'')}</td><td>${html(x.name||'')}</td><td>${sel}</td><td>${html(x.what||(x.status==='same'?'No change':''))}${cf}${notes}</td></tr>`};
  const body=()=>{const c=P.counts,kp=(n,t)=>`<div><b>${n}</b><span>${t}</span></div>`,into=st.into>=0?name(R):null,src0=book.tabs[st.tab];
    return`<p class="muted">“${html(file.name)}”${book.tabs.length>1?` · tab “${html(src0.name)}”`:''} · ${plural(src.rows.length,'row')}${P.matchedBy?` · matched by ${html(String(P.matchedBy).replace(/\s*,\s*/g,', '))}`:''}</p>
    ${book.tabs.filter(t=>t.rack).length>1?`<label class="fld"><span>Tab</span><select id="rsTab">${book.tabs.map((t,i)=>t.rack?`<option value="${i}" ${i===st.tab?'selected':''}>${html(t.name)}</option>`:'').join('')}</select></label>`:''}
    ${P.mismatch?`<p class="warnTxt">${html(P.mismatch.name&&P.mismatch.name===name(R)?`This spreadsheet comes from a different copy of “${P.mismatch.name}”${P.mismatch.drawing?` (${P.mismatch.drawing})`:''}, so its Row IDs do not apply here — rows are matched by serial no., name and position.`:P.mismatch.text)}</p>`:''}
    <div class="row"><label class="fld"><span>Into</span><select id="rsInto">${all.map((x,i)=>`<option value="${i}" ${i===st.into?'selected':''}>${html(name(x.r))} — ${html(x.p.name)}</option>`).join('')}<option value="-1" ${st.into<0?'selected':''}>A new rack…</option></select></label>
    ${st.into<0?`<label class="fld"><span>Name</span><input id="rsName" value="${html(st.newName??tabName(st.tab))}"></label><label class="fld"><span>Height</span><select id="rsUnits">${[12,18,24,42,45,47,48].map(u=>`<option value="${u}" ${u===(R.units||42)?'selected':''}>${u}U</option>`).join('')}</select></label><label class="fld"><span>Put it on</span><select id="rsWhere"><option value="page" ${st.where==='page'?'selected':''}>a new “Racks” page</option><option value="here" ${st.where==='here'?'selected':''}>this page</option></select></label>`:''}</div>
    <div class="kpis">${kp(c.add,'to add')}${kp(c.update,'to update')}${kp(c.move,'to move')}${kp(c.skip,'skipped')}${kp(c.missing,'not in the spreadsheet')}</div>
    ${P.rackText?`<label class="check"><input type="checkbox" id="rsRack" ${st.o.rackChanges?'checked':''}>${html(P.rackText)}</label>`:''}${(P.rackProblems||[]).map(t=>`<p class="warnTxt">${html(t)}</p>`).join('')}
    ${P.frame?`<p class="muted">${P.frame.sides?`Adds 0U side channels to ${html(into||'the rack')} (shapes to its right move over). `:''}${P.frame.roof?`Adds a roof to ${html(into||'the rack')}.`:''}</p>`:''}
    ${P.grow&&(st.o.growTo||!P.grow.on)?`<label class="check"><input type="checkbox" id="rsGrow" ${st.o.growTo?'checked':''}>Make ${html(into||'the rack')} ${st.o.growTo||P.grow.suggest}U so rows up to U${P.grow.need} fit</label>`:''}
    ${locked()?`<p class="warnTxt">${html(name(R))} is locked (or on a locked layer) — unlock it to import into it.</p>`:''}
    <div class="tableWrap rkTable"><table class="report"><thead><tr><th></th><th class="num">Row</th><th>Position</th><th>Unit</th><th>Equipment</th><th>What changes</th></tr></thead><tbody>${rows().map(row).join('')||`<tr><td colspan="6" class="muted">No changes in the rows.</td></tr>`}</tbody></table></div>
    ${same(P)?`<button class="linkish" id="rsSame">${st.showSame?'Hide':'Show'} ${plural(same(P),'unchanged row')}</button>`:''}
    ${P.missing.length?`<details ${st.o.removeMissing?'open':''}><summary>Not in the spreadsheet (${P.missing.length})</summary><p class="muted">${P.missing.map(m=>`${html(m.name)} (${html(m.where)})`).join(' · ')}</p><label class="check"><input type="checkbox" id="rsRemove" ${st.o.removeMissing?'checked':''}>Remove them from ${html(into||'the rack')} (linked devices stay in the drawing)</label>${P.missingMany?'<p class="warnTxt">That is more than half of the rack — check that the Row ID column is still in the file.</p>':''}</details>`:''}
    <label class="check"><input type="checkbox" id="rsLinked" ${st.o.updateLinked?'checked':''}>Update linked devices in the drawing (name, model, serial no.…)${P.renames?.length?` <em class="muted">— renames ${P.renames.slice(0,3).map(x=>html(x.from+' → '+x.to)).join(', ')}${P.renames.length>3?'…':''}</em>`:''}</label>
    <label class="check"><input type="checkbox" id="rsByName" ${st.o.linkByName?'checked':''}>Link new rows to drawing devices with the same name</label>
    ${P.lockedMoves?`<label class="check"><input type="checkbox" id="rsLocked" ${st.o.alsoLocked?'checked':''}>Also move locked units (${P.lockedMoves})</label>`:''}
    ${P.ignored?.length?`<p class="muted">Columns not imported: ${P.ignored.map(html).join(', ')}.</p>`:''}`};
  const locked=()=>st.into>=0&&isLocked(R);
  const foot=()=>locked()?`<button data-close>Close</button>`:P.empty?`<span class="muted">Nothing to change — the spreadsheet matches ${html(name(R))}.</span><span class="spacer"></span><button class="primary" data-close>Close</button>`:`<button data-close>Cancel</button><span class="spacer"></span><button class="primary" data-rs-go>Import ${plural(P.changes,'change')}</button>`;
  compute();const d=openDialog(st.into>=0?`Import into ${html(name(R))} — preview`:'Import as a new rack — preview',`<div id="rsBody">${body()}</div><footer id="rsFoot">${foot()}</footer>`,{wide:true});
  const redraw=()=>{compute();d.querySelector('h2').textContent=st.into>=0?`Import into ${name(R)} — preview`:'Import as a new rack — preview';$('rsBody').innerHTML=body();$('rsFoot').innerHTML=foot()};
  const lineSet=(k,line,v)=>{st.o[k]={...st.o[k],[line]:v}};
  d.onchange=e=>{const t=e.target,ln=+(t.dataset.rsOn||t.dataset.rsRes||t.dataset.rsType);
    if(t.dataset.rsOn){st.o.off=t.checked?st.o.off.filter(x=>x!==ln):[...st.o.off,ln]}else if(t.dataset.rsRes)lineSet('resolve',ln,t.value);else if(t.dataset.rsType){const x=P.rows.find(r=>r.line===ln);lineSet('types',ln,Racks.typeFor(t.value,x?.want?.h||1))}
    else if(t.id==='rsTab'){st.tab=+t.value;st.o={...st.o,resolve:{},off:[],types:{},growTo:null}}else if(t.id==='rsInto'){st.into=+t.value;st.o={...st.o,resolve:{},off:[],types:{},growTo:null}}
    // typing a name changes nothing else: no redraw, so the Import button under the pointer stays the same element
    else if(t.id==='rsName'){st.newName=t.value;if(R?.labels?.[0])R.labels[0].text=t.value;return}else if(t.id==='rsUnits'){st.newUnits=+t.value;st.o.growTo=null}else if(t.id==='rsWhere'){st.where=t.value;return}
    else if(t.id==='rsRack'){st.o.rackChanges=t.checked;if(!t.checked)st.o.growTo=null}else if(t.id==='rsGrow')st.o.growTo=t.checked?P.grow.suggest:null;else if(t.id==='rsRemove')st.o.removeMissing=t.checked;else if(t.id==='rsLinked')st.o.updateLinked=t.checked;else if(t.id==='rsByName')st.o.linkByName=t.checked;else if(t.id==='rsLocked')st.o.alsoLocked=t.checked;else return;redraw()};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(e.target.id==='rsSame'){st.showSame=!st.showSame;$('rsBody').innerHTML=body();return}if(!e.target.closest('[data-rs-go]'))return;closeDialog();applySheet(P,R,page,st)}}
// One undo step for the whole import; a new rack goes beside the drawing (or on a “Racks” page) first.
function applySheet(P,R,page,st){if(page&&isLocked(R))return notify(`Unlock ${name(R)} (or its layer) to import into it.`,3200);if(!page){if(st.where==='page'){page=S.doc.pages.find(p=>p.name==='Racks'&&!p.isBackground);if(!page){page=C.page('Racks');const cur=pg();for(const k of['paper','orientation','margin','bg','autoSize','customW','customH','minPaper','minW','minH'])if(cur[k]!==undefined)page[k]=cur[k];if(cur.background)page.background=cur.background}}else page=pg()}
  const pi=S.doc.pages.indexOf(page);if(pi>=0&&pi!==S.pageIndex)gotoPage(pi);let res=null;
  mutate(()=>{if(!S.doc.pages.includes(page)){S.doc.pages.push(page);S.pageIndex=S.doc.pages.length-1;clearTransient()}
    if(!page.items.includes(R)){R.layer=S.activeLayer;const others=page.items.filter(n=>!n.pin),b=others.length?C.bounds(others):null,m=(page.margin||10)*C.PX+40;C.move(R,(b?b.x+b.w+80:m)-R.x,(b?b.y:m+30)-R.y)}
    res=RackSheet.apply(P,R,page,sheetEnv(page));const moved=new Set([...res.moved,...res.added]);for(const e of page.items)if(e.kind==='edge'&&(moved.has(e.from?.node)||moved.has(e.to?.node)))Conn.markDirty(e.id);for(const p of res.pages)Constraints.sync(p,S.doc)});
  if(!res)return;if(res.ids.length)select(res.ids.filter(id=>page.items.some(n=>n.id===id)));fit(true);notify(`${name(R)}: ${res.summary} — ${MODK}+Z undoes the import.`,5000)}

// ---------- right-click ----------
function menu(sel){const sub=(l,b)=>`<div class="sub"><button>${l} ▸</button><div class="submenu">${b}</div></div>`;let h='';
  const devs=sel.filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Racks.isItem(n)),units=sel.filter(Racks.isItem),uu=units.filter(Racks.isU),racks=sel.filter(Racks.isRack);
  const pdu=units.length===1&&Racks.mountOf(units[0])==='side'?units[0]:null,tray=units.length===1&&Racks.mountOf(units[0])==='roof'?units[0]:null;
  if(devs.length){h+=`<button data-ctx="q:rk:add">${devs.some(unitOf)?'Add to rack… (some are racked)':'Add to rack…'}</button>`;if(devs.length===1&&unitOf(devs[0]))h+=`<button data-ctx="q:rk:unit">Show it in its rack</button>`}
  if(pdu){const r=rackFor(pdu),w=r&&Racks.where(r,pdu);if(w&&(w.mount==='left'||w.mount==='right')){const n=r.units||42,opts=[[n,`Full height (${n}U)`],[Math.round(n*.75),`Three-quarters (${Math.round(n*.75)}U)`],[Math.round(n/2),`Half (${Math.round(n/2)}U)`]];
    h+=sub('Length',opts.map(([v,t])=>`<button data-ctx="q:rk:len:${v}">${t}${v===w.h?' ✓':''}</button>`).join('')+`<button data-ctx="q:rk:len:custom">Custom…</button>`)+`<button data-ctx="q:rk:side">Move to the ${w.mount==='left'?'right':'left'} side</button><button data-ctx="q:rk:to">Move to U…</button>`}}
  if(tray){const k=Racks.fansOf(tray);h+=sub('Fans',[1,2,3,4,5,6].map(v=>`<button data-ctx="q:rk:fans:${v}">${plural(v,'fan')}${v===k?' ✓':''}</button>`).join(''))}
  if(uu.length){const cur=uu.length===1?Racks.heightU(uu[0]):0;h+=sub('Height',[1,2,3,4,5,6,8,10].map(u=>`<button data-ctx="q:rk:h:${u}">${u}U${u===cur?' ✓':''}</button>`).join(''));
    if(uu.length===1&&units.length===1)h+=`<button data-ctx="q:rk:to">Move to U…</button>`}
  if(units.length){const zu=units.every(Racks.isZeroU);h+=`<button data-ctx="q:rk:lock">${units.every(n=>n.uLock)?zu?'Unlock':'Unlock U position':zu?'Lock in place':'Lock in this U'}</button>`;if(units.length===1&&units[0].ref)h+=`<button data-ctx="q:rk:asset">Show the device in the drawing</button>`}
  if(racks.length===1){const r=racks[0],v=r.views||{};h+=sub('Views',`<button data-ctx="q:rk:v:rear">${v.rear?'✓ ':''}Rear view</button><button data-ctx="q:rk:v:top">${v.top?'✓ ':''}Top view (depth)</button>`)
    +sub('Spreadsheet',`<button data-ctx="q:rk:xls:export">Export to Excel (.xlsx)</button><button data-ctx="q:rk:xls:csv">Export as CSV</button><button data-ctx="q:rk:xls:import">Import from Excel or CSV…</button>`)
    +sub('Cabinet',`<button data-ctx="q:rk:frame:sides">${r.sides?'✓ ':''}0U side channels (vertical PDUs)</button><button data-ctx="q:rk:frame:roof">${r.roof?'✓ ':''}Roof (fan tray)</button>`)
    +sub('Add accessory',ACCESSORIES.map(t=>`<button data-ctx="q:rk:acc:${t}">${html(Shapes.rackItems[t].name)}</button>`).join(''))
    +`<button data-ctx="q:rk:lockall">${r.lockItems?'Unlock all equipment':'Lock all equipment in its U'}</button><button data-ctx="q:rk:power">Space & power…</button>`}
  return h}
function apply(c){const[, ,op,...rest]=c.split(':'),v=rest.join(':'),sel=picked(),u1=sel.find(Racks.isItem),r1=sel.find(Racks.isRack);
  if(op==='add')return openAdd();if(op==='unit')return gotoUnit(sel.find(n=>Shapes.isDevice(n)));
  if(op==='h'){for(const n of sel.filter(Racks.isU))setHeight(n,+v);return}if(op==='to'&&u1)return openMoveTo(u1);
  if(op==='len'&&u1)return v==='custom'?openLength(u1):setLength(u1,+v);if(op==='side'&&u1)return switchSide(u1);if(op==='fans'&&u1)return setFans(u1,+v);if(op==='lock')return toggleLock(sel.filter(Racks.isItem));if(op==='asset'&&u1)return gotoAsset(u1);
  if(!r1)return;if(op==='v')return setView(r1,v);if(op==='frame')return toggleFrame(r1,v);if(op==='xls')return v==='import'?importSheet(r1):exportSheet(r1,v==='csv'?'csv':'xlsx');if(op==='acc')return addAccessory(r1,v);if(op==='power')return openPower(r1);
  if(op==='lockall'){mutate(()=>{r1.lockItems=!r1.lockItems});notify(r1.lockItems?'Equipment is locked in its U; moving the rack still carries it.':'Equipment unlocked.',2400)}}

return{openAdd,setHeight,openMoveTo,toggleLock,gotoAsset,gotoUnit,setView,addAccessory,openPower,menu,apply,resizeRack,unitOf,ACCESSORIES,
  frame,toggleFrame,dropTarget,mountNew,mountDropped,setLength,openLength,switchSide,setFans,pduName,makeRoom,shift,exportSheet,importSheet,openImport,rackAt};
})();
