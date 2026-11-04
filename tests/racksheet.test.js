// Rack spreadsheets: export, parsing, the import plan (matching, moves, conflicts, new rows) and applying it.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const VsdxWriter=require('../js/vsdx.js');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Infinity,NaN,parseFloat,parseInt,isFinite,Uint8Array,DataView,TextEncoder,TextDecoder,Response,Blob,DecompressionStream,VsdxWriter,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);
  for(const f of['core.js','stencils.js','shapes.js','racks.js','builder.js','xlsx.js','racksheet.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../js',f),'utf8').replace(/^const (\w+)=/m,'var $1=').replace(/\nconst (Shapes|Racks)=/,'\nvar $1='),ctx);
  vm.runInContext("var S={prefs:{},doc:{display:{fields:[]}}};",ctx);return ctx}
const X=sandbox(),{Core:C,Shapes,Racks,RackSheet:RS,Builder}=X;

// A drawing with a 42U rack "A01" (side channels and roof on) and devices on a "Network" page. Ids are fixed, so a
// spreadsheet exported from it and re-saved by Excel / Numbers / LibreOffice (tests/fixtures) imports with no changes.
function fixture(){const doc=C.newDoc('Comms room');doc.fields.push({key:'assetTag',label:'Asset tag'});const net=doc.pages[0];net.name='Network';const rp=C.page('Racks');doc.pages.push(rp);
  const dev=(id,type,name,data={})=>{const n=Shapes.make(type,0,0,name);n.id=id;n.data=data;net.items.push(n);return n};
  dev('d-esx1','server','ESX-01',{model:'R740',serial:'SN-ESX01',power:600,vendor:'Dell'});dev('d-esx2','server','ESX-02',{model:'R740'});dev('d-esx3','server','ESX-03',{model:'R750'});dev('d-sw2','switch','SW-02',{});
  const r=Shapes.make('rack42',200,100,'A01');r.id='rack-a01';r.data={depth:1000};rp.items.push(r);Racks.setFrame(r,rp.items,{sides:true,roof:true});
  const add=(id,type,u,name,extra={})=>{const n=Shapes.make(type,0,0,name);n.id=id;Object.assign(n,extra);rp.items.push(n);Racks.placeAt(r,n,u);return n};
  add('u-core','rk-switch',40,'CORE-SW1',{data:{status:'Existing',vendor:'Cisco',model:'C9300-48P',serial:'0012345',power:350}});
  add('u-esx1','rk-server2',38,'{{asset}}',{ref:'d-esx1',data:{}});add('u-esx2','rk-server2',35,'{{asset}}',{ref:'d-esx2',data:{depth:750}});
  add('u-patch','rk-patch',33,'Patch A\nFloor 2',{data:{}});add('u-fw','rk-firewall',30,'FW-01',{uLock:true,data:{notes:"=cmd|' /C calc'!A0"}});
  add('u-ups','rk-ups',2,'UPS-1',{data:{depth:650,assetTag:'AT-0077',model:'-48V DC kit'}});add('u-blank','rk-blank',1,'Blanking panel 1U',{data:{}});
  const side=(id,name,s,u,len)=>{const n=Shapes.make('rk-vpdu',0,0,name);n.id=id;rp.items.push(n);Racks.placeSide(r,n,s,u,len);return n};side('u-pdua','PDU A','left',1,42);side('u-pdub','PDU B','right',22,21);
  const t=Shapes.make('rk-rooffan',0,0);t.id='u-tray';t.data={fans:4};rp.items.push(t);Racks.placeRoof(r,t);
  const r2=Shapes.make('rack42',900,100,'B02');r2.id='rack-b02';rp.items.push(r2);const o=Shapes.make('rk-switch',0,0,'{{asset}}');o.id='u-sw2';o.ref='d-sw2';rp.items.push(o);Racks.placeAt(r2,o,12);
  const all=()=>doc.pages.flatMap(p=>p.items),find=id=>all().find(n=>n.id===id)||null;
  const nameOf=n=>C.fillFields(String(n.labels?.[0]?.text||'').split('\n')[0],k=>{const a=n.ref&&find(n.ref);if(k==='asset')return a?String(a.labels?.[0]?.text||'').split('\n')[0]:'(device removed)';return n.data?.[k]??a?.data?.[k]??''});
  const env={doc,find,nameOf,layer:doc.layers[0].id,date:new Date(2026,10,1,9,30),get devices(){return net.items.filter(n=>n.kind==='node'&&!Racks.isItem(n)&&!Racks.isRack(n)).map(n=>({n,page:net}))},unitOf:d=>all().find(x=>x.ref===d.id&&Racks.isItem(x))};
  return{doc,net,rp,r,r2,env,find,u:id=>find(id)}}
// the sheet as Xlsx.read gives it back: a header row, then strings
const grid=t=>[t.columns.map(c=>c.header),...t.rows.map(r=>r.map(v=>v==null?'':String(v)))];
const col=(t,key,field)=>t.columns.findIndex(c=>c.key===key&&(!field||c.field===field));
const rowOf=(g,t,id)=>g.find(r=>r[col(t,'rowId')]===id);
const exp=f=>RS.exportTable(f.r,f.rp.items,f.env);
const planOf=(f,g,opts={})=>RS.plan(f.r,f.rp.items,RS.fromRows(g,{doc:f.doc}),opts,f.env);
const at=(f,id)=>Racks.position(f.r,f.u(id));

test('export: roof first, one row per U from the top (covered U left out), then the left and right side channels',()=>{const f=fixture(),t=exp(f),U=col(t,'u'),M=col(t,'mount');
  assert.deepEqual(t.columns.slice(0,13).map(c=>c.header),['U (bottom)','Height (U)','Mount','Equipment','Name','Status','Vendor','Model','Serial no.','Power draw (W)','Typical W (not imported)','Depth (mm)','Notes']);
  assert.deepEqual(t.columns.slice(13).map(c=>c.header),['Asset tag','Linked device (not imported)','Row ID (leave as is)'],'custom field, linked device, Row ID last');
  assert.deepEqual(t.columns.map(c=>c.width).slice(0,13),[10,10,11,24,24,11,14,18,18,14,12,11,30]);
  assert.deepEqual(t.rows[0].slice(0,5),['','','Roof','Roof fan tray (4 fans)',''],'the tray, its name empty');
  const us=t.rows.slice(1,-2).map(r=>r[U]);assert.equal(us[0],42);assert.ok(!us.includes(39)&&!us.includes(36)&&!us.includes(3),'U covered by 2U units have no row');assert.deepEqual(us.slice(0,6),[42,41,40,38,37,35]);assert.equal(us.length,42-3);
  assert.deepEqual(t.rows.at(-2).slice(0,5),[1,42,'0U left','PDU 0U (vertical)','PDU A']);assert.deepEqual(t.rows.at(-1).slice(0,5),[22,21,'0U right','PDU 0U (vertical)','PDU B']);
  const free=t.rows.find(r=>r[U]===41);assert.deepEqual(free.slice(0,5),[41,1,'Rack U','','']);assert.equal(free[col(t,'rowId')],'');
  const g=grid(t),esx=rowOf(g,t,'u-esx1'),patch=rowOf(g,t,'u-patch'),fw=rowOf(g,t,'u-fw'),core=rowOf(g,t,'u-core'),esx2=rowOf(g,t,'u-esx2'),tray=rowOf(g,t,'u-tray'),ups=rowOf(g,t,'u-ups');
  assert.equal(esx[col(t,'name')],'ESX-01','{{asset}} shows the device name');assert.equal(esx[col(t,'linked')],'ESX-01 (Network)');assert.equal(esx[col(t,'field','model')],'R740','device values fill in');assert.equal(esx[col(t,'field','power')],'600');
  assert.equal(patch[col(t,'name')],'Patch A','first line of a multi-line name');
  assert.equal(core[col(t,'typical')],'','no typical figure when power is known');assert.equal(fw[col(t,'typical')],'90');assert.equal(esx2[col(t,'typical')],'550');assert.equal(tray[col(t,'typical')],'120','30 W per roof fan');assert.equal(patch[col(t,'typical')],'');
  assert.equal(core[col(t,'field','serial')],'0012345');assert.equal(ups[col(t,'field','assetTag')],'AT-0077');assert.equal(esx2[col(t,'depth')],'750');assert.equal(core[col(t,'field','power')],'350');
  const ab=Object.fromEntries(t.about.filter(r=>r.length===2).map(([k,v])=>[k,v?.v??v]));assert.equal(ab.Rack,'A01');assert.equal(ab['Rack ID'],'rack-a01');assert.equal(ab['Height (U)'],42);assert.equal(ab['Depth (mm)'],1000);assert.equal(ab.Page,'Racks');assert.equal(ab.Drawing,'Comms room');assert.equal(ab.Exported,'2026-11-01 09:30');
  assert.equal(t.about.filter(r=>r.length===1).length,5,'five how-to lines');assert.equal(t.sheet,'A01');assert.ok(t.lists.includes('Server')&&t.lists.includes('PDU 0U (vertical)')&&t.lists.includes('Roof fan tray (6 fans)'));
  const b=RS.blankTable(24,'New rack',f.env);assert.equal(b.rows.length,1+24+2);assert.deepEqual(b.rows.map(r=>r[M]).filter(m=>m!=='Rack U'),['Roof','0U left','0U right']);assert.equal(b.about.find(r=>r[0]==='Height (U)')[1],24);assert.equal(b.about.find(r=>r[0]==='Rack ID')[1].v,'')});

test('round trip: an exported spreadsheet imports with zero changes (xlsx, CSV, no Row ID column)',async()=>{const f=fixture(),t=exp(f);
  const book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx',{doc:f.doc});assert.equal(book.format,'xlsx');assert.deepEqual(book.tabs.map(x=>[x.name,x.rack]),[['A01',true]],'About and the hidden Lists tab are not offered');
  assert.equal(book.about.id,'rack-a01');assert.equal(book.about.units,'42');
  const parsed=RS.fromRows(book.tabs[book.tab].rows,{doc:f.doc});assert.equal(parsed.error,null);assert.ok(parsed.hasRowId);assert.deepEqual(parsed.ignored,[]);
  const p=RS.plan(f.r,f.rp.items,parsed,{about:book.about},f.env);assert.ok(p.empty,JSON.stringify(p.rows.filter(x=>x.status!=='same').map(x=>[x.line,x.what,x.conflict?.text,x.problems,x.skipped.map(c=>c.text)])));
  assert.equal(p.changes,0);assert.deepEqual(p.missing,[]);assert.equal(p.mismatch,null);assert.deepEqual(p.rackChanges,[]);assert.deepEqual(p.matchedBy,['Row ID']);assert.equal(p.rows.length,10,'free rows and placeholders are ignored');
  const csv=RS.toCSV(t);assert.ok(csv.startsWith('﻿'));assert.ok(csv.includes(`"'=cmd|' /C calc'!A0"`),'formula guard');assert.ok(csv.includes("'-48V DC kit"));
  const viaBuilder=Builder.parseCSV(csv),g1=[viaBuilder.header,...viaBuilder.rows],p1=planOf(f,g1);assert.ok(p1.empty,'Builder.parseCSV');
  const own=(await RS.read(new TextEncoder().encode(csv),'A01 - rack.csv',{doc:f.doc})),p2=planOf(f,own.tabs[0].rows);assert.equal(own.format,'csv');assert.ok(own.tabs[0].rack);assert.ok(p2.empty,'RackSheet.parseCSV');
  assert.equal(RS.fromRows(own.tabs[0].rows,{doc:f.doc}).rows.find(x=>x.rowId==='u-fw').values.notes,"=cmd|' /C calc'!A0",'the guard comes off on import');
  const g=grid(t).map(r=>r.filter((_,i)=>i!==col(t,'rowId'))),p3=planOf(f,g);assert.ok(p3.empty,JSON.stringify(p3.rows.filter(x=>x.status!=='same').map(x=>[x.line,x.what])));assert.ok(p3.notes.includes('No Row ID column — matched by serial no. and name'));assert.deepEqual(p3.matchedBy.sort(),['name','position','serial no.']);
  const odd={columns:[{header:'Name'}],rows:[["'=quoted"],['@home'],[-5]]},back=RS.fromRows([['U','Name'],...RS.parseCSV(RS.toCSV(odd)).slice(1).map(r=>['1',r[0]])]).rows.map(r=>r.name);assert.deepEqual(back,["'=quoted",'@home','-5'],'the guard is reversible; numbers are not guarded');
  assert.ok(RS.isRackTable(csv));assert.ok(!RS.isRackTable('name,role,position,face\nsw1,switch,12,front'),'a NetBox device list is not a rack sheet')});

test('swaps and re-ordered rows move units without conflicts; apply then re-plan is empty',()=>{const f=fixture(),t=exp(f),g=grid(t),U=col(t,'u');
  rowOf(g,t,'u-core')[U]='33';rowOf(g,t,'u-patch')[U]='40';const body=g.slice(1).reverse(),p=planOf(f,[g[0],...body]);
  assert.ok(p.rows.every(x=>!x.conflict),'a swap never conflicts');assert.equal(p.counts.move,2);assert.equal(p.counts.update,0);
  assert.equal(p.rows.find(x=>x.id==='u-core').what,'Moved from U40');const res=RS.apply(p,f.r,f.rp,f.env);assert.equal(at(f,'u-core'),'U33');assert.equal(at(f,'u-patch'),'U40');assert.deepEqual(res.moved.sort(),['u-core','u-patch']);assert.equal(res.summary,'2 moved');
  assert.ok(planOf(f,[g[0],...body]).empty,'same rows again');assert.ok(planOf(f,grid(exp(f))).empty,'fresh export')});

test('Row IDs: duplicates and IDs of units elsewhere become new units; unknown IDs fall back to the name',()=>{const f=fixture(),t=exp(f),g=grid(t),R=col(t,'rowId'),N=col(t,'name'),U=col(t,'u');
  const dup=[...rowOf(g,t,'u-core')];dup[N]='CORE-SW2';dup[U]='42';const far=[...rowOf(g,t,'u-core')];far[R]='u-sw2';far[N]='SW-02B';far[U]='41';far[col(t,'field','serial')]='';
  const lost=[...rowOf(g,t,'u-patch')];lost[R]='u-gone';g.splice(g.indexOf(rowOf(g,t,'u-patch')),1,lost);
  const p=planOf(f,[...g,dup,far]),line=g.length+1,coreLine=g.indexOf(rowOf(g,t,'u-core'))+1;
  const d=p.rows.find(x=>x.line===line),o=p.rows.find(x=>x.line===line+1),l=p.rows.find(x=>x.p.rowId==='u-gone');
  assert.equal(d.kind,'new');assert.ok(d.notes.includes(`Same Row ID as row ${coreLine} — added as a new unit`));assert.equal(p.rows.find(x=>x.line===coreLine).id,'u-core','the first row keeps the unit');
  assert.equal(o.kind,'new');assert.ok(o.notes.includes('Row ID belongs to SW-02 in B02 — added as a new unit'));assert.equal(l.kind,'match');assert.equal(l.id,'u-patch');assert.equal(l.how,'name');
  assert.equal(d.status,'new');assert.equal(d.position,'U42');assert.equal(o.position,'U41');assert.equal(p.counts.add,2);assert.equal(p.counts.update,0)});

test('locked units keep their place unless "Also move locked units"; their data still updates',()=>{const f=fixture(),t=exp(f),g=grid(t),fw=rowOf(g,t,'u-fw');fw[col(t,'u')]='28';fw[col(t,'field','vendor')]='Fortinet';
  const p=planOf(f,g),x=p.rows.find(x=>x.id==='u-fw');assert.ok(x.problems.includes('Locked at U30 — data updated, position kept'));assert.equal(p.lockedMoves,1);assert.ok(!x.moved);assert.equal(x.status,'update');
  const q=planOf(f,g,{alsoLocked:true});assert.ok(q.rows.find(x=>x.id==='u-fw').moved);assert.equal(q.lockedMoves,0);
  RS.apply(p,f.r,f.rp,f.env);assert.equal(at(f,'u-fw'),'U30');assert.equal(f.u('u-fw').data.vendor,'Fortinet');RS.apply(planOf(f,g,{alsoLocked:true}),f.r,f.rp,f.env);assert.equal(at(f,'u-fw'),'U28')});

test('conflicts: overlap with a unit not in the spreadsheet, out of range (grow), same-side PDUs, a second tray',()=>{const f=fixture(),t=exp(f),U=col(t,'u'),H=col(t,'height'),M=col(t,'mount'),E=col(t,'equipment'),N=col(t,'name');
  const g=grid(t).filter(r=>r[col(t,'rowId')]!=='u-blank'),blankRow=(u,h,m,e,n)=>{const r=Array(t.columns.length).fill('');r[U]=u;r[H]=h;r[M]=m;r[E]=e;r[N]=n;return r};
  rowOf(g,t,'u-core')[U]='1';g.push(blankRow('1','1','Rack U','Server','NEW-1'),blankRow('44','1','Rack U','Server','NEW-44'),blankRow('1','21','0U left','PDU 0U (vertical)','PDU C'),blankRow('','','Roof','Roof fan tray (2 fans)','Tray 2'));
  const p=planOf(f,g),rw=n=>p.rows.find(x=>x.name===n),core=p.rows.find(x=>x.id==='u-core'),trayLine=g.findIndex(r=>r[col(t,'rowId')]==='u-tray')+1;
  assert.equal(core.conflict.text,'U1 overlaps Blanking panel 1U');assert.equal(core.conflict.choice,'keep');assert.equal(core.position,'U40');assert.ok(!core.moved,'an existing unit keeps its place by default');
  assert.equal(rw('NEW-1').conflict.text,'U1 overlaps Blanking panel 1U');assert.equal(rw('NEW-1').conflict.choice,'skip');assert.deepEqual(rw('NEW-1').conflict.options.map(o=>o.v),['skip','near','park']);
  assert.equal(rw('NEW-44').conflict.text,'U44 is above the top of the 42U rack');assert.deepEqual({need:p.grow.need,suggest:p.grow.suggest,on:p.grow.on},{need:44,suggest:45,on:false});
  const pdua=g.findIndex(r=>r[col(t,'rowId')]==='u-pdua')+1;assert.equal(rw('PDU C').conflict.text,`0U left · U1–21 overlaps PDU A (row ${pdua})`);assert.equal(rw('Tray 2').conflict.text,`A01 already has a roof fan tray (row ${trayLine})`);assert.deepEqual(rw('Tray 2').conflict.options.map(o=>o.v),['skip','park']);
  assert.equal(p.counts.add,0);assert.ok(!p.empty);assert.deepEqual(p.missing.map(m=>[m.name,m.where]),[['Blanking panel 1U','U1']]);
  const ln=n=>rw(n).line,q=planOf(f,g,{resolve:{[ln('NEW-1')]:'near',[ln('PDU C')]:'near',[core.line]:'near',[ln('Tray 2')]:'park'},growTo:45});
  const r2=n=>q.rows.find(x=>x.name===n);assert.equal(r2('NEW-1').position,'U5','nearest free U once the existing unit has taken U4');assert.equal(r2('PDU C').position,'0U right · U1–21','near gives the other side');assert.equal(r2('NEW-44').conflict,null);assert.equal(r2('NEW-44').position,'U44');
  assert.equal(q.rows.find(x=>x.id==='u-core').position,'U4','existing units are placed before new rows');assert.equal(r2('Tray 2').position,'Beside the rack');assert.equal(q.units,45);assert.equal(q.rackChanges[0].text,'Height 42U → 45U');assert.ok(q.grow.on);
  const res=RS.apply(q,f.r,f.rp,f.env);assert.equal(f.r.units,45);assert.equal(res.added.length,4);const byName=n=>f.rp.items.find(x=>x.labels?.[0]?.text===n);
  assert.equal(at(f,byName('NEW-44').id),'U44');assert.equal(at(f,byName('PDU C').id),'0U right · U1–21');assert.equal(at(f,'u-pdua'),'0U left · U1–45','a full-height PDU follows the new height');assert.ok(f.u('u-pdua').fullHeight);
  assert.equal(Racks.rackOf(byName('Tray 2'),f.rp.items),null,'the parked tray is beside the rack');assert.ok(byName('Tray 2').x>=f.r.x+f.r.w);assert.equal(at(f,'u-ups'),'U2–3','the floor stays: U numbers are unchanged')});

test('names: linked devices are renamed only with "Update linked devices"; templated names are left alone',()=>{const f=fixture(),hn=f.u('u-patch');hn.labels[0].text='{{hostname}}';hn.data.hostname='PP-01';
  const t=exp(f),g=grid(t),N=col(t,'name');assert.equal(rowOf(g,t,'u-patch')[N],'PP-01');rowOf(g,t,'u-esx1')[N]='ESX-01A';rowOf(g,t,'u-patch')[N]='PP-02';rowOf(g,t,'u-core')[N]='CORE-SW1A';
  const p=planOf(f,g),e=p.rows.find(x=>x.id==='u-esx1');assert.equal(e.what,'Name: ESX-01 → ESX-01A — renames the linked device on “Network”');assert.deepEqual(p.renames.map(r=>[r.from,r.to,r.applied]),[['ESX-01','ESX-01A',true]]);
  assert.ok(p.rows.find(x=>x.id==='u-patch').problems.includes('Name comes from {{hostname}} — not changed'));
  const q=planOf(f,g,{updateLinked:false}),e2=q.rows.find(x=>x.id==='u-esx1');assert.equal(e2.changes.length,0);assert.equal(e2.skipped.length,1);assert.ok(!q.empty);assert.equal(q.renames[0].applied,false);
  const res=RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('d-esx1').labels[0].text,'ESX-01A');assert.equal(f.u('u-esx1').labels[0].text,'{{asset}}');assert.equal(f.u('u-core').labels[0].text,'CORE-SW1A');assert.equal(hn.labels[0].text,'{{hostname}}');
  assert.deepEqual(res.pages.map(p=>p.name),['Network'],'the device page needs a sync');assert.ok(res.devices.includes('d-esx1'))});

test('fields go where they come from: own value, linked device, depth always on the unit; an empty cell clears',()=>{const f=fixture(),t=exp(f),g=grid(t),c=(id,k,fl,v)=>{rowOf(g,t,id)[col(t,k,fl)]=v};
  c('u-core','field','model','C9300-24P');c('u-esx1','field','model','R750');c('u-esx1','depth',null,'800');c('u-esx2','depth',null,'1,100 mm');c('u-core','field','status','');c('u-esx1','field','serial','');c('u-ups','field','assetTag','AT-0078');c('u-patch','field','power','abc');
  const p=planOf(f,g),ch=id=>p.rows.find(x=>x.id===id).changes.filter(c=>c.kind==='field').map(c=>[c.key,c.to,c.target]);
  assert.deepEqual(ch('u-core'),[['status','','unit'],['model','C9300-24P','unit']]);assert.deepEqual(ch('u-esx1'),[['model','R750','device'],['serial','','device'],['depth',800,'unit']]);assert.deepEqual(ch('u-esx2'),[['depth',1100,'unit']]);assert.deepEqual(ch('u-ups'),[['assetTag','AT-0078','unit']]);
  assert.ok(p.rows.find(x=>x.id==='u-patch').problems.includes('Power draw (W) “abc” is not a number — not changed'));
  RS.apply(p,f.r,f.rp,f.env);const u=f.u('u-core'),d=f.u('d-esx1');assert.equal(u.data.model,'C9300-24P');assert.ok(!('status'in u.data),'cleared');assert.equal(d.data.model,'R750');assert.ok(!('serial'in d.data));assert.equal(f.u('u-esx1').data.depth,800);assert.equal(d.data.depth,undefined);assert.equal(f.u('u-esx2').data.depth,1100);
  assert.ok(planOf(f,g).rows.filter(x=>x.id!=='u-patch').every(x=>x.status==='same'),'applied changes do not come back')});

test('equipment: the same family keeps its type, another family changes it; mount follows the equipment',()=>{const f=fixture(),t=exp(f),g=grid(t),c=(id,k,v)=>{rowOf(g,t,id)[col(t,k)]=v};
  c('u-core','height','2');c('u-patch','equipment','Firewall');c('u-esx2','height','1');c('u-esx2','equipment','Server');c('u-pdub','mount','0U left');c('u-tray','equipment','Roof fan tray (6 fans)');
  const p=planOf(f,g),x=id=>p.rows.find(x=>x.id===id);assert.equal(x('u-core').type,'rk-switch');assert.equal(x('u-core').what,'Height: 1U → 2U');assert.equal(x('u-patch').type,'rk-firewall');assert.equal(x('u-patch').what,'Equipment: Patch panel → Firewall');
  assert.equal(x('u-esx2').type,'rk-server2','same family keeps the type, only the height changes');assert.equal(x('u-tray').what,'Fans: 4 → 6');assert.equal(x('u-pdub').conflict.text,`0U left · U22–42 overlaps PDU A (row ${g.findIndex(r=>r[col(t,'rowId')]==='u-pdua')+1})`);
  RS.apply(p,f.r,f.rp,f.env);assert.equal(at(f,'u-core'),'U40–41');assert.equal(f.u('u-patch').type,'rk-firewall');assert.equal(Racks.heightU(f.u('u-esx2')),1);assert.equal(f.u('u-tray').data.fans,6);assert.equal(at(f,'u-pdub'),'0U right · U22–42','kept on its side');
  const g2=grid(exp(f));g2.push(['30','1','0U left','Server','ODD','','','','','','','','','','','']);const o=planOf(f,g2).rows.find(x=>x.name==='ODD');assert.ok(o.notes.includes("A Server can't go in a side channel — treated as Rack U"));assert.equal(o.want.mount,'u');
  const g3=grid(exp(f));g3.push(['','','Rack U','PDU 0U (vertical)','','','','','','','','','','','','']);const v=planOf(f,g3).rows.find(x=>x.kind==='new');assert.ok(v.notes.includes('PDU 0U (vertical) goes in a side channel — mount set to 0U left'));assert.equal(v.conflict?.text,'No room for a 42U PDU on the left side')});

test('new rows: typed from Equipment, first free U from the top, linked to unracked devices of the same name',()=>{const f=fixture(),t=exp(f),g=grid(t),U=col(t,'u'),N=col(t,'name'),E=col(t,'equipment'),M=col(t,'mount'),H=col(t,'height');
  const free=u=>g.find(r=>r[U]===String(u)&&r[M]==='Rack U'&&!r[N]),a=free(20),b=free(25);a[N]='ESX-03';a[E]='Server';a[H]='2';b[N]='SW-02';b[E]='Switch 24-port';
  const nr=Array(t.columns.length).fill('');nr[N]='core firewall';nr[col(t,'field','model')]='FG-100F';g.push(nr);const tp=Array(t.columns.length).fill('');tp[N]='Lab switch';tp[E]='Switch 48-port';tp[U]='12.0';g.push(tp);
  const p=planOf(f,g),x=n=>p.rows.find(r=>r.name===n);assert.equal(x('ESX-03').what,'New · links to ESX-03 (Network)');assert.equal(x('ESX-03').type,'rk-server2');assert.equal(x('ESX-03').position,'U20–21');
  assert.ok(x('SW-02').notes.includes('SW-02 is already in B02 · U12 — added unlinked'));assert.equal(x('SW-02').link,null);assert.equal(x('SW-02').type,'rk-switch24');
  assert.equal(x('core firewall').type,'rk-firewall');assert.ok(x('core firewall').guessed);assert.equal(x('core firewall').position,'U42','a blank U takes the first free U from the top');assert.equal(x('Lab switch').position,'U12');
  assert.equal(p.counts.add,4);const res=RS.apply(p,f.r,f.rp,f.env),made=res.added.map(id=>f.u(id));const esx3=made.find(n=>n.ref==='d-esx3');assert.ok(esx3);assert.equal(esx3.labels[0].text,'{{asset}}');assert.equal(esx3.layer,f.doc.layers[0].id);
  assert.equal(made.find(n=>n.labels[0].text==='core firewall').data.model,'FG-100F');assert.ok(f.u('d-esx3').data.model==='R750','a linked device keeps data the row did not change');
  const p2=planOf(f,g,{linkByName:false}),y=p2.rows.find(r=>r.kind==='new'&&r.name==='ESX-03');assert.equal(y,undefined,'already added: matched by name now');
  {const z=planOf(f,g);assert.ok(z.empty,JSON.stringify(z.rows.filter(x=>x.status!=='same'||x.problems.length||x.conflict).map(x=>[x.line,x.name,x.kind,x.what,x.problems,x.conflict?.text,x.skipped.map(c=>c.text)])))}assert.ok(planOf(f,grid(exp(f))).empty);
  const g4=grid(exp(f)),pd=Array(t.columns.length).fill('');pd[M]='0U right';pd[E]='PDU 0U (vertical)';pd[U]='1';pd[H]='21';g4.push(pd);const q=planOf(f,g4),v=q.rows.find(r=>r.kind==='new');assert.equal(v.name,'PDU B2','a default PDU name per side');assert.equal(v.position,'0U right · U1–21');
  const off=planOf(f,g4,{off:[v.line]});assert.equal(off.rows.find(r=>r.kind==='new').status,'off');assert.ok(off.empty)});

test('units missing from the spreadsheet stay unless removed; more than half missing is flagged',()=>{const f=fixture(),t=exp(f),g=grid(t),keep=new Set(['u-core','u-esx1']),g2=[g[0],...g.slice(1).filter(r=>keep.has(r[col(t,'rowId')]))];
  const p=planOf(f,g2);assert.equal(p.missing.length,8);assert.ok(p.missingMany);assert.equal(p.remove.length,0);assert.ok(p.empty,'nothing to change unless Remove is ticked');
  const q=planOf(f,g2,{removeMissing:true});assert.equal(q.remove.length,8);assert.equal(q.changes,8);const res=RS.apply(q,f.r,f.rp,f.env);assert.equal(res.removed.length,8);
  assert.deepEqual([...Racks.contents(f.r,f.rp.items),...Racks.extras(f.r,f.rp.items)].map(n=>n.id).sort(),['u-core','u-esx1']);assert.ok(f.u('d-esx2'),'linked devices stay in the drawing')});

test('cells: numbers, U spans, heights, mounts and equipment names',()=>{
  for(const[s,v]of[['1,200 W',1200],['0,5',.5],['1.234,5',1234.5],[' 350 ',350],['12.0',12],['',null]])assert.equal(RS.parseNum(s),v,s);assert.ok(Number.isNaN(RS.parseNum('abc')));
  assert.deepEqual(RS.parseU('U38–39'),{u:38,h:2});assert.deepEqual(RS.parseU('38-39'),{u:38,h:2});assert.deepEqual(RS.parseU('12.0'),{u:12});assert.deepEqual(RS.parseU('u7'),{u:7});assert.equal(RS.parseU('12.5').bad,'12.5');assert.deepEqual(RS.parseU(''),{u:null});
  assert.deepEqual(RS.parseH('full'),{h:'full'});assert.deepEqual(RS.parseH('2U'),{h:2});assert.equal(RS.parseH('1.5').bad,'1.5');
  for(const[s,m]of[['Roof','roof'],['top','roof'],['0U left','left'],['L','left'],['right side','right'],['r','right'],['front','u'],['Rear','u'],['Rails','u'],['Rack U','u'],['','']])assert.equal(RS.parseMount(s).mount||'',m,s);
  assert.equal(RS.parseMount('ceiling').note,'Mount “ceiling” not recognised — treated as Rack U');
  assert.deepEqual(RS.parseEquipment('Roof fan tray (6 fans)'),{type:'rk-rooffan',fam:'Roof fan tray',fans:6});assert.deepEqual(RS.parseEquipment('Server'),{type:null,fam:'Server',fans:null});assert.equal(RS.parseEquipment('Server 2U').type,'rk-server2');assert.equal(RS.parseEquipment('rk-switch24').type,'rk-switch24');assert.equal(RS.parseEquipment('server').fam,'Server');assert.equal(RS.parseEquipment('Toaster'),null);
  const pr=RS.fromRows([['Name','U','Equipment','Height (U)'],['x','U20–21','Toaster','']]);assert.equal(pr.rows[0].spanH,2);assert.ok(pr.rows[0].notes[0].startsWith('Equipment “Toaster” not recognised — guessed'))});

test('header detection: a title row above the header, Excel row numbers, NetBox headers and ignored columns',()=>{const f=fixture();
  const rows=[['Rack A01 — comms room'],[],['U (bottom)','Name','Equipment','Asset tag','Colour','Typical W (not imported)'],['40','sw-1','Switch 48-port','AT-1','red','150'],[],['38','sw-2','','','','']];
  const p=RS.fromRows(rows,{doc:f.doc});assert.equal(p.header,3);assert.deepEqual(p.rows.map(r=>r.line),[4,6]);assert.deepEqual(p.ignored,['Colour']);assert.ok(!p.hasRowId);assert.equal(p.rows[0].values.assetTag,'AT-1','a custom field by its label');
  const nb=RS.fromRows([['name','role','manufacturer','device_type','status','site','rack','position','face','serial','asset_tag','comments'],['core-sw-01','Core Switch','Cisco','C9300-48P','active','HQ','A01','40.0','front','FCW123','A-9','spine']],{doc:C.newDoc()});
  assert.deepEqual(nb.columns.map(c=>c.field||c.key),['name','equipment','vendor','model','status','u','mount','serial','notes']);assert.deepEqual(nb.ignored,['site','rack','asset_tag']);
  const r=nb.rows[0];assert.equal(r.u,40);assert.equal(r.mount,'u');assert.equal(r.guess.type,'rk-switch');assert.equal(r.values.model,'C9300-48P');
  assert.equal(RS.fromRows([['a','b'],['1','2']]).error,'No U and Name columns were found.');
  assert.deepEqual(RS.parseCSV('a;b;c\n1;"x;y";3\n\n4;5;6'),[['a','b','c'],['1','x;y','3'],[''],['4','5','6']],'semicolons, quotes and blank rows kept');
  const about=RS.about([['Rack','A01'],['Rack ID','r1'],['Height (U)','42'],['Width (mm)',''],['One row per U…']]);assert.deepEqual(about,{name:'A01',id:'r1',units:'42',width:''});assert.equal(RS.about([['x','y']]),null)});

test('About: rack changes from a workbook of this rack only; a mismatch is reported',async()=>{const f=fixture(),t=exp(f);t.about.find(r=>r[0]==='Depth (mm)')[1]=1200;t.about.find(r=>r[0]==='Height (U)')[1]=45;t.about.find(r=>r[0]==='Rack')[1]='A01-new';
  const book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx'),parsed=RS.fromRows(book.tabs[0].rows,{doc:f.doc}),p=RS.plan(f.r,f.rp.items,parsed,{about:book.about},f.env);
  assert.equal(p.rackText,'Rack: Height 42U → 45U · Name A01 → A01-new · Depth 1000 → 1200 mm');assert.equal(p.units,45);RS.apply(p,f.r,f.rp,f.env);assert.equal(f.r.units,45);assert.equal(f.r.data.depth,1200);assert.equal(f.r.labels[0].text,'A01-new');
  const q=RS.plan(f.r2,f.rp.items,parsed,{about:book.about},f.env);assert.equal(q.mismatch.text,'This spreadsheet was exported from “A01-new” (Comms room). You are importing into “B02”.');assert.deepEqual(q.rackChanges,[]);
  const p2=RS.plan(f.r,f.rp.items,parsed,{about:{...book.about,units:'24'}},f.env);assert.deepEqual(p2.rackProblems,['FW-01 is at U30 — move it down first.'],'a locked unit above the new top refuses the smaller height');assert.equal(p2.units,45);assert.ok(p2.rows.every(x=>!x.conflict));
  await assert.rejects(()=>RS.read(new Uint8Array([0xD0,0xCF,0x11,0xE0,0xA1,0xB1,0x1A,0xE1,0,0]),'old.xls'),/Old Excel files/);await assert.rejects(()=>RS.read(new Uint8Array([0x50,0x4b,3,4,0,0,0,0,0,0]),'x.xlsx'),/“x.xlsx” could not be read/)});

test('a rack without side channels or a roof gets them for 0U rows; a new rack; only the given page and devices change',()=>{const f=fixture();
  const r=f.r2,t=RS.exportTable(r,f.rp.items,f.env),g=grid(t),blank=()=>Array(t.columns.length).fill(''),M=col(t,'mount'),E=col(t,'equipment'),N=col(t,'name'),H=col(t,'height');
  assert.deepEqual(t.rows.map(x=>x[M]).filter(m=>m!=='Rack U'),['Roof','0U left','0U right'],'placeholders even without channels');
  const a=blank();a[M]='0U left';a[E]='PDU 0U (vertical)';a[N]='PDU A';const b=blank();b[M]='Roof';b[E]='Roof fan tray (2 fans)';g.push(a,b);
  const before=JSON.stringify(f.doc.pages[0]),x0=r.x,sw=Racks.uOf(r,f.u('u-sw2')),p=RS.plan(r,f.rp.items,RS.fromRows(g,{doc:f.doc}),{},f.env),R=(o,k)=>o.rows.find(x=>x.name===k);
  assert.deepEqual(p.frame,{sides:true,roof:true});assert.equal(R(p,'PDU A').position,'0U left · U1–42','a blank height on a PDU is full height');assert.equal(p.rows.find(x=>x.type==='rk-rooffan').position,'Roof · 2 fans');
  const res=RS.apply(p,r,f.rp,f.env);assert.ok(r.sides&&r.roof);assert.equal(res.frame.ok,true);assert.equal(r.x,x0-Shapes.RACK.side,'the cabinet grows outwards');assert.equal(Racks.uOf(r,f.u('u-sw2')),sw,'units keep their U');
  const pdu=res.added.map(f.u).find(n=>n.type==='rk-vpdu');assert.equal(Racks.position(r,pdu),'0U left · U1–42');assert.ok(pdu.fullHeight);assert.equal(Racks.roofItem(r,f.rp.items).data.fans,2);
  assert.equal(JSON.stringify(f.doc.pages[0]),before,'nothing linked was written, so the device page is untouched');assert.deepEqual(res.pages,[]);
  const nr=Shapes.make('rack24',0,0,'C03'),q=RS.plan(nr,[nr],RS.fromRows(grid(exp(f)),{doc:f.doc}),{newRack:true},f.env);assert.equal(q.counts.add,3,'only the UPS, the blanking panel and the tray fit a 24U rack');assert.deepEqual(q.grow,{need:42,suggest:42,on:false});assert.ok(q.rows.some(x=>x.conflict&&/above the top of the 24U rack/.test(x.conflict.text)));
  const q2=RS.plan(nr,[nr],RS.fromRows(grid(exp(f)),{doc:f.doc}),{newRack:true,growTo:42},f.env),page=C.page('New'),r3=RS.apply(q2,nr,page,f.env);assert.ok(page.items.includes(nr),'a new rack goes on the page');assert.equal(nr.units,42);assert.equal(r3.added.length,10);
  assert.ok(RS.plan(nr,page.items,RS.fromRows(grid(RS.exportTable(nr,page.items,f.env)),{doc:f.doc}),{},f.env).empty,'the new rack round-trips too')});

test('units that overlap already, a rack named About, CSV in Windows-1252, a File',async()=>{const f=fixture(),x=Shapes.make('rk-switch',0,0,'SW-OVER');x.id='u-over';f.rp.items.push(x);Racks.placeAt(f.r,x,40);
  const p=planOf(f,grid(exp(f)));assert.ok(p.empty,'an existing overlap is not the import’s business');
  f.r.labels[0].text='About';const t=exp(f);assert.equal(t.sheet,'About rack');const book=await RS.read(RS.toXlsx(t),'About - rack.xlsx',{doc:f.doc});assert.deepEqual(book.tabs.map(s=>s.name),['About rack']);assert.equal(book.about.name,'About');
  const cp=new Uint8Array([...new TextEncoder().encode('U (bottom),Name,Equipment,Mount\n12,Caf'),0xE9,...new TextEncoder().encode(' '),0x96,...new TextEncoder().encode(' A,Server,Rack U\n')]),c=await RS.read(cp,'x.csv');assert.equal(c.tabs[0].rows[1][1],'Café – A');
  const file={name:'A01 - rack.csv',arrayBuffer:async()=>new TextEncoder().encode(RS.toCSV(exp(f))).buffer},fb=await RS.read(file);assert.equal(fb.format,'csv');assert.equal(fb.tabs[0].name,'A01 - rack');assert.ok(fb.tabs[0].rack)});

test('a smaller rack from About: units above the new top move down, full-height PDUs follow, the floor stays',()=>{const f=fixture();delete f.u('u-fw').uLock;const t=exp(f),ab=RS.about(t.about.map(r=>r.map(v=>v?.v??v)));ab.units='24';
  const ups=f.u('u-ups').y,p=planOf(f,grid(t),{about:ab}),x=id=>p.rows.find(r=>r.id===id);assert.equal(p.units,24);assert.deepEqual(p.rackProblems,[]);
  assert.equal(x('u-core').conflict.text,'U40 is above the top of the 24U rack');assert.equal(x('u-core').conflict.choice,'near');assert.equal(x('u-pdua').position,'0U left · U1–24');assert.equal(x('u-pdub').position,'0U right · U4–24');
  const res=RS.apply(p,f.r,f.rp,f.env);assert.ok(res.units.ok);assert.equal(f.r.units,24);assert.equal(f.u('u-ups').y,ups,'the floor stays');
  const all=[...Racks.contents(f.r,f.rp.items),...Racks.extras(f.r,f.rp.items)];assert.equal(all.length,10,'every unit is still in the rack');assert.ok(all.every(n=>{const w=Racks.where(f.r,n);return w.u==null||w.u+w.h-1<=24}));
  assert.ok(f.u('u-pdua').fullHeight);assert.ok(!f.u('u-pdub').fullHeight);assert.ok(planOf(f,grid(exp(f))).empty)});

// Exports re-saved by Excel, Numbers, LibreOffice or Google Sheets must import with nothing to change. Put them in
// tests/fixtures as rack-*.xlsx (exported from fixture() above) — or point RACKSHEET_FIXTURES at a folder of them.
test('re-saved workbooks import with nothing to change',async t=>{const dirs=[path.join(__dirname,'fixtures'),process.env.RACKSHEET_FIXTURES].filter(d=>d&&fs.existsSync(d)),files=dirs.flatMap(d=>fs.readdirSync(d).filter(f=>/^rack-.*\.xlsx$/i.test(f)).map(f=>path.join(d,f)));
  if(!files.length)return t.skip('no re-saved fixtures');for(const file of files){const f=fixture(),book=await RS.read(new Uint8Array(fs.readFileSync(file)),path.basename(file),{doc:f.doc}),parsed=RS.fromRows(book.tabs[book.tab].rows,{doc:f.doc}),p=RS.plan(f.r,f.rp.items,parsed,{about:book.about},f.env);
    assert.ok(p.empty,path.basename(file)+': '+JSON.stringify(p.rows.filter(x=>x.status!=='same'||x.problems.length).map(x=>[x.line,x.what,x.problems,x.conflict?.text])))}});

// ---------- regressions found in review ----------
const row=(t,o)=>{const r=Array(t.columns.length).fill('');for(const[k,v]of Object.entries(o))r[col(t,k)]=v;return r};
// U and side-channel slots taken twice
const overlaps=f=>{const seen=new Set(),bad=[],take=k=>{if(seen.has(k))bad.push(k);seen.add(k)};for(const n of Racks.contents(f.r,f.rp.items)){const u=Racks.uOf(f.r,n);for(let k=0;k<Racks.heightU(n);k++)take('U'+(u+k))}
  for(const n of Racks.extras(f.r,f.rp.items)){const w=Racks.where(f.r,n);if(w.mount==='left'||w.mount==='right')for(let k=0;k<w.h;k++)take(w.mount+(w.u+k))}return bad};
const why=p=>JSON.stringify(p.rows.filter(x=>x.status!=='same'||x.problems.length||x.conflict||x.skipped.length).map(x=>[x.line,x.name,x.what,x.problems,x.conflict?.text,x.skipped.map(c=>c.text)]))+JSON.stringify(p.rackProblems);
const again=(f,g,opts)=>{const p=planOf(f,g,opts);RS.apply(p,f.r,f.rp,f.env);return planOf(f,g)};

test('a smaller rack: units above the new top move only to slots no staying unit holds',()=>{
  {const f=fixture();delete f.u('u-fw').uLock;const x=Shapes.make('rk-server',0,0,'SRV-24');x.id='u-24';f.rp.items.push(x);Racks.placeAt(f.r,x,24);const t=exp(f),ab=RS.about(t.about.map(r=>r.map(v=>v?.v??v)));ab.units='24';
    const p=planOf(f,grid(t),{about:ab}),x24=p.rows.find(r=>r.id==='u-24'),core=p.rows.find(r=>r.id==='u-core');assert.equal(x24.status,'same');assert.equal(core.conflict.choice,'near');assert.equal(core.position,'U23','next to the unit that stays at U24');
    RS.apply(p,f.r,f.rp,f.env);assert.deepEqual(overlaps(f),[]);assert.equal(at(f,'u-24'),'U24');assert.equal(at(f,'u-core'),'U23')}
  {const f=fixture();delete f.u('u-fw').uLock;const c=Shapes.make('rk-vpdu',0,0,'PDU C');c.id='u-pduc';f.rp.items.push(c);Racks.placeSide(f.r,c,'right',1,21);const t=exp(f),ab=RS.about(t.about.map(r=>r.map(v=>v?.v??v)));ab.units='24';
    const p=planOf(f,grid(t),{about:ab});assert.equal(p.rows.find(r=>r.id==='u-pduc').status,'same');assert.equal(p.rows.find(r=>r.id==='u-pdub').position,'Beside the rack','no 21U run is left on either side');
    RS.apply(p,f.r,f.rp,f.env);assert.deepEqual(overlaps(f),[]);assert.equal(at(f,'u-pduc'),'0U right · U1–21')}});

test('equipment that changes mount: "keep" keeps the unit as it was; near and park take the new type',()=>{
  const setup=(id,o)=>{const f=fixture(),t=exp(f),g=grid(t),r=rowOf(g,t,id);for(const[k,v]of Object.entries(o))r[col(t,k)]=v;return{f,g,line:g.indexOf(r)+1}};
  {const{f,g}=setup('u-core',{equipment:'PDU 0U (vertical)',mount:'0U left'}),p=planOf(f,g),x=p.rows.find(r=>r.id==='u-core');assert.equal(x.conflict.choice,'keep');assert.equal(x.conflict.options[0].text,'Keep at U40 (stays a Switch 48-port)');
    assert.equal(x.type,'rk-switch');assert.equal(x.what,'');assert.equal(x.position,'U40');RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('u-core').type,'rk-switch');assert.equal(at(f,'u-core'),'U40');assert.ok(planOf(f,grid(exp(f))).empty)}
  {const{f,g,line}=setup('u-core',{equipment:'PDU 0U (vertical)',mount:'0U left'}),p=planOf(f,g,{resolve:{[line]:'near'}}),x=p.rows.find(r=>r.id==='u-core');assert.equal(x.position,'0U right · U21');assert.ok(x.what.includes('Equipment: Switch 48-port → PDU 0U (vertical)'));
    RS.apply(p,f.r,f.rp,f.env);const n=f.u('u-core');assert.equal(n.type,'rk-vpdu');assert.equal(at(f,'u-core'),'0U right · U21');assert.equal(n.labels[0].rotation,-90);assert.deepEqual(overlaps(f),[])}
  {const{f,g}=setup('u-pdub',{equipment:'Server',mount:'Rack U',u:'40',height:'1'}),p=planOf(f,g),x=p.rows.find(r=>r.id==='u-pdub');assert.equal(x.conflict.options[0].text,'Keep at 0U right · U22–42 (stays a PDU 0U (vertical))');assert.equal(x.position,'0U right · U22–42');
    RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('u-pdub').type,'rk-vpdu');assert.equal(at(f,'u-pdub'),'0U right · U22–42')}
  {const{f,g,line}=setup('u-pdub',{equipment:'Server',mount:'Rack U',u:'40',height:'1'}),p=planOf(f,g,{resolve:{[line]:'near'}});assert.equal(p.rows.find(r=>r.id==='u-pdub').position,'U41');
    RS.apply(p,f.r,f.rp,f.env);const n=f.u('u-pdub');assert.equal(n.type,'rk-server');assert.equal(at(f,'u-pdub'),'U41');assert.ok(Racks.contents(f.r,f.rp.items).includes(n));assert.equal(n.labels[0].rotation,0);assert.ok(!n.fullHeight)}
  {const{f,g,line}=setup('u-pdub',{equipment:'Server',mount:'Rack U',u:'40',height:'1'}),p=planOf(f,g,{resolve:{[line]:'park'}});RS.apply(p,f.r,f.rp,f.env);const n=f.u('u-pdub');
    assert.equal(n.type,'rk-server');assert.equal(n.w,Shapes.RACK.inner,'a parked unit takes its new size');assert.equal(n.h,Shapes.RU);assert.equal(Racks.rackOf(n,f.rp.items),null)}});

test('after the rack grows (Make 45U, About), the same file imports with nothing to change; a PDU can still be shortened',async()=>{
  {const f=fixture(),t=exp(f),g=grid(t);g.push(row(t,{u:'44',height:'1',mount:'Rack U',equipment:'Server',name:'TOP-44'}));const q=again(f,g,{growTo:45});assert.equal(f.r.units,45);assert.equal(at(f,'u-pdua'),'0U left · U1–45');assert.ok(q.empty,why(q))}
  {const f=fixture(),t=exp(f);t.about.find(r=>r[0]==='Height (U)')[1]=45;const book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx',{doc:f.doc}),run=()=>RS.plan(f.r,f.rp.items,RS.fromRows(book.tabs[0].rows,{doc:f.doc}),{about:book.about},f.env);
    RS.apply(run(),f.r,f.rp,f.env);assert.equal(at(f,'u-pdua'),'0U left · U1–45');const q=run();assert.ok(q.empty,why(q));
    const t2=exp(f),g2=grid(t2);rowOf(g2,t2,'u-pdua')[col(t2,'height')]='40';const s=planOf(f,g2);assert.equal(s.rows.find(r=>r.id==='u-pdua').what,'Length: 45U → 40U','a real change of length still counts')}
  {const f=fixture(),t=exp(f),g=grid(t);g.push(row(t,{u:'43',height:'1',mount:'Rack U',equipment:'Server',name:'TOP-43'}));const q=again(f,g,{growTo:45});assert.ok(q.empty,'a row just above the old top '+why(q))}});

test('a locked full-height PDU follows a new rack height: no lock problem, and the preview shows the new length',async()=>{
  for(const lock of['uLock','lockItems']){const f=fixture();if(lock==='uLock')f.u('u-pdua').uLock=true;else f.r.lockItems=true;const t=exp(f);t.about.find(r=>r[0]==='Height (U)')[1]=45;
    const book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx',{doc:f.doc}),p=RS.plan(f.r,f.rp.items,RS.fromRows(book.tabs[0].rows,{doc:f.doc}),{about:book.about},f.env),x=p.rows.find(r=>r.id==='u-pdua');
    assert.deepEqual(x.problems,[],lock);assert.equal(x.position,'0U left · U1–45');assert.equal(p.lockedMoves,0);RS.apply(p,f.r,f.rp,f.env);assert.equal(at(f,'u-pdua'),x.position)}});

test('rows without a name or U (a filled-in placeholder) match what they added last time',()=>{
  for(const len of['','21']){const f=fixture();f.rp.items.splice(f.rp.items.indexOf(f.u('u-pdub')),1);const t=exp(f),g=grid(t),ph=g.find(r=>r[col(t,'mount')]==='0U right');ph[col(t,'equipment')]='PDU 0U (vertical)';ph[col(t,'height')]=len;
    const q=again(f,g);assert.ok(q.empty,len+why(q));RS.apply(q,f.r,f.rp,f.env);assert.equal(Racks.extras(f.r,f.rp.items).filter(n=>Racks.where(f.r,n).mount==='right').length,1,'one PDU, not two')}
  const f=fixture(),t=exp(f),g=grid(t);g.push(row(t,{equipment:'Blanking panel'}));const q=again(f,g);assert.ok(q.empty,why(q));assert.equal(q.matchedBy.includes('position'),true)});

test('a unit changed to a roof fan tray gets the fan count from Equipment',()=>{const f=fixture();f.rp.items.splice(f.rp.items.indexOf(f.u('u-tray')),1);const t=exp(f),g=grid(t),r=rowOf(g,t,'u-blank');r[col(t,'equipment')]='Roof fan tray (2 fans)';r[col(t,'mount')]='Roof';
  const p=planOf(f,g);assert.equal(p.rows.find(x=>x.id==='u-blank').what,'Moved from U1 · Equipment: Blanking panel → Roof fan tray (2 fans)');RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('u-blank').data.fans,2);assert.equal(at(f,'u-blank'),'Roof · 2 fans');assert.ok(planOf(f,g).empty)});

test('linking by name: an exact match first; a match in another case renames the device to the row’s spelling, once',()=>{
  {const f=fixture(),t=exp(f),g=grid(t);g.push(row(t,{u:'20',height:'1',mount:'Rack U',equipment:'Server',name:'esx-03'}));const p=planOf(f,g),x=p.rows.find(r=>r.name==='esx-03');
    assert.equal(x.what,'New · links to ESX-03 (Network) · Name: ESX-03 → esx-03 — renames the linked device on “Network”');assert.deepEqual(p.renames.map(r=>[r.from,r.to]),[['ESX-03','esx-03']]);
    RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('d-esx3').labels[0].text,'esx-03');const q=planOf(f,g);assert.ok(q.empty,why(q))}
  {const f=fixture(),d=Shapes.make('server',0,0,'esx-03');d.id='d-esx3b';f.net.items.push(d);const t=exp(f),g=grid(t);g.push(row(t,{u:'20',height:'1',mount:'Rack U',equipment:'Server',name:'esx-03'}));
    const x=planOf(f,g).rows.find(r=>r.name==='esx-03');assert.equal(x.link.id,'d-esx3b');assert.equal(x.what,'New · links to esx-03 (Network)')}});

test('new rows that share a name are matched by name and position next time',()=>{const f=fixture(),t=exp(f),g=grid(t);for(const u of['20','21']){const r=g.find(r=>r[col(t,'u')]===u);r[col(t,'name')]='Blank';r[col(t,'equipment')]='Blanking panel'}
  const p=planOf(f,g);assert.equal(p.counts.add,2);RS.apply(p,f.r,f.rp,f.env);const q=planOf(f,g);assert.ok(q.empty,why(q));
  const f2=fixture(),t2=exp(f2),g2=grid(t2);g2.push(row(t2,{u:'20',height:'1',mount:'Rack U',equipment:'Server',name:'ESX-01'}));const q2=again(f2,g2);assert.ok(q2.empty,'a second unit named like a racked device '+why(q2))});

test('a value that really starts with an apostrophe survives the workbook and CSV round trips',async()=>{const set=f=>{f.u('u-core').data.notes="'=not a formula";f.u('u-patch').labels[0].text="'+Patch";f.u('u-ups').data.serial="'=A1";return f};
  const f=set(fixture()),t=exp(f),book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx',{doc:f.doc}),p=RS.plan(f.r,f.rp.items,RS.fromRows(book.tabs[0].rows,{doc:f.doc}),{about:book.about},f.env);assert.ok(p.empty,why(p));
  const raw=(await X.Xlsx.read(RS.toXlsx(t)))[0].rows,p2=RS.plan(f.r,f.rp.items,RS.fromRows(raw,{doc:f.doc,guard:false}),{},f.env);assert.ok(p2.empty,'rows straight from Xlsx.read '+why(p2));
  const c=await RS.read(RS.toCSV(t),'A01 - rack.csv',{doc:f.doc});assert.ok(planOf(f,c.tabs[0].rows).empty)});

test('stored values that are not numbers, booleans, CR LF line breaks and control characters import with nothing to change',async()=>{
  {const f=fixture();f.u('u-core').data.power='n/a';f.r.data.width='wide';f.doc.fields.push({key:'managed',label:'Managed'});f.u('u-esx2').data.managed=true;f.u('u-blank').data.notes='line 1\r\nline 2';f.u('u-patch').data.notes='a\u000Bb';
    const t=exp(f),book=await RS.read(RS.toXlsx(t),'A01 - rack.xlsx',{doc:f.doc}),p=RS.plan(f.r,f.rp.items,RS.fromRows(book.tabs[0].rows,{doc:f.doc}),{about:book.about},f.env);assert.ok(p.empty,why(p));
    const g=grid(t);rowOf(g,t,'u-core')[col(t,'field','power')]='400';assert.equal(planOf(f,g).rows.find(x=>x.id==='u-core').what,'Power draw (W): n/a → 400','a real number replaces it')}
  {const f=fixture();f.u('u-blank').data.notes='line 1\nline 2';const csv=RS.toCSV(exp(f)).replace('line 1\nline 2','line 1\r\nline 2'),c=await RS.read(csv,'x.csv',{doc:f.doc});assert.ok(planOf(f,c.tabs[0].rows).empty,'CR LF inside a CSV cell')}});

test('a Name cell with several lines: only the first line is the name',()=>{const f=fixture(),t=exp(f),g=grid(t);rowOf(g,t,'u-patch')[col(t,'name')]='Patch B\nFloor 3';const csv=RS.toCSV({columns:t.columns,rows:g.slice(1)});
  const p=planOf(f,RS.parseCSV(csv)),x=p.rows.find(r=>r.id==='u-patch');assert.equal(x.what,'Name: Patch A → Patch B');assert.ok(x.notes.includes('Name has more than one line — only the first line is used'));
  RS.apply(p,f.r,f.rp,f.env);assert.equal(f.u('u-patch').labels[0].text,'Patch B\nFloor 2');assert.ok(planOf(f,RS.parseCSV(csv)).empty)});

test('CSV separators: a title line above the header does not decide the separator',()=>{
  for(const csv of['Rack A01\r\n\r\nU (bottom);Height (U);Mount;Equipment;Name\r\n20;1;Rack U;Server;NEW-1\r\n','Rack A01, comms room\r\nU (bottom);Height (U);Mount;Equipment;Name\r\n20;1;Rack U;Server;NEW-1\r\n',
    'Rack A01; comms room\r\nU (bottom),Height (U),Mount,Equipment,Name\r\n20,1,Rack U,Server,NEW-1\r\n','Rack A01\n\nU (bottom)\tHeight (U)\tMount\tEquipment\tName\n20\t1\tRack U\tServer\tNEW-1\n']){
    assert.ok(RS.isRackTable(csv),csv);const p=RS.fromRows(RS.parseCSV(csv));assert.equal(p.error,null);assert.deepEqual(p.rows.map(r=>[r.name,r.u]),[['NEW-1',20]])}});

test('numbers with words in front, E notation and thousands separators',()=>{
  for(const[s,v]of[['ca. 350 W',350],['approx. 350 W',350],['max. 600',600],['~350',350],['1e3',1000],['1.5E+3',1500],['-48',-48],['.5',.5],['1 200',1200],["1'200",1200],['1.234.567',1234567],['€1,200.50',1200.5],['350 W',350]])assert.equal(RS.parseNum(s),v,s);
  for(const s of['350-400','N/A','-','10.0.0.1','2 x 350'])assert.ok(Number.isNaN(RS.parseNum(s)),s);
  const f=fixture(),t=exp(f),g=grid(t);rowOf(g,t,'u-fw')[col(t,'depth')]='1e3';rowOf(g,t,'u-patch')[col(t,'field','power')]='350-400';const p=planOf(f,g);
  assert.equal(p.rows.find(x=>x.id==='u-fw').what,'Depth (mm): (empty) → 1000');assert.ok(p.rows.find(x=>x.id==='u-patch').problems.includes('Power draw (W) “350-400” is not a number — not changed'))});

test('custom fields named "Typical …" or "Linked device …" are imported; the grey columns are not',()=>{const f=fixture();f.doc.fields.push({key:'typLoad',label:'Typical load (A)'},{key:'linkedDev',label:'Linked device ID'});f.u('u-core').data.typLoad='4';
  const t=exp(f),g=grid(t),r=rowOf(g,t,'u-core');r[col(t,'field','typLoad')]='6';r[col(t,'field','linkedDev')]='X-2';const fr=RS.fromRows(g,{doc:f.doc});assert.deepEqual(fr.ignored,[]);assert.ok(!fr.columns.some(c=>c.key==='typical'||c.key==='linked'));
  assert.equal(planOf(f,g).rows.find(x=>x.id==='u-core').what,'Typical load (A): 4 → 6 · Linked device ID: (empty) → X-2')});

test('a long rack name is cut to a tab name without splitting an emoji',async()=>{const t=RS.blankTable(42,'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234🔥 tail',{});assert.equal(t.sheet,'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');
  const book=await RS.read(RS.toXlsx(t),'x.xlsx');assert.equal(book.tabs[0].name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234');assert.equal(book.about.name,'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234🔥 tail','About keeps the real name')});

module.exports={fixture,X};

// ---------- art units ----------
function withArt(){const f=fixture(),{doc,rp,r}=f;const add=(id,name,type='vs-a')=>{X.Stencils.shapes[id]={name,vb:'0 0 19 1.75',svg:'<g stroke="none"/>',pack:'doc',cat:'rack-art',rackUnit:{u:1,frac:1,from:type}};Shapes.rackItems[id]={name,fam:name,u:1,face:'art'}};add('rkc-sw','C9300 Front');add('rkc-v1','Visio shape');add('rkc-v2','Visio shape');
  const unit=(id,type,u,text='')=>{const n=Shapes.make(type,0,0,text);n.id=id;rp.items.push(n);n.labels[0].text=text;Racks.placeAt(r,n,u);return n};return{...f,sw:unit('u-art','rkc-sw',30,''),v1:unit('u-v1','rkc-v1',28,'Named'),v2:unit('u-v2','rkc-v2',26,'')}}

test('art units: the equipment column names the picture, the list offers what this drawing uses, no more',()=>{const f=withArt(),t=RS.exportTable(f.r,f.rp.items,f.env),g=grid(t),row=rowOf(g,t,'u-art');assert.equal(row[col(t,'equipment')],'C9300 Front');assert.equal(row[col(t,'u')],'30');
  assert.ok(t.lists.includes('C9300 Front'),'used here');assert.equal(t.lists.filter(x=>x==='Visio shape').length,1,'same name once');const plain=fixture(),t2=RS.exportTable(plain.r,plain.rp.items,plain.env);assert.ok(!t2.lists.includes('C9300 Front'),'not from another drawing, though the registry still holds it');assert.ok(t2.lists.includes('Router'))});

test('art units: an untouched sheet changes nothing, and same-named pictures stay what they are',()=>{const f=withArt(),t=RS.exportTable(f.r,f.rp.items,f.env),src=RS.fromRows(grid(t),{doc:f.doc}),P=RS.plan(f.r,f.rp.items,src,{},f.env);assert.ok(P.empty,'no changes: '+JSON.stringify(P.rows.filter(x=>x.status!=='same').map(x=>x.what)));
  const g=grid(t);rowOf(g,t,'u-v1')[col(t,'name')]='Renamed';rowOf(g,t,'u-art')[col(t,'name')]='Core-1';rowOf(g,t,'u-v2')[col(t,'u')]='24';const P2=RS.plan(f.r,f.rp.items,RS.fromRows(g,{doc:f.doc}),{},f.env);RS.apply(P2,f.r,f.rp,f.env);
  assert.equal(f.v1.type,'rkc-v1');assert.equal(f.v2.type,'rkc-v2','not the first picture of that name');assert.equal(f.sw.type,'rkc-sw');assert.equal(f.v1.labels[0].text,'Renamed');assert.equal(f.sw.labels[0].text,'Core-1','an unnamed unit takes a name');assert.equal(Racks.uOf(f.r,f.v2),24)});

test('art units: a picture named like a family does not take over the family',()=>{const f=withArt();X.Stencils.shapes['rkc-rt']={name:'Router',vb:'0 0 1 1',svg:'<g/>',pack:'doc',rackUnit:{u:1,frac:1}};Shapes.rackItems['rkc-rt']={name:'Router',fam:'Router',u:1,face:'art'};
  const parse=txt=>{const g=[['U','Name','Equipment','Height (U)','Mount'],['5','New one',txt,'2','U']];return RS.fromRows(g,{doc:f.doc}).rows[0]};assert.equal(parse('Router').eq.type,null,'the family');assert.equal(parse('Router').eq.fam,'Router');assert.equal(parse('C9300 Front').eq.type,'rkc-sw','an exact picture name still finds it');delete Shapes.rackItems['rkc-rt']});

// the picture a row means when names repeat
const artDef=(id,name)=>{X.Stencils.shapes[id]={name,vb:'0 0 19 1.75',svg:'<g stroke="none"/>',pack:'doc',cat:'rack-art',rackUnit:{u:1,frac:1}};Shapes.rackItems[id]={name,fam:name,u:1,face:'art'}};
const artGone=(...ids)=>{for(const id of ids){delete X.Stencils.shapes[id];delete Shapes.rackItems[id]}};
const newRackPlan=(f,g,opts={})=>{const R=Shapes.make('rack42',0,0,'New');return{R,P:RS.plan(R,[R],RS.fromRows(g,{doc:f.doc}),{...opts,newRack:true},f.env)}};
test('art units: exported into a new rack, each row keeps the picture its Row ID points at, also one named like a family',()=>{const f=withArt();artDef('rkc-rt','Router');const rt=Shapes.make('rkc-rt',0,0,'Rt');rt.id='u-rt';f.rp.items.push(rt);Racks.placeAt(f.r,rt,24);
  const t=exp(f),{R,P}=newRackPlan(f,grid(t)),row=id=>P.rows.find(x=>x.p.rowId===id);assert.equal(row('u-v1').type,'rkc-v1');assert.equal(row('u-v2').type,'rkc-v2','not the first of that name');assert.equal(row('u-art').type,'rkc-sw');assert.equal(row('u-rt').type,'rkc-rt','not the built-in router');assert.equal(row('u-core').type,'rk-switch','built-ins as before');
  const pg={items:[R]};RS.apply(P,R,pg,f.env);const at=u=>Racks.contents(R,pg.items).find(n=>Racks.uOf(R,n)===u)?.type;assert.equal(at(28),'rkc-v1');assert.equal(at(26),'rkc-v2');assert.equal(at(24),'rkc-rt');
  const g=grid(t);rowOf(g,t,'u-v2')[col(t,'equipment')]='C9300 Front';assert.equal(newRackPlan(f,g).P.rows.find(x=>x.p.rowId==='u-v2').type,'rkc-sw','a row that now names something else gets that');artGone('rkc-rt')});
test('art units: a copied row without a Row ID does not take the first picture of that name, it asks',()=>{const f=withArt(),t=exp(f),g=grid(t),copy=[...rowOf(g,t,'u-v2')];copy[col(t,'name')]='B copy';copy[col(t,'u')]='20';copy[col(t,'rowId')]='';g.push(copy);const P=planOf(f,g),x=P.rows.find(r=>r.name==='B copy');
  assert.equal(x.pickArt,true);assert.equal(x.place,null,'not placed');assert.equal(x.status,'skip');assert.match(x.problems.join(),/Several pictures are called “Visio shape”/);assert.equal(P.empty,false);assert.equal(P.counts.add,0);
  const P2=planOf(f,g,{types:{[x.line]:'rkc-v2'}}),y=P2.rows.find(r=>r.name==='B copy');assert.equal(y.type,'rkc-v2','the one chosen');assert.equal(y.status,'new');assert.equal(y.problems.length,0);RS.apply(P2,f.r,f.rp,f.env);assert.equal(f.rp.items.find(n=>n.labels?.[0]?.text==='B copy').type,'rkc-v2')});
test('art units: names that do not repeat here resolve, this drawing before the rest of the session',()=>{const f=withArt();artDef('rkc-elsewhere','C9300 Front');artDef('rkc-only','Spare plate');artDef('rkc-s1','Other plate');artDef('rkc-s2','Other plate');
  const newRow=(txt,id='')=>{const t=exp(f),g=grid(t),row=g[0].map(()=>'');row[col(t,'name')]='Fresh';row[col(t,'u')]='35';row[col(t,'equipment')]=txt;row[col(t,'rowId')]=id;g.push(row);return planOf(f,g).rows.find(r=>r.name==='Fresh')};
  let x=newRow('C9300 Front');assert.equal(x.type,'rkc-sw','used in this drawing');assert.ok(!x.pickArt);x=newRow('Spare plate');assert.equal(x.type,'rkc-only','the only one known');x=newRow('Other plate');assert.equal(x.pickArt,true,'several, none used here');x=newRow('rkc-v2');assert.equal(x.type,'rkc-v2','its exact key');x=newRow('Server');assert.ok(!x.pickArt);assert.equal(x.type,'rk-server');
  const t=exp(f),g=grid(t);rowOf(g,t,'u-core')[col(t,'equipment')]='Visio shape';const y=planOf(f,g).rows.find(r=>r.id==='u-core');assert.equal(y.type,'rk-switch','a matched unit stays what it is');assert.match(y.problems.join(),/equipment not changed/);const g2=grid(t);rowOf(g2,t,'u-v1')[col(t,'name')]='Still';const z=planOf(f,g2).rows.find(r=>r.id==='u-v1');assert.equal(z.type,'rkc-v1');assert.equal(z.problems.length,0,'its own picture is no question');artGone('rkc-elsewhere','rkc-only','rkc-s1','rkc-s2')});

test('art units: a CSV device type never resolves to a rack picture',()=>{withArt();X.Stencils.shapes['rkc-t']={name:'Spine router X9',tags:'spine9000',vb:'0 0 1 1',svg:'<g/>',pack:'doc',rackUnit:{u:1,frac:1}};assert.notEqual(Builder.matchType('Spine router X9'),'rkc-t','by name');assert.notEqual(Builder.matchType('spine9000'),'rkc-t','by tag');delete X.Stencils.shapes['rkc-t']});
