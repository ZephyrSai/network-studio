// Legacy binary Visio (js/vsdbin.js): compound files, LZSS streams, the record tree and the .vsdx parts made from it.
// Fixtures are built here byte by byte. Set VSS_FILE=/path/to/file.vss (or .vsd) to also check a real file.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const VsdBin=require('../js/vsdbin.js'),Emf=require('../js/emf.js');
const ALL=0xffffffff;
const cat=list=>{const out=new Uint8Array(list.reduce((s,b)=>s+b.length,0));let o=0;for(const b of list){out.set(b,o);o+=b.length}return out};
const u32s=(...v)=>{const b=new Uint8Array(v.length*4),d=new DataView(b.buffer);v.forEach((x,i)=>d.setUint32(i*4,x>>>0,true));return b};
const utf16=s=>{const b=new Uint8Array(s.length*2+2);for(let i=0;i<s.length;i++){b[i*2]=s.charCodeAt(i)&255;b[i*2+1]=s.charCodeAt(i)>>8}return b};

// ---------- compound file writer (512-byte sectors, one FAT sector) ----------
function makeCfb(files){const SS=512,END=0xfffffffe,NONE=0xffffffff,dir=[{name:'Root Entry',type:5,kids:[]}],storages=new Map();
  for(const f of files){const parts=f.path.split('/');let parent=dir[0];if(parts.length>1){let s=storages.get(parts[0]);if(!s){s={name:parts[0],type:1,kids:[]};dir.push(s);dir[0].kids.push(s);storages.set(parts[0],s)}parent=s}
    const e={name:parts[parts.length-1],type:2,data:f.data,kids:[]};dir.push(e);parent.kids.push(e)}
  const sectors=[null],fat=[0xfffffffd],put=bytes=>{const n=Math.max(1,Math.ceil(bytes.length/SS)),start=sectors.length;for(let i=0;i<n;i++){const s=new Uint8Array(SS);s.set(bytes.subarray(i*SS,(i+1)*SS));sectors.push(s);fat.push(i<n-1?start+i+1:END)}return start};
  const mfat=[],minis=[];for(const e of dir)if(e.type===2&&e.data.length<4096){const n=Math.ceil(e.data.length/64);e.start=n?mfat.length:END;for(let i=0;i<n;i++)mfat.push(i<n-1?e.start+i+1:END);const p=new Uint8Array(n*64);p.set(e.data);minis.push(p)}
  const mini=cat(minis);dir[0].start=mini.length?put(mini):END;dir[0].size=mini.length;
  for(const e of dir)if(e.type===2&&e.data.length>=4096)e.start=put(e.data);
  const mfatStart=mfat.length?put(u32s(...mfat)):END;
  const db=new Uint8Array(Math.ceil(dir.length/4)*512),dd=new DataView(db.buffer);for(const e of dir)for(const k of e.kids)k.parentKids=e.kids;// siblings chain through right links
  dir.forEach((e,i)=>{const o=i*128;for(let k=0;k<e.name.length;k++)dd.setUint16(o+k*2,e.name.charCodeAt(k),true);dd.setUint16(o+64,(e.name.length+1)*2,true);db[o+66]=e.type;db[o+67]=1;
    const next=e.parentKids&&e.parentKids[e.parentKids.indexOf(e)+1];dd.setUint32(o+68,NONE,true);dd.setUint32(o+72,next?dir.indexOf(next):NONE,true);dd.setUint32(o+76,e.kids.length?dir.indexOf(e.kids[0]):NONE,true);
    dd.setUint32(o+116,e.type===1?0:e.start??END,true);dd.setUint32(o+120,e.type===5?e.size:e.type===2?e.data.length:0,true)});
  const dirStart=put(db);assert.ok(fat.length<=128,'fixture fits one FAT sector');const fs0=new Uint8Array(SS).fill(255);fs0.set(u32s(...fat));sectors[0]=fs0;
  const h=new Uint8Array(512),hd=new DataView(h.buffer);h.set([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);hd.setUint16(0x18,0x3e,true);hd.setUint16(0x1a,3,true);hd.setUint16(0x1c,0xfffe,true);hd.setUint16(0x1e,9,true);hd.setUint16(0x20,6,true);
  hd.setUint32(0x2c,1,true);hd.setUint32(0x30,dirStart,true);hd.setUint32(0x38,4096,true);hd.setUint32(0x3c,mfatStart,true);hd.setUint32(0x40,mfat.length?1:0,true);hd.setUint32(0x44,END,true);for(let i=0;i<109;i++)hd.setUint32(0x4c+i*4,i?NONE:0,true);
  return cat([h,...sectors])}

// ---------- LZSS writer: literals, plus explicit back-references ----------
// tokens: numbers / strings are literals, [pos, len] copies from the 4 KB ring (writes start at 4078)
function lzssEncode(tokens){const out=[];let flags=0,bit=0,group=[];const flush=()=>{out.push(flags,...group);flags=0;bit=0;group=[]};
  for(const t of tokens.flatMap(t=>typeof t==='string'?[...t].map(c=>c.charCodeAt(0)):t instanceof Uint8Array?[...t]:[t])){if(Array.isArray(t)){const[pos,len]=t;group.push(pos&255,(pos>>4&0xf0)|(len-3))}else{flags|=1<<bit;group.push(t)}if(++bit===8)flush()}
  if(bit)flush();return new Uint8Array(out)}

// ---------- VisioDocument writer ----------
// chunk: [type][id][list][length][level u16][flag u8] data, then `trailer` bytes (sizes follow the format's trailer rules)
function chunk(type,id,level,data=new Uint8Array(0),{list=0,flag=0x50,trailer=0,tail}={}){const h=new Uint8Array(19),d=new DataView(h.buffer);d.setUint32(0,type,true);d.setUint32(4,id>>>0,true);d.setUint32(8,list,true);d.setUint32(12,data.length,true);d.setUint16(16,level,true);h[18]=flag;
  const t=new Uint8Array(trailer);if(tail)t.set(tail);return cat([h,data,t])}
const listData=ids=>cat([u32s(0,ids.length*4),u32s(...ids)]);// [sub-header length 0][children length][child ids]
const doubles=(n,vals,extra={})=>{const b=new Uint8Array(n),d=new DataView(b.buffer);vals.forEach((v,i)=>d.setFloat64(1+9*i,v,true));for(const[o,v]of Object.entries(extra))b[+o]=v;return b};
const shapeBody=({parent=0,master=ALL,masterShape=ALL,fill=ALL,line=ALL,text=ALL}={})=>{const b=new Uint8Array(68),d=new DataView(b.buffer);d.setUint32(10,parent,true);d.setUint32(18,master,true);d.setUint32(26,masterShape,true);d.setUint32(34,fill,true);d.setUint32(42,line,true);d.setUint32(50,text,true);return b};
function docBuilder(){const parts=[];let size=0x36;const add=bytes=>{const off=size;parts.push(bytes);size+=bytes.length;return off};
  // a stream: `body` (+ child pointers when `kids` is given); compressed streams get the 4-byte length and LZSS literals
  const stream=(type,format,body,kids)=>{let b=body;if(kids){const ptrs=kids.map(k=>k?ptr(k):new Uint8Array(18)),at=body.length;b=cat([body,u32s(0,kids.length,0),...ptrs]);new DataView(b.buffer).setUint32(0,at+4,true)}
    if(format&2)b=lzssEncode([(format>>4)>=8?b:cat([u32s(b.length),b])]);return{type,format,offset:add(b),length:b.length}};
  const ptr=p=>{const b=new Uint8Array(18),d=new DataView(b.buffer);d.setUint32(0,p.type,true);d.setUint32(8,p.offset,true);d.setUint32(12,p.length,true);d.setUint16(16,p.format,true);return b};
  const finish=(trailer,ver=11)=>{const h=new Uint8Array(0x36);h.set([...'Visio (TM) Drawing\r\n'].map(c=>c.charCodeAt(0)));h[0x1a]=ver;h.set(ptr(trailer),0x24);return cat([h,...parts])};
  return{stream,finish}}
// A tiny v11 stencil-and-drawing: two styles, one master (a group holding a rectangle-with-arc and an EMF picture),
// one page with an instance of that master, a stand-alone polyline shape and a connector.
function sampleDoc(){const B=docBuilder(),S=B.stream;
  const colors=S(0x16,0x40,cat([new Uint8Array([0,0,3,0]),new Uint8Array([0,0,0,0,255,255,255,0,0x12,0x34,0x56,0])]));
  const styles=S(0x1a,0xd0,cat([chunk(0x1a,ALL,0),
    chunk(0x4a,0,1,shapeBody()),chunk(0x85,1,2,doubles(28,[0.01],{10:0,11:0,12:0,14:1})),chunk(0x86,2,2,new Uint8Array(41).fill(0).map((v,i)=>i>=1&&i<=3?255:i===10?1:0)),
    chunk(0x4a,1,1,(()=>{const b=new Uint8Array(68),d=new DataView(b.buffer);d.setUint32(34,0,true);d.setUint32(42,0,true);d.setUint32(50,0,true);return b})()),chunk(0x85,1,2,doubles(28,[0.02],{10:200,11:0,12:0,14:1}))]));
  const fonts=S(0xd8,0x50,new Uint8Array(4),[null,S(0xd7,0x40,cat([new Uint8Array(4),utf16('Arial')]))]);
  const names=S(0x32,0x50,new Uint8Array(4),[S(0x33,0x40,cat([u32s(1),utf16('Router')])),S(0x33,0x40,cat([u32s(1),utf16('Router (local)')])),S(0x33,0x40,cat([u32s(1),utf16('Page-1')]))]);
  const emf=tinyEmf();
  // master shapes: 5 = group, 6 = rectangle with an arc side (child of 5), 7 = picture (child of 5)
  const group=S(0x47,0xd0,cat([chunk(0x47,ALL,0,shapeBody({line:1,fill:1,text:1})),chunk(0x68,0,1,listData([0]),{list:1,trailer:12}),chunk(0x9b,0,2,doubles(65,[1,0.5,2,1,1,0.5,0])),
    chunk(0x65,1,1,listData([0,1]),{list:2,trailer:12}),chunk(0x83,0,2,u32s(7)),chunk(0x83,1,2,u32s(6))]));
  const rect=S(0x48,0xd2,cat([chunk(0x48,ALL,0,shapeBody({parent:5,line:1,fill:1,text:1})),chunk(0x68,0,1,listData([0,1]),{list:2,trailer:12}),chunk(0x9b,0,2,doubles(65,[1,0.5,2,1,1,0.5,0])),
    chunk(0x86,1,2,new Uint8Array(41).map((v,i)=>i===1?0x11:i===2?0x22:i===3?0x33:i===10?1:0)),
    // geometry rows listed out of order: the list's child order puts them right
    chunk(0x6c,2,1,listData([0,1,2,3,4,5]),{list:6,trailer:12}),chunk(0x89,0,2,new Uint8Array([0])),chunk(0x8b,2,2,doubles(18,[2,0])),chunk(0x8a,1,2,doubles(18,[0,0])),
    chunk(0x8b,3,2,doubles(18,[2,1])),chunk(0x8c,4,2,doubles(27,[0,1,0.25])),chunk(0x8b,5,2,doubles(18,[0,0])),
    chunk(0x0e,3,1,cat([new Uint8Array(8),utf16('Edge ￼')])),chunk(0x2c,4,1,listData([0]),{list:1,trailer:12}),chunk(0x2d,0,2,utf16('R1').subarray(0,4)),
    chunk(0x66,5,1,listData([0]),{list:1,trailer:12}),chunk(0xa1,0,2,(()=>{const b=new Uint8Array(24),d=new DataView(b.buffer);b[7]=232;d.setInt32(8,0,true);return b})()),
    chunk(0x69,6,1,listData([0]),{list:1,trailer:12}),chunk(0x94,0,2,(()=>{const b=new Uint8Array(27),d=new DataView(b.buffer);d.setUint32(0,6,true);d.setUint16(4,1,true);b.set([0,0x80,0,0],7);b[11]=1;d.setFloat64(18,12/72,true);return b})())]));
  const fdType=(()=>{const b=doubles(53,[0,0,2,1]),d=new DataView(b.buffer);d.setUint16(36,4,true);d.setUint32(49,0,true);return b})();
  const pic=S(0x4e,0x52,shapeBody({parent:5}),[S(0x68,0x50,new Uint8Array(4),[S(0x9b,0x40,doubles(65,[1,0.5,2,1,1,0.5,0])),S(0x98,0x40,fdType)]),S(0x0c,0x42,emf)]);
  const sheet=S(0x46,0xd0,cat([chunk(0x46,ALL,0),chunk(0x68,0,1,listData([0]),{list:1,trailer:12}),chunk(0x92,0,2,doubles(54,[8.5,11]),{trailer:4}),chunk(0x65,1,1,listData([0]),{list:1,trailer:12}),chunk(0x83,0,2,u32s(5))]));
  const master=S(0x1e,0x50,new Uint8Array(4),[sheet,null,S(0x0a,0x40,utf16('A router')),null,null,group,rect,pic]);
  const mIdx=S(0xc9,0x40,cat([u32s(1,0,1,2),new Uint8Array(1)]));
  const stencils=S(0x1d,0x50,new Uint8Array(4),[null,null,master,mIdx]);
  // the page: chunk run with its sheet, an instance of master 2, a polyline shape (points in a shape-data record) and a connector
  const poly=(()=>{const b=new Uint8Array(27),d=new DataView(b.buffer);d.setFloat64(1,1,true);d.setFloat64(10,0,true);b[19]=0x8b;d.setUint32(23,9,true);return b})();
  const pdata=(()=>{const b=new Uint8Array(22+32),d=new DataView(b.buffer);b[0]=0x80;b[16]=0;b[17]=0;d.setUint32(18,2,true);[0.5,1,1,0.5].forEach((v,i)=>d.setFloat64(22+i*8,v,true));return b})();
  const page=S(0x15,0xd1,cat([chunk(0x15,ALL,0,u32s(0,0,ALL)),
    chunk(0x46,0,1),chunk(0x68,0,2,listData([0]),{list:1,trailer:12}),chunk(0x92,0,3,doubles(54,[11,8.5]),{trailer:4}),
    // z-order 3, 1, 2 (child order in the list's trailer, as Visio 2003 writes it)
    chunk(0x65,1,2,u32s(0,12),{list:3,trailer:12+12,tail:u32s(2,0,1)}),chunk(0x83,0,3,u32s(1)),chunk(0x83,1,3,u32s(2)),chunk(0x83,2,3,u32s(3)),
    chunk(0x47,1,1,shapeBody({master:2,masterShape:5,line:0,fill:0,text:0})),chunk(0x68,0,2,listData([0]),{list:1,trailer:12}),chunk(0x9b,0,3,doubles(65,[4,4,2,1,1,0.5,0.5])),
    chunk(0x48,2,1,shapeBody({line:1,fill:1,text:1})),chunk(0x68,0,2,listData([0]),{list:1,trailer:12}),chunk(0x9b,0,3,doubles(65,[6,2,1,1,0.5,0.5,0],{63:1})),
    chunk(0x6c,1,2,listData([0,1,2]),{list:3,trailer:12}),chunk(0x89,0,3,new Uint8Array([2])),chunk(0x8a,1,3,doubles(18,[0,0])),chunk(0xc1,2,3,poly),chunk(0xd1,9,2,pdata),
    chunk(0x48,3,1,shapeBody({line:1})),chunk(0x68,0,2,listData([0,1]),{list:2,trailer:12}),chunk(0x9b,0,3,doubles(65,[2,1,2,0,1,0,0])),chunk(0x9d,1,3,doubles(37,[1,1,3,1]))]));
  const pages=S(0x27,0x50,new Uint8Array(4),[page,S(0xc9,0x40,cat([u32s(1,2,2,0),new Uint8Array(1)]))]);
  const trailer=S(0x14,0x50,new Uint8Array(4),[colors,null,null,null,null,styles,null,null,stencils,null,null,null,null,pages,null,null,fonts,null,null,null,null,null,null,names]);
  return B.finish(trailer)}
// a 2-record EMF: header + one blue square + EOF
function tinyEmf(){const rec=(type,body)=>{const b=new Uint8Array(8+body.length),d=new DataView(b.buffer);d.setUint32(0,type,true);d.setUint32(4,b.length,true);b.set(body,8);return b};
  const hdr=new Uint8Array(100),hd=new DataView(hdr.buffer);[0,0,99,49].forEach((v,i)=>hd.setInt32(i*4,v,true));[0,0,1000,500].forEach((v,i)=>hd.setInt32(16+i*4,v,true));hd.setUint32(32,0x464d4520,true);hd.setUint32(36,0x10000,true);
  hd.setInt32(64,1000,true);hd.setInt32(68,1000,true);hd.setInt32(72,100,true);hd.setInt32(76,100,true);
  const brush=rec(39,u32s(1,0,0xff0000,0)),sel=rec(37,u32s(1)),poly=rec(86,cat([u32s(0,0,0,0,4),new Uint8Array(new Int16Array([10,10,40,10,40,40,10,40]).buffer)]));
  return cat([rec(1,hdr),brush,sel,poly,rec(14,u32s(0,16,20))])}
// A stencil whose only master is a connector (a 1-D shape: begin / end points, one straight geometry row).
function connectorStencil(){const B=docBuilder(),S=B.stream;
  const names=S(0x32,0x50,new Uint8Array(4),[S(0x33,0x40,cat([u32s(1),utf16('Dynamic connector')]))]);
  const line=S(0x48,0xd2,cat([chunk(0x48,ALL,0,shapeBody()),chunk(0x68,0,1,listData([0,1]),{list:2,trailer:12}),chunk(0x9b,0,2,doubles(65,[1,0,2,0,1,0,0])),chunk(0x9d,1,2,doubles(37,[0,0,2,0])),
    chunk(0x6c,1,1,listData([0,1]),{list:2,trailer:12}),chunk(0x89,0,2,new Uint8Array([0])),chunk(0x8a,1,2,doubles(18,[0,0])),chunk(0x8b,2,2,doubles(18,[2,0]))]));
  const master=S(0x1e,0x50,new Uint8Array(4),[null,line]),mIdx=S(0xc9,0x40,cat([u32s(1,0,0,1),new Uint8Array(1)]));
  return B.finish(S(0x14,0x50,new Uint8Array(4),[S(0x1d,0x50,new Uint8Array(4),[null,master,mIdx]),names]))}
// A Visio 2000 (version 6) page: ANSI text whose fields are marked with 0x1e, a length in cm and a date in ISO format.
function v6FieldsDoc(){const B=docBuilder(),S=B.stream,ansi=t=>new Uint8Array([...t].map(c=>c.charCodeAt(0)));
  // a numeric field record: [7 bytes][cell type][double]…; from 0x24 formula blocks [length][?][block index][?][format u16][0x80 0xc2]
  const field=(type,value,format)=>{const b=new Uint8Array(0x24+11),d=new DataView(b.buffer);b[7]=type;d.setFloat64(8,value,true);d.setUint32(0x24,11,true);b[0x24+5]=2;d.setUint16(0x24+7,format,true);b[0x24+9]=0x80;b[0x24+10]=0xc2;return b};
  const page=S(0x15,0xd1,cat([chunk(0x15,ALL,0,u32s(0,0,ALL)),chunk(0x46,0,1),chunk(0x68,0,2,listData([0]),{list:1,trailer:8}),chunk(0x92,0,3,doubles(54,[11,8.5])),
    chunk(0x48,1,1,shapeBody()),chunk(0x68,0,2,listData([0]),{list:1,trailer:8}),chunk(0x9b,0,3,doubles(65,[2,2,2,1,1,0.5,0])),
    chunk(0x0e,3,2,cat([new Uint8Array(8),ansi('Width \x1e on \x1e\0')])),chunk(0x66,4,2,listData([0,1]),{list:2,trailer:8}),chunk(0xa1,0,3,field(69,1/2.54,5)),chunk(0xa1,1,3,field(40,43652.139,204))]));
  return B.finish(S(0x14,0x50,new Uint8Array(4),[S(0x27,0x50,new Uint8Array(4),[page])]),6)}

// ---------- a small XML reader for checking the generated parts ----------
function parseXml(s){const root={name:'#',attrs:{},kids:[],text:''},st=[root],re=/<\?[^>]*\?>|<(\/?)([\w:]+)((?:\s+[\w:]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy;let m,at=0;
  while(at<s.length){re.lastIndex=at;m=re.exec(s);assert.ok(m,'well-formed XML near '+s.slice(at,at+60));at=re.lastIndex;if(m[0].startsWith('<?'))continue;if(m[5]!=null){st[st.length-1].text+=m[5];continue}
    if(m[1]){assert.equal(st.pop().name,m[2],'balanced tags');continue}const el={name:m[2],attrs:Object.fromEntries([...m[3].matchAll(/([\w:]+)="([^"]*)"/g)].map(a=>[a[1],a[2]])),kids:[],text:''};st[st.length-1].kids.push(el);if(!m[4])st.push(el)}
  assert.equal(st.length,1,'all tags closed');return root.kids[0]}
const all=(el,name,out=[])=>{for(const k of el.kids){if(k.name===name)out.push(k);all(k,name,out)}return out};
const kids=(el,name)=>el.kids.filter(k=>k.name===name);
const cells=el=>Object.fromEntries(kids(el,'Cell').map(c=>[c.attrs.N,c.attrs.V]));
const parts=u8=>{const r=VsdBin.toParts(u8),m=new Map(r.parts.map(p=>[p.path,p.bytes]));return{...r,bytes:p=>m.get(p),xml:p=>parseXml(new TextDecoder().decode(m.get(p)))}};

test('compound file: streams in the mini stream, in regular sectors and inside storages',()=>{
  const big=new Uint8Array(9000).map((_,i)=>i*7&255),small=new Uint8Array(300).map((_,i)=>i&255);
  const f=makeCfb([{path:'VisioDocument',data:big},{path:'\u0005SummaryInformation',data:small},{path:'Store/Inner',data:new Uint8Array([1,2,3])}]);
  assert.ok(VsdBin.isCfb(f));const c=VsdBin.cfb(f);
  assert.deepEqual(c.paths.sort(),['Store/Inner','VisioDocument','\u0005SummaryInformation'].sort());
  assert.deepEqual(c.get('VisioDocument'),big,'regular sectors');assert.deepEqual(c.get('\u0005SummaryInformation'),small,'mini stream');assert.deepEqual([...c.get('Store/Inner')],[1,2,3]);assert.equal(c.get('Nope'),null);
  assert.throws(()=>VsdBin.cfb(new Uint8Array(600)),/compound/);
});

test('compound file: a FAT chain that loops back on itself stops instead of hanging',()=>{
  const f=makeCfb([{path:'VisioDocument',data:new Uint8Array(5000).fill(9)}]),d=new DataView(f.buffer),fatAt=512;
  // the stream fills sectors 1…10: point the last one back at the first
  assert.equal(d.getUint32(fatAt+10*4,true),0xfffffffe);d.setUint32(fatAt+10*4,1,true);
  const got=VsdBin.cfb(f).get('VisioDocument');assert.equal(got.length,5000);assert.ok(got.every(b=>b===9));
});

test('LZSS: literals, ring references and overlapping copies (writes start at ring offset 4078)',()=>{
  const out=VsdBin.lzss(lzssEncode(['abc',[4078,3],'x',[4078+6,5]]));
  assert.equal(new TextDecoder().decode(out),'abcabcxxxxxx');
  assert.equal(new TextDecoder().decode(VsdBin.lzss(lzssEncode(['A',[4078,18]]))),'A'.repeat(19),'run copied from itself');
  assert.equal(VsdBin.lzss(new Uint8Array([0])).length,0,'a lone flag byte');assert.equal(new TextDecoder().decode(VsdBin.lzss(new Uint8Array([1,65,0]))),'A','truncated reference is dropped');
});

test('record tree: blobs with child pointers, compressed records and chunk runs nested by level',()=>{
  const t=VsdBin.recordTree(sampleDoc());assert.equal(t.ver,11);assert.equal(t.root.type,0x14);
  const st=t.root.kids.find(k=>k.type===0x1d),m=st.kids.find(k=>k.type===0x1e);assert.equal(m.id,2,'pointer index is the master id');
  assert.deepEqual(m.kids.map(k=>k.type),[0x46,0x0a,0x47,0x48,0x4e]);
  const rect=m.kids.find(k=>k.type===0x48);assert.equal(rect.data.length,68,'shape record body from the compressed chunk run');
  assert.deepEqual(rect.kids.map(k=>k.type),[0x68,0x6c,0x0e,0x2c,0x66,0x69]);assert.deepEqual(rect.kids[1].kids.map(k=>k.id),[0,2,1,3,4,5],'rows as stored');
  const pic=m.kids.find(k=>k.type===0x4e);assert.equal(pic.kids[1].type,0x0c);assert.ok(Emf.isEmf(pic.kids[1].data),'compressed EMF body after the 4-byte length');
  assert.throws(()=>VsdBin.recordTree(new Uint8Array(100)),/not a Visio file/);
  const v5=sampleDoc();v5[0x1a]=5;assert.throws(()=>VsdBin.recordTree(v5),/Visio 5/);
});

test('model: styles, masters with names, nested shapes, geometry in list order, text fields, pages and z-order',()=>{
  const m=VsdBin.model(VsdBin.recordTree(sampleDoc()));
  assert.deepEqual(m.colors.slice(0,3),['#000000','#ffffff','#123456']);
  assert.equal(m.styles.length,2);assert.equal(m.styles[1].lineStyle,0);assert.equal(m.styles[1].cells.LineColor,'#c80000');assert.equal(m.styles[0].cells.FillForegnd,'#ffffff');
  const ms=m.masters[0];assert.equal(ms.id,2);assert.equal(ms.nameU,'Router');assert.equal(ms.name,'Router (local)');assert.equal(ms.prompt,'A router');
  assert.equal(ms.shapes.length,1);const g=ms.shapes[0];assert.equal(g.type,'Group');assert.deepEqual(g.kids.map(k=>k.id),[7,6],'children in the group list order');
  const r=g.kids[1];assert.deepEqual(r.sections[0].rows.map(x=>x.T),['MoveTo','LineTo','LineTo','ArcTo','LineTo']);assert.equal(r.sections[0].rows[3].cells.A,.25);
  assert.equal(r.cells.FillForegnd,'#112233');assert.equal(r.text,'Edge ￼');assert.equal(r.names.get(0),'R1');
  const ch=r.sections.find(s=>s.N==='Character').rows[0].cells;assert.equal(ch.Font,'Arial');assert.equal(ch.Color,'#008000');assert.equal(ch.Style,1);assert.ok(Math.abs(ch.Size-1/6)<1e-9);
  assert.equal(g.kids[0].foreign.type,4);assert.equal(g.kids[0].cells.ImgWidth,2);
  const p=m.pages[0];assert.equal(p.nameU,'Page-1');assert.equal(p.sheet.cells.PageWidth,11);assert.deepEqual(p.shapes.map(s=>s.id),[3,1,2],'z-order from the trailer of the page list');
  const conn=p.shapes[0];assert.deepEqual([conn.cells.BeginX,conn.cells.EndX],[1,3]);assert.equal(p.shapes[2].cells.FlipX,1);
});

test('parts: a .vsdx-shaped package that js/visio.js reads (masters, pictures, pages, styles)',()=>{
  const P=parts(sampleDoc());assert.equal(P.info.version,11);assert.equal(P.info.masters,1);assert.equal(P.info.pages,1);
  const rootRels=P.xml('_rels/.rels');assert.match(kids(rootRels,'Relationship')[0].attrs.Type,/\/document$/);
  const doc=P.xml('visio/document.xml'),sheets=all(doc,'StyleSheet');assert.equal(sheets.length,2);assert.equal(sheets[1].attrs.LineStyle,'0');assert.equal(cells(sheets[1]).LineWeight,'0.02');
  const docRels=kids(P.xml('visio/_rels/document.xml.rels'),'Relationship').map(r=>r.attrs.Type);assert.ok(docRels.some(t=>/\/masters$/.test(t))&&docRels.some(t=>/\/pages$/.test(t)));
  const master=all(P.xml('visio/masters/masters.xml'),'Master')[0];assert.deepEqual([master.attrs.ID,master.attrs.NameU,master.attrs.Prompt],['2','Router','A router']);
  const mc=P.xml('visio/masters/master1.xml'),top=kids(kids(mc,'Shapes')[0],'Shape');assert.equal(top.length,1);assert.equal(top[0].attrs.Type,'Group');assert.equal(top[0].attrs.LineStyle,'1');
  const subs=kids(kids(top[0],'Shapes')[0],'Shape');assert.deepEqual(subs.map(s=>s.attrs.ID),['7','6']);
  const rect=subs[1],geo=kids(rect,'Section')[0];assert.equal(geo.attrs.N,'Geometry');assert.deepEqual(kids(geo,'Row').map(r=>r.attrs.T+r.attrs.IX),['MoveTo1','LineTo2','LineTo3','ArcTo4','LineTo5']);
  assert.equal(cells(rect).FillForegnd,'#112233');const txt=kids(rect,'Text')[0];assert.equal(txt.text,'Edge ');assert.equal(kids(txt,'fld')[0].text,'R1','string field from the shape\'s name list');
  const fd=kids(subs[0],'ForeignData')[0];assert.equal(fd.attrs.ForeignType,'EnhMetaFile');const rid=kids(fd,'Rel')[0].attrs['r:id'];
  const rel=kids(P.xml('visio/masters/_rels/master1.xml.rels'),'Relationship').find(r=>r.attrs.Id===rid);assert.equal(rel.attrs.Target,'../media/image1.emf');assert.ok(Emf.isEmf(P.bytes('visio/media/image1.emf')));
  const pg=all(P.xml('visio/pages/pages.xml'),'Page')[0];assert.equal(cells(kids(pg,'PageSheet')[0]).PageHeight,'8.5');
  const shapes=kids(kids(P.xml('visio/pages/page1.xml'),'Shapes')[0],'Shape');assert.deepEqual(shapes.map(s=>s.attrs.ID),['3','1','2']);
  assert.equal(shapes[1].attrs.Master,'2','instance keeps its master');assert.equal(shapes[1].attrs.MasterShape,'5');
  const polyRow=kids(kids(shapes[2],'Section')[0],'Row')[1];assert.equal(polyRow.attrs.T,'PolylineTo');assert.equal(kids(polyRow,'Cell').find(c=>c.attrs.N==='A').attrs.F,'POLYLINE(0,0,0.5,1,1,0.5)');
  assert.equal(cells(shapes[0]).EndX,'3');
});

test('parts: hostile input fails cleanly (truncated streams, pointer cycles, garbage chunks)',()=>{
  const d=sampleDoc();for(const n of[0x40,200,d.length>>1,d.length-7]){const cut=d.slice(0,n);try{VsdBin.toParts(cut)}catch(e){assert.ok(e instanceof Error)}}
  // a stream whose child pointer points at itself
  // the first stream sits at offset 0x36: [list at 8][pad][list size 0, 1 pointer, 0][pointer to offset 0x36 itself]
  const B=docBuilder(),body=cat([u32s(12,0),u32s(0,1,0),new Uint8Array(18)]),bd=new DataView(body.buffer);bd.setUint32(20,0x1d,true);bd.setUint32(28,0x36,true);bd.setUint32(32,body.length,true);bd.setUint16(36,0x50,true);
  const s=B.stream(0x1d,0x50,body),doc=B.finish(B.stream(0x14,0x50,new Uint8Array(4),[s]));assert.equal(s.offset,0x36);assert.throws(()=>VsdBin.toParts(doc),/no pages or masters/,'the cycle ends');
  const junk=sampleDoc();for(let i=0x60;i<junk.length;i+=97)junk[i]^=0x5a;try{VsdBin.toParts(junk)}catch(e){assert.ok(e instanceof Error)}
});

test('pointer amplification: thousands of pointers to one compressed stream fail fast, and the stream is decoded once',()=>{
  const B=docBuilder(),leaf=B.stream(0x0c,0x42,new Uint8Array(100000).map((_,i)=>i*13&255));
  const amp=B.finish(B.stream(0x14,0x50,new Uint8Array(4),Array(3000).fill(leaf)));// 3000 x 100 KB = 300 MB as a tree, from a 160 KB file
  const t0=Date.now();assert.throws(()=>VsdBin.toParts(amp),/too complex/);assert.ok(Date.now()-t0<1500,'fails fast ('+(Date.now()-t0)+' ms)');
  const B2=docBuilder(),leaf2=B2.stream(0x0c,0x42,new Uint8Array(1000).fill(7)),t=VsdBin.recordTree(B2.finish(B2.stream(0x14,0x50,new Uint8Array(4),Array(5).fill(leaf2))));
  assert.equal(t.root.kids.length,5);assert.ok(t.root.kids.every(k=>k.data.length===1000&&k.data.buffer===t.root.kids[0].data.buffer),'one decoded copy shared by every pointer');
  assert.throws(()=>VsdBin.lzss(lzssEncode(['A',[4078,18],[4078,18],[4078,18]]),20),/too complex/,'decompression stops at its output cap');
});

test('truncated files say so: compound file cut anywhere, trailer pointer past the end, or no pages and masters',()=>{
  const f=makeCfb([{path:'VisioDocument',data:sampleDoc()}]);assert.ok(f.length>8*512);
  for(const n of[512,1024,f.length>>1,f.length-512,f.length-1])assert.throws(()=>VsdBin.toParts(f.slice(0,n)),/incomplete \(truncated\)/,'cut to '+n);
  const d=sampleDoc();assert.throws(()=>VsdBin.toParts(d.slice(0,0x36)),/incomplete/,'header only');assert.throws(()=>VsdBin.toParts(d.slice(0,d.length-4)),/incomplete/,'trailer cut');
  const noKids=d.slice();new DataView(noKids.buffer).setUint16(0x24+16,0x40,true);assert.throws(()=>VsdBin.toParts(noKids),/no pages or masters/);
  // a directory size larger than the sector chain is tolerated (the chain is what is read), without a huge allocation
  const big=f.slice(),bd=new DataView(big.buffer);for(let o=512;o+128<=big.length;o+=128)if(bd.getUint16(o+64,true)===28&&String.fromCharCode(...[...big.subarray(o,o+26)].filter((_,i)=>i%2===0))==='VisioDocument')bd.setUint32(o+120,0xfffffff0,true);
  assert.equal(VsdBin.toParts(big).info.masters,1);
});

test('text fields: Visio 2000 field marks, units, dates and feet-and-inches',()=>{
  const P=parts(v6FieldsDoc());assert.equal(P.info.version,6);const txt=all(P.xml('visio/pages/page1.xml'),'Text')[0];
  assert.equal(txt.text,'Width  on ');assert.deepEqual(kids(txt,'fld').map(f=>f.text),['1.0 cm','2019-07-06'],'0x1e marks the fields in ANSI text');
  assert.equal(VsdBin.numberText(-Math.PI/6,80,12),'-30 deg');assert.equal(VsdBin.numberText(-Math.PI/6,80,11),'-0.5236 rad');assert.equal(VsdBin.numberText(1,33,1),'100%');assert.equal(VsdBin.numberText(1,32,6),'1.00');
  assert.equal(VsdBin.numberText(246,64,10),'20\'-6"');assert.equal(VsdBin.numberText(1/1440,46,1),'1 em.');assert.equal(VsdBin.numberText(0.39370078740157477,69,null),'1','unknown format: the number in its unit');
  const day=43652.13895833334;assert.equal(VsdBin.dateText(day,204),'2019-07-06');assert.equal(VsdBin.dateText(day,25),'July 6, 2019');assert.equal(VsdBin.dateText(day,27),'06/07/19');assert.equal(VsdBin.dateText(day,35),'3:20 AM');
  assert.equal(VsdBin.dateText(day,200),new Intl.DateTimeFormat(undefined,{timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'}).format(Date.UTC(2019,6,6)),'system short date in the viewer\'s locale');
});

// ---------- js/visio.js on legacy files (a minimal DOMParser stands in for the browser's) ----------
function miniDom(src){const ent=t=>t.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&amp;/g,'&'),root={nodeType:9,childNodes:[],children:[]},st=[root],re=/<\?[^>]*\?>|<(\/?)([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*(\/?)>|([^<]+)/g;let m;
  while((m=re.exec(src))){const top=st[st.length-1];if(m[5]!=null){top.childNodes.push({nodeType:3,nodeValue:ent(m[5])});continue}if(!m[2])continue;if(m[1]){st.pop();continue}
    const at=Object.fromEntries([...m[3].matchAll(/([\w:]+)="([^"]*)"/g)].map(a=>[a[1],ent(a[2])])),el={nodeType:1,localName:m[2].replace(/^\w+:/,''),childNodes:[],children:[],getAttribute:n=>at[n]??null,getAttributeNS:(ns,n)=>at['r:'+n]??null};
    top.childNodes.push(el);top.children.push(el);if(!m[4])st.push(el)}
  const each=(n,out=[])=>{for(const c of n.children){out.push(c);each(c,out)}return out};
  const deco=n=>{n.getElementsByTagName=t=>each(n).filter(e=>e.localName===t);Object.defineProperty(n,'textContent',{get:()=>n.childNodes.map(c=>c.nodeType===3?c.nodeValue:c.textContent).join('')});n.children.forEach(deco)};
  deco(root);root.documentElement=root.children[0];root.querySelector=()=>null;return root}
function withVisio(){globalThis.Core??=require('../js/core.js');globalThis.VsdBin=VsdBin;globalThis.Emf=Emf;globalThis.DOMParser=class{parseFromString(t){return miniDom(t)}};
  globalThis.Packs={isSafeMarkup:()=>true,stencilFrom:(name,vb,svg,o)=>({name,vb,svg,...o}),unzip:()=>{throw Error('Not a ZIP file.')}};return require('../js/visio.js')}

test('visio.js: a .vss stencil imports through Visio.stencilToPack; bad input gets a message that names the problem',async()=>{
  const Visio=withVisio(),file=(bytes,name)=>new File([bytes],name);
  const r=await Visio.stencilToPack(file(makeCfb([{path:'VisioDocument',data:sampleDoc()}]),'net.vss'));assert.equal(r.count,1);
  const sh=Object.values(r.pack.shapes)[0];assert.equal(sh.name,'Router');assert.match(sh.svg,/<svg\b/,'EMF picture drawn by js/emf.js');assert.match(sh.svg,/<path d="M0 0L2 0L2 1A/,'rectangle with an arc side');
  await assert.rejects(Visio.stencilToPack(file(makeCfb([{path:'VisioDocument',data:connectorStencil()}]),'lines.vss')),/only has connectors and lines/);
  await assert.rejects(Visio.load(file(new Uint8Array(0),'empty.vsd')),/file is empty/);
  await assert.rejects(Visio.load(file(new TextEncoder().encode('just some text, not a stencil'),'text.vss')),/not a Visio file/);
  const cfbFile=makeCfb([{path:'VisioDocument',data:sampleDoc()}]);await assert.rejects(Visio.stencilToPack(file(cfbFile.slice(0,cfbFile.length-512),'cut.vss')),/incomplete \(truncated\)/);
  assert.ok(Visio.isStencil('a.vss')&&Visio.isDrawing('a.vsd')&&Visio.isDrawing('a.vst')&&!Visio.isLegacy('a.vss'));
});

test('real file from VSS_FILE (skipped when unset)',{skip:!process.env.VSS_FILE},()=>{
  const u8=new Uint8Array(fs.readFileSync(process.env.VSS_FILE));assert.ok(VsdBin.isCfb(u8));const P=parts(u8);
  assert.ok(P.info.masters>0||P.info.pages>0,'has masters or pages');
  const masters=P.info.masters?all(P.xml('visio/masters/masters.xml'),'Master'):[];let pics=0,drawn=0;
  masters.forEach((m,i)=>{const mc=P.xml(`visio/masters/master${i+1}.xml`);assert.ok(all(mc,'Shape').length>0,m.attrs.NameU+' has shapes');assert.ok(m.attrs.NameU,'named')});
  // pictures go to js/emf.js: each metafile part must at least come back as an <svg> with a real viewBox
  for(const p of P.parts.filter(p=>/\.(emf|wmf)$/.test(p.path))){pics++;const r=Emf.toSvg(p.bytes),vb=r.viewBox;if(/^<svg\b/.test(r.svg)&&vb[2]>0&&vb[3]>0)drawn++}
  assert.equal(drawn,pics,'every metafile picture converts');
});
