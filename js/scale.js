// Scale a selection (or a whole page) about a point without breaking it:
// devices keep their icon proportions and ports; labels stay where they sit relative to their shape (below stays below,
// centred stays centred); zones, text boxes and tables resize; racks and rack equipment move as rigid units so slots
// still line up; connector bends scale with the geometry, so arrangements are kept without re-routing; connectors that
// leave the selection are re-routed. Pinned items (legend, title block, frame) follow the page and are not scaled.
const Scale=(()=>{
const C=Core;
const isRackish=n=>n.kind==='node'&&(n.type==='rack'||/^rk-/.test(n.type));
const centre=b=>[b.x+b.w/2,b.y+b.h/2];

// list: items to scale; all: every item on the page; k: factor; o: {origin:[x,y], text, lines}
const centreIn=(n,z)=>{const b=C.box(n),cx=b.x+b.w/2,cy=b.y+b.h/2;return cx>=z.x&&cx<=z.x+z.w&&cy>=z.y&&cy<=z.y+z.h};
// Smallest zone (of those given) whose area holds n's centre.
const homeZone=(n,zones)=>zones.filter(z=>z!==n&&centreIn(n,z)).sort((a,b)=>a.w*a.h-b.w*b.h)[0]||null;
// What really has to scale together: a zone brings everything inside it; a link between two scaled items comes along.
function expand(list,all){const set=new Set(list.filter(n=>!n.pin).map(n=>n.id));let grew=true;
  while(grew){grew=false;for(const z of all)if(z.kind==='zone'&&set.has(z.id))for(const m of all)if(!set.has(m.id)&&m.kind!=='edge'&&!m.pin&&m!==z&&!Revisions?.MARKUP?.has?.(m.type)&&centreIn(m,z)){set.add(m.id);grew=true}}
  for(const e of all)if(e.kind==='edge'&&!set.has(e.id)&&e.from?.node&&e.to?.node&&set.has(e.from.node)&&set.has(e.to.node))set.add(e.id);
  return all.filter(n=>set.has(n.id))}
// Move n by the smallest offset that puts its box inside zone z (pad inside) — or, with out=true, outside it.
function keepIn(n,z,out=false){const b=C.box(n),pad=8;let dx=0,dy=0;
  if(!out){if(b.x<z.x+pad)dx=z.x+pad-b.x;else if(b.x+b.w>z.x+z.w-pad)dx=z.x+z.w-pad-b.x-b.w;if(b.y<z.y+pad)dy=z.y+pad-b.y;else if(b.y+b.h>z.y+z.h-pad)dy=z.y+z.h-pad-b.y-b.h}
  else{const opts=[[z.x-pad-(b.x+b.w),0],[z.x+z.w+pad-b.x,0],[0,z.y-pad-(b.y+b.h)],[0,z.y+z.h+pad-b.y]].sort((p,q)=>Math.hypot(...p)-Math.hypot(...q));[dx,dy]=opts[0]}
  if(dx||dy)C.move(n,dx,dy);return!!(dx||dy)}

function apply(list,all,k,o={}){
  const items=expand(list,all),set=new Set(items.map(n=>n.id));if(!items.length||!(k>0))return{reroute:[]};
  // zones that are not being scaled: their members must stay members, and nothing new may wander in
  const fixedZones=all.filter(z=>z.kind==='zone'&&!z.pin&&!set.has(z.id)),loose=items.filter(n=>n.kind!=='edge'&&n.kind!=='zone'&&!n.pin),home=new Map(loose.map(n=>[n.id,homeZone(n,fixedZones)]));
  const b=C.bounds(items),org=o.origin||[b.x,b.y],tr=p=>[org[0]+(p[0]-org[0])*k,org[1]+(p[1]-org[1])*k],fk=o.text?k:1;
  const font=l=>{if(o.text){l.size=Math.max(4,l.size*k);if(l.wrapWidth)l.wrapWidth*=k}};
  // racks first: equipment inside a scaled rack moves by the rack's own offset
  const rackShift=new Map();for(const r of items)if(r.type==='rack'){const[cx,cy]=centre(r),[nx,ny]=tr([cx,cy]);rackShift.set(r.id,[nx-cx,ny-cy])}
  const rackOf=n=>{const[cx,cy]=centre(n);return all.find(r=>r.type==='rack'&&set.has(r.id)&&cx>=r.x&&cx<=r.x+r.w&&cy>=r.y&&cy<=r.y+r.h)};
  for(const n of items){
    if(n.kind==='edge'){n.points=n.points.map(tr);for(const l of n.labels||[]){if(!l.anchor)[l.x,l.y]=tr([l.x,l.y]);font(l)}if(o.lines&&n.strokeWidth)n.strokeWidth=Math.max(.5,n.strokeWidth*k);continue}
    if(isRackish(n)){const s=n.type==='rack'?rackShift.get(n.id):(()=>{const r=rackOf(n);if(r)return rackShift.get(r.id);const[cx,cy]=centre(n),[nx,ny]=tr([cx,cy]);return[nx-cx,ny-cy]})();C.move(n,s[0],s[1]);continue}
    if(n.kind==='node'){const ob={x:n.x,y:n.y,w:n.w,h:n.h},[cx,cy]=centre(ob),[ncx,ncy]=tr([cx,cy]);n.w*=k;n.h*=k;n.x=ncx-n.w/2;n.y=ncy-n.h/2;
      for(const l of n.labels||[]){if(l.anchor)continue;const below=l.y>ob.y+ob.h,above=l.y<ob.y;
        l.x=ncx+(l.x-cx)*k;l.y=below?n.y+n.h+(l.y-ob.y-ob.h)*fk:above?n.y-(ob.y-l.y)*fk:ncy+(l.y-cy)*k;font(l)}
      if(o.lines&&n.strokeWidth)n.strokeWidth=Math.max(.5,n.strokeWidth*k);continue}
    if(n.kind==='zone'||n.kind==='text'){const ox=n.x,oy=n.y;[n.x,n.y]=tr([n.x,n.y]);n.w*=k;n.h*=k;
      for(const l of n.labels||[]){l.x=n.x+(l.x-ox)*(n.kind==='text'?k:fk);l.y=n.y+(l.y-oy)*fk;if(o.text)l.size=Math.max(4,l.size*k);if(l.wrapWidth)l.wrapWidth*=k}
      if(o.lines&&n.strokeWidth)n.strokeWidth=Math.max(.5,n.strokeWidth*k);continue}
    if(n.kind==='table'&&o.text){[n.x,n.y]=tr([n.x,n.y]);n.cols=n.cols.map(c=>c*k);n.rowH*=k;n.size*=k;n.w=n.cols.reduce((a,c)=>a+c,0);n.h=Math.max(1,n.rows.length)*n.rowH;continue}
    // tables without text scaling, unpinned legends, anything else: keep its size, move its anchor point
    const[nx,ny]=tr([n.x,n.y]);C.move(n,nx-n.x,ny-n.y)}
  // zone membership is part of the drawing's meaning: put anything that left its zone back, and keep others out
  const nudged=new Set();for(const n of loose){const z=home.get(n.id);if(z){if(!centreIn(n,z)||C.box(n).x<z.x||C.box(n).y<z.y||C.box(n).x+C.box(n).w>z.x+z.w||C.box(n).y+C.box(n).h>z.y+z.h){if(keepIn(n,z))nudged.add(n.id)}}else{const z2=homeZone(n,fixedZones);if(z2&&keepIn(n,z2,true))nudged.add(n.id)}}
  // connectors whose other end is outside the scaled set (or whose device was nudged) must be re-routed
  const reroute=all.filter(e=>e.kind==='edge'&&([e.from?.node,e.to?.node].some(id=>id&&set.has(id))&&[e.from?.node,e.to?.node].some(id=>!id||!set.has(id))||[e.from?.node,e.to?.node].some(id=>id&&nudged.has(id)))).map(e=>e.id);
  return{reroute,nudged:[...nudged],items}}

// The point a scale is anchored on: 'tl' top-left, 'center', or the corner opposite a dragged handle.
function origin(list,where='tl'){const b=C.bounds(list.filter(n=>!n.pin));return where==='center'?[b.x+b.w/2,b.y+b.h/2]:[b.x,b.y]}

return{apply,origin};
})();
if(typeof module!=='undefined')module.exports=Scale;
