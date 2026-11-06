// Detailed pictures on the live canvas. A vendor faceplate from a Visio stencil is thousands of paths, and a drawing holds dozens of them: drawn as vectors they make every pan,
// click and edit slow. So the canvas shows each detailed picture as a cached image, made once per picture and colour, and swaps to the real vectors for the few on screen when
// zoomed in past what the image can show. Exports, printing, saved files and legends never come through here: they always get the vectors.
const Raster=(()=>{
const MIN_ELEMENTS=60,LONG_SIDE=1600,MAX_AREA=1.6e6,MAX_OVERFLOW=3;
const weights=new Map(),made=new Map(),queue=[];let pumping=false,lastView=0;
const usable=()=>typeof document!=='undefined'&&typeof Image!=='undefined'&&typeof URL!=='undefined'&&!!URL.createObjectURL;

// Worth an image? Counted once per picture.
function isHeavy(type){if(!usable())return false;const s=Stencils.shapes[type];if(!s)return false;const k=type+'|'+s.svg.length;let w=weights.get(k);if(w===undefined){const t=iconTemplate(type);
  // a line that keeps its width at any zoom has no fixed look to take a picture of
  w=t&&!s.svg.includes('vector-effect')?t.querySelectorAll('*').length:0;weights.set(k,w)}return w>=MIN_ELEMENTS}
const keyOf=(type,p)=>[type,Stencils.shapes[type].vb,Stencils.shapes[type].svg.length,p.fill,p.color,p.sw].join('|');
const nums=vb=>String(vb).split(/[\s,]+/).map(Number);
// What the image covers: the viewBox, and anything the picture draws just outside it (a shape's box doesn't clip it), within reason.
function windowOf(type){const s=Stencils.shapes[type],[x,y,w,h]=nums(s.vb),g=typeof glyphFrac==='function'?glyphFrac(type,0):null,pad=Math.max(w,h)*.02;if(!g)return[x-pad,y-pad,w+2*pad,h+2*pad];const lim=Math.max(w,h)*MAX_OVERFLOW,x0=Math.max(x-lim,Math.min(x,g.x)),y0=Math.max(y-lim,Math.min(y,g.y)),x1=Math.min(x+w+lim,Math.max(x+w,g.x+g.w)),y1=Math.min(y+h+lim,Math.max(y+h,g.y+g.h));
  // the outline measured has no stroke width: half a stroke lies outside it
  return[x0-pad,y0-pad,x1-x0+2*pad,y1-y0+2*pad]}
function sizeFor(w,h){const a=w/h;let W=a>=1?LONG_SIDE:LONG_SIDE*a,H=a>=1?LONG_SIDE/a:LONG_SIDE;const k=Math.min(1,Math.sqrt(MAX_AREA/(W*H)));return[Math.max(8,Math.round(W*k)),Math.max(8,Math.round(H*k))]}

function entry(type,paint){const k=keyOf(type,paint);let e=made.get(k);if(!e){e={type,paint,state:'waiting',url:null,win:null,W:0,H:0,tries:0};made.set(k,e);queue.push(e);pump()}return e}
async function pump(){if(pumping)return;pumping=true;while(queue.length){
    // never during a gesture: a picture takes a moment on a slow machine, and redrawing what's under a shape being dragged in from the palette can lose the drop
    for(let w=0;w<70&&typeof S!=='undefined'&&(S.drag||S.dragSymbol||performance.now()-lastView<220);w++)await new Promise(r=>setTimeout(r,120));
    const e=queue.shift();await make(e);if(typeof render==='function')render('scene');await new Promise(r=>setTimeout(r,0))}pumping=false}
async function make(e){try{const s=Stencils.shapes[e.type];if(!s)throw Error('gone');const win=windowOf(e.type),[W,H]=sizeFor(win[2],win[3]),p=e.paint,svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${win.join(' ')}" width="${W}" height="${H}" preserveAspectRatio="none"><g font-family="${attr(typeof Core!=='undefined'?Core.FONT:'sans-serif')}" fill="${attr(p.fill)}" stroke="currentColor" color="${attr(p.color)}" stroke-width="${+p.sw||0}" stroke-linecap="round" stroke-linejoin="round">${s.svg}</g></svg>`;
    const img=new Image();await new Promise((ok,no)=>{img.onload=ok;img.onerror=no;img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});try{await img.decode()}catch{}
    const c=document.createElement('canvas');c.width=W;c.height=H;c.getContext('2d').drawImage(img,0,0,W,H);if(blank(c)){if(e.tries++<1){await new Promise(r=>setTimeout(r,250));return make(e)}throw Error('nothing drawn')}
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));if(!blob)throw Error('no image');e.url=URL.createObjectURL(blob);e.win=win;e.W=W;e.H=H;e.state='ready'}catch{e.state='failed'}}
const attr=v=>String(v??'').replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
// Safari can report an SVG image loaded before the bitmaps inside it are: a try on a tiny copy tells
function blank(c){try{const t=document.createElement('canvas');t.width=t.height=32;const g=t.getContext('2d',{willReadFrequently:true});g.drawImage(c,0,0,32,32);const d=g.getImageData(0,0,32,32).data;for(let i=3;i<d.length;i+=4)if(d[i])return false;return true}catch{return false}}

// Vectors when this one is on screen and larger than its image can show.
function wantsVector(n,e){if(typeof S==='undefined'||!S.view)return false;const c=typeof $==='function'&&$('canvas');if(!c)return false;const z=S.view.zoom,dpr=devicePixelRatio||1,W=e.W||LONG_SIDE;if(Math.max(n.w,n.h)*z*dpr<=W*1.05)return false;
  // the size renderNow read at the start of the frame: reading it here would force a layout
  const[cw,ch]=(typeof viewSize!=='undefined'&&viewSize)||[c.clientWidth,c.clientHeight],vw=cw/z,vh=ch/z;return n.x<S.view.x+vw*1.5&&n.x+n.w>S.view.x-vw*.5&&n.y<S.view.y+vh*1.5&&n.y+n.h>S.view.y-vh*.5}
// How this node's picture would be drawn now: part of what tells the scene it has to redraw it. '' = always vectors.
function stateOf(n,type,paint){if(!isHeavy(type))return'';const e=entry(type,paint);if(e.state==='failed'||wantsVector(n,e))return'v';return e.state==='ready'?'r':'p'}
// What goes in the picture's box; null: draw the vectors.
function pick(n,type,paint,box){const st=stateOf(n,type,paint);if(st===''||st==='v')return null;const e=entry(type,paint);if(st==='r')return el('image',{href:e.url,x:e.win[0],y:e.win[1],width:e.win[2],height:e.win[3],preserveAspectRatio:'none','pointer-events':'none'},box);return plate(type,box)}
// Standing in for the picture until its image is ready, and in thumbnails.
function plate(type,box){const[x,y,w,h]=nums(Stencils.shapes[type].vb);return el('rect',{x,y,width:w,height:h,fill:'#dde3ea',stroke:'#b6c0cd','stroke-width':Math.max(w,h)/150,'pointer-events':'none'},box)}
// A palette or inspector thumbnail, once there's an image for it.
function thumb(type,paint){if(!isHeavy(type))return null;const e=entry(type,paint);return e.state==='ready'?e:null}
const touched=()=>{lastView=performance.now()};
const idle=async()=>{while(pumping||queue.length)await new Promise(r=>setTimeout(r,40))};
return{isHeavy,stateOf,pick,plate,thumb,touched,idle,sizeFor};
})();
if(typeof module!=='undefined')module.exports=Raster;
