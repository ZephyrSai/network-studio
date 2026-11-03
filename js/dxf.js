// AutoCAD export: one sheet of the flattened drawing (the IR VsdxWriter takes: inches, origin top-left, Y down) as an
// AutoCAD 2004 (AC1018) ASCII DXF in millimetres with Y up. Layers keep their names, visibility, lock and print flags;
// outlines are LWPOLYLINEs with true colour, line weight and dash pattern; fills are solid HATCHes (icons keep their
// cut-outs) drawn under their outlines; each device drawing becomes a block (identical symbols share one) inserted on
// its layer; labels are Arial MTEXT; connectors get the editor's arrow heads; a 'Page frame' layer holds the sheet
// border. A DXF cannot hold pictures: they are counted (and outlined) instead. Plain ASCII out, no dependencies;
// a classic browser script and a Node module.
//   const {dxf, skipped:{images}} = DxfWriter.build(ir, {page:0});   // opts: page, blocks:false, imageFrames:false
const DxfWriter=(()=>{'use strict';
const VERSION='1.0.0',MM=25.4,PXI=1/96;
// AutoCAD text height is the capital height (Arial's is .716 em); the editor sets lines 1.25 em apart, AutoCAD's
// spacing 1.0 is 5/3 of the text height
const CAP=.716,SPACING=1.25/(5/3*CAP);
const LWS=[0,5,9,13,15,18,20,25,30,35,40,50,53,60,70,80,90,100,106,120,140,158,200,211];
const LTYPES=[['DASHED','Dashed __ __ __',[2,-1.2]],['DOT','Dotted . . . .',[.4,-.8]],['DASHDOT','Dash dot __ . __ .',[2,-.8,.4,-.8]]];
const BAD=/[<>\/\\":;?*|=`,\u0000-\u001f\u007f]/g;
const DIMVARS=('3:,4:,40:1.0,41:2.5,42:0.625,43:3.75,44:1.25,45:0.0,46:0.0,47:0.0,48:0.0,140:2.5,141:2.5,142:0.0,143:0.03937007874,144:1.0,145:0.0,146:1.0,147:0.625,148:0.0,'+
  '71:0,72:0,73:0,74:0,75:0,76:0,77:1,78:8,79:3,170:0,171:3,172:1,173:0,174:0,175:0,176:0,177:0,178:0,179:2,271:2,272:2,273:2,274:3,275:0,276:0,277:2,278:44,279:0,'+
  '280:0,281:0,282:0,283:0,284:8,285:0,286:0,288:0,289:3,371:-2,372:-2').split(',').map(s=>s.split(':'));
const fin=(v,d)=>{v=Number(v);return Number.isFinite(v)?v:d};
// a DXF real: fixed point (no exponent, never NaN), at least one decimal
const num=v=>{v=Math.max(-1e12,Math.min(1e12,fin(v,0)));return(Math.abs(v)<5e-7?0:v).toFixed(6).replace(/0+$/,'').replace(/\.$/,'.0')};
const P=(c,v)=>(c<10?'  ':c<100?' ':'')+c+'\r\n'+v;
// \U+XXXX has four digits: past U+FFFF (emoji) and lone surrogates go as '?'
const uni=c=>c>0xFFFF||c>=0xD800&&c<0xE000?'?':'\\U+'+c.toString(16).toUpperCase().padStart(4,'0');
// a name or plain value: printable ASCII as is, the rest as \U+XXXX (the file says code page 1252; AutoCAD decodes these)
const enc=s=>{let o='';for(const ch of String(s??'')){const c=ch.codePointAt(0);o+=c<32||c===127?'':c>126?uni(c):ch}return o};
// MTEXT content as tokens, so cutting it into 250-character chunks never splits an escape: line breaks become \P,
// \ { } are escaped, ^ goes as '^ ' (AutoCAD's caret notation), everything past ASCII as \U+XXXX, and an empty group
// parts each %% so it is never read as a symbol code (%%c, %%d, %%p: Ø ° ±; readers decode \U+0025 before they look)
function mtextTokens(s){const a=Array.from(String(s??'').replace(/\r\n?/g,'\n')),out=[];
  for(let i=0;i<a.length;i++){const ch=a[i],c=ch.codePointAt(0);if(ch==='\n')out.push('\\P');else if(ch==='\t')out.push(' ');else if(c<32||c===127)continue;else if(ch==='\\'||ch==='{'||ch==='}')out.push('\\'+ch);else if(ch==='^')out.push('^ ');else if(ch==='%'&&a[i+1]==='%')out.push('%{}');else if(c>126)out.push(uni(c));else out.push(ch)}return out}
const NAMED={black:'000000',white:'ffffff',red:'ff0000',green:'008000',blue:'0000ff',gray:'808080',grey:'808080',orange:'ffa500',yellow:'ffff00',silver:'c0c0c0',navy:'000080',teal:'008080',purple:'800080',maroon:'800000'};
// CSS-ish colour -> {r,g,b,a}, or null for none/transparent
function color(v){if(v==null||v===false)return null;let s=String(v).trim().toLowerCase();if(!s||s==='none'||s==='transparent')return null;if(NAMED[s])s='#'+NAMED[s];
  let m=/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);if(m){let x=m[1];if(x.length<5)x=[...x].map(c=>c+c).join('');return{r:parseInt(x.slice(0,2),16),g:parseInt(x.slice(2,4),16),b:parseInt(x.slice(4,6),16),a:x.length>6?parseInt(x.slice(6),16)/255:1}}
  m=/^rgba?\(([^)]*)\)$/.exec(s);if(m){const p=m[1].split(/[\s,/]+/).filter(Boolean),ch=t=>Math.max(0,Math.min(255,Math.round(fin(parseFloat(t)*(String(t).endsWith('%')?2.55:1),0))));return{r:ch(p[0]),g:ch(p[1]),b:ch(p[2]),a:p[3]==null?1:Math.max(0,Math.min(1,fin(parseFloat(p[3])/(p[3].endsWith('%')?100:1),1)))}}
  return{r:0,g:0,b:0,a:1}}
// AutoCAD's 256-colour index, for readers that ignore true colour (420): basic colours, the 24 hues x 5 shades x 2, greys
const ACI=(()=>{const t=[[1,255,0,0],[2,255,255,0],[3,0,255,0],[4,0,255,255],[5,0,0,255],[6,255,0,255],[7,0,0,0],[7,255,255,255],[8,128,128,128],[9,192,192,192]];
  for(let i=10;i<250;i++){const h=Math.floor((i-10)/10)*15,v=[255,165,127,76,38][(i%10)>>1],s=i%2?.5:1,f=n=>{const k=(n+h/60)%6;return Math.round(v-v*s*Math.max(0,Math.min(k,4-k,1)))};t.push([i,f(5),f(3),f(1)])}
  [51,80,105,130,190,255].forEach((v,j)=>t.push([250+j,v,v,v]));return t})();
const aciCache=new Map();
const aci=c=>{const k=c.r<<16|c.g<<8|c.b;let best=aciCache.get(k);if(best)return best;let bd=Infinity;for(const[i,r,g,b]of ACI){const d=(r-c.r)**2+(g-c.g)**2+(b-c.b)**2;if(d<bd){bd=d;best=i}}aciCache.set(k,best);return best};
// nearest standard line weight (hundredths of a millimetre) for a width in millimetres
const lwOf=mm=>{const v=mm*100;let best=0;for(const w of LWS)if(Math.abs(w-v)<Math.abs(best-v))best=w;return best};
// IR dash (0 solid, 1 dash, 2 dot, 3 dash-dot, or a word) -> linetype name, null for solid
const dashOf=d=>{if(d==null||d===false||d===0)return null;if(d===true)return'DASHED';if(typeof d==='number')return[null,'DASHED','DOT','DASHDOT'][Math.round(d)]||null;const s=String(d).toLowerCase();if(/^\d+$/.test(s))return dashOf(+s);return s.includes('dot')?(s.includes('dash')?'DASHDOT':'DOT'):s.includes('dash')?'DASHED':null};
const circ=(cx,cy,r)=>Array.from({length:20},(_,i)=>[cx+r*Math.cos(i*Math.PI/10),cy+r*Math.sin(i*Math.PI/10)]);
// connector ends as the editor draws its markers, in marker units (7/12 of the line width, x out of the line end);
// trim pulls the line back under the head so a wide line does not poke through the tip
const HEADS={arrow:{fill:[[1,0],[-7,-4],[-7,4]],trim:3},diamond:{fill:[[0,0],[-4,-3],[-8,0],[-4,3]],trim:4},dot:{fill:circ(-2,0,3.2),trim:2},
  circle:{line:circ(-3,0,3),closed:true,w:1.3,trim:6},openArrow:{line:[[-7,-4],[0,0],[-7,4]],w:1.4,trim:0},bar:{line:[[-1,-4.5],[-1,4.5]],w:1.6,trim:0},
  openTriangle:{line:[[1,0],[-7,-4],[-7,4]],closed:true,w:1.4,trim:7},openDiamond:{line:[[0,0],[-4,-3],[-8,0],[-4,3]],closed:true,w:1.4,trim:8}};
const ALIAS={filledarrow:'arrow',triangle:'arrow',classic:'arrow',block:'arrow',filledcircle:'dot',oval:'dot',opencircle:'circle',tee:'bar',dash:'bar',open:'openArrow',openarrow:'openArrow',opentriangle:'openTriangle',opendiamond:'openDiamond'};
const headOf=a=>{if(!a||a==='none')return null;const k=String(a).replace(/[\s_-]/g,'');return HEADS[k]||HEADS[ALIAS[k.toLowerCase()]]||null};
// rough Arial advance widths in em, enough to size MTEXT boxes and label backgrounds
const em=ch=>' ijlI.,:;|!\'`'.includes(ch)?.27:'ftr()[]-/'.includes(ch)?.34:'mwMW@%'.includes(ch)?.86:ch>='A'&&ch<='Z'?.68:ch>='0'&&ch<='9'?.556:ch.codePointAt(0)>=0x2E80?1:.54;
// a label's lines: the editor's wrapped lines when given, else the text split at line breaks
const textLines=s=>Array.isArray(s.lines)&&s.lines.length?s.lines.map(l=>String(l??'').replace(/[\r\n]+/g,' ')):String(s.text??'').replace(/\r\n?/g,'\n').split('\n');
const widthEm=lines=>Math.max(0,...lines.map(l=>Array.from(l).reduce((s,ch)=>s+em(ch),0)));
const pts2=a=>{const o=[];for(const p of Array.isArray(a)?a:[]){const x=fin(Array.isArray(p)?p[0]:p?.x,NaN),y=fin(Array.isArray(p)?p[1]:p?.y,NaN);if(Number.isFinite(x)&&Number.isFinite(y))o.push([x,y])}return o};
// drop repeated vertices (and a closing copy of the first) so no two printed vertices coincide
const dedupe=(a,closed)=>{const o=[];for(const p of a){const l=o[o.length-1];if(!l||Math.abs(l[0]-p[0])>1e-5||Math.abs(l[1]-p[1])>1e-5)o.push(p)}if(closed&&o.length>1){const f=o[0],l=o[o.length-1];if(Math.abs(f[0]-l[0])<=1e-5&&Math.abs(f[1]-l[1])<=1e-5)o.pop()}return o};
const area=a=>{let s=0;for(let i=0,j=a.length-1;i<a.length;j=i++)s+=(a[j][0]-a[i][0])*(a[j][1]+a[i][1]);return s/2};
const inPoly=(p,a)=>{let c=false;for(let i=0,j=a.length-1;i<a.length;j=i++){const[xi,yi]=a[i],[xj,yj]=a[j];if((yi>p[1])!==(yj>p[1])&&p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi)c=!c}return c};
const bbox=a=>{let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;for(const[x,y]of a){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y}return{x0,y0,x1,y1}};
// loop a lies inside loop b: inside its box and most sampled corners inside it (touching outlines still count)
const within=(a,b)=>{const A=a.bb||(a.bb=bbox(a)),B=b.bb||(b.bb=bbox(b)),e=1e-3;if(a===b||A.x0<B.x0-e||A.y0<B.y0-e||A.x1>B.x1+e||A.y1>B.y1+e)return false;const n=Math.min(a.length,9);let k=0;for(let i=0;i<n;i++)if(inPoly(a[Math.floor(i*a.length/n)],b))k++;return k>=Math.ceil(n*.7)};
// the point a fraction f along a polyline
const along=(pts,f)=>{let tot=0;for(let i=1;i<pts.length;i++)tot+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);let d=tot*f;for(let i=1;i<pts.length;i++){const L=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(L>=d&&L>0){const t=d/L;return[pts[i-1][0]+(pts[i][0]-pts[i-1][0])*t,pts[i-1][1]+(pts[i][1]-pts[i-1][1])*t]}d-=L}return pts[pts.length-1]};
const unit=v=>Math.max(0,Math.min(1,fin(v,1)));
// trim a polyline end back by d (walking over short segments: a flattened curve), never to nothing
const trim=(l,end,d)=>{if(end)l.reverse();while(l.length>2&&d>0){const L=Math.hypot(l[1][0]-l[0][0],l[1][1]-l[0][1]);if(L>d)break;d-=L;l.shift()}const L=Math.hypot(l[1][0]-l[0][0],l[1][1]-l[0][1]);if(L>1e-9&&d>0){const t=Math.min(d,L*.9)/L;l[0]=[l[0][0]+(l[1][0]-l[0][0])*t,l[0][1]+(l[1][1]-l[0][1])*t]}if(end)l.reverse()};
// a polyline moved sideways by d (to the left of travel), corners mitred (capped at 4d): one rail of a double line
const offset=(a,d)=>{const nr=(p,q)=>{const L=Math.hypot(q[0]-p[0],q[1]-p[1])||1;return[-(q[1]-p[1])/L,(q[0]-p[0])/L]};return a.map((p,i)=>{const n1=nr(a[Math.max(0,i-1)],a[Math.max(1,i)]),n2=nr(a[Math.min(i,a.length-2)],a[Math.min(i+1,a.length-1)]);let nx=n1[0]+n2[0],ny=n1[1]+n2[1];const L=Math.hypot(nx,ny);if(L<1e-9){nx=n2[0];ny=n2[1]}else{nx/=L;ny/=L}const k=Math.min(4,1/Math.max(.25,nx*n1[0]+ny*n1[1]));return[p[0]+nx*d*k,p[1]+ny*d*k]})};
// a table name AutoCAD accepts: illegal characters, and those \U+XXXX cannot carry (past U+FFFF, lone surrogates), as _;
// cut whole characters to at most 240 once encoded. Encoding the result is one-to-one, so names unique here stay unique
const cleanName=(s,dflt)=>{let o='',n=0;for(const ch of String(s??'').replace(BAD,'_').replace(/\s+/g,' ').trim().replace(/^\*+/,'')){const c=ch.codePointAt(0),bad=c>0xFFFF||c>=0xD800&&c<0xE000,l=c>126&&!bad?7:1;if(n+l>240)break;o+=bad?'_':ch;n+=l}return o.trim()||dflt};

// the point where segments ab and cd cross (not at their ends), or null
const crossAt=(a,b,c,d)=>{const rx=b[0]-a[0],ry=b[1]-a[1],sx=d[0]-c[0],sy=d[1]-c[1],den=rx*sy-ry*sx;if(Math.abs(den)<1e-12)return null;const qx=c[0]-a[0],qy=c[1]-a[1],t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;return t>1e-9&&t<1-1e-9&&u>1e-9&&u<1-1e-9?[a[0]+t*rx,a[1]+t*ry]:null};
// a loop that crosses itself (a valve's bow tie) cut at its crossings into simple loops, each with its own winding, as
// a fill sees them; edges are swept by x so a long flattened curve stays cheap (bounded: n.left cuts at most)
function untangle(p,n={left:64}){const k=p.length;if(k<4||k>4000||n.left<=0)return[p];const E=[];
  for(let i=0;i<k;i++){const a=p[i],b=p[(i+1)%k];E.push({i,x0:Math.min(a[0],b[0]),x1:Math.max(a[0],b[0]),y0:Math.min(a[1],b[1]),y1:Math.max(a[1],b[1])})}E.sort((u,v)=>u.x0-v.x0);
  for(let u=0;u<k;u++){const e=E[u];for(let v=u+1;v<k&&E[v].x0<=e.x1;v++){const f=E[v];if(f.y0>e.y1||f.y1<e.y0)continue;const i=Math.min(e.i,f.i),j=Math.max(e.i,f.i);if(j-i<2||i===0&&j===k-1)continue;
    const X=crossAt(p[i],p[i+1],p[j],p[(j+1)%k]);if(X){n.left--;return[...untangle([X,...p.slice(i+1,j+1)],n),...untangle([X,...p.slice(j+1),...p.slice(0,i+1)],n)]}}}return[p]}
// one fill's loops (the subpaths of one element, in any order) as hatches of odd-parity boundary loops. Evenodd is
// odd parity: one hatch of them all. Nonzero: each outermost loop with all nested in it, a nested loop kept as a
// boundary only where the winding around it turns the fill on or off, so holes and islands come out as the editor
// fills them (exact when loops nest or keep apart, as icon outlines do; a loop overlapping another counts as nested
// in the one that holds it)
function fills(loops,evenodd){if(evenodd)return loops.length?[loops]:[];const L=loops.map((p,i)=>{const a=area(p);return{p,i,s:Math.sign(a)||1,A:Math.abs(a)}});
  for(const a of L){let up=null;for(const b of L)if(b!==a&&(b.A>a.A||b.A===a.A&&b.i<a.i)&&(!up||b.A<up.A)&&within(a.p,b.p))up=b;a.up=up}
  const out=new Map();for(const a of[...L].sort((x,y)=>y.A-x.A||x.i-y.i)){const u=a.up;a.w=(u?u.w:0)+a.s;a.f=a.w!==0;a.root=u?u.root:a;if(!u||a.f!==u.f)(out.get(a.root)||out.set(a.root,[]).get(a.root)).push(a)}
  return[...out.entries()].sort((x,y)=>x[0].i-y[0].i).map(([,ls])=>ls.sort((x,y)=>x.i-y.i).map(l=>l.p))}

// A shape's fills and outlines in drawing order (G maps IR points to output millimetres). An open outline is filled as
// if closed, as SVG does (its outline stays open). Consecutive fills of one colour (and part, when the IR numbers the
// element each outline came from) are one compound fill: its subpaths make holes and islands by the fill rule. Each
// hatch goes where the first outline in it was drawn, so a later element's fill still covers an earlier one's outline;
// with parts known, an element's fills all go before its outlines, as SVG paints them.
function plan(s,G,ltOf){const items=[],runs=[];let run=null;
  for(const gm of Array.isArray(s.geoms)?s.geoms:[]){if(!gm)continue;const pts=dedupe(pts2(gm.points).map(q=>G(q[0],q[1])),!!gm.closed);if(pts.length<2)continue;
    const closed=!!gm.closed&&pts.length>2,fc=pts.length>2?color(gm.fill):null,op=fc?unit(gm.fillOpacity)*fc.a:0,sc=color(gm.stroke),wt=fin(gm.weight,.75);
    if(fc&&op>.004){const eo=(gm.fillRule||s.fillRule)==='evenodd',key=[fc.r,fc.g,fc.b,op.toFixed(3),eo,gm.part??''].join();if(!run||run.key!==key){run={key,eo,whole:gm.part!=null,loops:[],slots:new Map(),st:{c:fc,a:op}};runs.push(run)}
      const slot={n:items.length,hs:[]};items.push(slot);for(const l of untangle(pts)){run.loops.push(l);run.slots.set(l,slot)}}
    else run=null;
    if(sc&&wt>0)items.push({l:pts,closed,st:{c:sc,a:sc.a*unit(gm.strokeOpacity),lw:lwOf(wt*MM/72),lt:ltOf(gm)}})}
  for(const r of runs)for(const loops of fills(r.loops,r.eo)){const at=r.whole?r.slots.get(r.loops[0]):loops.map(l=>r.slots.get(l)).reduce((x,y)=>y.n<x.n?y:x);at.hs.push({h:{loops,st:r.st}})}
  return items.flatMap(it=>it.hs?it.hs:[it])}

function build(ir,opts={}){
  const pages=Array.isArray(ir?.pages)?ir.pages:[],page=pages[Math.max(0,Math.min(pages.length-1,Math.floor(fin(opts.page,0))))]||{},W=Math.max(.01,fin(page.width,11)),H=Math.max(.01,fin(page.height,8.5)),Wm=W*MM,Hm=H*MM;
  let seq=0;const nh=()=>(++seq).toString(16).toUpperCase();
  // fixed handles first, so tables, records, blocks and objects can point at each other
  const T={};for(const k of['VPORT','LTYPE','LAYER','STYLE','VIEW','UCS','APPID','DIMSTYLE','BLOCK_RECORD'])T[k]=nh();
  // *Model_Space's record gets handle 1F, as AutoCAD numbers it (LibreDWG and other converters assume so)
  const R={};for(const k of['vport','byBlock','byLayer','cont','std','arial','acad','dim','ps','msB','msE','psB','psE','root','groups','layouts','mlines','plots','psn','normal','mlStd','lModel','lPaper']){if(seq===0x1E)R.ms=nh();R[k]=nh()}
  const LT=LTYPES.map(()=>nh());
  // layers: 0, the sheet border, then the drawing's own (names AutoCAD accepts, unique ignoring case)
  const layers=[{name:'0',h:nh(),color:7},{name:'Page frame',h:nh(),color:8}],seen=new Set(['0','page frame']);
  const lmap=(Array.isArray(page.layers)?page.layers:[]).map(l=>{const base=cleanName(l?.name,'Layer');let n=base;for(let k=2;seen.has(n.toLowerCase());k++)n=base+' '+k;seen.add(n.toLowerCase());layers.push({name:n,h:nh(),color:7,off:l?.visible===false,lock:!!l?.locked,noPlot:l?.print===false});return n});
  // linetypes: the three stock patterns, plus one per exact dash pattern the drawing uses (dashArray, inches)
  const custom=new Map();
  const ltOf=o=>{const d=(Array.isArray(o?.dashArray)?o.dashArray:[]).map(v=>fin(v,NaN)*MM).filter(v=>v>=0);if(!d.some(v=>v>1e-3))return dashOf(o?.dash);
    const pat=(d.length%2?d.concat(d):d).map((v,i)=>i%2?-Math.max(v,.01):v),key=pat.map(v=>v.toFixed(3)).join(' ');let lt=custom.get(key);if(!lt){lt={name:'DASH_'+(custom.size+1),h:nh(),pat};custom.set(key,lt)}return lt.name};
  const layerOf=s=>{const i=Array.isArray(s?.layers)?s.layers[0]:undefined;return lmap[i]??'0'};
  let bx0=0,by0=0,bx1=Wm,by1=Hm,count=0,skipped=0;const bump=(x,y)=>{if(x<bx0)bx0=x;if(x>bx1)bx1=x;if(y<by0)by0=y;if(y>by1)by1=y};
  const MS={a:[],owner:R.ms},blocks=[],blockByKey=new Map(),bnames=new Set();
  const pageT=(x,y)=>[x*MM,(H-y)*MM];
  // shape-local inches -> page millimetres, turned CCW by the shape's angle (degrees) about its centre
  const shapeT=s=>{const x0=fin(s.x,0),y0=fin(s.y,0),w=fin(s.w,0),h=fin(s.h,0),a=fin(s.angle,0)*Math.PI/180,cx=x0+w/2,cy=y0+h/2,c=Math.cos(a),sn=Math.sin(a);return(px,py)=>{const dx=x0+px-cx,dy=y0+py-cy;return pageT(cx+dx*c+dy*sn,cy-dx*sn+dy*c)}};

  const head=(k,type,layer,st={})=>{count++;k.a.push(P(0,type),P(5,nh()),P(330,k.owner),P(100,'AcDbEntity'),P(8,enc(layer)));if(st.lt)k.a.push(P(6,st.lt));if(st.c)k.a.push(P(62,aci(st.c)));if(st.lw!=null)k.a.push(P(370,st.lw));
    if(st.c)k.a.push(P(420,st.c.r<<16|st.c.g<<8|st.c.b));if(st.a!=null&&st.a<.998)k.a.push(P(440,0x2000000|Math.max(0,Math.min(255,Math.round(st.a*255)))))};
  const pline=(k,layer,st,pts,closed)=>{pts=dedupe(pts,closed);if(pts.length<2)return;if(pts.length<3)closed=false;head(k,'LWPOLYLINE',layer,st);k.a.push(P(100,'AcDbPolyline'),P(90,pts.length),P(70,(closed?1:0)|128));for(const q of pts)k.a.push(P(10,num(q[0])),P(20,num(q[1])))};
  const hatch=(k,layer,st,loops)=>{loops=loops.map(l=>dedupe(l,true)).filter(l=>l.length>2&&Math.abs(area(l))>1e-6);if(!loops.length)return;head(k,'HATCH',layer,st);
    k.a.push(P(100,'AcDbHatch'),P(10,'0.0'),P(20,'0.0'),P(30,'0.0'),P(210,'0.0'),P(220,'0.0'),P(230,'1.0'),P(2,'SOLID'),P(70,1),P(71,0),P(91,loops.length));
    loops.forEach((l,i)=>{k.a.push(P(92,i?2:3),P(72,0),P(73,1),P(93,l.length));for(const q of l)k.a.push(P(10,num(q[0])),P(20,num(q[1])));k.a.push(P(97,0))});k.a.push(P(75,0),P(76,1),P(98,0))};
  const mtext=(k,layer,c,o)=>{if(!o.toks.length)return;head(k,'MTEXT',layer,{c,a:c.a});k.a.push(P(100,'AcDbMText'),P(10,num(o.x)),P(20,num(o.y)),P(30,'0.0'),P(40,num(o.ht)),P(41,num(o.w)),P(71,o.att),P(72,1));
    const ch=[];let cur='';for(const t of o.toks){if(cur.length+t.length>250){ch.push(cur);cur=''}cur+=t}ch.push(cur);ch.forEach((s,i)=>k.a.push(P(i<ch.length-1?3:1,s)));
    k.a.push(P(7,'Arial'),P(11,num(Math.cos(o.a))),P(21,num(Math.sin(o.a))),P(31,'0.0'),P(73,2),P(44,num(SPACING)));bump(o.x,o.y)};
  const emit=(k,layer,items)=>{for(const it of items)if(it.h)hatch(k,layer,it.h.st,it.h.loops);else pline(k,layer,it.st,it.l,it.closed)};
  // a label: its box (in T's coordinates) turned by ang + textAngle (CCW) about the box centre; the text sits at the
  // box's middle and the side its alignment names, pad in from the edge
  // bg: a halo box (the editor's label background) inset ix, iy inches from the box, drawn first
  const label=(layer,s,box,T,pad,ang,bg,ix=0,iy=0)=>{const lines=textLines(s);if(!lines.join('').trim())return;let toks=mtextTokens(lines.join('\n'));
    if(s.bold||s.italic||s.underline)toks=['{'+(s.bold||s.italic?`\\fArial|b${s.bold?1:0}|i${s.italic?1:0}|c0|p34;`:'')+(s.underline?'\\L':''),...toks,'}'];
    const c=color(s.textColor)||{r:0,g:0,b:0,a:1},emm=Math.max(.5,fin(s.textSize,9))*MM/72,ht=emm*CAP,al=String(s.align||'center').toLowerCase(),va=String(s.valign||s.verticalAlign||'middle').toLowerCase();
    const hx=al==='left'||al==='start'?0:al==='right'||al==='end'?2:1,vy=va==='top'?0:va==='bottom'?2:1,bw=Math.max(0,fin(box.w,0))*MM,bh=Math.max(0,fin(box.h,0))*MM,px=Math.min(pad*MM,bw/4),py=Math.min(pad*MM,bh/4);
    const o=T(fin(box.x,0)+fin(box.w,0)/2,fin(box.y,0)+fin(box.h,0)/2),a=ang+fin(s.textAngle,0),dx=hx===0?px-bw/2:hx===2?bw/2-px:0,dy=vy===0?bh/2-py:vy===2?py-bh/2:0,rot=(x,y)=>[o[0]+x*Math.cos(a)-y*Math.sin(a),o[1]+x*Math.sin(a)+y*Math.cos(a)];
    if(bg){const hw=Math.max(0,bw/2-ix*MM),hh=Math.max(0,bh/2-iy*MM);hatch(MS,layer,{c:bg,a:bg.a},[[[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]].map(([x,y])=>rot(x,y))])}
    const at=rot(dx,dy);mtext(MS,layer,c,{x:at[0],y:at[1],ht,w:Math.max(bw-2*px,widthEm(lines)*emm*(s.bold?1.08:1)*1.25,ht),att:vy*3+hx+1,a,toks})};

  // a drawn item: its geometry as a block (one per distinct drawing, so twenty identical switches share a symbol)
  // inserted at its centre on its layer, then its label
  const shape=s=>{const layer=layerOf(s),w=fin(s.w,0),h=fin(s.h,0),T=shapeT(s),deg=fin(s.angle,0);for(const[px,py]of[[0,0],[w,0],[w,h],[0,h]])bump(...T(px,py));
    if(Array.isArray(s.geoms)&&s.geoms.length){if(opts.blocks===false)emit(MS,layer,plan(s,T,ltOf));else{const items=plan(s,(px,py)=>[(px-w/2)*MM,(h/2-py)*MM],ltOf);if(items.length){
      const key=JSON.stringify(items,(k,v)=>typeof v==='number'?Math.round(v*1e4)/1e4:v);let b=blockByKey.get(key);
      if(!b){const base=cleanName(s.name,'Shape');let n=base;for(let k=2;bnames.has(n.toLowerCase());k++)n=base+' '+k;bnames.add(n.toLowerCase());b={name:n,h:nh(),b:nh(),e:nh()};b.k={a:[],owner:b.h};emit(b.k,'0',items);blocks.push(b);blockByKey.set(key,b)}
      const c=T(w/2,h/2);head(MS,'INSERT',layer);MS.a.push(P(100,'AcDbBlockReference'),P(2,enc(b.name)),P(10,num(c[0])),P(20,num(c[1])),P(30,'0.0'));if(deg)MS.a.push(P(50,num(deg)))}}}
    // textBg: the halo the editor puts behind a device name (2 px in from the label box), hiding links under it
    if(s.text!=null||s.lines)label(layer,s,s.textBox||{x:0,y:0,w,h},T,4*PXI,deg*Math.PI/180,s.textBox?color(s.textBg):null,2*PXI,PXI)};
  // a text block: its own box (fill, outline) turned with the text
  const textItem=s=>{const layer=layerOf(s),x=fin(s.x,0),y=fin(s.y,0),w=Math.max(0,fin(s.w,0)),h=Math.max(0,fin(s.h,0)),a=fin(s.textAngle,0),o=pageT(x+w/2,y+h/2);
    const box=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py])=>{const p=pageT(px,py),dx=p[0]-o[0],dy=p[1]-o[1];return[o[0]+dx*Math.cos(a)-dy*Math.sin(a),o[1]+dx*Math.sin(a)+dy*Math.cos(a)]});box.forEach(p=>bump(...p));
    const fc=color(s.fill),sc=color(s.stroke),wt=fin(s.weight,.75);if(fc)hatch(MS,layer,{c:fc,a:fc.a*Math.max(0,Math.min(1,fin(s.fillOpacity,1)))},[box]);if(sc&&wt>0)pline(MS,layer,{c:sc,a:sc.a*unit(s.strokeOpacity),lw:lwOf(wt*MM/72),lt:ltOf(s)},box,true);
    label(layer,s,{x,y,w,h},pageT,3*PXI,0)};
  const tip=(layer,c,m,a,b,u)=>{const L=Math.hypot(a[0]-b[0],a[1]-b[1])||1,dx=(a[0]-b[0])/L,dy=(a[1]-b[1])/L,map=q=>[a[0]+(q[0]*dx-q[1]*dy)*u,a[1]+(q[0]*dy+q[1]*dx)*u];
    if(m.fill)hatch(MS,layer,{c,a:c.a},[m.fill.map(map)]);else pline(MS,layer,{c,a:c.a,lw:lwOf(m.w*u)},m.line.map(map),!!m.closed)};
  // a link: the line as drawn (path: curves, line jumps; else its points), pulled back under its heads; a double link
  // as two rails; the heads; then its label on a background box (textBg, white unless null) in textBox, at textPos or halfway
  const connector=s=>{const layer=layerOf(s),ip=dedupe(pts2(s.points),false),drawn=(Array.isArray(s.path)?s.path:[]).map(l=>dedupe(pts2(l).map(q=>pageT(q[0],q[1])),false)).filter(l=>l.length>1),runs=drawn.length?drawn:[ip.map(q=>pageT(q[0],q[1]))];
    if(runs[0].length<2)return;runs.forEach(l=>l.forEach(p=>bump(...p)));
    const c=color(s.stroke)||{r:0,g:0,b:0,a:1},a=c.a*unit(s.strokeOpacity),wt=Math.max(0,fin(s.weight,.75)),wm=wt*MM/72,u=7/12*wm*(s.double?1.6:1),ends=[[headOf(s.beginArrow),0],[headOf(s.endArrow),1]];
    const first=runs[0],last=runs[runs.length-1],tips=[[first[0],first[1]],[last[last.length-1],last[last.length-2]]],lines=runs.map(l=>l.map(p=>p.slice()));
    if(wt>0){for(const[m,e]of ends)if(m&&m.trim)trim(e?lines[lines.length-1]:lines[0],e,m.trim*u);
      for(const l of lines)if(s.double)for(const k of[-1,1])pline(MS,layer,{c,a,lw:lwOf(.775*wm),lt:ltOf(s)},offset(l,k*.9125*wm),false);else pline(MS,layer,{c,a,lw:lwOf(wm),lt:ltOf(s)},l,false);
      ends.forEach(([m,e])=>{if(m)tip(layer,{...c,a},m,tips[e][0],tips[e][1],u)})}
    const tl=textLines(s);if(!tl.join('').trim())return;
    const tp=Array.isArray(s.textPos)&&Number.isFinite(+s.textPos[0])&&Number.isFinite(+s.textPos[1])?[+s.textPos[0],+s.textPos[1]]:ip.length>1?along(ip,.5):(q=>[q[0]/MM,H-q[1]/MM])(along(runs[0],.5)),emi=Math.max(.5,fin(s.textSize,9))/72;
    // textBox (page inches): the editor's own label box; else one sized from the text
    const tw=widthEm(tl)*emi*(s.bold?1.08:1),th=((tl.length-1)*1.25+1.2)*emi,tb=s.textBox,given=tb&&[tb.x,tb.y,tb.w,tb.h].every(v=>Number.isFinite(+v))&&+tb.w>0&&+tb.h>0;
    const box=given?{x:+tb.x,y:+tb.y,w:+tb.w,h:+tb.h}:{x:tp[0]-tw/2-2*PXI,y:tp[1]-th/2-PXI,w:tw+4*PXI,h:th+2*PXI},bg=s.textBg===undefined?{r:255,g:255,b:255,a:1}:color(s.textBg);
    label(layer,{...s,align:'center',valign:'middle',textAngle:0},box,pageT,0,0,bg)};
  // a picture cannot go into a DXF: count it, and leave a dashed crossed frame where it was
  const image=s=>{skipped++;if(opts.imageFrames===false)return;const layer=layerOf(s),x=fin(s.x,0),y=fin(s.y,0),w=fin(s.w,0),h=fin(s.h,0),q=[[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(p=>pageT(p[0],p[1])),st={c:{r:148,g:163,b:184,a:1},lw:lwOf(.18),lt:'DASHED'};
    q.forEach(p=>bump(...p));pline(MS,layer,st,q,true);pline(MS,layer,st,[q[0],q[2]],false);pline(MS,layer,st,[q[1],q[3]],false)};

  pline(MS,'Page frame',{lw:13},[[0,0],[Wm,0],[Wm,Hm],[0,Hm]],true);
  for(const s of Array.isArray(page.shapes)?page.shapes:[]){if(!s||typeof s!=='object')continue;const k=s.kind||'shape';if(k==='connector')connector(s);else if(k==='text')textItem(s);else if(k==='image')image(s);else shape(s)}

  // ---- the file, section by section ----
  const seed=nh(),out=[],add=a=>{for(const x of a)out.push(x)},HV=(name,...p)=>out.push(P(9,name),...p),pt=(x,y,z)=>z==null?[P(10,num(x)),P(20,num(y))]:[P(10,num(x)),P(20,num(y)),P(30,num(z))];
  out.push(P(0,'SECTION'),P(2,'HEADER'));
  HV('$ACADVER',P(1,'AC1018'));HV('$ACADMAINTVER',P(70,0));HV('$DWGCODEPAGE',P(3,'ANSI_1252'));HV('$INSBASE',...pt(0,0,0));HV('$EXTMIN',...pt(bx0,by0,0));HV('$EXTMAX',...pt(bx1,by1,0));HV('$LIMMIN',...pt(0,0));HV('$LIMMAX',...pt(Wm,Hm));
  HV('$ORTHOMODE',P(70,0));HV('$REGENMODE',P(70,1));HV('$FILLMODE',P(70,1));HV('$QTEXTMODE',P(70,0));HV('$MIRRTEXT',P(70,0));HV('$LTSCALE',P(40,'1.0'));HV('$ATTMODE',P(70,1));HV('$TEXTSIZE',P(40,'2.5'));HV('$TEXTSTYLE',P(7,'Arial'));
  HV('$CLAYER',P(8,'0'));HV('$CELTYPE',P(6,'ByLayer'));HV('$CECOLOR',P(62,256));HV('$CELTSCALE',P(40,'1.0'));HV('$DIMSTYLE',P(2,'Standard'));HV('$LUNITS',P(70,2));HV('$LUPREC',P(70,2));HV('$AUNITS',P(70,0));HV('$AUPREC',P(70,0));
  HV('$INSUNITS',P(70,4));HV('$MEASUREMENT',P(70,1));HV('$PSLTSCALE',P(70,1));HV('$LWDISPLAY',P(290,1));HV('$HANDSEED',P(5,seed));
  out.push(P(0,'ENDSEC'),P(0,'SECTION'),P(2,'CLASSES'));
  for(const[n,c]of[['ACDBDICTIONARYWDFLT','AcDbDictionaryWithDefault'],['ACDBPLACEHOLDER','AcDbPlaceHolder'],['LAYOUT','AcDbLayout']])out.push(P(0,'CLASS'),P(1,n),P(2,c),P(3,'ObjectDBX Classes'),P(90,0),P(91,0),P(280,0),P(281,0));
  out.push(P(0,'ENDSEC'),P(0,'SECTION'),P(2,'TABLES'));
  const table=(name,h,n,...x)=>out.push(P(0,'TABLE'),P(2,name),P(5,h),P(330,0),P(100,'AcDbSymbolTable'),P(70,n),...x),endtab=()=>out.push(P(0,'ENDTAB'));
  const rec=(type,h,owner,sub,...x)=>out.push(P(0,type),P(5,h),P(330,owner),P(100,'AcDbSymbolTableRecord'),P(100,sub),...x);
  // opening view: the whole sheet, assuming a 16:10 window
  const ew=bx1-bx0,eh=by1-by0,vh=Math.max(eh,ew/1.6)*1.05;
  table('VPORT',T.VPORT,1);rec('VPORT',R.vport,T.VPORT,'AcDbViewportTableRecord',P(2,'*Active'),P(70,0),P(10,'0.0'),P(20,'0.0'),P(11,'1.0'),P(21,'1.0'),P(12,num(bx0+ew/2)),P(22,num(by0+eh/2)),P(13,'0.0'),P(23,'0.0'),P(14,'10.0'),P(24,'10.0'),P(15,'10.0'),P(25,'10.0'),
    P(16,'0.0'),P(26,'0.0'),P(36,'1.0'),P(17,'0.0'),P(27,'0.0'),P(37,'0.0'),P(40,num(vh)),P(41,'1.6'),P(42,'50.0'),P(43,'0.0'),P(44,'0.0'),P(50,'0.0'),P(51,'0.0'),P(71,0),P(72,1000),P(73,1),P(74,3),P(75,0),P(76,0),P(77,0),P(78,0),P(281,0),P(65,0),P(146,'0.0'));endtab();
  const lt=(h,name,desc,pat)=>rec('LTYPE',h,T.LTYPE,'AcDbLinetypeTableRecord',P(2,name),P(70,0),P(3,desc),P(72,65),P(73,pat.length),P(40,num(pat.reduce((s,v)=>s+Math.abs(v),0))),...pat.flatMap(v=>[P(49,num(v)),P(74,0)]));
  table('LTYPE',T.LTYPE,3+LTYPES.length+custom.size);lt(R.byBlock,'ByBlock','',[]);lt(R.byLayer,'ByLayer','',[]);lt(R.cont,'Continuous','Solid line',[]);LTYPES.forEach(([n,d,p],i)=>lt(LT[i],n,d,p));
  for(const c of custom.values())lt(c.h,c.name,'Dash pattern from the drawing',c.pat);endtab();
  table('LAYER',T.LAYER,layers.length);for(const l of layers)rec('LAYER',l.h,T.LAYER,'AcDbLayerTableRecord',P(2,enc(l.name)),P(70,l.lock?4:0),P(62,l.off?-l.color:l.color),P(6,'Continuous'),...(l.noPlot?[P(290,0)]:[]),P(370,-3),P(390,R.normal));endtab();
  const sty=(h,name,font,...x)=>rec('STYLE',h,T.STYLE,'AcDbTextStyleTableRecord',P(2,name),P(70,0),P(40,'0.0'),P(41,'1.0'),P(50,'0.0'),P(71,0),P(42,'2.5'),P(3,font),P(4,''),...x);
  table('STYLE',T.STYLE,2);sty(R.std,'Standard','txt');sty(R.arial,'Arial','arial.ttf',P(1001,'ACAD'),P(1000,'Arial'),P(1071,34));endtab();
  table('VIEW',T.VIEW,0);endtab();table('UCS',T.UCS,0);endtab();
  table('APPID',T.APPID,1);rec('APPID',R.acad,T.APPID,'AcDbRegAppTableRecord',P(2,'ACAD'),P(70,0));endtab();
  table('DIMSTYLE',T.DIMSTYLE,1,P(100,'AcDbDimStyleTable'));out.push(P(0,'DIMSTYLE'),P(105,R.dim),P(330,T.DIMSTYLE),P(100,'AcDbSymbolTableRecord'),P(100,'AcDbDimStyleTableRecord'),P(2,'Standard'),P(70,0),...DIMVARS.map(([c,v])=>P(+c,v)));endtab();
  table('BLOCK_RECORD',T.BLOCK_RECORD,2+blocks.length);rec('BLOCK_RECORD',R.ms,T.BLOCK_RECORD,'AcDbBlockTableRecord',P(2,'*Model_Space'),P(340,R.lModel));rec('BLOCK_RECORD',R.ps,T.BLOCK_RECORD,'AcDbBlockTableRecord',P(2,'*Paper_Space'),P(340,R.lPaper));
  for(const b of blocks)rec('BLOCK_RECORD',b.h,T.BLOCK_RECORD,'AcDbBlockTableRecord',P(2,enc(b.name)),P(340,0));endtab();
  out.push(P(0,'ENDSEC'),P(0,'SECTION'),P(2,'BLOCKS'));
  const blk=(bh,eh_,owner,name,ps,ents)=>{const f=ps?[P(67,1)]:[];out.push(P(0,'BLOCK'),P(5,bh),P(330,owner),P(100,'AcDbEntity'),...f,P(8,'0'),P(100,'AcDbBlockBegin'),P(2,name),P(70,0),P(10,'0.0'),P(20,'0.0'),P(30,'0.0'),P(3,name),P(1,''));add(ents);
    out.push(P(0,'ENDBLK'),P(5,eh_),P(330,owner),P(100,'AcDbEntity'),...f,P(8,'0'),P(100,'AcDbBlockEnd'))};
  blk(R.msB,R.msE,R.ms,'*Model_Space',false,[]);blk(R.psB,R.psE,R.ps,'*Paper_Space',true,[]);for(const b of blocks)blk(b.b,b.e,b.h,enc(b.name),false,b.k.a);
  out.push(P(0,'ENDSEC'),P(0,'SECTION'),P(2,'ENTITIES'));add(MS.a);out.push(P(0,'ENDSEC'),P(0,'SECTION'),P(2,'OBJECTS'));
  const dict=(h,owner,entries)=>{out.push(P(0,'DICTIONARY'),P(5,h),...(owner?[P(102,'{ACAD_REACTORS'),P(330,owner),P(102,'}')]:[]),P(330,owner||0),P(100,'AcDbDictionary'),P(281,1));for(const[k,v]of entries)out.push(P(3,k),P(350,v))};
  dict(R.root,0,[['ACAD_GROUP',R.groups],['ACAD_LAYOUT',R.layouts],['ACAD_MLINESTYLE',R.mlines],['ACAD_PLOTSETTINGS',R.plots],['ACAD_PLOTSTYLENAME',R.psn]]);
  dict(R.groups,R.root,[]);dict(R.layouts,R.root,[['Layout1',R.lPaper],['Model',R.lModel]]);dict(R.mlines,R.root,[['Standard',R.mlStd]]);dict(R.plots,R.root,[]);
  out.push(P(0,'ACDBDICTIONARYWDFLT'),P(5,R.psn),P(102,'{ACAD_REACTORS'),P(330,R.root),P(102,'}'),P(330,R.root),P(100,'AcDbDictionary'),P(281,1),P(3,'Normal'),P(350,R.normal),P(100,'AcDbDictionaryWithDefault'),P(340,R.normal));
  out.push(P(0,'ACDBPLACEHOLDER'),P(5,R.normal),P(102,'{ACAD_REACTORS'),P(330,R.psn),P(102,'}'),P(330,R.psn));
  out.push(P(0,'MLINESTYLE'),P(5,R.mlStd),P(102,'{ACAD_REACTORS'),P(330,R.mlines),P(102,'}'),P(330,R.mlines),P(100,'AcDbMlineStyle'),P(2,'Standard'),P(70,0),P(3,''),P(62,256),P(51,'90.0'),P(52,'90.0'),P(71,2),P(49,'0.5'),P(62,256),P(6,'BYLAYER'),P(49,'-0.5'),P(62,256),P(6,'BYLAYER'));
  // both layouts plot the sheet at 1:1 on paper of the sheet's size
  const layout=(h,name,tab,br,flags)=>out.push(P(0,'LAYOUT'),P(5,h),P(102,'{ACAD_REACTORS'),P(330,R.layouts),P(102,'}'),P(330,R.layouts),P(100,'AcDbPlotSettings'),P(1,''),P(4,''),P(6,''),P(40,'0.0'),P(41,'0.0'),P(42,'0.0'),P(43,'0.0'),P(44,num(Wm)),P(45,num(Hm)),
    P(46,'0.0'),P(47,'0.0'),P(48,'0.0'),P(49,'0.0'),P(140,'0.0'),P(141,'0.0'),P(142,'1.0'),P(143,'1.0'),P(70,flags),P(72,1),P(73,0),P(74,5),P(7,''),P(75,16),P(76,0),P(77,2),P(78,300),P(147,'1.0'),P(148,'0.0'),P(149,'0.0'),
    P(100,'AcDbLayout'),P(1,name),P(70,1),P(71,tab),P(10,'0.0'),P(20,'0.0'),P(11,num(Wm)),P(21,num(Hm)),P(12,'0.0'),P(22,'0.0'),P(32,'0.0'),P(14,num(bx0)),P(24,num(by0)),P(34,'0.0'),P(15,num(bx1)),P(25,num(by1)),P(35,'0.0'),P(146,'0.0'),
    P(13,'0.0'),P(23,'0.0'),P(33,'0.0'),P(16,'1.0'),P(26,'0.0'),P(36,'0.0'),P(17,'0.0'),P(27,'1.0'),P(37,'0.0'),P(76,1),P(330,br));
  layout(R.lModel,'Model',0,R.ms,1024);layout(R.lPaper,'Layout1',1,R.ps,0);
  out.push(P(0,'ENDSEC'),P(0,'EOF'));
  return{dxf:out.join('\r\n')+'\r\n',skipped:{images:skipped},entities:count,blocks:blocks.length,layers:layers.map(l=>l.name),name:String(page.name??'')}}

// every sheet, one DXF each: [{name, dxf, skipped, ...}]
const buildAll=(ir,opts={})=>(Array.isArray(ir?.pages)?ir.pages:[]).map((p,i)=>build(ir,{...opts,page:i}));
return{VERSION,build,buildAll,num,encode:enc,mtextTokens,headOf}})();
if(typeof module!=='undefined')module.exports=DxfWriter;
