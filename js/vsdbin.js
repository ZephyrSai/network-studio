// Legacy binary Visio import (.vsd drawings, .vss stencils, .vst templates; Visio 2000 = file version 6 and
// Visio 2002/2003 = version 11). OLE compound file → VisioDocument stream → pointer/chunk record tree → styles, masters,
// pages and shapes → the parts of a .vsdx package (VSDX-schema XML plus media), so js/visio.js reads both formats the
// same way. Cells carry the values Visio cached when it saved, so no formula has to be evaluated.
// Format knowledge comes from LibreOffice libvisio's reverse-engineering (MPL-2.0); this is an independent implementation.
const VsdBin=(()=>{
const ALL=0xffffffff,TRUNC='This Visio file is incomplete (truncated) or damaged.',TOO_BIG='This Visio file is too complex to read, or it is damaged.';
const view=b=>new DataView(b.buffer,b.byteOffset,b.byteLength);

// ---------- OLE compound file (MS-CFB) ----------
const CFB_MAGIC=[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1];
const isCfb=u8=>!!u8&&u8.length>=512&&CFB_MAGIC.every((b,i)=>u8[i]===b);
// The streams of a compound file by path ('VisioDocument', 'Storage/Stream'…). Sector chains are bounds- and loop-checked.
function cfb(u8){if(!isCfb(u8))throw Error('Not an OLE compound file.');const dv=view(u8),u32=o=>o>=0&&o+4<=u8.length?dv.getUint32(o,true):ALL,END=0xfffffffa;
  const ss=1<<dv.getUint16(0x1e,true),mss=1<<dv.getUint16(0x20,true),cutoff=u32(0x38),at=s=>(s+1)*ss;if(ss!==512&&ss!==4096||mss>ss)throw Error('Unsupported compound file layout.');
  const words=b=>{const d=view(b),out=new Uint32Array(b.length>>2);for(let i=0;i<out.length;i++)out[i]=d.getUint32(i*4,true);return out};
  // FAT sectors: 109 in the header, the rest down the DIFAT chain (followed only while the header's count asks for more)
  const nFat=u32(0x2c),fatSecs=[];for(let i=0;i<109;i++){const s=u32(0x4c+i*4);if(s<END)fatSecs.push(s)}
  for(let d=u32(0x44),g=0;d<END&&fatSecs.length<nFat&&g<=u8.length/ss;g++){if(at(d)>=u8.length)throw Error(TRUNC);for(let i=0;i<ss/4-1;i++){const s=u32(at(d)+i*4);if(s<END)fatSecs.push(s)}d=u32(at(d)+ss-4)}
  if(fatSecs.slice(0,nFat||fatSecs.length).some(s=>at(s)>=u8.length))throw Error(TRUNC);
  const fat=new Uint32Array(fatSecs.length*ss/4);fatSecs.forEach((s,i)=>{for(let j=0;j<ss/4;j++)fat[i*ss/4+j]=u32(at(s)+j*4)});
  const chain=(s,next)=>{const out=[],seen=new Set();while(s<END&&s<next.length&&!seen.has(s)){seen.add(s);out.push(s);s=next[s]}return out};
  // a stream's bytes from its sector chain; a sector that lies past the end of the file means the file was cut short
  const gather=(secs,size,src,unit,off)=>{size=Math.min(size,secs.length*unit);const out=new Uint8Array(size);let p=0;for(const s of secs){if(p>=size)break;const o=off(s),n=Math.min(unit,size-p);if(o+n>src.length)throw Error(TRUNC);out.set(src.subarray(o,o+n),p);p+=n}return out};
  const big=(s,size)=>gather(chain(s,fat),size,u8,ss,at),dirSecs=chain(u32(0x30),fat),dir=gather(dirSecs,dirSecs.length*ss,u8,ss,at),dd=view(dir),ents=[];
  for(let o=0;o+128<=dir.length;o+=128){const nl=Math.min(64,dd.getUint16(o+64,true));let name='';for(let i=0;i<nl-2;i+=2)name+=String.fromCharCode(dd.getUint16(o+i,true));
    ents.push({name,type:dir[o+66],l:dd.getUint32(o+68,true),r:dd.getUint32(o+72,true),c:dd.getUint32(o+76,true),start:dd.getUint32(o+116,true),size:dd.getUint32(o+120,true)})}
  const root=ents[0];if(!root||root.type!==5)throw Error('This Visio file is damaged (its compound-file directory is unreadable).');
  const mini=big(root.start,root.size),mfatSecs=chain(u32(0x3c),fat),mfat=words(gather(mfatSecs,mfatSecs.length*ss,u8,ss,at));
  const read=e=>e.size<cutoff?gather(chain(e.start,mfat),e.size,mini,mss,s=>s*mss):big(e.start,e.size);
  // the directory is a red-black tree of siblings per storage: walk it with an explicit stack (no recursion limit)
  const paths=new Map(),seen=new Set(),stack=[[root.c,'']];while(stack.length){const[i,pre]=stack.pop();if(i>=ents.length||seen.has(i))continue;seen.add(i);const e=ents[i];stack.push([e.l,pre],[e.r,pre]);if(e.type===2)paths.set(pre+e.name,e);else if(e.type===1)stack.push([e.c,pre+e.name+'/'])}
  return{paths:[...paths.keys()],get:p=>{const e=paths.get(p);return e?read(e):null}}}

// ---------- stream compression ----------
// LZSS over a 4 KB ring that starts writing at 4078; flag bits LSB first: 1 = literal, 0 = 12-bit ring position + 4-bit length-3.
// `max` caps the output (a stream can expand ~9x).
function lzss(src,max=Infinity){let out=new Uint8Array(Math.max(256,Math.min(src.length*3,max))),n=0,r=4078,i=0;const ring=new Uint8Array(4096);
  const put=c=>{if(n>=max)throw Error(TOO_BIG);if(n===out.length){const g=new Uint8Array(Math.min(out.length*2,max));g.set(out);out=g}out[n++]=c;ring[r]=c;r=r+1&4095};
  while(i<src.length){const flags=src[i++];for(let b=0;b<8&&i<src.length;b++){if(flags>>b&1){put(src[i++]);continue}if(i+1>=src.length){i=src.length;break}const lo=src[i++],hi=src[i++],pos=lo|(hi&0xf0)<<4,len=(hi&15)+3;for(let k=0;k<len;k++)put(ring[pos+k&4095])}}
  return out.subarray(0,n)}

// ---------- record tree ----------
// Every stream is reached through an 18-byte pointer (type, offset, length, format). Format bit 2 = compressed (then a
// record's body starts after a 4-byte length; chunk runs start at once); high nibble 5 = one record that also lists child pointers, 4/0 = one record,
// 8/c/d = a run of chunks whose header level nests them. Both layouts become the same tree: {type, id, data, kids}.
const TR8_11=new Set([0x71,0x70,0x6b,0x6a,0x69,0x66,0x65,0x2c]),TR4_11=new Set([0x64,0x65,0x66,0x69,0x6a,0x6b,0x6f,0x71,0x92,0xa9,0xb4,0xb6,0xb9,0xc7]),
  TR8_6=new Set([0x76,0x73,0x72,0x71,0x70,0x6f,0x6e,0x6d,0x6c,0x6b,0x6a,0x69,0x68,0x67,0x66,0x65,0x64,0x2c,0x0d]),NO_TR=new Set([0x1f,0xc9,0x2d,0xd1]);
// Bytes that follow a chunk's data: they depend on the chunk type, its list count and header flags (empirical rules).
function trailer(ver,type,list,level,flag){if(ver<11)return type===0x1f||type===0xc9?0:list||TR8_6.has(type)?8:0;
  let t=list||TR8_11.has(type)?8:0;if(list||level===2&&flag===0x55||level===2&&flag===0x54&&type===0xaa||level===3&&flag!==0x50&&flag!==0x54)t+=4;if(TR4_11.has(type)&&t!==12&&t!==4)t+=4;return NO_TR.has(type)?0:t}
function chunks(b,ver){const d=view(b),out=[];let i=0;
  const head=j=>{while(j<b.length&&!b[j])j++;if(j+19>b.length)return null;const type=d.getUint32(j,true),len=d.getUint32(j+12,true),level=d.getUint16(j+16,true);
    return type>0&&type<0x100&&len<=b.length-j-19&&level<64?{at:j,type,id:d.getUint32(j+4,true),list:d.getUint32(j+8,true),len,level,flag:b[j+18]}:null};
  for(let h=head(0);h;){const start=h.at+19,end=start+h.len,c={type:h.type,id:h.id,level:h.level,data:b.subarray(start,end)};out.push(c);
    // trust the trailer rule when it lands on a plausible header; otherwise take the first trailer size that does
    const t=trailer(ver,h.type,h.list,h.level,h.flag);let next=end+t>=b.length?null:head(end+t);if(!next)for(const alt of[0,4,8,12]){if(alt===t||end+alt>=b.length)continue;next=head(end+alt);if(next)break}
    c.full=b.subarray(start,next?next.at:Math.min(b.length,end+t));h=next}// a list's child order can run on into its trailer
  return out}
function pointerAt(d,o){return{type:d.getUint32(o,true),offset:d.getUint32(o+8,true),length:d.getUint32(o+12,true),format:d.getUint16(o+16,true)}}
function childPointers(b){const d=view(b);if(b.length<4)return[];const at=d.getUint32(0,true)-4;if(at<0||at+12>b.length)return[];const listSize=d.getUint32(at,true),count=d.getInt32(at+4,true),out=[];let q=at+12;
  for(let i=0;i<count&&q+18<=b.length;i++,q+=18){const p=pointerAt(d,q);if(p.type)out.push([i,p])}
  const order=[];if(listSize>1)for(let i=0;i<listSize&&q+4<=b.length;i++,q+=4)order.push(d.getUint32(q,true));if(!order.length)return out;
  const by=new Map(out),seq=[];for(const i of order)if(by.has(i)){seq.push([i,by.get(i)]);by.delete(i)}return seq.concat([...by])}
function nest(list,root){const stack=[{level:-1,kids:root.kids}];for(const c of list){const n={type:c.type,id:c.id,data:c.data,full:c.full,kids:[]};while(stack.length>1&&stack[stack.length-1].level>=c.level)stack.pop();stack[stack.length-1].kids.push(n);stack.push({level:c.level,kids:n.kids})}return root}
function recordTree(doc){if(doc.length<0x36||String.fromCharCode(...doc.subarray(0,18))!=='Visio (TM) Drawing')throw Error('This is not a Visio file, or its document is damaged.');const ver=doc[0x1a];
  if(ver!==6&&ver!==11)throw Error(ver<6?'Visio 5 and older files cannot be read: open the file in Visio and save it as .vsdx / .vssx.':'Unsupported Visio file version '+ver+'.');
  const top=pointerAt(view(doc),0x24);if(top.offset<0x36||!top.length||top.offset+top.length>doc.length)throw Error(TRUNC);
  // A stream is decoded (and a chunk run parsed) once, however many pointers lead to it; the tree as expanded is still
  // capped in nodes and bytes, so a few KB of repeated pointers cannot blow up into gigabytes.
  const visited=new Set(),cache=new Map(),cap=Math.max(64<<20,doc.length*48);let budget=Math.max(400000,doc.length/2|0),bytes=0;
  const node=(p,id,depth)=>{if(--budget<0)throw Error(TOO_BIG);const kind=p.format>>4,run=kind===8||kind===0xc||kind===0xd,key=p.offset+':'+p.length+':'+p.format;let c=cache.get(key);
    if(!c){const raw=p.offset<doc.length?doc.subarray(p.offset,Math.min(doc.length,p.offset+p.length)):new Uint8Array(0),b=p.format&2?lzss(raw,cap-bytes):raw,body=b.subarray(p.format&2&&kind!==8&&kind<0xc?4:0);
      c={len:b.length,data:body,kids:[],size:0};if(run){const list=chunks(body,ver);if(list.length&&list[0].level===0&&list[0].type===p.type){c.data=list[0].data;list.shift()}nest(list,c);c.size=list.length}cache.set(key,c)}
    if((bytes+=c.len)>cap||(budget-=c.size)<0)throw Error(TOO_BIG);
    const n={type:p.type,id,data:c.data,kids:run?c.kids:[],fmt:p.format};if(depth>32||kind!==5||p.type===0x16)return n;
    if(!visited.has(p.offset)){visited.add(p.offset);for(const[i,q]of childPointers(c.data))n.kids.push(node(q,i,depth+1))}return n};
  const root=node(top,0,0);return{ver,root,size:{bytes,nodes:Math.max(400000,doc.length/2|0)-budget}}}

// ---------- values ----------
const f64=(d,o)=>{if(o<0||o+8>d.byteLength)return 0;const v=d.getFloat64(o,true);return isFinite(v)&&Math.abs(v)<1e12?v:0};
const u32at=(d,o)=>o>=0&&o+4<=d.byteLength?d.getUint32(o,true):ALL,u16at=(d,o)=>o>=0&&o+2<=d.byteLength?d.getUint16(o,true):0;
const hex2=x=>(x||0).toString(16).padStart(2,'0'),rgb=(b,o)=>'#'+hex2(b[o])+hex2(b[o+1])+hex2(b[o+2]);
const decoders={};const decode=(b,enc)=>{try{return(decoders[enc]??=new TextDecoder(enc)).decode(b)}catch{let s='';for(const c of b)s+=String.fromCharCode(c);return s}};
const utf16z=b=>{let e=0;while(e+1<b.length&&(b[e]|b[e+1]))e+=2;return decode(b.subarray(0,e),'utf-16le')},ansiz=b=>{let e=0;while(e<b.length&&b[e])e++;return decode(b.subarray(0,e),'windows-1252')};
const SHAPE_T={0x47:'Group',0x48:'Shape',0x4d:'Guide',0x4e:'Foreign'};
// A list chunk names its children's order: [sub-header length][children length][sub-header][child ids…].
function ordered(n){const b=n.full||n.data;if(n.fmt!==undefined||b.length<8)return n.kids;const d=view(b),a=d.getUint32(0,true),c=d.getUint32(4,true);if(c%4||8+a+c>b.length)return n.kids;
  const pos=new Map();for(let i=0;i<c/4;i++)pos.set(d.getUint32(8+a+i*4,true),i);return n.kids.map((k,i)=>[k,pos.get(k.id)??1e6+i]).sort((x,y)=>x[1]-y[1]).map(x=>x[0])}

// ---------- model ----------
// Doubles sit after a one-byte unit tag, so a record's cells are at fixed offsets 1, 10, 19, 28…
const at9=i=>1+9*i;
function model(tree){const{ver,root}=tree,str=b=>ver<11?ansiz(b):utf16z(b),find=(n,t)=>n?.kids.find(k=>k.type===t);
  const colors=[];const ct=find(root,0x16);if(ct)for(let i=0,b=ct.data,n=b[2]||0;i<n&&8+i*4<=b.length;i++)colors.push(rgb(b,4+i*4));
  const names=new Map();for(const k of find(root,0x32)?.kids||[])if(k.type===0x33)names.set(k.id,str(k.data.subarray(4)));
  const fonts=new Map();for(const k of find(root,0xd8)?.kids||[])if(k.type===0xd7)fonts.set(k.id,utf16z(k.data.subarray(4,68)));for(const k of find(root,0x18)?.kids||[])if(k.type===0x19)fonts.set(k.id,ansiz(k.data.subarray(6)));
  // element id → {u: universal name, n: local name}, from a name-index record among a node's children
  const nameIdx=n=>{const m=new Map();for(const k of n?.kids||[]){const b=k.data,d=view(b);
      if(k.type===0xc9){const cnt=Math.min(u32at(d,0),(b.length-4)/13|0);for(let i=0;i<cnt;i++){const o=4+i*13,a=names.get(d.getUint32(o,true)),c=names.get(d.getUint32(o+4,true));if(a!=null||c!=null)m.set(d.getUint32(o+8,true),{u:a??c,n:c??a})}}
      else if(k.type===0x34)for(let o=0;o+8<=b.length;o+=8){const a=names.get(d.getUint32(o,true));if(a!=null)m.set(d.getUint32(o+4,true),{u:a,n:a})}}return m};
  const pal=(i,fallback)=>i>0&&i<colors.length?colors[i]:fallback,zero=(b,o)=>!(b[o]|b[o+1]|b[o+2]|b[o+3]);
  const rowsOf=(L,fn)=>ordered(L).map(r=>fn(r,view(r.data),r.data)).filter(Boolean);
  // geometry rows; POLYLINE / NURBS points come from a shape-data record or the cell's stored formula
  const geomRow=(r,d,b,s)=>{const X=f64(d,1),Y=f64(d,10),c={X,Y},row=(T,more={},F)=>({T,IX:r.id,cells:{...c,...more},F});
    switch(r.type){case 0x8a:return row('MoveTo');case 0x8b:return row('LineTo');case 0x8c:return row('ArcTo',{A:f64(d,19)});
      case 0x8d:return row('InfiniteLine',{A:f64(d,19),B:f64(d,28)});case 0x8f:return row('Ellipse',{A:f64(d,19),B:f64(d,28),C:f64(d,37),D:f64(d,46)});
      case 0x90:return row('EllipticalArcTo',{A:f64(d,19),B:f64(d,28),C:f64(d,37),D:f64(d,46)});
      case 0xa5:return row('SplineStart',{A:f64(d,18),B:f64(d,26),C:f64(d,34),D:b[42]||0});case 0xa6:return row('SplineKnot',{A:f64(d,18)});
      case 0xc1:{const p=b[19]===0x8b?{data:u32at(d,23)}:polyFormula(b,d);return row('PolylineTo',{},p&&{A:p})}
      case 0xc3:{const p=b[51]===0x8a?{data:u32at(d,55)}:nurbsFormula(b,d);return row('NURBSTo',{A:f64(d,18),B:f64(d,26),C:f64(d,34),D:f64(d,42)},p&&{E:p})}}return null};
  const charRow=(r,d,b)=>r.type===0x94&&{IX:r.id,cells:{Font:fonts.get(u16at(d,4))||u16at(d,4),Color:zero(b,7)?pal(b[6],'#000000'):rgb(b,7),Style:(b[11]||0)&15,Case:(b[12]||0)&3,Pos:(b[13]||0)&3,FontScale:u16at(d,14)/10000||1,Size:f64(d,18)}};
  const paraRow=(r,d,b)=>r.type===0x95&&{IX:r.id,cells:{IndFirst:f64(d,5),IndLeft:f64(d,14),IndRight:f64(d,23),SpLine:f64(d,32),SpBefore:f64(d,41),SpAfter:f64(d,50),HorzAlign:b[58]||0,Bullet:b[59]||0}};
  // the cells and sections of a shape, style or page sheet, from the records under it (not from nested shapes)
  const collect=(kids,s)=>{for(const k of kids){const b=k.data,d=view(b),c=s.cells,v=i=>f64(d,at9(i));
    switch(k.type){
      case 0x9b:Object.assign(c,{PinX:v(0),PinY:v(1),Width:v(2),Height:v(3),LocPinX:v(4),LocPinY:v(5),Angle:v(6),FlipX:b[63]?1:0,FlipY:b[64]?1:0});break;
      case 0x9d:Object.assign(c,{BeginX:v(0),BeginY:v(1),EndX:v(2),EndY:v(3)});break;
      case 0x9c:Object.assign(c,{TxtPinX:v(0),TxtPinY:v(1),TxtWidth:v(2),TxtHeight:v(3),TxtLocPinX:v(4),TxtLocPinY:v(5),TxtAngle:v(6)});break;
      case 0x85:Object.assign(c,{LineWeight:v(0),LineColor:zero(b,10)?pal(b[9],'#000000'):rgb(b,10),LineColorTrans:(b[13]||0)/255,LinePattern:b[14]||0,Rounding:f64(d,16),BeginArrow:b[25]||0,EndArrow:b[26]||0,LineCap:b[27]||0});break;
      case 0x86:{const idx=zero(b,1)&&zero(b,6);Object.assign(c,{FillForegnd:idx?pal(b[0],'#ffffff'):rgb(b,1),FillForegndTrans:idx?0:(b[4]||0)/255,FillBkgnd:idx?pal(b[5],'#ffffff'):rgb(b,6),FillBkgndTrans:idx?0:(b[9]||0)/255,FillPattern:b[10]||0,
        ShdwForegnd:zero(b,12)&&zero(b,17)?pal(b[11],'#000000'):rgb(b,12),ShdwPattern:b[21]||0});if(ver>=11&&b.length>=41)Object.assign(c,{ShapeShdwOffsetX:f64(d,24),ShapeShdwOffsetY:f64(d,33)});break}
      case 0x87:Object.assign(c,{LeftMargin:v(0),RightMargin:v(1),TopMargin:v(2),BottomMargin:v(3),VerticalAlign:b[36]||0,TextBkgnd:b[37]||0,DefaultTabStop:f64(d,43)});break;
      case 0x92:Object.assign(c,{PageWidth:v(0),PageHeight:v(1),ShdwOffsetX:v(2),ShdwOffsetY:v(3),PageScale:v(4),DrawingScale:f64(d,46)||1});break;
      case 0x98:Object.assign(c,{ImgOffsetX:v(0),ImgOffsetY:v(1),ImgWidth:v(2),ImgHeight:v(3)});s.foreign??={};Object.assign(s.foreign,{type:u16at(d,38)===8?4:u16at(d,36),format:u32at(d,49)});break;
      case 0x0c:(s.foreign??={}).bytes=b;break;
      case 0xa4:c.HideText=(b[0]&0x20)?1:0;break;
      case 0xa7:{const n=b[13]||0;c.LayerMember=ver<11?ansiz(b.subarray(14,14+n)):decode(b.subarray(14,14+2*n),'utf-16le');break}
      case 0x0e:s.text=str(b.subarray(8));if(ver<11)s.text=s.text.replace(/\u001e/g,'￼');break;// Visio 2000 marks fields with 0x1e
      case 0x2c:for(const x of k.kids)if(x.type===0x2d)(s.names??=new Map()).set(x.id,ver<11?ansiz(x.data):decode(x.data,'utf-16le').replace(/\0+$/,''));break;
      case 0x66:s.fields=rowsOf(k,(r,d,b)=>r.type===0xa1&&(b[7]===232?{name:d.getInt32(8,true)}:{value:f64(d,8),cellType:b[7],format:fieldFormat(r.full||b,ver)}));break;
      case 0xd1:(s.data??=new Map()).set(k.id,shapeData(b,d));break;
      case 0x65:s.order=rowsOf(k,(r,d)=>r.type===0x83&&u32at(d,0));break;
      case 0x6c:{const sec={N:'Geometry',IX:s.sections.filter(x=>x.N==='Geometry').length,cells:{},rows:[]};for(const r of ordered(k)){if(r.type===0x89){const f=r.data[0]||0;Object.assign(sec.cells,{NoFill:f&1?1:0,NoLine:f&2?1:0,NoShow:f&4?1:0})}else{const row=geomRow(r,view(r.data),r.data,s);if(row)sec.rows.push(row)}}s.sections.push(sec);break}
      case 0x69:s.sections.push({N:'Character',rows:rowsOf(k,charRow)});break;
      case 0x6a:s.sections.push({N:'Paragraph',rows:rowsOf(k,paraRow)});break;
      case 0x6f:s.layers=rowsOf(k,(r,d,b)=>r.type===0xa8&&{id:r.id,visible:b[14]!==0,print:b[15]!==0});s.layerNames=nameIdx(k);break;
      default:if(!SHAPE_T[k.type]&&k.kids.length&&k.type!==0x46)collect(k.kids,s)}}};
  const shapeOf=n=>{const d=view(n.data),s={id:n.id,type:SHAPE_T[n.type],parent:u32at(d,10),master:u32at(d,18),masterShape:u32at(d,26),fillStyle:u32at(d,34),lineStyle:u32at(d,42),textStyle:u32at(d,50),cells:{},sections:[],kids:[]};collect(n.kids,s);return s};
  // a page or master: its sheet, then its shapes nested by their parent ids (cycles and strays stay top-level)
  const sheetAndShapes=pn=>{const sheet={cells:{},sections:[]},ps=find(pn,0x46);if(ps)collect(ps.kids,sheet);const all=new Map();for(const k of pn.kids)if(SHAPE_T[k.type]&&!all.has(k.id))all.set(k.id,shapeOf(k));
    const top=[];for(const s of all.values()){let p=all.get(s.parent),ok=!!p;for(let x=p,g=0;x&&ok;x=all.get(x.parent),g++)if(x===s||g>64)ok=false;if(ok)p.kids.push(s);else top.push(s)}
    const sortBy=(arr,order)=>{if(!order?.length)return;const pos=new Map(order.map((id,i)=>[id,i]));arr.sort((a,b)=>(pos.get(a.id)??1e6+a.id)-(pos.get(b.id)??1e6+b.id))};for(const s of all.values())sortBy(s.kids,s.order);sortBy(top,sheet.order);
    return{sheet,shapes:top,count:all.size}};
  const sNode=find(root,0x1a),sNames=nameIdx(sNode),styles=[];for(const k of sNode?.kids||[])if(k.type===0x4a){const d=view(k.data),s={id:k.id,name:sNames.get(k.id),lineStyle:u32at(d,34),fillStyle:u32at(d,42),textStyle:u32at(d,50),cells:{},sections:[]};collect(k.kids,s);styles.push(s)}
  const mNode=find(root,0x1d),mNames=nameIdx(mNode),masters=[];for(const k of mNode?.kids||[])if(k.type===0x1e){const nm=mNames.get(k.id),pr=find(k,0x0a);masters.push({id:k.id,nameU:nm?.u||'Master.'+k.id,name:nm?.n||nm?.u||'Master.'+k.id,prompt:pr?str(pr.data):'',...sheetAndShapes(k)})}
  const pNode=find(root,0x27),pNames=nameIdx(pNode),pages=[];for(const k of pNode?.kids||[])if(k.type===0x15){const nm=pNames.get(k.id),bp=u32at(view(k.data),8);pages.push({id:k.id,nameU:nm?.u||'Page-'+(pages.length+1),name:nm?.n||nm?.u||'Page-'+(pages.length+1),background:!(k.fmt&1),backPage:bp===ALL||bp===0&&k.id!==0?null:bp,...sheetAndShapes(k)})}
  return{ver,colors,styles,masters,pages}}
// POLYLINE / NURBS shape-data records: [kind][15 bytes][…points]
function shapeData(b,d){if(b[0]===0x80){const n=Math.min(u32at(d,18),(b.length-22)/16|0),pts=[];for(let i=0;i<n;i++)pts.push(f64(d,22+i*16),f64(d,30+i*16));return{kind:'poly',xType:b[16],yType:b[17],pts}}
  if(b[0]===0x82){const n=Math.min(u32at(d,28),(b.length-32)/32|0),pts=[];for(let i=0;i<n;i++)for(let j=0;j<4;j++)pts.push(f64(d,32+i*32+j*8));return{kind:'nurbs',last:f64(d,16),degree:u16at(d,24),xType:b[26],yType:b[27],pts}}return null}
// Stored formulas follow a record's fixed part as blocks [length u32][?][cell index]…; the POLYLINE / NURBS calls keep
// their arguments as typed tokens (0x20 = double, otherwise a 16-bit integer) ending with 0x81.
function formulaBlock(b,d,start,cell){let o=start;for(let g=0;g<64&&o+6<=b.length;g++){const len=d.getUint32(o,true);if(!len||len<6)return null;if(b[o+5]===cell)return o+6;o+=len}return null}
function tokens(b,d,o,max){const out=[];for(let g=0;g<4096&&o<b.length;g++){const t=b[o++];if(t===0x81)break;if(t===0x20){out.push(f64(d,o));o+=8}else{out.push(u16at(d,o));o+=2}if(out.length>max)break}return out}
function polyFormula(b,d){const o=formulaBlock(b,d,0x30,2);if(o==null)return null;const a=tokens(b,d,o,20000);return a.length>=2?{fn:'POLYLINE',args:a}:null}
function nurbsFormula(b,d){const o=formulaBlock(b,d,0x50,6);if(o==null)return null;if(b[o]===0x8a){const n=Math.min(u32at(d,o+13),(b.length-o-17)/32|0),a=[f64(d,o+1),u16at(d,o+9),b[o+11],b[o+12]];for(let i=0;i<n*4;i++)a.push(f64(d,o+17+i*8));return{fn:'NURBS',args:a}}
  const a=tokens(b,d,o,20000);return a.length>=4?{fn:'NURBS',args:a}:null}

// A numeric field's display format: formula block 2 of the field record holds [u16 format][0x80 0xc2].
function fieldFormat(b,ver){const d=view(b),o=formulaBlock(b,d,ver<11?0x24:0x36,2);return o!=null&&b[o+3]===0x80&&b[o+4]===0xc2?u16at(d,o+1):null}
// Visio's date / time field formats (by format number) as patterns; the system short date (200) and the other date
// formats use the viewer's own short date.
const DATE_FMT={20:'ddd',21:'dddd',22:'M/d/yy',23:'MM/d/yy',24:'MMM d, yyyy',25:'MMMM d, yyyy',26:'d/M/yy',27:'dd/MM/yy',28:'d MMM, yyyy',29:'d MMMM, yyyy',30:'h:mm:ss tt',31:'h:mm',32:'hh:mm',33:'H:mm',34:'HH:mm',35:'h:mm tt',36:'HH:mm tt',
  201:'dddd, MMMM dd, yyyy',202:'MMMM d, yyyy',203:'M/d/yy',204:'yyyy-MM-dd',205:'d-MMM-yy',206:'M.d.yyyy',207:'MMM.d, yy',208:'d MMMM yyyy',209:'MMMM yy',210:'MMM-yy',211:'M/d/yyyy h:mm tt',212:'M/d/yyyy h:mm:ss tt',213:'h:mm tt',214:'h:mm:ss tt',215:'HH:mm',216:'HH:mm:ss'};
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'],DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// A Visio date (days since 30 Dec 1899, local time) in one of those patterns.
function dateText(days,format){const t=new Date(Date.UTC(1899,11,30)+Math.round(days*864e5));if(!isFinite(t))return'';const p2=n=>String(n).padStart(2,'0'),h=t.getUTCHours(),M=t.getUTCMonth(),D=t.getUTCDate(),Y=t.getUTCFullYear();
  const tok={yyyy:Y,yy:p2(Y%100),MMMM:MONTHS[M],MMM:MONTHS[M].slice(0,3),MM:p2(M+1),M:M+1,dddd:DAYS[t.getUTCDay()],ddd:DAYS[t.getUTCDay()].slice(0,3),dd:p2(D),d:D,HH:p2(h),H:h,hh:p2(h%12||12),h:h%12||12,mm:p2(t.getUTCMinutes()),ss:p2(t.getUTCSeconds()),tt:h<12?'AM':'PM'};
  if(!DATE_FMT[format]){try{return new Intl.DateTimeFormat(undefined,{timeZone:'UTC',year:'numeric',month:'numeric',day:'numeric'}).format(t)}catch{return`${M+1}/${D}/${Y}`}}
  return DATE_FMT[format].replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|ss|tt/g,k=>tok[k])}
// Numeric fields: [factor from Visio's internal unit (inches, days, radians), suffix] by the field's cell type.
const UNITS={33:[100,'%'],43:[1/7,' ew.'],44:[1,' ed.'],45:[24,' eh.'],46:[1440,' em.'],47:[86400,' es.'],49:[6,' p'],50:[72,' pt'],51:[6,' p'],52:[5.644444444444,' c'],53:[67.75,' d'],54:[5.644444444444,' c'],
  63:[1,' in'],64:[1,' in'],65:[1,' in'],66:[1/12,' ft'],67:[1/12,' ft'],68:[1/63360,' mi'],69:[2.54,' cm'],70:[25.4,' mm'],71:[.0254,' m'],72:[2.54e-5,' km'],75:[1/36,' yd'],76:[1/72913.386,' nm.'],80:[180/Math.PI,' deg'],81:[180/Math.PI,' deg'],82:[180/Math.PI,' deg'],83:[1,' rad']};
// A numeric field as Visio shows it: in its cell's unit, with the format's decimals (0-9: 0.####, 0, 0.0, 0.00, 0.000, each
// without / with units; 10, 13, 14 feet and inches; 11 radians, 12 degrees); an unknown format keeps up to 4 decimals and no unit.
function numberText(v,type,format){if((format===10||format===13||format===14)&&(type===63||type===64||type>=65&&type<=76)){const a=Math.abs(v),ft=Math.trunc(a/12);return`${v<0?'-':''}${ft}'-${fv(+(a-ft*12).toFixed(format===10?3:format-12))}"`}
  if(type===80&&format===11)type=83;const[k,u]=UNITS[type]||[1,''],x=v*k,dp=[4,4,0,0,1,1,2,2,3,3,3,4,1][format];if(dp==null)return fv(+x.toFixed(4));
  return(format<2||format>=11?fv(+x.toFixed(dp)):x.toFixed(dp))+(format%2||format>=10?u:'')}

// ---------- VSDX parts ----------
const NS='xmlns="http://schemas.microsoft.com/office/visio/2012/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xml:space="preserve"';
const REL='http://schemas.microsoft.com/visio/2010/relationships/',IMG_REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const esc=s=>String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fv=v=>typeof v==='number'?String(+v.toPrecision(12)):String(v);
const cellsXml=c=>Object.entries(c).map(([n,v])=>`<Cell N="${n}" V="${esc(fv(v))}"/>`).join('');
const relsXml=list=>`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id,type,target])=>`<Relationship Id="${id}" Type="${type}" Target="${esc(target)}"/>`).join('')}</Relationships>`;
// A geometry row's points from its formula or shape-data record, as the POLYLINE(…) / NURBS(…) text .vsdx stores.
function rowFormula(f,s){if(!f)return null;if(f.data!=null){const sd=s.data?.get(f.data);if(!sd)return null;return sd.kind==='poly'?`POLYLINE(${sd.xType},${sd.yType},${sd.pts.map(fv).join(',')})`:`NURBS(${[sd.last,sd.degree,sd.xType,sd.yType,...sd.pts].map(fv).join(',')})`}return`${f.fn}(${f.args.map(fv).join(',')})`}
function sectionsXml(s){let x='';for(const sec of s.sections){if(sec.N==='Geometry'){x+=`<Section N="Geometry" IX="${sec.IX}">${cellsXml(sec.cells)}${sec.rows.map(r=>`<Row T="${r.T}" IX="${r.IX}">${Object.entries(r.cells).map(([n,v])=>{const f=r.F?.[n]&&rowFormula(r.F[n],s);return`<Cell N="${n}" V="${esc(fv(v))}"${f?` F="${esc(f)}"`:''}/>`}).join('')}${r.F?.A&&!r.cells.A?(f=>f?`<Cell N="A" V="0" F="${esc(f)}"/>`:'')(rowFormula(r.F.A,s)):''}${r.F?.E&&!r.cells.E?(f=>f?`<Cell N="E" V="0" F="${esc(f)}"/>`:'')(rowFormula(r.F.E,s)):''}</Row>`).join('')}</Section>`;continue}
    if(sec.rows?.length)x+=`<Section N="${sec.N}">${sec.rows.map(r=>`<Row IX="${r.IX}">${cellsXml(r.cells)}</Row>`).join('')}</Section>`}return x}
// The text with its field placeholders (U+FFFC) replaced by the field values Visio stored.
function textXml(s){if(s.text==null)return'';let i=0;const fld=()=>{const f=s.fields?.[i];const ix=i++;if(!f)return'';const v=f.name!=null?s.names?.get(f.name)??'':f.cellType===40?dateText(f.value,f.format):numberText(f.value,f.cellType,f.format);return`<fld IX="${ix}">${esc(v)}</fld>`};
  return`<Text>${s.text.replace(/\0+$/,'').split('￼').map(esc).reduce((a,t,j)=>j?a+fld()+t:t,'')}</Text>`}
const FOREIGN={1:'Bitmap',2:'Object'},FOREIGN_FMT={0:'bmp',1:'jpg',2:'gif',3:'tiff',4:'png',255:'bmp'};
// Picture bytes as a media file: metafiles by signature, bitmaps by their stored format (headerless DIBs get a BMP header).
function media(f){const b=f?.bytes;if(!b?.length)return null;if(f.type===1){const ext=FOREIGN_FMT[f.format]||'bin';if(ext!=='bmp')return{ext,bytes:b};
    const d=view(b),hs=u32at(d,0),bits=u16at(d,14),used=u32at(d,32),pal=hs===12?0:(used&&used<=256?used:bits<=8?1<<bits:0)*4+(u32at(d,16)===3&&hs===40?12:0),off=14+hs+pal,out=new Uint8Array(14+b.length),od=view(out);
    out[0]=0x42;out[1]=0x4d;od.setUint32(2,out.length,true);od.setUint32(10,off,true);out.set(b,14);return{ext:'bmp',bytes:out}}
  if(f.type===0||f.type===4){if(b.length>44&&b[40]===0x20&&b[41]===0x45&&b[42]===0x4d&&b[43]===0x46)return{ext:'emf',bytes:b};return{ext:'wmf',bytes:b}}return null}
// One page or master: its <Shapes> XML, with pictures added to `files` and to the part's relationships.
function shapesXml(list,ctx,depth=0){return list.map(s=>{if(ctx.seen.has(s)||depth>40)return'';ctx.seen.add(s);const a=[`ID="${s.id}"`,`Type="${s.type}"`];
    if(ctx.page&&s.master!==ALL&&ctx.masters.has(s.master)&&s.master!==ctx.parentMaster)a.push(`Master="${s.master}"`);if(s.masterShape!==ALL&&s.masterShape!==0)a.push(`MasterShape="${s.masterShape}"`);
    for(const[k,v]of[['LineStyle',s.lineStyle],['FillStyle',s.fillStyle],['TextStyle',s.textStyle]])if(v!==ALL&&ctx.styles.has(v))a.push(`${k}="${v}"`);
    let x=cellsXml(s.cells)+sectionsXml(s);const m=media(s.foreign);if(m){const n=++ctx.media.n,path=`visio/media/image${n}.${m.ext}`;ctx.files.push({path,bytes:m.bytes});ctx.rels.push([`rId${ctx.rels.length+1}`,IMG_REL,`../media/image${n}.${m.ext}`]);
      x+=`<ForeignData ForeignType="${FOREIGN[s.foreign.type]||'EnhMetaFile'}"><Rel r:id="rId${ctx.rels.length}"/></ForeignData>`}
    if(s.kids.length){const pm=ctx.parentMaster;ctx.parentMaster=s.master!==ALL?s.master:pm;x+=`<Shapes>${shapesXml(s.kids,ctx,depth+1)}</Shapes>`;ctx.parentMaster=pm}
    return`<Shape ${a.join(' ')}>${x}${textXml(s)}</Shape>`}).join('')}
// The whole file as .vsdx package parts: [{path, bytes}], in the shape js/visio.js reads from an unzipped package.
function toParts(u8){const doc=isCfb(u8)?cfb(u8).get('VisioDocument'):u8;if(!doc)throw Error('This is not a Visio file (it has no Visio document inside).');
  const m=model(recordTree(doc));if(!m.masters.length&&!m.pages.length)throw Error('This Visio file is damaged: it has no pages or masters.');const enc=new TextEncoder(),files=[],put=(path,text)=>files.push({path,bytes:enc.encode(text)}),xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const styles=new Set(m.styles.map(s=>s.id)),masters=new Set(m.masters.map(x=>x.id)),mediaCount={n:0};
  const part=(root,list,path,page)=>{const ctx={files,rels:[],media:mediaCount,styles,masters,page,seen:new Set(),parentMaster:ALL},body=shapesXml(list,ctx);put(path,`${xml}<${root} ${NS}><Shapes>${body}</Shapes></${root}>`);if(ctx.rels.length)put(path.replace(/([^/]+)$/,'_rels/$1.rels'),relsXml(ctx.rels))};
  const st=s=>`<StyleSheet ID="${s.id}"${s.name?` NameU="${esc(s.name.u)}" Name="${esc(s.name.n)}"`:''}${[['LineStyle',s.lineStyle],['FillStyle',s.fillStyle],['TextStyle',s.textStyle]].map(([k,v])=>v!==ALL&&v!==s.id&&styles.has(v)?` ${k}="${v}"`:'').join('')}>${cellsXml(s.cells)}${sectionsXml(s)}</StyleSheet>`;
  put('visio/document.xml',`${xml}<VisioDocument ${NS}><DocumentSettings/><Colors>${m.colors.map((c,i)=>`<ColorEntry IX="${i}" RGB="${c.toUpperCase()}"/>`).join('')}</Colors><StyleSheets>${m.styles.map(st).join('')}</StyleSheets></VisioDocument>`);
  const docRels=[];if(m.masters.length){docRels.push(['rId1',REL+'masters','masters/masters.xml']);
    put('visio/masters/masters.xml',`${xml}<Masters ${NS}>${m.masters.map((x,i)=>`<Master ID="${x.id}" NameU="${esc(x.nameU)}" Name="${esc(x.name)}"${x.prompt?` Prompt="${esc(x.prompt)}"`:''}><PageSheet>${cellsXml(x.sheet.cells)}</PageSheet><Rel r:id="rId${i+1}"/></Master>`).join('')}</Masters>`);
    put('visio/masters/_rels/masters.xml.rels',relsXml(m.masters.map((x,i)=>[`rId${i+1}`,REL+'master',`master${i+1}.xml`])));m.masters.forEach((x,i)=>part('MasterContents',x.shapes,`visio/masters/master${i+1}.xml`,false))}
  if(m.pages.length){docRels.push([`rId${docRels.length+1}`,REL+'pages','pages/pages.xml']);
    const layers=p=>p.sheet.layers?.length?`<Section N="Layer">${p.sheet.layers.map((l,i)=>`<Row IX="${i}"><Cell N="Name" V="${esc(p.sheet.layerNames?.get(l.id)?.n||'Layer '+(i+1))}"/><Cell N="Visible" V="${l.visible?1:0}"/><Cell N="Print" V="${l.print?1:0}"/></Row>`).join('')}</Section>`:'';
    put('visio/pages/pages.xml',`${xml}<Pages ${NS}>${m.pages.map((p,i)=>`<Page ID="${p.id}" NameU="${esc(p.nameU)}" Name="${esc(p.name)}"${p.background?' Background="1"':''}${p.backPage!=null&&m.pages.some(q=>q.id===p.backPage&&q!==p)?` BackPage="${p.backPage}"`:''}><PageSheet>${cellsXml(p.sheet.cells)}${layers(p)}</PageSheet><Rel r:id="rId${i+1}"/></Page>`).join('')}</Pages>`);
    put('visio/pages/_rels/pages.xml.rels',relsXml(m.pages.map((p,i)=>[`rId${i+1}`,REL+'page',`page${i+1}.xml`])));m.pages.forEach((p,i)=>part('PageContents',p.shapes,`visio/pages/page${i+1}.xml`,true))}
  put('visio/_rels/document.xml.rels',relsXml(docRels));put('_rels/.rels',relsXml([['rId1',REL+'document','visio/document.xml']]));
  return{parts:files,info:{version:m.ver,masters:m.masters.length,pages:m.pages.length,shapes:m.masters.reduce((s,x)=>s+x.count,0)+m.pages.reduce((s,x)=>s+x.count,0)}}}
return{isCfb,cfb,lzss,recordTree,model,toParts,dateText,numberText};
})();
if(typeof module!=='undefined')module.exports=VsdBin;
