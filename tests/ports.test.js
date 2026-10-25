// Arranging connection points.
const test=require('node:test'),assert=require('node:assert');
const P=require('../js/ports.js');
const pts=n=>Array.from({length:n},(_,i)=>({id:'p'+i,x:(i+1)/(n+1),y:i%2?1:0,name:'Gi'+i}));

test('a row along one side keeps left-to-right order and ids',()=>{const r=P.arrange(pts(4),'bottom');assert.deepEqual(r.map(p=>p.y),[1,1,1,1]);assert.deepEqual(r.map(p=>p.x),[.2,.4,.6,.8]);assert.deepEqual(r.map(p=>p.id),['p0','p1','p2','p3'])});
test('columns on the left or right',()=>{const r=P.arrange(pts(3),'right');assert.ok(r.every(p=>p.x===1));assert.deepEqual(r.map(p=>p.y).sort(),[.25,.5,.75])});
test('split between top and bottom: upper half on top, evenly spaced',()=>{const r=P.arrange([{id:'a',x:.1,y:0},{id:'b',x:.9,y:0},{id:'c',x:.5,y:1},{id:'d',x:.2,y:1},{id:'e',x:.7,y:1}],'topBottom');
  assert.equal(r.filter(p=>p.y===0).length,3);assert.equal(r.filter(p=>p.y===1).length,2);assert.deepEqual(r.filter(p=>p.y===1).map(p=>p.x).sort(),[1/3,2/3].map(v=>Math.round(v*1000)/1000))});
test('evenly around the outline, weighted by the box shape',()=>{const r=P.arrange(pts(8),'around',{w:200,h:50});const sides=r.map(P.side);assert.deepEqual(['top','right','bottom','left'].map(s=>sides.filter(x=>x===s).length),[3,1,3,1],'long sides get more points');assert.ok(r.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1))});
test('evenly on the sides they are on; default names follow their side',()=>{const r=P.arrange([{id:'1',x:.1,y:0,name:'Top'},{id:'2',x:.3,y:0,name:'Right'},{id:'3',x:0,y:.2,name:'Left'}],'sides');
  assert.deepEqual(r.filter(p=>p.y===0).map(p=>p.x),[1/3,2/3].map(v=>Math.round(v*1000)/1000));assert.deepEqual(r.map(p=>p.name),['Top 1','Top 2','Left'])});
