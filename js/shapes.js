// Shape catalogue: parametric basic shapes, rack elevations, link types, themes and colour palettes.
// Device artwork lives in stencils.js (Stencils.shapes); this module adds everything that is generated.
const NS='http://www.w3.org/2000/svg';
function el(tag,attrs={},parent){const n=document.createElementNS(NS,tag);for(const k in attrs){const v=attrs[k];if(v!==undefined&&v!==null&&v!==false)n.setAttribute(k,v)}parent?.append(n);return n}

const Shapes=(()=>{
const C=Core,f=v=>+v.toFixed(2);
const ST=()=>(typeof Stencils!=='undefined'?Stencils:{categories:[],shapes:{}});

// ---------- basic shapes (paths are rebuilt from w/h so strokes never distort) ----------
const rr=(w,h,r)=>{r=Math.min(r,w/2,h/2);return`M${r} 0H${f(w-r)}A${r} ${r} 0 0 1 ${w} ${r}V${f(h-r)}A${r} ${r} 0 0 1 ${f(w-r)} ${h}H${r}A${r} ${r} 0 0 1 0 ${f(h-r)}V${r}A${r} ${r} 0 0 1 ${r} 0Z`};
const basic={
  rect:{name:'Rectangle',w:120,h:70,paths:(w,h)=>[{d:`M0 0H${w}V${h}H0Z`}]},
  roundrect:{name:'Rounded rectangle',w:120,h:70,paths:(w,h)=>[{d:rr(w,h,10)}]},
  pill:{name:'Pill / terminator',w:130,h:50,paths:(w,h)=>[{d:rr(w,h,h/2)}]},
  ellipse:{name:'Ellipse',w:110,h:70,paths:(w,h)=>[{d:`M0 ${h/2}A${w/2} ${h/2} 0 1 0 ${w} ${h/2}A${w/2} ${h/2} 0 1 0 0 ${h/2}Z`}]},
  diamond:{name:'Decision',w:110,h:80,paths:(w,h)=>[{d:`M${w/2} 0L${w} ${h/2}L${w/2} ${h}L0 ${h/2}Z`}]},
  triangle:{name:'Triangle',w:90,h:80,paths:(w,h)=>[{d:`M${w/2} 0L${w} ${h}H0Z`}]},
  hexagon:{name:'Hexagon',w:110,h:80,paths:(w,h)=>{const k=Math.min(w*.25,h*.5);return[{d:`M${f(k)} 0H${f(w-k)}L${w} ${h/2}L${f(w-k)} ${h}H${f(k)}L0 ${h/2}Z`}]}},
  parallelogram:{name:'Parallelogram',w:120,h:70,paths:(w,h)=>{const k=Math.min(w*.2,24);return[{d:`M${k} 0H${w}L${f(w-k)} ${h}H0Z`}]}},
  cylinder:{name:'Cylinder',w:90,h:100,paths:(w,h)=>{const e=Math.min(h*.14,w*.18);return[{d:`M0 ${e}A${w/2} ${e} 0 0 1 ${w} ${e}V${f(h-e)}A${w/2} ${e} 0 0 1 0 ${f(h-e)}Z`},{d:`M0 ${e}A${w/2} ${e} 0 0 0 ${w} ${e}`,open:true}]}},
  document:{name:'Document',w:110,h:80,paths:(w,h)=>{const k=h*.12;return[{d:`M0 0H${w}V${f(h-k)}C${f(w*.75)} ${f(h-3*k)} ${f(w*.25)} ${f(h+k)} 0 ${f(h-k)}Z`}]}},
  note:{name:'Sticky note',w:140,h:110,fill:'#fff7c2',stroke:'#c9a227',paths:(w,h)=>{const k=Math.min(18,w/4,h/4);return[{d:`M0 0H${w}V${f(h-k)}L${f(w-k)} ${h}H0Z`},{d:`M${f(w-k)} ${h}V${f(h-k)}H${w}`,open:true}]}},
  cloudshape:{name:'Cloud outline',w:150,h:90,paths:(w,h)=>{const X=v=>f(v*w),Y=v=>f(v*h);return[{d:`M${X(.24)} ${Y(.92)}C${X(.04)} ${Y(.92)} ${X(0)} ${Y(.6)} ${X(.17)} ${Y(.53)}C${X(.12)} ${Y(.24)} ${X(.42)} ${Y(.08)} ${X(.55)} ${Y(.28)}C${X(.66)} ${Y(.02)} ${X(.98)} ${Y(.14)} ${X(.9)} ${Y(.46)}C${X(1.02)} ${Y(.56)} ${X(.99)} ${Y(.92)} ${X(.78)} ${Y(.92)}Z`}]}},
  arrow:{name:'Block arrow',w:130,h:60,paths:(w,h)=>{const k=Math.min(w*.35,h*.9);return[{d:`M0 ${f(h*.28)}H${f(w-k)}V0L${w} ${h/2}L${f(w-k)} ${h}V${f(h*.72)}H0Z`}]}},
  chevron:{name:'Chevron / stage',w:130,h:60,paths:(w,h)=>{const k=Math.min(w*.25,h*.5);return[{d:`M0 0H${f(w-k)}L${w} ${h/2}L${f(w-k)} ${h}H0L${f(k)} ${h/2}Z`}]}},
  frame:{name:'Frame / boundary',w:220,h:150,fill:'none',dash:'6 4',paths:(w,h)=>[{d:`M0 0H${w}V${h}H0Z`}]},
  // revision markup: scalloped cloud around a change, and the delta triangle carrying the revision it belongs to
  revcloud:{name:'Revision cloud',w:200,h:120,fill:'none',stroke:'#dc2626',paths:(w,h)=>[{d:revCloud(w,h)}]},
  revdelta:{name:'Revision delta',w:30,h:26,fill:'#ffffff',stroke:'#dc2626',paths:(w,h)=>[{d:`M${f(w/2)} 0L${w} ${h}H0Z`}]},
};
// Scallops of similar size all round the box, bulging outwards (clockwise arcs).
function revCloud(w,h){const r=Math.max(5,Math.min(14,Math.min(w,h)/5)),nx=Math.max(1,Math.round(w/(2*r))),ny=Math.max(1,Math.round(h/(2*r))),sx=w/nx,sy=h/ny,a=(c,dx,dy)=>`A${f(c*.62)} ${f(c*.62)} 0 0 1 `;let d='M0 0';
  for(let i=1;i<=nx;i++)d+=a(sx)+`${f(i*sx)} 0`;for(let j=1;j<=ny;j++)d+=a(sy)+`${w} ${f(j*sy)}`;for(let i=nx-1;i>=0;i--)d+=a(sx)+`${f(i*sx)} ${h}`;for(let j=ny-1;j>=0;j--)d+=a(sy)+`0 ${f(j*sy)}`;return d+'Z'}

// ---------- rack elevations ----------
const RU=18,RACK={rail:16,top:26,bottom:16,inner:190,side:28,roof:22};
// fam: the name without a height (spreadsheets, the Add to rack dialog). mount: 'side' (0U, in a side channel) or
// 'roof' (on the cabinet roof); others sit in U slots. w/h: the size of a mount type, which has no U height.
const rackItems={
  'rk-server':{name:'Server 1U',fam:'Server',u:1,face:'server'},'rk-server2':{name:'Server 2U',fam:'Server',u:2,face:'server'},'rk-blade':{name:'Blade chassis 6U',fam:'Blade chassis',u:6,face:'blade'},
  'rk-storage':{name:'Storage array 2U',fam:'Storage array',u:2,face:'storage'},'rk-nvr':{name:'NVR / recorder 2U',fam:'NVR / recorder',u:2,face:'storage'},
  'rk-switch':{name:'Switch 1U · 48p',fam:'Switch 48-port',u:1,face:'switch'},'rk-switch24':{name:'Switch 1U · 24p',fam:'Switch 24-port',u:1,face:'switch24'},'rk-router':{name:'Router 2U',fam:'Router',u:2,face:'router'},'rk-firewall':{name:'Firewall 1U',fam:'Firewall',u:1,face:'firewall'},
  'rk-patch':{name:'Patch panel 1U',fam:'Patch panel',u:1,face:'patch'},'rk-fiber':{name:'Fibre panel 1U',fam:'Fibre panel',u:1,face:'fiber'},'rk-cable':{name:'Cable manager 1U',fam:'Cable manager',u:1,face:'cable'},
  'rk-ups':{name:'UPS 2U',fam:'UPS',u:2,face:'ups'},'rk-pdu':{name:'PDU 1U (horizontal)',fam:'PDU (horizontal)',u:1,face:'pdu'},'rk-kvm':{name:'KVM console 1U',fam:'KVM console',u:1,face:'kvm'},'rk-shelf':{name:'Shelf 2U',fam:'Shelf',u:2,face:'shelf'},'rk-blank':{name:'Blanking panel 1U',fam:'Blanking panel',u:1,face:'blank'},
  // accessories
  'rk-blank2':{name:'Blanking panel 2U',fam:'Blanking panel',u:2,face:'blank'},'rk-cable2':{name:'Cable manager 2U',fam:'Cable manager',u:2,face:'cable'},'rk-brush':{name:'Brush panel 1U',fam:'Brush panel',u:1,face:'brush'},'rk-tray':{name:'Vented cable tray 1U',fam:'Vented cable tray',u:1,face:'tray'},'rk-fan':{name:'Fan tray 1U (in rack)',fam:'Fan tray (in rack)',u:1,face:'fan'},
  'rk-ats':{name:'Transfer switch (ATS) 1U',fam:'Transfer switch (ATS)',u:1,face:'ats'},'rk-drawer':{name:'Drawer 2U',fam:'Drawer',u:2,face:'drawer'},'rk-monitor':{name:'LCD monitor 1U',fam:'LCD monitor',u:1,face:'monitor'},'rk-kvmsw':{name:'KVM switch 1U',fam:'KVM switch',u:1,face:'kvmsw'},
  // outside the U space
  'rk-vpdu':{name:'PDU 0U (vertical)',fam:'PDU 0U (vertical)',u:0,mount:'side',w:20,h:24*RU,face:'vpdu',tags:'pdu vertical 0u zero-u power strip side channel'},
  'rk-rooffan':{name:'Roof fan tray',fam:'Roof fan tray',u:0,mount:'roof',w:170,h:16,face:'rooffan',tags:'fan roof top cooling ventilation tray'},
};
const rackSize=units=>({w:RACK.inner+2*RACK.rail,h:units*RU+RACK.top+RACK.bottom});
// The cabinet of one rack: 0U side channels outside the rails (r.sides) and a roof band for a fan tray (r.roof) are
// optional, so drawings made before them keep exactly the same geometry.
function rackFrame(r){const side=r.sides?RACK.side:0,roof=r.roof?RACK.roof:0;return{side,roof,w:RACK.inner+2*(RACK.rail+side),h:(r.units||42)*RU+RACK.top+RACK.bottom+roof}}
// A rack can show its front, rear and top (plan) views side by side; the front stays at the left, where equipment sits.
const RGAP=28,MM=RACK.inner/483;
function rackDims(n){const f=rackFrame(n),v=n.views||{},depth=+n.data?.depth||1000,topH=Math.round(depth*MM)+44;let x=f.w+RGAP;const rear=v.rear?x:null;if(v.rear)x+=f.w+RGAP;const top=v.top?x:null;if(v.top)x+=f.w+RGAP;
  return{front:f,rear,top,topH,w:x-RGAP,h:Math.max(f.h,v.top?topH:0)}}
const rackInner=r=>{const f=rackFrame(r);return{x:r.x+f.side+RACK.rail,y:r.y+f.roof+RACK.top,w:RACK.inner,h:(r.units||42)*RU}};
// Where an item of the rack is drawn in the rear view (x, from the rack's left): mirrored, as seen from behind.
const rearX=(r,it)=>{const f=rackFrame(r);return rackDims(r).rear+f.w-(it.x-r.x)-it.w};
// U position (1 = bottom) of an equipment box inside a rack.
const rackU=(r,n)=>{const i=rackInner(r);return Math.round((i.y+i.h-(n.y+n.h))/RU)+1};
// items: the rack's U equipment — drawn again, seen from the back, in the rear view; extras: its 0U side PDUs and roof
// fan tray, mirrored there (left and right always mean as seen from the front); nameOf resolves labels.
// opts.interactive: on screen, empty side channels and an empty roof show where 0U PDUs and a fan tray go.
function drawRack(n,g,items=[],nameOf=x=>x.labels?.[0]?.text||'',extras=[],opts={}){const D=rackDims(n),F=D.front;
  const used=k=>extras.some(it=>{const cx=it.x-n.x+it.w/2,cy=it.y-n.y+it.h/2;return k==='roof'?cy<F.roof:k==='left'?cx<F.side:cx>F.w-F.side});
  const empty=opts.interactive?{left:!!F.side&&!used('left'),right:!!F.side&&!used('right'),roof:!!F.roof&&!used('roof')}:{};
  drawRackFrame(n,g,0,'FRONT',empty);
  if(D.rear!=null){const rg=el('g',{transform:`translate(${D.rear} 0)`},g);drawRackFrame(n,rg,0,'REAR',{left:empty.right,right:empty.left,roof:empty.roof});for(const it of items){const t=el('g',{transform:`translate(${f(F.w-(it.x-n.x)-it.w)} ${f(it.y-n.y)})`},rg);drawRear(it,t,it.labels?.some(l=>l.view==='rear')?'':nameOf(it),(+it.data?.depth||RACK_DEPTH[it.type]||400)<(+n.data?.depth||1000)*.4)}
    for(const it of extras){const t=el('g',{transform:`translate(${f(F.w-(it.x-n.x)-it.w)} ${f(it.y-n.y)})`},rg);drawFace(it,t);const nm=String(nameOf(it)||'').split('\n')[0];if(!nm)continue;
      const side=rackItems[it.type]?.mount==='side',e=el('text',side?{x:0,y:0,transform:`translate(${f(8+8.5*.36)} ${f(it.h/2)}) rotate(-90)`,'text-anchor':'middle','font-size':8.5,fill:'#1e293b','font-family':C.FONT}:{x:6,y:f(it.h/2+3),'font-size':8.5,fill:'#1e293b','font-family':C.FONT},t);e.textContent=nm}}
  if(D.top!=null)drawRackTop(n,el('g',{transform:`translate(${D.top} 0)`},g),items,D,extras)}
const RACK_DEPTH={'rk-patch':120,'rk-fiber':250,'rk-cable':90,'rk-cable2':90,'rk-blank':20,'rk-blank2':20,'rk-brush':40,'rk-pdu':60,'rk-switch':350,'rk-switch24':300,'rk-firewall':350,'rk-router':450,'rk-server':700,'rk-server2':750,'rk-blade':800,'rk-storage':650,'rk-nvr':500,'rk-ups':650,'rk-kvm':650,'rk-monitor':650,'rk-kvmsw':250,'rk-shelf':500,'rk-tray':600,'rk-fan':350,'rk-ats':300,'rk-drawer':500};
// empty: {left, right, roof} — on screen only, a faint marker where 0U PDUs / the fan tray would go
function drawRackFrame(n,g,_,caption,empty={}){const units=n.units||42,s=n.stroke||'#475569',F=rackFrame(n),W=F.w,H=F.h,sd=F.side,rf=F.roof,i={x:sd+RACK.rail,y:rf+RACK.top,w:RACK.inner,h:units*RU};
  el('rect',{x:0,y:rf,width:W,height:H-rf,rx:5,fill:n.fill||'#f1f5f9',stroke:s,'stroke-width':2},g);
  el('rect',{x:i.x,y:i.y,width:i.w,height:i.h,fill:'#ffffff',stroke:s,'stroke-width':.8,'stroke-opacity':.6},g);
  const lines=[];for(let u=1;u<units;u++)lines.push(`M${i.x} ${f(i.y+u*RU)}H${i.x+i.w}`);el('path',{d:lines.join(''),stroke:s,'stroke-opacity':.13,'stroke-width':.8},g);
  for(const x of[sd+3,W-sd-RACK.rail+3])el('rect',{x,y:i.y,width:RACK.rail-6,height:i.h,fill:s,'fill-opacity':.12},g);
  for(let u=1;u<=units;u++){const y=i.y+(units-u)*RU+RU/2+3,t=el('text',{x:sd+RACK.rail/2,y,'text-anchor':'middle','font-size':7.5,fill:s,'font-family':C.FONT},g);t.textContent=u;const t2=el('text',{x:W-sd-RACK.rail/2,y,'text-anchor':'middle','font-size':7.5,fill:s,'font-family':C.FONT},g);t2.textContent=u}
  // 0U side channels: the cabinet space outside the rails where vertical PDUs hang
  if(sd)for(const[k,x]of[['left',2],['right',W-sd+2]]){el('rect',{x,y:i.y,width:sd-4,height:i.h,rx:2,fill:s,'fill-opacity':.05,stroke:s,'stroke-opacity':.22,'stroke-width':.6,'stroke-dasharray':'2 3'},g);
    if(empty[k]){const t=el('text',{x:0,y:0,transform:`translate(${f(x+(sd-4)/2+3)} ${f(i.y+i.h/2)}) rotate(-90)`,'text-anchor':'middle','font-size':8,'letter-spacing':1,fill:s,'fill-opacity':.5,'font-family':C.FONT},g);t.textContent='0U PDU'}}
  if(rf&&empty.roof){el('rect',{x:i.x+10,y:3,width:170,height:16,rx:2.5,fill:'none',stroke:s,'stroke-opacity':.45,'stroke-dasharray':'3 3'},g);const t=el('text',{x:i.x+95,y:14,'text-anchor':'middle','font-size':8,fill:s,'fill-opacity':.55,'font-family':C.FONT},g);t.textContent='Roof fan tray'}
  el('rect',{x:8,y:rf+6,width:W-16,height:RACK.top-12,rx:3,fill:s,'fill-opacity':.85},g);
  if(caption&&(n.views?.rear||n.views?.top)){const t=el('text',{x:W/2,y:rf+RACK.top/2+3.5,'text-anchor':'middle','font-size':9,'font-weight':700,'letter-spacing':1.5,fill:'#fff','font-family':C.FONT},g);t.textContent=caption}
  for(const x of[10,W-30])el('rect',{x,y:H-RACK.bottom+4,width:20,height:RACK.bottom-6,rx:2,fill:s,'fill-opacity':.6},g);
}
// Rear of a unit: ports, fans and power supplies on active gear, kept to the right so the left stays clear for the
// unit's rear label (as on the front); shallow front-mounted panels are shown faded.
function drawRear(n,g,name,shallow){const w=n.w,h=n.h,s=n.stroke||'#475569',face=rackItems[n.type]?.face||'blank',dark='#334155';
  el('rect',{x:0,y:0,width:w,height:h,rx:1.5,fill:shallow?'none':n.fill||'#e2e8f0',stroke:s,'stroke-width':1,'stroke-dasharray':shallow?'3 2':null,opacity:shallow?.55:1},g);
  const passive=['patch','fiber','cable','blank','brush','shelf','tray','drawer'].includes(face);
  if(!passive&&!shallow){const r=Math.min(h/2-2.5,5.5),pw=Math.min(18,w*.095);for(let k=0;k<2;k++){const px=w-4-pw-k*(pw+2);el('rect',{x:f(px),y:2.5,width:f(pw),height:h-5,rx:1.5,fill:'#cbd5e1',stroke:s,'stroke-width':.6},g);el('rect',{x:f(px+pw-6),y:h/2-2,width:4,height:4,fill:dark},g)}
    for(let k=0;k<2;k++)el('circle',{cx:f(w-4-2*(pw+2)-r-2-k*(2*r+2)),cy:f(h/2),r:f(r),fill:'none',stroke:dark,'stroke-width':.8},g);
    let d='';for(let k=0;k<4;k++)d+=`M${f(w*.47+k*7)} ${f(h/2-1.6)}h4.5v3.2h-4.5z`;el('path',{d,fill:dark},g)}
  else if(!shallow){el('path',{d:`M${f(w*.47)} ${f(h/2)}H${w-6}`,stroke:dark,'stroke-width':1.2,'stroke-dasharray':'2 3'},g)}
  if(name&&h>=RU){const t=el('text',{x:12,y:h/2+3,'font-size':Math.min(8.5,h*.5),fill:dark,'fill-opacity':shallow?.5:.85,'font-family':C.FONT},g);t.textContent=name}}
// Plan view: cabinet outline, doors, mounting rails and each unit's depth from the front rail, deepest called out.
function drawRackTop(n,g,items,D,extras=[]){const s=n.stroke||'#475569',F=rackFrame(n),W=F.w,sd=F.side,depth=+n.data?.depth||1000,usable=depth-150,k=MM,y0=22,Hd=Math.round(depth*k);
  el('rect',{x:0,y:0,width:W,height:Hd+y0*2,rx:5,fill:n.fill||'#f1f5f9',stroke:s,'stroke-width':2},g);
  const cap=(t,y)=>{const e=el('text',{x:W/2,y,'text-anchor':'middle','font-size':8.5,'font-weight':700,'letter-spacing':1.2,fill:s,'font-family':C.FONT},g);e.textContent=t};cap('FRONT · TOP VIEW',14);cap(`REAR · ${+n.data?.width||600} × ${depth} mm`,y0*2+Hd-8);
  el('rect',{x:sd+RACK.rail,y:y0,width:RACK.inner,height:Hd,fill:'#ffffff',stroke:s,'stroke-width':.8,'stroke-opacity':.6},g);
  const fr=y0+Math.round(40*k),rr=fr+Math.round(usable*k);for(const y of[fr,rr])el('path',{d:`M${sd+RACK.rail-4} ${y}H${W-sd-RACK.rail+4}`,stroke:s,'stroke-width':2.2},g);
  const eq=items.map(it=>({it,d:+it.data?.depth||RACK_DEPTH[it.type]||400})).sort((a,b)=>b.d-a.d);
  for(const{it,d}of eq){const over=d>usable;el('rect',{x:sd+RACK.rail+3,y:fr,width:RACK.inner-6,height:Math.round(Math.min(d,depth-40)*k),fill:over?'#dc2626':it.fill||'#94a3b8','fill-opacity':.08,stroke:over?'#dc2626':s,'stroke-width':.6,'stroke-opacity':.5},g)}
  if(eq.length){const top=eq[0],y=fr+Math.round(Math.min(top.d,depth-40)*k),t=el('text',{x:W/2,y:y-4,'text-anchor':'middle','font-size':8,fill:top.d>usable?'#dc2626':s,'font-family':C.FONT},g);t.textContent=`deepest ${top.d} mm${top.d>usable?' — too deep':''} · ${eq.length} units`}
  // seen from above with the front at the top, a PDU on the left (from the front) is on the right of the plan
  for(const it of extras){if(rackItems[it.type]?.mount==='side'){el('rect',{x:f(W-(it.x-n.x)-it.w),y:rr-26,width:it.w,height:24,rx:2,fill:'#f59e0b','fill-opacity':.22,stroke:s,'stroke-width':.8},g);continue}
    const nf=Math.max(1,Math.min(6,+it.data?.fans||4)),y=y0+Math.round(Hd*.72);for(let j=0;j<nf;j++){const cx=sd+RACK.rail+RACK.inner*(j+.5)/nf;el('circle',{cx:f(cx),cy:y,r:6,fill:'#e0f2fe',stroke:s,'stroke-width':.8},g);el('path',{d:`M${f(cx-4)} ${y}h8M${f(cx)} ${y-4}v8`,stroke:s,'stroke-width':.6},g)}}
  let a='';for(const x of[sd+10,W-sd-10])a+=`M${x} ${y0+10}V${y0+Hd-10}M${x-3} ${y0+Hd-15}l3 5 3-5`;el('path',{d:a,stroke:'#0ea5e9','stroke-width':1.2,fill:'none'},g)}
function drawFace(n,g){
  const w=n.w,h=n.h,face=rackItems[n.type]?.face||'blank',s=n.stroke||'#475569',body=n.fill||'#e2e8f0',dark='#334155',led='#22c55e';
  // vertical 0U PDU: inlet at the top, one outlet per U (a larger C19 every 6th); the left part carries the label
  if(face==='vpdu'){el('rect',{x:0,y:0,width:w,height:h,rx:2,fill:body,stroke:s,'stroke-width':1},g);el('rect',{x:2,y:2,width:w-4,height:12,rx:1.5,fill:dark},g);el('circle',{cx:w-5.5,cy:8,r:1.6,fill:'#f59e0b'},g);
    let d='';for(let k=0,m=Math.floor((h-18)/RU);k<m;k++){const big=k%6===5,ow=big?6:5,oh=big?8:6,y=18+k*RU+(RU-oh)/2;d+=`M${w-8} ${f(y)}h${ow}v${oh}h${-ow}z`}el('path',{d,fill:dark,'fill-opacity':.8},g);return}
  // roof fan tray: 1–6 fans to the right of the label
  if(face==='rooffan'){el('rect',{x:0,y:0,width:w,height:h,rx:2.5,fill:body,stroke:s,'stroke-width':1},g);const k=Math.max(1,Math.min(6,+n.data?.fans||4)),x0=w*.3,x1=w-6,r=Math.min(h/2-2,(x1-x0)/k/2-1.5);
    for(let j=0;j<k;j++){const cx=x0+(x1-x0)*(j+.5)/k;el('circle',{cx:f(cx),cy:h/2,r:f(r),fill:'#f8fafc',stroke:dark,'stroke-width':.9},g);el('path',{d:`M${f(cx-r*.7)} ${f(h/2)}h${f(r*1.4)}M${f(cx)} ${f(h/2-r*.7)}v${f(r*1.4)}`,stroke:dark,'stroke-width':.6},g);el('circle',{cx:f(cx),cy:h/2,r:1.3,fill:dark},g)}return}
  el('rect',{x:0,y:0,width:w,height:h,rx:1.5,fill:body,stroke:s,'stroke-width':1},g);
  for(const x of[1.5,w-7.5]){el('rect',{x,y:1.5,width:6,height:h-3,fill:s,'fill-opacity':.18},g);el('circle',{cx:x+3,cy:h/2,r:1.4,fill:s,'fill-opacity':.6},g)}
  const x0=w*.46,x1=w-12,bw=x1-x0,mid=h/2;
  const ports=(n0,rows,x,wid,pw=3.2,ph=3)=>{const step=wid/n0,top=mid-(rows*ph+(rows-1)*1.4)/2;let d='';for(let r=0;r<rows;r++)for(let k=0;k<n0;k++)d+=`M${f(x+k*step)} ${f(top+r*(ph+1.4))}h${pw}v${ph}h${-pw}z`;el('path',{d,fill:dark},g)};
  const vents=(x,wid,y0=4,y1=h-4)=>{let d='';for(let x2=x;x2<x+wid;x2+=4)d+=`M${f(x2)} ${y0}V${y1}`;el('path',{d,stroke:s,'stroke-opacity':.35,'stroke-width':1},g)};
  const leds=(x,colors=[led])=>colors.forEach((c,k)=>el('circle',{cx:x+k*5,cy:Math.min(6,h/2),r:1.6,fill:c},g));
  if(face==='server'||face==='blade'){const bays=face==='blade'?8:4,rows=face==='blade'?1:Math.max(1,Math.round(h/RU)),bwid=(bw*.7)/bays;for(let r=0;r<rows;r++)for(let k=0;k<bays;k++){const by=face==='blade'?4:3+r*(h-6)/rows,bh=face==='blade'?h-8:(h-6)/rows-2;el('rect',{x:f(x0+k*bwid),y:f(by),width:f(bwid-2.5),height:f(bh),rx:1,fill:'#f8fafc',stroke:s,'stroke-width':.6},g);el('rect',{x:f(x0+k*bwid+bwid*.15),y:f(by+bh-3.5),width:f(bwid*.5),height:1.6,fill:led},g)}vents(x0+bw*.72,bw*.26);leds(x0-12,[led,'#38bdf8'])}
  else if(face==='storage'){const rows=Math.max(1,Math.round(h/RU)),cols=6,cw=bw/cols;for(let r=0;r<rows;r++)for(let k=0;k<cols;k++)el('rect',{x:f(x0+k*cw),y:f(3+r*(h-6)/rows),width:f(cw-2),height:f((h-6)/rows-2),rx:1,fill:'#f8fafc',stroke:s,'stroke-width':.6},g);leds(x0-12,[led,'#f59e0b'])}
  else if(face==='switch'||face==='switch24'){ports(face==='switch'?24:12,2,x0,bw*.8);ports(4,1,x0+bw*.84,bw*.16,4.5,3.4);leds(x0-12,[led,led])}
  else if(face==='router'){ports(8,1,x0,bw*.45,4.5,3.8);for(let k=0;k<2;k++)el('rect',{x:f(x0+bw*.5+k*bw*.25),y:4,width:f(bw*.22),height:h-8,rx:1.5,fill:'#f8fafc',stroke:s,'stroke-width':.7},g);leds(x0-12,[led,'#38bdf8'])}
  else if(face==='firewall'){el('rect',{x:x0-16,y:2,width:3,height:h-4,fill:'#dc2626'},g);ports(8,1,x0,bw*.6,4.2,3.6);ports(2,1,x0+bw*.7,bw*.25,5,3.6);leds(x0-10,[led])}
  else if(face==='patch'){ports(24,1,x0,bw,3,3.4)}
  else if(face==='fiber'){let d='';for(let k=0;k<12;k++){const x=x0+k*(bw/12);d+=`M${f(x)} ${f(mid-2)}h5v4h-5z`}el('path',{d,fill:'#0ea5e9'},g)}
  else if(face==='cable'){for(let k=0;k<5;k++)el('rect',{x:f(x0+k*(bw/5)),y:3,width:f(bw*.14),height:h-6,rx:3,fill:'none',stroke:dark,'stroke-width':1.2},g)}
  else if(face==='ups'){el('rect',{x:x0,y:4,width:bw*.3,height:h-8,rx:1.5,fill:'#0f172a'},g);el('rect',{x:x0+3,y:7,width:bw*.3-6,height:5,fill:led,'fill-opacity':.7},g);vents(x0+bw*.38,bw*.6);leds(x0-12,[led,'#f59e0b'])}
  else if(face==='pdu'){let d='';for(let k=0;k<8;k++)d+=`M${f(x0+k*bw/8)} ${f(mid-3)}h7v6h-7z`;el('path',{d,fill:dark},g);leds(x0-12,['#f59e0b'])}
  else if(face==='kvm'){el('rect',{x:x0,y:3,width:bw,height:h-6,rx:2,fill:'#0f172a'},g);let d='';for(let k=0;k<14;k++)d+=`M${f(x0+4+k*(bw-8)/14)} ${f(mid)}h4`;el('path',{d,stroke:'#94a3b8','stroke-width':1.4},g)}
  else if(face==='shelf'){el('path',{d:`M${x0} ${h-5}H${x1}`,stroke:dark,'stroke-width':1.5},g)}
  else if(face==='brush'){let d='';for(let x=x0-40;x<x1;x+=2.2)d+=`M${f(x)} ${f(mid-3)}V${f(mid+3)}`;el('path',{d,stroke:dark,'stroke-width':.6,'stroke-opacity':.7},g)}
  else if(face==='tray'){let d='';for(let x=x0-40;x<x1;x+=6)d+=`M${f(x)} 4h3v${h-8}h-3z`;el('path',{d,fill:dark,'fill-opacity':.35},g)}
  else if(face==='fan'){for(let k=0;k<4;k++){const cx=x0-20+k*(bw+20)/4+12;el('circle',{cx:f(cx),cy:f(mid),r:f(Math.min(h/2-2,7)),fill:'none',stroke:dark,'stroke-width':1},g);el('circle',{cx:f(cx),cy:f(mid),r:1.5,fill:dark},g)}leds(x0-30,[led])}
  else if(face==='ats'){ports(4,1,x0,bw*.5,5,4);el('rect',{x:x0+bw*.6,y:3,width:bw*.3,height:h-6,rx:1.5,fill:'#0f172a'},g);leds(x0-12,[led,'#f59e0b'])}
  else if(face==='drawer'){el('rect',{x:x0-40,y:3,width:bw+40,height:h-6,rx:2,fill:'none',stroke:dark,'stroke-width':.9},g);el('rect',{x:w/2-14,y:mid-2,width:28,height:4,rx:2,fill:dark},g)}
  else if(face==='monitor'){el('rect',{x:x0-30,y:3,width:bw*.5,height:h-6,rx:1.5,fill:'#1e3a8a'},g);el('rect',{x:x0+bw*.3,y:mid-1.5,width:bw*.5,height:3,rx:1.5,fill:dark},g)}
  else if(face==='kvmsw'){ports(8,1,x0,bw*.7,4,3.6);leds(x0-12,[led,'#38bdf8'])}
}

// ---------- link (connector) types ----------
const linkTypes={
  eth:{name:'Ethernet · 1G copper',short:'1G copper',stroke:'#4a6fa5',width:2,dash:'',speed:'1G',media:'Cat6'},
  fiber10:{name:'10G fibre',short:'10G fibre',stroke:'#ef6b32',width:2.5,dash:'',speed:'10G',media:'OM4 / SMF'},
  fiber100:{name:'40/100G fibre',short:'40/100G fibre',stroke:'#b91c1c',width:3.5,dash:'',speed:'100G',media:'SMF'},
  stack:{name:'Stack / LAG / port-channel',short:'Stack / LAG',stroke:'#1e3a8a',width:2.25,dash:'',double:true,speed:'',media:'DAC'},
  wan:{name:'WAN / MPLS circuit',short:'WAN / MPLS',stroke:'#7c3aed',width:2.5,dash:'',speed:'',media:'Leased line'},
  internet:{name:'Internet / ISP',short:'Internet',stroke:'#0f766e',width:2.5,dash:'',speed:'',media:'Fibre'},
  vpn:{name:'VPN / IPsec tunnel',short:'VPN tunnel',stroke:'#16a34a',width:2,dash:'9 5',speed:'',media:'Tunnel'},
  wireless:{name:'Wireless / radio',short:'Wireless',stroke:'#0891b2',width:2,dash:'2 5',speed:'',media:'Wi-Fi / RF'},
  ha:{name:'HA / heartbeat',short:'HA link',stroke:'#dc2626',width:1.75,dash:'6 4',speed:'1G',media:'Cat6'},
  mgmt:{name:'Management / OOB',short:'Management',stroke:'#5d8fbc',width:1.5,dash:'7 5',speed:'1G',media:'Cat6'},
  serial:{name:'Serial / console',short:'Serial',stroke:'#6b7280',width:1.5,dash:'1 4',speed:'',media:'RS-232'},
  fieldbus:{name:'Fieldbus / RS-485',short:'Fieldbus',stroke:'#a16207',width:1.75,dash:'12 3 2 3',speed:'',media:'RS-485'},
  power:{name:'Power feed',short:'Power',stroke:'#ca8a04',width:1.75,dash:'10 4 2 4',speed:'',media:'Power'},
  logical:{name:'Logical flow',short:'Logical flow',stroke:'#64748b',width:1.5,dash:'4 4',endMarker:'arrow',speed:'',media:''},
};
// doc: when given, its linkStyles (set from the legend) override the type's default look
function applyLinkType(e,id,doc){const t=linkTypes[id];if(!t)return;e.linkType=id;e.stroke=t.stroke;e.strokeWidth=t.width;e.dash=t.dash;e.double=!!t.double;const o=doc?.linkStyles?.[id];if(o){if(o.stroke)e.stroke=o.stroke;if(o.width)e.strokeWidth=o.width;if(o.dash!=null)e.dash=o.dash;if(o.double!=null)e.double=!!o.double}if(t.endMarker)e.endMarker=t.endMarker;e.data??={};if(t.speed&&!e.data.speed)e.data.speed=t.speed;if(t.media&&!e.data.media)e.data.media=t.media}
// "10G", "2.5 Gbps", "100M" → Mbps
function speedMbps(s){const m=/([\d.]+)\s*([kmgt])?/i.exec(String(s??''));if(!m)return null;const v=+m[1],u=(m[2]||'m').toLowerCase();return v*({k:.001,m:1,g:1000,t:1e6}[u])}

// ---------- palettes & themes ----------
const STATUS={Existing:'#64748b',New:'#16a34a',Planned:'#2563eb','To remove':'#dc2626',Spare:'#a16207'};
const PALETTE=['#2563eb','#16a34a','#ea580c','#7c3aed','#0891b2','#db2777','#ca8a04','#475569','#dc2626','#0d9488','#9333ea','#65a30d'];
const CATEGORY={network:'#2563eb',security:'#dc2626',compute:'#7c3aed',cloud:'#0891b2',endpoints:'#475569',surveillance:'#ea580c',ot:'#a16207',telecom:'#0d9488',sites:'#64748b',power:'#ca8a04'};
const themes={
  port:{name:'Port classic',page:'#ffffff',device:{stroke:'#2f5ea8',fill:'#ffffff',display:'symbol'},label:'#34465e',zones:[['#eef4fc','#adc0d7'],['#fff4e9','#e3c4a3'],['#eef6f4','#a9cfc3'],['#f2f3fb','#b9bde3'],['#f1f4f8','#adc0d7']]},
  ocean:{name:'Ocean',page:'#ffffff',device:{stroke:'#0e7490',fill:'#ffffff',display:'circle'},label:'#164e63',zones:[['#ecfeff','#a5f3fc'],['#f0f9ff','#bae6fd'],['#f0fdfa','#99f6e4'],['#eff6ff','#bfdbfe']]},
  vivid:{name:'Vivid tiles',page:'#ffffff',device:{stroke:'category',fill:'#ffffff',display:'tile'},label:'#1e293b',zones:[['#f8fafc','#cbd5e1'],['#fff7ed','#fdba74'],['#f0fdf4','#86efac'],['#eef2ff','#a5b4fc'],['#fdf2f8','#f9a8d4']]},
  graphite:{name:'Graphite (print)',page:'#ffffff',device:{stroke:'#1f2937',fill:'#ffffff',display:'symbol'},label:'#111827',links:'#374151',zones:[['#f9fafb','#9ca3af'],['#f3f4f6','#9ca3af']]},
  noc:{name:'NOC dark',page:'#0b1220',device:{stroke:'#38bdf8',fill:'#0b1220',display:'symbol'},label:'#e2e8f0',zones:[['#0f1b33','#1e3a5f'],['#131a2e','#3b3f73'],['#0f2229','#1f4d57'],['#1f1630','#4c2f6b']]},
  blueprint:{name:'Blueprint',page:'#0d3b66',device:{stroke:'#e0f2fe',fill:'#0d3b66',display:'symbol'},label:'#e0f2fe',links:'#bae6fd',zones:[['#0f4475','#7dd3fc'],['#0e4a7e','#93c5fd']]},
};
function applyTheme(doc,id){
  const t=themes[id];if(!t)return;doc.theme=id;
  for(const p of doc.pages){p.bg=t.page;let z=0;
    for(const n of p.items){
      const lab=l=>l.color=t.label;
      if(n.kind==='node'&&!n.image&&!basic[n.type]&&n.type!=='rack'&&!rackItems[n.type]){const cat=ST().shapes[n.type]?.cat;n.stroke=t.device.stroke==='category'?CATEGORY[cat]||'#2563eb':t.device.stroke;n.fill=t.device.fill;n.display=t.device.display;const ts=doc.typeStyles?.[n.type];if(ts?.stroke)n.stroke=ts.stroke;if(ts?.display)n.display=ts.display}
      if(n.kind==='node'&&basic[n.type]&&n.type!=='note'&&n.type!=='revcloud'&&n.type!=='revdelta'){n.stroke=t.device.stroke==='category'?'#475569':t.device.stroke;n.fill=t.page==='#ffffff'?'#ffffff':t.zones[0][0]}
      if(n.kind==='zone'){const[a,b]=t.zones[z++%t.zones.length];n.fill=a;n.stroke=b}
      if(n.kind==='edge'&&t.links)n.stroke=t.links;else if(n.kind==='edge'&&linkTypes[n.linkType])n.stroke=doc.linkStyles?.[n.linkType]?.stroke||linkTypes[n.linkType].stroke;
      if(n.kind==='text'||n.kind==='zone'||n.kind==='edge'||n.kind==='node'){if(!(n.kind==='node'&&rackItems[n.type]))(n.labels||[]).forEach(lab)}
      if(n.kind==='table'){n.color=t.label;n.stroke=t.zones[0][1];n.headerFill=t.zones[0][0];n.fill=t.page}
      if(n.kind==='legend'){n.color=t.label;n.fill=t.page;n.stroke=t.zones[0][1]}
    }}}

// ---------- catalogue ----------
const ANNOTATIONS=[{type:'ann:text',name:'Text block'},{type:'ann:callout',name:'Callout'},{type:'ann:zone',name:'Network zone'},{type:'ann:table',name:'Table'},{type:'ann:title',name:'Title block'},{type:'ann:legend',name:'Legend'},{type:'ann:revision',name:'Revision table'}];
function catalog(){const st=ST(),cats=st.categories.map(c=>({id:c.id,name:c.name,pack:c.pack,items:Object.entries(st.shapes).filter(([,s])=>s.cat===c.id).map(([type,s])=>({type,name:s.name,tags:s.tags||''}))}));
  cats.push({id:'rack',name:'Racks & rack equipment',items:[{type:'rack',name:'Rack 42U',tags:'cabinet elevation'},{type:'rack24',name:'Rack 24U',tags:'cabinet wall'},{type:'rack12',name:'Wall rack 12U',tags:'cabinet wall'},...Object.entries(rackItems).map(([type,s])=>({type,name:s.name,tags:s.tags||'rack mount '+s.face}))]});
  cats.push({id:'basic',name:'Basic shapes',items:Object.entries(basic).map(([type,s])=>({type,name:s.name,tags:'shape'}))});
  cats.push({id:'annotation',name:'Annotations',items:ANNOTATIONS.map(a=>({...a,tags:'note document'}))});
  return cats}
const kindOf=type=>basic[type]?'basic':type==='rack'?'rack':rackItems[type]?'rackitem':ST().shapes[type]?'device':'unknown';
const isDevice=n=>n.kind==='node'&&(!!ST().shapes[n.type]||!!rackItems[n.type]||n.type==='image');
const nameOf=type=>basic[type]?.name||rackItems[type]?.name||(type==='rack'?'Rack':ST().shapes[type]?.name)||(type==='image'?'Image':type);

// Build a node of any catalogue type at (x,y) top-left.
function make(type,x,y,name){
  let units=0;if(/^rack(\d+)?$/.test(type)){units=+(type.slice(4)||42);type='rack'}
  if(type==='rack'){const s=rackSize(units),n=C.node('rack',x,y,name||`Rack ${units}U`,s.w,s.h);n.units=units;n.stroke='#475569';n.fill='#f1f5f9';n.labels[0].y=y-10;n.labels[0].bold=true;n.labels[0].size=13;n.ports=[];return n}
  if(rackItems[type]){const r=rackItems[type],n=C.node(type,x,y,name||(r.mount==='roof'?'':r.name),r.w||RACK.inner,r.mount?r.h:r.u*RU);n.stroke='#475569';n.fill='#e2e8f0';const l=n.labels[0];l.color='#1e293b';
    if(r.mount==='side'){l.rotation=-90;l.align='middle';l.size=8.5;l.x=x+8+l.size*.36;l.y=y+n.h/2}else{l.align='start';l.x=x+(r.mount==='roof'?6:12);l.size=r.u>1?10:8.5;l.y=y+n.h/2+l.size*.36}n.ports=[{id:C.uid(),x:0,y:.5,name:'Left'},{id:C.uid(),x:1,y:.5,name:'Right'}];return n}
  if(basic[type]){const b=basic[type],n=C.node(type,x,y,name??'',b.w,b.h);n.display='shape';n.fill=b.fill||'#ffffff';n.stroke=b.stroke||'#486b9f';n.strokeWidth=1.75;n.dash=b.dash||'';const l=n.labels[0];l.y=y+b.h/2+4.5;l.size=13;l.wrapWidth=b.w-16;return n}
  const s=ST().shapes[type]||{name:type,w:64,h:64},n=C.node(type,x,y,name??s.name,s.w||64,s.h||64);return n}

// Markup of a stencil wrapped for a display mode, as a standalone <svg> string (palette, legend, previews).
function iconSvg(type,{display='symbol',accent='#2f5ea8',fill='#ffffff',size=40}={}){
  const s=ST().shapes[type];
  if(basic[type]){const b=basic[type],k=Math.min(36/b.w,28/b.h),w=b.w*k,h=b.h*k;return`<svg viewBox="-2 -2 ${f(w+4)} ${f(h+4)}" width="${size}" height="${size*.8}">${b.paths(w,h).map(p=>`<path d="${p.d}" fill="${p.open?'none':b.fill==='none'?'none':'#fff'}" stroke="${accent}" stroke-width="1.5"/>`).join('')}</svg>`}
  if(type==='rack'||/^rack\d+$/.test(type))return`<svg viewBox="0 0 40 40" width="${size}" height="${size*.8}"><rect x="10" y="2" width="20" height="36" rx="2" fill="#fff" stroke="${accent}" stroke-width="1.6"/><path d="M13 8h14M13 13h14M13 18h14M13 23h14M13 28h14M13 33h14" stroke="${accent}" stroke-width="1.2" stroke-opacity=".6"/></svg>`;
  if(rackItems[type]?.mount==='side')return`<svg viewBox="0 0 44 36" width="${size}" height="${size*.8}"><rect x="17" y="1.5" width="10" height="33" rx="1.5" fill="#e2e8f0" stroke="${accent}" stroke-width="1.3"/><rect x="18.5" y="3" width="7" height="5" rx="1" fill="${accent}"/><path d="M20 12h4M20 16.5h4M20 21h4M20 25.5h4M20 30h4" stroke="${accent}" stroke-width="1.8"/></svg>`;
  if(rackItems[type]?.mount==='roof')return`<svg viewBox="0 0 44 36" width="${size}" height="${size*.8}"><path d="M4 33h36" stroke="${accent}" stroke-width="1.6"/><rect x="5" y="19" width="34" height="12" rx="2" fill="#e2e8f0" stroke="${accent}" stroke-width="1.3"/><circle cx="16" cy="25" r="4" fill="#fff" stroke="${accent}"/><circle cx="28" cy="25" r="4" fill="#fff" stroke="${accent}"/><path d="M13.5 25h5M16 22.5v5M25.5 25h5M28 22.5v5" stroke="${accent}" stroke-width=".8"/></svg>`;
  if(rackItems[type]){const u=rackItems[type].u,h=Math.min(30,6+u*5);return`<svg viewBox="0 0 44 36" width="${size}" height="${size*.8}"><rect x="2" y="${18-h/2}" width="40" height="${h}" rx="1.5" fill="#e2e8f0" stroke="${accent}" stroke-width="1.3"/><path d="M22 ${18-h/2+3}v${h-6}" stroke="${accent}" stroke-width=".8"/><circle cx="7" cy="18" r="1.5" fill="#22c55e"/></svg>`}
  if(!s)return`<svg viewBox="0 0 40 32" width="${size}" height="${size*.8}"><rect x="4" y="4" width="32" height="24" rx="4" fill="none" stroke="${accent}"/></svg>`;
  const bg=display==='tile'?`<rect x="0" y="0" width="${s.w}" height="${s.h}" rx="${Math.min(s.w,s.h)*.2}" fill="${accent}"/>`:display==='circle'?`<circle cx="${s.w/2}" cy="${s.h/2}" r="${Math.min(s.w,s.h)/2}" fill="${accent}"/>`:'';
  const inset=display==='tile'?.16:display==='circle'?.22:0,[vx,vy,vw,vh]=s.vb.split(/[\s,]+/).map(Number);
  const inner=`<svg x="${s.w*inset}" y="${s.h*inset}" width="${s.w*(1-2*inset)}" height="${s.h*(1-2*inset)}" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" overflow="visible"><g fill="${bg?accent:fill}" stroke="currentColor" color="${bg?'#ffffff':accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${s.svg}</g></svg>`;
  return`<svg viewBox="-2 -2 ${s.w+4} ${s.h+4}" width="${size}" height="${size*.8}">${bg}${inner}</svg>`}

return{basic,RU,RACK,rackItems,rackSize,rackFrame,rackDims,rackInner,rackU,rearX,drawRack,drawFace,linkTypes,applyLinkType,speedMbps,STATUS,PALETTE,CATEGORY,themes,applyTheme,catalog,kindOf,isDevice,nameOf,make,iconSvg};
})();
