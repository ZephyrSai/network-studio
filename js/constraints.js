// Live constraints applied after every change, so dependent objects never drift apart:
//  • zones (containers) grow to keep their members inside;
//  • the page auto-sizes to the drawing (standard sheet sizes, shrinking back to the chosen size),
//    shifting everything if objects were pushed past the top/left edge;
//  • pinned items (title blocks, legends, borders) stay anchored to the page corners / margin frame,
//    on their own page and when a background page is shown behind sheets of other sizes.
const Constraints=(()=>{
  const C=Core,SERIES={A:['A4','A3','A2','A1','A0'],US:['Letter','Tabloid']};
  const area=p=>{const s=C.pageSize(p),m=p.margin*C.PX;return{x:m,y:m,w:s.w-2*m,h:s.h-2*m}};
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
    for(const z of zones){const members=page.items.filter(n=>n!==z&&n.kind!=='edge'&&!n.pin&&centerIn(n,z)&&!(n.kind==='zone'&&n.w*n.h>=z.w*z.h));if(!members.length)continue;
      const b=C.bounds(members,true),pad=16,head=z.labels?.[0]?Math.max(30,z.labels[0].y+z.labels[0].size*.4-z.y+8):12;
      const x0=Math.min(z.x,b.x-pad),y0=Math.min(z.y,b.y-head),x1=Math.max(z.x+z.w,b.x+b.w+pad),y1=Math.max(z.y+z.h,b.y+b.h+pad);
      if(x0<z.x-.5||y0<z.y-.5||x1>z.x+z.w+.5||y1>z.y+z.h+.5){const dx=x0-z.x,dy=y0-z.y;(z.labels||[]).forEach(l=>{l.x+=dx;l.y+=dy});z.x=x0;z.y=y0;z.w=x1-x0;z.h=y1-y0;changed=true}}
    return changed}

  // ---------- page auto-size ----------
  function candidates(p){const base=p.minPaper||p.paper;if(base==='Custom')return[];const ser=SERIES.A.includes(base)?SERIES.A:SERIES.US.includes(base)?SERIES.US:[base];return ser.slice(Math.max(0,ser.indexOf(base)))}
  // pinned blocks may sit on empty zone areas, but must not cover devices, links, text or tables
  function overlapsContent(page,content){const pins=page.items.filter(n=>n.pin&&n.pin!=='frame');return pins.some(p=>{const pb=C.box(p);return content.some(n=>n.kind!=='zone'&&C.overlaps(pb,C.bounds([n],n.kind!=='edge')))})}
  function autoSize(page){
    if(page.autoSize===false||page.isBackground)return null;
    page.minPaper??=page.paper;if(page.minPaper==='Custom'){page.minW??=page.customW;page.minH??=page.customH}
    const pinned=page.items.filter(n=>n.pin),offs=new Map(pinned.map(n=>[n,offsets(n,area(page))])),content=page.items.filter(n=>!n.pin);
    let shift=null;const before={paper:page.paper,w:page.customW,h:page.customH};
    // like Visio, the page reacts when shapes leave the sheet itself; the print margin is only a guide
    if(content.length){let b=C.bounds(content,true);const m=4;
      if(b.x<0||b.y<0){const dx=b.x<0?Math.ceil(m-b.x):0,dy=b.y<0?Math.ceil(m-b.y):0;for(const n of content)C.move(n,dx,dy);for(const g of page.guideLines||[])g.pos+=g.axis==='x'?dx:dy;shift=[dx,dy];b={...b,x:b.x+dx,y:b.y+dy}}
      const need={w:b.x+b.w+m,h:b.y+b.h+m};let done=false;
      for(const paper of candidates(page)){const s=C.pageSize({...page,paper});if(s.w+.5<need.w||s.h+.5<need.h)continue;page.paper=paper;const a=area(page);for(const n of pinned)place(n,a,offs.get(n));if(!overlapsContent(page,content)){done=true;break}}
      if(!done){// beyond the largest sheet (or a custom page): grow a custom sheet in 10 mm steps
        let extra=0;for(const n of pinned)if(n.pin!=='frame'&&n.pin.includes('b'))extra=Math.max(extra,C.box(n).h+16);
        const minW=page.minPaper==='Custom'?page.minW:C.dimensions({...page,paper:page.minPaper})[0],minH=page.minPaper==='Custom'?page.minH:C.dimensions({...page,paper:page.minPaper})[1];
        page.paper='Custom';page.customW=Math.max(minW,Math.ceil(need.w/C.PX/10)*10);page.customH=Math.max(minH,Math.ceil((need.h+(overlapsContent(page,content)?extra:0))/C.PX/10)*10);for(const n of pinned)place(n,area(page),offs.get(n));
        if(overlapsContent(page,content)){page.customH=Math.ceil((need.h+extra)/C.PX/10)*10;for(const n of pinned)place(n,area(page),offs.get(n))}}}
    else{page.paper=page.minPaper;if(page.paper==='Custom'){page.customW=page.minW;page.customH=page.minH}for(const n of pinned)place(n,area(page),offs.get(n))}
    const resized=before.paper!==page.paper||before.w!==page.customW||before.h!==page.customH;return{shift,resized}}

  // ---------- entry points ----------
  // After every edit: containers first (they change content bounds), then the page, then the pins.
  function sync(page){if(!page)return null;for(const e of page.items)if(e.kind==='edge'&&e.labels?.some(l=>l.anchor))Conn.placeLabels(e);const z=fitZones(page);const r=page.isBackground?null:autoSize(page);if(!r&&!page.isBackground){const a=area(page);for(const n of page.items)if(n.pin)place(n,a,offsets(n,a))}if(page.isBackground){const a=area(page);for(const n of page.items)if(n.pin==='frame')place(n,a,{})}return{zones:z,...(r||{})}}
  function pinNow(n,page,pin){n.pin=pin||undefined;if(!pin){delete n.pin;return}place(n,area(page),offsets(n,area(page)))}
  return{sync,fitZones,autoSize,bgItems,bgView,area,PINS,pinNow,place,offsets};
})();
