import {DROP_PHYSICS,dropLaunchSpeed} from '../shared/drop-physics.js';

const point=p=>({x:p.x,y:p.y,z:p.z});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export class DroppedWeapons {
  constructor({clock=()=>Date.now(),raycastWorld=()=>null,maxItems=64,lifetimeSeconds=120}={}){this.clock=clock;this.raycastWorld=raycastWorld;this.maxItems=maxItems;this.lifetimeSeconds=lifetimeSeconds;this.items=[];this.serial=0;}
  clear(){this.items.length=0;}
  throwState(player){
    const yaw=player.yaw||0,direction={x:-Math.sin(yaw),y:0,z:-Math.cos(yaw)};
    const height=player.crouch?DROP_PHYSICS.originHeight.crouching:DROP_PHYSICS.originHeight.standing;
    const origin={x:player.x,y:player.y+height,z:player.z};
    const hit=this.raycastWorld(origin,direction,DROP_PHYSICS.forwardProbe);
    const offset=hit===null?DROP_PHYSICS.spawnForward:Math.max(0,hit-DROP_PHYSICS.wallPadding),speed=dropLaunchSpeed(player);
    return {x:origin.x+direction.x*offset,y:origin.y,z:origin.z+direction.z*offset,yaw,vx:direction.x*speed,vy:DROP_PHYSICS.verticalSpeed,vz:direction.z*speed,throwX:player.x,throwZ:player.z,resting:false};
  }
  drop(player,item){
    const dropped={id:`drop_${++this.serial}`,...item,ownerId:player.id,droppedAt:this.clock(),...this.throwState(player),expiresAt:this.clock()+this.lifetimeSeconds*1000};
    this.items.push(dropped);while(this.items.length>this.maxItems)this.items.shift();return dropped;
  }
  take(id){const index=this.items.findIndex(item=>item.id===id);return index<0?null:this.items.splice(index,1)[0];}
  candidate(player){
    const origin={x:player.x,y:player.y+(player.crouch?.95:1.6),z:player.z},c=Math.cos(player.pitch||0),facing={x:-Math.sin(player.yaw||0)*c,y:Math.sin(player.pitch||0),z:-Math.cos(player.yaw||0)*c};
    const candidates=this.items.filter(item=>{
      const d=distance(origin,item);if(item.expiresAt<=this.clock()||d>2.8)return false;
      const dir={x:(item.x-origin.x)/Math.max(.001,d),y:(item.y-origin.y)/Math.max(.001,d),z:(item.z-origin.z)/Math.max(.001,d)};
      if(Math.hypot(item.x-player.x,item.z-player.z)>.9&&dir.x*facing.x+dir.y*facing.y+dir.z*facing.z<.55)return false;
      const hit=this.raycastWorld(origin,dir,d);return hit===null||hit>=d-.12;
    });
    candidates.sort((a,b)=>distance(origin,a)-distance(origin,b));return candidates[0]||null;
  }
  autoCandidate(player,hasSlot,slotOf){
    const now=this.clock(),origin={x:player.x,y:player.y+.75,z:player.z};
    return this.items.filter(item=>{
      if(item.expiresAt<=now||now-item.droppedAt<350||item.ownerId===player.id&&now-item.droppedAt<1500||hasSlot(slotOf(item.weaponId)))return false;
      const d=distance(origin,item);if(d>1.25||Math.abs(item.y-player.y)>1.5)return false;
      const dir={x:(item.x-origin.x)/Math.max(d,.001),y:(item.y-origin.y)/Math.max(d,.001),z:(item.z-origin.z)/Math.max(d,.001)};
      const hit=this.raycastWorld(origin,dir,d);return hit===null||hit>=d-.12;
    }).sort((a,b)=>distance(origin,a)-distance(origin,b))[0]||null;
  }
  advance(item,dt){
    if(item.resting)return;
    let remain=Math.max(0,Math.min(.25,dt));
    while(remain>1e-8&&!item.resting){const step=Math.min(remain,1/120),verticalTravel=item.vy*step-DROP_PHYSICS.gravity*step*step*.5;remain-=step;item.vy-=DROP_PHYSICS.gravity*step;
      for(const axis of ['x','y','z']){const velocity='v'+axis,travel=axis==='y'?verticalTravel:item[velocity]*step;if(Math.abs(travel)<1e-8)continue;const direction={x:0,y:0,z:0};direction[axis]=Math.sign(travel);const hit=this.raycastWorld(item,direction,Math.abs(travel)+DROP_PHYSICS.radius);
        if(hit!==null&&hit<=Math.abs(travel)+DROP_PHYSICS.radius){item[axis]+=Math.sign(travel)*Math.max(0,hit-DROP_PHYSICS.radius);item[velocity]=0;if(axis==='y'&&travel<0)item.vx=item.vz=0,item.resting=true;}else item[axis]+=travel;
      }
      const dx=item.x-item.throwX,dz=item.z-item.throwZ,d=Math.hypot(dx,dz);if(d>DROP_PHYSICS.maxDistance){item.x=item.throwX+dx/d*DROP_PHYSICS.maxDistance;item.z=item.throwZ+dz/d*DROP_PHYSICS.maxDistance;item.vx=item.vz=0;}
    }
  }
  tick(dt){
    this.items=this.items.filter(item=>item.expiresAt>this.clock()&&Number.isFinite(item.x+item.y+item.z)&&item.y> -250);
    for(const item of this.items)this.advance(item,dt);
  }
  snapshot(){return this.items.map(({id,weaponId,skinId,ammo,reserve,yaw,vx,vy,vz,resting,expiresAt,...position})=>({id,weaponId,skinId,ammo,reserve,yaw,vx,vy,vz,resting,...point(position),remaining:Math.max(0,(expiresAt-this.clock())/1000)}));}
}
