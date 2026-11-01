// Rack engine: U slots, heights, moves, locks, device mapping, power / heat / depth.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','racks.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes|Racks)=/,'\nvar $1='),ctx);
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
