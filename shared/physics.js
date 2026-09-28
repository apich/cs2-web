import { BufferGeometry, Float32BufferAttribute, Vector3, Ray, Box3, DoubleSide } from 'three';
import { MeshBVH, CENTER } from 'three-mesh-bvh';
import {HullContact} from './hull-collision.js';
import {
  LADDER_CLIMB_SPEED, LADDER_DESCENT_SPEED, LADDER_GRAB_MARGIN, LADDER_JUMP_PUSH,
  LADDER_BASE_TOLERANCE, LADDER_JUMP_SPEED, LADDER_LEDGE_REACH, LADDER_LEDGE_SWEEP,
  LADDER_SNAP, findLadderById,
  ladderClimbRate, ladderVolumeAt, ladderWantsLeave, ladderWantsMount,
} from './ladders.js';

export const PLAYER_RADIUS = 0.30;
export const PLAYER_BODY_RADIUS = 0.35;
export const STAND_HEIGHT = 1.80;
export const CROUCH_HEIGHT = 1.10;
// Source units are converted with the same 0.0254 scale as the map. These are
// the CS jump impulse and gravity, not world-space metres copied as units.
export const GRAVITY = 800 * .0254;
export const JUMP_SPEED = 301.993378 * .0254;
export const STEP_HEIGHT = .46;
export const JUMP_BUFFER_TIME = .05;
// Keep the existing prototype hitbox heights, but cap aerial leg retraction at
// CS's 18-unit standing/crouched hull difference rather than granting 0.70 m.
export const CROUCH_JUMP_LIFT = 18 * .0254;
export const SV_FRICTION = 5.2;
export const SV_STOPSPEED = 100 * .0254;
export const SV_ACCELERATE = 5.5;
export const SV_AIRACCELERATE = 12.0;
export const SV_AIR_WISHSPEED_CAP = 30 * .0254;
// Several static maps can be resident at once, one collision world per map id.
// `world` stays the name of the *active* world so the many internal references
// below are untouched; a room selects its map with activateWorld().
export const DEFAULT_WORLD_KEY = 'de_dust2';
const worlds = new Map();
let world = null;
let worldBounds = new Box3();
let currentWorldKey = null;
const axis = new Vector3();
const motion = new Vector3();
const ray = new Ray();

// Broadphase BVH with a flat, axis-aligned player hull. Render meshes are not
// used as the character collider; both peers use this same collision geometry.
class MapCollision {
  constructor(geometry){this.bvh=new MeshBVH(geometry,{strategy:CENTER,targetLeafSize:16,maxDepth:32});this.geometry=geometry;this.contact=new HullContact();}
  rayIntersect(r){return this.bvh.raycastFirst(r,DoubleSide);}
  sweepDown(c,maxDrop){
    const bounds=c.clone();bounds.min.y-=maxDrop;let distance=Infinity,walkable=false;
    this.bvh.shapecast({intersectsBounds:box=>box.intersectsBox(bounds),intersectsTriangle:tri=>{
      const hit=this.contact.sweepDown(tri,c,maxDrop);if(!hit)return false;
      if(hit.distance<distance-.00001){distance=hit.distance;walkable=hit.walkable;}
      else if(Math.abs(hit.distance-distance)<=.00001)walkable||=hit.walkable;
      return false;
    }});
    return Number.isFinite(distance)&&walkable?distance:null;
  }
  hullIntersect(c){
    const resolved=c.clone(),bounds=c.clone().expandByScalar(.002),contacts=[],push=new Vector3();
    this.bvh.shapecast({
      intersectsBounds:box=>box.intersectsBox(bounds),
      intersectsTriangle:tri=>{
        const contact=this.contact.intersect(tri,resolved);
        if(contact){
          contacts.push(contact);resolved.translate(push.copy(contact.normal).multiplyScalar(contact.depth+.00001));
          bounds.copy(resolved).expandByScalar(.002);
        }else if(contacts.length){
          // A vertical side's top edge may resolve upward before its adjacent
          // tread is visited. Retain the tread's original support contact too.
          const support=this.contact.intersect(tri,c);
          if(support?.walkable)contacts.push({...support,depth:0});
        }
        return false;
      }
    });
    const normal=resolved.min.clone().sub(c.min),depth=normal.length();
    return depth>1e-7?{normal:normal.multiplyScalar(1/depth),depth,contacts,walkable:contacts.some(c=>c.walkable)}:false;
  }
}

export function initPhysics(positions, surfaceMaterials = null, key = DEFAULT_WORLD_KEY, ladders = null, groundPatches = null) {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeBoundingBox();
  const entry = new MapCollision(geometry);
  entry.surfaceMaterials = surfaceMaterials;
  entry.ladders = Array.isArray(ladders) ? ladders : [];
  entry.groundPatches = Array.isArray(groundPatches) ? groundPatches : [];
  entry.bounds = geometry.boundingBox.clone();
  // Re-initialising a key replaces that map's world and frees the old geometry.
  worlds.get(key)?.geometry?.dispose();
  worlds.set(key, entry);
  // Preserve the historical single-world behaviour: the most recent init is
  // active unless a room has explicitly selected another world since.
  if (currentWorldKey === null || key === currentWorldKey || !worlds.has(currentWorldKey)) activateWorld(key);
  return entry;
}

/** Make `key`'s collision world the one every raycast/step query reads. */
export function activateWorld(key) {
  const entry = worlds.get(key);
  if (!entry) return false;
  currentWorldKey = key;
  world = entry;
  worldBounds.copy(entry.bounds);
  return true;
}

export function hasWorld(key) { return worlds.has(key); }
export function getCurrentWorldKey() { return currentWorldKey; }
export function loadedWorldKeys() { return [...worlds.keys()]; }
/** Ladder volumes of the active map; empty when the map has none (Dust II). */
export function activeLadders() { return world?.ladders || []; }

/** Unload a map's world (room teardown, map uninstall, test isolation). */
export function dropWorld(key) {
  if (!worlds.has(key)) return false;
  const entry = worlds.get(key);
  worlds.delete(key);
  entry.geometry?.dispose();
  if (currentWorldKey === key) {
    currentWorldKey = null; world = null; worldBounds.makeEmpty();
    if (worlds.has(DEFAULT_WORLD_KEY)) activateWorld(DEFAULT_WORLD_KEY);
  }
  return true;
}

export function createPlayerState(spawn = {}) {
  return { x:spawn.x||0, y:spawn.y||0, z:spawn.z||0, vx:0,vy:0,vz:0,
    yaw:spawn.yaw||0,pitch:0,grounded:false,crouch:false,height:STAND_HEIGHT,
    lastJump:false,lastJumpId:0,jumpBufferRemaining:0,stepDistance:0,onLadder:false };
}

export function hullFor(p, height=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT) {
  return new Box3(new Vector3(p.x-PLAYER_RADIUS,p.y,p.z-PLAYER_RADIUS),
    new Vector3(p.x+PLAYER_RADIUS,p.y+height,p.z+PLAYER_RADIUS));
}

export function raycastWorld(origin, direction, maxDistance=300) {
  if (!world) return null;
  ray.origin.set(origin.x,origin.y,origin.z);
  ray.direction.set(direction.x,direction.y,direction.z).normalize();
  const hit=world.rayIntersect(ray);
  return hit && hit.distance<=maxDistance ? hit.distance : null;
}

/** Sorted physical crossings, retaining source triangle material after BVH reordering. */
export function raycastWorldSurfaces(origin,direction,maxDistance=300) {
  if(!world)return [];
  const r=new Ray(new Vector3(origin.x,origin.y,origin.z),new Vector3(direction.x,direction.y,direction.z).normalize());
  const hits=world.bvh.raycast(r,DoubleSide).filter(h=>h.distance<=maxDistance).sort((a,b)=>a.distance-b.distance);
  const result=[];
  for(const h of hits){
    if(result.length&&h.distance-result.at(-1).distance<.002)continue;
    const triangle=Math.floor(h.face.a/3);
    result.push({distance:h.distance,point:{x:h.point.x,y:h.point.y,z:h.point.z},normal:{x:h.face.normal.x,y:h.face.normal.y,z:h.face.normal.z},material:world.surfaceMaterials?.[triangle]||0,triangle});
    if(result.length===48)break;
  }
  return result;
}

export function floorHeight(x,z,fromY=80,maxDistance=200) {
  const d=raycastWorld({x,y:fromY,z},{x:0,y:-1,z:0},maxDistance);
  return d === null ? null : fromY-d;
}

export function getGroundMaterial(x, y, z) {
  if (!world) return 'concrete';
  // Some floors read as sand or dirt in the map source but carry no material id,
  // so a map declares them as AABB patches. Keeping them per-world is what stops
  // one map's patch from claiming another map's ground: these coordinates are
  // Dust II's Pit, and Mirage has walkable space in the same box.
  for (const patch of world.groundPatches || []) {
    if (x > patch.min.x && x < patch.max.x && y < patch.max.y
      && z > patch.min.z && z < patch.max.z) return patch.material;
  }
  const hits = raycastWorldSurfaces({ x, y: y + 0.15, z }, { x: 0, y: -1, z: 0 }, 0.6);
  if (!hits.length) return 'concrete';
  const matId = hits[0].material || 0;
  if (matId === 1) return 'wood';
  if (matId === 2) return 'metal';
  return 'concrete';
}

function collide(hull,p) {
  let grounded=false;
  for (let i=0;i<3;i++) {
    const hit=world?.hullIntersect(hull);
    if (!hit) break;
    if(hit.walkable&&p.vy<=.1){grounded=true;p.vy=0;}
    for(const contact of hit.contacts){
      if(contact.walkable&&p.vy<=.1){
        grounded=true;
        // Projecting a landing's downward speed along a ramp gave players a
        // free horizontal kick. A walkable floor cancels fall speed instead.
        p.vy=0;
      }else{
        const normal=contact.walkable?contact.surface:contact.normal;
        const dot=p.vx*normal.x+p.vy*normal.y+p.vz*normal.z;
        if(dot<0){p.vx-=normal.x*dot;p.vy-=normal.y*dot;p.vz-=normal.z*dot;}
      }
    }
    hull.translate(axis.copy(hit.normal).multiplyScalar(hit.depth+0.0001));
  }
  return grounded;
}

// Sweep the whole hull, including its leading edge, down onto a tread or
// ramp. A centre ray misses support at the edge of the real Dust2 stairs.
function sweepDown(hull,maxDrop){
  // Test the continuous downward sweep before resolving any individual face.
  // Previously a riser pushed the probe sideways before its tread was tested,
  // hiding valid support and permanently blocking even a 12 cm step.
  const distance=world.sweepDown(hull,maxDrop);
  return distance===null?null:hull.clone().translate(new Vector3(0,-Math.max(0,distance-.0001),0));
}

/** First collision with an outward-facing surface normal for projectile reflection. */
export function raycastWorldContact(origin,direction,maxDistance=300){
  if(!world)return null;
  ray.origin.set(origin.x,origin.y,origin.z);ray.direction.set(direction.x,direction.y,direction.z).normalize();
  const hit=world.rayIntersect(ray);if(!hit||hit.distance>maxDistance)return null;
  const normal=hit.face.normal.clone();if(normal.dot(ray.direction)>0)normal.negate();
  return {distance:hit.distance,normal:{x:normal.x,y:normal.y,z:normal.z}};
}

function updateCrouch(p,wanted){
  if(Boolean(wanted)===p.crouch)return;
  const oldHeight=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT,newHeight=wanted?CROUCH_HEIGHT:STAND_HEIGHT;
  const lift=Math.sign(oldHeight-newHeight)*Math.min(Math.abs(oldHeight-newHeight),CROUCH_JUMP_LIFT);
  const y=p.y+(p.grounded?0:lift);
  const candidate={...p,y,crouch:Boolean(wanted)};
  const test=hullFor(candidate,newHeight);
  // Raising feet in air retracts the legs. Releasing crouch performs the
  // inverse motion only if the full hull fits; it cannot teleport through a
  // ceiling or the box on which the player is about to land.
  if(!wanted){
    test.translate(new Vector3(0,.0002,0));
    const hit=world.hullIntersect(test);
    if(hit&&hit.contacts.some(c=>c.depth>.0003))return;
  }
  p.y=y;p.crouch=Boolean(wanted);p.height=newHeight;
}

// --- Ladder movement -------------------------------------------------------
// A ladder is an invisible volume, not geometry. While mounted the player rides
// a rail: horizontal position freezes, only Y moves, and gravity, stepping and
// hull resolution all switch off. Every value below derives from (state, input,
// volume), so the client's prediction and the server agree without extra work.
function ladderWishDirection(input,yaw){
  const forward=Math.max(-1,Math.min(1,Number(input.forward)||0));
  const right=Math.max(-1,Math.min(1,Number(input.right)||0));
  const mag=Math.hypot(forward,right);
  if(mag<=0)return null;
  return {x:(-Math.sin(yaw)*forward+Math.cos(yaw)*right)/mag,
          z:(-Math.cos(yaw)*forward-Math.sin(yaw)*right)/mag};
}

function ladderDetach(p){p.onLadder=false;p.ladderId=null;}

/** Horizontal wish direction from the strafe axis alone. */
function ladderStrafeDirection(input,yaw){
  const right=Math.max(-1,Math.min(1,Number(input.right)||0));
  if(!right)return null;
  return {x:Math.cos(yaw)*right,z:-Math.sin(yaw)*right};
}

/**
 * Where a player stands after climbing out of one end of a ladder. A ladder
 * shaft is a hole in the floor it opens onto, so sweeping straight down from the
 * shaft usually finds only the shaft's own bottom or the floor the climb started
 * from. CS2 ladders emerge beside their shaft rather than through it, so probe
 * outward for the nearest floor that both sits at the level in question and fits
 * the player's hull. Returns null when the ladder opens into mid-air, leaving
 * the player holding on until there is somewhere to step.
 *
 * Both ends need this: the top obviously, and the bottom because a shaft that
 * ends over a void would otherwise drop the climber out of the world. `slack`
 * is how far below the level a floor may sit and still count as the landing.
 */
function ladderLanding(p,ladder,level,slack){
  const direct=sweepDown(hullFor(p,p.height),LADDER_LEDGE_SWEEP);
  if(direct&&direct.min.y<=level+0.02&&direct.min.y>level-slack){
    return {x:(direct.min.x+direct.max.x)/2,y:direct.min.y,z:(direct.min.z+direct.max.z)/2};
  }
  const tanX=Math.cos(ladder.yaw),tanZ=-Math.sin(ladder.yaw);
  const norX=-Math.sin(ladder.yaw),norZ=-Math.cos(ladder.yaw);
  for(let radius=0.25;radius<=LADDER_LEDGE_REACH;radius+=0.15){
    for(let a=0;a<12;a++){
      const angle=a/12*Math.PI*2;
      const x=ladder.x+(tanX*Math.cos(angle)+norX*Math.sin(angle))*radius;
      const z=ladder.z+(tanZ*Math.cos(angle)+norZ*Math.sin(angle))*radius;
      // Start just above the level so only a floor at the end of the climb is
      // reachable — the floor at the other end sits far further away.
      const floor=floorHeight(x,z,level+0.05,LADDER_LEDGE_REACH);
      if(floor===null||floor>level+0.02||floor<level-slack)continue;
      // The floor has to fit a standing player; one inside a wall does not.
      if(world?.hullIntersect(hullFor({x,y:floor+0.06,z},p.height)))continue;
      return {x,y:floor,z};
    }
  }
  return null;
}

function ladderJumpOff(p,ladder){
  p.vy=JUMP_SPEED*LADDER_JUMP_SPEED;
  p.vx=-Math.sin(ladder.yaw)*LADDER_JUMP_PUSH;
  p.vz=-Math.cos(ladder.yaw)*LADDER_JUMP_PUSH;
  ladderDetach(p);
}

/** True when the ladder took over this tick, so stepPlayer returns immediately. */
function ladderMove(p,input,dt,jumpPressed){
  const ladders=world?.ladders;
  if(!ladders||!ladders.length){if(p.onLadder)ladderDetach(p);return false;}
  const held=p.onLadder?findLadderById(ladders,p.ladderId):null;
  const direction=ladderWishDirection(input,p.yaw);
  // Once mounted the forward axis is the throttle and the strafe axis is the way
  // off, so only the strafe can step you off - walking "backwards" would fight
  // the descend key and drop people who merely look away from the ladder.
  const side=ladderStrafeDirection(input,p.yaw);
  if(held){
    // Pushing cleanly away steps off; losing the volume is a safety net.
    if(ladderWantsLeave(held,side)||!ladderVolumeAt(ladders,p.x,p.y,p.z)){ladderDetach(p);return false;}
    return ladderClimb(p,held,dt,jumpPressed,ladderClimbRate(input.forward));
  }
  if(!direction)return false;
  const grab=ladderVolumeAt(ladders,p.x,p.y,p.z,LADDER_GRAB_MARGIN);
  if(!grab||!ladderWantsMount(grab,direction))return false;
  // Align to the ladder before holding it. The grab margin deliberately lets a
  // player reach a ladder they are not flush against, but the held check below
  // tests the strict volume, so leaving them off-axis would drop them straight
  // back out again — most of the approaches that should work did exactly that.
  p.x=grab.x;p.z=grab.z;
  // A ladder's `bottom` is the floor you grab it on, but the floor a player is
  // standing on can sit a few millimetres below it — enough to fail the strict
  // volume test on the next tick and drop them straight back off. Clamp into
  // the span instead, so a grab is a grab.
  p.y=Math.max(Number(grab.bottom)||0,Math.min(Number(grab.top)||0,p.y));
  p.onLadder=true;p.ladderId=grab.id;
  p.vx=0;p.vz=0;
  return ladderClimb(p,grab,dt,jumpPressed,ladderClimbRate(input.forward));
}

function ladderClimb(p,ladder,dt,jumpPressed,rate){
  const bottom=Number(ladder.bottom)||0,top=Number(ladder.top)||0;
  const substeps=Math.max(2,Math.ceil(dt*120)),h=dt/substeps;
  for(let i=0;i<substeps;i++){
    // Jump only on the tick it was pressed, not once per substep.
    if(jumpPressed&&i===0){ladderJumpOff(p,ladder);p.jumpBufferRemaining=0;return true;}
    if(rate!==0){
      const speed=rate>0?LADDER_CLIMB_SPEED:LADDER_DESCENT_SPEED;
      p.y=Math.max(bottom,Math.min(top,p.y+rate*speed*h));
    }
    // Bottom: put the climber on the floor the ladder starts from. A shaft can
    // end over a void, so this is a landing search rather than a plain release.
    if(rate<0&&p.y<=bottom+LADDER_SNAP){
      const support=ladderLanding(p,ladder,bottom,LADDER_BASE_TOLERANCE);
      if(support){
        p.x=support.x;p.y=support.y;p.z=support.z;
        p.vx=0;p.vy=0;p.vz=0;p.grounded=true;
        ladderDetach(p);
        return true;
      }
      ladderDetach(p);p.grounded=false;return true;
    }
    // Top: step onto the ledge the ladder opens onto, when one is in reach.
    if(rate>0&&p.y>=top-LADDER_SNAP){
      const support=ladderLanding(p,ladder,top,LADDER_LEDGE_SWEEP);
      if(support){
        p.x=support.x;p.y=support.y;p.z=support.z;
        p.vy=0;p.grounded=true;
        ladderDetach(p);
        return true;
      }
    }
  }
  p.vx=0;p.vz=0;p.vy=0;p.grounded=false;
  p.outOfWorld=p.y<worldBounds.min.y-12||p.x<worldBounds.min.x-20||p.x>worldBounds.max.x+20||p.z<worldBounds.min.z-20||p.z>worldBounds.max.z-20;
  return true;
}

export function stepPlayer(p,input={},dt=1/60) {
  if(!world) return p;
  dt=Math.min(.05,Math.max(.001,dt));
  p.vx=Number.isFinite(p.vx)?p.vx:0;p.vy=Number.isFinite(p.vy)?p.vy:0;p.vz=Number.isFinite(p.vz)?p.vz:0;
  p.yaw=Number.isFinite(input.yaw)?input.yaw:p.yaw;
  p.pitch=Math.max(-1.48,Math.min(1.48,Number.isFinite(input.pitch)?input.pitch:p.pitch));
  if(p.objectiveLocked){
    p.vx=p.vy=p.vz=0;p.crouch=true;p.height=CROUCH_HEIGHT;p.jumpBufferRemaining=0;p.lastJump=!!input.jump;
    p.lastJumpId=Math.max(p.lastJumpId||0,input.jumpId||0);return p;
  }
  if(p.vy>.1)p.grounded=false;
  const jumpId=Number.isSafeInteger(input.jumpId)&&input.jumpId>=0?input.jumpId:null;
  const newId=jumpId!==null&&jumpId>(p.lastJumpId||0);
  if(newId)p.lastJumpId=jumpId;
  if(newId||(input.jump&&!p.lastJump))p.jumpBufferRemaining=JUMP_BUFFER_TIME;
  const jumpPressed=newId||(input.jump&&!p.lastJump);
  p.lastJump=Boolean(input.jump);
  p.jumpBufferRemaining=Math.max(0,p.jumpBufferRemaining||0);
  let jumped=false;
  const tryJump=()=>{
    if(p.grounded&&p.jumpBufferRemaining>0){p.vy=JUMP_SPEED;p.grounded=false;p.jumpBufferRemaining=0;jumped=true;return true;}
    return false;
  };
  tryJump();
  updateCrouch(p,input.crouch);
  p.height=p.crouch?CROUCH_HEIGHT:STAND_HEIGHT;
  // Ladders take over the whole tick: no gravity, stepping or hull resolution.
  if(world?.ladders?.length&&ladderMove(p,input,dt,jumpPressed))return p;
  if(p.grounded&&!jumped){
    const speed=Math.hypot(p.vx,p.vz);
    if(speed<.00254){p.vx=0;p.vz=0;}
    else{
      const control=speed<SV_STOPSPEED?SV_STOPSPEED:speed;
      const drop=control*SV_FRICTION*dt;
      const newspeed=Math.max(0,speed-drop);
      if(newspeed!==speed){const factor=newspeed/speed;p.vx*=factor;p.vz*=factor;}
    }
  }
  const forward=Math.max(-1,Math.min(1,Number(input.forward)||0));
  const right=Math.max(-1,Math.min(1,Number(input.right)||0));
  const inputMag=Math.hypot(forward,right);
  if(inputMag>0){
    const wishdirX=(-Math.sin(p.yaw)*forward+Math.cos(p.yaw)*right)/inputMag;
    const wishdirZ=(-Math.cos(p.yaw)*forward-Math.sin(p.yaw)*right)/inputMag;
    const baseSpeed=(input.speedScale||1)*6.0;
    const wishspeed=(p.crouch?2.15/6.0:input.walk?2.7/6.0:1.0)*baseSpeed*Math.min(1,inputMag);
    if(p.grounded&&!jumped){
      const currentspeed=p.vx*wishdirX+p.vz*wishdirZ;
      const addspeed=wishspeed-currentspeed;
      if(addspeed>0){
        const accelspeed=Math.min(addspeed,SV_ACCELERATE*baseSpeed*dt);
        p.vx+=accelspeed*wishdirX;p.vz+=accelspeed*wishdirZ;
      }
    }else{
      const airWishSpeed=Math.min(wishspeed,SV_AIR_WISHSPEED_CAP);
      const currentspeed=p.vx*wishdirX+p.vz*wishdirZ;
      const addspeed=airWishSpeed-currentspeed;
      if(addspeed>0){
        const accelspeed=Math.min(addspeed,SV_AIRACCELERATE*baseSpeed*dt);
        p.vx+=accelspeed*wishdirX;p.vz+=accelspeed*wishdirZ;
      }
    }
  }
  const substeps=Math.max(3,Math.ceil(dt*180)),h=dt/substeps;
  const beforeX=p.x,beforeZ=p.z;
  const incomingHorizontalSpeed=Math.hypot(p.vx,p.vz);
  for(let i=0;i<substeps;i++) {
    tryJump();
    const wasGrounded=p.grounded;
    const horizontalSpeed=Math.hypot(p.vx,p.vz);
    p.vy-=GRAVITY*h*.5;
    const c=hullFor(p);
    const before=c.clone();
    motion.set(p.vx,p.vy,p.vz).multiplyScalar(h);
    c.translate(motion);
    const hit=world.hullIntersect(c);
    // Source stairs have 0.2–0.4 m risers. Try stepping only from grounded movement.
    let ground=false;
    if(hit&&hit.depth*Math.hypot(hit.normal.x,hit.normal.z)>.0001&&wasGrounded&&!jumped&&Math.hypot(motion.x,motion.z)>.001) {
      const stepped=before.clone();
      stepped.translate(new Vector3(motion.x,STEP_HEIGHT,motion.z));
      if(!world.hullIntersect(stepped)) {
        const support=sweepDown(stepped,STEP_HEIGHT+.06);
        if(support){c.copy(support);p.vy=0;ground=true;}
      }
    }
    ground=collide(c,p)||ground;
    if(!ground&&wasGrounded&&!jumped&&p.vy<=0){
      const support=sweepDown(c,STEP_HEIGHT);
      if(support){c.copy(support);ground=true;}
    }
    p.x=(c.min.x+c.max.x)/2;p.y=c.min.y;p.z=(c.min.z+c.max.z)/2;
    p.grounded=ground;
    if(ground){
      p.vy=0;
      // At seams a hull can touch a steep decorative triangle immediately
      // before the supporting floor. Its tiny gravity projection must not add
      // horizontal energy even when those contacts arrive in separate passes.
      const afterSpeed=Math.hypot(p.vx,p.vz);
      if(afterSpeed>horizontalSpeed&&afterSpeed>0){const scale=horizontalSpeed/afterSpeed;p.vx*=scale;p.vz*=scale;}
    }else p.vy-=GRAVITY*h*.5;
    p.jumpBufferRemaining=Math.max(0,p.jumpBufferRemaining-h);
  }
  if(p.grounded){
    const speed=Math.hypot(p.vx,p.vz);
    if(speed>incomingHorizontalSpeed&&speed>0){const scale=incomingHorizontalSpeed/speed;p.vx*=scale;p.vz*=scale;}
  }
  p.stepDistance=(p.stepDistance||0)+Math.hypot(p.x-beforeX,p.z-beforeZ);
  p.outOfWorld=p.y<worldBounds.min.y-12 || p.x<worldBounds.min.x-20 || p.x>worldBounds.max.x+20 || p.z<worldBounds.min.z-20 || p.z>worldBounds.max.z+20;
  return p;
}

export function stepCorpse(p, dt) {
  if (p.grounded) {
    p.vx = 0; p.vy = 0; p.vz = 0;
    return p;
  }
  if (!world) return p;
  p.height = CROUCH_HEIGHT;
  const substeps = Math.max(2, Math.ceil(dt * 120)), h = dt / substeps;
  for (let i = 0; i < substeps; i++) {
    p.vy -= GRAVITY * h * 0.5;
    p.vx *= Math.max(0, 1 - 2.5 * h);
    p.vz *= Math.max(0, 1 - 2.5 * h);
    const c = hullFor(p);
    motion.set(p.vx, p.vy, p.vz).multiplyScalar(h);
    c.translate(motion);
    let ground = collide(c, p);
    if (!ground && p.vy <= 0) {
      const support = sweepDown(c, STEP_HEIGHT);
      if (support) { c.copy(support); ground = true; }
    }
    p.x = (c.min.x + c.max.x) / 2;
    p.y = c.min.y;
    p.z = (c.min.z + c.max.z) / 2;
    p.grounded = ground;
    if (ground) {
      p.vy = 0; p.vx = 0; p.vz = 0;
      break;
    } else {
      p.vy -= GRAVITY * h * 0.5;
    }
  }
  if (!p.grounded) {
    const floor = floorHeight(p.x, p.z, p.y + 0.5, 30);
    if (floor !== null && p.y <= floor + 0.05) {
      p.y = floor;
      p.vy = 0; p.vx = 0; p.vz = 0;
      p.grounded = true;
    }
  }
  p.outOfWorld = p.y < worldBounds.min.y - 12 || p.x < worldBounds.min.x - 20 || p.x > worldBounds.max.x + 20 || p.z < worldBounds.min.z - 20 || p.z > worldBounds.max.z + 20;
  return p;
}

const isLiving = p => Boolean(p && p.alive !== false);

export function resolvePlayerBodyCollision(p1, p2) {
  if (!isLiving(p1) || !isLiving(p2)) return false;
  const dx = p1.x - p2.x;
  const dz = p1.z - p2.z;
  const distSq = dx * dx + dz * dz;
  const r1 = p1.bodyRadius || PLAYER_BODY_RADIUS;
  const r2 = p2.bodyRadius || PLAYER_BODY_RADIUS;
  const minDist = r1 + r2;
  if (distSq >= minDist * minDist) return false;

  const h1 = p1.height || (p1.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
  const h2 = p2.height || (p2.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
  const top1 = p1.y + h1, top2 = p2.y + h2;

  // Boosting: landing/standing on top of another player
  if (p1.y >= top2 - 0.22 && (p1.vy || 0) <= 0.1) {
    p1.y = top2;
    p1.grounded = true;
    p1.vy = Math.max(0, p1.vy || 0);
    return true;
  }
  if (p2.y >= top1 - 0.22 && (p2.vy || 0) <= 0.1) {
    p2.y = top1;
    p2.grounded = true;
    p2.vy = Math.max(0, p2.vy || 0);
    return true;
  }

  // Horizontal body collision when vertical ranges overlap
  const verticalOverlap = Math.min(top1, top2) - Math.max(p1.y, p2.y);
  if (verticalOverlap > 0.05) {
    const dist = Math.sqrt(distSq);
    const overlap = minDist - dist;
    let nx = 1, nz = 0;
    if (dist > 1e-5) {
      nx = dx / dist;
      nz = dz / dist;
    } else {
      const a = p1.yaw || 0;
      nx = Math.cos(a);
      nz = Math.sin(a);
    }

    const locked1 = Boolean(p1.objectiveLocked);
    const locked2 = Boolean(p2.objectiveLocked);
    if (locked1 && locked2) return false;

    let push1 = overlap * 0.5, push2 = overlap * 0.5;
    let factor1 = 0.5, factor2 = 0.5;
    if (locked1) {
      push1 = 0; push2 = overlap;
      factor1 = 0; factor2 = 1;
    } else if (locked2) {
      push1 = overlap; push2 = 0;
      factor1 = 1; factor2 = 0;
    }

    p1.x += nx * push1;
    p1.z += nz * push1;
    p2.x -= nx * push2;
    p2.z -= nz * push2;

    const relVx = (p1.vx || 0) - (p2.vx || 0);
    const relVz = (p1.vz || 0) - (p2.vz || 0);
    const vn = relVx * nx + relVz * nz;
    if (vn < 0) {
      p1.vx = (p1.vx || 0) - vn * factor1 * nx;
      p1.vz = (p1.vz || 0) - vn * factor1 * nz;
      p2.vx = (p2.vx || 0) + vn * factor2 * nx;
      p2.vz = (p2.vz || 0) + vn * factor2 * nz;
    }
    return true;
  }
  return false;
}

export function resolvePlayerAgainstOthers(p, others) {
  if (!isLiving(p) || !others) return false;
  let resolved = false;
  const h1 = p.height || (p.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
  const r1 = p.bodyRadius || PLAYER_BODY_RADIUS;
  const list = Array.isArray(others) ? others : Array.from(others?.values?.() || others || []);
  for (const other of list) {
    if (!other || other === p || other.id === p.id || !isLiving(other)) continue;
    const dx = p.x - other.x;
    const dz = p.z - other.z;
    const distSq = dx * dx + dz * dz;
    const r2 = other.bodyRadius || PLAYER_BODY_RADIUS;
    const minDist = r1 + r2;
    if (distSq >= minDist * minDist) continue;

    const h2 = other.height || (other.crouch ? CROUCH_HEIGHT : STAND_HEIGHT);
    const top2 = other.y + h2;
    if (p.y >= top2 - 0.22 && (p.vy || 0) <= 0.1) {
      p.y = top2;
      p.grounded = true;
      p.vy = Math.max(0, p.vy || 0);
      resolved = true;
      continue;
    }
    const top1 = p.y + h1;
    if (other.y >= top1 - 0.22) continue;

    const verticalOverlap = Math.min(top1, top2) - Math.max(p.y, other.y);
    if (verticalOverlap > 0.05) {
      const dist = Math.sqrt(distSq);
      const overlap = minDist - dist;
      let nx = 1, nz = 0;
      if (dist > 1e-5) {
        nx = dx / dist;
        nz = dz / dist;
      } else {
        const a = p.yaw || 0;
        nx = Math.cos(a);
        nz = Math.sin(a);
      }
      p.x += nx * overlap;
      p.z += nz * overlap;
      const relVx = (p.vx || 0) - (other.vx || 0);
      const relVz = (p.vz || 0) - (other.vz || 0);
      const vn = relVx * nx + relVz * nz;
      if (vn < 0) {
        p.vx = (p.vx || 0) - vn * nx;
        p.vz = (p.vz || 0) - vn * nz;
      }
      resolved = true;
    }
  }
  if (resolved && world) {
    collide(hullFor(p), p);
  }
  return resolved;
}

export function resolveAllPlayerCollisions(players) {
  const list = Array.isArray(players) ? players : Array.from(players?.values?.() || players || []);
  const living = list.filter(p => isLiving(p));
  if (living.length < 2) return;
  const moved = new Set();
  for (let iter = 0; iter < 2; iter++) {
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        if (resolvePlayerBodyCollision(living[i], living[j])) {
          moved.add(living[i]);
          moved.add(living[j]);
        }
      }
    }
  }
  if (world && moved.size > 0) {
    for (const p of moved) {
      collide(hullFor(p), p);
    }
  }
}

