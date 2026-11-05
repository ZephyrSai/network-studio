// Change shape keeps what makes a thing itself (id, links, data, name, place, slot). A picture unit's width stays inside the rack, and its picture fills the slot unless stretching would wreck it.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','racks.js','joinlines.js','changeshape.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes|Racks|ChangeShape)=/,'\nvar $1='),ctx);
  vm.runInContext("var S={prefs:{},doc:{display:{fields:[]}}};var dirty=[];var Conn={markDirty:id=>dirty.push(id)};",ctx);return ctx}
const X=sandbox(),{Core:C,Shapes,Racks,ChangeShape:CS,Stencils}=X;
const edge=(a,pa,b,pb)=>({...C.edge([[0,0],[1,1]],{node:a,port:pa},{node:b,port:pb}),kind:'edge'});
const art=id=>{Stencils.shapes[id]={name:'Pic '+id,cat:'rack-art',w:190,h:54,vb:'0 0 19 5.25',svg:'<path d="M0 0h1"/>',tier:3,pack:'doc',rackUnit:{u:3,frac:.9,from:'x'}};Shapes.rackItems[id]={name:'Pic '+id,fam:'Pic '+id,u:3,face:'art'}};
function rack(){const r=Shapes.make('rack12',100,100,'R1'),items=[r],add=(type,u)=>{const n=Shapes.make(type,0,0);items.push(n);Racks.placeAt(r,n,u);return n};return{r,items,add}}
const near=(a,b,t=.01)=>Math.abs(a-b)<=t;

// ---------- a shape in the drawing ----------
test('a device changes shape: same id, centre, data and links; a default name follows, a typed one stays',()=>{
  const a=Shapes.make('switch',100,100),b=Shapes.make('router',400,100),port=a.ports[1];a.data.ip='10.0.0.1';const e=edge(a.id,port.id,b.id,b.ports[3].id),all=[a,b,e],c=C.center(a),id=a.id;X.dirty.length=0;
  CS.apply(a,'firewall',all);assert.equal(a.id,id);assert.equal(a.type,'firewall');assert.deepEqual([...C.center(a)],[...c]);assert.equal(a.data.ip,'10.0.0.1');assert.equal(e.from.node,id);assert.ok(a.ports.some(p=>p.id===port.id),'the point the link ends on stays');assert.equal(a.labels[0].text,Shapes.nameOf('firewall'),'the default name follows');assert.ok(X.dirty.includes(e.id),'its links re-follow');
  a.labels[0].text='CORE-FW';CS.apply(a,'router',all);assert.equal(a.labels[0].text,'CORE-FW','a name someone typed stays')});

test('the same kind keeps its colours; another kind starts from its own look, and the name moves',()=>{
  const a=Shapes.make('switch',100,100);a.stroke='#dc2626';a.labels[0].text='SW1';CS.apply(a,'router',[a]);assert.equal(a.stroke,'#dc2626');
  CS.apply(a,'rect',[a]);assert.equal(a.display,'shape');assert.equal(a.stroke,Shapes.make('rect',0,0).stroke);assert.equal(a.labels[0].text,'SW1');assert.ok(a.labels[0].y<a.y+a.h&&a.labels[0].y>a.y,'the text goes inside a basic shape');assert.equal(a.labels[0].wrapWidth,a.w-16);
  CS.apply(a,'firewall',[a]);assert.equal(a.display,'symbol');assert.ok(a.labels[0].y>a.y+a.h,'and back under an icon');assert.equal(a.labels[0].wrapWidth,undefined)});

test('similar proportions keep the box; others take their own at the same area, and a label underneath stays with it',()=>{
  Stencils.shapes['vs-long']={name:'Long',cat:'x',w:190,h:18,vb:'0 0 19 1.8',svg:'<path d="M0 0h1"/>',tier:3};
  const a=Shapes.make('switch',100,100);a.w=128;a.h=128;a.labels[0].y=a.y+a.h+16;CS.apply(a,'router',[a]);assert.equal(a.w,128,'square to square keeps its size');
  const area=a.w*a.h,c=C.center(a);CS.apply(a,'vs-long',[a]);assert.ok(near(a.w/a.h,190/18,.2),'its own proportions: '+a.w+'x'+a.h);assert.ok(near(a.w*a.h,area,area*.05));assert.deepEqual([...C.center(a)].map(Math.round),[...c].map(Math.round));assert.ok(a.labels[0].y>a.y+a.h,'the label stays under it');assert.ok(a.labels[0].y-a.y-a.h<24,'and close')});

test('an image becomes an ordinary shape: the picture goes, its links stay',()=>{const a=C.node('image',0,0,'photo',120,80);a.image='data:image/png;base64,AAAA';const b=Shapes.make('router',300,0),e=edge(a.id,a.ports[0].id,b.id,b.ports[0].id);CS.apply(a,'firewall',[a,b,e]);assert.equal(a.image,undefined);assert.equal(a.type,'firewall');assert.equal(e.from.node,a.id);assert.ok(a.ports.some(p=>p.id===e.from.port))});

// ---------- a unit in a rack ----------
test('a unit keeps its U and height, whatever it becomes, and what it used to be is forgotten',()=>{const{r,items,add}=rack(),n=add('rk-switch',7);n.rackFrom={type:'switch',w:64,h:64};art('rkc-a');const b=Shapes.make('router',600,100),e=edge(n.id,n.ports[1].id,b.id,b.ports[0].id);items.push(b,e);
  CS.apply(n,'x','x'&&items,'rkc-a');assert.equal(n.type,'rkc-a');assert.equal(Racks.uOf(r,n),7);assert.equal(Racks.heightU(n),1,'the height stays, though the picture is usually 3U');assert.equal(n.rackFrom,undefined);assert.ok(n.ports.some(p=>p.id===e.from.port));assert.equal(e.from.node,n.id);
  n.inset=[.1,.2];n.artFit='keep';n.showName=true;Racks.placeAt(r,n,7);assert.ok(n.w<190);n.rackFrom={type:'switch',w:64,h:64};CS.apply(n,'x',items,'rk-router');assert.equal(n.rackFrom?.type,'switch','a built-in face brings no way back of its own, so the old one stays');assert.equal(n.type,'rk-router');assert.equal(n.w,Shapes.RACK.inner,'a built-in face spans the slot');assert.equal(n.inset,undefined);assert.equal(n.artFit,undefined);assert.equal(n.showName,undefined);assert.equal(Racks.uOf(r,n),7)});

test('a taller unit stays taller, and a name repeating the old face follows it',()=>{const{r,items,add}=rack(),n=add('rk-switch',3);n.h=3*Shapes.RU;Racks.placeAt(r,n,3);assert.equal(n.labels[0].text,Shapes.nameOf('rk-switch'));CS.apply(n,'rk-router',items);assert.equal(Racks.heightU(n),3);assert.equal(Racks.uOf(r,n),3);assert.equal(n.labels[0].text,Shapes.nameOf('rk-router'))});

test('what can change shape',()=>{const{items,add}=rack(),u=add('rk-switch',1),pdu=Shapes.make('rk-vpdu',0,0),roof=Shapes.make('rk-rooffan',0,0),dev=Shapes.make('switch',0,0),box=Shapes.make('rect',0,0),pinned=Shapes.make('switch',0,0);pinned.pin='tl';
  for(const n of[u,dev,box])assert.ok(CS.can(n),n.type);for(const n of[items[0],pdu,roof,pinned,{kind:'edge',type:'x'},{kind:'zone',type:'zone'},{kind:'node',type:'ann:note'},null])assert.ok(!CS.can(n),String(n?.type))});

// ---------- a picture's width in its slot ----------
test('insetOf: only picture units, and never so far that nothing is left',()=>{art('rkc-b');const n={kind:'node',type:'rkc-b',inset:[.1,.2]};assert.deepEqual([...Racks.insetOf(n)],[.1,.2]);
  for(const bad of[[.5,.5],[.9,0],['x',-1],'a',null,undefined,{}]){const v=[...Racks.insetOf({...n,inset:bad})];assert.ok(v[0]+v[1]<=.8&&v.every(k=>k>=0&&Number.isFinite(k)),JSON.stringify(bad))}assert.deepEqual([...Racks.insetOf({...n,type:'rk-switch'})],[0,0],'a built-in face spans the slot')});

test('placing keeps the width and stays between the rails; moving and height changes keep it too',()=>{art('rkc-c');const{r,items,add}=rack(),n=add('rkc-c',4),i=Shapes.rackInner(r);assert.equal(n.w,i.w);assert.equal(n.x,i.x);
  Racks.setInset(r,n,.25,.25);assert.ok(near(n.x,i.x+.25*i.w));assert.ok(near(n.w,i.w*.5));assert.equal(Racks.uOf(r,n),4);assert.ok(C.inside(C.box(n),i,1));assert.ok(Racks.contents(r,items).includes(n),'still counted in the rack');
  assert.ok(Racks.moveTo(r,n,9,items));assert.ok(near(n.x,i.x+.25*i.w));assert.ok(near(n.w,i.w*.5));assert.equal(Racks.setHeight(r,n,2,items),10,'the top edge stays');assert.ok(near(n.w,i.w*.5));assert.equal(Racks.heightU(n),2);
  r.views={rear:true};Racks.syncRear(items);const rl=n.labels.find(l=>l.view==='rear'),off=()=>rl.x-(r.x+Shapes.rearX(r,n)),o0=off();Racks.setInset(r,n,.1,.4);assert.ok(near(off(),o0),'the rear label stays with the unit');r.views={};Racks.syncRear(items);Racks.setInset(r,n,0,0);assert.equal(n.inset,undefined,'end to end again');assert.equal(n.w,i.w);assert.equal(n.x,i.x);
  n.inset=[.25,.25];Racks.placeAt(r,n,9);const back=Racks.toShape(n,items,{cx:0,cy:0,type:'switch',w:64,h:64});assert.equal(back.inset,undefined,'a normal shape has no slot to stand in from')});

test('artKeeps: fills the slot unless the proportions are far off; a choice wins',()=>{art('rkc-d');const s=(vb)=>({vb}),n={type:'rkc-d',w:190,h:54};
  assert.equal(Shapes.artKeeps(n,s('0 0 1.72 .48')),false,'a 3U faceplate at about its slot’s proportions fills it');assert.equal(Shapes.artKeeps({...n,h:18},s('0 0 19 1.745')),false,'a 1U one too');
  assert.equal(Shapes.artKeeps({...n,h:18},s('0 0 64 64')),true,'a square icon in 1U keeps its proportions');assert.equal(Shapes.artKeeps({...n,h:18},s('0 0 .851 .166')),true,'a half-width box');assert.equal(Shapes.artKeeps({...n,h:36},s('0 0 .851 .166')),false,'until it has the height for it');
  assert.equal(Shapes.artKeeps({...n,h:18,artFit:'fill'},s('0 0 64 64')),false);assert.equal(Shapes.artKeeps({...n,artFit:'keep'},s('0 0 19 5.25')),true);assert.equal(Shapes.artKeeps(n,s('bad')),true,'a bad viewBox never stretches');assert.equal(Shapes.artKeeps({...n,w:95,inset:[0,.5]},s('0 0 19 5.25')),false,'a width dragged by hand: the picture fills it');assert.equal(Shapes.artKeeps({...n,w:95,inset:[0,.5],artFit:'keep'},s('0 0 19 5.25')),true,'unless told otherwise')});
