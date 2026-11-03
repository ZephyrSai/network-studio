// AutoCAD DXF writer: the structure AutoCAD's AUDIT relies on (sections, tables, handles, owners, references), the
// coordinate flip, fills with holes, text encoding, layers, connectors, blocks — and a clean ezdxf audit when Python has
// ezdxf (DXF_PYTHON=/path/to/python to choose one; skipped otherwise, so npm test needs nothing extra).
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const D=require('../js/dxf.js');

// ---- an independent reader: group code / value pairs, typed by the DXF reference ranges ----
const kind=c=>c>=10&&c<60||c>=110&&c<150||c>=210&&c<240||c>=460&&c<470||c>=1010&&c<1060?'float':c>=60&&c<100||c>=170&&c<180||c>=270&&c<300||c>=370&&c<390||c>=400&&c<410||c>=420&&c<430||c>=440&&c<460||c>=1060&&c<1072?'int':c===5||c===105||c>=320&&c<370||c>=390&&c<400?'handle':'str';
function pairs(dxf){const L=dxf.split('\r\n');assert.equal(L.pop(),'','ends with a line break');assert.equal(L.length%2,0,'even number of lines');const out=[];
  for(let i=0;i<L.length;i+=2){const c=L[i].trim(),v=L[i+1];assert.match(c,/^\d+$/,`group code on line ${i+1}`);const k=kind(+c);assert.match(v,/^[\x20-\x7e]*$/,`printable ASCII on line ${i+2}`);
    if(k==='float')assert.match(v,/^-?\d+\.\d+$/,`real (no exponent) for code ${c} on line ${i+2}: ${v}`);else if(k==='int')assert.match(v,/^-?\d+$/,`integer for code ${c} on line ${i+2}: ${v}`);else if(k==='handle')assert.match(v,/^[0-9A-F]+$/,`handle for code ${c} on line ${i+2}: ${v}`);
    out.push([+c,v])}return out}
// sections -> objects {type, tags}
function parse(dxf){const P=pairs(dxf),S={},order=[];let cur=null,obj=null;assert.deepEqual(P.at(-1),[0,'EOF'],'EOF last');
  for(let i=0;i<P.length-1;i++){const[c,v]=P[i];if(c===0&&v==='SECTION'){const[c2,name]=P[++i];assert.equal(c2,2);order.push(name);cur=S[name]=[];obj=null;continue}if(c===0&&v==='ENDSEC'){cur=null;continue}assert.ok(cur,'pair outside a section at '+i);if(c===0){obj={type:v,tags:[]};cur.push(obj)}else if(obj)obj.tags.push([c,v]);else cur.push({type:null,tags:[[c,v]]})}
  return{S,order}}
const get=(o,c)=>o.tags.find(t=>t[0]===c)?.[1],all=(o,c)=>o.tags.filter(t=>t[0]===c).map(t=>t[1]);
const handleOf=o=>get(o,5)??get(o,105);
const ownerOf=o=>{let depth=0;for(const[c,v]of o.tags){if(c===102)depth+=v.startsWith('{')?1:-1;else if(c===330&&!depth)return v}};
// everything AutoCAD checks when it opens a file, returns what the tests look at next
function check(dxf){const{S,order}=parse(dxf);assert.deepEqual(order,['HEADER','CLASSES','TABLES','BLOCKS','ENTITIES','OBJECTS']);
  const H={};let name=null;for(const o of S.HEADER)for(const[c,v]of o.tags){if(c===9){name=v;H[name]=[]}else H[name].push(v)}
  assert.equal(H.$ACADVER[0],'AC1018');assert.equal(H.$INSUNITS[0],'4');assert.equal(H.$DWGCODEPAGE[0],'ANSI_1252');
  const objs=[...S.TABLES,...S.BLOCKS,...S.ENTITIES,...S.OBJECTS].filter(o=>!['ENDTAB'].includes(o.type)),byH=new Map();
  for(const o of objs){const h=handleOf(o);assert.ok(h,`${o.type} has a handle`);assert.ok(!byH.has(h),`handle ${h} unique (${o.type})`);assert.notEqual(parseInt(h,16),0);byH.set(h,o)}
  const seed=parseInt(H.$HANDSEED[0],16);for(const h of byH.keys())assert.ok(parseInt(h,16)<seed,`$HANDSEED above handle ${h}`);
  for(const o of objs){const ow=ownerOf(o);if(o.type==='TABLE'||o.type==='DICTIONARY'&&ow==='0')assert.equal(ow,'0');else assert.ok(byH.has(ow),`${o.type} ${handleOf(o)} owner ${ow} exists`);
    for(const[c,v]of o.tags)if((c===330||c===350||c===360||c===390||c===340&&v!=='0')&&!(c===330&&v==='0'&&(o.type==='TABLE'||o.type==='DICTIONARY')))assert.ok(byH.has(v),`${o.type} ${handleOf(o)} code ${c} -> ${v} exists`)}
  // tables: fixed order, counts, record owners
  const tables=[];let t=null;for(const o of S.TABLES){if(o.type==='TABLE'){t={name:get(o,2),h:get(o,5),n:+get(o,70),recs:[]};tables.push(t)}else if(o.type==='ENDTAB')t=null;else{assert.ok(t);assert.equal(ownerOf(o),t.h,`${o.type} owned by its table`);t.recs.push(o)}}
  assert.deepEqual(tables.map(x=>x.name),['VPORT','LTYPE','LAYER','STYLE','VIEW','UCS','APPID','DIMSTYLE','BLOCK_RECORD']);for(const x of tables)assert.equal(x.recs.length,x.n,`${x.name} count`);
  const T=Object.fromEntries(tables.map(x=>[x.name,x.recs])),names=k=>new Set(T[k].map(r=>get(r,2).toLowerCase()));
  // layer and block names: no character AutoCAD rejects (non-ASCII only as \U+XXXX), unique ignoring case once decoded
  const dec=v=>v.replace(/\\U\+([0-9A-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16))).toLowerCase();
  for(const k of['LAYER','BLOCK_RECORD']){const ns=T[k].map(r=>get(r,2)).filter(n=>!/^\*(Model|Paper)_Space$/.test(n));for(const n of ns)assert.match(n,/^(?:\\U\+[0-9A-F]{4}|[^<>\/\\":;?*|=`,])+$/,`${k} name ${n} legal`);assert.equal(new Set(ns.map(dec)).size,ns.length,`${k} names unique: ${ns}`)}
  for(const k of['bylayer','byblock','continuous'])assert.ok(names('LTYPE').has(k));assert.ok(names('LAYER').has('0'));assert.ok(names('STYLE').has('standard'));assert.ok(names('APPID').has('acad'));
  const BR=new Map(T.BLOCK_RECORD.map(r=>[get(r,2),handleOf(r)]));assert.ok(BR.has('*Model_Space')&&BR.has('*Paper_Space'));assert.equal(BR.get('*Model_Space'),'1F','model space at handle 1F, as AutoCAD numbers it');
  for(const nm of['*Model_Space','*Paper_Space']){const lay=byH.get(get(T.BLOCK_RECORD.find(r=>get(r,2)===nm),340));assert.equal(lay.type,'LAYOUT');assert.equal(all(lay,330).at(-1),BR.get(nm),'layout points back at its block record')}
  // blocks: BLOCK ... ENDBLK per record, contents owned by it
  const defined=new Map();let blk=null;for(const o of S.BLOCKS){if(o.type==='BLOCK'){blk={name:get(o,2),owner:ownerOf(o),ents:[]};assert.equal(BR.get(blk.name),blk.owner,'BLOCK owned by its record');defined.set(blk.name,blk)}else if(o.type==='ENDBLK'){assert.equal(ownerOf(o),blk.owner);blk=null}else{assert.ok(blk);assert.equal(ownerOf(o),blk.owner);blk.ents.push(o)}}
  assert.deepEqual([...defined.keys()].sort(),[...BR.keys()].sort(),'every block record has a block');
  const layers=names('LAYER'),lts=names('LTYPE'),styles=names('STYLE');
  for(const o of[...S.ENTITIES,...[...defined.values()].flatMap(b=>b.ents)]){assert.ok(o.tags.some(x=>x[0]===100&&x[1]==='AcDbEntity'),`${o.type} AcDbEntity`);assert.ok(layers.has(get(o,8).toLowerCase()),`layer ${get(o,8)} exists`);if(get(o,6))assert.ok(lts.has(get(o,6).toLowerCase()),`linetype ${get(o,6)} exists`);if(o.type==='MTEXT')assert.ok(styles.has(get(o,7).toLowerCase()));if(o.type==='INSERT')assert.ok(defined.has(get(o,2)),`block ${get(o,2)} defined`)}
  for(const o of S.ENTITIES)assert.equal(ownerOf(o),BR.get('*Model_Space'),'entities live in model space');
  const root=S.OBJECTS[0];assert.equal(root.type,'DICTIONARY');for(const k of['ACAD_GROUP','ACAD_LAYOUT','ACAD_PLOTSTYLENAME'])assert.ok(all(root,3).includes(k),'root dictionary has '+k);
  return{H,T,S,blocks:defined,ents:S.ENTITIES,byH}}
const xy=o=>{const xs=all(o,10).map(Number),ys=all(o,20).map(Number),k=o.type==='HATCH'?1:0;return xs.map((x,i)=>[x,ys[i]]).slice(k)};// a hatch's first 10/20 is its elevation point
const near=(a,b,e=1e-3)=>assert.ok(Math.abs(a-b)<=e,`${a} ≈ ${b}`);
const sq=(x,y,w,h,ccw)=>{const p=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];return ccw?p.reverse():p};
const page=(shapes,extra={})=>({title:'Test',pages:[{name:'Sheet',width:11,height:8.5,layers:[{name:'Devices',visible:true,print:true,locked:false},{name:'Links',visible:true,print:true,locked:false}],shapes,...extra}]});

// a sheet with one of everything
function rich(){return page([
  {kind:'shape',name:'Router',x:1,y:1,w:1,h:1,layers:[0],geoms:[{closed:true,fill:'#3366cc',fillOpacity:1,stroke:'#112233',weight:1.5,points:sq(0,0,1,1)},{closed:true,fill:'#3366cc',fillOpacity:1,stroke:null,points:sq(.3,.3,.4,.4,true)},{closed:false,fill:null,stroke:'#ff0000',weight:.75,dash:1,dashArray:[.06,.04],points:[[0,.5],[1,.5]]}],text:'core-rtr-01\nÄ Ω ^ %% {x}\\',textColor:'#34465e',textSize:8,align:'center',bold:true,textBox:{x:0,y:1,w:1,h:.3},textBg:'#ffffff'},
  {kind:'shape',name:'Router',x:3,y:1,w:1,h:1,layers:[0],geoms:[{closed:true,fill:'#3366cc',fillOpacity:1,stroke:'#112233',weight:1.5,points:sq(0,0,1,1)},{closed:true,fill:'#3366cc',fillOpacity:1,stroke:null,points:sq(.3,.3,.4,.4,true)},{closed:false,fill:null,stroke:'#ff0000',weight:.75,dash:1,dashArray:[.06,.04],points:[[0,.5],[1,.5]]}],text:'core-rtr-02',textColor:'#34465e',textSize:8,textBox:{x:0,y:1,w:1,h:.3}},
  {kind:'shape',name:'PDU',x:6,y:1,w:.3,h:2,angle:90,layers:[0],geoms:[{closed:true,fill:'#eeeeee',fillOpacity:.5,stroke:'#475569',strokeOpacity:.13,weight:.6,points:sq(0,0,.3,2)}],text:'PDU-A',textSize:7,textBox:{x:0,y:.8,w:.3,h:.4},textAngle:Math.PI/2},
  {kind:'connector',points:[[2,1.5],[3,1.5]],stroke:'#4a6fa5',weight:1.5,dash:2,beginArrow:'dot',endArrow:'arrow',text:'10G',textColor:'#333333',textSize:8,textPos:[2.5,1.4],layers:[1]},
  {kind:'connector',points:[[2,3],[4,3],[4,4]],path:[[[2,3],[2.9,3],[3,2.95],[3.1,3],[4,3],[4,4]]],double:true,stroke:'#1e3a8a',weight:1.5,beginArrow:'openArrow',endArrow:'circle',text:'',layers:[1]},
  {kind:'connector',points:[[5,5],[7,6]],stroke:'#000',weight:1,beginArrow:'bar',endArrow:'diamond',text:'uplink',textBg:null,layers:[1]},
  {kind:'text',x:5,y:5,w:2,h:.4,text:'Zone A · VLAN 10',textColor:'#123456',textSize:9,align:'left',fill:'#ffffff',stroke:'#cccccc',layers:[1],textAngle:Math.PI/2},
  {kind:'image',x:8,y:6,w:1,h:1,mime:'image/png',data:new Uint8Array(4),layers:[0]}])}

test('a rich sheet passes the structural checks AutoCAD relies on, and is deterministic',()=>{const r=D.build(rich());const{ents,blocks}=check(r.dxf);
  assert.deepEqual(r.skipped,{images:1});assert.equal(r.dxf,D.build(rich()).dxf,'same input, same bytes');
  const n=t=>ents.filter(o=>o.type===t).length;assert.equal(n('INSERT'),3);assert.equal(blocks.size-2,2,'two distinct drawings -> two blocks');assert.ok(n('MTEXT')>=5);assert.ok(n('HATCH')>=4);assert.ok(n('LWPOLYLINE')>=6)});

test('coordinates: millimetres, Y up, origin at the sheet\'s bottom-left; extents and opening view cover the sheet',()=>{
  const r=D.build(page([{kind:'shape',name:'Box',x:1,y:1,w:2,h:1,layers:[0],geoms:[{closed:true,fill:null,stroke:'#000000',weight:.75,points:sq(0,0,2,1)}]},{kind:'connector',points:[[0,8.5],[11,0]],stroke:'#000',weight:.75,layers:[1]}]),{blocks:false});
  const{H,ents}=check(r.dxf),pl=ents.filter(o=>o.type==='LWPOLYLINE');
  assert.deepEqual(xy(pl[0]),[[0,0],[279.4,0],[279.4,215.9],[0,215.9]],'page frame: 11 x 8.5 in');assert.equal(get(pl[0],8),'Page frame');
  assert.deepEqual(xy(pl[1]),[[25.4,190.5],[76.2,190.5],[76.2,165.1],[25.4,165.1]],'box: top-left (1,1) in -> (25.4, 190.5) mm');assert.equal(+get(pl[1],70)&1,1,'closed');
  assert.deepEqual(xy(pl[2]),[[0,0],[279.4,215.9]],'connector flipped');assert.deepEqual(H.$LIMMAX.map(Number),[279.4,215.9]);assert.deepEqual(H.$EXTMAX.map(Number).slice(0,2),[279.4,215.9]);
  // blocks: the same box as a block inserted at its centre, turned with the shape
  const b=check(D.build(page([{kind:'shape',name:'Box',x:1,y:1,w:2,h:1,angle:30,layers:[0],geoms:[{closed:true,stroke:'#000000',weight:.75,points:sq(0,0,2,1)}]}])).dxf),ins=b.ents.find(o=>o.type==='INSERT');
  near(+get(ins,10),50.8);near(+get(ins,20),177.8);near(+get(ins,50),30);assert.equal(get(ins,8),'Devices');
  const inner=[...b.blocks.values()].find(x=>x.name==='Box').ents[0];assert.deepEqual(xy(inner),[[-25.4,12.7],[25.4,12.7],[25.4,-12.7],[-25.4,-12.7]],'block drawn about its base point');assert.equal(get(inner,8),'0','block contents on layer 0 follow the insert')});

test('fills: solid hatches under their outlines, cut-outs kept, nonzero vs evenodd, transparency',()=>{
  const ring=(inner,rule)=>check(D.build(page([{kind:'shape',x:1,y:1,w:1,h:1,layers:[0],fillRule:rule,geoms:[{closed:true,fill:'#ff0000',stroke:'#000000',weight:.75,points:sq(0,0,1,1)},{closed:true,fill:'#ff0000',stroke:'#000000',weight:.75,points:inner}]}]),{blocks:false}).dxf).ents.filter(o=>o.type!=='LWPOLYLINE'||get(o,8)!=='Page frame');
  let e=ring(sq(.25,.25,.5,.5,true));assert.deepEqual(e.map(o=>o.type),['HATCH','LWPOLYLINE','LWPOLYLINE'],'fill first, then both outlines');assert.equal(get(e[0],91),'2','reverse-wound inner loop is a hole');assert.equal(get(e[0],2),'SOLID');assert.equal(get(e[0],75),'0','odd parity');
  e=ring(sq(.25,.25,.5,.5));assert.equal(get(e[0],91),'1','same winding under nonzero: filled, no hole');
  e=ring(sq(.25,.25,.5,.5),'evenodd');assert.equal(get(e[0],91),'2','evenodd: hole');
  e=ring(sq(2,2,.5,.5,true));assert.equal(e.filter(o=>o.type==='HATCH').length,2,'a loop outside is its own fill');
  const t=check(D.build(page([{kind:'shape',x:1,y:1,w:1,h:1,layers:[0],geoms:[{closed:true,fill:'#00ff00',fillOpacity:.5,stroke:'#0000ff',strokeOpacity:.25,weight:.75,points:sq(0,0,1,1)}]}]),{blocks:false}).dxf).ents;
  assert.equal(get(t.find(o=>o.type==='HATCH'),440),String(0x2000000|128),'fill 50% opaque');assert.equal(get(t.at(-1),440),String(0x2000000|64),'line 25% opaque')});

test('colours, line weights and dash patterns',()=>{const r=D.build(page([{kind:'shape',x:1,y:1,w:1,h:1,layers:[0],geoms:[
    {closed:false,stroke:'#ff0000',weight:1.5,points:[[0,0],[1,0]]},{closed:false,stroke:'#3366cc',weight:.75,dash:1,points:[[0,.2],[1,.2]]},{closed:false,stroke:'#000',weight:.75,dash:2,points:[[0,.4],[1,.4]]},
    {closed:false,stroke:'#000',weight:.75,dash:1,dashArray:[3/96,1.5/96],points:[[0,.6],[1,.6]]},{closed:false,stroke:'#000',weight:.75,dashArray:[3/96,1.5/96],points:[[0,.8],[1,.8]]},{closed:false,stroke:'#000',weight:.75,dashArray:[2/96],points:[[0,1],[1,1]]}]}]),{blocks:false});
  const{ents,T}=check(r.dxf),l=ents.filter(o=>o.type==='LWPOLYLINE').slice(1);
  assert.equal(get(l[0],420),String(0xff0000));assert.equal(get(l[0],62),'1','nearest colour index: red');assert.equal(get(l[0],370),'53','1.5 pt = 0.53 mm');assert.equal(get(l[1],370),'25','0.75 pt = 0.25 mm');
  assert.equal(get(l[1],6),'DASHED');assert.equal(get(l[2],6),'DOT');assert.equal(get(l[3],6),'DASH_1','exact pattern wins over the dash code');assert.equal(get(l[4],6),'DASH_1','same pattern, same linetype');assert.equal(get(l[5],6),'DASH_2','odd-length pattern repeats');
  assert.equal(+get(l[1],70)&128,128,'pattern runs on across vertices');
  const lt=T.LTYPE.find(o=>get(o,2)==='DASH_1');assert.deepEqual(all(lt,49).map(Number),[.79375,-.396875]);near(+get(lt,40),1.190625);assert.equal(get(lt,73),'2');
  assert.deepEqual(all(T.LTYPE.find(o=>get(o,2)==='DASH_2'),49).map(Number),[.529167,-.529167])});

test('text: Arial MTEXT, cap height from points, alignment, rotation, escapes, long text in chunks',()=>{
  const long='é'.repeat(80)+'x'.repeat(300);
  const r=D.build(page([{kind:'text',x:1,y:1,w:2,h:.5,text:'left',textSize:9,align:'left',textColor:'#ff0000',layers:[1]},{kind:'text',x:1,y:2,w:2,h:.5,text:'right',textSize:9,align:'right',layers:[1]},{kind:'text',x:1,y:3,w:2,h:.5,text:'up',textSize:9,textAngle:Math.PI/2,layers:[1]},
    {kind:'text',x:1,y:4,w:2,h:.5,text:'A\\B {c} ^d 100%% Ω Ä\ttab\nline2 😀',textSize:9,bold:true,italic:true,layers:[1]},{kind:'text',x:1,y:5,w:2,h:.5,text:long,textSize:9,layers:[1]},{kind:'text',x:1,y:6,w:2,h:.5,lines:['wrapped','by the editor'],text:'wrapped by the editor',textSize:9,layers:[1]}]));
  const m=check(r.dxf).ents.filter(o=>o.type==='MTEXT');
  assert.equal(get(m[0],7),'Arial');near(+get(m[0],40),9*25.4/72*.716,1e-5);assert.equal(get(m[0],71),'4','left -> middle left');near(+get(m[0],10),25.4+3/96*25.4);near(+get(m[0],20),(8.5-1.25)*25.4);assert.equal(get(m[0],420),String(0xff0000));
  assert.equal(get(m[1],71),'6','right -> middle right');near(+get(m[1],10),76.2-3/96*25.4);
  assert.equal(get(m[2],71),'5');near(+get(m[2],11),0);near(+get(m[2],21),1);
  assert.equal(get(m[3],1),'{\\fArial|b1|i1|c0|p34;A\\\\B \\{c\\} ^ d 100%{}% \\U+03A9 \\U+00C4 tab\\Pline2 ?}');
  const chunks=[...all(m[4],3),get(m[4],1)];assert.equal(chunks.length,4,'35 escapes (245 characters) fit a chunk');for(const c of chunks){assert.ok(c.length<=250);assert.match(c,/^(?:\\U\+[0-9A-F]{4}|[^\\])*$/,'no escape cut in two')}assert.equal(chunks.join(''),'\\U+00E9'.repeat(80)+'x'.repeat(300));
  assert.equal(get(m[5],1),'wrapped\\Pby the editor','the editor\'s wrapped lines win')});

test('layers: names AutoCAD accepts, unique ignoring case, visibility, lock and print flags; the page frame',()=>{
  const r=D.build({pages:[{name:'S',width:4,height:3,layers:[{name:'Core <A/B>: "x"; y?*|=`,'},{name:'core <a/b>: "x"; y?*|=`,'},{name:'0'},{name:'Hidden',visible:false},{name:'Locked',locked:true},{name:'NoPrint',print:false},{name:'Größe'},{name:'  '}],shapes:[0,1,2,3,4,5,6,7].map(i=>({kind:'shape',x:0,y:0,w:1,h:1,layers:[i],geoms:[{closed:false,stroke:'#000',points:[[0,0],[1,1]]}]}))}]},{blocks:false});
  const{T,ents}=check(r.dxf),L=Object.fromEntries(T.LAYER.map(o=>[get(o,2),o]));
  assert.deepEqual(r.layers,['0','Page frame','Core _A_B__ _x__ y______','core _A_B__ _x__ y______ 2'.replace('core _A_B','core _a_b'),'0 2','Hidden','Locked','NoPrint','Größe','Layer']);
  assert.ok(+get(L.Hidden,62)<0,'off');assert.equal(+get(L.Locked,70)&4,4,'locked');assert.equal(get(L.NoPrint,290),'0','not plotted');assert.equal(get(L.Devices??L.Hidden,290),undefined);assert.ok(L['Gr\\U+00F6\\U+00DFe'],'non-ASCII names escaped');
  assert.deepEqual(ents.filter(o=>o.type==='LWPOLYLINE').slice(1).map(o=>get(o,8)),['Core _A_B__ _x__ y______','core _a_b__ _x__ y______ 2','0 2','Hidden','Locked','NoPrint','Gr\\U+00F6\\U+00DFe','Layer']);
  const noLayer=check(D.build(page([{kind:'shape',x:0,y:0,w:1,h:1,geoms:[{closed:false,stroke:'#000',points:[[0,0],[1,1]]}]}]),{blocks:false}).dxf).ents;assert.equal(get(noLayer.at(-1),8),'0','no layer -> 0')});

test('connectors: arrow heads at the ends, line pulled back under them, label box at textPos, double rails, drawn path',()=>{
  const{ents}=check(D.build(rich()).dxf),onLinks=ents.filter(o=>get(o,8)==='Links'),u=7/12*1.5/72*25.4;
  const line=onLinks.find(o=>o.type==='LWPOLYLINE'&&get(o,6)==='DOT'),p=xy(line);near(p[1][0],76.2-3*u,1e-4);near(p[0][0],50.8+2*u,1e-4);assert.equal(get(line,370),'53');
  const tri=onLinks.find(o=>o.type==='HATCH'&&xy(o).length===3),tp=xy(tri);near(Math.max(...tp.map(q=>q[0])),76.2+u,1e-4,'tip one marker unit past the end');near(Math.min(...tp.map(q=>q[0])),76.2-7*u,1e-4);
  const box=onLinks.find(o=>o.type==='HATCH'&&get(o,420)===String(0xffffff)),lab=onLinks.find(o=>o.type==='MTEXT'&&get(o,1)==='10G');assert.ok(onLinks.indexOf(box)<onLinks.indexOf(lab),'box under the label');near(+get(lab,10),63.5);near(+get(lab,20),(8.5-1.4)*25.4);assert.equal(get(lab,71),'5');
  const rails=onLinks.filter(o=>o.type==='LWPOLYLINE'&&get(o,420)===String(0x1e3a8a)&&xy(o).length===6);assert.equal(rails.length,2,'double link: two rails along the drawn path (with its jump)');
  const gap=Math.abs(xy(rails[0])[0][1]-xy(rails[1])[0][1]);near(gap,2*.9125*1.5/72*25.4,1e-4);
  assert.ok(onLinks.some(o=>o.type==='LWPOLYLINE'&&xy(o).length===3&&get(o,420)===String(0x1e3a8a)),'open arrow as a stroke');
  const boxed=check(D.build(page([{kind:'connector',points:[[1,1],[3,1]],stroke:'#000',weight:1,text:'x',textBox:{x:1.5,y:.8,w:1,h:.2},textBg:'#eeeeee',layers:[1]}])).dxf).ents,bh=boxed.find(o=>o.type==='HATCH'),bm=boxed.find(o=>o.type==='MTEXT');
  assert.deepEqual(xy(bh).map(q=>q.map(v=>+v.toFixed(3))),[[38.1,190.5],[63.5,190.5],[63.5,195.58],[38.1,195.58]],'the editor\'s label box when given');near(+get(bm,10),50.8);near(+get(bm,20),193.04);assert.equal(get(bh,420),String(0xeeeeee));
  const only=check(D.build(page([{kind:'connector',path:[[[1,1],[3,1]]],stroke:'#000',weight:1,text:'mid',layers:[1]},{kind:'shape',x:5,y:5,w:1,h:1,text:'no box',textBg:'#ffffff',layers:[0],geoms:[{closed:true,fill:'#000000',points:sq(0,0,1,1)}]}]),{blocks:false}).dxf).ents;
  near(+get(only.find(o=>o.type==='MTEXT'&&get(o,1)==='mid'),10),50.8);assert.equal(only.filter(o=>o.type==='HATCH'&&get(o,420)===String(0xffffff)).length,1,'a halo needs the label\'s own box');
  const plain=onLinks.indexOf(onLinks.find(o=>o.type==='MTEXT'&&get(o,1)==='uplink')),before=onLinks[plain-1];assert.ok(plain>0&&!(before.type==='HATCH'&&get(before,420)===String(0xffffff)),'textBg null: no box under the label')});

test('blocks: identical drawings share one, labels stay outside; blocks:false draws in model space',()=>{
  const r=check(D.build(rich()).dxf);const ins=r.ents.filter(o=>o.type==='INSERT');assert.deepEqual(ins.map(o=>get(o,2)),['Router','Router','PDU']);
  assert.equal([...r.blocks.values()].find(b=>b.name==='Router').ents.filter(o=>o.type==='HATCH').length,1);assert.ok(r.ents.some(o=>o.type==='MTEXT'&&get(o,1)==='core-rtr-02'));
  const flat=check(D.build(rich(),{blocks:false}).dxf);assert.equal(flat.ents.filter(o=>o.type==='INSERT').length,0);assert.equal(flat.blocks.size,2)});

test('pictures are counted and outlined, not embedded',()=>{const ir=page([{kind:'image',x:1,y:1,w:2,h:1,mime:'image/png',data:new Uint8Array(8),layers:[0]},{kind:'image',x:4,y:1,w:1,h:1,mime:'image/jpeg',data:new Uint8Array(8),layers:[0]}]);
  const r=D.build(ir);assert.deepEqual(r.skipped,{images:2});const e=check(r.dxf).ents.filter(o=>get(o,8)==='Devices');assert.equal(e.length,6,'frame and two diagonals each');assert.ok(e.every(o=>get(o,6)==='DASHED'));
  const n=D.build(ir,{imageFrames:false});assert.deepEqual(n.skipped,{images:2});assert.equal(check(n.dxf).ents.length,1,'only the page frame')});

test('empty and odd input still gives a valid file; buildAll gives one per sheet',()=>{
  for(const ir of[{},null,{pages:[]},{pages:[{}]},page([null,7,{kind:'shape'},{kind:'shape',geoms:[{points:[[NaN,1],[2,'x']]},null]},{kind:'connector',points:[[1,1]]},{kind:'text',text:''},{kind:'mystery',x:1,y:1,w:1,h:1}])])check(D.build(ir).dxf);
  const two={pages:[{name:'A',width:4,height:3,shapes:[]},{name:'B',width:8,height:6,shapes:[]}]};assert.deepEqual(D.buildAll(two).map(x=>[x.name,check(x.dxf).H.$LIMMAX.map(Number)]),[['A',[101.6,76.2]],['B',[203.2,152.4]]]);
  assert.equal(D.build(two,{page:9}).name,'B','page index clamps')});

test('number and text helpers',()=>{assert.deepEqual([1e-9,12,NaN,-.5,1e20,1/3].map(D.num),['0.0','12.0','0.0','-0.5','1000000000000.0','0.333333']);assert.equal(D.encode('a\u0001é😀\uD83D'),'a\\U+00E9??','no \\U+ form past U+FFFF or for a lone surrogate');assert.ok(D.headOf('triangle')&&!D.headOf('none')&&!D.headOf('nonsense'))});

// regression: an outline that does not close (an arc ending short of its start, a path without z) is still filled, as SVG
// fills it; the outline stays open (the DNS server's dots, cylinder bodies, a zone's folder tab)
test('open outlines with a fill are filled as if closed; the outline stays open',()=>{
  const dot=Array.from({length:26},(_,i)=>{const a=i/25*2*Math.PI*.99;return[(37+3*Math.sin(a))/96,(48+3*Math.cos(a))/96]}),tab=[[0,.2],[0,0],[.4,0],[.5,.2]];
  const ir=page([{kind:'shape',name:'Dot',x:0,y:0,w:1,h:1,layers:[0],geoms:[{closed:false,fill:'#2f5ea8',fillOpacity:1,stroke:null,weight:0,points:dot},{closed:false,fill:'#38bdf8',stroke:'#0369a1',weight:1,points:tab},{closed:false,fill:'#ff0000',stroke:'#000',weight:1,points:[[0,1],[1,1]]}]}]);
  for(const blocks of[true,false]){const{ents,blocks:B}=check(D.build(ir,{blocks}).dxf),e=blocks?[...B.values()].find(b=>b.name==='Dot').ents:ents.filter(o=>get(o,8)!=='Page frame');
    assert.deepEqual(e.map(o=>o.type),['HATCH','HATCH','LWPOLYLINE','LWPOLYLINE'],'both open fills hatched, the outline after its fill; a two-point line is never filled');
    assert.equal(get(e[0],420),String(0x2f5ea8));assert.equal(+get(e[0],93),26,'the dot: all 26 points, closed by the hatch');assert.equal(get(e[1],420),String(0x38bdf8));assert.equal(+get(e[1],93),4);
    assert.equal(+get(e[2],70)&1,0,'the tab outline stays open');assert.equal(xy(e[2]).length,4)}
  // an open body with a closed same-coloured loop inside it: the loop is still a hole when the fill leaves it empty
  const ring=check(D.build(page([{kind:'shape',x:1,y:1,w:1,h:1,layers:[0],geoms:[{closed:false,fill:'#ffffff',points:[[0,0],[1,0],[1,1],[0,1]]},{closed:true,fill:'#ffffff',points:sq(.25,.25,.5,.5,true)}]}]),{blocks:false}).dxf).ents.filter(o=>o.type==='HATCH');
  assert.equal(ring.length,1);assert.equal(get(ring[0],91),'2')});

// regression: a compound fill comes out as the editor's SVG fills it whatever order its subpaths come in (an icon's
// inner outline before its outer one), with islands, holes overlapping holes, self-crossing loops and separate parts.
// Checked point by point: odd parity over each HATCH's own loops (as AutoCAD fills) against SVG nonzero / evenodd
const wind=(p,a)=>{let w=0;for(let i=0,j=a.length-1;i<a.length;j=i++){const[x1,y1]=a[j],[x2,y2]=a[i],c=(x2-x1)*(p[1]-y1)-(p[0]-x1)*(y2-y1);if(y1<=p[1]){if(y2>p[1]&&c>0)w++}else if(y2<=p[1]&&c<0)w--}return w};
const segDist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy,t=L?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)};
const loopsOf=o=>{const t=o.tags,out=[];let i=t.findIndex(x=>x[0]===91)+1;while(i<t.length&&t[i][0]===92){i+=3;const n=+t[i][1];i++;const l=[];for(let k=0;k<n;k++,i+=2)l.push([+t[i][1],+t[i+1][1]]);out.push(l);i++}return out};
const circle=(cx,cy,r,ccw,n=48)=>Array.from({length:n},(_,i)=>{const a=(ccw?-1:1)*i/n*2*Math.PI;return[cx+r*Math.cos(a),cy+r*Math.sin(a)]});
function sameFill(geoms,rule){const H=1,ir=page([{kind:'shape',x:0,y:0,w:1,h:1,layers:[0],fillRule:rule,geoms}]);ir.pages[0].width=ir.pages[0].height=H;
  const hs=check(D.build(ir,{blocks:false}).dxf).ents.filter(o=>o.type==='HATCH').map(loopsOf),parts=new Map();for(const g of geoms)(parts.get(g.part)||parts.set(g.part,[]).get(g.part)).push(g.points);
  let n=0;for(let i=1;i<40;i++)for(let j=1;j<40;j++){const p=[i/40,j/40];if(geoms.some(g=>g.points.some((q,k)=>segDist(p,q,g.points[(k+1)%g.points.length])<.006)))continue;
    const svg=[...parts.values()].some(ls=>{const w=ls.map(l=>wind(p,l));return rule==='evenodd'?w.reduce((s,v)=>s+Math.abs(v)%2,0)%2===1:w.reduce((s,v)=>s+v,0)!==0}),q=[p[0]*25.4,(H-p[1])*25.4];
    const dxf=hs.some(ls=>ls.filter(l=>wind(q,l)!==0).length%2===1);assert.equal(dxf,svg,`(${p}) filled in the DXF ${dxf}, in the editor ${svg}`);n++}
  assert.ok(n>500,'enough sample points');return hs}
test('compound fills match the editor point by point: any subpath order, islands, overlaps, self-crossing loops, parts',()=>{
  const W='#ffffff',g=(points,extra)=>({closed:true,fill:W,points,...extra}),box=(x,y,w,h,ccw)=>sq(x,y,w,h,ccw).slice(0,4);
  // a folder-style ring: inner outline first, then the outer one wound the other way -> one hatch, a hole
  let hs=sameFill([g(box(.3,.3,.4,.4,true)),g(box(.2,.2,.6,.6))]);assert.equal(hs.length,1);assert.equal(hs[0].length,2);
  // an envelope: outer and inner outlines (a ring), the flap's V band overlapping the inner outline's top edge, wound
  // as the inner one (as the editor's icon is); overlapping loops are taken as nested in the loop that holds them
  const inner=box(.15,.25,.7,.5,true),ar=l=>l.reduce((t,q,i)=>t+q[0]*l[(i+1)%l.length][1]-l[(i+1)%l.length][0]*q[1],0),orient=l=>Math.sign(ar(l))===Math.sign(ar(inner))?l:l.slice().reverse();
  hs=sameFill([g(box(.1,.2,.8,.6)),g(inner),g(orient([[.15,.23],[.5,.4],[.85,.23],[.85,.31],[.5,.48],[.15,.31]]))]);assert.equal(hs.length,1);assert.equal(hs[0].length,3);
  // a no-entry sign: a disc outline and two half discs cut out of it, overlapping where the bar is (open subpaths)
  const hd=k=>Array.from({length:25},(_,i)=>{const a=Math.PI/4+k*Math.PI+i/24*Math.PI,o=(k?-.03:.03)*Math.SQRT1_2;return[.5+.3*Math.cos(a)+o,.5+.3*Math.sin(a)-o]});
  sameFill([{closed:false,fill:W,points:circle(.5,.5,.4,true)},{closed:false,fill:W,points:hd(0)},{closed:false,fill:W,points:hd(1)}]);
  // a bullseye, rings wound alternately (holes and islands) and all the same way (nonzero: solid; evenodd: rings)
  for(const rule of['nonzero','evenodd']){sameFill([.1,.2,.3,.4].map((r,i)=>g(circle(.5,.5,r,i%2))).reverse(),rule);hs=sameFill([.4,.3,.2,.1].map(r=>g(circle(.5,.5,r))),rule);assert.equal(hs[0].length,rule==='evenodd'?4:1)}
  // a valve's bow tie (one loop crossing itself, no net area) and a star drawn in one stroke
  hs=sameFill([g([[.1,.3],[.9,.7],[.9,.3],[.1,.7]])]);assert.equal(hs.length,2,'each lobe of the bow tie filled');
  for(const rule of['nonzero','evenodd'])sameFill([g([0,2,4,1,3].map(k=>[.5+.4*Math.sin(k*2*Math.PI/5),.5-.4*Math.cos(k*2*Math.PI/5)]))],rule);
  // separate elements (parts) of one colour paint over each other: a reverse-wound square in a square is no hole
  hs=sameFill([g(box(.1,.1,.8,.8),{part:1}),g(box(.3,.3,.4,.4,true),{part:2})]);assert.equal(hs.length,2)});

// regression: painting order. A later element's fill must still hide an earlier one's outline (a printer's paper tray
// tucked under its body); a ring's fill goes before both its outlines; with parts, an element's fills before its outlines
test('fills keep the editor\'s painting order',()=>{const B=(x,y,w,h,ccw)=>sq(x,y,w,h,ccw).slice(0,4),seq=geoms=>check(D.build(page([{kind:'shape',x:0,y:0,w:1,h:1,layers:[0],geoms}]),{blocks:false}).dxf).ents.filter(o=>get(o,8)!=='Page frame').map(o=>o.type[0]+(o.type==='HATCH'?get(o,91):xy(o)[0].map(v=>Math.round(v)).join(':'))).join(' ');
  const W={fill:'#ffffff',stroke:'#2f5ea8',weight:1.5,closed:true};
  assert.equal(seq([{...W,points:B(.2,.1,.6,.3)},{...W,points:B(.1,.35,.8,.4)}]),'H1 L5:213 H1 L3:207','tray: fill, outline; then the body\'s fill over the tray\'s lower edge, its outline');
  assert.equal(seq([{...W,points:B(.3,.3,.4,.4,true)},{...W,points:B(.2,.2,.6,.6)}]),'H2 L8:208 L5:211','a ring listed inner first: its fill, then both outlines');
  assert.equal(seq([{...W,part:3,points:B(.1,.1,.3,.3)},{...W,part:3,points:B(.5,.5,.3,.3)}]),'H1 H1 L3:213 L13:203','one element (part): all its fills, then its outlines');
  assert.equal(seq([{...W,part:3,points:B(.1,.1,.3,.3)},{...W,part:4,points:B(.5,.5,.3,.3)}]),'H1 L3:213 H1 L13:203','two elements: each fill with its outline')});

test('a long self-crossing outline stays quick',()=>{let r=1;const rnd=()=>(r=r*16807%2147483647)/2147483647,t=Date.now();
  check(D.build(page([{kind:'shape',x:0,y:0,w:1,h:1,layers:[0],geoms:[{closed:true,fill:'#ff0000',points:Array.from({length:3000},()=>[rnd(),rnd()])},{closed:true,fill:'#00ff00',points:Array.from({length:20000},(_,i)=>[.5+.4*Math.cos(i/3000),.5+.4*Math.sin(i/3000)])}]}])).dxf);assert.ok(Date.now()-t<5000,`${Date.now()-t} ms`)});

// regression: names past U+FFFF (emoji) have no \U+ form; they must not come out as '?' (illegal) or collide
test('layer and block names with emoji, lone surrogates or great length stay legal, unique and whole',()=>{
  const sq1=sq(0,0,1,1),ir={pages:[{name:'S',width:11,height:8.5,layers:[{name:'Cameras 📷'},{name:'Cameras 📸'},{name:'\uD83D lone'},{name:'é'.repeat(200)},{name:'É'.repeat(200)}],shapes:[
    {kind:'shape',name:'Cam 📷',x:1,y:1,w:1,h:1,layers:[0],geoms:[{closed:true,fill:'#ff0000',points:sq1}]},{kind:'shape',name:'Cam 📸',x:3,y:1,w:1,h:1,layers:[1],geoms:[{closed:true,fill:'#00aa00',points:sq1}]},
    {kind:'shape',name:'x\uDCF7',x:5,y:1,w:1,h:1,layers:[2],geoms:[{closed:true,fill:'#0000ff',points:sq1}]},{kind:'shape',name:'ü'.repeat(300),x:7,y:1,w:1,h:1,layers:[3],geoms:[{closed:true,fill:'#ffff00',points:sq1}]},{kind:'shape',name:'x',x:9,y:1,w:1,h:1,layers:[4],geoms:[{closed:true,fill:'#00ffff',points:sq1}]}]}]};
  const r=D.build(ir),{T,ents,blocks}=check(r.dxf);
  assert.deepEqual(r.layers.slice(2,5),['Cameras _','Cameras _ 2','_ lone']);assert.equal(r.layers[5],'é'.repeat(34),'cut whole at 240 encoded characters');assert.equal(r.layers[6],'É'.repeat(34)+' 2','unique ignoring case');
  for(const o of[...T.LAYER,...T.BLOCK_RECORD])assert.ok(get(o,2).length<=250&&!get(o,2).includes('\\U+D'),'short, no surrogate escapes');
  const ins=ents.filter(o=>o.type==='INSERT').map(o=>get(o,2));assert.deepEqual(ins.slice(0,3),['Cam _','Cam _ 2','x_']);assert.equal(new Set(ins).size,5,'five drawings, five blocks');
  assert.deepEqual(ins.map(n=>get(blocks.get(n).ents[0],420)),['ff0000','00aa00','0000ff','ffff00','00ffff'].map(h=>String(parseInt(h,16))),'each insert draws its own symbol')});

// regression: %%c %%d %%p are AutoCAD symbol codes (Ø ° ±) and readers decode \U+0025 before looking for them
test('%% in text never becomes a symbol code',()=>{assert.deepEqual(D.mtextTokens('a %%c %%%d %'),['a',' ','%{}','%','c',' ','%{}','%{}','%','d',' ','%']);
  const m=check(D.build(page([{kind:'text',x:1,y:1,w:3,h:.5,text:'size %%c20 temp 40%%d tol %%p1',textSize:9,layers:[1]}])).dxf).ents.find(o=>o.type==='MTEXT'),v=get(m,1);
  assert.equal(v,'size %{}%c20 temp 40%{}%d tol %{}%p1');assert.doesNotMatch(v,/%%/,'no two % side by side');
  const long=check(D.build(page([{kind:'text',x:1,y:1,w:3,h:.5,text:'%'.repeat(400),textSize:9,layers:[1]}])).dxf).ents.find(o=>o.type==='MTEXT');assert.doesNotMatch([...all(long,3),get(long,1)].join(''),/%%/,'not across chunks either')});

// ---- ezdxf: an independent DXF library reads it (strict and recover modes) and its audit finds nothing to fix ----
const names=()=>({pages:[{name:'S',width:6,height:4,layers:[{name:'Cameras 📷'},{name:'Cameras 📸'},{name:'Größe'}],shapes:[{kind:'shape',name:'Cam 📷',x:1,y:1,w:1,h:1,layers:[0],geoms:[{closed:false,fill:'#ff0000',points:[[0,0],[1,0],[1,1],[0,1]]}]},
  {kind:'shape',name:'Cam 📸',x:3,y:1,w:1,h:1,layers:[1],geoms:[{closed:true,fill:'#00aa00',points:sq(0,0,1,1)}]},{kind:'text',x:1,y:3,w:4,h:.5,text:'size %%c20 temp 40%%d tol %%p1 100%%',textSize:9,layers:[2]}]}]});
function python(){for(const py of[process.env.DXF_PYTHON,'python3'].filter(Boolean)){const r=spawnSync(py,['-I','-c','import ezdxf'],{encoding:'utf8'});if(r.status===0)return py}return null}
test('ezdxf reads the file and its audit reports no errors or fixes',t=>{const py=python();if(!py)return t.skip('python3 with ezdxf not available');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dxf-')),files=[['rich.dxf',D.build(rich()).dxf],['flat.dxf',D.build(rich(),{blocks:false}).dxf],['empty.dxf',D.build({}).dxf],['names.dxf',D.build(names()).dxf],['names-flat.dxf',D.build(names(),{blocks:false}).dxf]].map(([n,s])=>{const f=path.join(dir,n);fs.writeFileSync(f,s);return f});
  const code=`import sys, json, ezdxf
from ezdxf import recover
out = []
for f in sys.argv[1:]:
    d = ezdxf.readfile(f); a = d.audit()
    d2, a2 = recover.readfile(f); a3 = d2.audit()
    out.append(dict(errors=len(a.errors) + len(a2.errors) + len(a3.errors), fixes=len(a.fixes) + len(a2.fixes) + len(a3.fixes), msgs=[e.message for e in a.errors + a.fixes + a2.errors + a2.fixes + a3.errors + a3.fixes][:5], ents=len(d2.modelspace()), text=[e.plain_text() for e in d2.modelspace().query('MTEXT')][:1], text2=[e.plain_text(fast=False) for e in d2.modelspace().query('MTEXT')][:1], layers=[l.dxf.name for l in d2.layers], blocks=[b.name for b in d2.blocks], hatches=len(d2.modelspace().query('HATCH')), ver=d2.dxfversion))
print(json.dumps(out))`;
  const r=spawnSync(py,['-I','-c',code,...files],{encoding:'utf8'});fs.rmSync(dir,{recursive:true,force:true});assert.equal(r.status,0,r.stderr);const res=JSON.parse(r.stdout);
  for(const x of res){assert.equal(x.ver,'AC1018');assert.deepEqual([x.errors,x.fixes,x.msgs],[0,0,[]])}
  assert.equal(res[0].text[0],'core-rtr-01\nÄ Ω ^ %% {x}\\','recover mode decodes \\U+ escapes like AutoCAD');assert.ok(res[0].ents>15);
  for(const x of res.slice(3)){assert.deepEqual([x.text[0],x.text2[0]],Array(2).fill('size %%c20 temp 40%%d tol %%p1 100%%'),'%% stays literal');assert.ok(['Cameras _','Cameras _ 2','Größe'].every(n=>x.layers.includes(n)),x.layers)}
  assert.ok(['Cam _','Cam _ 2'].every(n=>res[3].blocks.includes(n)),res[3].blocks);assert.equal(res[4].hatches,2,'the open outline is filled')});
