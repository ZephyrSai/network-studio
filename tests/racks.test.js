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
