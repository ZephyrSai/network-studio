// Core model, Port v2 migration, IP helpers and topology importers.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const Core=require('../js/core.js');

// Load the browser-only modules into one shared context (they are classic scripts sharing globals).
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,TextEncoder,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','router.js','layout.js','connectors.js','constraints.js','builder.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes|Builder|Conn|Constraints)=/,'\nvar $1='),ctx,{filename:f});
  vm.runInContext("var S={linkType:'eth',prefs:{},doc:{display:{fields:[]}}};function resolveLabel(o,l){return l.text}",ctx);return ctx}

test('IPv4 / CIDR helpers',()=>{const c=Core.cidr('10.1.2.3/22');assert.equal(c.text,'10.1.0.0/22');assert.equal(c.maskText,'255.255.252.0');assert.equal(c.hosts,1022);assert.equal(Core.int2ip(c.first),'10.1.0.1');assert.equal(Core.int2ip(c.last),'10.1.3.254');assert.ok(Core.inCidr(Core.ip2int('10.1.3.7'),c));assert.ok(!Core.inCidr(Core.ip2int('10.1.4.1'),c));assert.equal(Core.ip2int('300.1.1.1'),null);assert.deepEqual(Core.ipsIn('mgmt 10.0.0.1/24, 10.0.0.2 and 999.1.1.1'),['10.0.0.1','10.0.0.2']);assert.equal(Core.cidr('10.0.0.0/33'),null)});

test('new documents validate and carry default fields',()=>{const d=Core.newDoc('x');assert.equal(Core.validate(d).version,3);assert.ok(d.fields.some(f=>f.key==='poeBudget'));assert.ok(Array.isArray(d.vlans))});

test('Port v2 drawings (original Network Architecture Studio) migrate to v3',()=>{
  const n=Core.node('switch',100,100,'Core switch - 1',100,70);n.card=true;delete n.display;delete n.data;
  const m=Core.node('firewall',400,100,'FW',100,70);m.card=false;delete m.display;delete m.data;
  const e={id:'e1',kind:'edge',points:[[200,135],[400,135]],from:{node:n.id,port:n.ports[1].id},to:{node:m.id,port:m.ports[3].id},routing:'hv',routingExplicit:true,stroke:'#ef6b32',strokeWidth:2,dash:'',arrow:'end',labels:[]};
  const z={id:'z1',kind:'zone',x:50,y:50,w:600,h:300,fill:'#eef4fc',stroke:'#adc0d7',strokeWidth:1.4,dash:'7 5',labels:[Core.label('DMZ',60,70,16)]};
  const v2={version:2,name:'Legacy',pages:[{id:'p1',name:'Logical architecture',paper:'A3',orientation:'landscape',margin:10,printSizing:'fit',customW:420,customH:297,items:[z,e,n,m],guideLines:[]}]};
  const d=Core.migrate(JSON.parse(JSON.stringify(v2)));
  assert.equal(d.version,3);const items=d.pages[0].items;
  assert.equal(items.find(i=>i.id===n.id).display,'card');assert.equal(items.find(i=>i.id===m.id).display,'symbol');
  const edge=items.find(i=>i.kind==='edge');assert.equal(edge.routing,'hv');assert.equal(edge.endMarker,'arrow');assert.equal(edge.startMarker,'none');assert.equal(edge.arrow,undefined);
  assert.equal(items.find(i=>i.kind==='zone').style,'plain');assert.ok(d.layers.length>=1)});

test('Port v1 drawings migrate through v2',()=>{const d=Core.migrate({nodes:[{id:'a',type:'router',x:0,y:0,w:80,h:60,label:'R1',lx:40,ly:80}],edges:[{pts:[[0,0],[100,0]],label:'WAN',lx:50,ly:-5}]});assert.equal(d.version,3);assert.equal(d.pages[0].items.length,2)});

test('validate rejects broken drawings',()=>{assert.throws(()=>Core.migrate({foo:1}));const d=Core.newDoc();d.pages[0].items.push({id:'x',kind:'node',x:0,y:0,w:-1,h:5,labels:[]});assert.throws(()=>Core.validate(d))});

test('duplicate remaps connector ends and ports',()=>{const a=Core.node('switch',0,0,'A'),b=Core.node('switch',200,0,'B'),e=Core.edge([[64,32],[200,32]],{node:a.id,port:a.ports[1].id},{node:b.id,port:null});const[a2,b2,e2]=Core.duplicate([a,b,e],10,10);assert.notEqual(a2.id,a.id);assert.equal(e2.from.node,a2.id);assert.equal(e2.from.port,a2.ports[1].id);assert.equal(e2.to.node,b2.id);assert.equal(e2.to.port,null);assert.equal(a2.x,10)});

test('CSV importer understands NetBox-style columns',()=>{const ctx=sandbox();const spec=vm.runInContext(`Builder.fromCSV('name,device_role,site,primary_ip4,manufacturer,asset_tag\\ncore-01,Core switch,DC,10.0.0.1/24,Cisco,A1\\nfw-01,Firewall,DC,10.0.0.2,Fortinet,A2','termination_a_device,termination_a_name,termination_b_device,termination_b_name,type,label\\ncore-01,Te1/0/1,fw-01,port1,smf,C-001')`,ctx);
  assert.equal(spec.devices.length,2);assert.equal(spec.devices[0].group,'DC');assert.equal(spec.devices[0].data.ip,'10.0.0.1/24');assert.equal(spec.devices[0].data.vendor,'Cisco');assert.equal(spec.links[0].fromIf,'Te1/0/1');assert.equal(spec.links[0].toIf,'port1');
  assert.equal(vm.runInContext("Builder.matchType('Core switch')",ctx),'l3switch');assert.equal(vm.runInContext("Builder.matchType('fw-edge-01')",ctx),'firewall');assert.equal(vm.runInContext("Builder.matchType('Axis dome camera')",ctx),'domecamera');assert.equal(vm.runInContext("Builder.matchLink('10G SMF')",ctx),'fiber10')});

test('CSV parser handles quotes, semicolons and BOM',()=>{const ctx=sandbox();const r=vm.runInContext(`Builder.parseCSV('\\uFEFFname;notes\\n"A;1";"says ""hi"""\\n')`,ctx);assert.deepEqual(r.header,['name','notes']);assert.deepEqual(r.rows[0],['A;1','says "hi"'])});

test('diagram-as-text parser',()=>{const ctx=sandbox();const spec=vm.runInContext(`Builder.fromText('FW1 : firewall ip=10.0.0.1 @Edge\\nFW1[port1] -- Core 1[Te1/1/1] : fiber10 "10G uplink"\\nCore 1 == Core 2\\nInternet -> FW1')`,ctx);
  assert.equal(spec.devices.find(d=>d.name==='FW1').group,'Edge');assert.equal(spec.links[0].to,'Core 1');assert.equal(spec.links[0].toIf,'Te1/1/1');assert.equal(spec.links[0].label,'10G uplink');assert.equal(spec.links[1].type,'stack');assert.equal(spec.links[2].arrow,'end')});

test('CDP / LLDP neighbour parsing (table and detail)',()=>{const ctx=sandbox();
  const t=vm.runInContext(`Builder.fromNeighbors('CORE1#show cdp neighbors\\nDevice ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\\nACC-SW1.corp.local\\n                 Ten 1/1/1         170             S I    WS-C3850  Ten 1/1/1\\nFW-01            Gig 1/0/2         120             R      ASA5525   Gi0/0\\n')`,ctx);
  assert.equal(t.links.length,2);assert.equal(t.links[0].to,'ACC-SW1');assert.equal(t.links[0].fromIf,'Te1/1/1');assert.equal(t.devices.find(d=>d.name==='FW-01').type,'firewall');
  const l=vm.runInContext(`Builder.fromNeighbors('SW1#show lldp neighbors detail\\n------------------------------------------------\\nLocal Intf: Gi1/0/24\\nPort id: Gi0/1\\nSystem Name: AP-Lobby\\nSystem Capabilities: B,W\\nManagement Addresses:\\n    IP: 10.1.1.50\\n')`,ctx);
  assert.equal(l.devices.find(d=>d.name==='AP-Lobby').type,'wap');assert.equal(l.devices.find(d=>d.name==='AP-Lobby').data.ip,'10.1.1.50');assert.equal(l.links[0].fromIf,'Gi1/0/24');
  assert.throws(()=>vm.runInContext(`Builder.fromNeighbors('Device ID Local Intrfce\\nX Gig 1 1 R P Gig 2')`,ctx))});

test('auto-routed connectors avoid devices and spread along sides',()=>{const ctx=sandbox();const r=vm.runInContext(`(()=>{const a=Shapes.make('switch',0,0,'A'),b=Shapes.make('server',300,200,'B'),c=Shapes.make('server',0,200,'C'),blk=Shapes.make('firewall',150,80,'X');const e1=Core.edge([[0,0],[1,1]],{node:a.id,port:null},{node:b.id,port:null}),e2=Core.edge([[0,0],[1,1]],{node:a.id,port:null},{node:c.id,port:null});const items=[a,b,c,blk,e1,e2];Conn.sync(items,{rerouteAll:true});return{e1:e1.points,e2:e2.points,blk:Core.box(blk)}})()`,ctx);
  const crosses=(pts,b)=>pts.some((p,i)=>i&&Math.max(p[0],pts[i-1][0])>b.x&&Math.min(p[0],pts[i-1][0])<b.x+b.w&&Math.max(p[1],pts[i-1][1])>b.y&&Math.min(p[1],pts[i-1][1])<b.y+b.h);
  assert.ok(!crosses(r.e1,r.blk),'route must avoid the firewall');for(const pts of[r.e1,r.e2])for(let i=1;i<pts.length;i++)assert.ok(pts[i][0]===pts[i-1][0]||pts[i][1]===pts[i-1][1],'orthogonal');
  assert.notDeepEqual(r.e1[0],r.e2[0],'two links on one side get separate attachment points')});

test('page auto-sizes to content: grows, shrinks back, shifts off-page shapes',()=>{const ctx=sandbox();const r=vm.runInContext(`(()=>{const p=Core.page('t');const n=Core.node('router',100,100,'R');p.items.push(n);const out={};Constraints.sync(p);out.start=p.paper;
  Core.move(n,1800,0);Constraints.sync(p);out.grown=p.paper;Core.move(n,-1800,0);Constraints.sync(p);out.shrunk=p.paper;
  Core.move(n,-400,-300);const res=Constraints.sync(p);out.shift=res.shift;out.pos=[Math.round(n.x),Math.round(n.y)];
  p.autoSize=false;Core.move(n,5000,0);Constraints.sync(p);out.off=p.paper;return out})()`,ctx);
  assert.equal(r.start,'A3');assert.equal(r.grown,'A2');assert.equal(r.shrunk,'A3');assert.ok(r.shift[0]>0&&r.shift[1]>0);assert.ok(r.pos[0]>=0&&r.pos[1]>=0);assert.equal(r.off,'A3')});

test('pinned title block follows the page corner; background pages re-anchor per sheet',()=>{const ctx=sandbox();const r=vm.runInContext(`(()=>{const p=Core.page('t'),t=Core.text('Title',1300,1000,200,60);t.pin='br';p.items.push(t,Core.node('server',100,100,'S'));Constraints.sync(p);const ps0=Core.pageSize(p),gap0=[ps0.w-(t.x+t.w),ps0.h-(t.y+t.h)];
  p.items[1].x=2000;Constraints.sync(p);const ps1=Core.pageSize(p),gap1=[ps1.w-(t.x+t.w),ps1.h-(t.y+t.h)];
  const bg=Core.page('bg');bg.isBackground=true;bg.paper='A1';const fr={id:'f',kind:'zone',x:38,y:38,w:10,h:10,labels:[],pin:'frame'};bg.items.push(fr);Constraints.sync(bg);const v=Constraints.bgItems(bg,Core.page('a4small'));
  return{gap0,gap1,paper:p.paper,frameW:Math.round(v[0].w),a3W:Math.round(Constraints.area(Core.page('x')).w)}})()`,ctx);
  assert.equal(r.paper,'A2');assert.deepEqual(r.gap0.map(Math.round),r.gap1.map(Math.round));assert.equal(r.frameW,r.a3W)});

test('zones grow to keep members inside',()=>{const ctx=sandbox();const r=vm.runInContext(`(()=>{const p=Core.page('t'),z=Core.zone('Z',100,100,300,200),n=Core.node('server',300,180,'S'),o=Core.node('server',600,180,'Out');p.items.push(z,n,o);Core.move(n,50,0);Constraints.sync(p);const w=z.w;Core.move(o,0,0);return{inside:Core.inside(Core.box(n),Core.box(z)),w,outsideStays:!Core.overlaps(Core.box(o),Core.box(z))}})()`,ctx);assert.ok(r.inside);assert.ok(r.w>300);assert.ok(r.outsideStays,'a device whose centre is outside is not pulled in')});

test('drawings saved before pinning get their border, title block and legend anchored',()=>{const ctx=sandbox();const r=vm.runInContext(`(()=>{const d=Core.newDoc('old');delete d.meta.pinsUpgraded;const fg=d.pages[0],bg=Core.page('bg');bg.isBackground=true;d.pages.push(bg);fg.background=bg.id;
  const a=Constraints.area(bg);bg.items.push({id:'fr',kind:'zone',x:a.x,y:a.y,w:a.w,h:a.h,fill:'none',stroke:'#000',style:'outline',labels:[],locked:true},{id:'tb',kind:'table',x:a.x+a.w-300,y:a.y+a.h-100,w:300,h:100,cols:[100,200],rowH:20,rows:[['Sheet','{{page.number}}']],labels:[]});
  const fa=Constraints.area(fg);fg.items.push({id:'lg',kind:'legend',x:fa.x+12,y:fa.y+fa.h-150,w:200,h:130,labels:[]});fg.paper='A2';fg.minPaper='A2';
  Constraints.upgrade(d);const v=Constraints.bgItems(bg,fg),A=Constraints.area(fg),lg=fg.items[0],tb=v.find(i=>i.id==='tb'),fr=v.find(i=>i.id==='fr');
  return{pins:[bg.items[0].pin,bg.items[1].pin,lg.pin],frame:Math.round(fr.w-A.w),tbGap:[Math.round(A.x+A.w-tb.x-tb.w),Math.round(A.y+A.h-tb.y-tb.h)],legendGap:Math.round(A.y+A.h-lg.y-lg.h),again:Constraints.upgrade(d)}})()`,ctx);
  assert.deepEqual(r.pins,['frame','br','bl']);assert.equal(r.frame,0);assert.deepEqual(r.tbGap,[0,0]);assert.equal(r.legendGap,20);assert.equal(r.again,0)});
