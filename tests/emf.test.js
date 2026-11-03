// EMF / WMF → SVG: small metafiles built here record by record (header + a few records), checked for geometry, transforms,
// clipping, text and bitmaps. EMF_DIR=<folder> also converts every .emf/.wmf in that folder (skipped when unset).
const test=require('node:test'),assert=require('node:assert'),fs=require('node:fs'),path=require('node:path');
const Emf=require('../js/emf.js');

// ---- writers ----
const dw=(...v)=>Buffer.concat(v.map(x=>{const b=Buffer.alloc(4);x<0?b.writeInt32LE(x):b.writeUInt32LE(x>>>0);return b}));
const f32=(...v)=>Buffer.concat(v.map(x=>{const b=Buffer.alloc(4);b.writeFloatLE(x);return b}));
const w16=(...v)=>Buffer.concat(v.map(x=>{const b=Buffer.alloc(2);x<0?b.writeInt16LE(x):b.writeUInt16LE(x);return b}));
const pad4=b=>Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
const rec=(t,body=Buffer.alloc(0))=>{body=pad4(body);return Buffer.concat([dw(t,8+body.length),body])};
const rgb=(r,g,b)=>r|g<<8|b<<16;
// a picture 10 mm × 5 mm on a 10 px/mm reference device: device space (the viewBox) is 0 0 100 50
function emf(recs,{frame=[0,0,1000,500],bounds=[0,0,99,49]}={}){const body=Buffer.concat([...recs,rec(14,dw(0,16,20))]),n=recs.length+2,total=108+body.length;
  return new Uint8Array(Buffer.concat([dw(1,108,...bounds,...frame,0x464d4520,0x10000,total,n,8,0,0,0,1000,1000,100,100,0,0,0,100000,100000),body]))}
const R={
  poly16:(t,pts)=>rec(t,Buffer.concat([dw(0,0,0,0,pts.length/2),w16(...pts)])),
  polygon:pts=>R.poly16(86,pts),polyline:pts=>R.poly16(87,pts),
  brush:(ih,style,c,h=0)=>rec(39,dw(ih,style,c,h)),
  pen:(ih,style,w,c)=>rec(95,dw(ih,0,0,0,0,style,w,0,c,0,0)),
  select:ih=>rec(37,dw(ih)),stock:k=>rec(37,dw(0x80000000+k)),del:ih=>rec(40,dw(ih)),
  xform:(m,mode)=>rec(36,Buffer.concat([f32(...m),dw(mode)])),
  mapMode:m=>rec(17,dw(m)),winExt:(x,y)=>rec(9,dw(x,y)),winOrg:(x,y)=>rec(10,dw(x,y)),vpExt:(x,y)=>rec(11,dw(x,y)),vpOrg:(x,y)=>rec(12,dw(x,y)),
  save:()=>rec(33),restore:n=>rec(34,dw(n)),fillMode:m=>rec(19,dw(m)),
  moveTo:(x,y)=>rec(27,dw(x,y)),lineTo:(x,y)=>rec(54,dw(x,y)),
  beginPath:()=>rec(59),endPath:()=>rec(60),closeFigure:()=>rec(61),fillPath:()=>rec(62,dw(0,0,0,0)),strokePath:()=>rec(64,dw(0,0,0,0)),selectClipPath:m=>rec(67,dw(m)),
  intersectClip:(l,t,r,b)=>rec(30,dw(l,t,r,b)),excludeClip:(l,t,r,b)=>rec(29,dw(l,t,r,b)),offsetClip:(x,y)=>rec(26,dw(x,y)),
  clipRgn:(mode,rects)=>{if(!rects)return rec(75,dw(0,mode));const d=Buffer.concat([dw(32,1,rects.length/4,rects.length*4,0,0,0,0),dw(...rects)]);return rec(75,Buffer.concat([dw(d.length,mode),d]))},
  rect:(l,t,r,b)=>rec(43,dw(l,t,r,b)),ellipse:(l,t,r,b)=>rec(42,dw(l,t,r,b)),arc:(box,s,e)=>rec(45,dw(...box,...s,...e)),
  font:(ih,h,face,{weight=400,italic=0,esc=0}={})=>{const f=Buffer.alloc(64);f.write(face,'utf16le');return rec(82,Buffer.concat([dw(ih,h,0,esc,esc,weight),Buffer.from([italic,0,0,0,0,0,0,0]),f]))},
  textColor:c=>rec(24,dw(c)),bkMode:m=>rec(18,dw(m)),bkColor:c=>rec(25,dw(c)),align:a=>rec(22,dw(a)),
  text:(x,y,s,{dx=null,opt=0,rc=[0,0,0,0]}={})=>{const str=pad4(Buffer.from(s,'utf16le'));return rec(84,Buffer.concat([dw(0,0,0,0,1),f32(1,1),dw(x,y,s.length,76,opt,...rc,dx?76+str.length:0),str,dx?dw(...dx):Buffer.alloc(0)]))},
  // StretchDIBits of a 24-bit bottom-up DIB given top-down as rows of [r,g,b] pixels
  dib:(x,y,cx,cy,rows,rop=0xcc0020,bpp=24)=>{const h=rows.length,w=rows[0].length,rb=((w*bpp+31)>>5)<<2,bits=Buffer.alloc(rb*h);
    rows.forEach((row,r)=>row.forEach((p,c)=>{const o=(h-1-r)*rb;if(bpp===24){bits[o+c*3]=p[2];bits[o+c*3+1]=p[1];bits[o+c*3+2]=p[0]}else if(p[0])bits[o+(c>>3)]|=0x80>>(c&7)}));
    const bmi=Buffer.concat([dw(40,w,h),w16(1,bpp),dw(0,bits.length,0,0,0,0),bpp===1?dw(0,0xffffff):Buffer.alloc(0)]);
    return rec(81,Buffer.concat([dw(0,0,0,0,x,y,0,0,w,h,80,bmi.length,80+bmi.length,bits.length,0,rop,cx,cy),bmi,bits]))},
};
const svgOf=(recs,o)=>Emf.toSvg(emf(recs,o),{png:false}).svg;
// relative path data → absolute subpaths of [x,y] points (curves contribute their end points)
function pts(d){const out=[];let x=0,y=0,sx=0,sy=0,cmd='',cur=null;const tok=d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g);let i=0;const n=()=>+tok[i++];
  while(i<tok.length){if(/[a-z]/i.test(tok[i]))cmd=tok[i++];
    if(cmd==='m'){x+=n();y+=n();sx=x;sy=y;cur=[[x,y]];out.push(cur);cmd='l'}else if(cmd==='l'){x+=n();y+=n();cur.push([x,y])}else if(cmd==='h'){x+=n();cur.push([x,y])}else if(cmd==='v'){y+=n();cur.push([x,y])}
    else if(cmd==='c'){const a=[n(),n(),n(),n(),n(),n()];x+=a[4];y+=a[5];cur.push([x,y])}else if(cmd==='z'){x=sx;y=sy;cmd=''}else throw Error('cmd '+cmd)}return out}
const paths=svg=>[...svg.matchAll(/<path d="([^"]*)"([^>]*)\/>/g)].filter(m=>!/<clipPath[^>]*>$/.test(svg.slice(0,m.index))).map(m=>({d:m[1],a:m[2],p:pts(m[1])}));
const bodyPaths=svg=>paths(svg.replace(/<defs>.*<\/defs>/s,''));
const near=(a,b,e=1e-6)=>Math.abs(a-b)<=e;

test('detection and the picture frame: viewBox in device units, size from the frame in 0.01 mm',()=>{
  const u=emf([]);assert.ok(Emf.isEmf(u));assert.ok(!Emf.isWmf(u));assert.ok(!Emf.isEmf(new Uint8Array(100)));
  assert.throws(()=>Emf.toSvg(new Uint8Array([1,2,3])),/Not an EMF or WMF/);
  const r=Emf.toSvg(u);assert.deepEqual(r.viewBox,[0,0,100,50]);assert.ok(near(r.width,10*96/25.4,1e-9)&&near(r.height,5*96/25.4,1e-9));
  assert.match(r.svg,/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"[^>]* viewBox="0 0 100 50" width="37.8" height="18.9" preserveAspectRatio="none"/);
  const off=Emf.toSvg(emf([],{frame:[500,250,1500,750]}));assert.deepEqual(off.viewBox,[50,25,100,50],'frame offset → device offset');
  assert.equal(off.stats.records,2);assert.deepEqual(off.stats.unsupported,{});
});

test('polygons: brush colour, fill rule, null pen, and a pen outline',()=>{
  let s=svgOf([R.brush(1,0,rgb(255,0,0)),R.select(1),R.stock(8),R.polygon([10,10,30,10,30,20])]);
  let p=bodyPaths(s);assert.equal(p.length,1);assert.deepEqual(p[0].p,[[[10,10],[30,10],[30,20]]]);assert.match(p[0].a,/fill="#f00"/);assert.doesNotMatch(p[0].a,/stroke|fill-rule/);
  s=svgOf([R.brush(1,0,rgb(0,0x80,0)),R.select(1),R.fillMode(2),R.polygon([0,0,9,0,9,9])]);p=bodyPaths(s);
  assert.match(p[0].a,/fill="#008000" fill-rule="nonzero" stroke="#000"/,'WINDING → nonzero; default pen is the black cosmetic one');
  s=svgOf([R.stock(5),R.pen(1,0x10000|0x2200,4,rgb(0,0,255)),R.select(1),R.polyline([0,0,50,0,50,20])]);p=bodyPaths(s);
  assert.match(p[0].a,/stroke="#00f" stroke-width="4" stroke-linecap="butt" stroke-linejoin="miter"/);assert.doesNotMatch(p[0].a,/fill=/);
  assert.deepEqual(p[0].p,[[[0,0],[50,0],[50,20]]]);
});

test('merging: disjoint shapes of one style share a path, overlapping ones keep their order',()=>{
  const red=[R.brush(1,0,rgb(255,0,0)),R.select(1),R.stock(8)];
  let p=bodyPaths(svgOf([...red,R.polygon([0,0,10,0,10,10]),R.polygon([20,0,30,0,30,10]),R.polygon([40,0,50,0,50,10])]));
  assert.equal(p.length,1);assert.equal(p[0].p.length,3);assert.deepEqual(p[0].p[2],[[40,0],[50,0],[50,10]]);
  p=bodyPaths(svgOf([...red,R.polygon([0,0,10,0,10,10]),R.polygon([5,0,15,0,15,10])]));assert.equal(p.length,2,'overlap: no merge');
  // A red, B blue on top of A, C red away from both: C may join A; a red D over B must stay above B
  p=bodyPaths(svgOf([...red,R.polygon([0,0,10,0,10,10]),R.brush(2,0,rgb(0,0,255)),R.select(2),R.polygon([2,0,8,0,8,10]),R.select(1),R.polygon([40,0,50,0,50,10]),R.polygon([3,0,7,0,7,10])]));
  assert.deepEqual(p.map(x=>[/fill="([^"]+)"/.exec(x.a)[1],x.p.length]),[['#f00',2],['#00f',1],['#f00',1]]);
});

test('transforms: anisotropic window/viewport mapping, world transform composition, SaveDC/RestoreDC',()=>{
  const sq=[0,0,10,0,10,10,0,10],br=[R.brush(1,0,0),R.select(1),R.stock(8)];
  // window (0,0)-(1000,500) → viewport (0,0)-(100,50): logical 100 = 10 device units
  let p=bodyPaths(svgOf([R.mapMode(8),R.winExt(1000,500),R.vpExt(100,50),...br,R.polygon([100,100,200,100,200,300])]));assert.deepEqual(p[0].p,[[[10,10],[20,10],[20,30]]]);
  p=bodyPaths(svgOf([R.mapMode(8),R.winOrg(-50,0),R.winExt(10,10),R.vpExt(20,-20),R.vpOrg(0,40),...br,R.polygon([0,0,5,0,5,5])]));
  assert.deepEqual(p[0].p,[[[100,40],[110,40],[110,30]]],'origins and a flipped y axis');
  p=bodyPaths(svgOf([R.mapMode(7),R.winExt(10,10),R.vpExt(100,20),...br,R.polygon([0,0,10,0,10,10])]));assert.deepEqual(p[0].p,[[[0,0],[20,0],[20,20]]],'isotropic keeps the aspect ratio');
  // world: scale 2 then (left-multiplied) translate: x' = 2x + 30
  p=bodyPaths(svgOf([...br,R.xform([2,0,0,2,0,0],4),R.xform([1,0,0,1,15,5],2),R.polygon(sq)]));assert.deepEqual(p[0].p,[[[30,10],[50,10],[50,30],[30,30]]]);
  p=bodyPaths(svgOf([...br,R.xform([2,0,0,2,0,0],4),R.xform([1,0,0,1,15,5],3),R.polygon(sq)]));assert.deepEqual(p[0].p,[[[15,5],[35,5],[35,25],[15,25]]],'right-multiply translates after scaling');
  p=bodyPaths(svgOf([...br,R.save(),R.xform([0,1,-1,0,50,0],4),R.polygon([0,0,10,0,10,10]),R.restore(-1),R.brush(2,0,rgb(0,255,0)),R.select(2),R.polygon([60,0,70,0,70,10])]));
  assert.deepEqual(p[0].p,[[[50,0],[50,10],[40,10]]],'rotation 90°');assert.deepEqual(p[1].p,[[[60,0],[70,0],[70,10]]],'restored identity');
  // geometric pen width follows the world scale; cosmetic pens stay one device unit
  let s=svgOf([R.stock(5),R.xform([.5,0,0,.5,0,0],4),R.pen(1,0x10000,6,0),R.select(1),R.polyline([0,0,100,0])]);assert.match(s,/stroke-width="3"/);
  s=svgOf([R.stock(5),R.xform([.5,0,0,.5,0,0],4),R.pen(1,0,6,0),R.select(1),R.polyline([0,0,100,0])]);assert.doesNotMatch(s,/stroke-width/);
});

test('paths: figures, Bézier, FillPath / StrokePath, and ellipse / arc geometry',()=>{
  const s=svgOf([R.brush(1,0,rgb(1,2,3)),R.select(1),R.beginPath(),R.moveTo(10,10),R.lineTo(20,10),R.lineTo(20,20),R.closeFigure(),R.moveTo(30,30),R.poly16(88,[40,30,40,40,30,40]),R.closeFigure(),R.endPath(),R.fillPath()]);
  const p=bodyPaths(s);assert.equal(p.length,1);assert.match(p[0].a,/fill="#010203"/);assert.doesNotMatch(p[0].a,/stroke/,'FillPath does not outline');
  assert.deepEqual(p[0].p,[[[10,10],[20,10],[20,20]],[[30,30],[30,40]]]);assert.match(p[0].d,/c/);
  const st=bodyPaths(svgOf([R.beginPath(),R.moveTo(0,0),R.lineTo(10,0),R.endPath(),R.strokePath()]));assert.match(st[0].a,/^ stroke="#000"$/);
  const e=bodyPaths(svgOf([R.stock(8),R.ellipse(10,10,30,20)]))[0];const xs=e.p[0].map(q=>q[0]),ys=e.p[0].map(q=>q[1]);
  assert.deepEqual([Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)],[10,30,10,20]);
  // counter-clockwise (on screen) from 3 o'clock to 12 o'clock: a quarter through the top-right
  const a=bodyPaths(svgOf([R.arc([0,0,40,40],[40,20],[20,0])]))[0].p[0];assert.deepEqual(a[0],[40,20]);assert.ok(near(a[a.length-1][0],20,1e-3)&&near(a[a.length-1][1],0,1e-3));assert.equal(a.length,2,'one Bézier segment');
});

test('clipping: rectangles, regions, clip paths, offsets and the DC stack',()=>{
  const br=[R.brush(1,0,0),R.select(1),R.stock(8)],sq=R.polygon([0,0,100,0,100,50]);
  let s=svgOf([...br,R.save(),R.intersectClip(10,10,20,20),sq,R.restore(-1),R.polygon([0,0,5,0,5,5])]);
  assert.match(s,/<clipPath id="([\w]+)"><path d="m10 10h10v10h-10z"\/><\/clipPath>.*<g clip-path="url\(#\1\)"><path [^>]*\/><\/g><path/s,'clipped, then the restore leaves the clip');
  s=svgOf([...br,R.intersectClip(10,10,90,40),R.intersectClip(20,0,100,30),sq]);assert.match(s,/<clipPath id="\w+"><path d="m20 10h70v20h-70z"\/><\/clipPath>/,'two rectangles intersect into one');
  assert.equal((s.match(/<g /g)||[]).length,1);
  s=svgOf([...br,R.clipRgn(5,[0,0,10,10,20,0,30,10]),sq,R.clipRgn(5,null),sq]);
  assert.match(s,/<clipPath id="\w+"><path d="m0 0h10v10h-10zm20 0h10v10h-10z"\/><\/clipPath>/);assert.match(s,/<\/g><path/,'RGN_COPY with no region removes the clip');
  s=svgOf([...br,R.excludeClip(10,10,20,20),sq]);assert.match(s,/<clipPath id="\w+"><path d="[^"]+" clip-rule="evenodd"\/><\/clipPath>/,'exclusion = outside minus the rectangle');
  s=svgOf([...br,R.beginPath(),R.moveTo(0,0),R.lineTo(50,0),R.lineTo(0,50),R.closeFigure(),R.endPath(),R.selectClipPath(5),R.intersectClip(0,0,20,20),R.offsetClip(5,5),sq]);
  const defs=/<defs>(.*)<\/defs>/.exec(s)[1],cps=[...defs.matchAll(/<clipPath id="(\w+)"><path d="([^"]+)"[^>]*\/><\/clipPath>/g)];assert.equal(cps.length,2);
  assert.deepEqual(pts(cps[0][2]),[[[5,5],[55,5],[5,55]]],'clip path, offset');assert.deepEqual(pts(cps[1][2]),[[[5,5],[25,5],[25,25],[5,25]]],'clip rect, offset');
  assert.match(s,new RegExp(`<g clip-path="url\\(#${cps[0][1]}\\)"><g clip-path="url\\(#${cps[1][1]}\\)"><path`),'nested = intersection');
  s=svgOf([...br,R.save(),R.intersectClip(10,10,20,20),sq,R.restore(-1),R.save(),R.intersectClip(10,10,20,20),R.polygon([60,0,70,0,70,9]),R.restore(-1)]);
  assert.equal((s.match(/<clipPath/g)||[]).length,1,'identical clip regions share one clipPath');
});

test('text: font, colour, alignment, advances, escapement, escaping and opaque background',()=>{
  const f=[R.font(1,-12,'Arial',{weight:700,italic:1}),R.select(1),R.textColor(rgb(0x11,0x22,0x33)),R.bkMode(1)];
  let s=svgOf([...f,R.align(24),R.text(10,40,'A<&>',{dx:[5,5,5,5]})]);
  assert.match(s,/<text x="10 15 20 25" y="40" font-size="12" font-family="'Arial',sans-serif" font-weight="bold" font-style="italic" fill="#123">A&lt;&amp;&gt;<\/text>/);
  s=svgOf([...f,R.align(6|24),R.text(50,40,'abcd',{dx:[5,5,5,5]})]);assert.match(s,/<text x="40 45 50 55" y="40"/,'TA_CENTER with advances: centred on the reference point');
  s=svgOf([...f,R.align(0),R.text(10,10,'X')]);assert.match(s,/<text x="10" y="20.86"/,'TA_TOP: baseline one ascent (0.905 em for Arial) below');
  s=svgOf([...f,R.align(2|24),R.text(90,40,'X')]);assert.match(s,/text-anchor="end"/,'TA_RIGHT without advances');
  s=svgOf([R.font(1,-10,'Calibri',{esc:900}),R.select(1),R.bkMode(1),R.align(24),R.text(50,40,'up')]);assert.match(s,/transform="translate\(50 40\) rotate\(-90\)"/,'escapement 90° = upwards');
  s=svgOf([R.font(1,-10,'Tahoma'),R.select(1),R.bkMode(2),R.bkColor(rgb(255,255,0)),R.align(24),R.text(10,40,'hi',{dx:[6,6]})]);
  const bg=bodyPaths(s)[0];assert.match(bg.a,/fill="#ff0"/);assert.deepEqual(bg.p[0].map(q=>q.map(v=>+v.toFixed(2))),[[10,30],[22,30],[22,42.07],[10,42.07]],'OPAQUE: a background cell behind the text');
  s=svgOf([R.font(1,-10,'Arial'),R.select(1),R.text(0,10,String.fromCharCode(36,37,3),{opt:0x10})]);assert.match(s,/>AB&#160;<\/text>/,'glyph indices of a core font');
  s=svgOf([R.font(1,-10,'Calibri'),R.select(1),R.text(0,10,String.fromCharCode(36,37),{opt:0x10})]);assert.doesNotMatch(s,/<text/,'unknown glyph order: left out');
  assert.match(bodyPaths(svgOf([R.beginPath(),R.moveTo(0,0),R.lineTo(10,0),R.moveTo(5,5),R.closeFigure(),R.endPath(),R.strokePath()]))[0].d,/^m0 0h10$/,'an empty figure does not close the open one');
  s=svgOf([R.font(1,-10,"Evil' onload='x\"<script>"),R.select(1),R.text(0,0,'<script>alert(1)</script>')]);
  assert.doesNotMatch(s,/<script|onload=/);assert.match(s,/font-family="'Evil onloadxscript',sans-serif"/);
});

// Packs.isSafeMarkup's filter (js/packs.js): converted pictures must pass it whatever their label text says
const unsafe=/<\s*(script|foreignObject|iframe|object|embed)\b|\bon\w+\s*=|javascript:/i;
const unent=t=>t.replace(/&#(\d+);/g,(m,n)=>String.fromCodePoint(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
test('text: space runs and edge spaces kept one per advance, Symbol-font characters as Unicode, labels that pass markup filters',()=>{
  const f=[R.font(1,-10,'Arial'),R.select(1),R.bkMode(1),R.align(24)];
  // C9500 faceplate: 'Series    C9500' — collapsing the run to one space would put every later glyph on an earlier advance
  let s=svgOf([...f,R.text(10,40,'A   BC',{dx:[5,5,5,5,5,5]})]),m=/<text x="([^"]*)"[^>]*>([^<]*)<\/text>/.exec(s);
  assert.equal(m[1],'10 15 20 25 30 35');assert.equal(m[2],'A&#160;&#160; BC','a run keeps every space (no-break spaces cannot collapse)');
  assert.equal(unent(m[2]).length,6,'one character per x position');
  s=svgOf([...f,R.text(10,40,' X\t ')]);assert.match(s,/>&#160;X&#160;&#160;<\/text>/,'leading, trailing and tab spaces kept');
  s=svgOf([...f,R.text(10,40,'a b')]);assert.match(s,/>a b<\/text>/,'a single inner space stays a space');
  // FortiGate 200E/G: '®' drawn as U+F0D2 in the Symbol font
  s=svgOf([R.font(1,-10,'Symbol'),R.select(1),R.bkMode(1),R.align(24),R.text(10,40,'\uf0d2'),R.text(20,40,'a\uf0b3')]);
  assert.match(s,/<text x="10" y="40" font-size="10" font-family="'Times New Roman',serif" fill="#000">&#174;<\/text>/,'Symbol 0xD2 = ®');
  assert.match(s,/>&#945;&#8805;<\/text>/,'Symbol a = α, 0xB3 = ≥');
  assert.match(svgOf([...f,R.text(10,40,'\uf0d2')]),/>&#61650;<\/text>/,'other fonts keep their private-use characters');
  // harmless labels: no handler- or URL-looking text survives as such, and the SVG is plain ASCII
  for(const t of['see javascript: docs','status onload=1','x ONCLICK =y','é ü 中 \u{1f600}']){s=svgOf([...f,R.text(10,40,t)]);
    assert.doesNotMatch(s,unsafe,t);assert.match(s,/^[\x20-\x7e]*$/,'ASCII only');assert.equal(unent(/<text[^>]*>([^<]*)<\/text>/.exec(s)[1]),t)}
  // a bitmap whose base64 happens to end "+onX=" would read as an event handler: its padding is dropped (browsers decode it unpadded)
  const r=Emf.toSvg(emf([R.dib(0,0,2,1,[[[1,2,3],[4,5,6]]])]),{png:()=>'data:image/png;base64,QUJD+onX='});
  assert.match(r.svg,/xlink:href="data:image\/png;base64,QUJD\+onX"/);assert.doesNotMatch(r.svg,unsafe);
});

test('bitmaps: DIB rows, PNG hook, BMP fallback, stretch placement and the AND/OR transparency pair',()=>{
  const red=[255,0,0],blue=[0,0,255],white=[255,255,255],black=[0,0,0];let got=null;
  const u=emf([R.dib(10,5,40,20,[[red,blue],[white,black]])]);
  const r=Emf.toSvg(u,{png:(px,w,h)=>{got={px:[...px],w,h};return'data:image/png;base64,AAAA'}});
  assert.deepEqual(got,{px:[255,0,0,255,0,0,255,255,255,255,255,255,0,0,0,255],w:2,h:2},'top-down RGBA');
  assert.match(r.svg,/<image id="(\w+)" width="2" height="2" preserveAspectRatio="none" xlink:href="data:image\/png;base64,AAAA"\/>.*<use xlink:href="#\1" transform="matrix\(20 0 0 10 10 5\)"\/>/s);
  assert.equal(r.stats.bitmaps,1);
  const b=Emf.toSvg(u,{png:false}).svg,url=/xlink:href="data:image\/bmp;base64,([^"]+)"/.exec(b)[1],bmp=Buffer.from(url,'base64');
  assert.equal(bmp.toString('latin1',0,2),'BM');assert.equal(bmp.readInt32LE(22),-2,'top-down BMP');assert.deepEqual([...bmp.subarray(54,60)],[0,0,255,255,0,0],'BGR: red, blue');
  // OR with a mask (white = keep image) then AND with the image (white = transparent): Office's transparent bitmaps
  got=[];const pair=emf([R.dib(0,0,2,1,[[white,black]],0xee0086,1),R.dib(0,0,2,1,[[red,white]],0x8800c6)]);
  const pr=Emf.toSvg(pair,{png:(px)=>{got.push([...px]);return'data:image/png;base64,AAAA'}});
  assert.equal(got.length,1,'the pair becomes one image');assert.deepEqual(got[0],[255,0,0,255,255,255,255,0]);assert.equal((pr.svg.match(/<use /g)||[]).length,1);
});

test('robustness: truncated and corrupted metafiles convert without throwing, and never emit markup from data',()=>{
  const base=emf([R.brush(1,0,rgb(255,0,0)),R.select(1),R.polygon([0,0,10,0,10,10]),R.font(2,-10,'Arial'),R.select(2),R.text(1,1,'hi',{dx:[3,3]}),R.dib(0,0,4,4,[[[1,2,3]]]),R.intersectClip(0,0,50,50),R.ellipse(0,0,20,20),
    rec(41,Buffer.concat([dw(50,25,10),f32(0,1e30)])),rec(91,Buffer.concat([dw(0,0,0,0,2,0xffffffff),dw(3,0xfffffff0),w16(0,0,5,5,9,0)]))]);
  assert.doesNotThrow(()=>Emf.toSvg(base,{png:false}));
  for(let cut=88;cut<base.length;cut+=7)assert.doesNotThrow(()=>Emf.toSvg(base.slice(0,cut),{png:false}),'cut '+cut);
  let seed=7;const rnd=()=>(seed=Math.imul(seed,1103515245)+12345>>>0)/2**32;
  for(let i=0;i<300;i++){const u=base.slice();for(let k=0;k<6;k++)u[100+Math.floor(rnd()*(u.length-100))]=rnd()*256|0;const s=Emf.toSvg(u,{png:false}).svg;assert.doesNotMatch(s,/<script|\son\w+=|javascript:/i)}
});

// ---- WMF ----
const wrec=(fn,...words)=>Buffer.concat([dw(3+words.length),w16(fn),w16(...words)]);
function wmf(recs,{box=[0,0,1440,720],inch=1440}={}){const body=Buffer.concat([...recs,dw(3),w16(0)]),words=9+body.length/2;
  return new Uint8Array(Buffer.concat([dw(0x9ac6cdd7),w16(0,...box,inch),dw(0),w16(0),w16(1,9,0x300),dw(words),w16(4),dw(16),w16(0),body]))}
test('WMF: placeable box, window mapping, objects, polygons and text',()=>{
  const u=wmf([wrec(0x020b,0,0),wrec(0x020c,720,1440),wrec(0x02fc,0,0x00ff,0,0),wrec(0x012d,0),wrec(0x02fa,5,0,0,0,0),wrec(0x012d,1),wrec(0x0324,3,100,100,500,100,500,400),
    wrec(0x0209,0x2211,0x33),wrec(0x0102,1),wrec(0x0521,2,0x6968,600,200)]);
  assert.ok(Emf.isWmf(u));assert.ok(!Emf.isEmf(u));const r=Emf.toSvg(u,{png:false});
  assert.deepEqual(r.viewBox,[0,0,1440,720]);assert.ok(near(r.width,96)&&near(r.height,48),'1440 units per inch');
  const p=bodyPaths(r.svg);assert.equal(p.length,1);assert.match(p[0].a,/^ fill="#f00"$/);assert.deepEqual(p[0].p,[[[100,100],[500,100],[500,400]]]);
  assert.match(r.svg,/<text x="200" y="[\d.]+" font-size="[\d.]+" font-family="sans-serif" font-weight="bold" fill="#123">hi<\/text>/);
  // the window is mapped onto the picture box: a window twice as large halves everything
  const h=Emf.toSvg(wmf([wrec(0x020c,1440,2880),wrec(0x02fc,0,0,0,0),wrec(0x012d,0),wrec(0x0324,3,200,200,1000,200,1000,800)]),{png:false});
  assert.deepEqual(bodyPaths(h.svg)[0].p,[[[100,100],[500,100],[500,400]]]);
  assert.deepEqual(r.stats.unsupported,{});
  // a region object selected as the clip, a stretched DIB and ExtTextOut advances
  const dib=Buffer.concat([dw(40,2,1),w16(1,24),dw(0,8,0,0,0,0),Buffer.from([0,0,255,255,0,0,0,0])]),blt=Buffer.concat([dw(3+2+8+dib.length/2),w16(0x0b41),dw(0xcc0020),w16(1,2,0,0,100,200,10,20),dib]);
  const c=Emf.toSvg(wmf([wrec(0x06ff,0,6,0,0,34,1,1,100,100,300,200,2,100,200,100,300,2),wrec(0x012c,0),wrec(0x02fc,0,0,0,0),wrec(0x012d,1),wrec(0x041b,200,300,0,0),blt,
    wrec(0x0102,1),wrec(0x0a32,50,40,2,0,0x6261,7,9)]),{png:false});
  assert.match(c.svg,/<clipPath id="\w+"><path d="m100 100h200v100h-200z"\/><\/clipPath>/);assert.match(c.svg,/<g clip-path="url\(#\w+\)"><path d="m0 0h300v200h-300z" fill="#000" stroke="#000"\/><use xlink:href="#\w+" transform="matrix\(100 0 0 100 20 10\)"\/><text x="40 47" y="62.96"/,'TA_TOP by default: baseline one ascent down');
});
test('WMF carrying an EMF in MFCOMMENT escapes plays the EMF',()=>{
  const e=Buffer.from(emf([R.brush(1,0,rgb(0,0,255)),R.select(1),R.stock(8),R.polygon([0,0,10,0,10,10])])),half=Math.ceil(e.length/2),chunks=[e.subarray(0,half),e.subarray(half)];
  const esc=chunks.map((c,i)=>{const p=pad4(Buffer.from(c)),body=Buffer.concat([w16(0x000f,34+p.length),dw(0x43464d57,1,0x10000),w16(0),dw(0,2,c.length,e.length-half*(i+1)>0?e.length-half*(i+1):0,e.length),p]);return Buffer.concat([dw(3+body.length/2),w16(0x0626),body])});
  const r=Emf.toSvg(wmf(esc),{png:false});assert.equal(r.stats.format,'wmf+emf');assert.match(r.svg,/fill="#00f"/);
});

const DIR=process.env.EMF_DIR;
test('integration: every picture in EMF_DIR converts quickly to well-formed SVG',{skip:!DIR&&'set EMF_DIR to run'},()=>{
  const files=fs.readdirSync(DIR).filter(f=>/\.(emf|wmf)$/i.test(f));assert.ok(files.length);
  for(const f of files){const u=new Uint8Array(fs.readFileSync(path.join(DIR,f))),t=Date.now(),r=Emf.toSvg(u,{png:false});const ms=Date.now()-t;
    assert.ok(ms<2000,`${f}: ${ms} ms`);assert.ok(r.svg.startsWith('<svg ')&&r.svg.endsWith('</svg>'),f);assert.ok(r.width>0&&r.height>0,f);
    assert.equal((r.svg.match(/<g /g)||[]).length,(r.svg.match(/<\/g>/g)||[]).length,f+': balanced groups');assert.doesNotMatch(r.svg,/NaN|undefined|Infinity/,f);assert.doesNotMatch(r.svg,unsafe,f+': passes markup filters')}
});
