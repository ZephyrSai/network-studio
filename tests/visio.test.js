// Visio import geometry: ShapeSheet formulas, colours and geometry rows → SVG path data (shape-local inches, y up).
const test=require('node:test'),assert=require('node:assert');
globalThis.Core=require('../js/core.js');
const Visio=require('../js/visio.js'),{geomPath,evalF,color,ellArc}=Visio._;
const near=(a,b,e=1e-3)=>Math.abs(a-b)<=e;
// cells as the parser sees them: elements with V/F attributes; inherited ones are flagged
const cell=(V,F,inh)=>({...(inh?{inh:true}:{}),getAttribute:a=>a==='V'?(V==null?null:String(V)):a==='F'?(F??null):null});
const row=(T,c)=>({T,cells:Object.fromEntries(Object.entries(c).map(([k,v])=>[k,Array.isArray(v)?cell(...v):cell(v)]))});
const sec=(...rows)=>({cells:{},rows:new Map(rows.map((r,i)=>[String(i+1),r]))});
const nums=d=>d.match(/-?\d*\.?\d+(e-?\d+)?/g).map(Number);

test('formulas: arithmetic on the shape size and units, anything else is left to the stored value',()=>{
  assert.equal(evalF('Width*0.5',{W:2,H:1}),1);
  assert.equal(evalF('Height*-0.25',{W:1,H:2}),-.5);
  assert.equal(evalF('(1+2)*3',{W:1,H:1}),9);
  assert.equal(evalF('0.25 in',{W:1,H:1}),.25);
  assert.equal(evalF('TxtWidth*0.5',{W:1,H:1,TW:3}),1.5);
  assert.equal(evalF('TxtWidth*0.5',{W:1,H:1}),null,'no text block size known');
  for(const f of['Inh','GUARD(Width)','Sheet.5!Width*0.5','THEMEVAL()'])assert.equal(evalF(f,{W:1,H:1}),null,f);
});

test('colours: hex, Visio palette index and RGB()',()=>{
  assert.equal(color('#AABBCC'),'#aabbcc');assert.equal(color('2'),'#ff0000');assert.equal(color('RGB(16, 32, 48)'),'#102030');
  assert.equal(color('',null),null);assert.equal(color('Themed','#123456'),'#123456');
});

test('ArcTo: positive bow turns counter-clockwise, so travelling up the arc bulges right',()=>{
  const d=geomPath(sec(row('MoveTo',{X:.3,Y:0}),row('ArcTo',{X:.3,Y:.6,A:.15})),{W:.6,H:.6});
  const a=nums(d.slice(d.indexOf('A')));assert.ok(near(a[0],.375)&&near(a[1],.375),'radius from chord 0.6 and bow 0.15');
  assert.equal(a[3],0,'minor arc');assert.equal(a[4],1,'sweep: counter-clockwise in y-up space');
  const neg=geomPath(sec(row('MoveTo',{X:.3,Y:0}),row('ArcTo',{X:.3,Y:.6,A:-.15})),{W:.6,H:.6});assert.equal(nums(neg.slice(neg.indexOf('A')))[4],0);
  const flat=geomPath(sec(row('MoveTo',{X:0,Y:0}),row('ArcTo',{X:1,Y:0,A:0})),{W:1,H:1});assert.ok(/L1 0/.test(flat),'zero bow is a line');
});

test('EllipticalArcTo: ellipse through both ends and the control point, at the given axis ratio',()=>{
  const a=nums(ellArc([1,.12],[0,.12],[.5,-.05],0,2));// rx ry rotation large sweep x y
  assert.ok(near(a[0],.5376,2e-3)&&near(a[1],.2688,2e-3),`radii ${a[0]} ${a[1]}`);assert.equal(a[3],0);assert.deepEqual(a.slice(5),[0,.12]);
  // passing below the chord from right to left is clockwise in y-up space
  assert.equal(a[4],0);
});

test('relative rows scale by the shape size; POLYLINE x/y type 0 means fractions of width/height',()=>{
  const d=geomPath(sec(row('RelMoveTo',{X:0,Y:.5}),row('RelLineTo',{X:1,Y:.5}),row('PolylineTo',{X:2,Y:0,A:[null,'POLYLINE(0,0,0.25,1,0.5,0)']})),{W:2,H:1});
  assert.equal(d,'M0 0.5L2 0.5L0.5 1L1 0L2 0');
  const abs=geomPath(sec(row('MoveTo',{X:0,Y:0}),row('PolylineTo',{X:2,Y:0,A:[null,'POLYLINE(1,1,0.25,1)']})),{W:2,H:1});assert.equal(abs,'M0 0L0.25 1L2 0');
});

test('inherited cells follow the instance size when their formula is simple; own values win otherwise',()=>{
  const inh=sec(row('MoveTo',{X:[0,'Width*0',true],Y:[0,null,true]}),row('LineTo',{X:[1,'Width',true],Y:[.5,'Height*0.5',true]}));
  assert.equal(geomPath(inh,{W:3,H:2}),'M0 0L3 1','resized instance without rewritten cells');
  const own=sec(row('MoveTo',{X:0,Y:0}),row('LineTo',{X:[1,'Width'],Y:.5}));
  assert.equal(geomPath(own,{W:3,H:2}),'M0 0L1 0.5','a shape\'s own value is what Visio last computed');
});

test('Ellipse rows close; open paths are not closed',()=>{
  const info={};geomPath(sec(row('Ellipse',{X:.5,Y:.5,A:1,B:.5,C:.5,D:1})),{W:1,H:1},info);assert.ok(info.closed);
  const o={};geomPath(sec(row('MoveTo',{X:0,Y:0}),row('LineTo',{X:1,Y:1})),{W:1,H:1},o);assert.ok(!o.closed);
});
