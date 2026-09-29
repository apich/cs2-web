// Preserve original HDR object positions for the anodized-airbrushed Fade finish.
// Source2Viewer dumps the glock composite position texture as a ZIP-compressed
// EXR; this reads its green channel, upsamples to the bake resolution and writes
// RGB float32, which is the layout bake-finishes.mjs consumes.
import fs from 'node:fs';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=path.join(root,'artifacts/weapon-expansion/source/weapons/models/glock18/materials/composite_inputs');
const exr=fs.readdirSync(source).find(f=>f.endsWith('.exr'));
if(!exr)throw Error('No EXR position texture in '+source+'; run extract-finishes first');
const b=fs.readFileSync(path.join(source,exr));

const HALF=2;
function half(h){
  const sign=(h&0x8000)?-1:1,exp=(h&0x7c00)>>10,frac=h&0x03ff;
  if(exp===0)return sign*2**-14*(frac/1024);
  if(exp===31)return frac?NaN:sign*Infinity;
  return sign*2**(exp-15)*(1+frac/1024);
}

let o=8;const channels=[];let compression,width,height;
for(;;){
  const nameEnd=b.indexOf(0,o);if(nameEnd<0)throw Error('Truncated EXR header');
  const name=b.toString('ascii',o,nameEnd);
  if(!name){o=nameEnd+1;break;}
  o=nameEnd+1;
  const typeEnd=b.indexOf(0,o),type=b.toString('ascii',o,typeEnd);o=typeEnd+1;
  const len=b.readUInt32LE(o);o+=4;
  const value=b.subarray(o,o+len);o+=len;
  if(name==='channels'){
    let c=0;
    while(c<value.length&&value[c]!==0){
      const end=value.indexOf(0,c);
      channels.push({name:value.toString('ascii',c,end),type:value.readInt32LE(end+1)});
      c=end+1+16;
    }
  }else if(name==='compression')compression=value[0];
  else if(name==='dataWindow'){width=value.readInt32LE(8)-value.readInt32LE(0)+1;height=value.readInt32LE(12)-value.readInt32LE(4)+1;}
}
if(compression!==3)throw Error('Expected ZIP-compressed EXR, got compression '+compression);
if(channels.some(c=>c.type!==HALF))throw Error('Expected half-float channels');
const perScanline=channels.length*width;
const scanlines=16;
const chunkCount=Math.ceil(height/scanlines);
if(b.length<o+chunkCount*8)throw Error('Truncated EXR offset table');

const green=channels.findIndex(c=>/^[GB]$/.test(c.name));
if(green<0)throw Error('No green channel in '+channels.map(c=>c.name).join('/'));

const grid=new Float32Array(width*height);
for(let chunk=0;chunk<chunkCount;chunk++){
  const at=b.readUInt32LE(o+chunk*8);
  const y=b.readInt32LE(at),size=b.readInt32LE(at+4);
  const rows=Math.min(scanlines,height-y);
  const raw=inflateSync(b.subarray(at+8,at+8+size));
  const need=rows*perScanline*2;
  if(raw.length<need)throw Error(`Chunk ${chunk} decoded ${raw.length} bytes, expected ${need}`);
  for(let r=0;r<rows;r++)for(let x=0;x<width;x++)
    grid[(y+r)*width+x]=half(raw.readUInt16LE(((r*channels.length+green)*width+x)*2));
}

const n=2048,out=Buffer.alloc(n*n*3*4);
for(let y=0;y<n;y++){
  const sy=Math.min(height-1,(y+0.5)*height/n-0.5),y0=Math.max(0,Math.floor(sy)),y1=Math.min(height-1,y0+1),fy=sy-y0;
  for(let x=0;x<n;x++){
    const sx=Math.min(width-1,(x+0.5)*width/n-0.5),x0=Math.max(0,Math.floor(sx)),x1=Math.min(width-1,x0+1),fx=sx-x0;
    const v=grid[y0*width+x0]*(1-fx)*(1-fy)+grid[y0*width+x1]*fx*(1-fy)+grid[y1*width+x0]*(1-fx)*fy+grid[y1*width+x1]*fx*fy;
    out.writeFloatLE(v,(y*n+x)*12+4);
  }
}
const target=path.join(root,'artifacts/weapon-expansion/glock-position.f32');
fs.writeFileSync(target,out);
console.log(`${exr}: ${width}x${height} -> ${n}x${n} green channel, ${out.length} bytes`);
