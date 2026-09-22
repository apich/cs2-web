import assert from 'node:assert/strict';
import {createServer} from 'vite';

// Optional browser QA: use an installed Playwright module without adding a game dependency.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});
let browser;
try{
 await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage();
 await page.route('**/__explosion-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__explosion-qa`);
 const result=await page.evaluate(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {UtilityEffects}=await import('/client/utility-effects.js');
  const renderer=new THREE.WebGLRenderer();renderer.setSize(960,540);document.body.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,960/540,.01,100);
  camera.position.set(0,1,3);
  scene.add(new THREE.HemisphereLight(0xffffff,0x555555,2));
  const wall=new THREE.Mesh(new THREE.BoxGeometry(10,10,1),new THREE.MeshStandardMaterial({color:0x999999}));
  wall.position.z=-5;scene.add(wall);
  const effects=new UtilityEffects(scene);
  const pointLights=()=>{let count=0;scene.traverse(o=>{if(o.isPointLight)count++;});return count;};
  const programs=()=>renderer.properties.get(wall.material).currentProgram.id;
  const render=()=>{const start=performance.now();renderer.render(scene,camera);renderer.getContext().finish();return performance.now()-start;};
  effects.update(1/60,camera);render();
  const baseline={lights:pointLights(),programs:programs()};
  const samples=[];
  for(let cycle=0;cycle<3;cycle++){
   for(let i=0;i<4;i++)effects.spawnExplosion({x:i*.1,y:0,z:1});
   effects.update(1/60,camera);
   samples.push({phase:'blast',lights:pointLights(),renderMs:render(),programs:programs()});
   for(let i=0;i<90;i++)effects.update(1/60,camera);
   samples.push({phase:'expired',lights:pointLights(),renderMs:render(),programs:programs()});
   effects.clear();
  }
  const cleared=pointLights();effects.dispose();const disposed=pointLights();
  wall.geometry.dispose();wall.material.dispose();renderer.dispose();
  return {baseline,samples,cleared,disposed};
 });
 console.log(JSON.stringify(result,null,2));
 assert.ok(result.samples.every(s=>s.lights===result.baseline.lights),'Explosion lifecycle must keep the light count stable');
 assert.ok(result.samples.every(s=>s.programs===result.baseline.programs),'Explosions must reuse the lit scene shader');
 assert.equal(result.cleared,result.baseline.lights);assert.equal(result.disposed,0);
}finally{await browser?.close();await server.close();}
