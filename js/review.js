// Review mode data, kept in doc.review: pinned comments (on a device, a connector, an area or a point), the status of
// check findings (open / resolved / accepted as intentional), the review checklist, the snapshot taken when a review
// is completed (so the next one can show what changed since), and the review report as HTML or CSV. Pure.
const Review=(()=>{
const C=Core;
const now=()=>new Date().toISOString();
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STATUS={open:'Open',resolved:'Resolved',accepted:'Accepted'};
const CHECKS=[
  ['connectivity','Connectivity','Every link is attached at both ends, nothing connects to itself and no port carries two cables.'],
  ['labels','Labels','Every label belongs to its device or link, says what its data says and shows no empty fields.'],
  ['data','Device data','Names, hostnames, IP addresses, serial numbers and cable IDs are valid and unique.'],
  ['readability','Readability','Nothing overlaps or hides, no line runs through a device, everything is on the page.'],
  ['design','Network design','Subnets, PoE, racks, resilience and capacity hold up.']];
function ensure(doc){const r=doc.review??={};r.comments??=[];r.findings??={};r.history??=[];
  if(!Array.isArray(r.checklist))r.checklist=CHECKS.map(([id,label,hint])=>({id,label,hint,cat:id,state:'',by:'',at:'',note:''}));
  r.next=Math.max(r.next||1,1+Math.max(0,...r.comments.map(c=>+c.n||0)));return r}

// ---------- comments ----------
function addComment(doc,{page,target=null,rel=null,pos=null,area=null,text='',by=''}){const r=ensure(doc),c={id:C.uid(),n:r.next++,page,target,rel,pos,area,text:String(text).trim(),by,at:now(),status:'open',replies:[]};r.comments.push(c);return c}
const comment=(doc,id)=>doc.review?.comments?.find(c=>c.id===id)||null;
function editComment(doc,id,text){const c=comment(doc,id);if(c){c.text=String(text).trim();c.edited=now()}return c}
function setCommentStatus(doc,id,status,by=''){const c=comment(doc,id);if(c&&STATUS[status]){c.status=status;c.statusBy=by;c.statusAt=now()}return c}
function reply(doc,id,text,by=''){const c=comment(doc,id);if(c&&String(text).trim())c.replies.push({id:C.uid(),text:String(text).trim(),by,at:now()});return c}
function removeComment(doc,id){const r=ensure(doc);r.comments=r.comments.filter(c=>c.id!==id)}
function along(pts,t){let total=0;for(let i=1;i<pts.length;i++)total+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);let goal=total*t,run=0;
  for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(run+l>=goal){const k=l?(goal-run)/l:0;return[pts[i-1][0]+k*(pts[i][0]-pts[i-1][0]),pts[i-1][1]+k*(pts[i][1]-pts[i-1][1])]}run+=l}return pts.at(-1)}
// Where a comment's pin sits: on its target (which it follows), at its area's top-right corner, or on its point.
function pinAt(c,find){const t=c.target&&find(c.target);if(t){if(t.kind==='edge')return along(t.points,c.rel?.[0]??.5);const b=C.box(t);return[b.x+b.w*(c.rel?.[0]??1),b.y+b.h*(c.rel?.[1]??0)]}
  if(c.area)return[c.area.x+c.area.w,c.area.y];return c.pos||[0,0]}
// Pin offset for a click at p on target t: a fraction of its box, or how far along a connector.
function relFor(t,p){if(t.kind==='edge'){let best=Infinity,bt=.5,total=0;const pts=t.points,lens=[];for(let i=1;i<pts.length;i++){const l=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);lens.push(l);total+=l}
    let run=0;for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],vx=b[0]-a[0],vy=b[1]-a[1],L=vx*vx+vy*vy||1,k=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/L)),d=Math.hypot(a[0]+k*vx-p[0],a[1]+k*vy-p[1]);if(d<best){best=d;bt=total?(run+k*lens[i-1])/total:.5}run+=lens[i-1]}return[+bt.toFixed(4)]}
  const b=C.box(t);return[+Math.max(0,Math.min(1,(p[0]-b.x)/(b.w||1))).toFixed(4),+Math.max(0,Math.min(1,(p[1]-b.y)/(b.h||1))).toFixed(4)]}

// ---------- findings ----------
// Status of a finding is kept by its key; reopening without a note forgets it.
function setFinding(doc,issue,status,{by='',note}={}){const r=ensure(doc),cur=r.findings[issue.key],n=note??cur?.note??'';if(status==='open'&&!n){delete r.findings[issue.key];return null}
  return r.findings[issue.key]={status,by,at:now(),note:n,message:issue.message,rule:issue.rule,cat:issue.cat,severity:issue.severity}}
// Marked findings the check no longer reports, and findings left open at the last review that are gone now.
function fixed(doc,issues){const live=new Set(issues.map(i=>i.key)),out=new Map();
  for(const[key,v]of Object.entries(doc.review?.findings||{}))if(!live.has(key))out.set(key,{key,...v});
  for(const f of doc.review?.baseline?.findings||[])if(!live.has(f.key)&&!out.has(f.key))out.set(f.key,{...f,status:'fixed'});return[...out.values()]}

// ---------- checklist ----------
function checklist(doc,issues=[]){return ensure(doc).checklist.map(it=>{const open=it.cat?issues.filter(i=>i.cat===it.cat&&i.status==='open'):[];return{...it,open:open.length,errors:open.filter(i=>i.severity==='error').length}})}
function setCheck(doc,id,patch,by=''){const it=ensure(doc).checklist.find(x=>x.id===id);if(it){Object.assign(it,patch);if('state'in patch){it.by=patch.state?by:'';it.at=patch.state?now():''}}return it}
function addCheck(doc,label){const it={id:C.uid(),label:String(label).trim()||'Check',hint:'',cat:null,state:'',by:'',at:'',note:''};ensure(doc).checklist.push(it);return it}
function removeCheck(doc,id){const r=ensure(doc);r.checklist=r.checklist.filter(x=>x.id!==id||x.cat)}

// ---------- comparison with the previous review ----------
const tracked=n=>!['revcloud','revdelta'].includes(n.type)&&n.kind!=='legend'&&!n.revTable&&n.pin!=='frame';
const plainName=n=>String(n.labels?.[0]?.text||n.data?.hostname||n.type||n.kind||'');
function snapshot(doc,nameOf=plainName){const items={},boxes={};for(const p of doc.pages)for(const n of p.items){if(!tracked(n))continue;items[n.id]=Revisions.fingerprint(n);const b=C.bounds([n]);
  boxes[n.id]={page:p.id,box:[b.x,b.y,b.w,b.h].map(v=>Math.round(v*10)/10),name:String(nameOf(n)||'').split('\n')[0].slice(0,80),kind:n.kind}}return{items,boxes}}
function complete(doc,{by='',issues=[],nameOf}={}){const r=ensure(doc),open=issues.filter(i=>i.status==='open');
  r.history.push({at:now(),by,openComments:r.comments.filter(c=>c.status==='open').length,openFindings:open.length,checked:r.checklist.filter(x=>x.state==='ok').length});
  r.baseline={at:now(),by,...snapshot(doc,nameOf),findings:open.map(i=>({key:i.key,message:i.message,severity:i.severity,cat:i.cat}))};return r.baseline}
// What changed since the last completed review; before the first one, since the last issued revision.
function changes(doc){const base=doc.review?.baseline;
  if(!base){const rb=doc.revBaseline;if(!rb?.items)return{known:false,added:[],modified:[],removed:[],count:0,since:null};const ch=Revisions.changes(doc);return{...ch,removed:ch.removed.map(id=>({id})),since:{kind:'revision',rev:rb.rev,at:rb.at}}}
  const seen=new Set(),added=[],modified=[];for(const p of doc.pages)for(const n of p.items){if(!tracked(n))continue;seen.add(n.id);const f=base.items[n.id];if(f==null)added.push(n.id);else if(f!==Revisions.fingerprint(n))modified.push(n.id)}
  const removed=Object.keys(base.items).filter(id=>!seen.has(id)).map(id=>({id,...(base.boxes?.[id]||{})}));
  return{known:true,added,modified,removed,count:added.length+modified.length+removed.length,since:{kind:'review',at:base.at,by:base.by}}}

// ---------- report ----------
// ctx: issues (annotated with status), name(id) → item name, where(pageRef) → page name, by, images [{page, svg}]
function report(doc,{issues=[],name=id=>id,where=p=>p,by='',includeAccepted=true}={}){const r=ensure(doc),ch=changes(doc),cl=checklist(doc,issues);
  const comments=r.comments.slice().sort((a,b)=>a.n-b.n).map(c=>({n:c.n,page:where(c.page),on:c.target?name(c.target)||'(deleted item)':c.area?'Area':'Point',text:c.text,by:c.by,at:c.at,status:c.status,replies:c.replies||[]}));
  const findings=issues.filter(i=>includeAccepted||i.status!=='accepted').map(i=>({severity:i.severity,cat:i.cat,message:i.message,page:i.page>=0?where(i.page):'Whole drawing',status:i.status,note:i.note||'',by:r.findings[i.key]?.by||''}));
  const count=(list,s)=>list.filter(x=>x.status===s).length;
  return{drawing:doc.name,revision:doc.meta?.revision||'',by,date:now(),comments,findings,fixed:fixed(doc,issues),checklist:cl,
    changes:{since:ch.since,known:ch.known,added:ch.added.map(name),modified:ch.modified.map(name),removed:ch.removed.map(x=>x.name||name(x.id)||'(item)')},
    counts:{comments:{open:count(comments,'open'),resolved:count(comments,'resolved'),accepted:count(comments,'accepted')},findings:{open:count(findings,'open'),resolved:count(findings,'resolved'),accepted:count(findings,'accepted'),errors:findings.filter(f=>f.status==='open'&&f.severity==='error').length},checked:cl.filter(x=>x.state==='ok').length,checks:cl.length}}}
const day=s=>s?String(s).slice(0,16).replace('T',' '):'';
const CAT={connectivity:'Connection integrity',labels:'Labels',data:'Device data',readability:'Readability',design:'Network design'};
function toHTML(d,images=[]){const pill=s=>`<span class="pill ${esc(s)}">${esc(STATUS[s]||s)}</span>`,sev=s=>`<span class="sev ${esc(s)}">${esc({error:'Error',warning:'Warning',info:'Note'}[s]||s)}</span>`;
  const open=[...d.comments.filter(c=>c.status==='open').map(c=>`<tr><td>Comment #${c.n}</td><td>${esc(c.page)}</td><td>${esc(c.on)}</td><td>${esc(c.text)}</td><td>${esc(c.by)}</td></tr>`),...d.findings.filter(f=>f.status==='open'&&f.severity!=='info').map(f=>`<tr><td>${sev(f.severity)}</td><td>${esc(f.page)}</td><td>${esc(CAT[f.cat]||'')}</td><td>${esc(f.message)}</td><td></td></tr>`)];
  const notes=d.findings.filter(f=>f.status==='open'&&f.severity==='info').length,ch=d.changes,since=ch.since?ch.since.kind==='review'?`since the review of ${day(ch.since.at)}${ch.since.by?' by '+esc(ch.since.by):''}`:`since revision ${esc(ch.since.rev)} was issued`:'';
  return`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Review — ${esc(d.drawing)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>
body{font:13px/1.45 'Segoe UI',Inter,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:#1f2f47;margin:0;padding:32px;max-width:1100px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:2px solid #376be5;padding-bottom:4px}
.meta{color:#64748b}.cards{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.cards div{border:1px solid #dfe6ef;border-radius:10px;padding:10px 14px;min-width:150px}.cards b{display:block;font-size:20px}
table{border-collapse:collapse;width:100%;margin:4px 0 8px}th,td{border:1px solid #dfe6ef;padding:5px 7px;text-align:left;vertical-align:top}th{background:#f1f5f9;font-weight:600}
.pill,.sev{display:inline-block;border-radius:10px;padding:0 8px;font-size:11.5px;font-weight:600}.pill.open{background:#fef3c7;color:#92400e}.pill.resolved,.pill.fixed{background:#dcfce7;color:#166534}.pill.accepted{background:#e2e8f0;color:#334155}
.sev.error{background:#fee2e2;color:#991b1b}.sev.warning{background:#fef3c7;color:#92400e}.sev.info{background:#dbeafe;color:#1e40af}.reply{color:#475569;margin-top:4px}.muted{color:#64748b}
figure{margin:12px 0;break-inside:avoid}figure svg{width:100%;height:auto;border:1px solid #dfe6ef}figcaption{font-weight:600;margin-bottom:4px}@media print{body{padding:0}h2{break-after:avoid}}</style></head><body>
<h1>Review — ${esc(d.drawing)}</h1><div class="meta">Revision ${esc(d.revision)} · reviewed${d.by?' by '+esc(d.by):''} · ${esc(day(d.date))}</div>
<div class="cards"><div><b>${open.length}</b>unresolved item${open.length===1?'':'s'}</div><div><b>${d.counts.comments.open}</b>open comments of ${d.comments.length}</div><div><b>${d.counts.findings.open}</b>open finding${d.counts.findings.open===1?'':'s'}${d.counts.findings.errors?` · ${d.counts.findings.errors} error${d.counts.findings.errors===1?'':'s'}`:''}</div><div><b>${d.counts.checked}/${d.counts.checks}</b>checks passed</div><div><b>${ch.added.length+ch.modified.length+ch.removed.length}</b>changes ${since||''}</div></div>
<h2>Unresolved</h2>${open.length?`<table><tr><th>Item</th><th>Page</th><th>On / category</th><th>Description</th><th>By</th></tr>${open.join('')}</table>`:'<p class="muted">Nothing unresolved.</p>'}${notes?`<p class="muted">Plus ${notes} open note${notes===1?'':'s'} from the design check — listed below.</p>`:''}
<h2>Checklist</h2><table><tr><th>Check</th><th>Result</th><th>Open findings</th><th>Note</th><th>By</th></tr>${d.checklist.map(c=>`<tr><td><b>${esc(c.label)}</b>${c.hint?`<div class="muted">${esc(c.hint)}</div>`:''}</td><td>${c.state==='ok'?'✓ Passed':c.state==='issues'?'✗ Needs work':'Not checked'}</td><td>${c.cat?c.open:''}</td><td>${esc(c.note)}</td><td>${esc(c.by)}${c.at?`<div class="muted">${esc(day(c.at))}</div>`:''}</td></tr>`).join('')}</table>
<h2>Comments</h2>${d.comments.length?`<table><tr><th>#</th><th>Page</th><th>On</th><th>Comment</th><th>By</th><th>Status</th></tr>${d.comments.map(c=>`<tr><td>${c.n}</td><td>${esc(c.page)}</td><td>${esc(c.on)}</td><td>${esc(c.text)}${c.replies.map(x=>`<div class="reply">↳ ${esc(x.text)} — ${esc(x.by)} ${esc(day(x.at))}</div>`).join('')}</td><td>${esc(c.by)}<div class="muted">${esc(day(c.at))}</div></td><td>${pill(c.status)}</td></tr>`).join('')}</table>`:'<p class="muted">No comments.</p>'}
<h2>Flagged by the design check</h2>${d.findings.length?`<table><tr><th>Severity</th><th>Category</th><th>Finding</th><th>Page</th><th>Status</th><th>Note</th></tr>${d.findings.map(f=>`<tr><td>${sev(f.severity)}</td><td>${esc(CAT[f.cat]||'')}</td><td>${esc(f.message)}</td><td>${esc(f.page)}</td><td>${pill(f.status)}</td><td>${esc(f.note)}</td></tr>`).join('')}</table>`:'<p class="muted">The check found nothing.</p>'}
${d.fixed.length?`<h2>Fixed since</h2><table><tr><th>Finding</th><th>Status</th></tr>${d.fixed.map(f=>`<tr><td>${esc(f.message)}</td><td>${pill(f.status==='fixed'?'fixed':f.status)}</td></tr>`).join('')}</table>`:''}
<h2>Changes ${since}</h2>${ch.known?[['Added',ch.added],['Changed',ch.modified],['Removed',ch.removed]].map(([t,l])=>`<p><b>${t} (${l.length})</b>${l.length?': '+l.map(esc).join(', '):''}</p>`).join(''):'<p class="muted">No earlier review or issued revision to compare with.</p>'}
${images.length?`<h2>Drawing</h2>${images.map(i=>`<figure><figcaption>${esc(i.page)}</figcaption>${i.svg}</figure>`).join('')}`:''}
</body></html>`}
function toCSV(d){const q=v=>{const s=String(v??'');return/[",\n;]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};const rows=[['Type','Ref','Page','On / category','Text','Severity','Status','By','Date','Note / replies']];
  for(const c of d.comments)rows.push(['Comment','#'+c.n,c.page,c.on,c.text,'',c.status,c.by,day(c.at),c.replies.map(x=>`${x.by}: ${x.text}`).join(' | ')]);
  for(const f of d.findings)rows.push(['Finding','',f.page,CAT[f.cat]||'',f.message,f.severity,f.status,f.by,'',f.note]);
  for(const c of d.checklist)rows.push(['Check','',"",c.label,c.hint,'',c.state==='ok'?'passed':c.state==='issues'?'needs work':'not checked',c.by,day(c.at),c.note]);
  return rows.map(r=>r.map(q).join(',')).join('\r\n')}

return{STATUS,CHECKS,ensure,addComment,comment,editComment,setCommentStatus,reply,removeComment,pinAt,relFor,setFinding,fixed,checklist,setCheck,addCheck,removeCheck,snapshot,complete,changes,report,toHTML,toCSV};
})();
if(typeof module!=='undefined')module.exports=Review;
