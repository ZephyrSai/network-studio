// Selection, Visio-style: window selection takes only what it fully covers (Alt = touching), lasso, Alt-click to
// reach what is underneath, Tab / Shift+Tab to step through shapes, Select by type / layer, invert.
const Select=(()=>{
const selectable=n=>!!n&&itemVisible(n,{doc:S.doc})&&!layerOf(n)?.locked;
const geom=n=>C.bounds([n]);
const inside=(b,r)=>b.x>=r.x-.5&&b.y>=r.y-.5&&b.x+b.w<=r.x+r.w+.5&&b.y+b.h<=r.y+r.h+.5;
const touches=(b,r)=>b.x<r.x+r.w&&b.x+b.w>r.x&&b.y<r.y+r.h&&b.y+b.h>r.y;
// Groups count only when every member qualifies — unless selecting by touch.
function pick(test,touch){const all=items().filter(selectable),hit=new Set(all.filter(test).map(n=>n.id)),out=new Set();
  for(const n of all){if(!hit.has(n.id))continue;if(n.group){const mem=items().filter(t=>t.group===n.group&&selectable(t));if(touch||mem.every(t=>hit.has(t.id)))mem.forEach(t=>out.add(t.id))}else out.add(n.id)}return out}
const windowSelect=(r,touch)=>pick(n=>touch?touches(geom(n),r):inside(geom(n),r),touch);
function pip([x,y],poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c}return c}
const corners=n=>{if(n.kind==='edge')return n.points;const b=geom(n);return[[b.x,b.y],[b.x+b.w,b.y],[b.x,b.y+b.h],[b.x+b.w,b.y+b.h]]};
const lassoSelect=(poly,touch)=>poly.length<3?new Set():pick(n=>touch?corners(n).some(q=>pip(q,poly)):corners(n).every(q=>pip(q,poly)),touch);

function describe(n){if(!n)return'';const name=n.kind==='edge'?'connector':n.kind==='node'?(Revisions.MARKUP.has(n.type)?Shapes.basic[n.type]?.name.toLowerCase():Shapes.nameOf(n.type)):n.kind;const t=n.labels?.[0]?.text?.trim();return t&&n.kind!=='edge'?`${name} “${t.split('\n')[0]}”`:name}
// Everything selectable under a screen point, top-most first.
function stackAt(cx,cy){const ids=[];for(const el of document.elementsFromPoint(cx,cy)){const id=el.closest?.('[data-id]')?.dataset.id;if(id&&!ids.includes(id)&&selectable(find(id)))ids.push(id)}return ids}
// prev: the selection before the click (the press itself may already have selected the top item)
function cycleAt(cx,cy,prev=[...S.selected]){const ids=stackAt(cx,cy);if(!ids.length)return false;const cur=prev.length===1?prev[0]:null,next=ids[(ids.indexOf(cur)+1)%ids.length];
  select([next]);notify(`Selected ${describe(find(next))}${ids.length>1?` · ${ids.length} items here — ${ALTK}-click again for the next one`:''}.`,2200);return true}
// Tab order: reading order (top to bottom, then left to right).
function tab(back){const list=items().filter(n=>selectable(n)&&!n.pin).map(n=>({n,c:C.center(n.kind==='edge'?{...geom(n),kind:'zone'}:n)})).sort((a,b)=>Math.abs(a.c[1]-b.c[1])>24?a.c[1]-b.c[1]:a.c[0]-b.c[0]).map(x=>x.n);if(!list.length)return;
  const cur=[...S.selected].at(-1),i=list.findIndex(n=>n.id===cur),next=list[(i<0?(back?list.length-1:0):i+(back?-1:1)+list.length)%list.length];select([next.id]);notify(`${describe(next)} · Tab / Shift+Tab steps through shapes`,1500)}
function invert(){const cur=S.selected;select(items().filter(n=>selectable(n)&&!n.pin&&!cur.has(n.id)).map(n=>n.id));notify(`${S.selected.size} selected.`,1400)}
function all(){select(items().filter(n=>selectable(n)).map(n=>n.id));notify(`${S.selected.size} selected.`,1400)}

// Select by type / layer (like Visio's Select by Type).
function openByType(){const list=items().filter(n=>selectable(n)&&!n.pin),groups=new Map();
  const add=(key,label,n,sec)=>{if(!groups.has(key))groups.set(key,{label,sec,ids:[]});groups.get(key).ids.push(n.id)};
  for(const n of list){if(n.kind==='node'&&Revisions.MARKUP.has(n.type))add('m:'+n.type,Shapes.basic[n.type].name,n,'Revision markup');else if(n.kind==='node'&&Shapes.isDevice(n))add('d:'+n.type,Shapes.nameOf(n.type),n,'Devices');else if(n.kind==='node')add('s:'+n.type,Shapes.basic[n.type]?.name||(Shapes.rackItems[n.type]?.name)||Shapes.nameOf(n.type),n,'Shapes & racks');
    else if(n.kind==='edge')add('l:'+(n.linkType||'_'),Shapes.linkTypes[n.linkType]?.name||'Connector',n,'Connectors');else add('k:'+n.kind,{zone:'Zones',text:'Text & callouts',table:'Tables',legend:'Legends'}[n.kind]||n.kind,n,'Other')}
  const secs=['Devices','Connectors','Shapes & racks','Other','Revision markup'],layers=S.doc.layers.map(l=>({l,ids:list.filter(n=>(n.layer||S.doc.layers[0].id)===l.id).map(n=>n.id)})).filter(x=>x.ids.length);
  const d=openDialog('Select by type',`<p class="muted">Tick what to select on this page. Combine types, or pick whole layers.</p><div class="byType">${secs.filter(s=>[...groups.values()].some(g=>g.sec===s)).map(s=>`<div><h4 class="tplHead">${s} <label class="allSec"><input type="checkbox" data-bt-sec="${s}"> all</label></h4>${[...groups].filter(([,g])=>g.sec===s).sort((a,b)=>a[1].label.localeCompare(b[1].label)).map(([k,g])=>`<label class="check"><input type="checkbox" data-bt="${html(k)}" data-sec="${s}">${html(g.label)} <em class="muted">${g.ids.length}</em></label>`).join('')}</div>`).join('')}
    ${layers.length>1?`<div><h4 class="tplHead">Layers</h4>${layers.map(x=>`<label class="check"><input type="checkbox" data-bl="${x.l.id}">${html(x.l.name)} <em class="muted">${x.ids.length}</em></label>`).join('')}</div>`:''}</div>
    <label class="check"><input type="checkbox" id="btAdd">Add to the current selection</label><p class="fitResult" id="btCount">Nothing ticked.</p>
    <footer><button data-close>Cancel</button><button class="primary" data-bt-go>Select</button></footer>`,{wide:true});
  const chosen=()=>{const ids=new Set($('btAdd').checked?S.selected:[]);d.querySelectorAll('[data-bt]:checked').forEach(c=>groups.get(c.dataset.bt).ids.forEach(i=>ids.add(i)));d.querySelectorAll('[data-bl]:checked').forEach(c=>layers.find(x=>x.l.id===c.dataset.bl).ids.forEach(i=>ids.add(i)));return ids};
  d.onchange=e=>{const s=e.target.dataset.btSec;if(s)d.querySelectorAll(`[data-sec="${s}"]`).forEach(c=>c.checked=e.target.checked);$('btCount').textContent=`${chosen().size} item(s) will be selected.`};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();if(!e.target.closest('[data-bt-go]'))return;const ids=chosen();closeDialog();select([...ids]);notify(`${ids.size} selected — right-click to change them all.`,2200)}}

return{windowSelect,lassoSelect,stackAt,cycleAt,tab,invert,all,openByType,describe,selectable,inside,touches,pip};
})();
