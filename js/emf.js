// Windows metafile pictures (EMF, WMF) → SVG. Vendor Visio stencils (Cisco, Fortinet, Dell, Alcatel-Lucent faceplates…) draw
// their equipment as metafiles, which browsers cannot display, so this plays the GDI records back into SVG. EMF+ comments in
// "dual" files are skipped: their GDI records describe the same picture. Everything is drawn in the metafile's device space —
// world transform and window/viewport mapping are applied to the points here — so the output needs no nested transforms;
// pens and brushes become attributes, clip regions nested <clipPath> groups, bitmaps PNG (or BMP) data URLs, and runs of
// same-style shapes that don't overlap are merged into one path. Pure and dependency-free (browsers and node).
// Format knowledge: Microsoft Open Specifications MS-EMF and MS-WMF.
const Emf=(()=>{
const TAU=2*Math.PI,MAXPX=8e6;
const u32=(u,o)=>(u[o]|u[o+1]<<8|u[o+2]<<16|u[o+3]<<24)>>>0;
const isEmf=u=>!!u&&u.length>=88&&u32(u,0)===1&&u32(u,40)===0x464d4520;
const isWmf=u=>!!u&&u.length>=18&&(u32(u,0)===0x9ac6cdd7||(u[0]===1||u[0]===2)&&u[1]===0&&u[2]===9&&u[3]===0&&u[4]===0&&(u[5]===1||u[5]===3));
const HX='0123456789abcdef';
const hex=(r,g,b)=>(r>>4)===(r&15)&&(g>>4)===(g&15)&&(b>>4)===(b&15)?'#'+HX[r&15]+HX[g&15]+HX[b&15]:'#'+HX[r>>4]+HX[r&15]+HX[g>>4]+HX[g&15]+HX[b>>4]+HX[b&15];
const XE={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
// XML-escaped text; characters XML cannot carry become spaces one for one, so per-character positions stay aligned
const esc=s=>s.replace(/[\0-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g,' ').replace(/[&<>"']/g,c=>XE[c]);
// <text> content: every space kept one for one — runs, leading and trailing spaces would collapse (Chromium ignores an inherited
// xml:space) and shift the per-character x list, so those become no-break spaces — and '=', ':' and non-ASCII as character
// references, so the output is plain ASCII and label text like "onload=" or "javascript:" can't trip markup filters
const txt=s=>esc(s.replace(/[\t\n\r]/g,' ').replace(/^ | $| (?= )/g,'\xa0')).replace(/[=:]|[^\x20-\x7e]/gu,c=>'&#'+c.codePointAt(0)+';');
// The Symbol font's own encoding (0x20–0xFF; GDI also reaches it as U+F020–F0FF) → Unicode, for fonts that lack those code points
const SYM=' !\u2200#\u2203%&\u220b()\u2217+,\u2212./0123456789:;<=>?\u2245\u0391\u0392\u03a7\u0394\u0395\u03a6\u0393\u0397\u0399\u03d1\u039a\u039b\u039c\u039d\u039f\u03a0\u0398\u03a1\u03a3\u03a4\u03a5\u03c2\u03a9\u039e\u03a8\u0396[\u2234]\u22a5_\u203e\u03b1\u03b2\u03c7\u03b4\u03b5\u03c6\u03b3\u03b7\u03b9\u03d5\u03ba\u03bb\u03bc\u03bd\u03bf\u03c0\u03b8\u03c1\u03c3\u03c4\u03c5\u03d6\u03c9\u03be\u03c8\u03b6{|}\u223c                                 \u20ac\u03d2\u2032\u2264\u2044\u221e\u0192\u2663\u2666\u2665\u2660\u2194\u2190\u2191\u2192\u2193\u00b0\u00b1\u2033\u2265\u00d7\u221d\u2202\u2022\u00f7\u2260\u2261\u2248\u2026\u23d0\u23af\u21b5\u2135\u2111\u211c\u2118\u2297\u2295\u2205\u2229\u222a\u2283\u2287\u2284\u2282\u2286\u2208\u2209\u2220\u2207\u00ae\u00a9\u2122\u220f\u221a\u22c5\u00ac\u2227\u2228\u21d4\u21d0\u21d1\u21d2\u21d3\u25ca\u27e8\u00ae\u00a9\u2122\u2211\u239b\u239c\u239d\u23a1\u23a2\u23a3\u23a7\u23a8\u23a9\u23aa \u27e9\u222b\u2320\u23ae\u2321\u239e\u239f\u23a0\u23a4\u23a5\u23a6\u23ab\u23ac\u23ad ';
const symText=s=>s.replace(/[\x20-\xff\uf020-\uf0ff]/g,c=>SYM[(c.charCodeAt(0)&255)-32]);
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64(u){const out=[];let s='';const n=u.length;let i=0;
  for(;i+2<n;i+=3){const v=u[i]<<16|u[i+1]<<8|u[i+2];s+=B64[v>>18]+B64[v>>12&63]+B64[v>>6&63]+B64[v&63];if(s.length>8192){out.push(s);s=''}}
  if(i<n){const v=u[i]<<16|(i+1<n?u[i+1]<<8:0);s+=B64[v>>18]+B64[v>>12&63]+(i+1<n?B64[v>>6&63]:'=')+'='}out.push(s);return out.join('')}
const fnv=(u,h=0x811c9dc5)=>{for(let i=0;i<u.length;i++)h=Math.imul(h^u[i],16777619);return h>>>0};
// A grid integer (coordinate × F) as the shortest decimal: 1250 → "12.5", -5 → "-.05" (F = 100)
function nf(n,F){if(n===0)return'0';let s=String(n/F);const c=s.charCodeAt(0);if(c===48)s=s.slice(1);else if(c===45&&s.charCodeAt(1)===48)s='-'+s.slice(2);return s}
// GDI font ascent/descent (fractions of the em) for the faces vendor stencils use; positive LOGFONT heights are cell heights
const FM=[[/calibri/i,.952,.269],[/cambria/i,.95,.222],[/segoe/i,1.079,.251],[/tahoma/i,1,.207],[/verdana/i,1.005,.21],[/times/i,.891,.216],[/georgia/i,.917,.219],[/courier/i,.833,.3],[/consolas/i,.743,.257],[/trebuchet/i,.939,.222]];
const metrics=face=>{for(const m of FM)if(m[0].test(face))return m;return[null,.905,.212]};
const family=face=>{const f=String(face||'').replace(/[^\p{L}\p{N} _.\-]/gu,'').trim(),g=/courier|mono|consol|lucida console|fixed/i.test(f)?'monospace':/times|georgia|garamond|cambria|book|serif/i.test(f)&&!/sans/i.test(f)?'serif':'sans-serif';return f&&!/^(system|ms shell dlg 2?|ms sans serif)$/i.test(f)?"'"+f+"',"+g:g};

// ---------- device-independent bitmaps ----------
// DIB (BITMAPINFO + bits) → {w,h,px: top-down RGBA, a: uses alpha} — or {url} for embedded JPEG/PNG; null when unreadable.
// Core/info/V4/V5 headers, 1/2/4/8/16/24/32 bits, palettes, BI_RGB/BITFIELDS/RLE4/RLE8, top-down and bottom-up rows.
function dib(u,oh,ch,ob,cb,usage,alpha){
  if(!(oh>=0&&ch>=12&&oh+ch<=u.length&&ob>=0&&ob<=u.length))return null;const dv=new DataView(u.buffer,u.byteOffset,u.byteLength),U=o=>o+4<=u.length?dv.getUint32(o,true):0;
  const hs=U(oh);let w,h,bpp,comp=0,used=0,q=4;
  if(hs===12){w=dv.getUint16(oh+4,true);h=dv.getInt16(oh+6,true);bpp=dv.getUint16(oh+10,true);q=3}
  else if(hs>=40&&oh+40<=u.length){w=dv.getInt32(oh+4,true);h=dv.getInt32(oh+8,true);bpp=dv.getUint16(oh+14,true);comp=U(oh+16);used=U(oh+32)}else return null;
  const td=h<0;h=Math.abs(h);if(!(w>0&&h>0&&w*h<=MAXPX)||![1,2,4,8,16,24,32].includes(bpp)&&comp!==4&&comp!==5)return null;const bits=u.subarray(ob,Math.min(u.length,ob+cb));
  if(comp===4||comp===5)return{url:'data:image/'+(comp===4?'jpeg':'png')+';base64,'+b64(bits),w,h};
  let po=oh+hs,mk=null;
  if(comp===3||comp===6){if(hs===40){mk=[U(po),U(po+4),U(po+8),comp===6?U(po+12):0];po+=comp===6?16:12}else mk=[U(oh+40),U(oh+44),U(oh+48),hs>=56?U(oh+52):0]}
  else if(bpp===16)mk=[0x7c00,0x3e0,0x1f,0];else if(bpp===32)mk=[0xff0000,0xff00,0xff,alpha?0xff000000:0];
  const px=new Uint8ClampedArray(w*h*4);
  if(bpp<=8){const n=Math.min(used||1<<bpp,256),pal=new Uint8Array(1024);
    for(let i=0;i<n;i++){const o=po+i*q;if(usage===1){const g=(i*255/Math.max(1,n-1))|0;pal[i*4]=pal[i*4+1]=pal[i*4+2]=g}else if(o+3<=u.length){pal[i*4]=u[o+2];pal[i*4+1]=u[o+1];pal[i*4+2]=u[o]}}
    const ix=new Uint8Array(w*h),rows=[];// rows in file order
    if(comp===1||comp===2){const four=comp===2;let x=0,y=0,i=0;const put=v=>{if(x<w&&y<h)ix[y*w+x]=v;x++};
      while(i+1<bits.length&&y<h){const a=bits[i],b=bits[i+1];i+=2;
        if(a){for(let k=0;k<a;k++)put(four?(k&1?b&15:b>>4):b)}
        else if(b===0){x=0;y++}else if(b===1)break;else if(b===2){x+=bits[i]||0;y+=bits[i+1]||0;i+=2}
        else{for(let k=0;k<b;k++)put(four?(k&1?bits[i+(k>>1)]&15:bits[i+(k>>1)]>>4):bits[i+k]);const nb=four?(b+1)>>1:b;i+=nb+(nb&1)}}
      for(let r=0;r<h;r++)rows.push(r*w)}
    else{const rb=((w*bpp+31)>>5)<<2,m=(1<<bpp)-1;for(let r=0;r<h;r++){const o=r*rb;if(o>=bits.length)break;for(let x=0;x<w;x++){const bit=x*bpp;ix[r*w+x]=(bits[o+(bit>>3)]>>(8-bpp-(bit&7)))&m}rows.push(r*w)}}
    for(let r=0;r<rows.length;r++){const y=td?r:h-1-r;for(let x=0;x<w;x++){const p=ix[rows[r]+x]*4,d=(y*w+x)*4;px[d]=pal[p];px[d+1]=pal[p+1];px[d+2]=pal[p+2];px[d+3]=255}}
    return{w,h,px,a:false}}
  const rb=((w*bpp+31)>>5)<<2,sh=mk&&mk.map(m=>{if(!m)return[0,0,1];let s=0;while(!((m>>>s)&1))s++;return[m,s,m>>>s]});let anyA=false;
  for(let r=0;r<h;r++){const o=r*rb,y=td?r:h-1-r;if(o+rb>bits.length&&o>=bits.length)break;
    for(let x=0;x<w;x++){const d=(y*w+x)*4;if(bpp===24){const s=o+x*3;px[d]=bits[s+2];px[d+1]=bits[s+1];px[d+2]=bits[s];px[d+3]=255;continue}
      const s=o+x*(bpp>>3),v=bpp===16?bits[s]|bits[s+1]<<8:(bits[s]|bits[s+1]<<8|bits[s+2]<<16|bits[s+3]<<24)>>>0;
      for(let c=0;c<3;c++){const[m,k,mx]=sh[c];px[d+c]=m?((v&m)>>>k)*255/mx:0}
      if(sh[3][0]){px[d+3]=((v&sh[3][0])>>>sh[3][1])*255/sh[3][2];anyA=true}else px[d+3]=255}}
  if(anyA&&alpha)for(let d=0;d<px.length;d+=4){const a=px[d+3];if(a&&a<255){px[d]=px[d]*255/a;px[d+1]=px[d+1]*255/a;px[d+2]=px[d+2]*255/a}}// premultiplied → straight
  return{w,h,px,a:anyA}}
// RGBA → BMP data URL (the node fallback; browsers get PNG through opts.png)
function bmpUrl(px,w,h,a){const rb=a?w*4:(w*3+3)&~3,hs=a?108:40,off=14+hs,sz=off+rb*h,u=new Uint8Array(sz),dv=new DataView(u.buffer);
  u[0]=66;u[1]=77;dv.setUint32(2,sz,true);dv.setUint32(10,off,true);dv.setUint32(14,hs,true);dv.setInt32(18,w,true);dv.setInt32(22,-h,true);dv.setUint16(26,1,true);dv.setUint16(28,a?32:24,true);dv.setUint32(30,a?3:0,true);dv.setUint32(34,rb*h,true);
  if(a){dv.setUint32(54,0xff0000,true);dv.setUint32(58,0xff00,true);dv.setUint32(62,0xff,true);dv.setUint32(66,0xff000000,true);dv.setUint32(70,0x73524742,true)}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const s=(y*w+x)*4,d=off+y*rb+x*(a?4:3);u[d]=px[s+2];u[d+1]=px[s+1];u[d+2]=px[s];if(a)u[d+3]=px[s+3]}
  return'data:image/bmp;base64,'+b64(u)}
// The browser PNG encoder: a canvas (synchronous); null where there is none
let cv=null;
function canvasPng(px,w,h){const c=cv||(cv=document.createElement('canvas'));c.width=w;c.height=h;const x=c.getContext('2d'),id=x.createImageData(w,h);id.data.set(px);x.putImageData(id,0,0);return c.toDataURL('image/png')}

// ---------- the GDI model both formats play into: device context, objects, paths, clipping and the SVG writer ----------
// dev: {x,y,w,h} the picture (viewBox) in device units, px/py device units per mm, wmf: true for WMF mapping rules
function gdi(dev,opts,stats){
  const F=dev.F,pfx=dev.pfx,hair=opts.hairline>0?+opts.hairline:1,fw=v=>nf(Math.round(v*F*10),F*10);
  const pen=(st,w,c,geo,dash)=>({t:'p',s:st&15,cap:st>>8&15,join:st>>12&15,geo,w,c,dash}),brush=(s,c,h,img)=>({t:'b',s,c,h,img});
  const font=(h,face,wt=400)=>({t:'f',h,w:0,esc:0,wt,it:0,ul:0,so:0,face});
  const STOCK={0:brush(0,'#fff'),1:brush(0,'#c0c0c0'),2:brush(0,'#808080'),3:brush(0,'#404040'),4:brush(0,'#000'),5:brush(1),6:pen(0,0,'#fff'),7:pen(0,0,'#000'),8:pen(5,0,'#000'),
    10:font(12,'Courier New'),11:font(12,'Courier New'),12:font(12,'Arial'),13:font(16,'System',700),14:font(16,'System'),16:font(16,'Courier New'),17:font(-11,'Arial'),18:brush(0,'#fff'),19:pen(0,0,'#000')};
  const ID=[1,0,0,1,0,0];
  let dc={mm:dev.wmf?8:1,wox:0,woy:0,wex:1,wey:1,vox:0,voy:0,vex:1,vey:1,xf:ID,pen:STOCK[7],brush:STOCK[0],font:STOCK[13],tc:'#000',bc:'#fff',bk:2,pfm:1,ta:0,rop:13,ml:10,ad:1,cx:0,cy:0,clip:null,meta:null,M:null,E:undefined};
  if(dev.wmf){dc.wox=dc.vox=dev.x;dc.woy=dc.voy=dev.y;dc.wex=dc.vex=dev.w;dc.wey=dc.vey=dev.h}
  const stack=[],objs=[];let path=null,popen=false;
  // logical → device: world transform, then the window → viewport mapping of the map mode
  function mat(){if(dc.M)return dc.M;const x=dc.xf;let sx,sy;const k=[0,1,.1,.01,.254,.0254,25.4/1440][dc.mm];
    if(dc.mm===1){sx=sy=1}else if(k){sx=dev.px*k;sy=-dev.py*k}else{sx=dc.vex/dc.wex;sy=dc.vey/dc.wey;if(dc.mm===7){const s=Math.min(Math.abs(sx),Math.abs(sy));sx=Math.sign(sx)*s;sy=Math.sign(sy)*s}}
    if(!isFinite(sx)||!sx)sx=1;if(!isFinite(sy)||!sy)sy=1;
    return dc.M=[x[0]*sx,x[1]*sy,x[2]*sx,x[3]*sy,(x[4]-dc.wox)*sx+dc.vox,(x[5]-dc.woy)*sy+dc.voy]}
  const det=()=>{const M=mat();return M[0]*M[3]-M[1]*M[2]};
  const np=()=>({o:[],c:[]});
  const mv=(p,x,y)=>{const M=mat();p.o.push(0);p.c.push(M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5])};
  const ln=(p,x,y)=>{const M=mat();p.o.push(1);p.c.push(M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5])};
  const cb=(p,a,b,c,d,e,f)=>{const M=mat();p.o.push(2);p.c.push(M[0]*a+M[2]*b+M[4],M[1]*a+M[3]*b+M[5],M[0]*c+M[2]*d+M[4],M[1]*c+M[3]*d+M[5],M[0]*e+M[2]*f+M[4],M[1]*e+M[3]*f+M[5])};
  const cl=p=>{if(p.o.length&&p.o[p.o.length-1]!==3)p.o.push(3)};
  // elliptic arc between parameters t0 → t1 as cubic Béziers; how 'm' starts a figure at its start, 'l' draws a line there
  function earc(p,cx,cy,rx,ry,t0,t1,how){const n=Math.max(1,Math.ceil(Math.abs(t1-t0)/(Math.PI/2)-1e-9)),d=(t1-t0)/n,k=4/3*Math.tan(d/4);let c0=Math.cos(t0),s0=Math.sin(t0);
    if(how==='m')mv(p,cx+rx*c0,cy+ry*s0);else if(how==='l')ln(p,cx+rx*c0,cy+ry*s0);
    for(let i=1;i<=n;i++){const t=t0+d*i,c1=Math.cos(t),s1=Math.sin(t);cb(p,cx+rx*(c0-k*s0),cy+ry*(s0+k*c0),cx+rx*(c1+k*s1),cy+ry*(s1-k*c1),cx+rx*c1,cy+ry*s1);c0=c1;s0=s1}return[cx+rx*c0,cy+ry*s0]}
  const rectP=(l,t,r,b,p=np())=>{mv(p,l,t);ln(p,r,t);ln(p,r,b);ln(p,l,b);cl(p);return p};
  const devRects=(rs,p=np())=>{for(let i=0;i+3<rs.length;i+=4){p.o.push(0,1,1,1,3);p.c.push(rs[i],rs[i+1],rs[i+2],rs[i+1],rs[i+2],rs[i+3],rs[i],rs[i+3])}return p};

  // ---- SVG writer: merged paths inside nested clip groups ----
  const body=[],defs=[],open=[],clipIds=new Map(),patIds=new Map(),imgIds=new Map();let nid=0,mask=null;
  const st0=()=>({x:0,y:0,sx:0,sy:0,c:''});
  // path → relative path data on the F grid; st carries the pen position between merged items; chain continues an open subpath
  function ser(p,st,chain){const o=p.o,c=p.c;let s='',k=0,lt=true,last=st.c,dang=false;
    const ap=t=>{s+=lt||t.charCodeAt(0)===45?t:' '+t;lt=false},cmd=l=>{s+=l;lt=true};
    for(let i=0;i<o.length;i++){const op=o[i];
      if(op===0){const X=Math.round(c[k]*F),Y=Math.round(c[k+1]*F);k+=2;dang=false;if(i+1>=o.length||o[i+1]===0||o[i+1]===3){dang=true;continue}
        if(chain&&i===0&&X===st.x&&Y===st.y&&last&&last!=='z')continue;cmd('m');ap(nf(X-st.x,F));ap(nf(Y-st.y,F));st.x=st.sx=X;st.y=st.sy=Y;last='m'}
      else if(op===1){const X=Math.round(c[k]*F),Y=Math.round(c[k+1]*F),dx=X-st.x,dy=Y-st.y;k+=2;
        if(last==='z'){cmd('m');ap('0');ap('0');last='m'}
        if(!dx&&!dy&&last!=='m'||o[i+1]===3&&X===st.sx&&Y===st.sy&&last!=='m'){st.x=X;st.y=Y;continue}
        if(!dy&&dx){if(last!=='h')cmd('h');ap(nf(dx,F));last='h'}else if(!dx&&dy){if(last!=='v')cmd('v');ap(nf(dy,F));last='v'}
        else{if(last!=='l'&&last!=='m')cmd('l');ap(nf(dx,F));ap(nf(dy,F));last='l'}st.x=X;st.y=Y}
      else if(op===2){if(last==='z'){cmd('m');ap('0');ap('0')}const x0=st.x,y0=st.y;if(last!=='c')cmd('c');
        for(let j=0;j<3;j++){const X=Math.round(c[k]*F),Y=Math.round(c[k+1]*F);k+=2;ap(nf(X-x0,F));ap(nf(Y-y0,F));if(j===2){st.x=X;st.y=Y}}last='c'}
      else if(last&&last!=='z'&&!dang){cmd('z');st.x=st.sx;st.y=st.sy;last='z'}}
    st.c=last;return s}
  // the effective clip: meta region terms, then clip region terms (each term a union of parts, terms intersected)
  const eff=()=>dc.E!==undefined?dc.E:(dc.E=!dc.meta?dc.clip:!dc.clip?dc.meta:dc.meta.concat(dc.clip));
  function termId(t){if(t.id)return t.id;const k=t.parts.map(q=>'<path d="'+ser(q.p,st0())+'"'+(q.r===1?' clip-rule="evenodd"':'')+'/>').join('');let id=clipIds.get(k);
    if(!id){id=pfx+'c'+(++nid);clipIds.set(k,id);defs.push('<clipPath id="'+id+'">'+k+'</clipPath>')}return t.id=id}
  function sync(C){const want=C||[];let i=0;while(i<open.length&&i<want.length&&open[i]===want[i])i++;for(let j=open.length;j>i;j--)body.push('</g>');open.length=i;
    for(;i<want.length;i++){body.push('<g clip-path="url(#'+termId(want[i])+')">');open.push(want[i])}}
  // pending paths: a window of style groups not yet written. A shape joins the newest group of its style when nothing drawn
  // since (and nothing in that group) overlaps its box, so runs like gradient strips across many ports collapse into few paths
  const win=[],WIN=48,LIM=600;
  const emit=g=>{if(g.s){sync(g.C);body.push('<path d="'+g.s+'"'+g.a+'/>')}};
  function flush(){for(const g of win)emit(g);win.length=0}
  const hits=(g,x0,y0,x1,y1)=>{if(!(x0<g.X1&&x1>g.X0&&y0<g.Y1&&y1>g.Y0))return false;const b=g.b;for(let i=0;i<b.length;i+=4)if(x0<b[i+2]&&x1>b[i]&&y0<b[i+3]&&y1>b[i+1])return true;return false};
  function put(p,a,fill,hw){const C=eff(),c=p.c;if(!c.length)return;let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    for(let i=0;i<c.length;i+=2){const x=c[i],y=c[i+1];if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}x0-=hw;y0-=hw;x1+=hw;y1+=hw;if(!(x1-x0<1e15&&y1-y0<1e15))return;
    let g=null,budget=4000;
    for(let j=win.length-1;j>=0;j--){const w=win[j],h=hits(w,x0,y0,x1,y1);if(w.a===a&&w.C===C&&w.n<LIM&&(!h||!fill&&j===win.length-1)){g=w;break}if(h||(budget-=w.n)<0)break}
    if(!g){g={a,C,n:0,s:'',st:st0(),b:[],X0:Infinity,Y0:Infinity,X1:-Infinity,Y1:-Infinity};win.push(g);if(win.length>WIN)emit(win.shift())}
    g.s+=ser(p,g.st,!fill&&g.n>0&&g===win[win.length-1]);g.n++;g.b.push(x0,y0,x1,y1);if(x0<g.X0)g.X0=x0;if(y0<g.Y0)g.Y0=y0;if(x1>g.X1)g.X1=x1;if(y1>g.Y1)g.Y1=y1}
  const ropc=c=>{switch(dc.rop){case 1:return'#000';case 16:return'#fff';case 4:case 6:{const v=parseInt(c.length===4?c[1]+c[1]+c[2]+c[2]+c[3]+c[3]:c.slice(1),16)^0xffffff;return hex(v>>16,v>>8&255,v&255)}default:return c}};
  function hatch(b){const bg=dc.bk===2?dc.bc:null,k=b.h+'|'+b.c+'|'+bg;let id=patIds.get(k);if(id)return id;id=pfx+'h'+(++nid);patIds.set(k,id);
    const d=['M0 .5h8M0 4.5h8','M.5 0v8M4.5 0v8','M0 0l8 8M-1 7l2 2M7-1l2 2','M0 8l8-8M-1 1l2-2M7 9l2-2','M0 4.5h8M4.5 0v8','M0 0l8 8M0 8l8-8'][b.h]||'M0 4.5h8';
    defs.push('<pattern id="'+id+'" patternUnits="userSpaceOnUse" width="8" height="8">'+(bg?'<rect width="8" height="8" fill="'+bg+'"/>':'')+'<path d="'+d+'" stroke="'+b.c+'" stroke-linecap="square"/></pattern>');return id}
  function patImg(b){const k='p'+imgId(b.img);let id=patIds.get(k);if(id)return id;id=pfx+'p'+(++nid);patIds.set(k,id);
    defs.push('<pattern id="'+id+'" patternUnits="userSpaceOnUse" width="'+b.img.w+'" height="'+b.img.h+'"><use xlink:href="#'+imgId(b.img)+'"/></pattern>');return id}
  function fillOf(b=dc.brush){if(!b||b.t!=='b'||b.s===1)return null;let v;if(b.s===2&&b.h>=0&&b.h<6)v='url(#'+hatch(b)+')';else if(b.img&&b.img.px)v='url(#'+patImg(b)+')';else v=ropc(b.c||'#000');
    return' fill="'+v+'"'+(dc.pfm===2?' fill-rule="nonzero"':'')}
  // geometric pen widths scale with the picture; plain GDI files keep GDI's one-device-pixel floor, EMF+ dual ones don't (Office draws their
  // EMF+ copy, whose hairlines really are that thin); cosmetic pens are one device unit
  function strokeOf(){const p=dc.pen;if(!p||p.t!=='p'||p.s===5||dc.rop===11)return null;const sc=Math.sqrt(Math.abs(det()));
    const w=p.geo?Math.max(p.w*sc,stats.emfPlus?0:1)||hair:hair;let a=' stroke="'+ropc(p.c)+'"'+(w!==1?' stroke-width="'+fw(w)+'"':'');
    if(p.geo){if(p.cap===1)a+=' stroke-linecap="square"';else if(p.cap===2)a+=' stroke-linecap="butt"';if(p.join===1)a+=' stroke-linejoin="bevel"';else if(p.join===2)a+=' stroke-linejoin="miter"'+(dc.ml!==10?' stroke-miterlimit="'+fw(Math.max(1,dc.ml))+'"':'')}
    let da=null;if(p.s===7&&p.dash&&p.dash.length)da=p.dash.map(v=>v*(p.geo?sc:1));
    else if(p.s>=1&&p.s<=4&&(!p.geo||p.w*sc<=1.5||p.dash))da=(p.geo?[[3,1],[1,1],[3,1,1,1],[3,1,1,1,1,1]]:[[18,6],[3,3],[9,6,3,6],[9,3,3,3,3,3]])[p.s-1].map(v=>v*(p.geo?w:1));
    else if(p.s===8)da=[1,1];
    if(da&&da.some(v=>v>0))a+=' stroke-dasharray="'+da.map(fw).join(' ')+'"'+(!p.geo?' stroke-linecap="butt"':'');return{a,w}}
  // fill and/or outline a device path with the selected brush and pen
  function draw(p,f,s){if(!p.o.length||dc.rop===11)return;pre();const fa=f?fillOf():null,sa=s?strokeOf():null;if(!fa&&!sa)return;put(p,(fa||'')+(sa?sa.a:''),!!fa,sa?sa.w/2:0)}
  function fillWith(p,color,rule){pre();put(p,' fill="'+color+'"'+(rule===2?' fill-rule="nonzero"':''),true,0)}
  function pre(){if(mask){const m=mask;mask=null;place(alone(m.src,m.r),m.T,1)}}

  // ---- figures: into the open path bracket, or drawn at once ----
  function fig(build,close,f,s){if(path){build(path);if(close){cl(path);popen=false}return}const p=np();build(p);if(close)cl(p);draw(p,f,s)}
  function figTo(build){// continues the current figure from the current position (LineTo, PolylineTo, PolyBezierTo, ArcTo)
    if(path){if(!popen){mv(path,dc.cx,dc.cy);popen=true}build(path);return}const p=np();mv(p,dc.cx,dc.cy);build(p);draw(p,false,true)}
  const G={
    get dc(){return dc},stats,STOCK,
    polygon(a,n){if(n<2)return;fig(p=>{mv(p,a[0],a[1]);for(let i=1;i<n;i++)ln(p,a[2*i],a[2*i+1])},true,true,true)},
    polyline(a,n){if(n<1)return;fig(p=>{mv(p,a[0],a[1]);for(let i=1;i<n;i++)ln(p,a[2*i],a[2*i+1])},false,false,true);if(path)popen=true},
    bezier(a,n){if(n<1)return;fig(p=>{mv(p,a[0],a[1]);for(let i=1;i+2<n;i+=3)cb(p,a[2*i],a[2*i+1],a[2*i+2],a[2*i+3],a[2*i+4],a[2*i+5])},false,false,true);if(path)popen=true},
    lineTo(x,y){figTo(p=>ln(p,x,y));dc.cx=x;dc.cy=y},
    polylineTo(a,n){if(n<1)return;figTo(p=>{for(let i=0;i<n;i++)ln(p,a[2*i],a[2*i+1])});dc.cx=a[2*n-2];dc.cy=a[2*n-1]},
    bezierTo(a,n){n-=n%3;if(n<3)return;figTo(p=>{for(let i=0;i+2<n;i+=3)cb(p,a[2*i],a[2*i+1],a[2*i+2],a[2*i+3],a[2*i+4],a[2*i+5])});dc.cx=a[2*n-2];dc.cy=a[2*n-1]},
    moveTo(x,y){dc.cx=x;dc.cy=y;if(path)mv(path,x,y);popen=!!path},// in a path bracket a move starts a new (maybe empty) figure
    // PolyPolygon / PolyPolyline: one path, so the fill rule works across the polygons
    polyPoly(a,counts,closed,total){let k=0;fig(p=>{for(let n of counts){n=Math.min(n,total-k);if(n<=0)break;{mv(p,a[2*k],a[2*k+1]);for(let i=1;i<n;i++)ln(p,a[2*(k+i)],a[2*(k+i)+1]);if(closed)cl(p)}k+=n}},false,closed,true)},
    polyDraw(a,ty,n){const build=p=>{for(let i=0;i<n;i++){const t=ty[i]&6,x=a[2*i],y=a[2*i+1];
        if(t===6){mv(p,x,y);dc.cx=x;dc.cy=y}else if(t===2){ln(p,x,y);dc.cx=x;dc.cy=y}else if(t===4&&i+2<n){cb(p,x,y,a[2*i+2],a[2*i+3],a[2*i+4],a[2*i+5]);i+=2;dc.cx=a[2*i];dc.cy=a[2*i+1]}if(ty[i]&1)cl(p)}};
      if(path){mv(path,dc.cx,dc.cy);build(path);popen=true}else{const p=np();mv(p,dc.cx,dc.cy);build(p);draw(p,false,true)}},
    rect(l,t,r,b){fig(p=>rectP(Math.min(l,r),Math.min(t,b),Math.max(l,r),Math.max(t,b),p),true,true,true)},
    roundRect(l,t,r,b,w,h){[l,r]=[Math.min(l,r),Math.max(l,r)];[t,b]=[Math.min(t,b),Math.max(t,b)];const rx=Math.min(Math.abs(w)/2,(r-l)/2),ry=Math.min(Math.abs(h)/2,(b-t)/2);
      if(!(rx>0&&ry>0))return G.rect(l,t,r,b);const q=Math.PI/2;
      fig(p=>{mv(p,l+rx,t);ln(p,r-rx,t);earc(p,r-rx,t+ry,rx,ry,-q,0);ln(p,r,b-ry);earc(p,r-rx,b-ry,rx,ry,0,q);ln(p,l+rx,b);earc(p,l+rx,b-ry,rx,ry,q,2*q);ln(p,l,t+ry);earc(p,l+rx,t+ry,rx,ry,2*q,3*q)},true,true,true)},
    ellipse(l,t,r,b){const cx=(l+r)/2,cy=(t+b)/2,rx=Math.abs(r-l)/2,ry=Math.abs(b-t)/2;fig(p=>earc(p,cx,cy,rx,ry,0,TAU,'m'),true,true,true)},
    // Arc / Chord / Pie / ArcTo: the box's ellipse from the radial through the start point to the one through the end point,
    // counter-clockwise (as seen on the device) unless SetArcDirection made it clockwise
    arc(kind,l,t,r,b,xs,ys,xe,ye){const cx=(l+r)/2,cy=(t+b)/2,rx=Math.abs(r-l)/2||1e-9,ry=Math.abs(b-t)/2||1e-9;let t0=Math.atan2((ys-cy)/ry,(xs-cx)/rx),t1=Math.atan2((ye-cy)/ry,(xe-cx)/rx);
      const inc=(dc.ad===2)===(det()>0);if(inc){while(t1<=t0)t1+=TAU}else{while(t1>=t0)t1-=TAU}
      if(kind==='to'){let e;figTo(p=>{e=earc(p,cx,cy,rx,ry,t0,t1,'l')});dc.cx=e[0];dc.cy=e[1];return}
      if(kind==='pie')fig(p=>{mv(p,cx,cy);earc(p,cx,cy,rx,ry,t0,t1,'l')},true,true,true);else fig(p=>earc(p,cx,cy,rx,ry,t0,t1,'m'),kind==='chord',kind==='chord',true);if(path&&kind==='arc')popen=true},
    angleArc(x,y,r,a0,sw){if(!isFinite(a0)||!isFinite(sw))return;sw=Math.max(-360,Math.min(360,sw));const t0=-a0*Math.PI/180,t1=-(a0+sw)*Math.PI/180;let e;figTo(p=>{e=earc(p,x,y,r,r,t0,t1,'l')});dc.cx=e[0];dc.cy=e[1]},
    pixel(x,y,c){const M=mat(),X=M[0]*x+M[2]*y+M[4],Y=M[1]*x+M[3]*y+M[5];fillWith(devRects([X,Y,X+1,Y+1]),c,2)},
    // ---- path brackets ----
    beginPath(){path=np();popen=false},endPath(){popen=false},abortPath(){path=null},closeFigure(){if(path){cl(path);popen=false}},flattenPath(){},
    widenPath(){if(path)path.wide=true},
    fillPath(){const p=path;path=null;if(p)p.wide?G.strokeW(p,true):draw(p,true,false)},
    strokePath(){const p=path;path=null;if(p)draw(p,false,true)},
    strokeFillPath(){const p=path;path=null;if(p)draw(p,true,true)},
    strokeW(p){const s=strokeOf(),f=fillOf();if(!s||!f)return;const c=/fill="([^"]+)"/.exec(f)[1];pre();put(p,s.a.replace(/stroke="[^"]+"/,'stroke="'+c+'"'),false,s.w/2)},
    selectClipPath(mode){const p=path;path=null;if(p)clipOp(mode,[{p,r:dc.pfm===2?2:1}])},
    // ---- clipping (regions are device-space paths) ----
    intersectClip(l,t,r,b){clipOp(1,[{p:rectP(l,t,r,b),r:2}])},excludeClip(l,t,r,b){clipOp(4,[{p:rectP(l,t,r,b),r:2}])},
    clipRgn(mode,rects){if(!rects){if(mode===5){dc.clip=null;dc.E=undefined}return}clipOp(mode,[{p:devRects(rects),r:2}])},
    offsetClip(x,y){if(!dc.clip)return;const M=mat(),dx=M[0]*x+M[2]*y,dy=M[1]*x+M[3]*y;dc.clip=dc.clip.map(t=>({parts:t.parts.map(q=>({r:q.r,p:{o:q.p.o,c:q.p.c.map((v,i)=>v+(i&1?dy:dx))}}))}));dc.E=undefined},
    setMetaRgn(){if(dc.clip)dc.meta=dc.meta?dc.meta.concat(dc.clip):dc.clip;dc.clip=null;dc.E=undefined},
    // ---- state ----
    setMapMode(m){if(m>=1&&m<=8&&!(dev.wmf&&m===1)){dc.mm=m;dc.M=null}},
    winOrg(x,y){dc.wox=x;dc.woy=y;dc.M=null},winExt(x,y){if(dc.mm>=7&&x&&y){dc.wex=x;dc.wey=y;dc.M=null}},
    vpOrg(x,y){dc.vox=x;dc.voy=y;dc.M=null},vpExt(x,y){if(dc.mm>=7&&x&&y){dc.vex=x;dc.vey=y;dc.M=null}},
    scaleVp(xn,xd,yn,yd){if(dc.mm>=7&&xd&&yd&&xn&&yn){dc.vex=dc.vex*xn/xd;dc.vey=dc.vey*yn/yd;dc.M=null}},scaleWin(xn,xd,yn,yd){if(dc.mm>=7&&xd&&yd&&xn&&yn){dc.wex=dc.wex*xn/xd;dc.wey=dc.wey*yn/yd;dc.M=null}},
    offWin(x,y){dc.wox+=x;dc.woy+=y;dc.M=null},offVp(x,y){dc.vox+=x;dc.voy+=y;dc.M=null},
    setXf(x){if(x.every(isFinite)){dc.xf=x;dc.M=null}},
    modXf(x,mode){const W=dc.xf,m=(A,B)=>[A[0]*B[0]+A[1]*B[2],A[0]*B[1]+A[1]*B[3],A[2]*B[0]+A[3]*B[2],A[2]*B[1]+A[3]*B[3],A[4]*B[0]+A[5]*B[2]+B[4],A[4]*B[1]+A[5]*B[3]+B[5]];
      if(!x.every(isFinite))return;dc.xf=mode===1?ID:mode===2?m(x,W):mode===3?m(W,x):mode===4?x:W;dc.M=null},
    save(){if(stack.length<4096)stack.push(Object.assign({},dc))},
    restore(n){const i=n<0?stack.length+n:n-1;if(i>=0&&i<stack.length){dc=Object.assign({},stack[i]);stack.length=i}},
    set(k,v){dc[k]=v},
    // ---- objects ----
    obj(i,o){if(i>=0&&i<65536)objs[i]=o},freeSlot(){let i=0;while(objs[i])i++;return i},
    del(i){if(i>=0)objs[i]=undefined},
    select(i){const o=i>=0x80000000?STOCK[i&0x7fffffff]:objs[i];if(!o)return;if(o.t==='p')dc.pen=o;else if(o.t==='b')dc.brush=o;else if(o.t==='f')dc.font=o;else if(o.t==='r'&&dev.wmf)G.clipRgn(5,o.rects)},
    getObj:i=>i>=0x80000000?STOCK[i&0x7fffffff]:objs[i],
    pen,brush,
    fillRgn(rects,b){if(!rects||!rects.length)return;const keep=dc.brush;dc.brush=b||keep;draw(devRects(rects),true,false);dc.brush=keep},
    frameRgn(rects,b,w,h){if(!rects||!rects.length||!b)return;const f=fillOf(b);if(!f)return;const c=/fill="([^"]+)"/.exec(f)[1];pre();put(devRects(rects),' stroke="'+c+'" stroke-width="'+fw(Math.max(1,(Math.abs(w)+Math.abs(h))))+'"',false,1)},
    gradient(vs,mode,idx){pre();const M=mat(),P=v=>[M[0]*v[0]+M[2]*v[1]+M[4],M[1]*v[0]+M[3]*v[1]+M[5]];
      if(mode===2){for(let i=0;i+2<idx.length;i+=3){const a=vs[idx[i]],b=vs[idx[i+1]],c=vs[idx[i+2]];if(!a||!b||!c)continue;const p=np();p.o.push(0,1,1,3);p.c.push(...P(a),...P(b),...P(c));
        fillWith(p,hex(...[2,3,4].map(k=>(a[k]+b[k]+c[k])/3|0)),2)}return}
      for(let i=0;i+1<idx.length;i+=2){const a=vs[idx[i]],b=vs[idx[i+1]];if(!a||!b)continue;const p0=P(a),p1=P(b),h=mode===0;if(!p0.concat(p1).every(isFinite))continue;const id=pfx+'g'+(++nid);
        defs.push('<linearGradient id="'+id+'" gradientUnits="userSpaceOnUse" x1="'+fw(p0[0])+'" y1="'+fw(p0[1])+'" x2="'+fw(h?p1[0]:p0[0])+'" y2="'+fw(h?p0[1]:p1[1])+'"><stop offset="0" stop-color="'+hex(a[2],a[3],a[4])+'"/><stop offset="1" stop-color="'+hex(b[2],b[3],b[4])+'"/></linearGradient>');
        const p=np();p.o.push(0,1,1,1,3);p.c.push(p0[0],p0[1],p1[0],p0[1],p1[0],p1[1],p0[0],p1[1]);flush();put(p,' fill="url(#'+id+')"',true,0);flush()}},
    text,blt,mat,
  };
  // device rectangle of a one-rectangle axis-aligned clip part, else null
  const isRect=q=>{const o=q.p.o,c=q.p.c;if(o.length!==5||o[0]!==0||o[4]!==3)return null;const xs=[c[0],c[2],c[4],c[6]],ys=[c[1],c[3],c[5],c[7]];
    const ok=(c[0]===c[2]&&c[3]===c[5]&&c[4]===c[6]&&c[7]===c[1])||(c[1]===c[3]&&c[2]===c[4]&&c[5]===c[7]&&c[6]===c[0]);return ok?[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]:null};
  function clipOp(mode,parts){if(!parts.every(q=>q.p.c.every(isFinite)))return;let c=dc.clip;const T={parts};
    if(mode===1&&c&&c.length&&parts.length===1&&c[c.length-1].parts.length===1){const a=isRect(c[c.length-1].parts[0]),b=isRect(parts[0]);
      if(a&&b){const r=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];if(r[2]<r[0])r[2]=r[0];if(r[3]<r[1])r[3]=r[1];c=c.slice(0,-1);T.parts=[{p:devRects(r),r:2}]}}
    if(c&&c.length>=64&&mode===1)return;
    if(mode===5)c=[T];else if(mode===1)c=c?c.concat([T]):[T];
    else if(mode===2){if(c)c=[{parts:c[c.length-1].parts.concat(parts)}]}
    else if(mode===3||mode===4){const big=np(),X=dev.x-dev.w*50,Y=dev.y-dev.h*50,W=dev.w*101,H=dev.h*101;big.o.push(0,1,1,1,3);big.c.push(X,Y,X+W,Y,X+W,Y+H,X,Y+H);
      for(const q of parts){for(const v of q.p.o)big.o.push(v);for(const v of q.p.c)big.c.push(v)}const inv={parts:[{p:big,r:1}]};c=c?c.concat([inv]):[inv]}
    dc.clip=c;dc.E=undefined}

  // ---- text ----
  // ExtTextOut at logical (x,y): dx = per-character advances (logical), opt = ETO_* flags, rc = its logical rectangle
  function text(x,y,str,dx,opt,rc){pre();if(dc.ta&1){x=dc.cx;y=dc.cy}const f=dc.font&&dc.font.t==='f'?dc.font:STOCK[13],M=mat(),m=metrics(f.face),ul=Math.hypot(M[0],M[1])||1,vl=Math.hypot(M[2],M[3])||1;
    const sym=/^\s*symbol\s*$/i.test(f.face||'');if(sym)str=symText(str);
    const em=(f.h<0?-f.h:f.h>0?f.h/(m[1]+m[2]):12)*vl,ox=M[0]*x+M[2]*y+M[4],oy=M[1]*x+M[3]*y+M[5],ang=Math.atan2(M[1],M[0])-(f.esc||0)*Math.PI/1800,ca=Math.cos(ang),sa=Math.sin(ang);
    if(!isFinite(ox+oy+em+ang))return;const L=(a,b)=>[ox+a*ca-b*sa,oy+a*sa+b*ca];// glyph-local (baseline x, down y) → device
    if(opt&2&&rc&&!(opt&0x100))fillWith(rectP(Math.min(rc[0],rc[2]),Math.min(rc[1],rc[3]),Math.max(rc[0],rc[2]),Math.max(rc[1],rc[3])),dc.bc,2);
    const n=str.length;let tot=0,adv=null;if(dx&&dx.length>=n&&n){adv=new Array(n);for(let i=0;i<n;i++){adv[i]=dx[i]*ul;tot+=adv[i]}}
    const ha=dc.ta&6,va=dc.ta&24,x0=adv?(ha===6?-tot/2:ha===2?-tot:0):0,by=va===24?0:va===8?-m[2]*em:m[1]*em;
    if(!str.trim()){if(dc.ta&1&&adv){dc.cx+=tot/ul}return}
    if(dc.bk===2&&!(opt&2)){const w=adv?tot:n*em*.55,a=adv?x0:ha===6?-w/2:ha===2?-w:0,p=np(),c=[L(a,by-m[1]*em),L(a+w,by-m[1]*em),L(a+w,by+m[2]*em),L(a,by+m[2]*em)];p.o.push(0,1,1,1,3);p.c.push(...c.flat());fillWith(p,dc.bc,2)}
    let C=eff();if(opt&4&&rc){const t={parts:[{p:rectP(rc[0],rc[1],rc[2],rc[3]),r:2}]};C=C?C.concat([t]):[t]}
    const rot=Math.abs(sa)>1e-4||ca<0,X=v=>nf(Math.round(v*F),F);let pos='';
    if(adv){let s=[],a=x0;for(let i=0;i<n;i++){s.push(X(rot?a:ox+a));a+=adv[i]}pos=' x="'+s.join(' ')+'" y="'+X(rot?by:oy+by)+'"'}else pos=' x="'+X(rot?0:ox)+'" y="'+X(rot?by:oy+by)+'"'+(ha===6?' text-anchor="middle"':ha===2?' text-anchor="end"':'');
    const at=pos+(rot?' transform="translate('+X(ox)+' '+X(oy)+') rotate('+fw(ang*180/Math.PI)+')"':'')+' font-size="'+fw(em)+'" font-family="'+(sym?"'Times New Roman',serif":family(f.face))+'"'+(f.wt>=600?' font-weight="bold"':f.wt&&f.wt<=300?' font-weight="'+f.wt+'"':'')+(f.it?' font-style="italic"':'')+(f.ul||f.so?' text-decoration="'+(f.ul?'underline':'')+(f.so?' line-through':'')+'"':'')+' fill="'+dc.tc+'"';
    flush();sync(C);body.push('<text'+at+'>'+txt(str)+'</text>');stats.text++;if(dc.ta&1)dc.cx+=(adv?tot:n*em*.55)/ul}

  // ---- bitmaps ----
  function imgId(im){const k=im.url?im.url:im.w+'x'+im.h+':'+fnv(im.px).toString(36)+':'+(im.px.length>64?fnv(im.px.subarray(im.px.length>>1)):0);let id=imgIds.get(k);if(id)return id;id=pfx+'b'+(++nid);imgIds.set(k,id);
    let url=im.url;if(!url){const enc=opts.png===false?null:opts.png||(typeof document!=='undefined'&&document.createElement?canvasPng:null);try{url=enc?enc(im.px,im.w,im.h):null}catch(e){url=null}if(!url)url=bmpUrl(im.px,im.w,im.h,im.a)}
    if(!/^data:image\/(png|jpeg|gif|bmp|webp);base64,[A-Za-z0-9+/=]*$/.test(url))url='data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    if(/\bon\w+\s*=/i.test(url))url=url.replace(/=+$/,'');// base64 ending "+onX=" reads as an event handler to markup filters; browsers decode it unpadded
    defs.push('<image id="'+id+'" width="'+im.w+'" height="'+im.h+'" preserveAspectRatio="none" xlink:href="'+url+'"/>');stats.bitmaps++;return id}
  // the image's unit square → device parallelogram T = [ux,uy,vx,vy,ox,oy]
  function place(im,T,op,C){if(!T.every(isFinite))return;flush();sync(C||eff());const id=imgId(im);body.push('<use xlink:href="#'+id+'" transform="matrix('+[T[0]/im.w,T[1]/im.w,T[2]/im.h,T[3]/im.h,T[4],T[5]].map(fw).join(' ')+')"'+(op>0&&op<1?' opacity="'+fw(op)+'"':'')+'/>')}
  const crop=(im,sx,sy,sw,sh)=>{if(!im.px)return im;sx=Math.max(0,sx|0);sy=Math.max(0,sy|0);sw=Math.min(im.w-sx,sw|0);sh=Math.min(im.h-sy,sh|0);if(sw<=0||sh<=0||sx===0&&sy===0&&sw===im.w&&sh===im.h)return im;
    const px=new Uint8ClampedArray(sw*sh*4);for(let y=0;y<sh;y++)px.set(im.px.subarray(((sy+y)*im.w+sx)*4,((sy+y)*im.w+sx+sw)*4),y*sw*4);return{w:sw,h:sh,px,a:im.a}};
  const recolor=(im,fn)=>{const px=new Uint8ClampedArray(im.px);let a=false;for(let i=0;i<px.length;i+=4){fn(px,i);if(px[i+3]<255)a=true}return{w:im.w,h:im.h,px,a}};
  // a lone AND blit leaves the destination where the source is white, a lone OR / XOR one where it is black
  const alone=(im,r)=>recolor(im,r===0x88?(p,i)=>{if(white(p,i))p[i+3]=0}:(p,i)=>{if(black(p,i))p[i+3]=0});
  const white=(p,i)=>p[i]>=0xf0&&p[i+1]>=0xf0&&p[i+2]>=0xf0,black=(p,i)=>p[i]<16&&p[i+1]<16&&p[i+2]<16;
  // a bitmap blit: logical origin (x,y) with edge vectors U (along the image width) and V (along its height); src = [sx,sy,sw,sh]
  // in top-down pixels; rop = ternary raster operation. SRCAND then SRCPAINT on the same spot is the classic transparent sprite.
  function blt(x,y,ux,uy,vx,vy,im,src,rop,o={}){if(!im)return;stats.blits++;const M=mat(),T=[M[0]*ux+M[2]*uy,M[1]*ux+M[3]*uy,M[0]*vx+M[2]*vy,M[1]*vx+M[3]*vy,M[0]*x+M[2]*y+M[4],M[1]*x+M[3]*y+M[5]];
    if(src)im=crop(im,...src);const key=T.map(v=>Math.round(v*4)).join(),r=rop>>>16&255;
    if(im.url){pre();place(im,T,1);return}
    if(o.key!=null){const k=o.key;im=recolor(im,(p,i)=>{if(p[i]===(k&255)&&p[i+1]===(k>>8&255)&&p[i+2]===(k>>16&255))p[i+3]=0})}
    if(r===0x88||r===0xee||r===0x66){const m=mask;mask=null;
      if(m&&m.key===key&&m.r!==r&&m.src.w===im.w&&m.src.h===im.h){const s=m.src.px;// mask then image: (dst AND m) OR i, or (dst OR m) AND i
        place(recolor(im,m.r===0x88?(p,i)=>{if(white(s,i)&&black(p,i))p[i+3]=0}:(p,i)=>{if(black(s,i)&&white(p,i))p[i+3]=0}),T,1);return}
      if(m)place(alone(m.src,m.r),m.T,1);mask={src:im,T,key,r};return}
    pre();if(r===0x33)im=recolor(im,(p,i)=>{p[i]^=255;p[i+1]^=255;p[i+2]^=255});place(im,T,o.alpha==null?1:o.alpha)}
  function patBlt(x,y,w,h,rop){const r=rop>>>16&255;if(r===0xaa||r===0x55||r===0x5a)return;const p=rectP(Math.min(x,x+w),Math.min(y,y+h),Math.max(x,x+w),Math.max(y,y+h));
    if(r===0)fillWith(p,'#000',2);else if(r===0xff)fillWith(p,'#fff',2);else{const keep=dc.pfm;dc.pfm=2;draw(p,true,false);dc.pfm=keep}}
  G.patBlt=patBlt;G.dib=dib;
  G.finish=()=>{pre();flush();sync(null);return{body:body.join(''),defs:defs.join('')}};
  return G}

// ---------- EMF ----------
const EMR={1:'HEADER',2:'POLYBEZIER',3:'POLYGON',4:'POLYLINE',5:'POLYBEZIERTO',6:'POLYLINETO',7:'POLYPOLYLINE',8:'POLYPOLYGON',9:'SETWINDOWEXTEX',10:'SETWINDOWORGEX',11:'SETVIEWPORTEXTEX',12:'SETVIEWPORTORGEX',13:'SETBRUSHORGEX',14:'EOF',15:'SETPIXELV',16:'SETMAPPERFLAGS',17:'SETMAPMODE',18:'SETBKMODE',19:'SETPOLYFILLMODE',20:'SETROP2',21:'SETSTRETCHBLTMODE',22:'SETTEXTALIGN',23:'SETCOLORADJUSTMENT',24:'SETTEXTCOLOR',25:'SETBKCOLOR',26:'OFFSETCLIPRGN',27:'MOVETOEX',28:'SETMETARGN',29:'EXCLUDECLIPRECT',30:'INTERSECTCLIPRECT',31:'SCALEVIEWPORTEXTEX',32:'SCALEWINDOWEXTEX',33:'SAVEDC',34:'RESTOREDC',35:'SETWORLDTRANSFORM',36:'MODIFYWORLDTRANSFORM',37:'SELECTOBJECT',38:'CREATEPEN',39:'CREATEBRUSHINDIRECT',40:'DELETEOBJECT',41:'ANGLEARC',42:'ELLIPSE',43:'RECTANGLE',44:'ROUNDRECT',45:'ARC',46:'CHORD',47:'PIE',48:'SELECTPALETTE',49:'CREATEPALETTE',50:'SETPALETTEENTRIES',51:'RESIZEPALETTE',52:'REALIZEPALETTE',53:'EXTFLOODFILL',54:'LINETO',55:'ARCTO',56:'POLYDRAW',57:'SETARCDIRECTION',58:'SETMITERLIMIT',59:'BEGINPATH',60:'ENDPATH',61:'CLOSEFIGURE',62:'FILLPATH',63:'STROKEANDFILLPATH',64:'STROKEPATH',65:'FLATTENPATH',66:'WIDENPATH',67:'SELECTCLIPPATH',68:'ABORTPATH',70:'COMMENT',71:'FILLRGN',72:'FRAMERGN',73:'INVERTRGN',74:'PAINTRGN',75:'EXTSELECTCLIPRGN',76:'BITBLT',77:'STRETCHBLT',78:'MASKBLT',79:'PLGBLT',80:'SETDIBITSTODEVICE',81:'STRETCHDIBITS',82:'EXTCREATEFONTINDIRECTW',83:'EXTTEXTOUTA',84:'EXTTEXTOUTW',85:'POLYBEZIER16',86:'POLYGON16',87:'POLYLINE16',88:'POLYBEZIERTO16',89:'POLYLINETO16',90:'POLYPOLYLINE16',91:'POLYPOLYGON16',92:'POLYDRAW16',93:'CREATEMONOBRUSH',94:'CREATEDIBPATTERNBRUSHPT',95:'EXTCREATEPEN',96:'POLYTEXTOUTA',97:'POLYTEXTOUTW',98:'SETICMMODE',99:'CREATECOLORSPACE',100:'SETCOLORSPACE',101:'DELETECOLORSPACE',102:'GLSRECORD',103:'GLSBOUNDEDRECORD',104:'PIXELFORMAT',105:'DRAWESCAPE',106:'EXTESCAPE',108:'SMALLTEXTOUT',109:'FORCEUFIMAPPING',110:'NAMEDESCAPE',111:'COLORCORRECTPALETTE',112:'SETICMPROFILEA',113:'SETICMPROFILEW',114:'ALPHABLEND',115:'SETLAYOUT',116:'TRANSPARENTBLT',118:'GRADIENTFILL',119:'SETLINKEDUFIS',120:'SETTEXTJUSTIFICATION',121:'COLORMATCHTOTARGETW',122:'CREATECOLORSPACEW'};
const IGNORE=new Set([13,16,21,23,48,50,51,52,98,99,100,101,104,109,110,111,112,113,115,119,120,121,122,105,106,102,103]);
const prefix=u=>'m'+fnv(u.subarray(0,Math.min(u.length,4096)),fnv(u.subarray(Math.max(0,u.length-4096)),u.length)).toString(36)+'_';
const grid=m=>{const s=m/20000;return Math.pow(10,-Math.floor(Math.log10(s>0&&isFinite(s)?s:1)))};
function result(g,dev,mmW,mmH,stats){const{body,defs}=g.finish(),F=dev.F,X=v=>nf(Math.round(v*F),F),width=mmW*96/25.4,height=mmH*96/25.4,vb=[dev.x,dev.y,dev.w,dev.h];
  const svg='<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="'+vb.map(X).join(' ')+'" width="'+nf(Math.round(width*100),100)+'" height="'+nf(Math.round(height*100),100)+'" preserveAspectRatio="none" fill="none" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" xml:space="preserve">'+(defs?'<defs>'+defs+'</defs>':'')+body+'</svg>';
  return{svg,width,height,viewBox:vb,stats}}
function playEmf(u,opts){const dv=new DataView(u.buffer,u.byteOffset,u.byteLength),N=u.length,I=o=>o+4<=N?dv.getInt32(o,true):0,U=o=>o+4<=N?dv.getUint32(o,true):0,S=o=>o+2<=N?dv.getInt16(o,true):0,W=o=>o+2<=N?dv.getUint16(o,true):0,Fl=o=>o+4<=N?dv.getFloat32(o,true):0;
  const hs=U(4),b=[I(8),I(12),I(16),I(20)],fr=[I(24),I(28),I(32),I(36)],dcx=I(72),dcy=I(76),mmx=I(80),mmy=I(84),umx=hs>=108?I(100):0,umy=hs>=108?I(104):0;
  // device units per mm: the micrometre size when it agrees with the millimetre one (some writers fill it with junk)
  const ok=(um,mm)=>um>0&&(!(mm>0)||Math.abs(um/1000-mm)<=1+mm*.01),px=dcx>0&&ok(umx,mmx)?dcx/(umx/1000):dcx>0&&mmx>0?dcx/mmx:96/25.4,py=dcy>0&&ok(umy,mmy)?dcy/(umy/1000):dcy>0&&mmy>0?dcy/mmy:96/25.4;
  let x0=fr[0]/100*px,y0=fr[1]/100*py,x1=fr[2]/100*px,y1=fr[3]/100*py,mmW=(fr[2]-fr[0])/100,mmH=(fr[3]-fr[1])/100;
  if(!(x1>x0&&y1>y0)){x0=b[0];y0=b[1];x1=b[2]+1;y1=b[3]+1;mmW=(x1-x0)/px;mmH=(y1-y0)/py}if(!(x1>x0&&y1>y0)){x0=y0=0;x1=y1=100;mmW=mmH=26.46}
  const stats={records:1,unsupported:{},bitmaps:0,blits:0,text:0,emfPlus:null,format:'emf'};
  const dev={x:x0,y:y0,w:x1-x0,h:y1-y0,px,py,F:opts.precision>0?Math.pow(10,opts.precision|0):grid(Math.max(x1-x0,y1-y0)),pfx:opts.idPrefix!=null?String(opts.idPrefix).replace(/[^\w-]/g,''):prefix(u)};
  const g=gdi(dev,opts,stats);let buf=new Float64Array(1024);
  const pts=(o,n,small)=>{if(buf.length<n*2)buf=new Float64Array(n*2);if(small)for(let i=0;i<n;i++){buf[2*i]=S(o+4*i);buf[2*i+1]=S(o+4*i+2)}else for(let i=0;i<n;i++){buf[2*i]=I(o+8*i);buf[2*i+1]=I(o+8*i+4)}return buf};
  const xf=o=>[Fl(o),Fl(o+4),Fl(o+8),Fl(o+12),Fl(o+16),Fl(o+20)];
  const rgn=(o,cb,end)=>{if(cb<32||o+32>end)return[];const n=Math.min(U(o+8),(end-o-32)>>4),r=new Array(n*4);for(let i=0;i<n*4;i++)r[i]=I(o+32+i*4);return r};
  const col=o=>u[o+3]===1?'#000':hex(u[o],u[o+1],u[o+2]);
  const bmp=(o,oB,cB,oBits,cBits,usage,alpha)=>cB?dib(u,o+oB,cB,o+oBits,cBits,usage,alpha):null;
  // EMRTEXT at offset t of the record at o (wide or ANSI characters)
  const etext=(o,t,end,wide)=>{const x=I(t),y=I(t+4),n=Math.min(U(t+8),4096),os=o+U(t+12),opt=U(t+16),rc=[I(t+20),I(t+24),I(t+28),I(t+32)],od=U(t+36);let s='';
    if(wide){for(let i=0;i<n&&os+2*i+2<=end;i++)s+=String.fromCharCode(W(os+2*i))}else for(let i=0;i<n&&os+i<end;i++)s+=CP1252(u[os+i]);
    let dx=null;if(od&&o+od+4*n<=end){dx=new Array(n);const step=opt&0x2000?8:4;for(let i=0;i<n;i++)dx[i]=o+od+i*step+4<=end?I(o+od+i*step):0}
    // glyph indices (ETO_GLYPH_INDEX) can't be mapped back without the font; the classic core fonts keep Apple's standard glyph
    // order, where printable ASCII is glyph + 29, anything else is left out (and counted)
    if(opt&0x10){const f=g.dc.font,ok=f&&/^(arial|times new roman|courier new)/i.test(f.face||'')&&[...s].every(c=>{const k=c.charCodeAt(0);return k>=3&&k<=97});
      stats.glyphIndex=(stats.glyphIndex||0)+1;if(!ok)return;s=s.replace(/[\s\S]/g,c=>String.fromCharCode(c.charCodeAt(0)+29))}g.text(x,y,s,dx,opt,rc)};
  let o=hs>=88&&hs<N?hs:88;
  for(;o+8<=N;){const t=U(o),s=U(o+4),e=o+s;if(s<8||s&3||e>N)break;stats.records++;
    switch(t){
      case 2:case 3:case 4:case 5:case 6:case 85:case 86:case 87:case 88:case 89:{const small=t>80,n=Math.min(U(o+24),(s-28)/(small?4:8)|0),a=pts(o+28,n,small),k=small?t-83:t;
        if(k===2)g.bezier(a,n);else if(k===3)g.polygon(a,n);else if(k===4)g.polyline(a,n);else if(k===5)g.bezierTo(a,n);else g.polylineTo(a,n);break}
      case 7:case 8:case 90:case 91:{const small=t>80,np=U(o+24),tot=U(o+28);if(32+np*4>s)break;const c=[];let sum=0;for(let i=0;i<np;i++){const n=U(o+32+4*i);c.push(n);sum+=n}
        const n=Math.min(tot,sum,(s-32-np*4)/(small?4:8)|0);g.polyPoly(pts(o+32+np*4,n,small),c,t===8||t===91,n);break}
      case 56:case 92:{const small=t===92,n=Math.min(U(o+24),(s-28)/(small?5:9)|0),a=pts(o+28,n,small),ty=u.subarray(o+28+n*(small?4:8),o+28+n*(small?5:9));g.polyDraw(a,ty,n);break}
      case 9:g.winExt(I(o+8),I(o+12));break;case 10:g.winOrg(I(o+8),I(o+12));break;case 11:g.vpExt(I(o+8),I(o+12));break;case 12:g.vpOrg(I(o+8),I(o+12));break;
      case 14:o=N;continue;
      case 15:g.pixel(I(o+8),I(o+12),col(o+16));break;
      case 17:g.setMapMode(U(o+8));break;case 18:g.set('bk',U(o+8));break;case 19:g.set('pfm',U(o+8));break;case 20:g.set('rop',U(o+8));break;case 22:g.set('ta',U(o+8));break;
      case 24:g.set('tc',col(o+8));break;case 25:g.set('bc',col(o+8));break;
      case 26:g.offsetClip(I(o+8),I(o+12));break;case 27:g.moveTo(I(o+8),I(o+12));break;case 28:g.setMetaRgn();break;
      case 29:g.excludeClip(I(o+8),I(o+12),I(o+16),I(o+20));break;case 30:g.intersectClip(I(o+8),I(o+12),I(o+16),I(o+20));break;
      case 31:g.scaleVp(I(o+8),I(o+12),I(o+16),I(o+20));break;case 32:g.scaleWin(I(o+8),I(o+12),I(o+16),I(o+20));break;
      case 33:g.save();break;case 34:g.restore(I(o+8));break;
      case 35:g.setXf(xf(o+8));break;case 36:g.modXf(xf(o+8),U(o+32));break;
      case 37:g.select(U(o+8));break;case 40:g.del(U(o+8));break;
      case 38:{const st=U(o+12),w=I(o+16);g.obj(U(o+8),g.pen(w>1&&(st&15)>=1&&(st&15)<=4?st&~15:st,Math.abs(w),col(o+24),w>0,null));break}
      case 95:{const st=U(o+28),w=U(o+32),bs=U(o+36),n=Math.min(U(o+48),(s-52)>>2),dash=[];for(let i=0;i<n;i++)dash.push(U(o+52+4*i));
        g.obj(U(o+8),g.pen(bs===1?5:st,w,col(o+40),!!(st&0x10000),dash));break}
      case 39:g.obj(U(o+8),g.brush(U(o+12),col(o+16),U(o+20)));break;
      case 93:case 94:{const im=bmp(o,U(o+16),U(o+20),U(o+24),U(o+28),U(o+12));let c='#808080';
        if(im&&im.px){let r=0,gg=0,bb=0;const n=im.w*im.h;for(let i=0;i<im.px.length;i+=4){r+=im.px[i];gg+=im.px[i+1];bb+=im.px[i+2]}c=hex(r/n|0,gg/n|0,bb/n|0)}g.obj(U(o+8),g.brush(3,c,0,im&&im.px&&im.w*im.h<=4096?im:null));break}
      case 49:g.obj(U(o+8),{t:'pal'});break;
      case 82:{const q=o+12,face=[];for(let i=0;i<32;i++){const c=W(q+28+2*i);if(!c)break;face.push(c)}
        g.obj(U(o+8),{t:'f',h:I(q),w:I(q+4),esc:I(q+8),ori:I(q+12),wt:I(q+16),it:u[q+20],ul:u[q+21],so:u[q+22],cs:u[q+23],face:String.fromCharCode(...face)});break}
      case 41:g.angleArc(I(o+8),I(o+12),U(o+16),Fl(o+20),Fl(o+24));break;
      case 42:g.ellipse(I(o+8),I(o+12),I(o+16),I(o+20));break;case 43:g.rect(I(o+8),I(o+12),I(o+16),I(o+20));break;
      case 44:g.roundRect(I(o+8),I(o+12),I(o+16),I(o+20),I(o+24),I(o+28));break;
      case 45:case 46:case 47:case 55:g.arc({45:'arc',46:'chord',47:'pie',55:'to'}[t],I(o+8),I(o+12),I(o+16),I(o+20),I(o+24),I(o+28),I(o+32),I(o+36));break;
      case 54:g.lineTo(I(o+8),I(o+12));break;
      case 57:g.set('ad',U(o+8));break;
      case 58:{const v=U(o+8),m=v>1e6?Fl(o+8):v;g.set('ml',m>=1&&m<1e4?m:10);break}
      case 59:g.beginPath();break;case 60:g.endPath();break;case 61:g.closeFigure();break;case 62:g.fillPath();break;case 63:g.strokeFillPath();break;case 64:g.strokePath();break;
      case 65:g.flattenPath();break;case 66:g.widenPath();break;case 67:g.selectClipPath(U(o+8));break;case 68:g.abortPath();break;
      case 70:if(U(o+8)>=16&&U(o+12)===0x2b464d45&&!stats.emfPlus&&W(o+16)===0x4001)stats.emfPlus=W(o+18)&1?'dual':'only';break;
      case 71:g.fillRgn(rgn(o+32,U(o+24),e),g.getObj(U(o+28)));break;
      case 72:g.frameRgn(rgn(o+40,U(o+24),e),g.getObj(U(o+28)),I(o+32),I(o+36));break;
      case 74:g.fillRgn(rgn(o+28,U(o+24),e));break;
      case 75:{const cb=U(o+8),m=U(o+12);g.clipRgn(m,cb?rgn(o+16,cb,e):null);break}
      case 76:case 77:case 78:{const x=I(o+24),y=I(o+28),w=I(o+32),h=I(o+36),rop=U(o+40),cB=U(o+88);
        if(!cB){g.patBlt(x,y,w,h,rop);break}const im=bmp(o,U(o+84),cB,U(o+92),U(o+96),U(o+80));let src=null;
        if(im&&t===77)src=[I(o+44),I(o+48),I(o+100),I(o+104)];else if(im)src=[I(o+44),I(o+48),Math.abs(w),Math.abs(h)];
        let m=im;if(t===78&&im&&U(o+116)){const mk=bmp(o,U(o+112),U(o+116),U(o+120),U(o+124),U(o+108));if(mk&&mk.px&&mk.w===im.w&&mk.h===im.h&&im.px){const px=new Uint8ClampedArray(im.px);for(let i=0;i<px.length;i+=4)if(mk.px[i]<128)px[i+3]=0;m={w:im.w,h:im.h,px,a:true}}}
        g.blt(x,y,w,0,0,h,m,src,t===78?0xcc0020:rop);break}
      case 79:{const ax=I(o+24),ay=I(o+28),bx=I(o+32),by=I(o+36),cx=I(o+40),cy=I(o+44),im=bmp(o,U(o+96),U(o+100),U(o+104),U(o+108),U(o+92));
        g.blt(ax,ay,bx-ax,by-ay,cx-ax,cy-ay,im,im?[I(o+48),I(o+52),I(o+56),I(o+60)]:null,0xcc0020);break}
      case 80:{const im=bmp(o,U(o+48),U(o+52),U(o+56),U(o+60),U(o+64)),cw=I(o+40),ch=I(o+44);g.blt(I(o+24),I(o+28),cw,0,0,ch,im,im?[I(o+32),im.h-I(o+36)-ch,cw,ch]:null,0xcc0020);break}
      case 81:{const im=bmp(o,U(o+48),U(o+52),U(o+56),U(o+60),U(o+64)),sx=I(o+32),sy=I(o+36),sw=I(o+40),sh=I(o+44);
        g.blt(I(o+24),I(o+28),I(o+72),0,0,I(o+76),im,im?[sx,im.h-sy-sh,sw,sh]:null,U(o+68));break}
      case 114:case 116:{const af=u[o+43],im=bmp(o,U(o+84),U(o+88),U(o+92),U(o+96),U(o+80),t===114&&af===1);
        g.blt(I(o+24),I(o+28),I(o+32),0,0,I(o+36),im,im?[I(o+44),I(o+48),I(o+100),I(o+104)]:null,0xcc0020,t===114?{alpha:u[o+42]/255}:{key:U(o+40)});break}
      case 83:case 84:etext(o,o+36,e,t===84);break;
      case 96:case 97:{const n=U(o+36);for(let i=0;i<n&&o+40+40*i+40<=e;i++)etext(o,o+40+40*i,e,t===97);break}
      case 108:{const x=I(o+8),y=I(o+12),n=Math.min(U(o+16),4096),opt=U(o+20);let q=o+36,rc=null;if(!(opt&0x100)){rc=[I(q),I(q+4),I(q+8),I(q+12)];q+=16}let str='';
        for(let i=0;i<n;i++){if(opt&0x200){if(q+i<e)str+=CP1252(u[q+i])}else if(q+2*i+2<=e)str+=String.fromCharCode(W(q+2*i))}g.text(x,y,str,null,opt&~0x10,rc);break}
      case 118:{const nv=U(o+24),nt=U(o+28),mode=U(o+32),vs=[];let q=o+36;for(let i=0;i<nv&&q+16<=e;i++,q+=16)vs.push([I(q),I(q+4),u[q+9],u[q+11],u[q+13]]);
        const idx=[];const k=mode===2?3:2;for(let i=0;i<nt*k&&q+4<=e;i++,q+=4)idx.push(U(q));g.gradient(vs,mode,idx);break}
      case 1:break;
      default:if(!IGNORE.has(t)){const nm=EMR[t]||'0x'+t.toString(16);stats.unsupported[nm]=(stats.unsupported[nm]||0)+1}}
    o=e}
  return result(g,dev,mmW,mmH,stats)}
// Windows-1252 bytes → characters (ANSI text in EXTTEXTOUTA, WMF TEXTOUT and font names)
const W1252='€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ';
const CP1252=c=>c>=0x80&&c<0xa0?W1252[c-0x80]:String.fromCharCode(c);

// ---------- WMF ----------
const WMR={0x0201:'SETBKCOLOR',0x0102:'SETBKMODE',0x0103:'SETMAPMODE',0x0104:'SETROP2',0x0106:'SETPOLYFILLMODE',0x0209:'SETTEXTCOLOR',0x020b:'SETWINDOWORG',0x020c:'SETWINDOWEXT',0x0213:'LINETO',0x0214:'MOVETO',0x0418:'ELLIPSE',0x041b:'RECTANGLE',0x0324:'POLYGON',0x0325:'POLYLINE',0x0538:'POLYPOLYGON',0x0a32:'EXTTEXTOUT',0x0521:'TEXTOUT',0x0419:'FLOODFILL',0x0548:'EXTFLOODFILL',0x012a:'INVERTREGION',0x0922:'BITBLT',0x0b23:'STRETCHBLT',0x0626:'ESCAPE',0x0436:'ANIMATEPALETTE'};
function playWmf(u,opts){const dv=new DataView(u.buffer,u.byteOffset,u.byteLength),N=u.length,S=o=>o+2<=N?dv.getInt16(o,true):0,W=o=>o+2<=N?dv.getUint16(o,true):0,U=o=>o+4<=N?dv.getUint32(o,true):0;
  const placeable=U(0)===0x9ac6cdd7,h0=placeable?22:0;let inch=placeable?W(14)||1440:1440,bx0=S(6),by0=S(8),bx1=S(10),by1=S(12);
  // an EMF carried in MFCOMMENT escapes (Office writes WMF + EMF copies): play that instead, it is the better picture
  {let parts=[],o=h0+W(h0+2)*2;for(let guard=0;o+6<=N&&guard<1e6;guard++){const sz=U(o)*2,fn=W(o+4);if(sz<6||o+sz>N)break;
    if(fn===0x0626&&W(o+6)===0x000f&&U(o+10)===0x43464d57&&U(o+14)===1){const cur=U(o+32),len=Math.min(cur,sz-44);parts.push(u.subarray(o+44,o+44+len))}if(!fn)break;o+=sz}
   if(parts.length){const tot=parts.reduce((a,p)=>a+p.length,0),e=new Uint8Array(tot);let k=0;for(const p of parts){e.set(p,k);k+=p.length}if(isEmf(e)){const r=playEmf(e,opts);r.stats.format='wmf+emf';return r}}}
  // the picture: the placeable header's box, else the first window origin/extent
  let wx=0,wy=0,ww=0,wh=0;if(!placeable||bx1===bx0||by1===by0){let o=h0+W(h0+2)*2;for(let guard=0;o+6<=N&&guard<1e6;guard++){const sz=U(o)*2,fn=W(o+4);if(sz<6)break;
      if(fn===0x020b){wy=S(o+6);wx=S(o+8)}else if(fn===0x020c){wh=S(o+6);ww=S(o+8);break}if(!fn)break;o+=sz}
    bx0=wx;by0=wy;bx1=wx+(ww||1000);by1=wy+(wh||1000);if(!placeable)inch=1440}
  const x0=Math.min(bx0,bx1),y0=Math.min(by0,by1),w=Math.abs(bx1-bx0)||1,h=Math.abs(by1-by0)||1,ppm=inch/25.4;
  const stats={records:0,unsupported:{},bitmaps:0,blits:0,text:0,emfPlus:null,format:'wmf'};
  const dev={x:x0,y:y0,w,h,px:ppm,py:ppm,wmf:true,F:opts.precision>0?Math.pow(10,opts.precision|0):grid(Math.max(w,h)),pfx:opts.idPrefix!=null?String(opts.idPrefix).replace(/[^\w-]/g,''):prefix(u)};
  const g=gdi(dev,opts,stats),col=o=>hex(u[o],u[o+1],u[o+2]);
  const pts=(o,n)=>{const a=new Float64Array(n*2);for(let i=0;i<n;i++){a[2*i]=S(o+4*i);a[2*i+1]=S(o+4*i+2)}return a};
  const str=(o,n)=>{let s='';for(let i=0;i<n&&o+i<N;i++){if(!u[o+i]&&i===n-1)break;s+=CP1252(u[o+i])}return s};
  const add=ob=>{const i=g.freeSlot();g.obj(i,ob)};
  const dibAt=(o,e,usage)=>dib(u,o,Math.max(0,e-o),o+dibBits(o,usage),Math.max(0,e-o-dibBits(o,usage)),usage);
  const dibBits=(o,usage)=>{const hs=U(o);if(hs===12){const bpp=W(o+10);return 12+(bpp<=8?(1<<bpp)*3:0)}const bpp=W(o+14),c=U(o+16),used=U(o+32);return hs+(c===3?12:0)+(bpp<=8?(used||1<<bpp)*(usage===1?2:4):0)};
  let o=h0+W(h0+2)*2;
  for(let guard=0;o+6<=N&&guard<5e6;guard++){const sz=U(o)*2,fn=W(o+4),e=o+sz,p=o+6;if(sz<6||e>N)break;stats.records++;
    switch(fn){
      case 0:o=N;continue;
      case 0x0201:g.set('bc',col(p));break;case 0x0209:g.set('tc',col(p));break;case 0x0102:g.set('bk',W(p));break;case 0x0103:g.setMapMode(W(p));break;
      case 0x0104:g.set('rop',W(p));break;case 0x0106:g.set('pfm',W(p));break;case 0x012e:g.set('ta',W(p));break;
      case 0x020b:g.winOrg(S(p+2),S(p));break;case 0x020c:g.winExt(S(p+2),S(p));break;case 0x020d:g.vpOrg(S(p+2),S(p));break;case 0x020e:g.vpExt(S(p+2),S(p));break;
      case 0x020f:g.offWin(S(p+2),S(p));break;case 0x0211:g.offVp(S(p+2),S(p));break;
      case 0x0410:g.scaleWin(S(p+6),S(p+4),S(p+2),S(p));break;case 0x0412:g.scaleVp(S(p+6),S(p+4),S(p+2),S(p));break;
      case 0x0213:g.lineTo(S(p+2),S(p));break;case 0x0214:g.moveTo(S(p+2),S(p));break;
      case 0x0415:g.excludeClip(S(p+6),S(p+4),S(p+2),S(p));break;case 0x0416:g.intersectClip(S(p+6),S(p+4),S(p+2),S(p));break;case 0x0220:g.offsetClip(S(p+2),S(p));break;
      case 0x0418:g.ellipse(S(p+6),S(p+4),S(p+2),S(p));break;case 0x041b:g.rect(S(p+6),S(p+4),S(p+2),S(p));break;
      case 0x061c:g.roundRect(S(p+10),S(p+8),S(p+6),S(p+4),S(p+2),S(p));break;
      case 0x0817:case 0x081a:case 0x0830:g.arc({0x0817:'arc',0x081a:'pie',0x0830:'chord'}[fn],S(p+14),S(p+12),S(p+10),S(p+8),S(p+6),S(p+4),S(p+2),S(p));break;
      case 0x041f:g.pixel(S(p+6),S(p+4),col(p));break;
      case 0x001e:g.save();break;case 0x0127:g.restore(S(p));break;
      case 0x0324:case 0x0325:{const n=Math.min(Math.max(0,S(p)),(sz-8)>>2),a=pts(p+2,n);fn===0x0324?g.polygon(a,n):g.polyline(a,n);break}
      case 0x0538:{const np=W(p),c=[];let tot=0;for(let i=0;i<np;i++){c.push(W(p+2+2*i));tot+=c[i]}const q=p+2+2*np,n=Math.max(0,Math.min(tot,(e-q)>>2));g.polyPoly(pts(q,n),c,true,n);break}
      case 0x012d:g.select(W(p));break;case 0x01f0:g.del(W(p));break;
      case 0x02fa:{const st=W(p),wd=S(p+2);add(g.pen(wd>1&&(st&15)>=1&&(st&15)<=4?st&~15:st,Math.abs(wd),col(p+6),wd>0,null));break}
      case 0x02fc:add(g.brush(W(p),col(p+2),W(p+6)));break;
      case 0x02fb:add({t:'f',h:S(p),w:S(p+2),esc:S(p+4),ori:S(p+6),wt:S(p+8),it:u[p+10],ul:u[p+11],so:u[p+12],cs:u[p+13],face:str(p+18,32).replace(/\0.*$/,'')});break;
      case 0x00f7:case 0x01f9:add({t:'pal'});break;
      case 0x0142:{const im=dibAt(p+4,e,W(p+2));let c='#808080';if(im&&im.px){let r=0,gg=0,bb=0;const n=im.w*im.h;for(let i=0;i<im.px.length;i+=4){r+=im.px[i];gg+=im.px[i+1];bb+=im.px[i+2]}c=hex(r/n|0,gg/n|0,bb/n|0)}add(g.brush(3,c,0,im&&im.px&&im.w*im.h<=4096?im:null));break}
      case 0x06ff:add({t:'r',rects:wmfRegion(u,p,e)});break;
      case 0x012c:{const r=g.getObj(W(p));if(r&&r.t==='r')g.clipRgn(5,r.rects);else g.clipRgn(5,null);break}
      case 0x0228:{const r=g.getObj(W(p)),b=g.getObj(W(p+2));if(r&&r.t==='r')g.fillRgn(r.rects,b);break}
      case 0x012b:{const r=g.getObj(W(p));if(r&&r.t==='r')g.fillRgn(r.rects);break}
      case 0x0429:{const r=g.getObj(W(p)),b=g.getObj(W(p+2));if(r&&r.t==='r')g.frameRgn(r.rects,b,S(p+6),S(p+4));break}
      case 0x0521:{const n=Math.max(0,S(p)),q=p+2+((n+1)&~1);g.text(S(q+2),S(q),str(p+2,n),null,0,null);break}
      case 0x0a32:{const y=S(p),x=S(p+2),n=Math.max(0,S(p+4)),opt=W(p+6);let q=p+8,rc=null;if(opt&6){rc=[S(q),S(q+2),S(q+4),S(q+6)];q+=8}const s=str(q,n);q+=(n+1)&~1;
        let dx=null;if(q+2*n<=e&&n){dx=[];for(let i=0;i<n;i++)dx.push(S(q+2*i))}g.text(x,y,s,dx,opt,rc);break}
      case 0x061d:g.patBlt(S(p+10),S(p+8),S(p+6),S(p+4),U(p));break;
      case 0x0940:{const rop=U(p),noBmp=sz===24;if(noBmp){g.patBlt(S(p+16),S(p+14),S(p+12),S(p+10),rop);break}const im=dibAt(p+16,e,0);g.blt(S(p+14),S(p+12),S(p+10),0,0,S(p+8),im,im?[S(p+6),S(p+4),S(p+10),S(p+8)]:null,rop);break}
      case 0x0b41:{const rop=U(p),noBmp=sz===28;if(noBmp){g.patBlt(S(p+20),S(p+18),S(p+16),S(p+14),rop);break}const im=dibAt(p+20,e,0);g.blt(S(p+18),S(p+16),S(p+14),0,0,S(p+12),im,im?[S(p+10),S(p+8),S(p+6),S(p+4)]:null,rop);break}
      case 0x0f43:{const rop=U(p),im=dibAt(p+22,e,W(p+4)),sh=S(p+6),sw=S(p+8),sy=S(p+10),sx=S(p+12);g.blt(S(p+20),S(p+18),S(p+16),0,0,S(p+14),im,im?[sx,im.h-sy-sh,sw,sh]:null,rop);break}
      case 0x0d33:{const im=dibAt(p+18,e,W(p)),hh=S(p+10),ww=S(p+12);g.blt(S(p+16),S(p+14),ww,0,0,hh,im,im?[S(p+8),im.h-S(p+6)-hh,ww,hh]:null,0xcc0020);break}
      case 0x0107:case 0x0105:case 0x0108:case 0x020a:case 0x0231:case 0x0234:case 0x0035:case 0x0037:case 0x0139:case 0x0149:case 0x0626:break;
      default:{const nm=WMR[fn]||'0x'+fn.toString(16);stats.unsupported[nm]=(stats.unsupported[nm]||0)+1}}
    o=e}
  return result(g,dev,w/ppm,h/ppm,stats)}
// WMF Region object → device-free rectangle list (scans of x pairs); a missing scan list gives the bounding box
function wmfRegion(u,p,e){const dv=new DataView(u.buffer,u.byteOffset,u.byteLength),S=o=>o+2<=e?dv.getInt16(o,true):0;const n=S(p+10),r=[];let q=p+22;
  for(let i=0;i<n&&q+6<=e;i++){const c=Math.max(0,S(q)),t=S(q+2),b=S(q+4);for(let j=0;j<c>>1;j++)r.push(S(q+6+4*j),t,S(q+8+4*j),b);q+=6+c*2+2}
  if(!r.length)r.push(S(p+14),S(p+16),S(p+18),S(p+20));return r}

// Emf.toSvg(bytes, opts) → {svg, width, height (CSS px at 96 dpi, from the frame), viewBox:[x,y,w,h] in device units, stats}.
// opts: png(rgba,w,h) → data URL (default: a canvas in browsers, BMP otherwise; false forces BMP), hairline (device units for
// 1-pixel cosmetic pens, default 1), precision (decimals; default adapts to the picture size), idPrefix (ids are unique per picture).
function toSvg(bytes,opts={}){const u=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes.buffer||bytes);
  if(isEmf(u))return playEmf(u,opts||{});if(isWmf(u))return playWmf(u,opts||{});throw Error('Not an EMF or WMF picture.')}
// the SVG as a data: URL for <img> / SVG <image> (UTF-8 safe)
const svgDataUrl=svg=>'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
return{toSvg,isEmf,isWmf,svgDataUrl,_:{dib,nf,esc,txt,symText,family,bmpUrl}};
})();
if(typeof module!=='undefined')module.exports=Emf;
