// Inventory: pick and order the columns you need (any device field, custom fields, zone, subnet, rack/U, links…),
// one row per device or counted like a BOM, edit values in place, export for Excel or place on a page.
// Fields can also be switched on under the device labels from here (eye toggle) or from the right-click menu.
const Inventory=(()=>{
const DEFAULT=['name','type','f:hostname','f:ip','f:model','f:vendor','f:serial','f:os','f:location','zone','page'];
const fieldLabel=k=>S.doc.fields.find(f=>f.key===k)?.label||k;
const devicesIn=scope=>{const pages=scope==='page'?[pg()]:S.doc.pages.filter(p=>!p.isBackground),sel=scope==='selection'?new Set(S.selected):null,out=[];
  for(const p of pages)for(const n of p.items)if(n.kind==='node'&&Shapes.isDevice(n)&&(!sel||sel.has(n.id)))out.push({p,n});return out};
// Every column on offer: computed ones, the document's fields, then data keys found on devices that are not fields yet.
function catalog(){const zone=(n,p)=>Analysis.zoneOf(n,p),cols=[
  {id:'name',label:'Name',get:(n,p)=>Analysis.nameOf(n),edit:'name'},{id:'type',label:'Type',get:n=>Shapes.nameOf(n.type)},
  {id:'category',label:'Category',get:n=>{const c=Stencils.shapes[n.type]?.cat;return Shapes.catalog().find(x=>x.id===c)?.name||c||''}},
  {id:'zone',label:'Zone',get:(n,p)=>Analysis.zoneName(zone(n,p))},{id:'subnet',label:'Zone subnet',get:(n,p)=>zone(n,p)?.data?.subnet||''},
  {id:'page',label:'Page',get:(n,p)=>p.name},{id:'layer',label:'Layer',get:n=>S.doc.layers.find(l=>l.id===n.layer)?.name||''},
  {id:'rack',label:'Rack / U',get:(n,p)=>{const r=p.items.find(x=>x.type==='rack'&&C.inside({x:n.x+1,y:n.y+1,w:0,h:0},Shapes.rackInner(x)));return r?Analysis.nameOf(r)+' / U'+Shapes.rackU(r,n):''}},
  {id:'links',label:'Links',get:(n,p)=>p.items.filter(e=>e.kind==='edge'&&(e.from?.node===n.id||e.to?.node===n.id)).length},
  {id:'peers',label:'Connected to',get:(n,p)=>p.items.filter(e=>e.kind==='edge'&&(e.from?.node===n.id||e.to?.node===n.id)).map(e=>{const o=p.items.find(x=>x.id===(e.from?.node===n.id?e.to?.node:e.from?.node));return o?Analysis.nameOf(o):''}).filter(Boolean).join(', ')}];
  for(const f of S.doc.fields)if(f.key!=='notes'||true)cols.push({id:'f:'+f.key,label:f.label,get:n=>n.data?.[f.key]??'',edit:f.key,field:f});
  const known=new Set(S.doc.fields.map(f=>f.key));for(const p of S.doc.pages)for(const n of p.items)if(n.kind==='node')for(const k of Object.keys(n.data||{}))if(!known.has(k)){known.add(k);cols.push({id:'f:'+k,label:k+' (custom)',get:x=>x.data?.[k]??'',edit:k,custom:true})}
  return cols}
// Columns that are unique per device make no sense when counting identical rows.
const UNIQUE=new Set(['name','f:hostname','f:ip','f:mgmtIp','f:serial','f:mac','peers','links','rack','f:notes']);
function build(cfg){const cat=catalog();let cols=cfg.cols.map(id=>cat.find(c=>c.id===id)).filter(Boolean);if(cfg.group==='bom'){cols=cols.filter(c=>!UNIQUE.has(c.id));if(!cols.length)cols=[cat.find(c=>c.id==='type')]}const rows=devicesIn(cfg.scope).map(({p,n})=>({n,p,vals:cols.map(c=>String(c.get(n,p)??''))}));
  const q=(cfg.filter||'').toLowerCase().trim(),flt=q?rows.filter(r=>r.vals.some(v=>v.toLowerCase().includes(q))):rows,si=cols.findIndex(c=>c.id===cfg.sort);
  if(si>=0)flt.sort((a,b)=>a.vals[si].localeCompare(b.vals[si],undefined,{numeric:true}));
  if(cfg.group==='bom'){const m=new Map();for(const r of flt){const k=r.vals.join('\u0001');if(!m.has(k))m.set(k,{vals:r.vals,qty:0});m.get(k).qty++}
    return{cols,columns:[...cols.map(c=>c.label),'Qty'],rows:[...m.values()].map(g=>[...g.vals,g.qty]),items:null}}
  return{cols,columns:cols.map(c=>c.label),rows:flt.map(r=>r.vals),items:flt}}
const report=(cfg,b=build(cfg))=>({title:cfg.group==='bom'?'Inventory (counted)':'Inventory',columns:b.columns,rows:b.rows});

// Which fields show under a device's label: the document-wide ones plus the device's own.
const shown=n=>[...new Set([...(S.doc.display?.fields||[]),...(n.showFields||[])])];
function showOn(keys,on,targets){mutate(()=>{for(const n of targets){const s=new Set(n.showFields||[]);for(const k of keys)on?s.add(k):s.delete(k);if(s.size)n.showFields=[...s];else delete n.showFields}})}

function open(){const saved=S.doc.inventory||{},cfg={cols:saved.cols?.length?[...saved.cols]:[...DEFAULT],scope:S.selected.size?'selection':saved.scope||'doc',group:saved.group||'device',sort:saved.sort||'name',filter:''},edits=new Map();
  const d=openDialog('Inventory',`<div class="invGrid"><aside class="invCols"><div class="fld"><span>Columns — tick, then order with ↑ ↓; 👁 shows a field on the drawing</span></div><div id="invColList"></div>
      <div class="row"><input id="invNewField" placeholder="New field, e.g. Warranty"><button data-inv-addfield>＋ Add</button></div></aside>
    <section><div class="row r3"><label class="fld"><span>Devices</span><select id="invScope"><option value="doc">Whole drawing</option><option value="page">This page</option><option value="selection">Selected devices</option></select></label>
      <label class="fld"><span>Rows</span><select id="invGroup"><option value="device">One per device (editable)</option><option value="bom">Count identical rows (BOM)</option></select></label>
      <label class="fld"><span>Sort by</span><select id="invSort"></select></label></div>
      <input id="invFilter" placeholder="Filter rows…" autocomplete="off"><p class="muted" id="invInfo"></p><div class="tableWrap invWrap" id="invTable"></div></section></div>
    <footer><button data-inv="apply" id="invApply" disabled>Apply edits</button><span class="spacer"></span><button data-inv="copy">Copy for Excel</button><button data-inv="csv">Download CSV</button><button data-inv="page">Insert on this page</button><button class="primary" data-inv="newpage">Insert on a new page</button></footer>`,{wide:true,cls:'inventory'});
  $('invScope').value=cfg.scope;$('invGroup').value=cfg.group;
  const drawCols=()=>{const cat=catalog(),order=[...cfg.cols.map(id=>cat.find(c=>c.id===id)).filter(Boolean),...cat.filter(c=>!cfg.cols.includes(c.id))],tgt=targets(),vis=k=>tgt.length&&tgt.every(n=>shown(n).includes(k));
    $('invColList').innerHTML=order.map(c=>{const on=cfg.cols.includes(c.id),k=c.edit&&c.id.startsWith('f:')?c.edit:null;return`<div class="invCol ${on?'on':''}"><label><input type="checkbox" data-inv-col="${c.id}" ${on?'checked':''}>${html(c.label)}</label>${on?`<button data-inv-up="${c.id}" title="Move up">↑</button><button data-inv-down="${c.id}" title="Move down">↓</button>`:''}${k?`<button data-inv-eye="${html(k)}" class="eye ${vis(k)?'on':''}" title="Show ${html(c.label)} on the drawing for ${tgt.length===1?'this device':`these ${tgt.length} devices`}">👁</button>`:''}</div>`}).join('');
    $('invSort').innerHTML=cfg.cols.map(id=>{const c=cat.find(x=>x.id===id);return c?`<option value="${id}" ${cfg.sort===id?'selected':''}>${html(c.label)}</option>`:''}).join('')};
  const targets=()=>devicesIn(cfg.scope).map(x=>x.n);
  const drawTable=()=>{const b=build(cfg),max=400,ed=cfg.group==='device';
    $('invInfo').textContent=`${b.rows.length} row${b.rows.length===1?'':'s'}${ed?' · click a cell to edit; Apply edits writes them to the drawing':' · per-device columns (name, hostname, IP, serial…) are left out when counting'}`;
    $('invTable').innerHTML=`<table class="report"><thead><tr>${b.columns.map(c=>`<th>${html(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.slice(0,max).map((r,i)=>`<tr>${r.map((v,j)=>{const col=b.cols[j],it=ed&&b.items?.[i];if(it&&col?.edit){const key=it.n.id+'|'+col.edit,val=edits.has(key)?edits.get(key):v;return`<td><input class="invCell ${edits.has(key)?'dirty':''}" data-inv-cell="${html(key)}" value="${html(val)}"></td>`}return`<td>${html(v)}</td>`}).join('')}</tr>`).join('')}</tbody></table>${b.rows.length>max?`<p class="muted">…and ${b.rows.length-max} more rows in the download.</p>`:''}`;
    $('invApply').disabled=!edits.size;$('invApply').textContent=edits.size?`Apply ${edits.size} edit${edits.size>1?'s':''}`:'Apply edits'};
  const remember=()=>{S.doc.inventory={cols:[...cfg.cols],scope:cfg.scope==='selection'?'doc':cfg.scope,group:cfg.group,sort:cfg.sort}};
  const redraw=()=>{drawCols();drawTable()};redraw();
  d.oninput=e=>{const t=e.target;if(t.id==='invFilter'){cfg.filter=t.value;drawTable();return}if(t.dataset.invCell){edits.set(t.dataset.invCell,t.value);t.classList.add('dirty');$('invApply').disabled=false;$('invApply').textContent=`Apply ${edits.size} edit${edits.size>1?'s':''}`}};
  d.onchange=e=>{const t=e.target;if(t.dataset.invCol){const id=t.dataset.invCol;if(t.checked){if(!cfg.cols.includes(id))cfg.cols.push(id)}else cfg.cols=cfg.cols.filter(x=>x!==id);redraw();return}
    if(t.id==='invScope'){cfg.scope=t.value;redraw()}else if(t.id==='invGroup'){cfg.group=t.value;drawTable()}else if(t.id==='invSort'){cfg.sort=t.value;drawTable()}};
  d.onclick=e=>{const t=e.target;if(t.closest('[data-close]')){remember();return closeDialog()}
    const up=t.closest('[data-inv-up]'),dn=t.closest('[data-inv-down]');if(up||dn){const id=(up||dn).dataset[up?'invUp':'invDown'],i=cfg.cols.indexOf(id),j=i+(up?-1:1);if(i>=0&&j>=0&&j<cfg.cols.length){[cfg.cols[i],cfg.cols[j]]=[cfg.cols[j],cfg.cols[i]];redraw()}return}
    const eye=t.closest('[data-inv-eye]');if(eye){const k=eye.dataset.invEye,tg=targets();if(!tg.length)return notify('No devices in this scope.');const on=!tg.every(n=>shown(n).includes(k));showOn([k],on,tg);drawCols();notify(`${fieldLabel(k)} ${on?'shown':'hidden'} for ${tg.length} device${tg.length>1?'s':''}.`,2200);return}
    if(t.closest('[data-inv-addfield]')){const v=$('invNewField').value.trim();if(!v)return;const key=v.toLowerCase().replace(/[^\w]+/g,'_').replace(/^_|_$/g,'');if(!key)return;if(!S.doc.fields.some(f=>f.key===key))mutate(()=>S.doc.fields.push({key,label:v}));if(!cfg.cols.includes('f:'+key))cfg.cols.push('f:'+key);$('invNewField').value='';redraw();return}
    const a=t.closest('[data-inv]')?.dataset.inv;if(!a)return;
    if(a==='apply'){const byId=new Map(S.doc.pages.flatMap(p=>p.items).map(n=>[n.id,n]));mutate(()=>{for(const[key,v]of edits){const[id,f]=key.split('|'),n=byId.get(id);if(!n)continue;if(f==='name'){if(n.labels?.[0])n.labels[0].text=v;continue}const def=S.doc.fields.find(x=>x.key===f);n.data??={};if(v===''){delete n.data[f];continue}n.data[f]=def?.type==='number'&&v.trim()!==''&&!isNaN(+v)?+v:v}});notify(`Applied ${edits.size} edit${edits.size>1?'s':''}.`);edits.clear();drawTable();return}
    remember();const r=report(cfg);if(a==='csv')download(safeName(S.doc.name+' - inventory')+'.csv','﻿'+Analysis.toCSV(r),'text/csv');if(a==='copy')navigator.clipboard.writeText(Analysis.toTSV(r)).then(()=>notify('Copied — paste into Excel.'));if(a==='page'||a==='newpage'){closeDialog();insertReportTable(r,a==='newpage')}}}

// Show / hide fields under selected devices (or every device when nothing is selected).
function openShow(){const sel=picked().filter(n=>n.kind==='node'&&Shapes.isDevice(n)),tg=sel.length?sel:S.doc.pages.flatMap(p=>p.items).filter(n=>n.kind==='node'&&Shapes.isDevice(n));if(!tg.length)return notify('There are no devices to label.');
  const keys=[...S.doc.fields.filter(f=>f.key!=='notes').map(f=>f.key),...new Set(tg.flatMap(n=>Object.keys(n.data||{})).filter(k=>!S.doc.fields.some(f=>f.key===k)))];
  const d=openDialog('Show on drawing',`<p class="muted">Values appear under the label of <b>${sel.length?`the ${sel.length} selected device${sel.length>1?'s':''}`:'every device'}</b>${sel.length?'':' — select devices first to show a field only for them'}. Devices without a value show nothing.</p>
    <div class="checks cols2">${keys.map(k=>{const all=tg.every(n=>shown(n).includes(k)),some=!all&&tg.some(n=>shown(n).includes(k)),filled=tg.filter(n=>String(n.data?.[k]??'').trim()).length;return`<label class="check"><input type="checkbox" data-show="${html(k)}" ${all?'checked':''} ${some?'data-some="1"':''}>${html(fieldLabel(k))} <em class="muted">${filled}/${tg.length}</em></label>`}).join('')}</div>
    <label class="check"><input type="checkbox" id="showNames" ${S.doc.display?.prefixFields?'checked':''}>Show field names too (e.g. “OS / firmware: IOS-XE 17.9”)</label>
    <footer><button data-close>Close</button></footer>`);
  d.querySelectorAll('[data-some]').forEach(i=>i.indeterminate=true);
  d.onchange=e=>{const t=e.target;if(t.dataset.show){showOn([t.dataset.show],t.checked,tg);return}if(t.id==='showNames')mutate(()=>{S.doc.display.prefixFields=t.checked})};
  d.onclick=e=>{if(e.target.closest('[data-close]'))closeDialog()}}

return{open,openShow,build,catalog,shown,showOn,report,DEFAULT};
})();
