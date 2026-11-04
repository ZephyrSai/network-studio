// Rack engine: U slots, heights, moves, locks, device mapping, power / heat / depth.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','racks.js','joinlines.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes|Racks)=/,'\nvar $1='),ctx);
  vm.runInContext("var S={prefs:{},doc:{display:{fields:[]}}};",ctx);return ctx}
const X=sandbox(),{Core:C,Shapes,Racks}=X;
function rack(units=12){const r=Shapes.make('rack'+units,100,100,'R1');const items=[r];const add=(type,u)=>{const n=Shapes.make(type,0,0);items.push(n);Racks.placeAt(r,n,u);return n};return{r,items,add}}

test('placing by U, occupancy and free space',()=>{const{r,items,add}=rack(12);const sw=add('rk-switch',12),sv=add('rk-server2',5);
  assert.equal(Racks.uOf(r,sw),12);assert.equal(Racks.uOf(r,sv),5);assert.equal(Racks.heightU(sv),2);assert.equal(Racks.freeU(r,items),9);
  assert.ok(!Racks.fits(r,items,6,1),'U6 is taken by the 2U server');assert.ok(Racks.fits(r,items,7,1));assert.ok(!Racks.fits(r,items,12,2),'past the top');
  assert.equal(Racks.findSlot(r,items,2),10,'top-most free 2U run');assert.equal(Racks.findSlot(r,items,2,{order:'bottom'}),1);assert.equal(Racks.findSlot(r,items,1,{near:6}),7)});

test('height changes keep the top U, else the bottom, else the nearest free run — never overlapping',()=>{const{r,items,add}=rack(12);const a=add('rk-switch',10),b=add('rk-switch',8);
  assert.equal(Racks.setHeight(r,a,2,items),9,'grows down into the free U9');assert.equal(Racks.uOf(r,a),9);assert.equal(Racks.heightU(a),2);
  assert.equal(Racks.setHeight(r,b,3,items),6,'keeps its top U8 and grows down into U6–U7');
  for(const n of[a,b])for(const m of[a,b])if(n!==m){const ua=Racks.uOf(r,n),ub=Racks.uOf(r,m);assert.ok(ua+Racks.heightU(n)-1<ub||ub+Racks.heightU(m)-1<ua,'no overlap')}
  const big=add('rk-blank',1);assert.equal(Racks.setHeight(r,big,20,items),null,'too big for the rack')});

test('moving to a U refuses taken or out-of-range slots',()=>{const{r,items,add}=rack(12);const a=add('rk-switch',3),b=add('rk-server2',6);
  assert.equal(Racks.moveTo(r,a,7,items),false);assert.equal(Racks.uOf(r,a),3);assert.equal(Racks.moveTo(r,a,12,items),true);assert.equal(Racks.uOf(r,a),12);assert.equal(Racks.moveTo(r,b,12,items),false)});

test('locks: per unit, or the whole rack',()=>{const{r,add}=rack(12);const a=add('rk-switch',3);assert.equal(Racks.isLocked(a,r),false);a.uLock=true;assert.equal(Racks.isLocked(a,r),true);delete a.uLock;r.lockItems=true;assert.equal(Racks.isLocked(a,r),true)});

test('drawing devices map to sensible rack units',()=>{const m=t=>Racks.rackTypeFor(C.node(t,0,0,t))[0];
  assert.equal(m('firewall'),'rk-firewall');assert.equal(m('router'),'rk-router');assert.equal(m('switch'),'rk-switch');assert.equal(m('nvr'),'rk-nvr');assert.equal(m('server'),'rk-server');assert.equal(m('ups'),'rk-ups');
  assert.deepEqual(Racks.rackTypeFor(C.node('switch',0,0,'Access switch 24p')),['rk-switch24',1])});

test('power, current, heat and depth — with typical values flagged',()=>{const{r,items,add}=rack(42);const sw=add('rk-switch',40),sv=add('rk-server2',30);sv.data={power:600,depth:1100};const dev=C.node('router',0,0,'R');dev.data={power:300};const ru=add('rk-router',20);ru.ref=dev.id;
  r.data={powerBudget:1000,voltage:230,depth:1000};const s=Racks.summary(r,items,id=>id===dev.id?dev:null);
  assert.equal(s.power,150+600+300,'switch typical + server own + router via its linked device');assert.equal(s.amps,+(1050/230).toFixed(1));assert.equal(s.btu,Math.round(1050*3.412));
  assert.ok(s.warn.some(w=>/over the 1000 W budget/.test(w)));assert.ok(s.warn.some(w=>/1100 mm deep/.test(w)));assert.ok(s.warn.some(w=>/typical values/.test(w)));assert.equal(s.used,1+2+2)});

// ---------- 0U side channels, the roof and the cabinet frame ----------
test('racks without side channels or a roof keep exactly the old geometry',()=>{const{r}=rack(12);
  assert.deepEqual(Shapes.rackInner(r),{x:116,y:126,w:190,h:216});const D=Shapes.rackDims(r);assert.equal(D.w,222);assert.equal(D.h,258);assert.equal(D.rear,null);
  r.views={rear:true};assert.equal(Shapes.rackDims(r).rear,250);assert.equal(Shapes.rackDims(r).w,472);const sw=Shapes.make('rk-switch',0,0);Racks.placeAt(r,sw,12);assert.equal(sw.y,126);assert.equal(Shapes.rearX(r,sw),250+16)});

test('side channels widen the cabinet outwards; the roof grows it upwards — units, rear labels and the floor stay put',()=>{const{r,items,add}=rack(12);r.views={rear:true};Racks.resize(r);const sw=add('rk-switch',12),sv=add('rk-server2',3);
  sw.labels.push({...C.copy(sw.labels[0]),id:'rl',view:'rear',x:sw.x+Shapes.rackDims(r).rear+12});const before=JSON.stringify(items),units0=items.slice(1).map(n=>[n.x,n.y]),rl0=sw.labels[1].x,floor=r.y+Shapes.rackFrame(r).h;
  let res=Racks.setFrame(r,items,{sides:true});assert.ok(res.ok);assert.equal(r.x,72);assert.equal(r.w,278*2+28);assert.deepEqual(items.slice(1).map(n=>[n.x,n.y]),units0,'units do not move');
  assert.equal(sw.labels[1].x,rl0+56,'the rear label follows the rear view');assert.deepEqual(Shapes.rackInner(r),{x:116,y:126,w:190,h:216});
  res=Racks.setFrame(r,items,{roof:true});assert.equal(r.y,78);assert.equal(r.labels[0].y,90-22,'the name moves up with the roof');assert.equal(r.y+Shapes.rackFrame(r).h,floor,'floor line unchanged');assert.deepEqual(res.band,{x:72,y:78,w:r.w,h:22});
  Racks.setFrame(r,items,{sides:false,roof:false});assert.equal(JSON.stringify(items),before,'on then off gives the same drawing')});

test('side channels shift the rack contents right when something stands to the left',()=>{const{r,items,add}=rack(12);const sw=add('rk-switch',12),fan=Shapes.make('rk-rooffan',0,0);
  const wall=C.node('server',60,150,'W',30,30);items.push(wall);const x0=sw.x,res=Racks.setFrame(r,items,{sides:true});assert.equal(res.dx,28);assert.equal(r.x,100);assert.equal(sw.x,x0+28);assert.deepEqual(res.moved,[sw.id]);
  assert.equal(Racks.setFrame(rack(12).r,[],{sides:true},{margin:120}).dx,28,'the page margin counts as a wall')});

test('vertical 0U PDUs: placing in a channel, occupancy per side, positions and the mount-aware rack lookup',()=>{const{r,items,add}=rack(12);add('rk-switch',12);Racks.setFrame(r,items,{sides:true});
  const a=Shapes.make('rk-vpdu',0,0),b=Shapes.make('rk-vpdu',0,0);items.push(a,b);Racks.placeSide(r,a,'left',1,12);
  assert.equal(a.x,r.x+4);assert.equal(a.w,20);assert.equal(a.h,12*18);assert.equal(a.fullHeight,true);assert.equal(a.labels[0].rotation,-90);
  assert.deepEqual(Racks.where(r,a),{mount:'left',u:1,h:12});assert.equal(Racks.position(r,a),'0U left · U1–12');assert.equal(Racks.rackOf(a,items),r);assert.ok(!Racks.contents(r,items).includes(a),'0U items take no U');assert.ok(Racks.extras(r,items).includes(a));
  assert.equal(Racks.sideFits(r,items,'left',4,2),false);assert.deepEqual(Racks.findSide(r,items,12,{prefer:'left'}),{side:'right',u:1,len:12},'the other side when the preferred one is full');
  Racks.placeSide(r,b,'right',7,6);assert.equal(b.x,r.x+Shapes.rackFrame(r).w-28+4);assert.equal(Racks.position(r,b),'0U right · U7–12');assert.equal(b.fullHeight,undefined);
  assert.deepEqual(Racks.findSide(r,items,8,{prefer:'right'}),null,'no 8U run is free on either side');assert.deepEqual(Racks.findSide(r,items,8,{prefer:'right',shorten:true}),{side:'right',u:1,len:6},'a shorter free run when allowed');
  assert.equal(Racks.freeU(r,items),11,'side PDUs leave the U count alone');C.move(a,300,0);assert.equal(Racks.where(r,a).mount,'loose');assert.equal(Racks.position(r,a),'not mounted')});

test('the roof fan tray: placement, fans and power; the roof refuses to go while it is there',()=>{const{r,items,add}=rack(42);add('rk-switch',40);add('rk-server2',30);Racks.setFrame(r,items,{roof:true});
  const t=Shapes.make('rk-rooffan',0,0);t.data={fans:6};items.push(t);Racks.placeRoof(r,t);assert.equal(t.y,r.y+3);assert.equal(t.x,Shapes.rackInner(r).x+10);assert.equal(Racks.roofItem(r,items),t);assert.equal(Racks.position(r,t),'Roof · 6 fans');
  const s=Racks.summary(r,items,()=>null);assert.equal(s.used,1+2,'U usage counts U equipment only');assert.equal(s.power,150+550+180);assert.equal(s.extras[0].where,'Roof · 6 fans');assert.ok(s.extras[0].estimated);
  const res=Racks.setFrame(r,items,{roof:false});assert.equal(res.ok,false);assert.equal(res.blockers[0],t);assert.equal(r.roof,true)});

test('rack height changes keep the floor, refit full-height PDUs and refuse to cut equipment off',()=>{const{r,items,add}=rack(12);r.views={top:true};const sw=add('rk-switch',12);Racks.setFrame(r,items,{sides:true,roof:true});
  const p=Shapes.make('rk-vpdu',0,0),t=Shapes.make('rk-rooffan',0,0);items.push(p,t);Racks.placeSide(r,p,'left',1,12);Racks.placeRoof(r,t);const floor=r.y+Shapes.rackFrame(r).h,swy=sw.y;
  assert.ok(Racks.setUnits(r,18,items).ok);assert.equal(r.y+Shapes.rackFrame(r).h,floor,'floor fixed with the top view on');assert.equal(sw.y,swy);assert.equal(Racks.uOf(r,sw),12);assert.equal(Racks.where(r,p).h,18,'full-height PDU grows');assert.equal(t.y,r.y+3,'the fan tray stays on the roof');
  const res=Racks.setUnits(r,10,items);assert.equal(res.ok,false);assert.match(res.blocker,/U12 — move it down first/);assert.equal(r.units,18)});

test('rear labels are never kept on 0U items; validation accepts the new types',()=>{const{r,items}=rack(12);r.views={rear:true};Racks.setFrame(r,items,{sides:true});const p=Shapes.make('rk-vpdu',0,0);items.push(p);Racks.placeSide(r,p,'left',1,12);
  p.labels.push({...C.copy(p.labels[0]),id:'x',view:'rear'});assert.equal(Racks.syncRear(items),true);assert.equal(p.labels.filter(l=>l.view==='rear').length,0);
  const d=C.newDoc('t');d.pages[0].items.push(...items,Shapes.make('rk-rooffan',0,0));assert.doesNotThrow(()=>C.validate(d))});

test('families, types by height and guessing equipment from free text',()=>{assert.equal(Racks.family('rk-server2'),'Server');assert.equal(Racks.typeFor('Server',2),'rk-server2');assert.equal(Racks.typeFor('Server',4),'rk-server');assert.equal(Racks.typeFor('Nope',1),null);
  assert.ok(Racks.families().includes('PDU 0U (vertical)'));assert.equal(new Set(Racks.families()).size,Racks.families().length);
  const g=t=>Racks.guessType(t).type;assert.equal(g('Vertical PDU 0U'),'rk-vpdu');assert.equal(g('APC zero-U power strip PDU'),'rk-vpdu');assert.equal(g('PDU 1U'),'rk-pdu');assert.equal(g('Roof fan unit'),'rk-rooffan');assert.equal(g('Fan tray'),'rk-fan');assert.equal(g('Blanking'),'rk-blank');assert.equal(g('Cisco C9300 48p switch'),'rk-switch');assert.equal(g('mystery box'),'rk-server');
  assert.deepEqual(Racks.rackTypeFor(C.node('pdu',0,0,'Vertical PDU A')),['rk-vpdu',0]);assert.deepEqual(Racks.rackTypeFor(C.node('pdu',0,0,'PDU')),['rk-pdu',1])});

test('growing the cabinet: zones around the rack and the PDU being mounted are not in the way',()=>{const{r,items,add}=rack(12);const sw=add('rk-switch',12),x0=sw.x;
  items.push(C.zone('Comms room',40,40,500,400));const p=Shapes.make('rk-vpdu',0,0);C.move(p,r.x-24-p.x,r.y+40-p.y);items.push(p);
  const res=Racks.setFrame(r,items,{sides:true},{ignore:[p.id]});assert.equal(res.dx,0,'the cabinet widens outwards');assert.equal(r.x,72);assert.equal(sw.x,x0,'units stay put');
  const{r:r2,items:it2}=rack(12);it2.push(C.text('Note',60,150,30,20));assert.equal(Racks.setFrame(r2,it2,{sides:true}).dx,28,'a real shape in the way still shifts the contents')});

test('a side PDU of a new length keeps its lowest U, else its top U, else the nearest free run',()=>{const{r,items}=rack(12);Racks.setFrame(r,items,{sides:true});const p=Shapes.make('rk-vpdu',0,0);items.push(p);Racks.placeSide(r,p,'left',7,6);
  assert.deepEqual(Racks.sideLength(r,items,p,12),{side:'left',u:1,len:12},'full height from U7 starts at U1');Racks.placeSide(r,p,'left',7,6);
  const q=Shapes.make('rk-vpdu',0,0);items.push(q);Racks.placeSide(r,q,'left',1,3);assert.deepEqual(Racks.sideLength(r,items,p,8),{side:'left',u:5,len:8},'keeps its top U12 when the bottom is taken');assert.equal(Racks.sideLength(r,items,p,11),null)});

// ---------- a shape as rack equipment ----------
const pic=(id='vs-pic',o={})=>{X.Stencils.shapes[id]={name:o.name||'Pic',vb:'0 0 19 1.75',svg:'<g stroke="none"/>',w:64,h:6,pack:o.pack===undefined?'doc':o.pack};return id};
const art=(id,u=1,name='Art')=>{X.Stencils.shapes[id]={name,vb:'0 0 19 1.75',svg:'<g stroke="none"/>',pack:'doc',cat:'rack-art',rackUnit:{u,frac:1,from:'vs-pic'}};Shapes.rackItems[id]={name,fam:name,u,face:'art'};return id};

test('art: pictures of their own, not bundled icons',()=>{const n=t=>C.node(t,0,0,t);assert.ok(Racks.isArt(n(pic('vs-a'))));assert.ok(Racks.isArt(n(pic('ms-a',{pack:'my-shapes'}))));assert.ok(!Racks.isArt(n(pic('x-ext',{pack:'extended'}))),'bundled extended icons have a pack too');assert.ok(!Racks.isArt(n('firewall')),'built-ins have none');assert.ok(Racks.isArt({...n('image'),image:'data:image/png;base64,AA'}));assert.ok(!Racks.isArt(n('rect')))});

test('rackMatch: real matches only, no default, 0U is none',()=>{const m=(t,l=t)=>Racks.rackMatch(C.node(t,0,0,l));assert.deepEqual(m('firewall'),['rk-firewall',1]);assert.deepEqual(m('router'),['rk-router',2]);assert.deepEqual(m('loadbalancer'),['rk-server',1]);assert.deepEqual(m('wanopt'),['rk-router',2]);assert.deepEqual(m('switch','Access switch 24p'),['rk-switch24',1]);
  for(const t of['camera','domecamera','ptzcamera','anpr','thermal','wap','ipphone','accesscontrol','intercom','sensor','iotgateway','display','thinclient','cloud','workstation','printer','radio','admin'])assert.equal(m(t),null,t);
  assert.equal(m('camera','Road camera'),null,'a label cannot make a camera a server');assert.equal(m('workstation','Admin PC'),null,"'ad' only counts as a whole word");assert.equal(m('pdu','PDU 0U vertical'),null,'a 0U match counts as none');assert.equal(m('rack'),null);
  assert.deepEqual(Racks.rackTypeFor(C.node('cloud',0,0,'cloud')),['rk-server',1],'the Add to rack dialog keeps its default');assert.deepEqual(Racks.rackTypeFor(C.node('pdu',0,0,'PDU 0U vertical')),['rk-vpdu',0])});

test('rackMatch: the type says what it is, a label is only a name',()=>{const m=(t,l=t)=>Racks.rackMatch(C.node(t,0,0,l));assert.equal(m('laptop','Web dev laptop'),null);assert.equal(m('workstation','Mail server room PC'),null);assert.equal(m('saas','SaaS App'),null);assert.equal(m('function','Serverless Function'),null);assert.equal(m('objectstore','Object Storage'),null);assert.equal(m('dns','DNS Service'),null);
  for(const t of['x-compute-cloud-web-app','x-compute-cloud-mobile-app','x-compute-cloud-serverless','x-compute-cloud-object-storage','x-devices-game-console','x-network-wan-globe'])assert.equal(m(pic(t,{pack:'extended'})),null,t);
  assert.deepEqual(m('server','Router 1'),['rk-server',1],'the type decides');assert.deepEqual(m(pic('x-compute-cloud-server-rack',{pack:'extended'})),['rk-server',1],'real gear in the same set');assert.deepEqual(m('switch','Floor 3 access 24'),['rk-switch24',1],'a label can still say 24 ports');assert.equal(m('pdu','PDU 0U vertical'),null);
  assert.ok(!Racks.canMount(C.node('laptop',0,0,'Web dev laptop'),{items:[],locked:false,linked:false}))});

test('innerPort: inside a picture of its own, not on its outline',()=>{const at=(x,y)=>({id:'p',x,y}),a=C.node(pic('vs-ip'),0,0,'a'),u=C.node(art('rkc-ip'),0,0,'u');assert.ok(Racks.innerPort(a,at(.097,.75)),'a jack on a faceplate');assert.ok(Racks.innerPort(u,at(.097,.75)),'and on its unit');
  for(const[x,y]of[[.5,0],[1,.5],[.5,1],[0,.5],[0,.842],[.873,.015]])assert.ok(!Racks.innerPort(a,at(x,y)),`outline ${x},${y}`);assert.ok(!Racks.innerPort(C.node('firewall',0,0,'f'),at(.5,.5)),'a built-in');assert.ok(!Racks.innerPort(Shapes.make('rk-server',0,0),at(.5,.5)),'a built-in unit');assert.ok(!Racks.innerPort(C.node(pic('x-ip',{pack:'extended'}),0,0,'x'),at(.5,.5)),'a bundled icon');assert.equal(Racks.innerPort(a,undefined),false)});

test('canMount: what a drag may turn into rack equipment',()=>{const env={items:[],locked:false,linked:false},n=(t,o={})=>Object.assign(C.node(t,10,10,t),o),can=(x,e={})=>Racks.canMount(x,{...env,...e});
  assert.ok(can(n(pic())),'a Visio shape');assert.ok(can(n('image',{image:'data:image/png;base64,AA'})),'an image');assert.ok(can(n('firewall')),'a built-in with a real match');assert.ok(!can(n('camera')),'a camera never');assert.ok(!can(n('wap')));assert.ok(!can(n('cloud')));assert.ok(!can(n(pic('x-ext2',{pack:'extended',name:'Tree'}))),'bundled icon with no match');
  assert.ok(!can(Shapes.make('rect',0,0)),'not a device');assert.ok(!can(Shapes.make('rack42',0,0)),'a rack');assert.ok(!can(Shapes.make('rk-server',0,0)),'already a unit');assert.ok(!can(n(art('rkc-t'))),'already a unit');
  assert.ok(!can(n(pic(),{locked:true})));assert.ok(!can(n(pic()),{locked:true}),'on a locked layer');assert.ok(!can(n(pic(),{pin:'br'})));assert.ok(!can(n(pic(),{group:'g1'})));assert.ok(!can(n(pic()),{linked:true}),'already has a linked unit');assert.ok(!can({kind:'edge',type:'x'}));assert.ok(!can(null));
  const panel=n(pic(),{x:0,y:0,w:595,h:480}),kids=[1,2,3].map(i=>Object.assign(C.node('server',20*i,20,'s'),{w:10,h:10}));assert.ok(!can(panel,{items:[panel,...kids]}),'holds three shapes: a panel');assert.ok(can(panel,{items:[panel,...kids.slice(0,2)]}),'two shapes is not a panel');
  const r=Shapes.make('rack42',0,0,'R');assert.ok(!can(n(pic(),{w:595,h:480}),{rack:r}),'bigger than the cabinet');assert.ok(can(n(pic(),{w:1824,h:168}),{rack:r}),'a true-scale faceplate is long but still fits a slot')});

test('toUnit: keeps id, links and data; looks like a made unit; remembers the shape, relative',()=>{const n=Object.assign(C.node(pic(),100,200,'Core'),{id:'d1',w:128,h:40,rotation:90,flipX:true,flipY:true,dash:'3 3',stroke:'#123456',fill:'#abcdef',strokeWidth:3,display:'card',data:{serial:'S1'}});n.labels[0].wrapWidth=80;n.labels[0].anchor={t:.5};n.labels[0].rotation=30;n.labels[0].color='#f00';n.labels.push(C.label('Second',120,270));
  const named={id:'p9',x:.25,y:0,name:'Gi1/0/1'},unused={id:'p8',x:.75,y:1,name:''},top=n.ports.find(p=>p.name==='Top'),e=C.edge([[0,0],[1,1]],{node:'d1',port:top.id},{node:'x',port:null});n.ports.push(named,unused);const rawLabels=C.copy(n.labels),rawPorts=C.copy(n.ports);
  const c=C.center(n);Racks.toUnit(n,art('rkc-u'),2,[n,e]);
  assert.equal(n.id,'d1');assert.equal(n.type,'rkc-u');assert.equal(n.w,190);assert.equal(n.h,36);assert.deepEqual(C.center(n),c,'keeps its centre until it is placed');assert.deepEqual(n.data,{serial:'S1'});
  assert.equal(n.rotation,0);assert.ok(!n.flipX&&!n.flipY&&!n.dash&&!n.image);assert.equal(n.stroke,'#475569');assert.equal(n.fill,'#e2e8f0');assert.equal(n.strokeWidth,2);
  assert.equal(n.labels.length,1,'one label');const l=n.labels[0];assert.equal(l.text,'Core');assert.equal(l.rotation,0);assert.equal(l.align,'start');assert.equal(l.color,'#1e293b');assert.equal(l.size,10);for(const k of['wrapWidth','anchor','auto','autoGap'])assert.equal(l[k],undefined,k);
  assert.ok(n.ports.some(p=>p.id===top.id),'a port a link uses stays');assert.ok(n.ports.some(p=>p.id==='p9'),'a named port stays');assert.ok(!n.ports.some(p=>p.id==='p8'),'an unused unnamed port goes');assert.ok(!n.ports.some(p=>p.name==='Bottom'),'unused generic ports go');assert.ok(n.ports.some(p=>p.name==='Left'&&p.x===0)&&n.ports.some(p=>p.name==='Right'&&p.x===1),'with Left and Right, like a made unit');
  const f=n.rackFrom;assert.equal(f.type,'vs-pic');assert.equal(f.w,128);assert.equal(f.h,40);assert.equal(f.rotation,90);assert.ok(f.flipX&&f.flipY);assert.equal(f.dash,'3 3');assert.equal(f.stroke,'#123456');assert.equal(f.fill,'#abcdef');assert.equal(f.strokeWidth,3);assert.equal(f.display,'card');assert.equal(f.x,undefined,'no page coordinates: they would go stale');assert.equal(f.y,undefined);assert.equal(f.labels.length,2);assert.equal(f.labels[0].x,rawLabels[0].x-100);assert.equal(f.labels[1].y,270-200);assert.equal(f.labels[0].wrapWidth,80);assert.deepEqual(f.ports,rawPorts);
  const bare=Object.assign(C.node(pic(),0,0,''),{labels:[]});Racks.toUnit(bare,'rkc-u',1,[bare]);assert.equal(bare.labels.length,1,'every unit has a label: a rename from a spreadsheet needs one');assert.equal(bare.labels[0].text,'');assert.equal(bare.labels[0].size,8.5)});

test('toShape: restores everything, keeps what links use, stays valid after moves and copies',()=>{const r=Shapes.make('rack42',500,100,'R');const n=Object.assign(C.node(pic(),100,200,'Core'),{id:'d1',w:128,h:40,rotation:90,flipX:true,dash:'3 3',stroke:'#123456',fill:'#abcdef',strokeWidth:3,display:'card'});n.labels.push(C.label('Second',120,270));const ports=C.copy(n.ports),left=n.ports.find(p=>p.name==='Left'),e=C.edge([[0,0],[1,1]],{node:'d1',port:left.id},{node:'d1',port:null});
  const lab0=C.copy(n.labels),all=[n,e];Racks.toUnit(n,art('rkc-v'),1,all);const extra={id:'new',x:.5,y:0,name:'Uplink'},e2=C.edge([[0,0],[1,1]],{node:'d1',port:'new'},null);n.ports.push(extra);all.push(e2);Racks.placeAt(r,n,20);C.move(n,300,0);n.labels[0].text='Renamed';n.showName=true;n.uLock=true;
  Racks.toShape(n,all,{cx:50,cy:60});assert.equal(n.type,'vs-pic');assert.equal(n.w,128);assert.equal(n.h,40);assert.deepEqual(C.center(n),[50,60]);assert.equal(n.rotation,90);assert.ok(n.flipX);assert.ok(!n.flipY);assert.equal(n.dash,'3 3');assert.equal(n.stroke,'#123456');assert.equal(n.fill,'#abcdef');assert.equal(n.strokeWidth,3);assert.equal(n.display,'card');
  for(const k of['rackFrom','showName','hideName','uLock','ref','fullHeight'])assert.equal(n[k],undefined,k);assert.equal(n.labels.length,2);assert.equal(n.labels[0].text,'Renamed','what the label says now');assert.equal(n.labels[0].x,n.x+lab0[0].x-100,'offsets are relative to the node');assert.equal(n.labels[1].text,'Second');assert.equal(n.labels[1].y,n.y+70);
  assert.ok(n.ports.some(p=>p.id===left.id),'the port a link uses');assert.ok(n.ports.some(p=>p.id==='new'),'one added in the rack');for(const p of ports)assert.ok(n.ports.some(q=>q.id===p.id),p.name);
  const copy=C.duplicate([Racks.toUnit(Object.assign(C.node(pic(),0,0,'A'),{id:'d2'}),'rkc-v',1,[])],40,40)[0];const before=copy.rackFrom.w,c2=C.copy(copy.rackFrom.labels);Racks.toShape(copy,[copy],{cx:400,cy:400});assert.equal(copy.w,before);assert.equal(copy.labels[0].x,copy.x+c2[0].x,'a copy comes back at its own place');
  const noFrom=Shapes.make('rkc-v',0,0,'Named');assert.equal(noFrom.type,'rkc-v');Racks.toShape(noFrom,[noFrom],{type:'vs-pic',w:64,h:6,cx:10,cy:10});assert.equal(noFrom.type,'vs-pic');assert.equal(noFrom.w,64);assert.equal(noFrom.stroke,'#2f5ea8');assert.equal(noFrom.ports.length,4,'default ports');assert.equal(noFrom.labels[0].text,'Named');
  const empty=Object.assign(C.node(pic(),0,0,''),{labels:[]});Racks.toUnit(empty,'rkc-v',1,[empty]);Racks.toShape(empty,[empty],{cx:0,cy:0});assert.equal(empty.labels.length,0,'a shape without a label gets none back')});

test('stackOver: on a page keeping its own order, the unit and its links go above the rack, in one place',()=>{const r=Shapes.make('rack42',0,0,'R'),n=Object.assign(C.node(art('rkc-z'),0,0,''),{id:'u'}),e=C.edge([[0,0],[1,1]],{node:'u',port:null},null),other=C.edge([[0,0],[1,1]]),x=C.node('server',0,0,'x'),after=C.node('server',0,0,'y');
  const page={stack:'doc',items:[n,e,other,x,r,after]};Racks.stackOver(page,n,r);assert.deepEqual(page.items.map(i=>i.id),[other.id,x.id,r.id,e.id,'u',after.id]);const same=[...page.items];Racks.stackOver(page,n,r);assert.deepEqual(page.items.map(i=>i.id),same.map(i=>i.id),'nothing to do the second time');
  const plain={items:[n,r]};Racks.stackOver(plain,n,r);assert.deepEqual(plain.items,[n,r],'band sorting already draws it');const up={stack:'doc',items:[e,r,n]};Racks.stackOver(up,n,r);assert.deepEqual(up.items.map(i=>i.id),[r.id,e.id,'u'],'links only, when the unit is already above');const gone={stack:'doc',items:[r]};Racks.stackOver(gone,n,r);assert.deepEqual(gone.items,[r])});

test('art types: not families, listed per document',()=>{const t1=art('rkc-f1',1,'Router'),t2=art('rkc-f2',2,'Visio shape'),t3=art('rkc-f3',1,'Visio shape');assert.ok(!Racks.families().includes('Visio shape'));assert.equal(Racks.typeFor('Router',2),'rk-router','a picture named Router does not take over the built-in');assert.equal(Racks.typeFor('Visio shape',1),null);assert.equal(Racks.family(t1),'Router','a unit keeps its name as its family: the import keeps it unchanged');
  const a=Shapes.make(t2,0,0,'a'),b=Shapes.make(t3,0,0,'b'),c=Shapes.make(t2,0,0,'c');assert.deepEqual(Racks.artTypes([a,b,c,Shapes.make('rk-server',0,0),C.edge([[0,0],[1,1]])]),[t2,t3]);assert.equal(Racks.isU(a),true);assert.ok(Racks.isArtUnit(a));assert.ok(!Racks.isArtUnit(Shapes.make('rk-server',0,0)));assert.equal(a.h,36);assert.equal(a.w,190);assert.equal(a.ports.length,2)});

test('labelHidden: a name that repeats the picture is not drawn; a typed one is; the toggle overrides',()=>{const t=art('rkc-l',1,'C9300'),n=Shapes.make(t,0,0,'C9300'),l=n.labels[0],h=()=>Shapes.labelHidden(n,l);assert.equal(h(),true,'same as the type');l.text='';assert.equal(h(),true,'empty');l.text='Core-1';assert.equal(h(),false,'typed');l.text='C9300';n.showName=true;assert.equal(h(),false,'toggled on');delete n.showName;l.text='Core-1';n.hideName='Core-1';assert.equal(h(),true,'toggled off');l.text='Core-2';assert.equal(h(),false,'a new name shows again');n.showName=false;l.text='C9300';assert.equal(h(),true,'false is off');delete n.showName;delete n.hideName;
  const m=Shapes.make('rk-server',0,0,'Server 1U');assert.equal(Shapes.labelHidden(m,m.labels[0]),false,'other units draw their label');const d=C.node('firewall',0,0,'');assert.equal(Shapes.labelHidden(d,d.labels[0]),false);assert.equal(Shapes.labelHidden(undefined,{}),false)});
