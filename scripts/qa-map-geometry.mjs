import {createServer} from 'vite';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const label=process.argv.includes('--before')?'before':'after';
const baseline=label==='before'?execFileSync('git',['show','HEAD:client/map-scene.js'],{encoding:'utf8'}):null;
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false},plugins:[{
 name:'map-baseline',enforce:'pre',load(id){if(baseline&&id.replaceAll('\\','/').endsWith('/client/map-scene.js'))return baseline;}
}]});
let browser;
try{
 await mkdir('artifacts/map-geometry',{recursive:true});await server.listen();
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1280,height:720}});
 page.on('pageerror',error=>{throw error;});
 await page.route('**/__map-qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="margin:0"></body>'}));
 await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__map-qa`);
 await page.evaluate(async()=>{
  const THREE=await import('/node_modules/three/build/three.module.js');
  const {createMapScene}=await import('/client/map-scene.js');
  const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(1280,720);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.append(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,1280/720,.045,400);
  await createMapScene(scene);
  window.mapQA={renderer,scene,camera};
 });
 for(const [name,position,target] of [
  ['b-site',[-65,3,-60],[-80,14,-57]],
  ['b-site-south',[-40,4,-65],[-38,14,-40]],
  ['a-long',[37,2.6,-54],[10,9,-61]]
 ]){
  await page.evaluate(({position,target})=>{const {renderer,scene,camera}=window.mapQA;camera.position.set(...position);camera.lookAt(...target);renderer.render(scene,camera);},{position,target});
  await page.screenshot({path:`artifacts/map-geometry/${name}-${label}.png`});
 }
 console.log(`Map screenshots: artifacts/map-geometry/*-${label}.png`);
}finally{await browser?.close();await server.close();}
