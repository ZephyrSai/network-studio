// Right-click ▸ Change shape…: another picture for the same thing. It keeps its id, links, data, name and place; a unit in a rack keeps its slot.
const ChangeShape=(()=>{
const can=n=>n?.kind==='node'&&n.type!=='rack'&&!n.pin&&!Racks.isZeroU(n)&&!/^ann:/.test(n.type)&&!(typeof Revisions!=='undefined'&&Revisions.MARKUP.has(n.type))&&(n.type==='image'||!!n.image||['device','basic','rackitem'].includes(Shapes.kindOf(n.type)));
const front=n=>n.labels?.find(l=>l.view!=='rear');
const look=n=>n.image||n.type==='image'?'image':Shapes.kindOf(n.type)==='basic'?'basic':'device';
// a name that only repeats the old shape's goes with it; a name someone typed stays
function rename(n,was,now){const l=front(n);if(l&&String(l.text??'').trim()===was)l.text=now}

// A unit stays a unit, at its U and height. type is already a rack type (see unitType).
function swapUnit(n,type,all){const r=Racks.rackOf(n,all),u=r&&Racks.uOf(r,n),c=C0.center(n),was=Shapes.nameOf(n.type);
  n.type=type;for(const k of['inset','artFit','showName','hideName'])delete n[k];if(Shapes.rackItems[type]?.face==='art')delete n.rackFrom;rename(n,was,Shapes.nameOf(type));n.ports=Racks.unitPorts(n,all);
  if(r)Racks.placeAt(r,n,u);else{n.w=Shapes.RACK.inner;n.x=c[0]-n.w/2}return n}

// Anything else: same centre. A picture of about the same proportions takes the same box; otherwise it takes its own proportions at the same area.
function swapShape(n,type,all){const t=Shapes.make(type,0,0),was=look(n),wasName=Shapes.nameOf(n.type),now=Shapes.kindOf(type)==='basic'?'basic':'device',c=C0.center(n),o={x:n.x,y:n.y,w:n.w,h:n.h},a=(t.w/t.h)/(n.w/n.h);let w=n.w,h=n.h;
  if(!(a>.8&&a<1.25)){const k=Math.sqrt(n.w*n.h/(t.w*t.h));w=Math.max(8,Math.round(t.w*k));h=Math.max(8,Math.round(t.h*k))}
  const kept=Racks.keptPorts(n,all);n.type=type;delete n.image;n.w=w;n.h=h;n.x=c[0]-w/2;n.y=c[1]-h/2;
  // a different kind of thing starts from its own look; the same kind keeps the colours chosen for it
  if(was!==now){for(const k of['display','fill','stroke','strokeWidth','dash']){if(t[k]!==undefined)n[k]=t[k];else delete n[k]}n.rotation=0;delete n.flipX;delete n.flipY}
  n.ports=[...kept,...(t.ports||[]).filter(q=>!kept.some(p=>Math.abs(p.x-q.x)<.02&&Math.abs(p.y-q.y)<.02))];
  const main=front(n);for(const l of n.labels||[]){if(l.anchor)continue;const inside=l.x>=o.x&&l.x<=o.x+o.w&&l.y>=o.y&&l.y<=o.y+o.h;
    if(l===main&&was!==now){l.x=c[0];l.align='middle';if(now==='basic'){l.y=c[1]+4.5;l.wrapWidth=w-16}else{l.y=n.y+h+16;delete l.wrapWidth}continue}
    if(inside){if(l.wrapWidth)l.wrapWidth=Math.max(8,w-16);continue}
    if(l.y>o.y+o.h)l.y+=n.y+h-o.y-o.h;else if(l.y<o.y)l.y+=n.y-o.y;if(l.x>o.x+o.w)l.x+=n.x+w-o.x-o.w;else if(l.x<o.x)l.x+=n.x-o.x}
  rename(n,wasName,t.labels?.[0]?.text??'');return n}

function apply(n,type,all,unitType){if(Racks.isU(n))swapUnit(n,unitType||type,all);else swapShape(n,type,all);
  if(typeof Conn!=='undefined')for(const e of all)if(e.kind==='edge'&&(e.from?.node===n.id||e.to?.node===n.id))Conn.markDirty(e.id);return n}

// What the picked shape is as rack equipment: a rack type stays one, a bundled device icon is its family, anything else shows its own picture.
function unitType(type){if(Shapes.rackItems[type])return{type};const probe=Shapes.make(type,0,0),plan=RackUI.mountPlan(probe);if(plan?.type)return{type:plan.type,u:plan.u};return{type:ShapeKit.rackTypeOf(probe),u:ShapeKit.hintOf(probe).u}}

const CAP=240;
function open(){const sel=picked().filter(can);if(!sel.length)return notify('Select a shape to change it.');
  const shut=n=>{if(isLocked(n))return true;const r=Racks.isU(n)&&Racks.rackOf(n,items());return!!r&&(isLocked(r)||Racks.isLocked(n,r))},free=sel.filter(n=>!shut(n));if(!free.length)return notify('Unlock it (or its layer, or its rack) first.');
  const units=free.every(Racks.isU),cur=free.length===1?free[0].type:'',used=[...new Set(S.doc.pages.flatMap(p=>p.items).filter(Racks.isArtUnit).map(n=>n.type))].map(type=>({type,name:Shapes.nameOf(type),tags:''}));
  // rack frames and the 0U items aren't something a shape can turn into
  const cats=Shapes.catalog().filter(c=>c.id!=='annotation').map(c=>c.id==='rack'?{...c,name:'Rack equipment',items:c.items.filter(i=>Shapes.rackItems[i.type]&&!Shapes.rackItems[i.type].mount)}:c).filter(c=>c.items.length&&(units||c.id!=='rack'));
  if(units&&used.length)cats.splice(cats.findIndex(c=>c.id==='rack')+1,0,{id:'_units',name:'Pictures in this drawing',items:used});
  const start=(units?cats.find(c=>c.id==='rack'):cats.find(c=>c.items.some(i=>i.type===cur)))||cats.find(c=>c.id==='doc-shapes')||cats[0],count=free.length,title=count===1?`Change “${html(Analysis.nameOf(free[0])||Shapes.nameOf(free[0].type))}”`:`Change ${count} shapes`;
  const d=openDialog(title,`<div class="chgHead"><input id="chgQ" type="search" placeholder="Search all shapes — fw, nvr, switch…" spellcheck="false" autocomplete="off"><select id="chgCat">${cats.map(c=>`<option value="${html(c.id)}"${c===start?' selected':''}>${html(c.name)}</option>`).join('')}</select></div><div class="palette chgGrid" id="chgGrid"></div><p class="muted" id="chgInfo"></p><p class="muted">${units?'It keeps its links, data and name, and stays in the same slot at the same height.':'It keeps its links, data and name, and stays where it is.'}</p>`,{wide:true,light:true,cls:'chgDlg'});
  const q=$('chgQ'),catSel=$('chgCat'),grid=$('chgGrid'),info=$('chgInfo');
  const cell=i=>`<button class="stencil${i.type===cur?' active':''}" data-chg="${html(i.type)}" title="${html(i.name)}">${Shapes.iconSvg(i.type,{size:40,display:'symbol',live:true})}<span>${html(i.name)}</span></button>`;
  const draw=()=>{const t=q.value.toLowerCase().trim(),seen=new Set(),list=(t?cats.flatMap(c=>c.items).filter(i=>(i.name+' '+i.type+' '+i.tags).toLowerCase().includes(t)):(cats.find(c=>c.id===catSel.value)||start).items).filter(i=>!seen.has(i.type)&&seen.add(i.type));
    grid.innerHTML=list.slice(0,CAP).map(cell).join('')||`<p class="muted">No shapes match “${html(t)}”.</p>`;grid.scrollTop=0;info.textContent=list.length>CAP?`Showing ${CAP} of ${list.length}: search to narrow it down.`:''};
  let timer=0;d.oninput=e=>{if(e.target!==q)return;clearTimeout(timer);timer=setTimeout(draw,120)};d.onchange=e=>{if(e.target!==catSel)return;q.value='';draw()};
  grid.onclick=e=>{const type=e.target.closest('[data-chg]')?.dataset.chg;if(type)pick(type,free)};draw();q.focus()}

function pick(type,free){closeDialog();const list=free.filter(n=>n.type!==type);if(!list.length)return notify('It already is that shape.',2200);let ut=null;
  // resolved first: a picture that can't be drawn refuses before anything changes
  if(list.some(Racks.isU))try{ut=unitType(type)}catch(err){return notify(err.message,5000)}
  const one=list.length===1?list[0]:null,was=one&&(Analysis.nameOf(one)||Shapes.nameOf(one.type)),hU=one&&Racks.isU(one)?Racks.heightU(one):0;
  mutate(()=>{for(const n of list)apply(n,type,items(),ut?.type);select(free.map(n=>n.id))});
  const r=one&&hU?Racks.rackOf(one,items()):null,at=r?`, still at ${Racks.span(Racks.uOf(r,one),hU)}`:'',big=ut?.u&&hU&&ut.u!==hU?` It is usually ${ut.u}U: drag its top handle to change that.`:'',what=Shapes.nameOf(ut?.type&&one&&hU?ut.type:type);
  notify((one?`${was} is now ${what}${at}. Links and data kept.`:`${list.length} shapes are now ${what}. Links and data kept.`)+big+` ${MODK}+Z undoes.`,big?6000:3600)}

const C0={center:n=>[n.x+n.w/2,n.y+n.h/2]};
return{can,apply,unitType,open};
})();
if(typeof module!=='undefined')module.exports=ChangeShape;
