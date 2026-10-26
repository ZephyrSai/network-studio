// Check & review panel (on the right, in place of the inspector):
//  • Findings — the design check by category. Click one to go to it and highlight it, fix it, or mark it resolved or
//    accepted as intentional (accepted ones stop counting in the status bar).
//  • Comments — numbered pins on a device, a connector, an area or a point; open / resolved / accepted, with replies.
//  • Checklist — connectivity, labels, device data, readability and design, each showing the findings still open.
//  • Changes — what changed since the previous review (or the last issued revision), highlighted on the drawing.
// Review mode locks the layout: a click selects, a drag pans, the comment tool pins comments, and edit commands are
// refused. Review data (comments, statuses, checklist) still changes, saves and undoes like the rest of the drawing.
const ReviewUI=(()=>{
const h=html,plural=(n,w)=>`${n} ${w}${n===1?'':'s'}`;
const ui={status:'open',cat:'',cstatus:'open',changes:true,accepting:null,replying:null,editing:null,focus:null,pending:false};
let issues=[],cursor=null;
const me=()=>S.prefs.reviewer||S.doc.meta?.author||'';
const CATS=Checks.CATS,FILTERS=[['','All checks'],['connectivity','Connection integrity'],['labels,data','Labels & data'],['labels','  Labels'],['data','  Device data'],['readability','Readability'],['design','Network design']],catName=k=>(FILTERS.find(c=>c[0]===k)||[,'Other'])[1].trim();
const catOk=i=>!ui.cat||ui.cat.split(',').includes(i.cat);
const COLORS={open:'#ea580c',resolved:'#16a34a',accepted:'#64748b'};
const anyItem=id=>{for(const p of S.doc.pages){const n=p.items.find(x=>x.id===id);if(n)return{n,p}}return null};
const itemName=id=>{const r=anyItem(id);return r?(r.n.kind==='edge'?edgeName(r.n,r.p):Analysis.nameOf(r.n)):''};
const pageOfId=id=>S.doc.pages.findIndex(p=>p.id===id);
const when=s=>{if(!s)return'';const d=new Date(s),m=(Date.now()-d)/6e4;return m<1?'just now':m<60?Math.round(m)+' min ago':m<1440?Math.round(m/60)+' h ago':d.toISOString().slice(0,10)};
// Review data changes go through the normal history (undo, autosave) even while the layout is locked.
function edit(fn){S.reviewEdit=true;try{return mutate(fn)}finally{S.reviewEdit=false}}
function recheck(){issues=Analysis.check(S.doc);return issues}

// ---------- opening, closing, review mode ----------
function open(tab='findings',o={}){S.side=tab;if(o.cat!==undefined)ui.cat=o.cat;if(o.status)ui.status=o.status;reveal();recheck();draw(true);render('overlay')}
function reveal(){if(narrowScreen()){document.body.classList.remove('showLeft');document.body.classList.add('showRight')}else if(!S.prefs.rightOpen)setChrome('rightOpen',true)}
function close(){if(S.reviewMode)return setMode2(false);S.side=null;S.findMark=null;draw(true);render()}
function setMode2(on){S.reviewMode=on;document.body.classList.toggle('reviewing',on);S.reviewDraft=null;if(S.mode!=='select'&&S.mode!=='pan'&&S.mode!=='comment'||!on&&S.mode==='comment')setMode('select');
  if(on){S.reviewFloor=S.history.length;S.reviewFutureFloor=S.future.length;if(!S.side||S.side==='findings')S.side='comments';reveal();notify('Review mode — the layout is locked. Click to select, drag to pan, C pins a comment.',4200)}else{S.side=S.side==='comments'||S.side==='checklist'||S.side==='changes'?S.side:null;notify('Review mode off — editing is back.',1800)}
  renderRibbon();recheck();draw(true);render()}
const toggleMode=()=>setMode2(!S.reviewMode);

// ---------- going to things ----------
// Brings a box into view: centred, zoomed in to at least 100 % when it fits, out when it does not.
function view(b){const cv=$('canvas'),cw=cv.clientWidth||900,ch=cv.clientHeight||600,fz=Math.min(cw/(b.w+240),ch/(b.h+200)),z=Math.max(.05,Math.min(fz,Math.max(S.view.zoom,1)));
  S.view.zoom=z;S.view.x=b.x+b.w/2-cw/2/z;S.view.y=b.y+b.h/2-ch/2/z;clampView();showZoom()}
function onPage(i){if(i>=0&&i!==S.pageIndex){S.pageIndex=i;clearTransient();Constraints.sync(pg(),S.doc)}}
function goFinding(it){cursor=it.key;onPage(it.page);const ns=it.ids.map(find).filter(Boolean);S.highlights=new Set(ns.map(n=>n.id));S.selected=new Set(ns.filter(n=>n.kind!=='zone'||ns.length===1).map(n=>n.id));S.activeLabel=null;
  S.findMark=it.at?{p:it.at,page:S.pageIndex}:null;const pts=ns.length?C.bounds(ns,true):null;let b=pts;if(it.at){const a={x:it.at[0]-20,y:it.at[1]-20,w:40,h:40};b=b?{x:Math.min(b.x,a.x),y:Math.min(b.y,a.y),w:Math.max(b.x+b.w,a.x+a.w)-Math.min(b.x,a.x),h:Math.max(b.y+b.h,a.y+a.h)-Math.min(b.y,a.y)}:a}
  if(b)view(b);render();draw(true);$('sidePanel').querySelector('.fnd.active')?.scrollIntoView({block:'nearest'})}
function step(dir){const list=visible();if(!list.length)return notify('No findings to step through.');let i=list.findIndex(x=>x.key===cursor);i=i<0?(dir>0?0:list.length-1):(i+dir+list.length)%list.length;if(S.side!=='findings')open('findings');goFinding(list[i])}
function goComment(c){ui.focus=c.id;onPage(pageOfId(c.page));const t=c.target&&find(c.target),p=Review.pinAt(c,find);S.highlights=new Set(t?[t.id]:[]);S.findMark=null;
  view(c.area?c.area:t?C.bounds([t],true):{x:p[0]-60,y:p[1]-60,w:120,h:120});render();draw(true)}
function focusComment(id){const c=Review.comment(S.doc,id);if(!c)return;if(S.side!=='comments'){S.side='comments';reveal()}ui.cstatus=c.status==='open'||ui.cstatus==='all'?ui.cstatus:'all';goComment(c);setTimeout(()=>$('sidePanel')?.querySelector(`[data-ci="${id}"]`)?.scrollIntoView({block:'nearest'}),30)}

// ---------- comments ----------
// From the comment tool: a drag makes an area comment, a click on something pins to it, a click on empty space to that point.
function commentAt(d,p){const moved=Math.hypot(p[0]-d.start[0],p[1]-d.start[1])*S.view.zoom>6,pid=pg().id;
  if(moved)S.reviewDraft={page:pid,area:{x:Math.min(p[0],d.start[0]),y:Math.min(p[1],d.start[1]),w:Math.abs(p[0]-d.start[0]),h:Math.abs(p[1]-d.start[1])}};
  else{const t=d.target&&find(d.target);S.reviewDraft=t?{page:pid,target:t.id,rel:Review.relFor(t,d.start)}:{page:pid,pos:d.start}}
  if(S.mode==='comment')setMode('select');if(S.side!=='comments'){S.side='comments';reveal()}draw(true);render('overlay');setTimeout(()=>$('rvDraft')?.focus(),30)}
function draftFor(n,p){S.reviewDraft={page:pg().id,target:n.id,rel:Review.relFor(n,p||C.center(n))};if(S.side!=='comments'){S.side='comments';reveal()}draw(true);render('overlay');setTimeout(()=>$('rvDraft')?.focus(),30)}
function saveDraft(){const t=$('rvDraft')?.value.trim();if(!t)return notify('Write the comment first.');const d=S.reviewDraft;S.reviewDraft=null;let c;edit(()=>{c=Review.addComment(S.doc,{...d,text:t,by:me()})});ui.focus=c.id;if(ui.cstatus==='resolved')ui.cstatus='open';draw(true);render('overlay');notify(`Comment #${c.n} added.`,1600)}

// ---------- what the panel lists ----------
const visible=()=>issues.filter(i=>(ui.status==='all'||i.status===ui.status)&&catOk(i));
function comments(){const r=S.doc.review;return(r?.comments||[]).slice().sort((a,b)=>a.n-b.n)}
let changesCache=null;function changes(){return changesCache=Review.changes(S.doc)}

// ---------- drawing the panel ----------
function draw(force){const box=$('sidePanel');if(!box)return;const on=!!S.side;$('rightPanel').classList.toggle('side',on);box.hidden=!on;if(!on){render('panel');return}
  const a=document.activeElement;if(!force&&box.contains(a)&&/INPUT|TEXTAREA|SELECT/.test(a.tagName)){ui.pending=true;return}ui.pending=false;
  const scroll=box.querySelector('.rvBody')?.scrollTop||0,cs=comments(),openC=cs.filter(c=>c.status==='open').length,openF=issues.filter(i=>i.status==='open').length,cl=Review.checklist(S.doc,issues),ch=changes();
  const tabs=[['findings','Findings',openF],['comments','Comments',openC],['checklist','Checklist',`${cl.filter(x=>x.state==='ok').length}/${cl.length}`],['changes','Changes',ch.known?ch.count:'']];
  box.innerHTML=`<div class="rvHead"><div class="rvTop"><h2>${S.reviewMode?'Review':'Check & review'}</h2><button data-rv="mode" class="rvMode ${S.reviewMode?'on':''}" title="Review mode keeps the layout as it is: click to select, drag to pan, pin comments">${icon('review',15)}<span>${S.reviewMode?'Reviewing':'Review mode'}</span></button><button class="x" data-rv="close" title="${S.reviewMode?'Exit review mode':'Back to the inspector'}">×</button></div>
    ${S.reviewMode?`<div class="rvBanner">${icon('lock',14)}<span>Layout locked for review</span><button data-rv="mode">Exit review</button></div>`:''}
    <div class="itabs">${tabs.map(([k,t,n])=>`<button data-rvtab="${k}" class="${S.side===k?'active':''}">${t}<em>${n}</em></button>`).join('')}</div></div>
    <div class="rvBody">${S.side==='findings'?findingsTab():S.side==='comments'?commentsTab(cs):S.side==='checklist'?checklistTab(cl):changesTab(ch)}</div>
    <div class="rvFoot"><button data-rv="report">${icon('report',15)} Review report…</button></div>`;
  box.querySelector('.rvBody').scrollTop=scroll}

function findingsTab(){const counts={open:0,resolved:0,accepted:0};for(const i of issues)if(catOk(i))counts[i.status]=(counts[i.status]||0)+1;const list=visible(),pos=list.findIndex(x=>x.key===cursor);
  const chips=[['open','Open'],['resolved','Resolved'],['accepted','Accepted'],['all','All']].map(([k,t])=>`<button data-fstat="${k}" class="${ui.status===k?'active':''}">${t} <b>${k==='all'?Object.values(counts).reduce((a,b)=>a+b,0):counts[k]||0}</b></button>`).join('');
  const groups=CATS.map(([k,name])=>[k,name,list.filter(i=>i.cat===k)]).filter(g=>g[2].length);
  return`<div class="chipsRow">${chips}</div><div class="rvRow"><select data-fcat title="Which checks">${FILTERS.map(([k,t])=>`<option value="${k}" ${ui.cat===k?'selected':''}>${t.replace(/^  /,'\u2003')}</option>`).join('')}</select><button data-rv="recheck" title="Run the check again">↻</button></div>
    ${list.length?`<div class="rvNav"><button data-rv="prev" title="Previous finding (Shift+F8)">‹</button><span>${pos>=0?`Finding ${pos+1} of ${list.length}`:plural(list.length,'finding')} · F8 steps</span><button data-rv="next" title="Next finding (F8)">›</button></div>`:''}
    ${groups.map(([k,name,l])=>`<h3 class="rvCat">${h(name)} <em>${l.length}</em></h3>${l.map(card).join('')}`).join('')||`<p class="rvEmpty">${ui.status==='open'?'✓ Nothing open'+(ui.cat?' in '+h(catName(ui.cat)):'')+'.':'Nothing here.'}</p>`}`}
function card(i){const fix=(i.fixes||[]).map(f=>`<button data-fix="${h(f.id)}" ${S.reviewMode?'disabled title="Leave review mode to fix"':''}>${h(f.label)}</button>`).join(''),key=h(i.key),acc=ui.accepting===i.key;
  return`<div class="fnd sev-${i.severity} st-${i.status} ${cursor===i.key?'active':''}" data-fk="${key}"><div class="fndMsg"><i title="${{error:'Error',warning:'Warning',info:'Note'}[i.severity]}"></i><span>${h(i.message)}</span></div>
    <div class="fndMeta">${i.page>=0?h(S.doc.pages[i.page]?.name||''):'Whole drawing'}${i.status!=='open'?` · <b class="pill ${i.status}">${i.status==='accepted'?'Accepted as intentional':'Resolved'}</b>${i.status==='resolved'?' — still detected':''}`:''}${i.note?` · “${h(i.note)}”`:''}</div>
    ${acc?`<div class="fndNote"><input id="rvAccNote" placeholder="Why is it intentional? (optional)" value="${h(i.note||'')}"><button class="primary" data-fs="accepted">Accept</button><button data-fs="cancel">Cancel</button></div>`
      :`<div class="fndAct">${fix}${i.status==='open'?`<button data-fs="resolved" title="Mark as resolved">${icon('resolve',14)}</button><button data-fs="accept" title="Accept as intentional — it stops counting">Intentional…</button>`:`<button data-fs="open">Reopen</button>`}</div>`}</div>`}

function selCard(){if(!S.selected.size)return'';const n=picked()[0];if(!n)return'';const nm=n.kind==='edge'?edgeName(n,pg()):Analysis.nameOf(n),d=n.data||{},bits=[n.kind==='node'?Shapes.nameOf(n.type):n.kind,d.ip,d.vlan&&'VLAN '+d.vlan,d.model].filter(Boolean);
  return`<div class="rvSel"><div><b>${h(nm)}</b><div class="muted">${h(bits.join(' · '))}${S.selected.size>1?` · +${S.selected.size-1} more`:''}</div></div><button data-rv="commentSel">${icon('comment',14)} Comment</button></div>`}
function commentsTab(cs){const n={open:0,resolved:0,accepted:0};for(const c of cs)n[c.status]++;const list=cs.filter(c=>ui.cstatus==='all'||c.status===ui.cstatus),d=S.reviewDraft;
  const on=c=>c.target?itemName(c.target)||'(deleted item)':c.area?'Area':'Point';
  return`<div class="rvRow"><button class="primary" data-rv="tool">${icon('comment',15)} ${S.mode==='comment'?'Click the drawing…':'Add comment'}</button><span class="spacer"></span></div>
    <div class="chipsRow">${[['open','Open'],['resolved','Resolved'],['accepted','Accepted'],['all','All']].map(([k,t])=>`<button data-cstat="${k}" class="${ui.cstatus===k?'active':''}">${t} <b>${k==='all'?cs.length:n[k]}</b></button>`).join('')}</div>
    ${S.reviewMode?selCard():''}
    ${d?`<div class="cmt draft"><b class="pinNo">+</b><div class="cmtMain"><div class="cmtOn">${d.target?'On '+h(itemName(d.target)):d.area?'On the marked area':'At the point you clicked'} · ${h(pg().name)}</div><textarea id="rvDraft" rows="3" placeholder="Comment… (${MODK}+Enter adds it)"></textarea><div class="cmtAct"><button class="primary" data-rv="saveDraft">Add comment</button><button data-rv="cancelDraft">Cancel</button></div></div></div>`:''}
    ${list.map(c=>`<div class="cmt st-${c.status} ${ui.focus===c.id?'active':''}" data-ci="${c.id}"><b class="pinNo" style="background:${COLORS[c.status]}">${c.n}</b><div class="cmtMain">
      <div class="cmtOn">${h(on(c))} · ${h(S.doc.pages[pageOfId(c.page)]?.name||'')}</div>
      ${ui.editing===c.id?`<textarea id="rvEdit" rows="3">${h(c.text)}</textarea><div class="cmtAct"><button class="primary" data-ca="saveEdit">Save</button><button data-ca="cancel">Cancel</button></div>`:`<div class="cmtText">${h(c.text)}</div>`}
      <div class="cmtMeta">${h(c.by||'Someone')} · ${when(c.at)}${c.edited?' · edited':''}</div>
      ${(c.replies||[]).map(r=>`<div class="cmtReply"><span>${h(r.text)}</span><em>${h(r.by||'Someone')} · ${when(r.at)}</em></div>`).join('')}
      ${ui.replying===c.id?`<textarea id="rvReply" rows="2" placeholder="Reply… (${MODK}+Enter sends)"></textarea><div class="cmtAct"><button class="primary" data-ca="sendReply">Reply</button><button data-ca="cancel">Cancel</button></div>`:''}
      <div class="cmtAct"><span class="seg mini">${Object.entries(Review.STATUS).map(([k,t])=>`<button data-cs="${k}" class="${c.status===k?'active':''}">${t}</button>`).join('')}</span><button data-ca="reply" title="Reply">↩</button><button data-ca="edit" title="Edit">✎</button><button data-ca="delete" title="Delete">${icon('trash',13)}</button></div></div></div>`).join('')
      ||`<p class="rvEmpty">${cs.length?'No '+ui.cstatus+' comments.':`No comments yet. ${S.reviewMode?'':'Turn on Review mode or '}Use Add comment, then click a device, a link or a spot — or drag round an area.`}</p>`}`}

function checklistTab(cl){const done=cl.filter(x=>x.state==='ok').length;
  return`<div class="rvProgress"><div style="width:${cl.length?done/cl.length*100:0}%"></div></div><p class="muted">${done} of ${cl.length} checks passed${cl.some(x=>x.state==='issues')?` · ${cl.filter(x=>x.state==='issues').length} need work`:''}.</p>
    ${cl.map(c=>`<div class="chk st-${c.state||'none'}" data-ck="${c.id}"><div class="chkHead"><b>${h(c.label)}</b>${c.cat?'':`<button class="x" data-ck-del title="Remove this check">×</button>`}</div>${c.hint?`<div class="muted">${h(c.hint)}</div>`:''}
      ${c.cat?`<div class="chkAuto">${c.open?`<button data-ck-show="${c.cat}" class="${c.errors?'err':'warn'}">${plural(c.open,'open finding')}${c.errors?` · ${c.errors} error${c.errors>1?'s':''}`:''} ›</button>`:'<span class="okTxt">✓ No open findings</span>'}</div>`:''}
      <div class="seg">${[['ok','✓ Passed'],['issues','✗ Needs work'],['','Not checked']].map(([k,t])=>`<button data-ck-state="${k}" class="${(c.state||'')===k?'active':''}">${t}</button>`).join('')}</div>
      ${c.state==='ok'&&c.open?`<div class="warnTxt">Passed with ${plural(c.open,'open finding')} — mark them intentional or fix them.</div>`:''}
      <input data-ck-note placeholder="Note" value="${h(c.note||'')}">${c.by?`<div class="cmtMeta">${h(c.by)} · ${when(c.at)}</div>`:''}</div>`).join('')}
    <div class="rvRow"><input id="rvNewCheck" placeholder="Add a check of your own…"><button data-rv="addCheck">Add</button></div>`}

function changesTab(ch){const r=S.doc.review,hist=(r?.history||[]).slice().reverse();
  const since=ch.since?ch.since.kind==='review'?`Since the review of ${when(ch.since.at)}${ch.since.by?' by '+h(ch.since.by):''}.`:`Since revision ${h(ch.since.rev)} was issued — no review has been completed yet.`:'Nothing to compare with yet. Complete a review and the next one shows what changed since.';
  const row=(id,k)=>{const r2=anyItem(id);return`<button class="chg ${k}" data-chg="${id}"><i></i><span>${h(r2?(r2.n.kind==='edge'?edgeName(r2.n,r2.p):Analysis.nameOf(r2.n)):id)}</span><em>${h(r2?.p.name||'')}</em></button>`};
  const rem=x=>`<button class="chg removed" data-chg-rem="${h(x.id)}"><i></i><span>${h(x.name||'(item)')}</span><em>${h(S.doc.pages.find(p=>p.id===x.page)?.name||'')}</em></button>`;
  return`<p class="muted">${since}</p>${ch.known?`<label class="check"><input type="checkbox" data-rv-changes ${ui.changes?'checked':''}>Highlight them on the drawing</label>
    ${[['Added','added',ch.added],['Changed','modified',ch.modified]].map(([t,k,l])=>l.length?`<h3 class="rvCat">${t} <em>${l.length}</em></h3><div class="issues">${l.slice(0,200).map(id=>row(id,k)).join('')}</div>`:'').join('')}
    ${ch.removed.length?`<h3 class="rvCat">Removed <em>${ch.removed.length}</em></h3><div class="issues">${ch.removed.slice(0,200).map(rem).join('')}</div>`:''}${ch.count?'':'<p class="rvEmpty">✓ Nothing has changed.</p>'}`:''}
    <div class="rvComplete"><button class="primary" data-rv="complete">${icon('resolve',15)} Complete review…</button><p class="muted">Records this review; the next one is compared with the drawing as it is now. Open items carry over.</p></div>
    ${hist.length?`<h3 class="rvCat">Earlier reviews</h3>${hist.map(x=>`<div class="hist"><b>${h(new Date(x.at).toISOString().slice(0,10))}</b> ${h(x.by||'')}<span class="muted"> · ${plural(x.openComments||0,'open comment')}, ${plural(x.openFindings||0,'open finding')}, ${plural(x.checked||0,'check')} passed</span></div>`).join('')}`:''}`}

// ---------- panel events ----------
function onClick(e){const t=e.target,b=t.closest('button');
  const rt=t.closest('[data-rvtab]');if(rt){S.side=rt.dataset.rvtab;if(S.side!=='changes')S.findMark=null;draw(true);render('overlay');return}
  const rv=b?.dataset.rv;
  if(rv==='close')return close();if(rv==='mode')return toggleMode();if(rv==='report')return openReport();if(rv==='recheck'){recheck();draw(true);return notify('Checked again.',1200)}
  if(rv==='prev'||rv==='next')return step(rv==='next'?1:-1);
  if(rv==='tool'){setMode(S.mode==='comment'?'select':'comment');draw(true);return}
  if(rv==='commentSel'){const n=picked()[0];if(n)draftFor(n);return}
  if(rv==='saveDraft')return saveDraft();if(rv==='cancelDraft'){S.reviewDraft=null;draw(true);render('overlay');return}
  if(rv==='addCheck'){const v=$('rvNewCheck').value.trim();if(!v)return;edit(()=>Review.addCheck(S.doc,v));draw(true);return}
  if(rv==='complete')return openComplete();
  const fs=b?.dataset.fstat;if(fs){ui.status=fs;draw(true);return}const cst=b?.dataset.cstat;if(cst){ui.cstatus=cst;draw(true);return}
  // findings
  const fc=t.closest('[data-fk]');if(fc){const it=issues.find(i=>i.key===fc.dataset.fk);if(!it)return;
    if(b?.dataset.fix){applyFix(it,b.dataset.fix);return}
    const st=b?.dataset.fs;if(st){if(st==='accept'){ui.accepting=it.key;draw(true);setTimeout(()=>$('rvAccNote')?.focus(),20);return}if(st==='cancel'){ui.accepting=null;draw(true);return}
      const note=st==='accepted'?$('rvAccNote')?.value.trim()||'':undefined;ui.accepting=null;edit(()=>Review.setFinding(S.doc,it,st,{by:me(),note}));recheck();draw(true);
      notify(st==='accepted'?'Accepted as intentional — it no longer counts.':st==='resolved'?'Marked resolved.':'Reopened.',1600);return}
    if(!b)goFinding(it);return}
  // comments
  const cc=t.closest('[data-ci]');if(cc){const c=Review.comment(S.doc,cc.dataset.ci);if(!c)return;
    const cs=b?.dataset.cs;if(cs){edit(()=>Review.setCommentStatus(S.doc,c.id,cs,me()));draw(true);render('overlay');return}
    const ca=b?.dataset.ca;
    if(ca==='reply'){ui.replying=c.id;ui.editing=null;draw(true);setTimeout(()=>$('rvReply')?.focus(),20);return}
    if(ca==='edit'){ui.editing=c.id;ui.replying=null;draw(true);setTimeout(()=>$('rvEdit')?.focus(),20);return}
    if(ca==='cancel'){ui.editing=ui.replying=null;draw(true);return}
    if(ca==='sendReply'){const v=$('rvReply').value;ui.replying=null;if(v.trim())edit(()=>Review.reply(S.doc,c.id,v,me()));draw(true);return}
    if(ca==='saveEdit'){const v=$('rvEdit').value;ui.editing=null;if(v.trim())edit(()=>Review.editComment(S.doc,c.id,v));draw(true);return}
    if(ca==='delete'){if(!confirm(`Delete comment #${c.n}?`))return;edit(()=>Review.removeComment(S.doc,c.id));draw(true);render('overlay');return}
    if(!b&&!t.closest('textarea'))goComment(c);return}
  // checklist
  const ck=t.closest('[data-ck]');if(ck){const id=ck.dataset.ck;if(b?.dataset.ckState!==undefined){edit(()=>Review.setCheck(S.doc,id,{state:b.dataset.ckState},me()));draw(true);return}
    if(b?.dataset.ckShow){open('findings',{cat:b.dataset.ckShow,status:'open'});const first=visible()[0];if(first)goFinding(first);return}
    if(b?.hasAttribute('data-ck-del')){edit(()=>Review.removeCheck(S.doc,id));draw(true)}return}
  // changes
  const cg=t.closest('[data-chg]');if(cg){const r=anyItem(cg.dataset.chg);if(!r)return;onPage(S.doc.pages.indexOf(r.p));select([r.n.id]);S.highlights=new Set([r.n.id]);view(C.bounds([r.n],true));render();return}
  const cr=t.closest('[data-chg-rem]');if(cr){const x=changesCache?.removed.find(y=>y.id===cr.dataset.chgRem);if(!x?.box)return notify('That item is gone; there is no record of where it was.');onPage(pageOfId(x.page));S.selected.clear();S.findMark={p:[x.box[0]+x.box[2]/2,x.box[1]+x.box[3]/2],page:S.pageIndex};view({x:x.box[0],y:x.box[1],w:x.box[2],h:x.box[3]});render();return}}
function onChange(e){const t=e.target;
  if(t.matches('[data-fcat]')){ui.cat=t.value;draw(true);return}
  if(t.matches('[data-rv-changes]')){ui.changes=t.checked;render('overlay');return}
  const ck=t.closest('[data-ck]');if(ck&&t.matches('[data-ck-note]')){edit(()=>Review.setCheck(S.doc,ck.dataset.ck,{note:t.value}));return}}
function onKey(e){const mod=e.ctrlKey||e.metaKey;if(e.key==='Enter'&&mod){if(e.target.id==='rvDraft'){e.preventDefault();saveDraft()}else if(e.target.id==='rvReply')$('sidePanel').querySelector('[data-ca="sendReply"]')?.click();else if(e.target.id==='rvEdit')$('sidePanel').querySelector('[data-ca="saveEdit"]')?.click()}
  if(e.key==='Enter'&&e.target.id==='rvNewCheck')$('sidePanel').querySelector('[data-rv="addCheck"]')?.click();
  if(e.key==='Enter'&&e.target.id==='rvAccNote')$('sidePanel').querySelector('[data-fs="accepted"]')?.click();
  if(e.key==='Escape'&&e.target.id==='rvDraft'){S.reviewDraft=null;draw(true);render('overlay')}
  e.stopPropagation()}

// ---------- fixes ----------
function applyFix(it,id){if(S.reviewMode)return notify('Leave review mode to fix things — review keeps the layout as it is.');
  if(id==='editData'){onPage(it.page);select(it.ids.filter(x=>find(x)));S.tab='data';S.side=null;draw(true);render();return}
  if(id==='fitpage'){onPage(it.page);mutate(()=>Constraints.fitPage(pg(),S.doc,pg().fit||{}));fit();recheck();draw(true);return notify('Page fitted to the drawing.',1800)}
  onPage(it.page);let msg=null;mutate(()=>{msg=Checks.apply(S.doc,it,id,{markDirty:Conn.markDirty})});if(!msg){notify('That no longer applies — checking again.');recheck();draw(true);return}
  // stay on the same spot in the list: the next finding moves up into it
  const list=visible(),i=list.findIndex(x=>x.key===it.key);S.highlights.clear();S.findMark=null;S.selected=new Set(it.ids.filter(x=>find(x)));recheck();const after=visible();cursor=(after[i]||after[i-1])?.key??null;render();draw(true);notify(msg,1800)}

// ---------- canvas overlay: pins, the comment being placed, change highlights, finding marker ----------
function drawOverlay(o,z){const page=pg(),pid=page.id;
  if(S.side==='changes'&&ui.changes&&changesCache?.known){const ch=changesCache;for(const[ids,col]of[[ch.added,'#16a34a'],[ch.modified,'#d97706']])for(const id of ids){const n=find(id);if(!n)continue;const b=C.bounds([n],n.kind!=='edge');el('rect',{x:b.x-6/z,y:b.y-6/z,width:b.w+12/z,height:b.h+12/z,rx:5/z,fill:col,'fill-opacity':.08,stroke:col,'stroke-width':2/z,'pointer-events':'none'},o)}
    for(const x of ch.removed)if(x.page===pid&&x.box){const[bx,by,bw,bh]=x.box;el('rect',{x:bx,y:by,width:bw,height:bh,rx:4/z,fill:'#dc2626','fill-opacity':.06,stroke:'#dc2626','stroke-width':1.5/z,'stroke-dasharray':`${5/z} ${4/z}`,'pointer-events':'none'},o);const t=el('text',{x:bx,y:by-5/z,fill:'#dc2626','font-size':11/z,'font-family':C.FONT,'font-weight':600,'pointer-events':'none'},o);t.textContent='Removed: '+(x.name||'item')}}
  if(S.findMark&&S.findMark.page===S.pageIndex){const[x,y]=S.findMark.p,c=el('circle',{cx:x,cy:y,r:12/z,fill:'none',stroke:'#dc2626','stroke-width':2.5/z,'pointer-events':'none'},o);const a=el('animate',{attributeName:'r',values:`${9/z};${17/z};${9/z}`,dur:'1.4s',repeatCount:'indefinite'},c)}
  const show=S.reviewMode||S.side==='comments'||S.prefs.showComments!==false;
  if(show)for(const c of comments()){if(c.page!==pid||!S.reviewMode&&S.side!=='comments'&&c.status!=='open')continue;const col=COLORS[c.status]||COLORS.open,act=ui.focus===c.id;
    if(c.area)el('rect',{x:c.area.x,y:c.area.y,width:c.area.w,height:c.area.h,rx:4/z,fill:col,'fill-opacity':act?.1:.05,stroke:col,'stroke-width':(act?2:1.4)/z,'stroke-dasharray':`${6/z} ${4/z}`,'pointer-events':'none'},o);
    pin(o,z,Review.pinAt(c,find),String(c.n),col,act,c.id,c.status!=='open')}
  const d=S.reviewDraft;if(d&&d.page===pid){if(d.area)el('rect',{x:d.area.x,y:d.area.y,width:d.area.w,height:d.area.h,rx:4/z,fill:'#376be5','fill-opacity':.08,stroke:'#376be5','stroke-width':2/z,'stroke-dasharray':`${6/z} ${4/z}`,'pointer-events':'none'},o);pin(o,z,Review.pinAt(d,find),'+','#376be5',true)}
  const dr=S.drag;if(dr?.kind==='comment'&&dr.current){const p=dr.current,s=dr.start;el('rect',{x:Math.min(p[0],s[0]),y:Math.min(p[1],s[1]),width:Math.abs(p[0]-s[0]),height:Math.abs(p[1]-s[1]),fill:'#376be5','fill-opacity':.06,stroke:'#376be5','stroke-width':1.5/z,'stroke-dasharray':`${6/z} ${4/z}`,'pointer-events':'none'},o)}}
function pin(o,z,p,text,col,act,id,faded){const g=el('g',{transform:`translate(${p[0]} ${p[1]}) scale(${1/z})`,'data-role':id?'pin':null,'data-comment':id||null,cursor:id?'pointer':null,opacity:faded?.7:null},o);
  el('path',{d:'M0 0 L-5 -9 A11 11 0 1 1 5 -9 Z',transform:'translate(0 0)',fill:col,stroke:'#fff','stroke-width':act?2.5:1.5},g);if(act)el('circle',{cx:0,cy:-17,r:15,fill:'none',stroke:col,'stroke-width':1.5,'stroke-opacity':.5},g);
  const t=el('text',{x:0,y:-13,'text-anchor':'middle','font-size':text.length>2?9:11,'font-weight':700,fill:'#fff','font-family':C.FONT,'pointer-events':'none'},g);t.textContent=text}

// ---------- complete review, report ----------
function openComplete(){const cs=comments(),openC=cs.filter(c=>c.status==='open').length,openF=issues.filter(i=>i.status==='open').length,cl=Review.checklist(S.doc,issues);
  const d=openDialog('Complete review',`<p>This records the review${me()?' by '+h(me()):''} and makes the drawing as it is now the starting point for the next one, which will show what changed since.</p>
    <div class="kpis k3"><div><b>${openC}</b><span>open comments</span></div><div><b>${openF}</b><span>open findings</span></div><div><b>${cl.filter(x=>x.state==='ok').length}/${cl.length}</b><span>checks passed</span></div></div>
    <label class="fld"><span>Reviewer</span><input id="rvBy" value="${h(me())}" placeholder="Your name"></label><p class="muted">Open comments and findings stay open and carry over to the next review.</p>
    <footer><button data-close>Cancel</button><button data-rc="report">Report first…</button><button class="primary" data-rc="go">Complete review</button></footer>`);
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const a=e.target.closest('[data-rc]')?.dataset.rc;if(!a)return;const by=$('rvBy').value.trim();if(by!==(S.prefs.reviewer||'')){S.prefs.reviewer=by;savePrefs()}
    if(a==='report'){closeDialog();return openReport()}closeDialog();edit(()=>Review.complete(S.doc,{by,issues,nameOf:n=>n.kind==='edge'?edgeName(n,pg()):Analysis.nameOf(n)}));recheck();draw(true);render('overlay');notify('Review completed. The next review will show what changed from here.',3200)}}
function images(rep){const pins=new Map();for(const c of comments()){const k=c.page;if(!pins.has(k))pins.set(k,[]);pins.get(k).push(c)}
  const pages=S.doc.pages.filter(p=>!p.isBackground),want=pages.filter(p=>pins.has(p.id)||issues.some(i=>i.status==='open'&&S.doc.pages[i.page]===p));
  return(want.length?want:pages).slice(0,20).map(p=>{const svg=sceneSvg(p,{print:true,pad:12,area:{x:0,y:0,...C.pageSize(p)}}),f=id=>p.items.find(n=>n.id===id),g=document.createElementNS(svg.namespaceURI,'g');svg.append(g);const z=Math.max(.6,C.pageSize(p).w/1400);
    for(const c of pins.get(p.id)||[]){if(c.area)el('rect',{x:c.area.x,y:c.area.y,width:c.area.w,height:c.area.h,fill:'none',stroke:COLORS[c.status],'stroke-width':1.5*z,'stroke-dasharray':`${6*z} ${4*z}`},g);pin(g,1/z,Review.pinAt(c,f),String(c.n),COLORS[c.status]||COLORS.open,false)}
    for(const n of svg.querySelectorAll('[data-role],[data-id]')){n.removeAttribute('data-role');n.removeAttribute('data-id')}
    return{page:p.name,svg:new XMLSerializer().serializeToString(svg)}})}
function openReport(){recheck();const d=openDialog('Review report',`<p class="muted">One document with the checklist, every comment with its replies, everything the check flagged and what changed since the previous review — unresolved items first.</p>
    <label class="fld"><span>Reviewer</span><input id="rpBy" value="${h(me())}" placeholder="Your name"></label>
    <label class="check"><input type="checkbox" id="rpImg" checked>Include the pages, with the comment pins</label><label class="check"><input type="checkbox" id="rpAcc" checked>Include findings accepted as intentional</label>
    <footer><button data-rp="csv">CSV</button><span class="spacer"></span><button data-rp="print">Print / PDF</button><button class="primary" data-rp="html">Download report</button></footer>`);
  d.onclick=e=>{if(e.target.closest('[data-close]'))return closeDialog();const a=e.target.closest('[data-rp]')?.dataset.rp;if(!a)return;const by=$('rpBy').value.trim();if(by&&by!==S.prefs.reviewer){S.prefs.reviewer=by;savePrefs()}
    const rep=Review.report(S.doc,{issues,by,includeAccepted:$('rpAcc').checked,name:itemName,where:p=>typeof p==='number'?S.doc.pages[p]?.name||'':S.doc.pages.find(x=>x.id===p)?.name||''}),base=safeName(S.doc.name+' - review '+new Date().toISOString().slice(0,10));
    if(a==='csv'){download(base+'.csv','﻿'+Review.toCSV(rep),'text/csv');closeDialog();return}
    const doc=Review.toHTML(rep,$('rpImg').checked?images(rep):[]);closeDialog();
    if(a==='html'){download(base+'.html',doc,'text/html');notify('Review report downloaded — open it in a browser, or print it to PDF.',3200);return}
    const f=document.createElement('iframe');f.style.cssText='position:fixed;width:0;height:0;border:0;right:0;bottom:0';document.body.append(f);f.onload=()=>{try{f.contentWindow.focus();f.contentWindow.print()}finally{setTimeout(()=>f.remove(),60000)}};f.srcdoc=doc}}

// ---------- hooks for the rest of the app ----------
// After every check (the status bar runs one shortly after each change): keep the panel current.
function update(list){issues=list;if(S.side){changes();draw()}}
function onSelect(){if(S.side==='comments'&&S.reviewMode)draw()}
// Status bar: review mode (click to leave it), or how many comments are open.
function badge(){const b=$('reviewBadge');if(!b)return;const n=(S.doc.review?.comments||[]).filter(c=>c.status==='open').length;b.hidden=!S.reviewMode&&!n;b.classList.toggle('on',!!S.reviewMode);
  b.innerHTML=S.reviewMode?`${icon('review',13)} Reviewing · exit`:`${icon('comment',13)} ${n} open`;b.title=S.reviewMode?'Review mode — click to go back to editing':`${plural(n,'open comment')} — click to review`}
function init(){window.addEventListener('error',e=>{if(e.error?.name==='ReviewLock')e.preventDefault()});window.addEventListener('unhandledrejection',e=>{if(e.reason?.name==='ReviewLock')e.preventDefault()});
  for(const k of Object.keys(actions)){const f=actions[k];if(typeof f==='function')actions[k]=(...a)=>guard(k)?f(...a):blocked()}
  const box=$('sidePanel');box.addEventListener('click',onClick);box.addEventListener('change',onChange);box.addEventListener('keydown',onKey);box.addEventListener('focusout',()=>setTimeout(()=>{if(ui.pending&&!box.contains(document.activeElement))draw(true)},0))}
// Edit commands refused in review mode (looking, checking, exporting and review commands still work).
const SAFE=new Set(['save','saveAs','open','new','newBlank','myDrawings','importVisio','share','print','printAll','exportPng','exportPng4','exportPngT','exportSvg','exportVsdx','exportDrawio','copyPng','downloadOffline','closePrint','printNow',
  'copy','selectAll','selectNone','selectByType','invertSel','find','palette','help','shortcuts','about','tour','check','spof','trace','traceFrom','traffic','poeBudget','storage','filter','clearAnalysis',
  'repInventory','repCables','repBom','repRack','repVlan','repIp','repPoe','repCctv','exportCsv','fit','fitSelection','zoom100','zoomIn','zoomOut','present','fullscreen','focusMode','resetLayout','toggleLeft','toggleRight','toggleRibbon','toggleHeader','toggleStatus','uiTheme','docProps',
  'reviewMode','reviewComment','reviewFindings','reviewChecklist','reviewChanges','reviewReport','reviewComplete','checkConnections','checkLabels','checkReadability','nextFinding','prevFinding']);
const guard=k=>!S.reviewMode||SAFE.has(k)||k.startsWith('toggle_');
function blocked(){notify('Review mode keeps the layout as it is — exit review mode to edit.',2600)}

return{badge,open,close,toggleMode,setMode:setMode2,step,goFinding,focusComment,commentAt,draftFor,drawOverlay,update,onSelect,init,draw,recheck,guard,blocked,openReport,openComplete,get issues(){return issues}};
})();
