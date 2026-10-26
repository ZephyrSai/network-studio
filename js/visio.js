// Visio import. Stencils (.vssx / .vssm) become shape packs, one shape per master. Drawings (.vsdx / .vsdm / .vstx)
// become editable pages: shapes keep their Visio look (geometry converted to SVG), connectors become links glued to
// their shapes, containers become zones, pictures stay pictures, text-only shapes become text, shape data becomes fields.
// Cell values follow Visio's inheritance: the shape, then its master shape, then its style sheets, then defaults.
// Legacy binary files (.vsd / .vss) are not readable in a browser: save them as .vsdx / .vssx from Visio first.
const Visio=(()=>{
const C=Core;
const XNS='http://schemas.microsoft.com/office/visio/2012/main';
const PALETTE=['#000000','#ffffff','#ff0000','#00ff00','#0000ff','#ffff00','#ff00ff','#00ffff','#800000','#008000','#000080','#808000','#800080','#008080','#c0c0c0','#e6e6e6','#cdcdcd','#b3b3b3','#9a9a9a','#808080','#666666','#4d4d4d','#333333','#1a1a1a'];

// ---------- package ----------
async function readPackage(blob){const files=await Packs.unzip(blob,true),map=new Map(files.map(f=>[f.path.replace(/^\/+/,''),f.bytes]));
  const text=p=>{const b=map.get(p);return b?new TextDecoder().decode(b):null};
  const xml=p=>{const t=text(p);if(!t)return null;const d=new DOMParser().parseFromString(t,'application/xml');return d.querySelector('parsererror')?null:d};
  const norm=(base,target)=>{if(target.startsWith('/'))return target.slice(1);const parts=base.split('/').slice(0,-1);for(const seg of target.split('/')){if(seg==='..')parts.pop();else if(seg!=='.')parts.push(seg)}return parts.join('/')};
  const rels=part=>{const i=part.lastIndexOf('/'),rp=part.slice(0,i+1)+'_rels/'+part.slice(i+1)+'.rels',d=xml(rp),out={};if(d)for(const r of d.getElementsByTagName('Relationship'))out[r.getAttribute('Id')]={target:norm(part,r.getAttribute('Target')),type:r.getAttribute('Type')||''};return out};
  const root=xml('_rels/.rels');let docPart='visio/document.xml';if(root)for(const r of root.getElementsByTagName('Relationship'))if(/\/document$/.test(r.getAttribute('Type')||''))docPart=r.getAttribute('Target').replace(/^\/+/,'');
  if(!map.has(docPart))throw Error('This is not a Visio file (.vsdx / .vssx). Older .vsd / .vss files must be saved as .vsdx / .vssx from Visio first.');
  return{map,text,xml,rels,docPart,bytes:p=>map.get(p)}}

// ---------- cells, sections, inheritance ----------
const kids=(el,tag)=>el?[...el.children].filter(c=>c.localName===tag):[];
const kid=(el,tag)=>el?[...el.children].find(c=>c.localName===tag)||null:null;
function cellsOf(el){const m={};for(const c of kids(el,'Cell'))m[c.getAttribute('N')]=c;return m}
function sectionsOf(el){const out={};for(const s of kids(el,'Section')){const n=s.getAttribute('N');(out[n]??=[]).push(s)}return out}
// A shape record: its own XML plus the master shape and style sheets it inherits from.
function rec(el,master,styles){return{el,master,cells:cellsOf(el),sections:sectionsOf(el),styles}}
// Tiny arithmetic evaluator for formula-only cells (Width*0.5, Height-0.1 in…).
function evalF(f,env){if(!f)return null;const s=String(f).replace(/\bTxtWidth\b/g,env.TW??'x').replace(/\bTxtHeight\b/g,env.TH??'x').replace(/\bWidth\b/g,env.W).replace(/\bHeight\b/g,env.H).replace(/(\d+(?:\.\d+)?)\s*(?:in|IN|"|pt|mm)\b/g,'$1').replace(/\s+/g,'');if(!/^[\d.+\-*/()eE]+$/.test(s))return null;
  try{let i=0;const num=()=>{let m=/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));if(!m)throw 0;i+=m[0].length;return+m[0]};const fac=()=>{if(s[i]==='('){i++;const v=add();i++;return v}if(s[i]==='-'){i++;return-fac()}return num()};
    const mul=()=>{let v=fac();while(s[i]==='*'||s[i]==='/'){const o=s[i++],r=fac();v=o==='*'?v*r:v/r}return v};const add=()=>{let v=mul();while(s[i]==='+'||s[i]==='-'){const o=s[i++],r=mul();v=o==='+'?v+r:v-r}return v};const v=add();return i===s.length&&isFinite(v)?v:null}catch{return null}}
function cellRaw(r,name,styleKind){for(let x=r;x;x=x.master){const c=x.cells[name];if(c)return c}
  if(styleKind&&r.styles){let id=styleId(r,styleKind);for(let guard=0;id!=null&&guard<12;guard++){const st=r.styles.get(id);if(!st)break;const c=st.cells[name];if(c)return c;id=st.el.getAttribute(styleKind)}}return null}
function styleId(r,kind){for(let x=r;x;x=x.master){const v=x.el.getAttribute(kind);if(v!=null)return v}return null}
// A cell inherited from the master carries the master's value; a simple formula (Width*0.5) is re-evaluated for this
// shape's own size, so instances resized without rewritten cells still draw right. Pins refer to the parent: never.
function num(r,name,def=0,kind,env){let c=null,inh=false;for(let x=r;x;x=x.master)if(x.cells[name]){c=x.cells[name];inh=x!==r;break}c??=cellRaw(r,name,kind);if(!c)return def;
  if(inh&&env&&!/^Pin/.test(name)){const e=evalF(c.getAttribute('F'),env);if(e!=null)return e}const v=c.getAttribute('V');if(v!=null&&v!==''&&!isNaN(+v))return+v;const e=evalF(c.getAttribute('F'),env||{W:1,H:1});return e==null?def:e}
function str(r,name,def='',kind){const c=cellRaw(r,name,kind);return c?c.getAttribute('V')??def:def}
function color(v,def){if(v==null||v==='')return def;if(/^#[0-9a-f]{6}$/i.test(v))return v.toLowerCase();if(/^\d+$/.test(v))return PALETTE[+v]||def;const m=/RGB\((\d+),\s*(\d+),\s*(\d+)\)/i.exec(v);if(m)return'#'+[m[1],m[2],m[3]].map(x=>(+x).toString(16).padStart(2,'0')).join('');return def}
// Sections merge by IX (geometry) or row name (data): the master's rows, overridden or deleted by the shape's own.
function mergedSections(r,name){const chain=[];for(let x=r;x;x=x.master)chain.unshift(x);const out=new Map();
  for(const x of chain){const cells=el=>{const m=cellsOf(el);if(x!==r)for(const k in m){const c=m[k];m[k]={inh:true,getAttribute:a=>c.getAttribute(a)}}return m};
   for(const s of x.sections[name]||[]){const key=s.getAttribute('IX')??'0';if(s.getAttribute('Del')==='1'){out.delete(key);continue}
    const prev=out.get(key)||{cells:{},rows:new Map()};const cur={cells:{...prev.cells,...cells(s)},rows:new Map(prev.rows)};
    for(const row of kids(s,'Row')){const rk=row.getAttribute('IX')??row.getAttribute('N');if(row.getAttribute('Del')==='1'){cur.rows.delete(rk);continue}const pr=cur.rows.get(rk);cur.rows.set(rk,{T:row.getAttribute('T')||pr?.T,N:row.getAttribute('N')||pr?.N,cells:{...(pr?.cells||{}),...cells(row)}})}out.set(key,cur)}}
  return[...out.entries()].sort((a,b)=>(+a[0]||0)-(+b[0]||0)).map(([,v])=>v)}
const cv=(cells,n,env,def=0)=>{const c=cells[n];if(!c)return def;if(c.inh){const e=evalF(c.getAttribute('F'),env);if(e!=null)return e}const v=c.getAttribute('V');if(v!=null&&v!==''&&!isNaN(+v))return+v;const e=evalF(c.getAttribute('F'),env);return e==null?def:e};

// ---------- geometry → SVG path (shape-local inches, y up) ----------
const fmt=v=>+(+v).toFixed(4);
function nurbsPoints(p0,row,env){const f=row.cells.E?.getAttribute('F')||row.cells.E?.getAttribute('V')||'',m=/NURBS\(([^)]*)\)/i.exec(f);const X=cv(row.cells,'X',env),Y=cv(row.cells,'Y',env);if(!m)return[[X,Y]];
  const a=m[1].split(',').map(Number),deg=Math.max(1,Math.round(a[1])),xT=a[2],yT=a[3],pts=[p0],w=[cv(row.cells,'D',env,1)];for(let i=4;i+3<a.length;i+=4){pts.push([xT===0?a[i]*env.W:a[i],yT===0?a[i+1]*env.H:a[i+1]]);w.push(a[i+3]||1)}pts.push([X,Y]);w.push(cv(row.cells,'B',env,1));
  // clamped uniform rational B-spline through the control points (close enough for icons)
  const n=pts.length-1,d=Math.min(deg,n),knots=[];for(let i=0;i<=n+d+1;i++)knots.push(i<=d?0:i>=n+1?1:(i-d)/(n-d+1));const out=[],steps=Math.max(8,n*6);
  for(let s=1;s<=steps;s++){const t=Math.min(s/steps,1-1e-9);let k=d;while(k<n&&knots[k+1]<=t)k++;const dP=[],dW=[];for(let j=0;j<=d;j++){const i=k-d+j;dW.push(w[i]);dP.push([pts[i][0]*w[i],pts[i][1]*w[i]])}
    for(let r=1;r<=d;r++)for(let j=d;j>=r;j--){const i=k-d+j,al=(t-knots[i])/((knots[i+d-r+1]-knots[i])||1);dP[j]=[(1-al)*dP[j-1][0]+al*dP[j][0],(1-al)*dP[j-1][1]+al*dP[j][1]];dW[j]=(1-al)*dW[j-1]+al*dW[j]}out.push([dP[d][0]/dW[d],dP[d][1]/dW[d]])}
  out[out.length-1]=[X,Y];return out}
function circleThrough(a,b,c){const d=2*(a[0]*(b[1]-c[1])+b[0]*(c[1]-a[1])+c[0]*(a[1]-b[1]));if(Math.abs(d)<1e-12)return null;const s=p=>p[0]*p[0]+p[1]*p[1];return[(s(a)*(b[1]-c[1])+s(b)*(c[1]-a[1])+s(c)*(a[1]-b[1]))/d,(s(a)*(c[0]-b[0])+s(b)*(a[0]-c[0])+s(c)*(b[0]-a[0]))/d]}
function ellArc(p0,p1,pc,angle,ratio){// ellipse through p0,p1 and control pc, major axis at `angle`, major/minor = ratio
  const rot=(p,t)=>[p[0]*Math.cos(t)-p[1]*Math.sin(t),p[0]*Math.sin(t)+p[1]*Math.cos(t)],sq=p=>{const q=rot(p,-angle);return[q[0]/(ratio||1),q[1]]};
  const A=sq(p0),B=sq(p1),Cc=sq(pc),ctr=circleThrough(A,B,Cc);if(!ctr)return`L${fmt(p1[0])} ${fmt(p1[1])}`;const r=Math.hypot(A[0]-ctr[0],A[1]-ctr[1]);
  const ang=p=>Math.atan2(p[1]-ctr[1],p[0]-ctr[0]),a0=ang(A),a1=ang(B),ac=ang(Cc),norm=x=>(x%(2*Math.PI)+2*Math.PI)%(2*Math.PI),ccw=norm(ac-a0)<norm(a1-a0),span=ccw?norm(a1-a0):norm(a0-a1);
  return`A${fmt(r*(ratio||1))} ${fmt(r)} ${fmt(angle*180/Math.PI)} ${span>Math.PI?1:0} ${ccw?1:0} ${fmt(p1[0])} ${fmt(p1[1])}`}
function geomPath(sec,env,info={}){let d='',cur=[0,0],start=[0,0];const W=env.W,H=env.H,c=(row,n,def=0)=>cv(row.cells,n,env,def);
  for(const row of sec.rows.values()){const T=row.T||'',X=c(row,'X'),Y=c(row,'Y');
    switch(T){
      case'MoveTo':d+=`M${fmt(X)} ${fmt(Y)}`;cur=start=[X,Y];break;
      case'RelMoveTo':cur=start=[X*W,Y*H];d+=`M${fmt(cur[0])} ${fmt(cur[1])}`;break;
      case'LineTo':d+=`L${fmt(X)} ${fmt(Y)}`;cur=[X,Y];break;
      case'RelLineTo':cur=[X*W,Y*H];d+=`L${fmt(cur[0])} ${fmt(cur[1])}`;break;
      case'ArcTo':{const A=c(row,'A'),ch=Math.hypot(X-cur[0],Y-cur[1]);if(Math.abs(A)<1e-9||ch<1e-9){d+=`L${fmt(X)} ${fmt(Y)}`}else{const r=(ch*ch/4+A*A)/(2*Math.abs(A));d+=`A${fmt(r)} ${fmt(r)} 0 ${Math.abs(A)>ch/2?1:0} ${A>0?1:0} ${fmt(X)} ${fmt(Y)}`}cur=[X,Y];break}
      case'EllipticalArcTo':d+=ellArc(cur,[X,Y],[c(row,'A'),c(row,'B')],c(row,'C'),c(row,'D',1));cur=[X,Y];break;
      case'RelEllipticalArcTo':{const p=[X*W,Y*H];d+=ellArc(cur,p,[c(row,'A')*W,c(row,'B')*H],c(row,'C'),c(row,'D',1));cur=p;break}
      case'RelCubBezTo':{const p=[X*W,Y*H];d+=`C${fmt(c(row,'A')*W)} ${fmt(c(row,'B')*H)} ${fmt(c(row,'C')*W)} ${fmt(c(row,'D')*H)} ${fmt(p[0])} ${fmt(p[1])}`;cur=p;break}
      case'RelQuadBezTo':{const p=[X*W,Y*H];d+=`Q${fmt(c(row,'A')*W)} ${fmt(c(row,'B')*H)} ${fmt(p[0])} ${fmt(p[1])}`;cur=p;break}
      case'NURBSTo':{for(const p of nurbsPoints(cur,row,env))d+=`L${fmt(p[0])} ${fmt(p[1])}`;cur=[X,Y];break}
      case'PolylineTo':{const f=row.cells.A?.getAttribute('F')||'',m=/POLYLINE\(([^)]*)\)/i.exec(f);if(m){const a=m[1].split(',').map(Number);for(let i=2;i+1<a.length;i+=2)d+=`L${fmt(a[0]===0?a[i]*W:a[i])} ${fmt(a[1]===0?a[i+1]*H:a[i+1])}`}d+=`L${fmt(X)} ${fmt(Y)}`;cur=[X,Y];break}
      case'Ellipse':{const cx=X,cy=Y,a=[c(row,'A')-cx,c(row,'B')-cy],b=[c(row,'C')-cx,c(row,'D')-cy],rx=Math.hypot(...a),ry=Math.hypot(...b),rt=Math.atan2(a[1],a[0])*180/Math.PI;
        d+=`M${fmt(cx+a[0])} ${fmt(cy+a[1])}A${fmt(rx)} ${fmt(ry)} ${fmt(rt)} 1 1 ${fmt(cx-a[0])} ${fmt(cy-a[1])}A${fmt(rx)} ${fmt(ry)} ${fmt(rt)} 1 1 ${fmt(cx+a[0])} ${fmt(cy+a[1])}Z`;break}
      case'SplineStart':case'SplineKnot':d+=`L${fmt(X)} ${fmt(Y)}`;cur=[X,Y];break;
      default:break}}
  if(d&&!/^M/.test(d))d='M0 0'+d;info.closed=/Ellipse/.test([...sec.rows.values()].map(r=>r.T).join())||Math.hypot(cur[0]-start[0],cur[1]-start[1])<1e-6;return d}
// Points of a 1-D shape's path, in its local inches (for connectors).
function geomPoints(r,env){const out=[];for(const sec of mergedSections(r,'Geometry'))for(const row of sec.rows.values()){const T=row.T||'';if(!/To$/.test(T))continue;const rel=/^Rel/.test(T),X=cv(row.cells,'X',env),Y=cv(row.cells,'Y',env);out.push(rel?[X*env.W,Y*env.H]:[X,Y])}return out}

// ---------- shape → SVG ----------
function lineStyle(r,env){const pat=num(r,'LinePattern',1,'LineStyle'),w=num(r,'LineWeight',.01,'LineStyle'),col=color(str(r,'LineColor','#000000','LineStyle'),'#000000'),tr=num(r,'LineColorTrans',0,'LineStyle');
  return{none:pat===0,stroke:col,width:Math.max(.003,w),dash:pat>1?(pat%4===2?`${fmt(w*4)} ${fmt(w*3)}`:pat%4===3?`${fmt(w)} ${fmt(w*2)}`:`${fmt(w*6)} ${fmt(w*2)} ${fmt(w)} ${fmt(w*2)}`):'',opacity:1-tr}}
function fillStyle(r){const pat=num(r,'FillPattern',1,'FillStyle'),fg=color(str(r,'FillForegnd','#ffffff','FillStyle'),'#ffffff'),tr=num(r,'FillForegndTrans',0,'FillStyle');return{none:pat===0,fill:fg,opacity:1-tr}}
// Pictures inside the package: data URLs for PNG / JPEG / GIF / SVG; EMF / WMF cannot be shown in a browser.
function foreignImage(r,ctx){for(let x=r;x;x=x.master){const fd=kid(x.el,'ForeignData');if(!fd)continue;const rel=kid(fd,'Rel'),rid=rel?.getAttribute('r:id')||rel?.getAttributeNS?.('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');
    const part=rid&&(x.partRels||ctx.partRels)?.[rid]?.target,bytes=part&&ctx.pkg.bytes(part),ext=(part||'').split('.').pop().toLowerCase();
    if(!bytes){const b64=fd.textContent.trim();if(b64&&fd.getAttribute('ForeignType')==='Bitmap')return{url:'data:image/png;base64,'+b64.replace(/\s+/g,'')};return{unsupported:true}}
    const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',svg:'image/svg+xml',webp:'image/webp'}[ext];if(!mime)return{unsupported:ext||'image'};
    let bin='';for(let i=0;i<bytes.length;i+=8192)bin+=String.fromCharCode(...bytes.subarray(i,i+8192));return{url:`data:${mime};base64,${btoa(bin)}`}}return null}
function placement(r,env){const px=num(r,'PinX',0,null,env.parent),py=num(r,'PinY',0,null,env.parent),lx=num(r,'LocPinX',env.W/2,null,env),ly=num(r,'LocPinY',env.H/2,null,env),a=num(r,'Angle',0),fx=num(r,'FlipX',0),fy=num(r,'FlipY',0);
  return{px,py,lx,ly,a,fx,fy,svg:`translate(${fmt(px)} ${fmt(py)})${a?` rotate(${fmt(a*180/Math.PI)})`:''}${fx||fy?` scale(${fx?-1:1} ${fy?-1:1})`:''} translate(${fmt(-lx)} ${fmt(-ly)})`}}
function apply(p,pt){let x=pt[0]-p.lx,y=pt[1]-p.ly;if(p.fx)x=-x;if(p.fy)y=-y;const c=Math.cos(p.a),s=Math.sin(p.a);return[p.px+x*c-y*s,p.py+x*s+y*c]}
// SVG for a shape and its sub-shapes, in its own local inches (y up). stats collects unsupported content.
function shapeSvg(r,ctx,stats){const W=num(r,'Width',1),H=num(r,'Height',1),env={W,H};let out='';
  const ln=lineStyle(r,env),fl=fillStyle(r);
  for(const sec of mergedSections(r,'Geometry')){if(cv(sec.cells,'NoShow',env)===1)continue;const info={},d=geomPath(sec,env,info);if(!d)continue;if(/NURBSTo/.test([...sec.rows.values()].map(x=>x.T).join()))stats.nurbs++;
    const noFill=cv(sec.cells,'NoFill',env)===1||fl.none||!info.closed,noLine=cv(sec.cells,'NoLine',env)===1||ln.none;if(noFill&&noLine)continue;
    out+=`<path d="${d}" fill="${noFill?'none':fl.fill}"${!noFill&&fl.opacity<1?` fill-opacity="${fmt(fl.opacity)}"`:''} stroke="${noLine?'none':ln.stroke}" stroke-width="${fmt(ln.width)}"${ln.dash&&!noLine?` stroke-dasharray="${ln.dash}"`:''}${ln.opacity<1&&!noLine?` stroke-opacity="${fmt(ln.opacity)}"`:''} stroke-linejoin="round" fill-rule="evenodd"/>`}
  const img=foreignImage(r,ctx);if(img?.url){const iw=num(r,'ImgWidth',W,null,env),ih=num(r,'ImgHeight',H,null,env),ix=num(r,'ImgOffsetX',0,null,env),iy=num(r,'ImgOffsetY',0,null,env);out+=`<image href="${img.url}" x="${fmt(ix)}" y="${fmt(iy)}" width="${fmt(iw)}" height="${fmt(ih)}" preserveAspectRatio="none" transform="matrix(1 0 0 -1 0 ${fmt(2*iy+ih)})"/>`}
  else if(img?.unsupported){stats.emf++;const s=Math.min(W,H)*.45,cx=W/2,cy=H/2,sw=fmt(Math.min(W,H)*.02);// EMF/WMF: browsers can't draw them, so a marked picture placeholder
    out+=`<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="${sw}" stroke-dasharray="${fmt(W*.04)} ${fmt(W*.03)}"/><path d="M${fmt(cx-s/2)} ${fmt(cy-s/3)}L${fmt(cx-s/6)} ${fmt(cy+s/6)}L${fmt(cx+s/12)} ${fmt(cy-s/12)}L${fmt(cx+s/4)} ${fmt(cy+s/12)}L${fmt(cx+s/2)} ${fmt(cy-s/3)}Z" fill="#cbd5e1" stroke="#94a3b8" stroke-width="${sw}" stroke-linejoin="round"/><circle cx="${fmt(cx+s/4)}" cy="${fmt(cy+s/3)}" r="${fmt(s/10)}" fill="#cbd5e1"/>`}
  for(const c of children(r,ctx)){const cw=num(c,'Width',1),ch=num(c,'Height',1),p=placement(c,{W:cw,H:ch,parent:env});out+=`<g transform="${p.svg}">${shapeSvg(c,ctx,stats)}</g>`}
  return out}
// Sub-shapes: the shape's own, matched to the master's by MasterShape; the master's when the shape lists none.
function children(r,ctx){const own=kids(kid(r.el,'Shapes'),'Shape'),mkids=r.master?children(r.master,ctx):[];
  if(!own.length)return mkids;return own.map(el=>{const ms=el.getAttribute('MasterShape'),mm=ms!=null?mkids.find(k=>k.el.getAttribute('ID')===ms):null;const x=rec(el,mm,r.styles);x.partRels=r.partRels;return x})}
function textOf(r){for(let x=r;x;x=x.master){const t=kid(x.el,'Text');if(t){let s='';const walk=n=>{for(const c of n.childNodes){if(c.nodeType===3)s+=c.nodeValue;else if(c.nodeType===1&&c.localName==='fld')s+=c.textContent;else if(c.nodeType===1)walk(c)}};walk(t);return s.replace(/\r\n?/g,'\n').replace(/\n+$/,'').trim()}}return''}
function dataOf(r,fields=C.FIELDS){const out={},own=new Map(fields.map(f=>[f.label.toLowerCase(),f])),KEYS=[[/^(ip|ip ?address|ipv4)$/i,'ip'],[/host ?name|network name|^name$/i,'hostname'],[/manufacturer|vendor|make/i,'vendor'],[/model|product (number|name)/i,'model'],[/serial/i,'serial'],[/mac/i,'mac'],[/location|building|room|floor/i,'location'],[/operating system|^os$|firmware/i,'os'],[/asset/i,'asset'],[/owner|department/i,'owner'],[/^status$/i,'status'],[/power/i,'power']];
  for(const sec of mergedSections(r,'Property'))for(const row of sec.rows.values()){const lab=row.cells.Label?.getAttribute('V')||row.N?.replace(/^Prop\./,'')||'',val=row.cells.Value?.getAttribute('V');if(!lab||val==null||val===''||row.cells.Invisible?.getAttribute('V')==='1')continue;
    const f=own.get(lab.toLowerCase()),k=f?.key||KEYS.find(([re])=>re.test(lab))?.[1]||lab.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');if(k&&out[k]==null)out[k]=(f?.type==='number'||k==='power')&&!isNaN(+val)?+val:val}return out}
// First row of a text section (Character, Paragraph): the shape's, its master's, then its text style's.
function firstRow(r,name){for(const sec of mergedSections(r,name)){const row=[...sec.rows.values()][0];if(row)return row.cells}
  let id=styleId(r,'TextStyle');for(let g=0;id!=null&&g<12;g++){const st=r.styles?.get(id);if(!st)break;const sec=kids(st.el,'Section').find(x=>x.getAttribute('N')===name),row=sec&&kids(sec,'Row')[0];if(row)return cellsOf(row);id=st.el.getAttribute('TextStyle')}return{}}
function textStyle(r){const ch=firstRow(r,'Character'),pa=firstRow(r,'Paragraph'),v=(c,n)=>c[n]?.getAttribute('V'),st=+v(ch,'Style')||0,ha=v(pa,'HorzAlign');
  return{size:+v(ch,'Size')>0?+v(ch,'Size'):12/72,color:color(v(ch,'Color'),null),bold:!!(st&1),italic:!!(st&2),align:ha==='0'?'start':ha==='2'?'end':'middle'}}
const charSize=r=>textStyle(r).size;
// The text block in the shape's local inches (y up), with its margins and vertical alignment.
function textBlock(r,env){const tw=num(r,'TxtWidth',env.W,null,env),th=num(r,'TxtHeight',env.H,null,env),te={...env,TW:tw,TH:th},m=n=>num(r,n,4/72,'TextStyle');
  return{x:num(r,'TxtPinX',env.W/2,null,env)-num(r,'TxtLocPinX',tw/2,null,te),y:num(r,'TxtPinY',env.H/2,null,env)-num(r,'TxtLocPinY',th/2,null,te),w:tw,h:th,ml:m('LeftMargin'),mr:m('RightMargin'),mt:m('TopMargin'),mb:m('BottomMargin'),valign:num(r,'VerticalAlign',1,'TextStyle')}}
// Lay a label out the way Visio lays out the shape's text: styled, aligned in its text block and wrapped to its width.
function placeLabel(l,r,env,p,X,Y,k,text){const tb=textBlock(r,env),ts=textStyle(r);
  Object.assign(l,{text,size:Math.max(6,Math.min(96,+(ts.size*k).toFixed(1))),bold:ts.bold,italic:ts.italic,align:ts.align,rotation:0});if(ts.color)l.color=ts.color;
  l.wrapWidth=Math.max(30,Math.max(.05,tb.w-tb.ml-tb.mr)*k*1.1);// a little slack: browser fonts run slightly wider than Visio's
  const hIn=C.labelMetrics(l,text).h/k,ax=ts.align==='start'?tb.x+tb.ml:ts.align==='end'?tb.x+tb.w-tb.mr:tb.x+tb.w/2,top=tb.valign===0?tb.y+tb.h-tb.mt:tb.valign===2?tb.y+tb.mb+hIn:tb.y+tb.h/2+hIn/2;
  const q=apply(p,[ax,top]);l.x=X(q[0]);l.y=Y(q[1])+.95*l.size}
function userCell(r,name){for(const sec of mergedSections(r,'User'))for(const row of sec.rows.values())if(row.N===name||row.N==='User.'+name)return row.cells.Value?.getAttribute('V')||'';return''}
// Port's own description of an item (User.PortProps, written by Port's Visio export), checked field by field.
function portProps(r,kind){let o;try{o=JSON.parse(userCell(r,'PortProps')||'{}')}catch{o={}}if(!o||typeof o!=='object')return{};const out={},is=(k,re)=>typeof o[k]==='string'&&re.test(o[k]);
  if(is('pin',/^(frame|[tblr]{1,2})$/))out.pin=o.pin;
  if(kind==='zone'){if(is('style',/^(plain|header|outline|tab)$/))out.style=o.style;for(const k of['contain','autoFit','showMeta'])if(typeof o[k]==='boolean')out[k]=o[k];if(is('dash',/^[\d. ]{0,24}$/))out.dash=o.dash}
  if(kind==='node'){if(is('display',/^(symbol|card|tile|circle|shape|none)$/))out.display=o.display;if(Array.isArray(o.ports)&&o.ports.length<=256&&o.ports.every(p=>Array.isArray(p)&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1))out.ports=o.ports.map(p=>({id:C.uid(),x:+p[0],y:+p[1],name:String(p[2]??'').slice(0,60)}))}
  if(kind==='edge'){if(typeof o.linkType==='string'&&Shapes.linkTypes[o.linkType])out.linkType=o.linkType;for(const k of['fromIf','toIf'])if(typeof o[k]==='string')out[k]=o[k].slice(0,60);if(is('routing',/^(auto|hv|vh|free|straight)$/))out.routing=o.routing;for(const k of['fromPort','toPort'])if(Number.isInteger(o[k])&&o[k]>=0)out[k]=o[k]}
  return out}
const hashStr=s=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};

// ---------- document parts ----------
async function load(blob){const pkg=await readPackage(blob),docRels=pkg.rels(pkg.docPart),doc=pkg.xml(pkg.docPart);
  const styles=new Map();for(const st of doc?.getElementsByTagName('StyleSheet')||[])styles.set(st.getAttribute('ID'),{el:st,cells:cellsOf(st)});
  const masters=new Map(),mastersPart=Object.values(docRels).find(r=>/\/masters$/.test(r.type))?.target;
  if(mastersPart){const mx=pkg.xml(mastersPart),mr=pkg.rels(mastersPart);for(const m of mx?.getElementsByTagName('Master')||[]){const rid=kid(m,'Rel')?.getAttribute('r:id'),part=rid&&mr[rid]?.target,content=part&&pkg.xml(part),partRels=part?pkg.rels(part):{};
      const shapes=content?kids(kid(content.documentElement,'Shapes'),'Shape').map(el=>{const x=rec(el,null,styles);x.partRels=partRels;return x}):[];
      masters.set(m.getAttribute('ID'),{id:m.getAttribute('ID'),name:m.getAttribute('NameU')||m.getAttribute('Name')||'Shape',hidden:m.getAttribute('Hidden')==='1',shapes,sheet:cellsOf(kid(m,'PageSheet'))})}}
  const pages=[],pagesPart=Object.values(docRels).find(r=>/\/pages$/.test(r.type))?.target;
  if(pagesPart){const px=pkg.xml(pagesPart),pr=pkg.rels(pagesPart);for(const p of px?.getElementsByTagName('Page')||[]){const rid=kid(p,'Rel')?.getAttribute('r:id'),part=rid&&pr[rid]?.target,content=part&&pkg.xml(part);
      const sheet=kid(p,'PageSheet'),cells=cellsOf(sheet),get=(n,d)=>{const c=cells[n];return c&&!isNaN(+c.getAttribute('V'))?+c.getAttribute('V'):d};const layers=[];for(const s of kids(sheet,'Section'))if(s.getAttribute('N')==='Layer')for(const row of kids(s,'Row')){const rc=cellsOf(row);layers.push({name:rc.Name?.getAttribute('V')||'Layer '+(layers.length+1),visible:rc.Visible?.getAttribute('V')!=='0',print:rc.Print?.getAttribute('V')!=='0',locked:rc.Lock?.getAttribute('V')==='1'})}
      pages.push({id:p.getAttribute('ID'),name:p.getAttribute('NameU')||p.getAttribute('Name')||'Page',background:p.getAttribute('Background')==='1',backPage:p.getAttribute('BackPage'),W:get('PageWidth',11),H:get('PageHeight',8.5),layers,content,partRels:part?pkg.rels(part):{}})}}
  return{pkg,styles,masters,pages}}
const instance=(el,v,partRels)=>{const mid=el.getAttribute('Master'),m=mid!=null?v.masters.get(mid):null,ms=el.getAttribute('MasterShape');let base=null;
  if(m)base=(ms!=null&&m.shapes.find(s=>s.el.getAttribute('ID')===ms))||m.shapes[0]||null;
  const r=rec(el,base,v.styles);r.partRels=partRels;r.masterInfo=m;return r};

// ---------- stencil → pack ----------
function masterSvg(m,ctx,stats){if(!m.shapes.length)return null;let out='',bb=null;const grow=p=>{bb=bb?{x0:Math.min(bb.x0,p[0]),y0:Math.min(bb.y0,p[1]),x1:Math.max(bb.x1,p[0]),y1:Math.max(bb.y1,p[1])}:{x0:p[0],y0:p[1],x1:p[0],y1:p[1]}};
  for(const r of m.shapes){if(cellRaw(r,'BeginX'))continue;const W=num(r,'Width',1),H=num(r,'Height',1),p=placement(r,{W,H,parent:{W:1,H:1}});for(const c of[[0,0],[W,0],[0,H],[W,H]])grow(apply(p,c));out+=`<g transform="${p.svg}">${shapeSvg(r,ctx,stats)}</g>`}
  if(!bb||!out)return null;const pad=Math.max(bb.x1-bb.x0,bb.y1-bb.y0)*.03,x=bb.x0-pad,y=bb.y0-pad,w=bb.x1-bb.x0+2*pad,h=bb.y1-bb.y0+2*pad;
  return{vb:`${fmt(x)} ${fmt(-(y+h))} ${fmt(w)} ${fmt(h)}`,svg:`<g transform="scale(1 -1)">${out}</g>`}}
async function stencilToPack(file){const v=await load(file),name=file.name.replace(/\.[^.]+$/,''),stats={nurbs:0,emf:0,skipped:0};if(!v.masters.size)throw Error('No master shapes found in this stencil.');
  const pack={id:'u-'+hashStr(name+Date.now()),name,source:'visio',created:new Date().toISOString(),categories:[{id:'pack:vs-'+hashStr(name),name}],shapes:{}};const catId=pack.categories[0].id;
  for(const m of v.masters.values()){if(m.hidden){stats.skipped++;continue}const ctx={pkg:v.pkg,partRels:m.shapes[0]?.partRels||{}},s=masterSvg(m,ctx,stats);if(!s){stats.skipped++;continue}
    if(!Packs.isSafeMarkup(s.svg)){stats.skipped++;continue}
    pack.shapes['vs-'+hashStr(name+'|'+m.id+'|'+m.name)]=Packs.stencilFrom(m.name,s.vb,s.svg,{cat:catId,tags:'visio '+name,source:file.name,recolor:false})}
  if(!Object.keys(pack.shapes).length)throw Error('None of the masters in this stencil could be drawn (they may use EMF pictures, which browsers cannot show).');
  return{pack,stats,count:Object.keys(pack.shapes).length}}

// ---------- drawing → document ----------
// Recognised network masters can become Port's own devices (with analysis); otherwise they keep the Visio look.
const DEVICES=[[/firewall|asa|fortigate|palo/i,'firewall'],[/layer ?3|l3 ?switch|multilayer/i,'l3switch'],[/switch/i,'switch'],[/router/i,'router'],[/wireless ?(lan)? ?controller|wlc/i,'wlc'],[/access point|\bap\b|wifi|wireless/i,'wap'],[/load ?balancer/i,'loadbalancer'],
  [/server|blade/i,'server'],[/storage|san\b|nas\b/i,'storage'],[/laptop|notebook/i,'laptop'],[/pc|workstation|desktop|computer/i,'workstation'],[/printer/i,'printer'],[/ip ?phone|phone/i,'ipphone'],[/camera|cctv/i,'camera'],[/cloud|internet/i,'internet'],[/modem/i,'modem'],[/ups\b/i,'ups']];
function deviceType(name){if(!name)return null;for(const[re,t]of DEVICES)if(re.test(name)&&Stencils.shapes[t])return t;return null}
async function drawingToDoc(file,opt={}){const v=await load(file),k=25.4*C.PX,stats={nurbs:0,emf:0,shapes:0,links:0,zones:0,images:0,text:0,devices:0,restored:0,restoredLinks:0},doc=C.newDoc(file.name.replace(/\.[^.]+$/,'')),stencils={};doc.pages=[];
  const layerIds=new Map();const layerFor=(pv,idx)=>{const L=pv.layers[idx];if(!L)return doc.layers[0].id;if(!layerIds.has(L.name)){let l=doc.layers.find(x=>x.name===L.name);if(!l){l={id:C.uid(),name:L.name,visible:L.visible,locked:false,print:L.print};doc.layers.push(l)}layerIds.set(L.name,l.id)}return layerIds.get(L.name)};
  const pageMap=new Map();
  for(const pv of v.pages){const page=C.page(pv.name);page.paper='Custom';page.customW=Math.round(pv.W*25.4);page.customH=Math.round(pv.H*25.4);page.orientation=pv.W>=pv.H?'landscape':'portrait';page.margin=0;page.autoSize=false;page.isBackground=pv.background;page.items=[];pageMap.set(pv.id,page);doc.pages.push(page);
    if(!pv.content)continue;const ctx={pkg:v.pkg,partRels:pv.partRels},X=x=>x*k,Y=y=>(pv.H-y)*k,idMap=new Map(),edges=[],shapes=kids(kid(pv.content.documentElement,'Shapes'),'Shape');
    for(const el of shapes){const r=instance(el,v,pv.partRels);const W=num(r,'Width',0),H=num(r,'Height',0),env={W,H},text=textOf(r),mname=r.masterInfo?.name||'',layerIdx=+(str(r,'LayerMember','').split(';')[0]);const layer=isNaN(layerIdx)?doc.layers[0].id:layerFor(pv,layerIdx);
      // 1-D: connectors and lines
      if(cellRaw(r,'BeginX')&&cellRaw(r,'EndX')){const p=placement(r,{W,H,parent:{W:pv.W,H:pv.H}});let pts=geomPoints(r,env).map(q=>apply(p,q));const b=[num(r,'BeginX'),num(r,'BeginY')],e=[num(r,'EndX'),num(r,'EndY')];if(pts.length<2)pts=[b,e];else{pts[0]=b;pts[pts.length-1]=e}
        const px=pts.map(q=>[X(q[0]),Y(q[1])]).filter((q,i,a)=>!i||Math.hypot(q[0]-a[i-1][0],q[1]-a[i-1][1])>.5);const edge=C.edge(px.length>1?px:[[X(b[0]),Y(b[1])],[X(e[0]),Y(e[1])]],null,null);
        const ln=lineStyle(r,env);edge.stroke=ln.stroke;edge.strokeWidth=Math.max(1,+(ln.width*k).toFixed(1));edge.dash=ln.dash?'6 4':'';edge.endMarker=num(r,'EndArrow',0,'LineStyle')>0?'arrow':'none';edge.startMarker=num(r,'BeginArrow',0,'LineStyle')>0?'arrow':'none';
        const ortho=px.every((q,i)=>!i||Math.abs(q[0]-px[i-1][0])<.6||Math.abs(q[1]-px[i-1][1])<.6);edge.routing=opt.reroute?'auto':ortho?'hv':'free';edge.layer=layer;edge.data=dataOf(r,C.LINK_FIELDS);
        if(userCell(r,'PortKind')==='edge'){const pp=portProps(r,'edge');Object.assign(edge,pp);delete edge.fromPort;delete edge.toPort;edge._ports=[pp.fromPort,pp.toPort];stats.restoredLinks++}
        if(text){const ts=textStyle(r),l=C.label(text,0,0,Math.max(7,Math.min(48,+(ts.size*k).toFixed(1))));if(ts.color)l.color=ts.color;l.bold=ts.bold;l.anchor={t:.5,dx:0,dy:-9};l.background=true;edge.labels.push(l)}idMap.set(el.getAttribute('ID'),edge);edges.push(edge);page.items.push(edge);stats.links++;continue}
      if(!(W>0&&H>0))continue;const p=placement(r,{W,H,parent:{W:pv.W,H:pv.H}}),centre=apply(p,[W/2,H/2]),cx=X(centre[0]),cy=Y(centre[1]),w=W*k,h=H*k,rot=-p.a*180/Math.PI;
      const fl=fillStyle(r),ln=lineStyle(r,env),geom=mergedSections(r,'Geometry').filter(s=>cv(s.cells,'NoShow',env)!==1),
        drawn=geom.filter(s=>!((cv(s.cells,'NoFill',env)===1||fl.none)&&(cv(s.cells,'NoLine',env)===1||ln.none))),// text boxes carry an invisible rectangle
        img=foreignImage(r,ctx),subs=children(r,ctx).length,portKind=userCell(r,'PortKind'),portType=userCell(r,'PortType'),
        isContainer=portKind==='zone'||/container/i.test(userCell(r,'msvStructureType'))||/container/i.test(mname);
      if(portKind==='auto'){const o=idMap.get(userCell(r,'PortOwner'));if(o&&(o.kind==='zone'||o.kind==='edge'&&o._ports||o.kind==='node'&&!o.type.startsWith('vs-')&&o.type!=='image'))continue}// the restored item draws it again
      const asText=()=>{stats.text++;return C.text(text,cx-w/2,cy-h/2,w,h)};let n;
      if(isContainer){n=C.zone(text.split('\n')[0]||(portKind?'':mname||'Container'),cx-w/2,cy-h/2,w,h,fl.none?'none':fl.fill,ln.none?'#94a3b8':ln.stroke);n.style=n.labels[0].text?'header':'plain';if(portKind==='zone')Object.assign(n,portProps(r,'zone'));n.dash=ln.dash?'7 5':'';n.data=dataOf(r,C.ZONE_FIELDS);stats.zones++}
      else if(!drawn.length&&!img&&!subs){if(!text)continue;n=asText()}
      else if(img?.url&&!drawn.length&&!subs){n=C.node('image',cx-w/2,cy-h/2,text,w,h);n.image=img.url;n.display='symbol';n.ports=[];stats.images++}
      else{// drawings exported from Port carry the item's own type: they come back as real devices
        const own=portKind==='node'&&(Stencils.shapes[portType]||Shapes.basic[portType])?portType:null,dt=own||opt.devices&&deviceType(mname||text);
        if(dt){n=Shapes.make(dt,0,0,text);n.w=Math.max(w,12);n.h=Math.max(h,12);C.move(n,cx-n.w/2-n.x,cy-n.h/2-n.y);
          if(Shapes.basic[dt]){n.fill=fl.none?'none':fl.fill;n.stroke=ln.none?'none':ln.stroke;n.strokeWidth=Math.max(.5,+(ln.width*k).toFixed(2));n.dash=ln.dash?'6 4':''}if(own){Object.assign(n,portProps(r,'node'));stats.restored++}else stats.devices++}
        else{const body=shapeSvg(r,ctx,stats);if(!body&&!text)continue;
          if(!body)n=asText();else{const svg=`<g transform="matrix(1 0 0 -1 0 ${fmt(H)})">${body}</g>`,key='vs-'+hashStr((mname||'shape')+'|'+svg);
            if(!stencils[key])stencils[key]={name:mname||'Visio shape',cat:'doc-shapes',w:64,h:Math.round(64*H/W)||64,vb:`0 0 ${fmt(W)} ${fmt(H)}`,svg,tier:5,tags:'visio '+mname.toLowerCase(),source:file.name,recolor:false};
            n=C.node(key,cx-w/2,cy-h/2,text,w,h);n.display='symbol';stats.shapes++}}}
      if(n.kind==='node'){if(rot)n.rotation=+rot.toFixed(2);if(p.fx)n.flipX=true;if(p.fy)n.flipY=true}
      n.layer=layer;n.data={...(n.kind==='zone'?{}:dataOf(r)),...(n.data||{})};if(mname)n.data.visioMaster=mname;
      if(n.kind!=='zone'&&n.labels?.[0]){if(text)placeLabel(n.labels[0],r,env,p,X,Y,k,text);else n.labels=[]}
      idMap.set(el.getAttribute('ID'),n);page.items.push(n)}
    // glue connectors to what they connect (Connects: FromSheet = connector, ToSheet = shape)
    for(const c of pv.content.getElementsByTagName('Connect')){const e=idMap.get(c.getAttribute('FromSheet')),t=idMap.get(c.getAttribute('ToSheet'));if(!e||e.kind!=='edge'||!t||t.kind==='edge')continue;const cell=c.getAttribute('FromCell')||'',end=/^Begin/.test(cell)?0:/^End/.test(cell)?1:-1;if(end<0)continue;const ix=e._ports?.[end],port=ix!=null&&t.ports?.[ix]?.id||null;e[end?'to':'from']={node:t.id,port}}
    for(const e of edges)delete e._ports;
    // zones go to the back
    page.items=[...page.items.filter(n=>n.kind==='zone'),...page.items.filter(n=>n.kind!=='zone')]}
  for(const pv of v.pages){const page=pageMap.get(pv.id);if(pv.backPage&&pageMap.get(pv.backPage))page.background=pageMap.get(pv.backPage).id}
  if(Object.keys(stencils).length)doc.stencils=stencils;doc.meta.description=`Imported from ${file.name}`;
  if(!doc.pages.length)throw Error('This Visio file has no pages.');if(!doc.pages.some(p=>!p.isBackground))doc.pages[0].isBackground=false;
  return{doc,stats}}

// File ▸ Open / drop of a Visio drawing: open it as a new drawing or add its pages to this one.
async function openDrawing(file){notify('Reading '+file.name+'…',2000);let peek;try{peek=await load(file)}catch(err){return notify(err.message,6000)}
  const fg=peek.pages.filter(p=>!p.background),count=tag=>peek.pages.reduce((s,p)=>s+(p.content?p.content.getElementsByTagName(tag).length:0),0),
    glued=peek.pages.reduce((s,p)=>s+new Set([...p.content?.getElementsByTagName('Connect')||[]].map(c=>c.getAttribute('FromSheet'))).size,0);
  const d=openDialog('Visio drawing',`<p><b>${html(file.name)}</b> — ${fg.length} page${fg.length===1?'':'s'}${peek.pages.length>fg.length?` + ${peek.pages.length-fg.length} background`:''} · ${count('Shape')} shapes · ${glued} glued connector${glued===1?'':'s'} · ${peek.masters.size} masters</p>
    <p class="muted">Shapes keep their Visio look, connectors stay glued to their shapes, containers become zones, shape data becomes fields, and layers and background pages carry over. Everything is editable.</p>
    <label class="check"><input type="checkbox" id="vsDev" ${S.prefs.visioDevices?'checked':''}>Use Port's device icons for recognised network shapes (router, switch, firewall, server…) — they then get ports, design checks and the legend</label>
    <label class="check"><input type="checkbox" id="vsRoute">Re-route connectors around shapes (otherwise Visio's routes are kept)</label>
    <footer><button data-close>Cancel</button><span class="spacer"></span><button data-vs="add" ${items().length?'':'disabled'}>Add its pages to this drawing</button><button class="primary" data-vs="open">Open as a new drawing</button></footer>`);
  d.onclick=async e=>{if(e.target.closest('[data-close]'))return closeDialog();const b=e.target.closest('[data-vs]');if(!b)return;const opt={devices:$('vsDev').checked,reroute:$('vsRoute').checked};S.prefs.visioDevices=opt.devices;savePrefs();closeDialog();
    let res;try{res=await drawingToDoc(file,opt)}catch(err){console.error(err);return notify('Could not import: '+err.message,6000)}const{doc,stats}=res;
    if(b.dataset.vs==='open'){if(S.dirty&&!confirm('Open “'+file.name+'”? Unsaved changes stay recoverable with Undo.'))return;loadDocument(doc,{name:file.name})}
    else{Packs.installDoc(doc);const r=mutate(()=>Merge.insertPages(S.doc,doc,{after:S.pageIndex,avoidClash:false}));if(r)gotoPage(S.doc.pages.indexOf(r.pages[0]))}
    const bits=[`${stats.shapes+stats.devices+stats.restored} shapes`,`${stats.links} connectors`];if(stats.zones)bits.push(`${stats.zones} containers → zones`);if(stats.images)bits.push(`${stats.images} pictures`);if(stats.text)bits.push(`${stats.text} text blocks`);if(stats.devices)bits.push(`${stats.devices} as Port devices`);if(stats.restored)bits.push(`${stats.restored} restored as Port items`);
    notify(`Imported ${file.name}: ${bits.join(' · ')}.${stats.emf?` ${stats.emf} EMF/WMF picture${stats.emf>1?'s':''} can't be shown in a browser and appear as dashed boxes.`:''}`,8000)}}
const isStencil=name=>/\.(vssx|vssm)$/i.test(name),isDrawing=name=>/\.(vsdx|vsdm|vstx|vstm)$/i.test(name),isLegacy=name=>/\.(vsd|vss|vst)$/i.test(name);
return{load,stencilToPack,drawingToDoc,openDrawing,isStencil,isDrawing,isLegacy,deviceType,_:{geomPath,evalF,color,ellArc}};
})();
if(typeof module!=='undefined')module.exports=Visio;
