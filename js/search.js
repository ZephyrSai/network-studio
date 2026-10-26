// Universal search (the box in the title bar, Ctrl/⌘+K or /): every ribbon command, tool and setting, the File menu,
// panels, shapes to insert, pages, and the devices, links, zones and comments in the drawing — plus the keyboard
// shortcuts. Words match in any order and in any part of a name; each result says where the tool lives, and
// Alt/⌥+Enter (or the location) shows it in the ribbon instead of running it.
const Search=(()=>{
const h=html;
// extra words people search with
const KW={check:'validate errors issues problems lint design rule drc findings',print:'pdf paper',printAll:'pdf',exportPng:'image picture screenshot',exportPng4:'image picture print',exportSvg:'vector image',exportVsdx:'visio microsoft',importVisio:'vsdx vssx stencil',share:'link url send',open:'load file import',
  spof:'redundancy failure resilience',trace:'route path hop',traffic:'bandwidth throughput utilisation utilization',poeBudget:'power over ethernet watts',storage:'nvr retention disk recording',legendGen:'key',newRevision:'version issue delta',layoutHier:'auto arrange tidy',rerouteAll:'routing lines tidy',
  find:'replace search text',fields:'columns properties attributes',vlans:'network segments',repIp:'subnet address addressing ipam',fullscreen:'maximise maximize',focusMode:'zen distraction',present:'slideshow presentation',uiTheme:'dark mode light night',tour:'onboarding help guide',rack:'cabinet elevation',
  zone:'container group area subnet',wrapZone:'container',scaleSel:'resize shrink grow',group:'combine',lock:'freeze protect',duplicate:'copy clone',delete:'remove erase',painter:'format copy style',importDialog:'csv netbox excel spreadsheet',importNeighbors:'cdp lldp discovery',repInventory:'asset list devices',repCables:'cable schedule patch',repBom:'bill of materials cost price',
  reviewMode:'comments annotate markup feedback approve sign off',reviewComment:'note pin feedback annotate markup',reviewReport:'export review pdf comments',reviewChanges:'compare diff revision changed',reviewChecklist:'sign off review tasks',checkConnections:'loose dangling unattached ports',checkLabels:'labels data duplicates identifiers mismatch',checkReadability:'overlap hidden text through page'};
const CTRL={linkTypeSel:'Link type',routeSel:'Connector routing',fontSizeSel:'Text size',displaySel:'Device display',paperSel:'Paper size',autoSizeSel:'Page auto-size',jumpSel:'Line jumps',colorBySel:'Colour devices by',showFieldSel:'Show field on drawing',gridStepSel:'Grid spacing'};
const COLORS={fontColor:'Text colour',strokeColor:'Line / accent colour',fillColor:'Fill colour'};
const SUGGEST=['a:check','a:reviewMode','a:reviewComment','a:find','a:legendGen','a:layoutHier','a:exportPng','a:print','a:shortcuts'];
const keyOf=t=>(/\b((?:Ctrl|Shift|Alt|⌘)\+[^\s,;)]+(?:\+[^\s,;)]+)?)/.exec(t||'')||[])[1]||(/^[A-Z?]$/.test(t||'')?t:'');

function sources(){const out=[],seen=new Set(),add=o=>{if(seen.has(o.id))return;seen.add(o.id);out.push(o)};
  // the ribbon: buttons, tools, toggles, and the choices inside its drop-downs
  for(const r of RIBBON)for(const g of r.groups){const where=`${r.name} ▸ ${g.name}`;for(const i of g.items){
    if(i.t==='btn')add({id:'a:'+i.action,sec:'Commands',label:i.label,where,icon:i.icon,key:keyOf(i.title),kw:(KW[i.action]||'')+' '+(i.title||''),tab:r.id,sel:`[data-action="${i.action}"]`,run:()=>actions[i.action]?.()});
    else if(i.t==='mode')add({id:'m:'+i.mode,sec:'Commands',label:i.label+' tool',where,icon:i.icon,key:i.key,tab:r.id,sel:`[data-mode="${i.mode}"]`,run:()=>setMode(i.mode)});
    else if(i.t==='toggle')add({id:'t:'+i.pref,sec:'Settings',label:`${i.label}: ${S.prefs[i.pref]?'on → turn off':'off → turn on'}`,where,icon:i.icon,tab:r.id,sel:`[data-action="toggle_${i.pref}"]`,run:()=>actions['toggle_'+i.pref]?.()});
    else if(i.t==='html'){const tmp=document.createElement('div');try{tmp.innerHTML=i.fn()}catch{continue}
      for(const s of tmp.querySelectorAll('select[id]')){const name=CTRL[s.id]||s.closest('[title]')?.title||s.id;for(const o of s.options){if(!o.value)continue;add({id:`s:${s.id}:${o.value}`,sec:'Settings',label:`${name}: ${o.text.replace(/^✓\s*/,'')}`,where,icon:'more',on:s.value===o.value&&!!o.value,tab:r.id,sel:'#'+s.id,run:()=>setControl(r.id,s.id,o.value)})}}
      for(const c of tmp.querySelectorAll('input[type=color][id]'))add({id:'c:'+c.id,sec:'Settings',label:COLORS[c.id]||c.id,where,icon:'brush',tab:r.id,sel:'#'+c.id,run:()=>{reveal(r.id,'#'+c.id);setTimeout(()=>$(c.id)?.click(),60)}});
      for(const t of tmp.querySelectorAll('[data-theme-apply]'))add({id:'th:'+t.dataset.themeApply,sec:'Settings',label:'Theme: '+t.title,where,icon:'theme',tab:r.id,sel:`[data-theme-apply="${t.dataset.themeApply}"]`,run:()=>{reveal(r.id);document.querySelector(`#ribbon [data-theme-apply="${t.dataset.themeApply}"]`)?.click()}})}}}
  for(const f of FILE_MENU)if(f!=='-')add({id:'a:'+f[0],sec:'Commands',label:f[1].replace(/…$/,'…'),where:'File',icon:f[2],key:f[3]||'',kw:KW[f[0]]||'',run:()=>actions[f[0]]?.()});
  for(const[a,l,kw='']of[['traceFrom','Trace path from the selected device'],['rerouteAll','Re-route all connectors'],['exportCsv','Inventory as CSV'],['repPoe','PoE budget report'],['repCctv','CCTV storage report'],['addLabel','Add a label to the selection'],['labelBg','Label background on / off'],
    ['fitPageToDrawing','Fit the page to the drawing now'],['duplicatePage','Duplicate this page'],['deletePage','Delete this page'],['guideX','Add a vertical guide'],['guideY','Add a horizontal guide'],['clearGuides','Remove all guides'],['reverse','Reverse connector direction'],['toAuto','Switch connector to auto-routing'],
    ['fillIp','Fill in the next free IP address','ipam'],['vlanFromZone','Create a VLAN from the zone'],['rotateLeft','Rotate 90° left'],['sameHeight','Same height'],['layoutSel','Auto-layout the selection'],['clusters','Layout: clusters by zone'],['nextFinding','Next finding','F8 problem issue'],['prevFinding','Previous finding','problem issue'],
    ['reviewFindings','Check & review panel','findings issues'],['reviewChecklist','Review checklist'],['reviewChanges','Changes since the last review'],['reviewComplete','Complete review'],['checkConnections','Check connection integrity'],['checkLabels','Check labels & data consistency'],['checkReadability','Check readability'],['about','About Port Network Studio']])
    if(actions[a])add({id:'a:'+a,sec:'Commands',label:l,where:'Command',icon:'command',kw:kw+' '+(KW[a]||''),run:()=>actions[a]()});
  // panels
  for(const[k,l]of[['shapes','Shapes panel'],['icons','Icons — search online icon sets'],['templates','Templates panel'],['layers','Layers panel'],['explorer','Explorer — everything in the drawing']])add({id:'p:'+k,sec:'Commands',label:l,where:'Left panel',icon:'panels',run:()=>{S.ltab=k;if(narrowScreen())overlayPanel('left');else if(!S.prefs.leftOpen)setChrome('leftOpen',true);renderLeft()}});
  add({id:'p:page',sec:'Commands',label:'Page setup — paper, margin, background',where:'Inspector',icon:'page',kw:'size orientation landscape portrait colour',run:()=>{S.selected.clear();S.tab='page';if(S.side&&!S.reviewMode){S.side=null;ReviewUI.draw(true)}render()}});
  // pages, shapes, the drawing, comments, shortcuts
  S.doc.pages.forEach((p,i)=>add({id:'pg:'+p.id,sec:'Pages',label:'Go to '+p.name,where:p.isBackground?'Background page':'Page '+(i+1),icon:'page',run:()=>gotoPage(i)}));
  for(const c of Shapes.catalog())for(const i of c.items)add({id:'sh:'+i.type,sec:'Shapes',label:'Insert '+i.name,where:c.name,type:i.type,kw:i.type,run:()=>{addNode(i.type,...centerOfView());bumpRecent(i.type)}});
  S.doc.pages.forEach((p,pi)=>{for(const n of p.items){if(!(n.kind==='node'&&Shapes.isDevice(n)||n.kind==='zone'||n.kind==='edge'&&(n.labels?.length||n.data?.cableId)))continue;const nm=n.kind==='edge'?edgeName(n,p):Analysis.nameOf(n),d=n.data||{};
    add({id:'it:'+n.id,sec:'In this drawing',label:nm,where:[n.kind==='node'?Shapes.nameOf(n.type):n.kind==='zone'?'Zone':'Link',d.ip,d.subnet,p.name].filter(Boolean).join(' · '),icon:n.kind==='edge'?'connect':n.kind==='zone'?'zone':null,type:n.kind==='node'?n.type:null,kw:[d.hostname,d.mgmtIp,d.model,d.vendor,d.serial,d.vlan&&'vlan '+d.vlan,d.cableId,...(n.labels||[]).map(l=>l.text)].filter(Boolean).join(' '),run:()=>goTo(pi,n)})}});
  for(const c of S.doc.review?.comments||[])add({id:'cm:'+c.id,sec:'Comments',label:`#${c.n} ${c.text}`,where:`${Review.STATUS[c.status]} · ${S.doc.pages.find(p=>p.id===c.page)?.name||''}`,icon:'comment',kw:c.by,run:()=>ReviewUI.focusComment(c.id)});
  const named=new Set(out.map(o=>o.label.toLowerCase().replace(/…$/,'')));
  for(const[k,t]of SHORTCUTS)if(!named.has(t.toLowerCase()))add({id:'k:'+k,sec:'Shortcuts',label:t,where:k,icon:'keyboard',run:()=>actions.shortcuts()});
  return out}

function goTo(pi,n){if(pi!==S.pageIndex){S.pageIndex=pi;clearTransient();Constraints.sync(pg(),S.doc)}select([n.id]);S.highlights=new Set([n.id]);Ins.ensureVisible(n);render()}
// Show where a tool lives: open its ribbon tab and make it pulse.
function reveal(tab,sel){if(!tab)return null;if(S.prefs.ribbonCollapsed)document.body.classList.add('ribbonPeek');S.ribbonTab=tab;renderRibbon();const el=sel&&document.querySelector('#ribbon '+sel);if(!el)return null;
  const box=el.closest('.rgroup[data-lv="4"],.rgroup[data-lv="5"]')?el.closest('.rgroup'):el.closest('.rbtn,.rsel,.rcolor,.themeSw')||el;box.classList.remove('found');void box.offsetWidth;box.classList.add('found');setTimeout(()=>box.classList.remove('found'),2600);return el}
function setControl(tab,id,value){const el=reveal(tab,'#'+id);if(!el)return;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}))}

// ---------- matching ----------
function fuzzy(s,w){let i=0;for(const ch of s){if(ch===w[i])i++;if(i===w.length)return true}return false}
function score(it,words){const L=it.label.toLowerCase(),H=(it.label+' '+(it.where||'')+' '+(it.kw||'')).toLowerCase();let s=0;
  for(const w of words){const i=L.indexOf(w);if(i===0)s+=30;else if(i>0&&/[\s:·\-–(/▸]/.test(L[i-1]))s+=20;else if(i>0)s+=10;else if(new RegExp('(^|[\\s:·/(-])'+w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).test(H))s+=6;else if(H.includes(w))s+=3;else if(w.length>=3&&L.split(/[\s:·/()–-]+/).some(x=>fuzzy(x,w)))s+=1;else return 0}
  return s+(it.sec==='Commands'?3:it.sec==='Settings'?2:0)-(L.length/80)}
const mark=(s,words)=>{let out=h(s);for(const w of words.filter(x=>x.length>1).sort((a,b)=>b.length-a.length)){const re=new RegExp('('+h(w).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','ig');out=out.replace(/(<[^>]*>)|([^<]+)/g,(m,tag,text)=>tag||text.replace(re,'<mark>$1</mark>'))}return out};
const CAP={Commands:12,Settings:8,'In this drawing':10,Shapes:8,Pages:6,Comments:6,Shortcuts:4};
function results(all,q){const words=q.toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length){const rec=(S.prefs.recentCmds||[]).map(id=>all.find(x=>x.id===id)).filter(Boolean),sug=SUGGEST.map(id=>all.find(x=>x.id===id)).filter(x=>x&&!rec.includes(x));return[...rec.slice(0,6).map(x=>({...x,sec:'Recent'})),...sug.map(x=>({...x,sec:'Suggested'}))]}
  const scored=all.map(it=>({it,s:score(it,words)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s),by=new Map();
  for(const{it,s}of scored){if(!by.has(it.sec))by.set(it.sec,{best:s,list:[]});const g=by.get(it.sec);if(g.list.length<(CAP[it.sec]||8))g.list.push(it)}
  return[...by.values()].sort((a,b)=>b.best-a.best).flatMap(g=>g.list)}

// ---------- the dialog ----------
function open(){const all=sources();let list=[],sel=0;
  const d=openDialog('Search','<div id="palList" class="palList" role="listbox"></div><div class="palFoot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> run</span><span><kbd>'+(IS_MAC?'⌥':'Alt')+'</kbd>+<kbd>Enter</kbd> show in the ribbon</span><span><kbd>Esc</kbd> close</span></div>',{cls:'cmdk',light:true});
  d.querySelector('header').innerHTML=`<span class="cmdkIcon">${icon('search',18)}</span><input id="palInput" placeholder="Search tools, settings, shapes, devices, pages…" autocomplete="off" spellcheck="false" aria-label="Search"><button class="x" data-close title="Close (Esc)">×</button>`;
  const draw=()=>{const q=$('palInput').value.trim();list=results(all,q);sel=Math.max(0,Math.min(sel,list.length-1));const words=q.toLowerCase().split(/\s+/).filter(Boolean);let last='';
    $('palList').innerHTML=list.map((c,i)=>{const head=c.sec!==last?`<div class="palSec">${h(c.sec)}</div>`:'';last=c.sec;
      return head+`<button data-cmd="${i}" class="${i===sel?'active':''}" role="option">${c.type?Shapes.iconSvg(c.type,{size:20}):icon(c.icon||'command',16)}<span class="palLabel">${mark(c.label,words)}${c.on?' <b class="palOn">current</b>':''}</span>${c.key?`<kbd>${h(c.key)}</kbd>`:''}<em ${c.tab?`data-where="${i}" title="Show it in the ribbon"`:''}>${h(c.where||'')}</em></button>`}).join('')||`<p class="muted pad">Nothing matches “${h(q)}”. Try another word — e.g. “pdf”, “vlan”, “overlap”, a device name or an IP address.</p>`;
    $('palList').querySelector('.active')?.scrollIntoView({block:'nearest'})};
  const run=(c,show)=>{if(!c)return;closeDialog();const r=(S.prefs.recentCmds||[]).filter(x=>x!==c.id);r.unshift(c.id);S.prefs.recentCmds=r.slice(0,8);savePrefs();
    if(show&&c.tab){if(!reveal(c.tab,c.sel))notify(`It is under ${c.where}.`);return}c.run()};
  draw();setTimeout(()=>$('palInput')?.focus(),20);$('palInput').oninput=()=>{sel=0;draw()};
  $('palInput').onkeydown=e=>{if(e.key==='ArrowDown'){sel=Math.min(list.length-1,sel+1);draw();e.preventDefault()}else if(e.key==='ArrowUp'){sel=Math.max(0,sel-1);draw();e.preventDefault()}else if(e.key==='PageDown'){sel=Math.min(list.length-1,sel+8);draw();e.preventDefault()}else if(e.key==='PageUp'){sel=Math.max(0,sel-8);draw();e.preventDefault()}else if(e.key==='Enter'){e.preventDefault();run(list[sel],e.altKey)}};
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const w=e.target.closest('[data-where]');if(w){run(list[+w.dataset.where],true);return}const b=e.target.closest('[data-cmd]');if(b)run(list[+b.dataset.cmd],e.altKey)}}

return{open,results,score,reveal};
})();
