// Scaling a selection keeps devices, labels, zones, racks and connector arrangements intact.
const test=require('node:test'),assert=require('node:assert');
const Core=require('../js/core.js');globalThis.Core=Core;
globalThis.Revisions={MARKUP:new Set(['revcloud','revdelta'])};
const Scale=require('../js/scale.js');
const C=Core,near=(a,b,e=.01)=>Math.abs(a-b)<=e;

function scene(){const z=C.zone('LAN',100,100,600,400,'#eef','#99a');const a=C.node('switch',200,200,'Core switch'),b=C.node('router',500,200,'Edge router');
  a.labels[0].y=a.y+a.h+16;b.labels[0].y=b.y+b.h+16;const e=C.edge([[264,232],[400,232],[400,232],[500,232]],{node:a.id,port:a.ports[1].id},{node:b.id,port:b.ports[3].id});
  const out=C.node('firewall',900,200,'Outside');const e2=C.edge([C.center(b),C.center(out)],{node:b.id,port:null},{node:out.id,port:null});
  const t=C.text('Note',150,420,200,40,14);t.labels[0].wrapWidth=180;const lg={id:C.uid(),kind:'legend',x:20,y:600,w:200,h:100,labels:[],pin:'bl'};
  return{z,a,b,e,out,e2,t,lg,all:[z,a,b,e,out,e2,t,lg]}}

test('scale by 90% about the top-left: geometry, ports and connector bends scale together',()=>{
  const s=scene(),sel=[s.z,s.a,s.b,s.e,s.t,s.lg],before=C.copy(sel),o=[100,100];
  const r=Scale.apply(sel,s.all,.9,{origin:o});
  assert.ok(near(s.z.x,100)&&near(s.z.w,540)&&near(s.z.h,360),'zone resizes from the anchor');
  const ca=C.center(s.a),cb=C.center(before[1]);assert.ok(near(ca[0],100+(cb[0]-100)*.9)&&near(ca[1],100+(cb[1]-100)*.9),'device centre maps through the scale');
  assert.ok(near(s.a.w,before[1].w*.9),'icon keeps its proportions');
  // port positions are relative, so the connector end still sits on the port after scaling
  const port=C.portPoint(s.a,s.a.ports[1]);assert.ok(near(port[0],s.e.points[0][0],.6)&&near(port[1],s.e.points[0][1],.6),'connector still starts at the port');
  assert.deepEqual(r.reroute,[s.e2.id],'only the connector leaving the selection is re-routed');
  assert.equal(s.lg.x,20,'pinned legend is left to follow the page')});

test('labels stay below their device and centred; text size is optional',()=>{
  const s=scene(),gap=s.a.labels[0].y-(s.a.y+s.a.h),dx=s.a.labels[0].x-(s.a.x+s.a.w/2),size=s.a.labels[0].size;
  Scale.apply([s.a],s.all,.5,{});assert.ok(near(s.a.labels[0].y-(s.a.y+s.a.h),gap),'gap kept when text is not scaled');assert.ok(near(s.a.labels[0].x-(s.a.x+s.a.w/2),dx*.5));assert.equal(s.a.labels[0].size,size);
  const s2=scene();Scale.apply([s2.a],s2.all,.5,{text:true});assert.ok(near(s2.a.labels[0].y-(s2.a.y+s2.a.h),gap*.5),'gap scales with text');assert.ok(near(s2.a.labels[0].size,size*.5))});

test('racks and their equipment move as one rigid unit',()=>{
  const rack=C.node('rack',100,100,'Rack',222,800);rack.units=42;const sv=C.node('rk-server',116,200,'Server',190,18);const all=[rack,sv];
  const offset=[sv.x-rack.x,sv.y-rack.y],size=[rack.w,rack.h,sv.w,sv.h];Scale.apply(all,all,.8,{origin:[0,0]});
  assert.deepEqual([rack.w,rack.h,sv.w,sv.h],size,'no resize');assert.ok(near(sv.x-rack.x,offset[0])&&near(sv.y-rack.y,offset[1]),'equipment stays in its slot');
  assert.ok(near(rack.x+rack.w/2,(100+111)*.8),'rack centre moves with the scale')});

test('line widths and tables scale only when asked',()=>{const s=scene(),w=s.e.strokeWidth||2;s.e.strokeWidth=w;Scale.apply([s.a,s.b,s.e],s.all,.5,{});assert.equal(s.e.strokeWidth,w);Scale.apply([s.a,s.b,s.e],s.all,.5,{lines:true});assert.equal(s.e.strokeWidth,w*.5);
  const t={id:'t',kind:'table',x:0,y:0,cols:[100,200],rowH:20,size:10,rows:[['a','b'],['c','d']],labels:[]};Scale.apply([t],[t],.5,{origin:[0,0],text:true});assert.deepEqual([t.cols,t.rowH,t.size,t.w,t.h],[[50,100],10,5,150,20])});

test('scaling a zone brings its members and their links, even when only the zone is selected',()=>{
  const s=scene(),ax=C.center(s.a),pts=C.copy(s.e.points);const r=Scale.apply([s.z],s.all,.5,{origin:[100,100]});
  assert.ok(r.items.includes(s.a)&&r.items.includes(s.b)&&r.items.includes(s.t),'members came along');assert.ok(r.items.includes(s.e),'the link between two members came along');
  const c=C.center(s.a);assert.ok(near(c[0],100+(ax[0]-100)*.5)&&near(c[1],100+(ax[1]-100)*.5));assert.ok(near(s.e.points[1][0],100+(pts[1][0]-100)*.5),'link bends scaled')});

test('a device scaled inside a zone that is not scaled stays inside it',()=>{
  const s=scene();// scale the router up a lot about a far origin — it would fly out of the LAN zone
  Scale.apply([s.b],s.all,3,{origin:[0,0]});const b=C.box(s.b);assert.ok(b.x>=s.z.x&&b.y>=s.z.y&&b.x+b.w<=s.z.x+s.z.w&&b.y+b.h<=s.z.y+s.z.h,'still inside the zone')});

test('a device outside a zone is not scaled into it',()=>{
  const s=scene();const out=C.node('server',40,40,'Out');s.all.push(out);// scaling about (900,700) by 0.6 pulls it towards the zone centre
  Scale.apply([out],s.all,.2,{origin:[400,300]});const c=C.center(out);assert.ok(!(c[0]>=s.z.x&&c[0]<=s.z.x+s.z.w&&c[1]>=s.z.y&&c[1]<=s.z.y+s.z.h),'kept outside')});
