// Live constraints applied after every change, so dependent objects never drift apart:
//  • zones (containers) grow to keep their members inside;
//  • the page auto-sizes to the drawing (standard sheet sizes, shrinking back to the chosen size),
//    shifting everything if objects were pushed past the top/left edge;
//  • pinned items (title blocks, legends, borders) stay anchored to the page corners / margin frame,
//    on their own page and when a background page is shown behind sheets of other sizes.
const Constraints=(()=>{
  const C=Core,SERIES={A:['A4','A3','A2','A1','A0'],US:['Letter','Tabloid']};
  const area=p=>{const s=C.pageSize(p),m=p.margin*C.PX;return{x:m,y:m,w:s.w-2*m,h:s.h-2*m}};
  // The area pinned items were last laid out in. Right after the paper, orientation or margin changes it is not
  // area(p) yet, and their gaps must be measured against it (against the new sheet a block would lose its gap).
  const laid=p=>p.pinArea||area(p);
  const centerIn=(n,b)=>{const c=C.center(n);return c[0]>=b.x&&c[0]<=b.x+b.w&&c[1]>=b.y&&c[1]<=b.y+b.h};
  const PINS=[['','Not pinned'],['tl','Top-left corner'],['tr','Top-right corner'],['bl','Bottom-left corner'],['br','Bottom-right corner'],['frame','Margin frame (border)']];

  // ---------- pins ----------
  function offsets(n,a){const b=C.box(n);return{l:b.x-a.x,t:b.y-a.y,r:a.x+a.w-(b.x+b.w),b:a.y+a.h-(b.y+b.h)}}
  function place(n,a,off){
    if(n.pin==='frame'){const dx=a.x-n.x,dy=a.y-n.y;(n.labels||[]).forEach(l=>{l.x+=dx;l.y+=dy});n.x=a.x;n.y=a.y;n.w=a.w;n.h=a.h;return}
    const b=C.box(n);let x=b.x,y=b.y;if(n.pin.includes('r'))x=a.x+a.w-Math.max(0,off.r)-b.w;else if(n.pin.includes('l'))x=a.x+Math.max(0,off.l);if(n.pin.includes('b'))y=a.y+a.h-Math.max(0,off.b)-b.h;else if(n.pin.includes('t'))y=a.y+Math.max(0,off.t);C.move(n,x-b.x,y-b.y)}
  // Pinned items of a background page, re-anchored for the sheet it is shown behind.
  function bgItems(bg,fg){if(!bg.items.some(n=>n.pin))return bg.items;const a0=area(bg),a1=area(fg);return bg.items.map(n=>{if(!n.pin)return n;const c=C.copy(n);place(c,a1,offsets(n,a0));return c})}
  const bgView=(bg,fg)=>({...bg,items:bgItems(bg,fg)});

  // ---------- containers ----------
  function fitZones(page){let changed=false;const zones=page.items.filter(z=>z.kind==='zone'&&z.autoFit!==false&&!z.pin&&!z.locked).sort((a,b)=>a.w*a.h-b.w*b.h);
    for(const z of zones){const members=page.items.filter(n=>n!==z&&n.kind!=='edge'&&!n.pin&&n.type!=='revcloud'&&n.type!=='revdelta'&&centerIn(n,z)&&!(n.kind==='zone'&&n.w*n.h>=z.w*z.h));if(!members.length)continue;
      const b=C.bounds(members,true),pad=16,head=z.labels?.[0]?Math.max(30,z.labels[0].y+z.labels[0].size*.4-z.y+8):12;
      const x0=Math.min(z.x,b.x-pad),y0=Math.min(z.y,b.y-head),x1=Math.max(z.x+z.w,b.x+b.w+pad),y1=Math.max(z.y+z.h,b.y+b.h+pad);
      if(x0<z.x-.5||y0<z.y-.5||x1>z.x+z.w+.5||y1>z.y+z.h+.5){const dx=x0-z.x,dy=y0-z.y;(z.labels||[]).forEach(l=>{l.x+=dx;l.y+=dy});z.x=x0;z.y=y0;z.w=x1-x0;z.h=y1-y0;changed=true}}
    return changed}

  // ---------- page auto-size ----------
  function candidates(p){const base=p.minPaper||p.paper;if(base==='Custom')return[];const ser=SERIES.A.includes(base)?SERIES.A:SERIES.US.includes(base)?SERIES.US:[base];return ser.slice(Math.max(0,ser.indexOf(base)))}
  // pinned blocks may sit on empty zone areas, but must not cover devices, links, text or tables
  function blockers(page,doc){const bg=doc&&page.background&&doc.pages.find(p=>p.id===page.background);return[...page.items.filter(n=>n.pin&&n.pin!=='frame'),...(bg&&bg!==page?bgItems(bg,page).filter(n=>n.pin&&n.pin!=='frame'):[])]}
  function overlapsContent(page,content,doc){const pins=blockers(page,doc);return pins.some(p=>{const pb=C.box(p);return content.some(n=>n.kind!=='zone'&&C.overlaps(pb,C.bounds([n],n.kind!=='edge')))})}
  // Place the pinned blocks in area a and report whether the drawing stays clear. When the sheet has changed size
  // (tighten), a block on the top or bottom edge that would cover the drawing moves towards its edge, never past
  // the margin, just far enough to clear it; on an unchanged sheet blocks keep their gaps and the page grows instead.
  function placePins(page,doc,pinned,offs,a,content,tighten){for(const n of pinned)place(n,a,offs.get(n));if(!overlapsContent(page,content,doc))return true;if(!tighten)return false;
    const boxes=content.filter(m=>m.kind!=='zone').map(m=>C.bounds([m],m.kind!=='edge'));
    for(const n of pinned){if(n.pin==='frame'||!/[bt]/.test(n.pin))continue;const bx=C.box(n),col=boxes.filter(r=>r.x<bx.x+bx.w&&r.x+r.w>bx.x);if(!col.some(r=>C.overlaps(bx,r)))continue;
      const off={...offs.get(n)};if(n.pin.includes('b'))off.b=Math.min(off.b,a.y+a.h-8-bx.h-Math.max(...col.map(r=>r.y+r.h)));else off.t=Math.min(off.t,Math.min(...col.map(r=>r.y))-8-bx.h-a.y);place(n,a,off)}
    return!overlapsContent(page,content,doc)}
  function autoSize(page,doc){
    if(page.autoSize===false||page.isBackground)return null;
    page.minPaper??=page.paper;if(page.minPaper==='Custom'){page.minW??=page.customW;page.minH??=page.customH}
    const pinned=page.items.filter(n=>n.pin),a0=laid(page),offs=new Map(pinned.map(n=>[n,offsets(n,a0)])),content=page.items.filter(n=>!n.pin);
    const resheet=a=>Math.abs(a.w-a0.w)>.5||Math.abs(a.h-a0.h)>.5;
    let shift=null;const before={paper:page.paper,w:page.customW,h:page.customH};
    // like Visio, the page reacts when shapes leave the sheet itself; the print margin is only a guide
    if(content.length){let b=C.bounds(content,true);const m=4;
      if(b.x<0||b.y<0){const dx=b.x<0?Math.ceil(m-b.x):0,dy=b.y<0?Math.ceil(m-b.y):0;for(const n of content)C.move(n,dx,dy);for(const g of page.guideLines||[])g.pos+=g.axis==='x'?dx:dy;shift=[dx,dy];b={...b,x:b.x+dx,y:b.y+dy}}
      const need={w:b.x+b.w+m,h:b.y+b.h+m};let done=false;
      // legends re-wrap to the width of each sheet tried, so they are measured for it before testing for overlap
      for(const paper of candidates(page)){const s=C.pageSize({...page,paper});if(s.w+.5<need.w||s.h+.5<need.h)continue;page.paper=paper;measureLegends(page,doc);const a=area(page);if(placePins(page,doc,pinned,offs,a,content,resheet(a))){done=true;break}}
      if(!done){// beyond the largest sheet (or a custom page): grow a custom sheet in 10 mm steps
        const minW=page.minPaper==='Custom'?page.minW:C.dimensions({...page,paper:page.minPaper})[0],minH=page.minPaper==='Custom'?page.minH:C.dimensions({...page,paper:page.minPaper})[1];
        page.paper='Custom';page.customW=Math.max(minW,Math.ceil(need.w/C.PX/10)*10);page.customH=Math.max(minH,Math.ceil(need.h/C.PX/10)*10);measureLegends(page,doc);
        if(!placePins(page,doc,pinned,offs,area(page),content,resheet(area(page)))){
          // still covered: keep the blocks' gaps and make the sheet tall enough for bottom blocks to sit under the drawing
          placePins(page,doc,pinned,offs,area(page),content,false);let grow=0;for(const n of blockers(page,doc))if(n.pin.includes('b'))grow=Math.max(grow,b.y+b.h+8-C.box(n).y);
          if(grow>0){page.customH=Math.max(minH,Math.ceil((page.customH*C.PX+grow)/C.PX/10)*10);placePins(page,doc,pinned,offs,area(page),content,false)}}}}
    else{page.paper=page.minPaper;if(page.paper==='Custom'){page.customW=page.minW;page.customH=page.minH}measureLegends(page,doc);for(const n of pinned)place(n,area(page),offs.get(n))}
    page.pinArea=area(page);
    const resized=before.paper!==page.paper||before.w!==page.customW||before.h!==page.customH;return{shift,resized}}

  // ---------- entry points ----------
  // After every edit: containers first (they change content bounds), then the page, then the pins.
  const FIT_DEFAULTS={mode:'free',pad:10,round:5,orient:'auto',reserve:true};
  // Page hugs the drawing: content is moved to margin+padding, the sheet is sized around it (free size rounded up,
  // or the smallest standard sheet), leaving room below/above for pinned title blocks and legends if asked.
  function fitPage(page,doc,opt={}){opt={...FIT_DEFAULTS,...page.fit,...opt};const content=page.items.filter(n=>!n.pin);if(!content.length)return null;
    const pinned=page.items.filter(n=>n.pin),a0=laid(page),offs=new Map(pinned.map(n=>[n,offsets(n,a0)])),before={paper:page.paper,w:page.customW,h:page.customH,o:page.orientation};
    const b=C.bounds(content,true),m=page.margin*C.PX,pad=Math.max(0,+opt.pad||0)*C.PX;
    const blocks=blockers(page,doc),room=(side)=>opt.reserve?Math.max(0,...blocks.filter(n=>n.pin.includes(side)).map(n=>{const o=offsets(n,a0);return(side==='b'?o.b:o.t)+C.box(n).h+8-pad})):0,below=room('b'),above=room('t');
    let w=b.w+2*(m+pad),h=b.h+2*(m+pad)+below+above,ox=m+pad,oy=m+pad+above;
    if(opt.mode==='paper'){let best=null;for(const paper of[...SERIES.A,...SERIES.US])for(const orientation of opt.orient==='auto'?['landscape','portrait']:[page.orientation]){const s=C.pageSize({...page,paper,orientation});if(s.w+.5>=w&&s.h+.5>=h&&(!best||s.w*s.h<best.s.w*best.s.h))best={paper,orientation,s}}
      if(best){page.paper=best.paper;page.orientation=best.orientation;ox+=(best.s.w-w)/2;oy+=(best.s.h-h)/2}else opt.mode='free'}
    if(opt.mode!=='paper'){const r=Math.max(1,+opt.round||1),W=Math.ceil(w/C.PX/r)*r,H=Math.ceil(h/C.PX/r)*r;page.paper='Custom';page.customW=Math.max(50,W);page.customH=Math.max(50,H);page.orientation=W>=H?'landscape':'portrait';ox+=(page.customW*C.PX-w)/2;oy+=(page.customH*C.PX-h)/2}
    const dx=Math.round((ox-b.x)*100)/100,dy=Math.round((oy-b.y)*100)/100;if(Math.abs(dx)>.01||Math.abs(dy)>.01){for(const n of content)C.move(n,dx,dy);for(const g of page.guideLines||[])g.pos+=g.axis==='x'?dx:dy}
    page.minPaper=page.paper;if(page.paper==='Custom'){page.minW=page.customW;page.minH=page.customH}
    const a=area(page);for(const n of pinned)place(n,a,offs.get(n));page.pinArea=a;
    return{shift:Math.abs(dx)>.01||Math.abs(dy)>.01?[dx,dy]:null,resized:before.paper!==page.paper||before.w!==page.customW||before.h!==page.customH||before.o!==page.orientation}}
  // keep: a pinned legend stays on its pinned edges (where it was laid out) when re-wrapping changes its size
  function measureLegends(page,doc,keep){if(typeof legendMeasure!=='function')return'';let sig='';const a=keep&&laid(page);
    for(const n of page.items)if(n.kind==='legend'){const off=a&&n.pin&&n.pin!=='frame'?offsets(n,a):null,prev=RCTX;RCTX=makeCtx(page,{doc});legendMeasure(n,page,RCTX);RCTX=prev;if(off)place(n,a,off);sig+=n.w+'x'+n.h+';'}return sig}
  // ---------- labels out of the connectors' way ----------
  // A device's name label normally sits under the icon. When connectors leave the device downwards they would run
  // through the label (and its halo hides them), so the label moves beside the icon — right, else left — and back
  // under it once nothing leaves downwards. Labels the user placed somewhere else are never touched.
  function leaveSide(p,q){const dx=q[0]-p[0],dy=q[1]-p[1];return Math.abs(dy)>=Math.abs(dx)?(dy>0?'down':'up'):(dx>0?'right':'left')}
  function labelSides(page,doc){if(doc?.display?.smartLabels===false)return false;const sides=new Map(),byId=new Map(page.items.map(n=>[n.id,n]));let changed=false;
    for(const e of page.items)if(e.kind==='edge'&&e.points?.length>1){const pts=e.points.filter((p,i,a)=>!i||Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1])>.5);if(pts.length<2)continue;
      for(const[k,p,q]of[['from',pts[0],pts[1]],['to',pts.at(-1),pts.at(-2)]]){const id=e[k]?.node;if(!id)continue;if(!sides.has(id))sides.set(id,new Set());sides.get(id).add(leaveSide(p,q))}}
    for(const n of page.items){if(n.kind!=='node'||!Shapes.isDevice(n)||Shapes.rackItems[n.type]||n.rotation)continue;const l=n.labels?.[0];if(!l||l.anchor||!String(l.text||'').trim())continue;
      const sd=sides.get(n.id)||new Set(),g=C.glyphBox(n)||{x:0,y:0,w:n.w,h:n.h},cx=n.x+n.w/2;
      const below=!l.auto&&Math.abs(l.x-cx)<2&&(l.align||'middle')==='middle'&&l.y>n.y+n.h-2&&l.y-(n.y+n.h)<48;
      // a side is only used if the label fits there without landing on another device or label
      const box=side=>{const w=C.textWidth(String(l.text).split('\n').sort((a,b)=>b.length-a.length)[0],l.size)+4,lines=String(l.text).split('\n').length,h=lines*l.size*1.22,y=n.y+g.y+g.h/2-h/2;return side==='right'?{x:n.x+g.x+g.w+6,y,w,h}:{x:n.x+g.x-6-w,y,w,h}};
      const hit=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
      const fits=side=>{const b=box(side);return!page.items.some(m=>m!==n&&m.kind==='node'&&(hit(b,C.box(m))||m.labels?.[0]&&String(m.labels[0].text||'').trim()&&hit(b,(()=>{const ml=m.labels[0],mw=C.textWidth(String(ml.text).split('\n')[0],ml.size),mx=ml.align==='start'?ml.x:ml.align==='end'?ml.x-mw:ml.x-mw/2;return{x:mx,y:ml.y-ml.size,w:mw,h:ml.size*1.3}})())))};
      const want=sd.has('down')?(!sd.has('right')&&fits('right')?'right':!sd.has('left')&&fits('left')?'left':null):null;
      const place=side=>{const lines=String(l.text).split('\n').length,bh=lines*l.size*1.22,y=n.y+g.y+g.h/2-bh/2+l.size*.92;l.y=y;if(side==='right'){l.align='start';l.x=n.x+g.x+g.w+8}else{l.align='end';l.x=n.x+g.x-8}};
      let moved=false;if(l.auto&&want!==l.auto){if(want){place(want);l.auto=want}else{l.align='middle';l.x=cx;l.y=n.y+n.h+(l.autoGap??16);delete l.auto;delete l.autoGap}moved=true}
      else if(below&&want){l.autoGap=l.y-(n.y+n.h);place(want);l.auto=want;moved=true}
      if(moved)changed=true;if(moved&&typeof Conn!=='undefined')for(const e of page.items)if(e.kind==='edge'&&(e.from?.node===n.id||e.to?.node===n.id))Conn.markDirty(e.id)}
    return changed}
  function sync(page,doc=(typeof S!=='undefined'?S.doc:null)){if(!page)return null;if(typeof Racks!=='undefined')Racks.syncRear(page.items);for(const e of page.items)if(e.kind==='edge'&&e.labels?.some(l=>l.anchor))Conn.placeLabels(e);labelSides(page,doc);const z=fitZones(page);let sig=measureLegends(page,doc,true),r=null;
    // legends may re-wrap when the page width changes, which can change the room they need: settle in ≤3 passes
    for(let i=0;i<3;i++){const ri=page.isBackground?null:page.autoSize==='fit'?fitPage(page,doc):autoSize(page,doc);if(ri){r=r?{shift:ri.shift?[(r.shift?.[0]||0)+ri.shift[0],(r.shift?.[1]||0)+ri.shift[1]]:r.shift,resized:r.resized||ri.resized}:ri}const s2=measureLegends(page,doc,true);if(s2===sig)break;sig=s2}
    if(!r){const a=area(page),l=laid(page);for(const n of page.items)if(n.pin)place(n,a,n.pin==='frame'?{}:offsets(n,l))}page.pinArea=area(page);return{zones:z,...(r||{})}}
  function pinNow(n,page,pin){n.pin=pin||undefined;if(!pin){delete n.pin;return}place(n,area(page),offsets(n,area(page)))}
  // Drawings saved before pinning existed: recognise borders, field-driven title blocks and legends and pin them,
  // measuring against the sheet size they were laid out for (the current size or any smaller standard sheet).
  function upgrade(doc){if(!doc)return 0;for(const p of doc.pages)p.pinArea??=area(p);if(doc.meta?.pinsUpgraded)return 0;let n=0;
    for(const p of doc.pages){const sizes=[...new Set([p.paper,p.minPaper,...SERIES.A,...SERIES.US].filter(Boolean))],cur=area(p),areas=[cur,...sizes.map(paper=>area({...p,paper})).filter(a=>a.w<=cur.w+1&&a.h<=cur.h+1).sort((a,b)=>b.w*b.h-a.w*a.h)];
      for(const it of p.items){if(it.pin||it.kind==='edge')continue;const b=C.box(it);
        if(it.kind==='zone'&&(it.fill==='none'||it.style==='outline')){for(const a of areas)if(Math.abs(b.x-a.x)<4&&Math.abs(b.y-a.y)<4&&Math.abs(b.w-a.w)<6&&Math.abs(b.h-a.h)<6){it.pin='frame';it.autoFit=false;place(it,cur,{});n++;break}continue}
        const fielded=it.kind==='table'&&it.rows?.some(r=>r.some(c=>String(c).includes('{{'))),legend=it.kind==='legend';if(!fielded&&!legend)continue;
        for(const a of areas){const o=offsets(it,a),tol=legend?.28:.12,v=o.b<o.t?'b':'t',h=o.r<o.l?'r':'l';if(Math.min(o.b,o.t)<a.h*tol&&Math.min(o.r,o.l)<a.w*tol&&Math.min(o.b,o.t)>-8&&Math.min(o.r,o.l)>-8){it.pin=v+h;place(it,cur,o);n++;break}}}}
    doc.meta??={};doc.meta.pinsUpgraded=true;return n}
  // Width a pinned block may use along its edge without running under other blocks pinned to the same edge.
  function availableWidth(page,doc,n){const a=area(page);if(!n.pin||n.pin==='frame')return Infinity;const edge=n.pin.includes('b')?'b':'t';return a.w-blockers(page,doc).filter(o=>o.id!==n.id&&o.pin.includes(edge)).reduce((s,o)=>s+C.box(o).w+16,0)}
  return{availableWidth,FIT_DEFAULTS,fitPage,upgrade,sync,fitZones,labelSides,autoSize,bgItems,bgView,area,PINS,pinNow,place,offsets};
})();
