import test from 'node:test';
import assert from 'node:assert/strict';
import {DROP_PHYSICS,dropLaunchSpeed,extrapolateDrop} from '../shared/drop-physics.js';

test('drop rendering extrapolates between snapshots but stops with the item',()=>{
  const drop={x:1,y:2,z:3,vx:2,vy:1,vz:-2},moving=extrapolateDrop(drop,.05),capped=extrapolateDrop(drop,1);
  assert.deepEqual(moving,{x:1.1,y:2.05-DROP_PHYSICS.gravity*.05*.05*.5,z:2.9});
  assert.deepEqual(capped,extrapolateDrop(drop,DROP_PHYSICS.extrapolationSeconds));
  assert.deepEqual(extrapolateDrop({...drop,resting:true},.05),{x:1,y:2,z:3});
});

test('moving drops launch faster than the player while idle stays unchanged',()=>{
  assert.equal(dropLaunchSpeed({vx:0,vz:0,grounded:true}),2);
  assert.equal(dropLaunchSpeed({vx:1,vz:0,grounded:true}),4);
  assert.equal(dropLaunchSpeed({vx:2.7,vz:0,grounded:true}),4.7);
  assert.equal(dropLaunchSpeed({vx:4,vz:0,grounded:true}),6);
  assert.equal(dropLaunchSpeed({vx:4,vz:0,grounded:false}),7);
  assert.equal(dropLaunchSpeed({vx:6,vz:0,grounded:true}),8);
  assert.equal(dropLaunchSpeed({vx:6,vz:0,grounded:false}),8);
  assert.equal(DROP_PHYSICS.maxDistance,10);
});
