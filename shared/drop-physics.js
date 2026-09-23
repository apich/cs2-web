export const DROP_PHYSICS={
  gravity:9.8,
  maxDistance:10,
  radius:.08,
  extrapolationSeconds:.08,
  originHeight:{standing:1.2,crouching:.8},
  spawnForward:.6,
  forwardProbe:.7,
  wallPadding:.1,
  verticalSpeed:3,
  idleThreshold:.15,
  runThreshold:3,
  movementLead:2,
  horizontalSpeed:{idle:2,walk:4,run:6,runJump:7}
};

export function dropLaunchSpeed(player){
  const movement=Math.hypot(player.vx||0,player.vz||0),speed=DROP_PHYSICS.horizontalSpeed;
  if(movement<DROP_PHYSICS.idleThreshold)return speed.idle;
  const minimum=player.grounded===false&&movement>=DROP_PHYSICS.runThreshold?speed.runJump:movement>=DROP_PHYSICS.runThreshold?speed.run:speed.walk;
  return Math.max(minimum,movement+DROP_PHYSICS.movementLead);
}

export function extrapolateDrop(drop,seconds){
  const t=drop.resting?0:Math.max(0,Math.min(DROP_PHYSICS.extrapolationSeconds,Number.isFinite(seconds)?seconds:0));
  return {x:drop.x+(drop.vx||0)*t,y:drop.y+(drop.vy||0)*t-DROP_PHYSICS.gravity*t*t*.5,z:drop.z+(drop.vz||0)*t};
}
