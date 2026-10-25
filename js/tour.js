// First-run tour: a few steps that spotlight one area of the editor at a time and dim the rest.
// Shown once (prefs.tourDone); Skip at any time; replay from View ▸ Help ▸ Tour. Areas that are hidden right now
// (a collapsed panel, a phone layout) are left out, so the count always matches what is on screen.
const Tour=(()=>{
const MOD=/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent)?'⌘':'Ctrl';
const STEPS=[
  {at:['.ribbonTabs','#ribbon'],title:'Welcome — the ribbon',text:'Tools are grouped by tab: Home, Insert, Design, Data, Analyze, Arrange and View. <b>File</b> opens, saves and exports (Visio, draw.io, PDF).'},
  {at:['aside.left'],title:'Shapes, icons & templates',text:'Drag devices onto the page, search 360+ shapes or online icons, or drop a whole template — or just one zone of it — into this drawing.'},
  {at:['#workarea'],title:'The page',text:'Drag from a device’s blue points to connect it. Drag on empty space to select what is fully inside. <b>Right-click</b> anything to change it — even many at once.',inside:true},
  {at:['aside.right'],title:'Inspector',text:'Properties, data and style of the selection. With nothing selected: the page — paper, border, background and revisions.'},
  {at:['footer.status'],title:'Status bar',text:'Live design check, revision status, page tabs and zoom. <b>Fit page</b> sizes the page and its border to the drawing.'},
  {at:['.chromeBtns'],title:'Make room',text:`Hide panels, the ribbon or the title bar, or go full screen. <b>${MOD}+K</b> finds any command and <b>?</b> lists shortcuts. Replay this tour from View ▸ Help.`},
];
let el=null,steps=[],i=0,onKey=null,onResize=null;
const visible=s=>{const els=s.at.map(q=>document.querySelector(q)).filter(e=>e&&e.offsetWidth>8&&e.offsetHeight>8&&getComputedStyle(e).visibility!=='hidden');return els.length?els:null};
const union=els=>{const rs=els.map(e=>e.getBoundingClientRect()),x=Math.min(...rs.map(r=>r.left)),y=Math.min(...rs.map(r=>r.top));return{x,y,w:Math.max(...rs.map(r=>r.right))-x,h:Math.max(...rs.map(r=>r.bottom))-y}};
function place(){const s=steps[i],els=visible(s);if(!els){next();return}
  const pad=6,r0=union(els),r={x:Math.max(4,r0.x-pad),y:Math.max(4,r0.y-pad),w:Math.min(innerWidth-8,r0.w+2*pad),h:Math.min(innerHeight-8,r0.h+2*pad)},hole=el.querySelector('.tourHole'),card=el.querySelector('.tourCard');
  Object.assign(hole.style,{left:r.x+'px',top:r.y+'px',width:r.w+'px',height:r.h+'px'});
  card.querySelector('h3').innerHTML=s.title;card.querySelector('p').innerHTML=s.text;
  card.querySelector('.tourCount').textContent=`${i+1} / ${steps.length}`;card.querySelector('[data-tour="back"]').hidden=i===0;
  const nx=card.querySelector('[data-tour="next"]');nx.textContent=i===steps.length-1?'Get started':'Next';
  card.querySelector('.tourDots').innerHTML=steps.map((_,k)=>`<i class="${k===i?'on':''}"></i>`).join('');
  // the card goes beside the spotlight where there is room, else inside it
  const cw=Math.min(340,innerWidth-24),ch=card.offsetHeight||170,gap=14;card.style.width=cw+'px';let x,y;
  if(!s.inside&&r.y+r.h+gap+ch<innerHeight-8){y=r.y+r.h+gap;x=r.x+Math.min(r.w,cw)/2-cw/2+(r.w>cw?0:0)}
  else if(!s.inside&&r.y-gap-ch>8){y=r.y-gap-ch;x=r.x+r.w/2-cw/2}
  else if(!s.inside&&r.x+r.w+gap+cw<innerWidth-8){x=r.x+r.w+gap;y=r.y+Math.min(r.h,ch)/2-ch/2+20}
  else if(!s.inside&&r.x-gap-cw>8){x=r.x-gap-cw;y=r.y+20}
  else{x=r.x+r.w/2-cw/2;y=r.y+Math.min(r.h/2-ch/2,r.h-ch-16)}
  card.style.left=Math.max(8,Math.min(x,innerWidth-cw-8))+'px';card.style.top=Math.max(8,Math.min(y,innerHeight-ch-8))+'px';nx.focus({preventScroll:true})}
function go(k){i=k;if(i<0)i=0;if(i>=steps.length)return end(true);place()}
const next=()=>go(i+1),back=()=>go(i-1);
function end(done){if(!el)return;el.remove();el=null;document.removeEventListener('keydown',onKey,true);removeEventListener('resize',onResize);S.prefs.tourDone=true;savePrefs();if(done)notify('You’re set. View ▸ Help ▸ Tour shows this again.',3200)}
function start(){if(el)return;hideMenus?.();closeDialog?.();steps=STEPS.filter(visible);if(!steps.length)return;i=0;
  el=document.createElement('div');el.className='tour';el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Quick tour');
  el.innerHTML=`<div class="tourHole"></div><div class="tourCard" aria-live="polite"><div class="tourTop"><span class="tourCount"></span><button class="tourSkip" data-tour="skip">Skip tour</button></div><h3></h3><p></p><div class="tourFoot"><span class="tourDots"></span><button data-tour="back">Back</button><button class="primary" data-tour="next">Next</button></div></div>`;
  document.body.append(el);
  el.addEventListener('click',e=>{const a=e.target.closest('[data-tour]')?.dataset.tour;if(a==='next')next();else if(a==='back')back();else if(a==='skip')end(false)});
  // while the tour is open it owns the keyboard: → / Enter next, ← back, Esc skip; nothing reaches the drawing
  onKey=e=>{if(!el)return;const k=e.key;if(k==='ArrowRight'||k==='Enter'){e.preventDefault();next()}else if(k==='ArrowLeft'){e.preventDefault();back()}else if(k==='Escape'){e.preventDefault();end(false)}else if(k==='Tab')return;else{e.preventDefault()}e.stopPropagation()};
  document.addEventListener('keydown',onKey,true);onResize=()=>{if(el)place()};addEventListener('resize',onResize);
  requestAnimationFrame(()=>{place();el.classList.add('on')})}
// First visit only, and never on top of a shared link or a dialog.
function maybe(){if(S.prefs.tourDone||location.hash.startsWith('#doc=')||document.querySelector('dialog[open]'))return false;setTimeout(start,700);return true}
return{start,maybe,end,isOpen:()=>!!el,steps:()=>steps.length};
})();
