// My shapes: the rack hint, art of a stencil or image node, and the user pack (same art once, rename, remove, what travels with items).
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Promise,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,TextDecoder,btoa,atob,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  vm.runInContext("var S={prefs:{},doc:{pages:[{items:[]}],display:{fields:[]}},history:[],future:[]};var iconCache=new Map();var told=[];var notify=t=>told.push(t);",ctx);
  for(const f of['core.js','stencils.js','shapes.js','visio.js','packs.js','shapekit.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/gm,'var $1='),ctx);
  // no IndexedDB here: storage takes everything, unless a test says otherwise
  vm.runInContext("var Analysis={nameOf:n=>n.labels?.[0]?.text||n.data?.hostname||Shapes.nameOf(n.type)};Store.get=async()=>null;Store.put=async()=>{};Store.del=async()=>{};",ctx);return ctx}
const near=(a,b)=>Math.abs(a-b)<.005;
const art=(k,o={})=>({name:'Shape '+k,vb:'0 0 19 1.75',svg:`<g stroke="none"><path d="M${k} 0h1v1z" fill="#123"/></g>`,w:190,h:18,...o});

// ---------- rackHint ----------
test('rackHint: true-scale Visio masters in inches',()=>{const{rackHint:h}=sandbox().ShapeKit;
  let r=h(19,1.745,true);assert.equal(r.u,1,'C9300 is exactly 1U');assert.equal(r.frac,1);assert.equal(r.plate,false);
  r=h(19,1.75,true);assert.equal(r.u,1,'PA-3440');assert.equal(r.plate,false);
  r=h(19,3.5,true);assert.equal(r.u,2);assert.equal(r.frac,1);assert.equal(r.plate,false);
  r=h(19,7,true);assert.equal(r.u,4);
  r=h(10,1.75,true);assert.equal(r.u,1);assert.ok(near(r.frac,10/19));assert.equal(r.plate,true,'half width: a plate behind it');
  r=h(19,200,true);assert.equal(r.u,48,'never past the tallest rack')});

test('rackHint: 1:10 Visio masters',()=>{const{rackHint:h}=sandbox().ShapeKit;
  let r=h(1.901,.171,true);assert.equal(r.u,1,'FG-200E');assert.equal(r.frac,1);assert.equal(r.plate,false);
  r=h(.851,.166,true);assert.equal(r.u,1,'FG-90G, half width desktop');assert.ok(near(r.frac,.4479));assert.equal(r.plate,true);
  r=h(1.9,.5769,true);assert.equal(r.u,3,'aspect 3.29, W×10 = 19');assert.equal(r.frac,1)});

test('rackHint: anything else goes by aspect, and small or square art sits on a plate',()=>{const{rackHint:h}=sandbox().ShapeKit;
  for(const[w,hh,u]of[[250,100,4],[500,100,2],[1086,100,1],[3000,100,1]]){const r=h(w,hh,false);assert.equal(r.u,u,`${w}x${hh}`);assert.equal(r.frac,1)}
  let r=h(64,64,false);assert.equal(r.u,1);assert.equal(r.plate,true);r=h(1,1,true);assert.equal(r.u,1,'a Visio icon');assert.equal(r.plate,true);
  r=h(.3,.1,true);assert.equal(r.u,4,'W×10 is below 5: the 1:10 rule does not apply, so aspect does');assert.equal(r.frac,1);
  r=h(4,1,true);assert.equal(r.u,3,'W×10 is above 20: likewise');assert.equal(r.plate,false);
  r=h(2,1,true);assert.equal(r.u,1);assert.equal(r.plate,true,'aspect below 2.5')});

test('rackHint: degenerate sizes give 1U',()=>{const{rackHint:h}=sandbox().ShapeKit;for(const[w,hh]of[[0,1],[1,0],[NaN,1],[-3,2],[undefined,undefined]])assert.equal(h(w,hh,true).u,1)});

// ---------- artOf ----------
test('artOf: a stencil node reuses its art, whatever its place, rotation or label',()=>{const{ShapeKit:K,Stencils,Core:C,Packs}=sandbox();Stencils.shapes['vs-a']={name:'C9300',vb:'0 0 19 1.75',w:64,h:16,svg:'<g stroke="none"><path d="M0 0h19v1z"/></g>',pack:'doc',tags:'cisco'};
  const n=C.node('vs-a',40,50,'SW-1',190,18);n.rotation=90;n.flipX=true;const a=K.artOf(n),m=C.node('vs-a',500,600,'',380,36),b=K.artOf(m);
  assert.equal(a.svg,b.svg);assert.equal(a.vb,'0 0 19 1.75');assert.equal(a.name,'SW-1','named from the label');assert.equal(b.name,'C9300','else from the shape');assert.equal(a.w,190);assert.equal(a.h,18,'the size it has in the drawing');assert.ok(Packs.isSafeMarkup(a.svg));assert.equal(a.visio,true,'true-scale inches: the rack hint needs to know')});

test('artOf: a built-in icon keeps its outline through a pack',()=>{const{ShapeKit:K,Stencils,Core:C,Packs}=sandbox();const n=C.node('firewall',0,0,'FW',64,64),a=K.artOf(n);assert.ok(!Stencils.shapes.firewall.pack,'built-in');assert.ok(a.svg.startsWith('<g stroke="currentColor">'));assert.equal(Packs.noStroke(a.svg),a.svg,'no stroke="none" wrapper is added')});

test('artOf: an image node passes the markup filter, and the same picture at any size is the same art',()=>{const{ShapeKit:K,Core:C,Packs}=sandbox();
  // two bytes short of a multiple of 3 gives "==", and these bytes give base64 ending in +onAA== style text
  const b64='AAA+onAAAA==',url='data:image/png;base64,'+b64;assert.equal(Packs.isSafeMarkup(`<image href="${url}"/>`),false,'the raw data URL trips the filter');
  const n=C.node('image',10,20,'Logo',160,90);n.image=url;n.rotation=45;const a=K.artOf(n);assert.ok(Packs.isSafeMarkup(a.svg));assert.ok(!/=="/.test(a.svg),'no padding left');assert.equal(a.recolor,false);assert.equal(a.w,160);
  const m=C.node('image',0,0,'',320,180);m.image=url;assert.equal(K.artOf(m).svg,a.svg);assert.equal(K.artOf(m).vb,a.vb);
  const v=C.node('image',0,0,'',100,100);v.image='data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');assert.ok(Packs.isSafeMarkup(K.artOf(v).svg));
  const bad=C.node('image',0,0,'',10,10);bad.image='https://example.com/x.png';assert.throws(()=>K.artOf(bad),/embedded/)});

test('artOf: refuses markup that would not survive a reopen, and art too large to keep',()=>{const{ShapeKit:K,Stencils,Core:C}=sandbox();Stencils.shapes['vs-x']={name:'X',vb:'0 0 1 1',svg:'<g onload="x()"></g>',pack:'doc'};assert.throws(()=>K.artOf(C.node('vs-x',0,0,'',10,10)),/can’t be kept/);
  Stencils.shapes['vs-y']={name:'Y',vb:'0 0 1 1',svg:'<path d="'+'M0 0'.repeat(25e5)+'"/>',pack:'doc'};assert.throws(()=>K.artOf(C.node('vs-y',0,0,'',10,10)),/too large/)});

test('palette menu: only where it applies',()=>{const{ShapeKit:K,Packs,Stencils}=sandbox();const items=t=>[...K.paletteItems(t).matchAll(/data-pm="(\w+)"/g)].map(m=>m[1]).join();
  assert.equal(items('firewall'),'add,rack');assert.equal(items('rect'),'add','a basic shape: no rack entry, it has no stencil');for(const t of['ann:zone','ann:text','rack','rack24','rack12','rk-server','rk-switch'])assert.equal(items(t),'',t);
  Stencils.shapes['ms-a']={name:'A',vb:'0 0 1 1',svg:'<g/>',pack:Packs.USER};assert.equal(items('ms-a'),'rename,rack,remove');assert.equal(items('nonsense'),'')});

// ---------- the user pack ----------
test('addShape: a pack of its own, in its own category, with the size from the drawing',async()=>{const{Packs,Stencils}=sandbox();const r=await Packs.addShape(art(1,{tags:'cisco',license:'MIT'}));assert.equal(r.added,true);assert.match(r.id,/^ms-/);
  const p=Packs.get('my-shapes');assert.equal(p.name,'My shapes');assert.equal(p.source,'user');assert.equal(p.categories[0].id,'pack:my-shapes');const s=Stencils.shapes[r.id];assert.equal(s.cat,'pack:my-shapes');assert.equal(s.pack,'my-shapes');assert.equal(s.name,'Shape 1');assert.equal(s.w,190);assert.equal(s.h,18);assert.equal(s.vb,'0 0 19 1.75');assert.equal(s.license,'MIT');assert.ok(s.tags.includes('cisco')&&s.tags.includes('shape 1'));
  const{w,h}=(await Packs.addShape(art(2,{w:0,h:0})),Stencils.shapes['ms-'+Packs.artKey(art(2).svg)]);assert.ok(w>=16&&h>=16,'no size given: fits the palette default');assert.equal(s.visio,undefined);const v=await Packs.addShape(art(3,{visio:true}));assert.equal(Stencils.shapes[v.id].visio,true,'stays known as a true-scale Visio master')});

test('addShape: the same art once, whatever wrapper or name it comes with; other art is another shape',async()=>{const{Packs}=sandbox();const inner='<path d="M0 0h9"/>',a=await Packs.addShape(art(0,{svg:inner,name:'First'})),b=await Packs.addShape(art(0,{svg:`<g stroke="none">${inner}</g>`,name:'Second',vb:'1 1 5 5'})),c=await Packs.addShape(art(3));
  assert.equal(b.added,false);assert.equal(b.id,a.id);assert.equal(b.name,'First','tells the name it already has');assert.equal(c.added,true);assert.notEqual(c.id,a.id);assert.equal(Object.keys(Packs.get('my-shapes').shapes).length,2)});

test('addShape: two different pictures with one hash stay two shapes',async()=>{const{Packs}=sandbox();const orig=Packs.artKey(art(1).svg);const a=await Packs.addShape(art(1));const p=Packs.get('my-shapes');p.shapes[a.id].svg='<g stroke="none"><circle r="1"/></g>';const b=await Packs.addShape(art(1));assert.equal(b.added,true);assert.equal(b.id,'ms-'+orig+'x')});

test('addShape: no rack types in a pack, no unsafe markup, no empty box',async()=>{const{Packs,Stencils}=sandbox();const before=Object.keys(Stencils.shapes).length;
  for(const d of[art(1,{rackUnit:{u:1,frac:1}}),art(2,{id:'rkc-abc'}),art(3,{svg:'<g onload="x()"/>'}),art(4,{svg:'<script>x</script>'}),art(5,{vb:'0 0 0 1'}),art(6,{vb:''}),null]){const r=await Packs.addShape(d);assert.equal(r.id,null);assert.ok(r.refused)}
  assert.equal(Object.keys(Stencils.shapes).length,before);assert.ok(!Object.keys(Packs.get('my-shapes')?.shapes||{}).length)});

test('addShapes: several at once, one save',async()=>{const{Packs,Store}=sandbox();let puts=0;Store.put=async()=>{puts++};Store.get=async()=>null;const r=await Packs.addShapes([art(1),art(2),art(1)]);assert.deepEqual(r.map(x=>x.added),[true,true,false]);assert.equal(puts,1);await Packs.addShapes([art(1),art(2)]);assert.equal(puts,1,'nothing new, nothing written')});

test('calls in quick succession both land',async()=>{const{Packs}=sandbox();const[a,b]=await Promise.all([Packs.addShape(art(1)),Packs.addShape(art(2))]);assert.equal(Object.keys(Packs.get('my-shapes').shapes).length,2);assert.notEqual(a.id,b.id)});

test('the stored copy wins, so another tab keeps what it added and removed',async()=>{const{Packs,Store,Stencils}=sandbox();let stored=null;Store.get=async()=>stored&&JSON.parse(JSON.stringify(stored));Store.put=async(s,v)=>{stored=JSON.parse(JSON.stringify(v))};
  const a=await Packs.addShape(art(1));stored.shapes['ms-other']={...stored.shapes[a.id],name:'From the other tab'};const b=await Packs.addShape(art(2));assert.deepEqual(Object.keys(stored.shapes).sort(),[a.id,b.id,'ms-other'].sort());assert.equal(Stencils.shapes['ms-other'].name,'From the other tab')});

test('renameShape: name and search words, and nothing happens for an unknown id or empty name',async()=>{const{Packs,Stencils}=sandbox();const{id}=await Packs.addShape(art(1));assert.equal(await Packs.renameShape(id,'  Core switch '),true);assert.equal(Stencils.shapes[id].name,'Core switch');assert.ok(Stencils.shapes[id].tags.includes('core switch'));assert.equal(Packs.get('my-shapes').shapes[id].name,'Core switch');assert.equal(await Packs.renameShape(id,'   '),false);assert.equal(await Packs.renameShape('ms-none','x'),false);assert.equal(Stencils.shapes[id].name,'Core switch')});

test('removeShape: gone when nothing uses it; the pack goes with its last shape',async()=>{const{Packs,Stencils,Shapes}=sandbox();const a=await Packs.addShape(art(1)),b=await Packs.addShape(art(2));assert.deepEqual(await Packs.removeShape(a.id),{kept:false});assert.equal(Stencils.shapes[a.id],undefined);assert.equal(Shapes.kindOf(a.id),'unknown');assert.ok(Packs.get('my-shapes').shapes[b.id]);assert.ok(Stencils.categories.some(c=>c.id==='pack:my-shapes'));
  await Packs.removeShape(b.id);assert.equal(Packs.get('my-shapes'),undefined);assert.ok(!Stencils.categories.some(c=>c.id==='pack:my-shapes'));assert.equal(await Packs.removeShape('ms-none'),null)});

test('removeShape: a shape on a page stays, listed under Shapes in this drawing, and is still embedded',async()=>{const{Packs,Stencils,Shapes,Core:C,S}=sandbox();const a=await Packs.addShape(art(1));const n=C.node(a.id,0,0,'',10,10);S.doc.pages[0].items.push(n);assert.deepEqual(await Packs.removeShape(a.id),{kept:true});const s=Stencils.shapes[a.id];assert.equal(s.cat,'doc-shapes');assert.equal(s.pack,'doc');assert.ok(Stencils.categories.some(c=>c.id==='doc-shapes'));assert.equal(Shapes.kindOf(a.id),'device');
  const doc={pages:S.doc.pages};Packs.embedUsed(doc);assert.ok(doc.stencils[a.id]);assert.ok(!Packs.get('my-shapes'))});

test('removeShape: undo can still bring a placed shape back',async()=>{const{Packs,Stencils,S}=sandbox();const a=await Packs.addShape(art(1));S.history.push(JSON.stringify({doc:{pages:[{items:[{kind:'node',type:a.id}]}]}}));assert.deepEqual(await Packs.removeShape(a.id),{kept:true});assert.ok(Stencils.shapes[a.id])});

test('a removed shape can be added again',async()=>{const{Packs,Stencils}=sandbox();const a=await Packs.addShape(art(1));await Packs.removeShape(a.id);const b=await Packs.addShape(art(1));assert.equal(b.added,true);assert.equal(b.id,a.id);assert.equal(Stencils.shapes[b.id].cat,'pack:my-shapes')});

// ---------- what travels ----------
test('stencilsFor follows embedUsed’s rule: pack shapes on nodes, not built-ins, not other kinds',()=>{const{Packs,Stencils,Core:C}=sandbox();Stencils.shapes['vs-a']={name:'A',vb:'0 0 1 1',svg:'<g/>',pack:'doc',cat:'doc-shapes'};const out=Packs.stencilsFor([C.node('vs-a',0,0,'',1,1),C.node('firewall',0,0,'',1,1),C.zone('Z',0,0,1,1),C.edge([[0,0],[1,1]])]);assert.deepEqual(Object.keys(out),['vs-a']);assert.equal(out['vs-a'].pack,undefined,'the pack name stays home');
  const doc={pages:[{items:[C.node('vs-a',0,0,'',1,1)]}]};Packs.embedUsed(doc);assert.ok(doc.stencils['vs-a']);doc.pages[0].items=[];Packs.embedUsed(doc);assert.equal(doc.stencils,undefined)});

test('installDoc: what a copied item carries draws where it lands; bad entries are skipped, known ones kept',()=>{const{Packs,Stencils,Shapes}=sandbox();assert.equal(Packs.installDoc({stencils:undefined}),0);assert.equal(Packs.installDoc({}),0);const good={name:'G',vb:'0 0 1 1',w:1,h:1,svg:'<path d="M0 0"/>'};
  assert.equal(Packs.installDoc({stencils:{'vs-g':good,'ms-abc':good,'"><img src=x onerror=y>':good,'vs-unsafe':{...good,svg:'<g onload="x()"/>'},'vs-novb':{name:'N',svg:'<g/>'},'vs-null':null,firewall:good}}),2);
  assert.equal(Shapes.kindOf('vs-g'),'device');assert.equal(Stencils.shapes['vs-g'].cat,'doc-shapes');assert.equal(Stencils.shapes['vs-g'].pack,'doc');assert.equal(Stencils.shapes['"><img src=x onerror=y>'],undefined);assert.equal(Stencils.shapes['vs-unsafe'],undefined);assert.equal(Stencils.shapes['vs-novb'],undefined);assert.notEqual(Stencils.shapes.firewall.name,'G','never over a known type')});

test('every bundled shape id is one a drawing can carry',()=>{const X=fs.readFileSync(path.join(__dirname,'../js/packs/extended.js'),'utf8'),ctx=sandbox();vm.runInContext(X.replace(/^const (\w+)=/gm,'var $1='),ctx);const ids=[...Object.keys(ctx.Stencils.shapes),...Object.keys(ctx.ExtendedPack.shapes)];assert.ok(ids.length>300);for(const id of ids)assert.match(id,/^[\w:.-]+$/)});

// ---------- the derived rack type ----------
const rk=(k,o={})=>({name:'Unit '+k,vb:'0 0 19 1.75',svg:`<path d="M${k} 0h1v1z" fill="#123"/>`,u:1,frac:1,from:'vs-'+k,fromDef:{vb:'0 0 20 2',w:64,h:6,name:'Source '+k,tags:'visio'},...o});
test('rack type: same art, same id, listed nowhere, carried by documents, never in a pack',()=>{const X=sandbox(),{Packs,Stencils,Shapes,Racks}=X;
  const a=Packs.rackType(rk(1)),b=Packs.rackType(rk(1));assert.equal(a,b);assert.match(a,/^rkc-/);const s=Stencils.shapes[a],r=Shapes.rackItems[a];
  assert.equal(s.cat,'rack-art');assert.equal(s.pack,'doc');assert.equal(s.tier,3,'single point of failure analysis sees it like a built-in unit');assert.equal(r.face,'art');assert.equal(r.fam,'Unit 1');assert.equal(s.w,Shapes.RACK.inner);assert.equal(s.h,Shapes.RU);
  const cats=Shapes.catalog();assert.ok(!cats.some(c=>c.items.some(i=>i.type===a)),'in no palette, search or inspector list');assert.ok(!Stencils.categories.some(c=>c.id==='rack-art'));
  assert.ok(Packs.stencilsFor([{kind:'node',type:a}])[a].rackUnit,'embedded in saved files');assert.equal(Packs.stencilsFor([{kind:'node',type:a}])[a].pack,undefined);
  const other=Packs.rackType(rk(1,{vb:'0 0 9 9'}));assert.notEqual(other,a,'same markup in another viewBox is other art');assert.equal(Stencils.shapes[other].vb,'0 0 9 9')});

test('rack type registration: only rkc-, never over a built-in, clamped, needs a name',()=>{const{Packs,Shapes}=sandbox(),reg=(id,s)=>Packs.registerRack(id,s),before=()=>JSON.stringify(Shapes.rackItems['rk-server']);const was=before();
  assert.equal(reg('rk-server',{name:'Evil',rackUnit:{u:1,frac:1}}),false);assert.equal(reg('vs-abc',{name:'X',rackUnit:{u:1,frac:1}}),false);assert.equal(reg('rkc-noname',{name:7,rackUnit:{u:1}}),false);assert.equal(reg('rkc-blank',{name:'  ',rackUnit:{u:1}}),false);assert.equal(reg('rkc-none',{name:'X'}),false);assert.equal(before(),was);
  const ru=u=>({name:'X',rackUnit:{u,frac:9}});assert.equal(reg('rkc-a',ru('nope')),true);assert.equal(Shapes.rackItems['rkc-a'].u,1,'non-numeric');const t=ru(99);reg('rkc-b',t);assert.equal(t.rackUnit.u,48);assert.equal(t.rackUnit.frac,1);const m=ru(2.6);m.rackUnit.frac=-1;reg('rkc-c',m);assert.equal(m.rackUnit.u,3);assert.equal(m.rackUnit.frac,1);
  assert.equal(reg('rkc-a',ru(5)),false,'never overwrites');assert.equal(Shapes.rackItems['rkc-a'].u,1)});

test('installDoc: a saved art unit comes back registered; unsafe art and built-in ids do not',()=>{const{Packs,Shapes,Stencils}=sandbox();const def={name:'Unit',vb:'0 0 19 1.75',svg:'<g stroke="none"><path d="M0 0h1"/></g>',cat:'whatever',tier:3,rackUnit:{u:'2',frac:.5,from:'vs-x',fromDef:{vb:'0 0 1 1',w:1,h:1,name:'S'}}};
  assert.equal(Packs.installDoc({stencils:{'rkc-1':def}}),1);assert.equal(Shapes.rackItems['rkc-1'].u,2);assert.equal(Stencils.shapes['rkc-1'].cat,'rack-art');assert.ok(!Stencils.categories.some(c=>c.id==='doc-shapes'),'no empty category for it');assert.equal(Stencils.shapes['rkc-1'].pack,'doc');
  assert.equal(Packs.installDoc({stencils:{'rkc-1':{...def,rackUnit:{u:9,frac:1}}}}),0);assert.equal(Shapes.rackItems['rkc-1'].u,2,'first one stays');
  Packs.installDoc({stencils:{'rkc-bad':{...def,svg:'<script>alert(1)</script>'}}});assert.ok(!Shapes.rackItems['rkc-bad'],'unsafe markup registers nothing');assert.ok(!Stencils.shapes['rkc-bad']);
  Packs.installDoc({stencils:{'rkc-noname':{...def,name:5}}});assert.ok(!Stencils.shapes['rkc-noname']);
  const srv=JSON.stringify(Shapes.rackItems['rk-server']);assert.equal(Packs.installDoc({stencils:{'rk-server':def}}),0);assert.equal(JSON.stringify(Shapes.rackItems['rk-server']),srv);assert.ok(!Stencils.shapes['rk-server']);
  Packs.installDoc({stencils:{'vs-y':{...def}}});assert.equal(Stencils.shapes['vs-y'].cat,'doc-shapes');assert.equal(Stencils.shapes['vs-y'].rackUnit,undefined,'only rkc- types are rack types')});

test('Back after a reopen: the source returns under its old id, from the derived type',()=>{const{Packs,Stencils,Shapes}=sandbox();const id=Packs.rackType(rk(3)),s=Stencils.shapes[id];assert.ok(!Stencils.shapes['vs-3']);
  assert.equal(Packs.restoreSource('vs-3',id),true);const q=Stencils.shapes['vs-3'];assert.equal(q.svg,s.svg);assert.equal(q.vb,'0 0 20 2');assert.equal(q.w,64);assert.equal(q.h,6);assert.equal(q.name,'Source 3');assert.equal(q.cat,'doc-shapes');assert.equal(q.pack,'doc');assert.ok(!q.rackUnit);
  assert.ok(Stencils.categories.some(c=>c.id==='doc-shapes'));assert.equal(Packs.restoreSource('vs-3',id),false,'already there');for(const t of['firewall','rect','image','rk-server','rack','rack42','bad id'])assert.equal(Packs.restoreSource(t,id),false,t);assert.equal(Packs.restoreSource('vs-9','rkc-missing'),false)});

test('Remember for this shape travels on the derived type, and a kept shape never becomes a rack type',async()=>{const{Packs,Stencils,Shapes}=sandbox();const id=Packs.rackType(rk(4));Packs.rememberRack(id,3);assert.equal(Stencils.shapes[id].rackUnit.u,3);assert.equal(Shapes.rackItems[id].u,3);assert.equal(Stencils.shapes[id].h,3*Shapes.RU);Packs.rememberRack(id,500);assert.equal(Shapes.rackItems[id].u,48);Packs.rememberRack('rkc-none',3);
  assert.equal(Object.keys(Stencils.shapes).filter(k=>/^rkc-/.test(k)&&Stencils.shapes[k].cat!=='rack-art').length,0)});

test('catalogue skips art units, which stay rack items',()=>{const X=sandbox(),{Packs,Stencils,Shapes}=X;const id=Packs.rackType(rk(5,{name:'Firewall'}));const rackCat=Shapes.catalog().find(c=>c.id==='rack');assert.ok(!rackCat.items.some(i=>i.type===id));
  assert.equal(Stencils.shapes[id].name,'Firewall');assert.equal(Shapes.kindOf(id),'rackitem');assert.ok(Shapes.isDevice({kind:'node',type:id}))});
