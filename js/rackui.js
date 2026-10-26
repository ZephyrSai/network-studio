// Rack interactions: add drawing devices to a rack as linked rack units, change a unit's height, move it to a U, lock it
// there, rack views (front / rear / top), accessories, and the power & space dialog.
const RackUI=(()=>{
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const allItems=()=>S.doc.pages.flatMap(p=>p.items);
const pageOf=n=>S.doc.pages.find(p=>p.items.includes(n));
const findAny=id=>allItems().find(x=>x.id===id);
const name=n=>(Analysis.nameOf(n)||Shapes.nameOf(n.type)).split('\n')[0];
const ACCESSORIES=['rk-cable','rk-cable2','rk-tray','rk-shelf','rk-drawer','rk-kvm','rk-monitor','rk-kvmsw','rk-patch','rk-fiber','rk-pdu','rk-ats','rk-fan','rk-blank','rk-blank2','rk-brush'];
const unitOf=dev=>allItems().find(x=>x.ref===dev.id&&Racks.isItem(x));
function resizeRack(r){const D=Shapes.rackDims(r);r.w=D.w;r.h=D.h}

// ---------- add drawing devices to a rack ----------
function openAdd(devs=picked().filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Racks.isItem(n))){if(!devs.length)return notify('Select the devices to put in a rack.');
  const racks=S.doc.pages.flatMap(p=>p.items.filter(Racks.isRack).map(r=>({r,p}))),types=Object.entries(Shapes.rackItems);
  const rows=devs.map(d=>{const[t,u]=Racks.rackTypeFor(d),cur=unitOf(d),cr=cur&&Racks.rackOf(cur,pageOf(cur)?.items||[]);return{d,t,u,cur,where:cur&&cr?`${name(cr)} · U${Racks.uOf(cr,cur)}`:''}});
  const opt=(v,t,cur)=>`<option value="${v}" ${String(v)===String(cur)?'selected':''}>${t}</option>`;
  const dlg=openDialog(`Add ${plural(devs.length,'device')} to a rack`,`<p class="muted">Each device becomes a rack unit with its own height. Linked units keep the device's name and data, and the inventory shows where it is mounted.</p>
    <div class="tableWrap rkTable"><table class="report"><thead><tr><th></th><th>Device</th><th>Mounted as</th><th>Height</th><th></th></tr></thead><tbody>${rows.map((x,i)=>`<tr><td><input type="checkbox" data-rk-on="${i}" ${x.cur?'':'checked'}></td><td>${html(name(x.d))}<br><em class="muted">${html(Shapes.nameOf(x.d.type))}</em></td><td><select data-rk-type="${i}">${types.map(([k,v])=>opt(k,v.name.replace(/ \d+U.*$/,'').replace(/ · .*$/,''),x.t)).join('')}</select></td><td><select data-rk-u="${i}">${[1,2,3,4,5,6,7,8,10].map(u=>opt(u,u+'U',x.u)).join('')}</select></td><td>${x.cur?`<em class="warnTxt">already in ${html(x.where)}</em>`:''}</td></tr>`).join('')}</tbody></table></div>
    <div class="fld"><span>Rack</span><div class="seg"><button data-rk-dest="existing" class="${racks.length?'active':''}" ${racks.length?'':'disabled'}>Existing rack</button><button data-rk-dest="new" class="${racks.length?'':'active'}">New rack</button></div></div>
    <div id="rkExisting" ${racks.length?'':'hidden'}><select id="rkRack">${racks.map(({r,p},i)=>opt(i,`${html(name(r))} — ${Racks.freeU(r,p.items)} of ${r.units||42} U free · ${html(p.name)}`)).join('')}</select></div>
    <div id="rkNew" class="row r3" ${racks.length?'hidden':''}><label class="fld"><span>Name</span><input id="rkName" value="Rack ${racks.length+1}"></label><label class="fld"><span>Height</span><select id="rkUnits">${[12,18,24,42,45,47,48].map(u=>opt(u,u+'U',42)).join('')}</select></label><label class="fld"><span>Put it on</span><select id="rkWhere"><option value="page">a new “Racks” page</option><option value="here">this page, beside the drawing</option></select></label></div>
    <div class="fld"><span>Fill</span><div class="seg"><button data-rk-fill="top" class="active">From the top</button><button data-rk-fill="bottom">From the bottom</button></div></div>
    <label class="check"><input type="checkbox" id="rkLink" checked>Keep each unit linked to its device (name and data follow)</label>
    <footer><button data-close>Cancel</button><button class="primary" data-rk-go>Add to rack</button></footer>`,{wide:true});
  let dest=racks.length?'existing':'new',fill='top';
  dlg.onclick=e=>{const t=e.target;if(t.closest('[data-close]'))return closeDialog();const ds=t.closest('[data-rk-dest]');if(ds&&!ds.disabled){dest=ds.dataset.rkDest;dlg.querySelectorAll('[data-rk-dest]').forEach(b=>b.classList.toggle('active',b===ds));$('rkExisting').hidden=dest!=='existing';$('rkNew').hidden=dest!=='new';return}
    const fl=t.closest('[data-rk-fill]');if(fl){fill=fl.dataset.rkFill;dlg.querySelectorAll('[data-rk-fill]').forEach(b=>b.classList.toggle('active',b===fl));return}
    if(!t.closest('[data-rk-go]'))return;const chosen=rows.map((x,i)=>({...x,on:dlg.querySelector(`[data-rk-on="${i}"]`).checked,t:dlg.querySelector(`[data-rk-type="${i}"]`).value,u:+dlg.querySelector(`[data-rk-u="${i}"]`).value})).filter(x=>x.on);
    if(!chosen.length)return notify('Tick at least one device.');const link=$('rkLink').checked;closeDialog();
    let target,page,made=[],missed=[];
    mutate(()=>{if(dest==='existing'){({r:target,p:page}=racks[+$('rkRack').value])}
      else{const where=$('rkWhere').value;if(where==='page'){page=S.doc.pages.find(p=>p.name==='Racks'&&!p.isBackground);if(!page){page=C.page('Racks');const cur=pg();for(const k of['paper','orientation','margin','bg','autoSize'])if(cur[k]!==undefined)page[k]=cur[k];if(cur.background)page.background=cur.background;S.doc.pages.push(page)}}else page=pg();
        target=Shapes.make('rack'+$('rkUnits').value,0,0,$('rkName').value.trim()||'Rack');target.layer=S.activeLayer;const others=page.items.filter(n=>!n.pin),b=others.length?C.bounds(others):null,m=(page.margin||10)*C.PX+40;
        C.move(target,(b?b.x+b.w+80:m)-target.x,(b?b.y:m+30)-target.y);page.items.push(target)}
      for(const x of chosen){const it=Shapes.make(x.t,0,0,link?'{{asset}}':name(x.d));it.layer=target.layer||S.activeLayer;if(link)it.ref=x.d.id;else it.data={...C.copy(x.d.data||{})};it.h=x.u*Shapes.RU;
        const u=Racks.findSlot(target,page.items,x.u,{order:fill});if(u==null){missed.push(name(x.d));continue}page.items.push(it);Racks.placeAt(target,it,u);made.push(it)}});
    const pi=S.doc.pages.indexOf(page);if(pi!==S.pageIndex)gotoPage(pi);select(made.map(n=>n.id));fit(true);
    notify(`Added ${plural(made.length,'unit')} to ${name(target)}${missed.length?` · no room for ${missed.join(', ')} (${Racks.freeU(target,page.items)} U free)`:''}. Right-click a unit to change its height, move it to a U or lock it there.`,6000)}}

// ---------- unit commands ----------
function rackFor(n){return Racks.rackOf(n,items())}
function setHeight(n,hU){const r=rackFor(n);if(!r){mutate(()=>{n.h=hU*Shapes.RU});return}if(Racks.isLocked(n,r))return notify('This unit is locked in its U — unlock it first.');
  let res=null;mutate(()=>{res=Racks.setHeight(r,n,hU,items())});if(res==null)notify(`No room for a ${hU}U unit in ${name(r)} — free some space first.`);else notify(`${name(n)} is now ${hU}U at U${res}${hU>1?'–'+(res+hU-1):''}.`,2200)}
function openMoveTo(n){const r=rackFor(n);if(!r)return notify('This unit is not in a rack.');if(Racks.isLocked(n,r))return notify('This unit is locked in its U — unlock it first.');
  const cur=Racks.uOf(r,n),h=Racks.heightU(n),d=openDialog(`Move ${html(name(n))}`,`<div class="row"><label class="fld"><span>To U (lowest U it occupies)</span><input id="rkTo" type="number" min="1" max="${(r.units||42)-h+1}" value="${cur}"></label><div class="fld"><span>&nbsp;</span><label class="check"><input type="checkbox" id="rkLockToo">Lock it there</label></div></div><p class="muted" id="rkMsg">Now at U${cur}${h>1?'–'+(cur+h-1):''} of ${r.units||42}.</p><footer><button data-close>Cancel</button><button class="primary" data-rk-mv>Move</button></footer>`);
  setTimeout(()=>$('rkTo').select(),20);d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(!e.target.closest('[data-rk-mv]'))return;const u=+$('rkTo').value;
    if(!Racks.fits(r,items(),u,h,new Set([n.id]))){const who=[...Racks.occupied(r,items(),new Set([n.id]))].filter(([k])=>k>=u&&k<u+h).map(([,x])=>name(x));$('rkMsg').innerHTML=`<span class="warnTxt">U${u}${h>1?'–'+(u+h-1):''} is ${u<1||u+h-1>(r.units||42)?'outside the rack':'taken by '+html([...new Set(who)].join(', '))}.</span>`;return}
    const lock=$('rkLockToo').checked;closeDialog();mutate(()=>{Racks.moveTo(r,n,u,items());if(lock)n.uLock=true});notify(`${name(n)} moved to U${u}${lock?' and locked there':''}.`,2200)}}
function toggleLock(list){const on=!list.every(n=>n.uLock);mutate(()=>list.forEach(n=>{if(on)n.uLock=true;else delete n.uLock}));notify(on?`Locked in place — ${plural(list.length,'unit')} stay in their U when dragged (the rack still carries them).`:'Unlocked.',2600)}
function gotoAsset(n){const a=findAny(n.ref);if(!a)return notify('The linked device is no longer in the drawing.');gotoPage(S.doc.pages.indexOf(pageOf(a)));select([a.id]);fit(true)}
function gotoUnit(dev){const u=unitOf(dev);if(!u)return;gotoPage(S.doc.pages.indexOf(pageOf(u)));select([u.id]);fit(true)}

// ---------- rack commands ----------
function setView(r,k){mutate(()=>{r.views={...r.views,[k]:!r.views?.[k]};resizeRack(r)});}
function addAccessory(r,type){const h=Shapes.rackItems[type].u,u=Racks.findSlot(r,items(),h,{order:'top'});if(u==null)return notify(`No ${h}U space left in ${name(r)}.`);
  mutate(()=>{const it=Shapes.make(type,0,0);it.layer=r.layer||S.activeLayer;items().push(it);Racks.placeAt(r,it,u);select([it.id])});notify(`${Shapes.rackItems[type].name} added at U${u}.`,1800)}
function openPower(r){const sm=()=>Racks.summary(r,items(),findAny);let s=sm();
  const row=x=>`<tr><td>U${x.u}${x.h>1?'–'+(x.u+x.h-1):''}</td><td>${html(name(x.n))}</td><td>${html(Shapes.rackItems[x.n.type]?.name||'')}</td><td class="num">${x.power?x.power+' W':'—'}${x.estimated?' <em class="muted">typ.</em>':''}</td><td class="num">${x.depth} mm</td></tr>`;
  const body=()=>`<div class="kpis"><div><b>${s.used}/${s.units} U</b><span>${s.free} U free</span></div><div><b>${s.power.toLocaleString()} W</b><span>${s.amps} A at ${s.volts} V</span></div><div><b>${s.btu.toLocaleString()} BTU/h</b><span>heat to remove</span></div><div><b>${s.budget?Math.round(s.power/s.budget*100)+'%':'—'}</b><span>${s.budget?'of '+s.budget+' W budget':'no budget set'}</span></div><div><b>${s.deepest} mm</b><span>deepest · ${s.usable} mm usable</span></div></div>
    ${s.warn.length?`<ul class="rkWarn">${s.warn.map(w=>`<li>${html(w)}</li>`).join('')}</ul>`:'<p class="okTxt">✓ Fits: space, power and depth are within limits.</p>'}
    <div class="tableWrap"><table class="report"><thead><tr><th>U</th><th>Unit</th><th>Type</th><th class="num">Power</th><th class="num">Depth</th></tr></thead><tbody>${s.rows.map(row).join('')}</tbody></table></div>`;
  const d=openDialog(`${html(name(r))} — space & power`,`<div class="row r3"><label class="fld"><span>Power budget (W)</span><input data-rk-p="powerBudget" type="number" min="0" value="${r.data?.powerBudget||''}" placeholder="e.g. 5000"></label><label class="fld"><span>Supply voltage (V)</span><input data-rk-p="voltage" type="number" value="${r.data?.voltage||230}"></label><label class="fld"><span>Rack depth (mm)</span><input data-rk-p="depth" type="number" value="${r.data?.depth||1000}"></label></div><div id="rkBody">${body()}</div>
    <footer><button data-rk-tbl>Insert as a table</button><span class="spacer"></span><button class="primary" data-close>Done</button></footer>`,{wide:true});
  d.oninput=e=>{const k=e.target.dataset.rkP;if(!k)return;r.data??={};const v=+e.target.value;if(v)r.data[k]=v;else delete r.data[k];s=sm();$('rkBody').innerHTML=body()};
  d.onchange=e=>{if(e.target.dataset.rkP){changed();render();if(e.target.dataset.rkP==='depth'){resizeRack(r);render()}}};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(e.target.closest('[data-rk-tbl]')){closeDialog();insertReportTable({title:`${name(r)} — space & power`,columns:['U','Unit','Type','Power (W)','Depth (mm)'],rows:[...s.rows.map(x=>[`U${x.u}${x.h>1?'–'+(x.u+x.h-1):''}`,name(x.n),Shapes.rackItems[x.n.type]?.name||'',x.power||'',x.depth]),['','Total',`${s.used}/${s.units} U`,s.power,`${s.btu} BTU/h`]]},false)}}}

// ---------- right-click ----------
function menu(sel){const sub=(l,b)=>`<div class="sub"><button>${l} ▸</button><div class="submenu">${b}</div></div>`;let h='';
  const devs=sel.filter(n=>n.kind==='node'&&Shapes.isDevice(n)&&!Racks.isItem(n)),units=sel.filter(Racks.isItem),racks=sel.filter(Racks.isRack);
  if(devs.length){h+=`<button data-ctx="q:rk:add">${devs.some(unitOf)?'Add to rack… (some are racked)':'Add to rack…'}</button>`;if(devs.length===1&&unitOf(devs[0]))h+=`<button data-ctx="q:rk:unit">Show it in its rack</button>`}
  if(units.length){const cur=units.length===1?Racks.heightU(units[0]):0;h+=sub('Height',[1,2,3,4,5,6,8,10].map(u=>`<button data-ctx="q:rk:h:${u}">${u}U${u===cur?' ✓':''}</button>`).join(''));
    if(units.length===1)h+=`<button data-ctx="q:rk:to">Move to U…</button>`;h+=`<button data-ctx="q:rk:lock">${units.every(n=>n.uLock)?'Unlock U position':'Lock in this U'}</button>`;if(units.length===1&&units[0].ref)h+=`<button data-ctx="q:rk:asset">Show the device in the drawing</button>`}
  if(racks.length===1){const r=racks[0],v=r.views||{};h+=sub('Views',`<button data-ctx="q:rk:v:rear">${v.rear?'✓ ':''}Rear view</button><button data-ctx="q:rk:v:top">${v.top?'✓ ':''}Top view (depth)</button>`)
    +sub('Add accessory',ACCESSORIES.map(t=>`<button data-ctx="q:rk:acc:${t}">${html(Shapes.rackItems[t].name)}</button>`).join(''))
    +`<button data-ctx="q:rk:lockall">${r.lockItems?'Unlock all equipment':'Lock all equipment in its U'}</button><button data-ctx="q:rk:power">Space & power…</button>`}
  return h}
function apply(c){const[, ,op,...rest]=c.split(':'),v=rest.join(':'),sel=picked(),u1=sel.find(Racks.isItem),r1=sel.find(Racks.isRack);
  if(op==='add')return openAdd();if(op==='unit')return gotoUnit(sel.find(n=>Shapes.isDevice(n)));
  if(op==='h'){for(const n of sel.filter(Racks.isItem))setHeight(n,+v);return}if(op==='to'&&u1)return openMoveTo(u1);if(op==='lock')return toggleLock(sel.filter(Racks.isItem));if(op==='asset'&&u1)return gotoAsset(u1);
  if(!r1)return;if(op==='v')return setView(r1,v);if(op==='acc')return addAccessory(r1,v);if(op==='power')return openPower(r1);
  if(op==='lockall'){mutate(()=>{r1.lockItems=!r1.lockItems});notify(r1.lockItems?'Equipment is locked in its U; moving the rack still carries it.':'Equipment unlocked.',2400)}}

return{openAdd,setHeight,openMoveTo,toggleLock,gotoAsset,gotoUnit,setView,addAccessory,openPower,menu,apply,resizeRack,unitOf,ACCESSORIES};
})();
