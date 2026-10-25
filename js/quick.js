// Quick configuration and revisions UI:
//  • right-click styling of whole selections (link type, line colour/width/style, arrows, device colour, size, zone colour, text size…)
//  • restyle from the legend: double-click a legend row → every link / device of that type changes (and new ones follow)
//  • Scale… a selection or the whole page (Scale engine in scale.js)
//  • revisions: New revision dialog, clouds and deltas, prompt / auto-bump on save, status-bar indicator
const Quick=(()=>{
const COLORS=['#2f5ea8','#0e7490','#0891b2','#16a34a','#65a30d','#ca8a04','#ea580c','#dc2626','#db2777','#7c3aed','#475569','#111827'];
const FILLS=['#ffffff','#eef4fc','#eef6f4','#fff4e9','#fdf2f8','#f2f3fb','#fef9c3','#f1f5f9','none'];
const DASH=[['','Solid'],['8 5','Dashed'],['2 4','Dotted'],['10 4 2 4','Dash-dot'],['14 6','Long dash']];
const WIDTHS=[1,1.5,2,3,4,6],SIZES=[9,10.5,12,14,18,24];
const sub=(label,body)=>`<div class="sub"><button>${label} ▸</button><div class="submenu">${body}</div></div>`;
const swGrid=(prefix,list)=>`<div class="swGrid">${list.map(c=>`<button data-ctx="${prefix}${c}" title="${c==='none'?'No fill':c}" class="${c==='none'?'none':''}" style="--c:${c==='none'?'transparent':c}"></button>`).join('')}<label class="swPick" title="Custom colour…"><input type="color" data-ctx-color="${prefix}"></label></div>`;
const plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const isMarkup=n=>Revisions.MARKUP.has(n.type);

// ---------- right-click quick configure ----------
function menu(sel){const edges=sel.filter(x=>x.kind==='edge'),nodes=sel.filter(x=>x.kind==='node'&&!isMarkup(x)&&x.type!=='rack'&&!Shapes.rackItems[x.type]),devs=nodes.filter(x=>Shapes.isDevice(x)),zones=sel.filter(x=>x.kind==='zone'),texty=sel.filter(x=>x.labels?.length||x.kind==='table');let h='';
  if(sel.length>1){const parts=[[devs.length,'device'],[nodes.length-devs.length,'shape'],[edges.length,'connector'],[zones.length,'zone'],[sel.length-nodes.length-edges.length-zones.length,'other']].filter(([n])=>n>0).map(([n,w])=>plural(n,w));h+=`<div class="ctxHead">${parts.join(' · ')}</div>`}
  if(edges.length){const cur=new Set(edges.map(e=>e.linkType));
    h+=sub('Link type',Object.entries(Shapes.linkTypes).map(([k,v])=>`<button data-ctx="lt:${k}"><span class="sw" style="background:${S.doc.linkStyles?.[k]?.stroke||v.stroke}"></span>${v.name}${cur.size===1&&cur.has(k)?' ✓':''}</button>`).join(''))
      +sub('Routing',[['auto','Auto-route'],['hv','Right angle · H'],['vh','Right angle · V'],['straight','Straight'],['free','Free']].map(([k,v])=>`<button data-ctx="rt:${k}">${v}</button>`).join(''))
      +sub('Line colour',swGrid('q:lc:',COLORS))+sub('Line width',WIDTHS.map(w=>`<button data-ctx="q:lw:${w}"><span class="lnw" style="height:${w}px"></span>${w} px</button>`).join(''))
      +sub('Line style',DASH.map(([d,n])=>`<button data-ctx="q:ld:${d}"><span class="lns" style="border-top-style:${d===''?'solid':d==='2 4'?'dotted':'dashed'}"></span>${n}</button>`).join(''))
      +sub('Arrows',[['none','None'],['end','At the end'],['start','At the start'],['both','Both ends']].map(([k,v])=>`<button data-ctx="q:ar:${k}">${v}</button>`).join(''))}
  if(devs.length)h+=sub('Display',['symbol','card','tile','circle'].map(v=>`<button data-ctx="disp:${v}">${v[0].toUpperCase()+v.slice(1)}</button>`).join(''))+sub('Status',['Existing','New','Planned','To remove','Spare',''].map(v=>`<button data-ctx="st:${v}"><span class="sw" style="background:${Shapes.STATUS[v]||'#fff'}"></span>${v||'(clear)'}</button>`).join(''));
  if(devs.length){const keys=[...S.doc.fields.filter(f=>f.key!=='notes').map(f=>[f.key,f.label]),...[...new Set(devs.flatMap(n=>Object.keys(n.data||{})))].filter(k=>!S.doc.fields.some(f=>f.key===k)).map(k=>[k,k])],on=k=>devs.every(n=>Inventory.shown(n).includes(k));
    h+=sub('Show on drawing',keys.map(([k,l])=>`<button data-ctx="q:sf:${html(k)}">${on(k)?'✓ ':'<span class="ck"></span>'}${html(l)} <em>${devs.filter(n=>String(n.data?.[k]??'').trim()).length}/${devs.length}</em></button>`).join('')+`<hr><button data-ctx="q:sf:_names">${S.doc.display?.prefixFields?'✓ ':''}Show field names</button><button data-ctx="q:sf:_none">Hide all fields on these</button><button data-action="repInventory">Inventory…</button>`)}
  if(nodes.length)h+=sub(devs.length?'Device colour':'Line colour',swGrid('q:nc:',COLORS))+sub('Fill',swGrid('q:nf:',FILLS))+sub('Size',[['0.8','Smaller (−20%)'],['0.9','Smaller (−10%)'],['1.1','Larger (+10%)'],['1.25','Larger (+25%)'],['reset','Default size']].map(([k,v])=>`<button data-ctx="q:sz:${k}">${v}</button>`).join(''));
  if(zones.length){const T=Shapes.themes[S.doc.theme]||Shapes.themes.port;h+=sub('Zone colour',`<div class="swGrid">${[...T.zones,...Shapes.themes.port.zones,['#fef2f2','#fca5a5'],['#f0fdf4','#86efac'],['#fefce8','#fde047'],['#f8fafc','#94a3b8']].map(([f,s])=>`<button data-ctx="q:zc:${f},${s}" style="--c:${f};box-shadow:inset 0 0 0 2px ${s}" title="${f}"></button>`).join('')}</div>`)+sub('Zone style',[['plain','Plain'],['header','Header band'],['tab','Tab'],['outline','Outline only']].map(([k,v])=>`<button data-ctx="q:zs:${k}">${v}</button>`).join(''))}
  if(texty.length)h+=sub('Text size',`<button data-ctx="q:ts:-">Smaller</button><button data-ctx="q:ts:+">Larger</button><hr>`+SIZES.map(s=>`<button data-ctx="q:ts:${s}">${s} pt</button>`).join(''));
  const one=sel[0],sim=[];if(one.kind==='edge')sim.push(['lt','Same link type']);if(one.kind==='node')sim.push(['type','Same type ('+html(Shapes.nameOf(one.type))+')']);sim.push(['style','Same colour and style'],['layer','Same layer']);
  h+=sub('Select similar',sim.map(([k,v])=>`<button data-ctx="q:sim:${k}">${v}</button>`).join(''))+`<button data-ctx="q:scale">Scale…</button>`;
  return h}
function setColor(prefix,v){apply(prefix+v)}
function apply(c){const[,op,...rest]=c.split(':'),v=rest.join(':');
  if(op==='scale'){openScale();return true}if(op==='sim'){selectSimilar(v);return true}
  if(op==='sf'){const devs=picked().filter(n=>n.kind==='node'&&Shapes.isDevice(n));if(v==='_names'){mutate(()=>{S.doc.display.prefixFields=!S.doc.display.prefixFields});return true}if(v==='_none'){mutate(()=>devs.forEach(n=>delete n.showFields));return true}
    const on=!devs.every(n=>Inventory.shown(n).includes(v));Inventory.showOn([v],on,devs);const miss=devs.filter(n=>!String(n.data?.[v]??'').trim()).length;notify(`${S.doc.fields.find(f=>f.key===v)?.label||v} ${on?'shown':'hidden'} for ${plural(devs.length,'device')}${on&&miss?` — ${miss} have no value yet (fill them in Data ▸ Inventory)`:''}.`,3500);return true}
  if(!ensureEditable())return true;const ed=editable();let reroute=[];
  mutate(()=>{for(const n of ed){
    if(n.kind==='edge'){if(op==='lc')n.stroke=v;else if(op==='lw')n.strokeWidth=+v;else if(op==='ld')n.dash=v;else if(op==='ar'){n.startMarker=v==='start'||v==='both'?'arrow':'none';n.endMarker=v==='end'||v==='both'?'arrow':'none'}}
    if(n.kind==='node'&&!isMarkup(n)){if(op==='nc')n.stroke=v;else if(op==='nf')n.fill=v;else if(op==='sz'&&n.type!=='rack'&&!Shapes.rackItems[n.type]){const k=v==='reset'?(Shapes.make(n.type,0,0).w/n.w):+v;if(k>0&&Math.abs(k-1)>.001)reroute.push(...Scale.apply([n],items(),k,{origin:C.center(n)}).reroute)}}
    if(n.kind==='zone'){if(op==='zc'){const[f,s]=v.split(',');n.fill=f;n.stroke=s}else if(op==='zs')n.style=v}
    if(op==='ts'){const fit=s=>Math.max(5,Math.min(72,v==='+'?s*1.15:v==='-'?s/1.15:+v));for(const l of n.labels||[])l.size=+fit(l.size).toFixed(1);if(n.kind==='table'){n.size=+fit(n.size).toFixed(1);tableLayout(n)}}}
    for(const id of reroute)Conn.markDirty(id)});return true}
function selectSimilar(v){const one=picked()[0];if(!one)return;const same=n=>v==='lt'?n.kind==='edge'&&n.linkType===one.linkType:v==='type'?n.kind==='node'&&n.type===one.type:v==='layer'?(n.layer||'')===(one.layer||''):n.kind===one.kind&&n.stroke===one.stroke&&(n.dash||'')===(one.dash||'')&&(n.kind!=='node'||n.type===one.type||!Shapes.isDevice(n));
  const ids=items().filter(n=>same(n)&&!isLocked(n)).map(n=>n.id);select(ids);notify(`Selected ${ids.length} similar item${ids.length===1?'':'s'} — right-click to change them all.`,2600)}

// ---------- legend rows: restyle a whole type ----------
function rowOf(legendId,key){const lg=items().find(n=>n.id===legendId)||S.doc.pages.flatMap(p=>p.items).find(n=>n.id===legendId);if(!lg)return null;const page=S.doc.pages.find(p=>p.items.includes(lg))||pg();
  return legendRows(lg,page,makeCtx(page,{doc:S.doc})).find(r=>r.key===key)||null}
function openLegendStyle(legendId,key){const r=rowOf(legendId,key);if(!r)return;const[kind]=key.split(':');
  if(kind==='mark')return notify('Planned / to-remove marks come from each device’s Status — right-click devices ▸ Status.');
  const opt=(v,t,cur)=>`<option value="${v}" ${String(cur)===String(v)?'selected':''}>${t}</option>`;let body='',title='',scopeNote='';
  const colorRow=(cur)=>`<div class="fld"><span>Colour</span><div class="swGrid big">${COLORS.map(c=>`<button data-ls-color="${c}" class="${c===cur?'on':''}" style="--c:${c}" title="${c}"></button>`).join('')}<label class="swPick" title="Custom colour…"><input type="color" id="lsColor" value="${/^#[0-9a-f]{6}$/i.test(cur)?cur:'#2f5ea8'}"></label></div></div>`;
  if(kind==='link'){const e=r.edge,type=e.linkType&&Shapes.linkTypes[e.linkType]?e.linkType:null,all=S.doc.pages.flatMap(p=>p.items.filter(x=>x.kind==='edge'&&(type?x.linkType===type:x.stroke===e.stroke&&(x.dash||'')===(e.dash||''))));
    title=`Legend · ${html(r.text)}`;scopeNote=`${plural(all.length,'link')} of this type in the drawing`;
    body=`<label class="fld"><span>Legend text</span><input id="lsText" value="${html(r.text)}"></label>${colorRow(e.stroke)}
    <div class="row"><label class="fld"><span>Width</span><select id="lsWidth">${[...new Set([...WIDTHS,e.strokeWidth||2])].sort((a,b)=>a-b).map(w=>opt(w,w+' px',e.strokeWidth||2)).join('')}</select></label><label class="fld"><span>Line style</span><select id="lsDash">${(DASH.some(([d])=>d===(e.dash||''))?DASH:[...DASH,[e.dash,'Current ('+e.dash+')']]).map(([d,n])=>opt(d,n,e.dash||'')).join('')}</select></label></div>
    <label class="check"><input type="checkbox" id="lsDouble" ${e.double?'checked':''}>Double line (trunk / bundle)</label>`}
  else if(kind==='device'){const s=r.sample,all=S.doc.pages.flatMap(p=>p.items.filter(x=>x.kind==='node'&&x.type===r.type));title=`Legend · ${html(r.text)}`;scopeNote=`${plural(all.length,'device')} of this type in the drawing`;
    body=`<label class="fld"><span>Legend text</span><input id="lsText" value="${html(r.text)}"></label>${colorRow(s?.stroke||'#2f5ea8')}<label class="fld"><span>Display</span><select id="lsDisplay">${['symbol','card','tile','circle'].map(v=>opt(v,v[0].toUpperCase()+v.slice(1),s?.display||'symbol')).join('')}</select></label>`}
  else if(kind==='zone'){const z=r.zone;title=`Legend · ${html(r.text)}`;scopeNote='this zone';const T=Shapes.themes[S.doc.theme]||Shapes.themes.port;
    body=`<label class="fld"><span>Zone name</span><input id="lsText" value="${html(z.labels?.[0]?.text||'')}"></label><div class="fld"><span>Colour</span><div class="swGrid big">${[...T.zones,['#fef2f2','#fca5a5'],['#f0fdf4','#86efac'],['#fefce8','#fde047']].map(([f,s])=>`<button data-ls-zone="${f},${s}" style="--c:${f};box-shadow:inset 0 0 0 2px ${s}" class="${f===z.fill?'on':''}"></button>`).join('')}</div></div>`}
  else if(kind==='swatch'){const[ck,...vv]=key.slice(7).split('='),val=vv.join('=');title=`Legend · ${html(r.text)}`;scopeNote=ck==='vlan'?`VLAN ${html(val)} in the VLAN registry`:`devices where ${html(ck)} = ${html(val)}`;body=colorRow(r.color)}
  const scoped=kind==='link'||kind==='device';
  const d=openDialog(title,`<p class="muted">Changes apply to <b>${scopeNote}</b>${scoped?' — and to new ones you add':''}. The legend follows.</p>${body}${scoped?`<div class="fld"><span>Apply to</span><select id="lsScope">${opt('doc','Every page')}${opt('page','This page only')}</select></div>`:''}
    <footer>${scoped?'<button data-ls-select>Select them</button>':''}<span class="spacer"></span><button data-close>Cancel</button><button class="primary" data-ls-go>Apply</button></footer>`);
  let color=kind==='link'?r.edge.stroke:kind==='device'?(r.sample?.stroke||'#2f5ea8'):kind==='swatch'?r.color:null,zone=kind==='zone'?[r.zone.fill,r.zone.stroke]:null;
  d.oninput=e=>{if(e.target.id==='lsColor'){color=e.target.value;d.querySelectorAll('[data-ls-color]').forEach(b=>b.classList.remove('on'))}};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const c=e.target.closest('[data-ls-color]');if(c){color=c.dataset.lsColor;d.querySelectorAll('[data-ls-color]').forEach(b=>b.classList.toggle('on',b===c));return}
    const z=e.target.closest('[data-ls-zone]');if(z){zone=z.dataset.lsZone.split(',');d.querySelectorAll('[data-ls-zone]').forEach(b=>b.classList.toggle('on',b===z));return}
    const scopeItems=()=>{const pages=$('lsScope')?.value==='page'?[pg()]:S.doc.pages;return pages.flatMap(p=>p.items)};
    const match=kind==='link'?(()=>{const e0=r.edge,type=e0.linkType&&Shapes.linkTypes[e0.linkType]?e0.linkType:null;return x=>x.kind==='edge'&&(type?x.linkType===type:x.stroke===e0.stroke&&(x.dash||'')===(e0.dash||''))})():kind==='device'?(x=>x.kind==='node'&&x.type===r.type):null;
    if(e.target.closest('[data-ls-select]')){closeDialog();select(items().filter(match).map(x=>x.id));notify(`Selected ${S.selected.size} on this page.`);return}
    if(!e.target.closest('[data-ls-go]'))return;
    mutate(()=>{if(kind==='link'){const w=+$('lsWidth').value,dash=$('lsDash').value,dbl=$('lsDouble').checked,txt=$('lsText').value.trim(),type=r.edge.linkType&&Shapes.linkTypes[r.edge.linkType]?r.edge.linkType:null;
        for(const x of scopeItems().filter(match)){x.stroke=color;x.strokeWidth=w;x.dash=dash;x.double=dbl}
        if(type){const base=Shapes.linkTypes[type];S.doc.linkStyles??={};const st=S.doc.linkStyles[type]=S.doc.linkStyles[type]||{};if($('lsScope').value==='doc'){st.stroke=color;st.width=w;st.dash=dash;st.double=dbl}if(txt&&txt!==(base.short||base.name))st.label=txt;else delete st.label}}
      else if(kind==='device'){const disp=$('lsDisplay').value,txt=$('lsText').value.trim();for(const x of scopeItems().filter(match)){x.stroke=color;if(Shapes.isDevice(x))x.display=disp}
        S.doc.typeStyles??={};const st=S.doc.typeStyles[r.type]=S.doc.typeStyles[r.type]||{};if($('lsScope').value==='doc'){st.stroke=color;st.display=disp}if(txt&&txt!==Shapes.nameOf(r.type))st.label=txt;else delete st.label}
      else if(kind==='zone'){const z=r.zone;[z.fill,z.stroke]=zone;const txt=$('lsText').value;if(z.labels?.[0])z.labels[0].text=txt}
      else if(kind==='swatch'){const[ck,...vv]=key.slice(7).split('='),val=vv.join('=');if(ck==='vlan'){const v=(S.doc.vlans||[]).find(x=>String(x.id)===val);if(v)v.color=color}S.doc.display.colorMap??={};(S.doc.display.colorMap[ck]??={})[val]=color}});
    closeDialog();notify('Legend style applied.',1800)}}

// ---------- Scale… ----------
function openScale(){const sel=editable().filter(n=>!n.pin),whole=!sel.length,list=whole?items().filter(n=>!n.pin&&!isLocked(n)):sel;if(!list.length)return notify('Nothing to scale.');
  const o={pct:S.prefs.scalePct||90,anchor:S.prefs.scaleAnchor||'tl',text:S.prefs.scaleText!==false,lines:!!S.prefs.scaleLines},b=C.bounds(list.filter(n=>!n.pin),true),mm=v=>Math.round(v/C.PX);
  const d=openDialog(whole?'Scale the drawing':'Scale selection',`<p class="muted">${whole?'Nothing is selected, so everything on this page is scaled (the legend, border and title block stay put).':`Scales the ${plural(list.length,'selected item')}.`} Devices keep their proportions and ports, labels stay aligned, zones resize, racks move as whole units and connector bends scale with the drawing.</p>
    <div class="row"><label class="fld"><span>Scale to (%)</span><input id="scPct" type="number" min="5" max="1000" step="1" value="${o.pct}"></label><div class="fld"><span>Quick</span><div class="seg">${[50,75,90,110,125,150].map(p=>`<button data-sc-pct="${p}">${p}%</button>`).join('')}</div></div></div>
    <div class="fld"><span>Anchor</span><div class="seg"><button data-sc-anchor="tl" class="${o.anchor==='tl'?'active':''}">Top-left corner stays put</button><button data-sc-anchor="center" class="${o.anchor==='center'?'active':''}">Centre stays put</button></div></div>
    <label class="check"><input type="checkbox" id="scText" ${o.text?'checked':''}>Scale text sizes too</label><label class="check"><input type="checkbox" id="scLines" ${o.lines?'checked':''}>Scale line widths too</label>
    <p class="fitResult" id="scResult"></p><footer><button data-close>Cancel</button><button class="primary" data-sc-go>Scale</button></footer>`);
  let anchor=o.anchor;const pct=()=>Math.max(5,Math.min(1000,+$('scPct').value||100));
  const show=()=>{const k=pct()/100;$('scResult').innerHTML=`${mm(b.w)} × ${mm(b.h)} mm → <b>${mm(b.w*k)} × ${mm(b.h*k)} mm</b>`};show();d.oninput=show;
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const q=e.target.closest('[data-sc-pct]');if(q){$('scPct').value=q.dataset.scPct;show();return}
    const a=e.target.closest('[data-sc-anchor]');if(a){anchor=a.dataset.scAnchor;d.querySelectorAll('[data-sc-anchor]').forEach(x=>x.classList.toggle('active',x===a));return}
    if(!e.target.closest('[data-sc-go]'))return;const k=pct()/100,text=$('scText').checked,lines=$('scLines').checked;Object.assign(S.prefs,{scalePct:pct(),scaleAnchor:anchor,scaleText:text,scaleLines:lines});savePrefs();closeDialog();
    mutate(()=>{const r=Scale.apply(list,items(),k,{origin:Scale.origin(list,anchor),text,lines});for(const id of r.reroute)Conn.markDirty(id)});if(!whole)select(list.map(n=>n.id));notify(`Scaled ${plural(list.length,'item')} to ${pct()}%. Ctrl+Z undoes.`,2600)}}

// ---------- revisions ----------
const today=()=>Revisions.today();
const pendingRev=()=>{const ch=Revisions.changes(S.doc);return ch.count?Revisions.nextRev(S.doc.meta.revision):S.doc.meta.revision||'1.0'};
function describe(ch){const parts=[];const kinds=ids=>{const all=S.doc.pages.flatMap(p=>p.items),m={};for(const id of ids){const n=all.find(x=>x.id===id);const k=!n?'item':n.kind==='node'?(Shapes.isDevice(n)?'device':'shape'):n.kind==='edge'?'link':n.kind;m[k]=(m[k]||0)+1}return Object.entries(m).map(([k,v])=>plural(v,k)).join(', ')};
  if(ch.added.length)parts.push('added '+kinds(ch.added));if(ch.modified.length)parts.push('updated '+kinds(ch.modified));if(ch.removed.length)parts.push('removed '+plural(ch.removed.length,'item'));const s=parts.join('; ');return s?s[0].toUpperCase()+s.slice(1):'Revised'}
function markupAt(kind){const sel=picked().filter(n=>!n.pin&&!isMarkup(n)),rev=pendingRev(),layer=Revisions.markupLayer(S.doc);
  const made=mutate(()=>{const out=[];if(kind==='cloud'){const b=sel.length?C.bounds(sel,true):(()=>{const[cx,cy]=centerOfView();return{x:cx-100,y:cy-60,w:200,h:120}})(),pad=sel.length?14:0,c=Revisions.cloud(b.x-pad,b.y-pad,b.w+2*pad,b.h+2*pad,rev,layer);c.data.pending=true;const dl=Revisions.delta(c.x+c.w-6,c.y-30,rev,layer);dl.data.pending=true;out.push(c,dl)}
    else{const b=sel.length?C.bounds(sel,true):null,[cx,cy]=b?[b.x+b.w+4,b.y-30]:centerOfView(),dl=Revisions.delta(cx,cy,rev,layer);dl.data.pending=true;out.push(dl)}
    items().push(...out);select(out.map(n=>n.id));return out});
  notify(`Revision ${kind} added for revision ${rev}${Revisions.changes(S.doc).count?' (the next one — it is finalised when you issue it)':''}. Markup lives on the “Revisions” layer, so you can hide it for clean prints.`,5000);return made}
// Revision table above the title block if there is one (pinned with it), otherwise at the page's top-right.
function addTable(){const fg=pg(),bg=fg.background&&S.doc.pages.find(p=>p.id===fg.background),page=[bg,fg].find(p=>p&&p.items.some(n=>n.kind==='table'&&n.pin==='br'&&!n.revTable))||fg,tb=page.items.find(n=>n.kind==='table'&&n.pin==='br'&&!n.revTable);
  const t=Revisions.newTable(S.doc,0,0,S.activeLayer);if(tb){const k=tb.w/t.w;t.cols=t.cols.map(c=>Math.round(c*k));t.w=t.cols.reduce((a,c)=>a+c,0);t.x=tb.x+tb.w-t.w;t.y=tb.y-t.h-6;t.pin='br'}else{const m=fg.margin*C.PX,ps=C.pageSize(fg);t.x=ps.w-m-t.w-10;t.y=m+10;t.pin='tr'}
  page.items.push(t);return{t,page}}
function openRevisions(onIssued){const doc=S.doc,ch=Revisions.changes(doc),cur=doc.meta.revision||'1.0',next=Revisions.nextRev(cur),major=Revisions.nextRev(cur,true),log=Revisions.ensureLog(doc).map(r=>({...r})),hasTable=doc.pages.some(p=>p.items.some(n=>n.revTable)),mode=doc.meta.revMode||'ask';
  const changeTxt=ch.count?`<b>${plural(ch.count,'change')}</b> since revision ${html(cur)} (${[ch.added.length&&ch.added.length+' added',ch.modified.length&&ch.modified.length+' changed',ch.removed.length&&ch.removed.length+' removed'].filter(Boolean).join(', ')}) <a href="#" data-rv-show>show them</a>`:`No changes since revision ${html(cur)}.`;
  const hist=()=>log.map((r,i)=>`<tr><td><input data-rv-i="${i}" data-rv-k="rev" value="${html(r.rev)}"></td><td><input data-rv-i="${i}" data-rv-k="date" value="${html(r.date)}"></td><td><input data-rv-i="${i}" data-rv-k="description" value="${html(r.description)}"></td><td><input data-rv-i="${i}" data-rv-k="by" value="${html(r.by||'')}"></td><td>${log.length>1?`<button data-rv-del="${i}" title="Remove this entry">×</button>`:''}</td></tr>`).join('');
  const d=openDialog('Revisions',`<p class="muted">Current revision <b>${html(cur)}</b> · ${changeTxt}</p>
    <h4 class="tplHead">Issue a new revision</h4>
    <div class="row r3"><label class="fld"><span>New revision</span><input id="rvRev" value="${html(next)}"></label><div class="fld"><span>Quick</span><div class="seg"><button data-rv-q="${html(next)}" class="active">${html(next)}</button>${major!==next?`<button data-rv-q="${html(major)}">${html(major)}</button>`:''}</div></div><label class="fld"><span>Date</span><input id="rvDate" type="date" value="${today()}"></label></div>
    <div class="row"><label class="fld"><span>Description</span><input id="rvDesc" value="${html(ch.count?describe(ch):'')}" placeholder="What changed"></label><label class="fld"><span>By</span><input id="rvBy" value="${html(doc.meta.author||'')}"></label></div>
    <label class="check"><input type="checkbox" id="rvClouds" ${S.prefs.revClouds!==false&&ch.count?'checked':''} ${ch.count?'':'disabled'}>Mark the changes with revision clouds and deltas</label>
    <label class="check"><input type="checkbox" id="rvClear" ${S.prefs.revClear!==false?'checked':''}>Remove clouds from earlier revisions (deltas stay)</label>
    ${hasTable?'':'<label class="check"><input type="checkbox" id="rvTable" checked>Add a revision table (stacked above the title block)</label>'}
    <div class="fld"><span>When I save a drawing that changed since its last revision</span><select id="rvMode"><option value="ask" ${mode==='ask'?'selected':''}>Ask whether to issue a new revision</option><option value="auto" ${mode==='auto'?'selected':''}>Issue the next revision automatically</option><option value="off" ${mode==='off'?'selected':''}>Don’t ask</option></select></div>
    <h4 class="tplHead">History</h4><table class="report edit rvHist"><thead><tr><th>Rev</th><th>Date</th><th>Description</th><th>By</th><th></th></tr></thead><tbody id="rvBody">${hist()}</tbody></table>
    <footer><button data-rv-save title="Save history edits and the save setting without issuing">Save changes</button><span class="spacer"></span><button data-close>Cancel</button><button class="primary" data-rv-go>Issue revision <span id="rvGoRev">${html(next)}</span></button></footer>`,{wide:true});
  d.oninput=e=>{const i=e.target.dataset.rvI;if(i!=null)log[+i][e.target.dataset.rvK]=e.target.value;if(e.target.id==='rvRev')$('rvGoRev').textContent=e.target.value};
  const keep=()=>{S.doc.revisions=log.filter(r=>String(r.rev).trim());S.doc.meta.revMode=$('rvMode').value};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const q=e.target.closest('[data-rv-q]');if(q){$('rvRev').value=q.dataset.rvQ;$('rvGoRev').textContent=q.dataset.rvQ;d.querySelectorAll('[data-rv-q]').forEach(b=>b.classList.toggle('active',b===q));return}
    if(e.target.closest('[data-rv-show]')){e.preventDefault();closeDialog();S.highlights=new Set([...ch.added,...ch.modified]);render('overlay');notify(`${plural(ch.added.length+ch.modified.length,'changed item')} highlighted${ch.removed.length?` · ${ch.removed.length} removed`:''}. Esc clears.`,4000);return}
    const del=e.target.closest('[data-rv-del]');if(del){log.splice(+del.dataset.rvDel,1);$('rvBody').innerHTML=hist();return}
    if(e.target.closest('[data-rv-save]')){mutate(()=>{keep();if(log.length)S.doc.meta.revision=log.at(-1).rev;Revisions.syncTables(S.doc)});closeDialog();notify('Revision history saved.');return}
    if(!e.target.closest('[data-rv-go]'))return;const rev=$('rvRev').value.trim();if(!rev)return notify('Enter the new revision.');if(log.some(r=>String(r.rev)===rev)&&!confirm(`Revision ${rev} is already in the history. Issue it again?`))return;
    const opts={rev,date:$('rvDate').value||today(),description:$('rvDesc').value.trim()||describe(ch),by:$('rvBy').value.trim(),clouds:!!$('rvClouds')?.checked,clearClouds:$('rvClear').checked};S.prefs.revClouds=opts.clouds||!ch.count?S.prefs.revClouds:false;S.prefs.revClear=opts.clearClouds;savePrefs();const addT=$('rvTable')?.checked;
    const res=mutate(()=>{keep();const r=issueNow(opts);if(addT)addTable();return r});closeDialog();
    notify(`Issued revision ${rev}${res.clouds?` · ${plural(res.clouds,'revision cloud')} added`:''}. Title blocks and revision tables now show ${rev}.`,5000);onIssued?.(res)}}
// Finalise pending markup with the revision actually issued, then log it.
function issueNow(opts){for(const p of S.doc.pages)for(const n of p.items)if(isMarkup(n)&&n.data?.pending){n.data.rev=opts.rev;delete n.data.pending;if(n.type==='revdelta'&&n.labels?.[0])n.labels[0].text=String(opts.rev)}
  const keepPending=opts.clearClouds?new Set(S.doc.pages.flatMap(p=>p.items).filter(n=>n.type==='revcloud'&&n.data?.rev===opts.rev).map(n=>n.id)):null;
  if(keepPending){for(const p of S.doc.pages)p.items=p.items.filter(n=>n.type!=='revcloud'||keepPending.has(n.id));opts={...opts,clearClouds:false}}
  return Revisions.issue(S.doc,opts)}
const asked=new Set();
// Called before File ▸ Save / Save as. Resolves true to go ahead with the save.
function beforeSave(){const doc=S.doc,mode=doc.meta.revMode||'ask',ch=Revisions.changes(doc);if(!ch.known||!ch.count||mode==='off')return Promise.resolve(true);
  if(mode==='auto'){const rev=Revisions.nextRev(doc.meta.revision);mutate(()=>issueNow({rev,description:describe(ch),by:doc.meta.author||'',clouds:S.prefs.revClouds!==false,clearClouds:S.prefs.revClear!==false}));notify(`Issued revision ${rev} automatically (${describe(ch).toLowerCase()}). Change this in Insert ▸ New revision.`,5000);return Promise.resolve(true)}
  const key=doc.revBaseline?.at;if(asked.has(key))return Promise.resolve(true);
  return new Promise(res=>{const next=Revisions.nextRev(doc.meta.revision);const d=openDialog('Issue a new revision?',`<p>This drawing has <b>${plural(ch.count,'change')}</b> since revision <b>${html(doc.meta.revision)}</b>.</p><p class="muted">${html(describe(ch))}.</p>
      <label class="check"><input type="checkbox" id="rvNever">Don’t ask again for this drawing</label>
      <footer><button data-rp="keep">Save as revision ${html(doc.meta.revision)}</button><span class="spacer"></span><button class="primary" data-rp="issue">Issue revision ${html(next)}…</button></footer>`);
    d.oncancel=()=>res(false);
    d.onclick=e=>{if(e.target.closest('[data-close]')){closeDialog();return res(false)}const b=e.target.closest('[data-rp]');if(!b)return;asked.add(key);if($('rvNever').checked){doc.meta.revMode='off';S.dirty=true}
      if(b.dataset.rp==='keep'){closeDialog();return res(true)}openRevisions(()=>res(true))}})}
let revTimer=0;
function revInfo(){clearTimeout(revTimer);revTimer=setTimeout(()=>{const b=$('revInfo');if(!b||!S.doc)return;const ch=Revisions.changes(S.doc),rev=S.doc.meta.revision||'—';b.textContent=`Rev ${rev}${ch.count?` · ${plural(ch.count,'change')}`:''}`;b.classList.toggle('pending',ch.count>0);b.title=ch.count?`${describe(ch)} since revision ${rev} — click to issue a new revision`:`Revision ${rev} — click for revisions`},500)}
function prepare(doc){if(!doc.revBaseline)Revisions.setBaseline(doc);Revisions.ensureLog(doc)}

function init(){const m=$('contextMenu');m.addEventListener('input',e=>{const p=e.target.dataset?.ctxColor;if(p){hideMenus();setColor(p,e.target.value)}});
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-legend-style]');if(b){const[id,...k]=b.dataset.legendStyle.split('|');openLegendStyle(id,k.join('|'))}})}
return{init,menu,apply,openScale,openLegendStyle,openRevisions,markupAt,addTable,beforeSave,revInfo,prepare,pendingRev,issueNow};
})();
