// Inserting templates / drawings / blocks into an open drawing.
const test=require('node:test'),assert=require('node:assert');
const Core=require('../js/core.js');globalThis.Core=Core;
const Merge=require('../js/merge.js');
const C=Core;

function office(name='Office',subnet='192.168.10.0/24'){const d=C.newDoc(name),p=d.pages[0];
  const z=C.zone('LAN',100,100,600,300,'#eef','#99a');z.data={subnet,gateway:subnet.replace(/0\/24$/,'1')};
  const fw=C.node('firewall',150,150,'Firewall'),sw=C.node('switch',400,150,'Switch'),cam=C.node('camera',400,300,'CAM 1');
  fw.data={ip:subnet.replace(/0\/24$/,'1')};sw.data={ip:subnet.replace(/0\/24$/,'2')};cam.data={ip:subnet.replace(/0\/24$/,'61'),streamTo:'NVR'};
  const nvr=C.node('nvr',550,300,'NVR');nvr.data={ip:subnet.replace(/0\/24$/,'60')};
  const e1=C.edge([C.center(fw),C.center(sw)],{node:fw.id,port:null},{node:sw.id,port:null}),e2=C.edge([C.center(sw),C.center(cam)],{node:sw.id,port:null},{node:cam.id,port:null});
  const lg={id:C.uid(),kind:'legend',x:20,y:500,w:200,h:100,title:'LEGEND',labels:[],pin:'bl'};
  for(const n of[fw,sw,cam,nvr,e1,e2])n.layer=d.layers[0].id;p.items.push(z,fw,sw,cam,nvr,e1,e2,lg);return d}

test('inserting a page copies with fresh ids, remaps links and lands beside existing content',()=>{
  const t=office('Target'),src=office('Template','172.16.5.0/24'),page=t.pages[0],before=page.items.length,oldIds=new Set(src.pages[0].items.map(n=>n.id));
  const content=Merge.contentBounds(page),r=Merge.insert(t,page,src,{place:'right',gap:60});
  assert.ok(r);assert.ok(r.items.every(n=>!oldIds.has(n.id)),'fresh ids');
  const ids=new Set(r.items.map(n=>n.id));for(const e of r.items.filter(n=>n.kind==='edge')){assert.ok(ids.has(e.from.node)&&ids.has(e.to.node),'links point at the copies')}
  assert.ok(r.bounds.x>=content.x+content.w+59,'placed to the right of what was there');
  assert.equal(r.items.filter(n=>n.kind==='legend').length,0,'target already has a legend, so the template one is dropped');
  assert.equal(page.items.length,before+r.items.length);
  const zi=page.items.map((n,i)=>n.kind==='zone'?i:-1).filter(i=>i>=0);assert.deepEqual(zi,[0,1],'zones stay beneath devices');
  assert.deepEqual(r.report.subnets,[],'no clash, nothing renumbered')});

test('clashing subnets move to a free one and device IPs, gateways and new VLANs follow',()=>{
  const t=office('Target'),src=office('Template');src.vlans=[{id:30,name:'CCTV',subnet:'192.168.10.0/24',gateway:'192.168.10.1'},{id:77,name:'Unused',subnet:'10.77.0.0/24'}];src.pages[0].items.find(n=>n.kind==='zone').data.vlan=30;t.vlans=[{id:10,name:'Users',subnet:'192.168.11.0/24'}];
  const r=Merge.insert(t,t.pages[0],src,{place:'below'});
  assert.deepEqual(r.report.subnets,[['192.168.10.0/24','192.168.12.0/24']],'skips 192.168.11.0/24 which a VLAN already uses');
  const z=r.items.find(n=>n.kind==='zone'),fw=r.items.find(n=>n.labels[0]?.text==='Firewall');
  assert.equal(z.data.subnet,'192.168.12.0/24');assert.equal(z.data.gateway,'192.168.12.1');assert.equal(fw.data.ip,'192.168.12.1');
  const v=t.vlans.find(x=>x.id===30);assert.equal(v.subnet,'192.168.12.0/24');assert.equal(v.gateway,'192.168.12.1');assert.ok(!t.vlans.some(x=>x.id===77),'only VLANs the copied items use come along');
  const t4=C.newDoc('P');Merge.insertPages(t4,src,{});assert.ok(t4.vlans.some(x=>x.id===77),'whole-template inserts bring the full VLAN registry');
  assert.equal(r.report.ipClashes,0);
  const keep=Merge.insert(office('T2'),office('T2').pages[0],office('S2'),{avoidClash:false});assert.ok(keep);
  const t3=office('T3'),r3=Merge.insert(t3,t3.pages[0],office('S3'),{avoidClash:false});assert.equal(r3.report.ipClashes,4,'clashes are counted when not moved')});

test('moved subnets stay inside their private block',()=>{const p=Merge.parentOf(C.cidr('192.168.255.0/24'));assert.equal(p.text,'192.168.0.0/16');assert.equal(Merge.parentOf(C.cidr('10.9.0.0/16')).text,'10.0.0.0/8')});

test('layers merge by name, unknown ones are added, or everything goes on the active layer',()=>{
  const t=office('T'),src=office('S');src.layers[0].name='main';src.layers.push({id:'cctv',name:'CCTV',visible:true,locked:false,print:true});src.pages[0].items.find(n=>n.type==='camera').layer='cctv';
  const r=Merge.insert(t,t.pages[0],src,{});assert.equal(t.layers.length,2);assert.deepEqual(r.report.layers,['CCTV']);
  assert.equal(r.items.find(n=>n.type==='switch').layer,t.layers[0].id,'"main" matched "Main"');
  assert.equal(r.items.find(n=>n.type==='camera').layer,t.layers[1].id);
  const t2=office('T2');t2.layers.push({id:'x',name:'Draft',visible:true});const r2=Merge.insert(t2,t2.pages[0],src,{layers:'active',activeLayer:'x'});assert.ok(r2.items.every(n=>n.layer==='x'));assert.equal(t2.layers.length,2)});

test('custom fields and embedded shapes are merged',()=>{const t=office('T'),src=office('S');src.fields.push({key:'rackU',label:'Rack U'});src.stencils={camera:{name:'Cam',svg:'<svg/>'},unused:{name:'X',svg:'<svg/>'}};
  const r=Merge.insert(t,t.pages[0],src,{});assert.equal(r.report.fields,1);assert.ok(t.fields.some(f=>f.key==='rackU'));assert.deepEqual(Object.keys(t.stencils),['camera'])});

test('blocks: a zone with what is inside it and only the links between those devices',()=>{
  const d=office('S'),p=d.pages[0],outside=C.node('router',900,150,'Edge');p.items.push(outside);const sw=p.items.find(n=>n.type==='switch');p.items.push(C.edge([C.center(sw),C.center(outside)],{node:sw.id,port:null},{node:outside.id,port:null}));
  const inner=C.zone('Inner',380,280,300,100,'#fff','#000');p.items.push(inner);
  const bl=Merge.blocks(p);assert.equal(bl.length,1,'nested zone is part of the outer block');assert.equal(bl[0].name,'LAN');assert.equal(bl[0].devices,4);
  const its=Merge.blockItems(p,p.items.find(n=>n.kind==='zone'));assert.ok(its.includes(inner));assert.ok(!its.includes(outside));assert.equal(its.filter(n=>n.kind==='edge').length,2,'the link to the outside router is left out');
  const t=C.newDoc('Empty'),r=Merge.insert(t,t.pages[0],d,{block:bl[0].id});assert.equal(r.items.filter(n=>n.kind==='node').length,4);
  assert.ok(Math.abs(r.bounds.x-(t.pages[0].margin*C.PX+20))<1,'empty page: placed at the top-left inside the margin')});

test('legend comes along when the page has none, keeping its pin; drop point anchors top-left or centre',()=>{
  const t=C.newDoc('Empty'),r=Merge.insert(t,t.pages[0],office('S'),{place:'at',at:[1000,800],anchor:'center'});const lg=r.items.find(n=>n.kind==='legend');assert.ok(lg);assert.equal(lg.pin,'bl');
  assert.ok(Math.abs(r.bounds.x+r.bounds.w/2-1000)<=1&&Math.abs(r.bounds.y+r.bounds.h/2-800)<=1);
  const t2=C.newDoc('Empty'),r2=Merge.insert(t2,t2.pages[0],office('S'),{place:'at',at:[300,200]});assert.ok(Math.abs(r2.bounds.x-300)<=1&&Math.abs(r2.bounds.y-200)<=1,'drops hang from the cursor')});

test('prefix renames devices and zones and keeps stream targets pointing at the renamed recorder',()=>{
  const t=office('T'),r=Merge.insert(t,t.pages[0],office('S','10.20.0.0/24'),{prefix:'B2 '});
  assert.ok(r.items.some(n=>n.labels?.[0]?.text==='B2 Firewall'));assert.equal(r.items.find(n=>n.type==='camera').data.streamTo,'B2 NVR');assert.equal(r.report.renamed,5)});

test('wrap and group',()=>{const t=office('T'),r=Merge.insert(t,t.pages[0],office('S','10.1.1.0/24'),{wrap:'Branch 2',group:true});
  const z=r.items[0];assert.equal(z.kind,'zone');assert.equal(z.labels[0].text,'Branch 2');const g=r.items.find(n=>n.kind==='node').group;assert.ok(g);assert.ok(r.items.filter(n=>n.kind!=='edge').every(n=>n.group===g))});

test('insert as new pages reuses the drawing background and keeps names unique',()=>{
  const t=office('T'),bg=C.page('Background');bg.isBackground=true;t.pages.push(bg);t.pages[0].background=bg.id;
  const src=office('S'),sbg=C.page('Background');sbg.isBackground=true;src.pages.push(sbg);src.pages[0].background=sbg.id;src.pages[0].name=t.pages[0].name;
  const r=Merge.insertPages(t,src,{after:0});assert.equal(r.pages.length,1);assert.equal(r.backgrounds.length,0);
  assert.equal(t.pages[1],r.pages[0]);assert.equal(r.pages[0].background,bg.id);assert.equal(r.pages[0].name,t.pages[0].name+' (2)');
  const ids=new Set(t.pages[0].items.map(n=>n.id));assert.ok(r.pages[0].items.every(n=>!ids.has(n.id)));
  assert.deepEqual(r.report.subnets,[['192.168.10.0/24','192.168.11.0/24']]);
  const t2=C.newDoc('No bg'),r2=Merge.insertPages(t2,src,{});assert.equal(r2.backgrounds.length,1);assert.equal(r2.pages[0].background,r2.backgrounds[0].id);assert.ok(t2.pages.at(-1).isBackground)});

test('parts list drawing pages with their blocks; selections become one-page templates',()=>{
  const d=office('S'),ps=Merge.parts(d);assert.equal(ps.length,1);assert.equal(ps[0].devices,4);assert.equal(ps[0].blocks.length,1);
  const sel=d.pages[0].items.filter(n=>n.kind!=='legend'),t=Merge.docFrom(d,sel,'My block');assert.equal(t.pages.length,1);assert.equal(t.pages[0].items.length,sel.length);assert.ok(Core.validate(t))});

test('nested subnets move with their parent and an unmoved parent keeps its children',()=>{
  const mk=()=>{const d=C.newDoc('Nested'),p=d.pages[0],big=C.zone('Site',0,0,900,600,'#fff','#000');big.data={subnet:'10.0.0.0/16'};const lan=C.zone('LAN',40,60,400,300,'#fff','#000');lan.data={subnet:'10.0.1.0/24'};const pc=C.node('workstation',100,150,'PC');pc.data={ip:'10.0.1.5'};p.items.push(big,lan,pc);return d};
  const t=C.newDoc('T'),z=C.zone('Old',0,0,100,100,'#fff','#000');z.data={subnet:'10.0.1.0/24'};t.pages[0].items.push(z);
  const r=Merge.insert(t,t.pages[0],mk(),{});assert.deepEqual(r.report.subnets,[['10.0.0.0/16','10.1.0.0/16']],'one move, the child follows');
  assert.equal(r.items.find(n=>n.labels[0]?.text==='LAN').data.subnet,'10.1.1.0/24');assert.equal(r.items.find(n=>n.kind==='node').data.ip,'10.1.1.5');
  const t2=C.newDoc('T2'),z2=C.zone('Other',0,0,100,100,'#fff','#000');z2.data={subnet:'192.168.50.0/24'};t2.pages[0].items.push(z2);
  const r2=Merge.insert(t2,t2.pages[0],mk(),{});assert.deepEqual(r2.report.subnets,[],'no clash: parent and child stay put');assert.equal(r2.items.find(n=>n.kind==='node').data.ip,'10.0.1.5')});

test("a moved subnet does not land on the template's own subnets (no chain reaction)",()=>{
  const d=C.newDoc('SD'),p=d.pages[0];for(const[n,sub]of[['Overlay','10.0.0.0/16'],['Branch 1','10.1.0.0/24'],['Branch 2','10.2.0.0/24']]){const z=C.zone(n,0,0,50,50,'#fff','#000');z.data={subnet:sub};p.items.push(z)}
  p.items.push(C.node('router',10,10,'R'));
  const t=C.newDoc('T'),z=C.zone('Campus',0,0,100,100,'#fff','#000');z.data={subnet:'10.0.1.0/24'};t.pages[0].items.push(z);
  const r=Merge.insert(t,t.pages[0],d,{});assert.deepEqual(r.report.subnets,[['10.0.0.0/16','10.3.0.0/16']]);
  assert.deepEqual(r.items.filter(n=>n.kind==='zone').map(n=>n.data.subnet),['10.3.0.0/16','10.1.0.0/24','10.2.0.0/24'])});

test('hostnames stay unique: clashes get -2, a prefix becomes a hostname prefix, stream targets follow',()=>{
  const mk=()=>{const d=office('S','10.5.0.0/24');for(const n of d.pages[0].items)if(n.kind==='node')n.data.hostname=n.labels[0].text.toLowerCase().replace(/\s+/g,'-');d.pages[0].items.find(n=>n.type==='camera').data.streamTo='nvr';return d};
  const t=mk(),r=Merge.insert(t,t.pages[0],mk(),{});const hs=r.items.filter(n=>n.kind==='node').map(n=>n.data.hostname);
  assert.deepEqual(hs,['firewall-2','switch-2','cam-1-2','nvr-2']);assert.equal(r.report.hostnames,4);assert.equal(r.items.find(n=>n.type==='camera').data.streamTo,'nvr-2');
  const t2=mk(),r2=Merge.insert(t2,t2.pages[0],mk(),{prefix:'B2 '});assert.deepEqual(r2.items.filter(n=>n.kind==='node').map(n=>n.data.hostname),['b2-firewall','b2-switch','b2-cam-1','b2-nvr']);
  const t3=mk(),r3=Merge.insert(t3,t3.pages[0],mk(),{uniqueHosts:false});assert.equal(r3.report.hostnames,0)});

test('VLAN-only subnets move too, and zones inside a VLAN range move with it',()=>{
  const d=office('CCTV','10.30.1.0/24');d.vlans=[{id:30,name:'CCTV',subnet:'10.30.0.0/22'},{id:31,name:'Access',subnet:'10.31.0.0/24'}];const p=d.pages[0];p.items.find(n=>n.kind==='zone').data.vlan=30;
  const rdr=C.node('cardreader',200,300,'Reader');rdr.data={ip:'10.31.0.22',vlan:31};p.items.push(rdr);
  const t=C.newDoc('T');for(const[n,sub]of[['A','10.30.2.0/24'],['B','10.31.0.0/24']]){const z=C.zone(n,0,0,40,40,'#fff','#000');z.data={subnet:sub};t.pages[0].items.push(z)}
  const r=Merge.insert(t,t.pages[0],d,{});
  assert.deepEqual(r.report.subnets,[['10.30.0.0/22','10.30.4.0/22'],['10.31.0.0/24','10.31.1.0/24']]);
  assert.equal(r.items.find(n=>n.kind==='zone').data.subnet,'10.30.5.0/24','zone moved with its VLAN range');
  assert.equal(r.items.find(n=>n.labels?.[0]?.text==='Reader').data.ip,'10.31.1.22');
  assert.equal(t.vlans.find(v=>v.id===31).subnet,'10.31.1.0/24')});

test('devices whose IP is taken get the next free address in the same subnet, skipping gateways',()=>{
  const t=office('T');const src=C.newDoc('Kit'),p=src.pages[0];const cam=C.node('camera',0,0,'Cam');cam.data={ip:'192.168.10.61'};const nvr=C.node('nvr',100,0,'NVR');nvr.data={ip:'192.168.10.60'};const gw=C.node('camera',200,0,'Cam2');gw.data={ip:'192.168.10.1'};p.items.push(cam,nvr,gw);
  const r=Merge.insert(t,t.pages[0],src,{});const ips=r.items.map(n=>n.data.ip);
  assert.deepEqual(ips,['192.168.10.62','192.168.10.63','192.168.10.3'],'.1 is the gateway and .2 the switch, so Cam2 gets .3');assert.equal(r.report.readdressed,3);assert.equal(r.report.ipClashes,0)});
