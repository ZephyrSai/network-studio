// Detailed pictures: how large an image is made, and that nothing here applies where there's no browser. The swap itself is covered in the browser by live1.mjs and fit1.mjs.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs'),path=require('path'),vm=require('vm');
function sandbox(){const ctx={console,Math,JSON,Date,Map,Set,Array,Object,String,Number,RegExp,Error,Promise,Infinity,NaN,parseFloat,parseInt,isFinite,globalThis:null};ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../js/raster.js'),'utf8').replace(/^const Raster=/m,'var Raster='),ctx);return ctx}
const{Raster}=sandbox();

test('image size: the long side, held to an area, never degenerate',()=>{const s=Raster.sizeFor;
  let[W,H]=s(19,1.75);assert.equal(W,1600,'a 1U faceplate gets the full width');assert.equal(H,147);
  [W,H]=s(1.75,19);assert.equal(H,1600,'upright too');assert.equal(W,147);
  [W,H]=s(100,100);assert.ok(W*H<=1.6e6+W+H,'a square one is held to the area: '+W+'x'+H);assert.equal(W,H);
  [W,H]=s(1000,1);assert.equal(W,1600);assert.equal(H,8,'never thinner than 8 px');
  [W,H]=s(4,3);assert.ok(W*H<=1.6e6+W+H);assert.ok(Math.abs(W/H-4/3)<.01,'keeps its proportions')});

test('no browser: nothing is heavy, and drawing falls back to vectors',()=>{assert.equal(Raster.isHeavy('anything'),false);assert.equal(Raster.thumb('anything',{}),null);assert.equal(Raster.stateOf({},'anything',{}),'');assert.equal(Raster.pick({},'anything',{},null),null)});
