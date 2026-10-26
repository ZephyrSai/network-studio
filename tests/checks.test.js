// Drawing-quality checks (connection integrity, labels & data, readability), their fixes, and the review model.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','revisions.js','checks.js','review.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes)=/,'\nvar $1='),ctx);
  vm.runInContext("var S={prefs:{},doc:{display:{fields:[]}}};",ctx);return ctx}
const X=sandbox(),{Core:C,Shapes,Checks,Review,Revisions}=X;
function doc(){const d=C.newDoc('t');return{d,p:d.pages[0],items:d.pages[0].items}}
const dev=(items,type,x,y,name,data={})=>{const n=Shapes.make(type,x,y,name);n.data={...n.data,...data};items.push(n);return n};
const link=(items,a,b,pts)=>{const e=C.edge(pts||[C.center(a),C.center(b)],a&&{node:a.id,port:null},b&&{node:b.id,port:null});e.routing='straight';items.push(e);return e};
const rules=(d,r)=>Checks.run(d).filter(i=>i.rule===r);

test('unattached lines and dangling ends name the device they stop at, and attach to it',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01'),b=dev(items,'router',400,100,'R-01');
  const free=link(items,null,null,[[190,122],[395,122]]);let f=rules(d,'unattached');assert.equal(f.length,1);assert.match(f[0].message,/SW-01.*R-01/);assert.deepEqual(f[0].fixes.map(x=>x.id),['attach','delete']);
  assert.ok(Checks.apply(d,f[0],'attach'));assert.equal(free.from.node,a.id);assert.equal(free.to.node,b.id);assert.equal(rules(d,'unattached').length,0);
  const e=link(items,a,null,[[184,140],[402,150]]);f=rules(d,'dangling');assert.equal(f.length,1);assert.match(f[0].message,/stops at “R-01”/);const dirty=[];Checks.apply(d,f[0],'attach',{markDirty:id=>dirty.push(id)});assert.equal(e.to.node,b.id);assert.deepEqual(dirty,[e.id]);
  const loose=link(items,a,null,[[184,140],[260,400]]);f=rules(d,'dangling');assert.equal(f.length,1);assert.match(f[0].message,/loose end/);assert.deepEqual(f[0].fixes.map(x=>x.id),['delete']);assert.deepEqual(f[0].at,[260,400]);
  Checks.apply(d,f[0],'delete');assert.ok(!items.includes(loose))});

test('self-connections and ports carrying two cables (a patch-panel port may take two)',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01'),b=dev(items,'server',400,100,'SRV-1'),c=dev(items,'server',400,300,'SRV-2');
  const loop=link(items,a,a,[[100,100],[90,90]]);assert.equal(rules(d,'selfloop').length,1);
  const e1=link(items,a,b),e2=link(items,a,c);e1.fromIf='Gi1/0/1';e2.fromIf='gi1/0/1 ';let f=rules(d,'reuse');assert.equal(f.length,1);assert.match(f[0].message,/Port “Gi1\/0\/1” on “SW-01” is used by 2/);
  e2.fromIf='Gi1/0/2';assert.equal(rules(d,'reuse').length,0);
  const pp=dev(items,'patchpanel',100,400,'PP-1');pp.ports.push({id:'p1',name:'F01',x:.1,y:1});const x1=link(items,pp,b),x2=link(items,pp,c);x1.from.port='p1';x2.from.port='p1';assert.equal(rules(d,'reuse').length,0,'front and back of a patch port');
  const x3=link(items,pp,a);x3.from.port='p1';assert.equal(rules(d,'reuse').length,1);
  const lg=link(items,a,b);lg.fromIf='Gi1/0/1';lg.linkType='logical';assert.equal(rules(d,'reuse').length,1,'logical overlays do not count');
  assert.ok(loop)});

test('free text on a device is found and attached so it moves with it',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01');const t=C.text('10.0.0.9',120,165,90,20,11);items.push(t);
  const far=C.text('Notes about the site',600,600,200,30,11);items.push(far);
  const f=rules(d,'freelabel');assert.equal(f.length,1);assert.match(f[0].message,/10\.0\.0\.9.*SW-01/);const before=a.labels.length,pos=[t.labels[0].x,t.labels[0].y];
  Checks.apply(d,f[0],'attach');assert.ok(!items.includes(t));assert.equal(a.labels.length,before+1);assert.deepEqual([a.labels.at(-1).x,a.labels.at(-1).y],pos);C.move(a,10,0);assert.equal(a.labels.at(-1).x,pos[0]+10);assert.equal(rules(d,'freelabel').length,0)});

test('labels that disagree with the data: IP, VLAN, subnet and speed — and both fixes',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01',{ip:'10.0.0.6'});a.labels[0].text='SW-01\n10.0.0.5';
  let f=rules(d,'mismatch');assert.equal(f.length,1);assert.match(f[0].message,/shows 10\.0\.0\.5.*is 10\.0\.0\.6/);Checks.apply(d,f[0],'useData');assert.equal(a.labels[0].text,'SW-01\n10.0.0.6');assert.equal(rules(d,'mismatch').length,0);
  a.labels[0].text='SW-01\n10.0.0.7';Checks.apply(d,rules(d,'mismatch')[0],'useLabel');assert.equal(a.data.ip,'10.0.0.7');
  a.labels[0].text='SW-01 · 10.0.0.0/24 · {{ip}}';assert.equal(rules(d,'mismatch').length,0,'subnets and placeholders are not stray IPs');
  const z=C.zone('Floor 1 · VLAN 10 · 10.1.0.0/24',0,300,400,200);z.data={vlan:'20',subnet:'10.2.0.0/24'};items.push(z);f=rules(d,'mismatch');assert.deepEqual(f.map(i=>i.sub).sort(),['subnet:10.1.0.0/24','vlan:10']);
  for(const i of f)Checks.apply(d,i,'useData');assert.equal(z.labels[0].text,'Floor 1 · VLAN 20 · 10.2.0.0/24');
  const b=dev(items,'router',400,100,'R-01'),e=link(items,a,b);e.data={speed:'10G'};e.labels=[C.label('1G uplink',300,100,10)];f=rules(d,'mismatch');assert.equal(f.length,1);Checks.apply(d,f[0],'useLabel');assert.equal(e.data.speed,'1G');
  const lone=dev(items,'server',600,100,'SRV\n192.168.1.4');f=rules(d,'labelonly');assert.equal(f.length,1);Checks.apply(d,f[0],'useLabel');assert.equal(lone.data.ip,'192.168.1.4')});

test('empty {{field}} labels, duplicate names and duplicate identifiers',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'{{hostname}} {{serial}}',{hostname:'sw1'});
  let f=rules(d,'placeholder');assert.equal(f.length,1);assert.equal(f[0].sub,'serial');
  dev(items,'wap',300,100,'AP-01');dev(items,'wap',500,100,'AP-01');dev(items,'nvr',700,100,'LTE backup');dev(items,'nvr',900,100,'LTE backup');dev(items,'camera',100,300,'');dev(items,'camera',300,300,'');dev(items,'camera',500,300,'Camera');
  f=rules(d,'dupname');assert.equal(f.length,1,'default names are left alone');assert.equal(f[0].ids.length,2);
  const p2=C.page('Two');d.pages.push(p2);a.data.serial='FOC123';dev(p2.items,'server',0,0,'S',{serial:'foc123'});f=rules(d,'dupid');assert.equal(f.length,1);assert.equal(f[0].severity,'error');assert.equal(f[0].ids.length,2)});

test('readability: overlapping labels move apart, hidden and tiny text, lines through devices',()=>{const{d,items}=doc();
  const t1=C.text('Core uplinks',100,100,120,20,12),t2=C.text('Core uplinks B',104,102,120,20,12);items.push(t1,t2);let f=rules(d,'labeloverlap');assert.equal(f.length,1);Checks.apply(d,f[0],'apart');assert.equal(rules(d,'labeloverlap').length,0);
  const w=C.text('ghost',300,100,100,20,12);w.labels[0].color='#fefefe';items.push(w);f=rules(d,'hiddentext');assert.equal(f.length,1);assert.equal(f[0].sub.split(':')[0],'contrast');Checks.apply(d,f[0],'contrast');assert.equal(rules(d,'hiddentext').length,0);
  const under=C.text('under',500,100,80,20,12);items.push(under);const box=Shapes.make('rect',490,90,'');box.fill='#334155';box.w=120;box.h=60;box.labels=[];items.push(box);
  f=rules(d,'hiddentext');assert.equal(f.length,1);assert.match(f[0].message,/hidden behind/);Checks.apply(d,f[0],'front');assert.equal(items.at(-1),under);assert.equal(rules(d,'hiddentext').length,0);
  const tiny=C.text('fine print',100,400,80,20,4);items.push(tiny);assert.equal(rules(d,'tinytext').length,1);
  const a=dev(items,'switch',100,600,'A'),mid=dev(items,'firewall',300,600,'FW'),b=dev(items,'router',500,600,'B'),e=link(items,a,b,[[142,622],[542,622]]);
  f=rules(d,'through');assert.equal(f.length,1);assert.match(f[0].message,/through “FW”/);const dirty=[];Checks.apply(d,f[0],'reroute',{markDirty:id=>dirty.push(id)});assert.equal(e.routing,'auto');assert.deepEqual(dirty,[e.id]);assert.ok(mid)});

test('links running on top of each other — unless they share a device (a trunk)',()=>{const{d,items}=doc();const a=dev(items,'switch',0,0,'A'),b=dev(items,'switch',600,0,'B'),c=dev(items,'switch',0,300,'C'),e=dev(items,'switch',600,300,'E');
  const l1=link(items,a,b,[[40,100],[300,100],[640,100]]),l2=link(items,c,e,[[40,101],[400,101],[640,101]]);assert.equal(rules(d,'linkoverlap').length,1);
  l2.from={node:a.id,port:null};assert.equal(rules(d,'linkoverlap').length,0,'shared device');assert.ok(l1)});

test('content off the page moves back on; keys are stable and unique',()=>{const{d,items}=doc();const a=dev(items,'switch',-200,100,'OFF');let f=rules(d,'offpage');assert.equal(f.length,1);
  Checks.apply(d,f[0],'movein');assert.equal(rules(d,'offpage').length,0);assert.ok(a.x>=0);
  dev(items,'wap',300,100,'AP-01');dev(items,'wap',500,100,'AP-01');const t=C.text('x',305,150,40,20,11);items.push(t);
  const all=Checks.run(d),again=Checks.run(d);assert.deepEqual(all.map(i=>i.key),again.map(i=>i.key));assert.equal(new Set(all.map(i=>i.key)).size,all.length);for(const i of all)assert.ok(i.cat,i.rule)});

test('review: numbered comments that follow their target, statuses, replies',()=>{const{d,p,items}=doc();const a=dev(items,'switch',100,100,'SW-01'),b=dev(items,'router',400,100,'R');const e=link(items,a,b,[[100,0],[300,0]]);
  const c1=Review.addComment(d,{page:p.id,target:a.id,rel:[1,0],text:' Check VLAN ',by:'Sai'}),c2=Review.addComment(d,{page:p.id,area:{x:0,y:0,w:50,h:40},text:'Area'}),c3=Review.addComment(d,{page:p.id,target:e.id,rel:Review.relFor(e,[150,4]),text:'link'});
  assert.deepEqual([c1.n,c2.n,c3.n],[1,2,3]);assert.equal(c1.text,'Check VLAN');const find=id=>items.find(n=>n.id===id);
  assert.deepEqual(Review.pinAt(c1,find),[a.x+a.w,a.y]);C.move(a,10,20);assert.deepEqual(Review.pinAt(c1,find),[a.x+a.w,a.y]);assert.deepEqual(Review.pinAt(c2,find),[50,0]);assert.deepEqual(Review.pinAt(c3,find),[150,0]);
  Review.setCommentStatus(d,c1.id,'resolved','Ana');Review.reply(d,c1.id,'Done','Ana');assert.equal(Review.comment(d,c1.id).status,'resolved');assert.equal(Review.comment(d,c1.id).replies.length,1);
  Review.removeComment(d,c2.id);assert.equal(Review.addComment(d,{page:p.id,pos:[0,0],text:'next'}).n,4,'numbers are not reused')});

test('review: finding status, checklist, comparison with the previous review and the report',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01'),b=dev(items,'router',400,100,'R-01');link(items,a,null,[[184,122],[300,300]]);
  const annotate=()=>{const is=Checks.run(d);for(const i of is){const m=d.review?.findings?.[i.key];i.status=m?.status||'open';i.note=m?.note||''}return is};
  let is=annotate();const dang=is.find(i=>i.rule==='dangling');Review.setFinding(d,dang,'accepted',{by:'Sai',note:'Spare cable'});is=annotate();assert.equal(is.find(i=>i.key===dang.key).status,'accepted');
  let cl=Review.checklist(d,is);assert.deepEqual(cl.map(c=>c.id),['connectivity','labels','data','readability','design']);assert.equal(cl[0].open,0,'accepted findings are not open');
  Review.setFinding(d,dang,'open',{note:''});assert.ok(!d.review.findings[dang.key]);Review.setFinding(d,dang,'resolved',{by:'Sai'});
  is=annotate();Review.setCheck(d,'connectivity',{state:'ok'},'Sai');Review.complete(d,{by:'Sai',issues:is});
  items.find(n=>n.kind==='edge').to={node:b.id,port:null};C.move(b,0,40);items.splice(items.indexOf(a),1);dev(items,'server',600,100,'NEW');is=annotate();
  const ch=Review.changes(d);assert.equal(ch.since.kind,'review');assert.equal(ch.added.length,1);assert.equal(ch.modified.length,2,'moved router and re-attached link');assert.deepEqual(ch.removed.map(r=>r.name),['SW-01']);
  assert.ok(Review.fixed(d,is).some(f=>f.key===dang.key));
  Review.addComment(d,{page:d.pages[0].id,target:b.id,text:'<b>tag</b> & check',by:'Sai'});const name=id=>Checks.nameOf(items.find(n=>n.id===id));
  const r=Review.report(d,{issues:is,name,where:()=>'Page 1',by:'Sai'});assert.equal(r.counts.comments.open,1);assert.equal(r.counts.checked,1);
  const html=Review.toHTML(r,[{page:'Page 1',svg:'<svg></svg>'}]);assert.match(html,/&lt;b&gt;tag&lt;\/b&gt; &amp; check/);assert.match(html,/Changes since the review/);assert.match(html,/<figure>/);
  const csv=Review.toCSV(r).split('\r\n');assert.equal(csv[0],'Type,Ref,Page,On / category,Text,Severity,Status,By,Date,Note / replies');assert.ok(csv.some(l=>l.startsWith('Comment,#1')));assert.ok(csv.some(l=>l.startsWith('Check,')))});

test('review comparison falls back to the last issued revision before the first review',()=>{const{d,items}=doc();const a=dev(items,'switch',100,100,'SW-01');assert.equal(Review.changes(d).known,false);
  Revisions.setBaseline(d);C.move(a,5,0);const ch=Review.changes(d);assert.equal(ch.since.kind,'revision');assert.deepEqual(ch.modified,[a.id])});
