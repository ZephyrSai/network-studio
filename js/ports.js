// Arrange a device's connection points: evenly along one side, split over two opposite sides, evenly round the
// whole outline, or spread evenly on the sides they are already on. Points keep their ids, so attached connectors follow.
const Ports=(()=>{
const SIDES=['top','right','bottom','left'];
const side=p=>{const d=[p.y,1-p.x,1-p.y,p.x];return SIDES[d.indexOf(Math.min(...d))]};
// position round the outline, clockwise from the top-left corner (one unit per side)
const along=p=>{const s=side(p);return s==='top'?p.x:s==='right'?1+p.y:s==='bottom'?2+(1-p.x):3+(1-p.y)};
const onSide=(s,t)=>s==='top'?{x:t,y:0}:s==='right'?{x:1,y:t}:s==='bottom'?{x:t,y:1}:{x:0,y:t};
const even=(k,i)=>(i+1)/(k+1);
const MODES=[['bottom','In a row along the bottom'],['top','In a row along the top'],['left','In a column on the left'],['right','In a column on the right'],['topBottom','Split between top and bottom'],['leftRight','Split between left and right'],['around','Evenly around the device'],['sides','Evenly on the sides they are on']];
function arrange(ports,mode,{w=1,h=1}={}){const ps=ports.map(p=>({...p}));if(!ps.length)return ps;
  if(SIDES.includes(mode)){const horiz=mode==='top'||mode==='bottom',order=[...ps].sort((a,b)=>horiz?a.x-b.x||a.y-b.y:a.y-b.y||a.x-b.x);order.forEach((p,i)=>Object.assign(p,onSide(mode,even(order.length,i))))}
  else if(mode==='topBottom'||mode==='leftRight'){const tb=mode==='topBottom',[s1,s2]=tb?['top','bottom']:['left','right'],key=tb?'x':'y',order=[...ps].sort((a,b)=>tb?a.y-b.y||a.x-b.x:a.x-b.x||a.y-b.y),half=Math.ceil(order.length/2);
    [order.slice(0,half),order.slice(half)].forEach((g,gi)=>g.sort((a,b)=>a[key]-b[key]).forEach((p,i)=>Object.assign(p,onSide(gi?s2:s1,even(g.length,i)))))}
  else if(mode==='around'){const per=2*(w+h),order=[...ps].sort((a,b)=>along(a)-along(b));order.forEach((p,i)=>{let d=(i+.5)/order.length*per;if(d<w)Object.assign(p,{x:d/w,y:0});else if((d-=w)<h)Object.assign(p,{x:1,y:d/h});else if((d-=h)<w)Object.assign(p,{x:1-d/w,y:1});else{d-=w;Object.assign(p,{x:0,y:1-d/h})}})}
  else if(mode==='sides'){const groups={};for(const p of ps)(groups[side(p)]??=[]).push(p);for(const[s,g]of Object.entries(groups)){const key=s==='top'||s==='bottom'?'x':'y';g.sort((a,b)=>a[key]-b[key]).forEach((p,i)=>Object.assign(p,onSide(s,even(g.length,i))))}}
  // points still carrying a default side name get the name of the side they ended up on
  const DEF=/^(Top|Right|Bottom|Left)( \d+)?$/,count={};for(const p of ps)if(DEF.test(p.name||'')){const s=side(p);count[s]=(count[s]||0)+1}
  const seen={};for(const p of ps)if(DEF.test(p.name||'')){const s=side(p),n=s[0].toUpperCase()+s.slice(1);seen[s]=(seen[s]||0)+1;p.name=count[s]>1?`${n} ${seen[s]}`:n}
  return ps.map(p=>({...p,x:Math.round(p.x*1000)/1000,y:Math.round(p.y*1000)/1000}))}
return{arrange,side,MODES};
})();
if(typeof module!=='undefined')module.exports=Ports;
