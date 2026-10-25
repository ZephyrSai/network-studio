// Revision numbering, change tracking, revision tables, clouds and deltas.
const test=require('node:test'),assert=require('node:assert');
const Core=require('../js/core.js');globalThis.Core=Core;
const R=require('../js/revisions.js');
const C=Core;

test('next revision follows the scheme in use',()=>{
  assert.equal(R.nextRev('1.0'),'1.1');assert.equal(R.nextRev('1.9'),'1.10');assert.equal(R.nextRev('1.4',true),'2.0');assert.equal(R.nextRev('A'),'B');assert.equal(R.nextRev('Z'),'AA');assert.equal(R.nextRev('AZ'),'BA');
  assert.equal(R.nextRev('P01'),'P02');assert.equal(R.nextRev('Rev 3'),'Rev 4');assert.equal(R.nextRev('c'),'d');assert.equal(R.nextRev(''),'A');assert.equal(R.nextRev('v2.3'),'v2.4')});

function doc(){const d=C.newDoc('R');const p=d.pages[0];const a=C.node('switch',100,100,'SW1'),b=C.node('router',400,100,'R1'),c=C.node('firewall',1200,800,'FW');p.items.push(a,b,c,C.edge([C.center(a),C.center(b)],{node:a.id,port:null},{node:b.id,port:null}));return{d,p,a,b,c}}

test('changes since the last revision: added, modified, removed — routing noise and markup ignored',()=>{
  const{d,p,a,b,c}=doc();assert.equal(R.changes(d).known,false);R.setBaseline(d);assert.equal(R.changes(d).count,0);
  p.items.find(n=>n.kind==='edge').points=[[0,0],[5,5],[9,9]];assert.equal(R.changes(d).count,0,'re-routing a link is not a change');
  a.x+=40;b.data.ip='10.0.0.1';p.items.push(C.node('camera',600,300,'CAM'));p.items.splice(p.items.indexOf(c),1);p.items.push(R.cloud(0,0,50,50,'B'));
  const ch=R.changes(d);assert.equal(ch.modified.length,2);assert.equal(ch.added.length,1);assert.deepEqual(ch.removed,[c.id]);assert.equal(ch.count,4)});

test('issuing a revision logs it, updates tables, clouds each area of change and resets the baseline',()=>{
  const{d,p,a,b,c}=doc();C.move(b,200-b.x,0);R.setBaseline(d);const t=R.newTable(d,0,0,d.layers[0].id);p.items.push(t);assert.equal(t.rows.length,2,'header + initial issue');
  a.x+=20;b.labels[0].text='R1-new';c.data.ip='10.9.9.9';
  const r=R.issue(d,{rev:R.nextRev(d.meta.revision),description:'Re-addressed firewall',by:'SB',clouds:true});
  assert.equal(d.meta.revision,'1.1');assert.equal(d.revisions.at(-1).description,'Re-addressed firewall');assert.deepEqual(t.rows.at(-1),['1.1',R.today(),'Re-addressed firewall','SB']);
  const clouds=p.items.filter(n=>n.type==='revcloud'),deltas=p.items.filter(n=>n.type==='revdelta');
  assert.equal(r.clouds,2,'switch+router are close together: one cloud; the far firewall gets its own');assert.equal(clouds.length,2);assert.equal(deltas.length,2);assert.ok(deltas.every(x=>x.labels[0].text==='1.1'&&x.data.rev==='1.1'));
  const cl=clouds.find(x=>x.x<300);assert.ok(cl.x<a.x&&cl.x+cl.w>b.x+b.w,'cloud surrounds both changed devices');
  assert.ok(d.layers.some(l=>l.name==='Revisions')&&clouds.every(x=>x.layer===d.layers.find(l=>l.name==='Revisions').id),'markup on its own layer');
  assert.equal(R.changes(d).count,0,'baseline reset; clouds are not changes');
  a.x+=20;const r2=R.issue(d,{rev:'1.2',clouds:true,clearClouds:true});assert.equal(p.items.filter(n=>n.type==='revcloud').length,1,'earlier clouds cleared');assert.equal(p.items.filter(n=>n.type==='revdelta').length,3,'deltas kept')});

test('tables can list newest first and cap rows',()=>{const{d}=doc();d.revisions=['A','B','C','D'].map(r=>({rev:r,date:'2026-01-01',description:'x',by:''}));const t=R.newTable(d,0,0,null);t.newestFirst=true;t.maxRows=2;R.syncTables({pages:[{items:[t]}],revisions:d.revisions,meta:d.meta});assert.deepEqual(t.rows.map(r=>r[0]),['Rev','D','C'])});

test('areas already clouded by hand for the revision are not clouded twice',()=>{const{d,p,a}=doc();R.setBaseline(d);a.x+=10;const c=R.cloud(a.x-20,a.y-20,a.w+40,a.h+40,'1.1',null);p.items.push(c);const r=R.issue(d,{rev:'1.1',clouds:true});assert.equal(r.clouds,0);assert.equal(p.items.filter(n=>n.type==='revcloud').length,1)});
