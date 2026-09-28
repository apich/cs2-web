import { getMap, DEFAULT_MAP } from '../shared/maps/registry.js';
export {botUtility} from './bot-utility.js';
const point=p=>({x:p.x,y:p.y,z:p.z});
const range=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
/** Route/lane waypoints for the room's map; falls back to the default map so a
 * mock room without `.map` keeps working (tests exercise this path). */
function waypoints(room){const map=getMap(room?.mapId);return map.botWaypoints||getMap(DEFAULT_MAP).botWaypoints||{};}
/** Bombsite table for the room's map, with the same fallback. */
function sitesOf(room){return getMap(room?.mapId).sites||getMap(DEFAULT_MAP).sites;}
function raw(room){return waypoints(room);}
function at(room,id){const w=raw(room);return point(room.nearestNav(w[id]||sitesOf(room)[id])||w[id]||sitesOf(room)[id]);}
function team(room,p){return [...room.players.values()].filter(q=>q.alive&&q.team===p.team).sort((a,b)=>a.seat-b.seat);}
function hold(room,p,site){
 const w=raw(room);
 const candidates=site==='A'?w.holdA:w.holdB;
 return point(room.nearestNav(candidates[p.seat%candidates.length])||sitesOf(room)[site]);
}
/** Dust2 defaults: long/short A split or tunnels/mid B split. Information is
 * shared only after a teammate has seen an opponent; it expires after 6 s. */
export function tacticalGoal(room,p){
 const now=room.clock(),ai=p.botAI,b=room.bomb,allies=team(room,p),report=room.teamIntel?.[p.team];
 if(ai.utility?.phase==='approach')return point(ai.utility.stand);
 if(b.state==='planted'){
  ai.site=b.site;ai.phase='postplant';ai.watchPoints=watchPoints(room,p,b.site);
  if(p.team==='T'){ai.role='postplant';return hold(room,p,b.site);}
  const active=allies.find(q=>q.id===b.actorId&&b.action==='defuse');
  const defuser=active||[...allies.filter(q=>q.bot)].sort((a,c)=>Number(c.defuseKit)-Number(a.defuseKit)||range(a,b)-range(c,b))[0];
  ai.role=defuser?.id===p.id?'defuser':'retake-cover';return ai.role==='defuser'?point(b):hold(room,p,b.site);
 }
 if(p.team==='T'){
  if(b.state==='dropped'&&[...allies].sort((a,c)=>range(a,b)-range(c,b))[0]?.id===p.id){ai.role='recover-bomb';return point(b);}
  const humanCarrier=allies.find(q=>!q.bot&&q.hasBomb);
  if(humanCarrier&&humanCarrier.z<0&&(humanCarrier.x<-28||humanCarrier.x>10))room.botAttackSite=humanCarrier.x<0?'B':'A';
  const site=room.botAttackSite||(room.round.number%3===2?'B':'A'),split=p.seat%3===2;
  const route=site==='A'?(split?['mid','short','A']:['long','A']):(split?['mid','doors','B']:['tunnels','bEntry','B']);
  const key=room.round.number+':'+route.join('-');
  if(ai.routeKey!==key){ai.routeKey=key;ai.routeIndex=0;}
  ai.role=p.hasBomb?'carrier':split?'split':'entry';ai.site=site;ai.lane=split?'mid':site==='A'?'long':'tunnels';ai.watchPoints=watchPoints(room,p,site);ai.phase='advance';
  const support=supportGoal(room,p,allies,report);if(support){ai.phase='support';return support;}
  while(ai.routeIndex<route.length-1&&range(p,at(room,route[ai.routeIndex]))<3){
   if(ai.routeIndex===route.length-2&&!readyToEnter(room,p,allies,site)){ai.phase='gather';return point(p);}
   ai.routeIndex++;
  }
  if(p.hasBomb&&room.siteAt(p))return point(p);
  if(ai.routeIndex===route.length-1&&!p.hasBomb)return hold(room,p,site);
  return at(room,route[ai.routeIndex]);
 }
 const roles=['anchor-b','anchor-a','short','mid','rotator'];
 const roster=[...room.players.values()].filter(q=>q.bot&&q.team===p.team).sort((a,b)=>a.seat-b.seat);
 ai.defenseRole||=roles[Math.max(0,roster.findIndex(q=>q.id===p.id))%5];ai.role=ai.defenseRole;
 ai.site=ai.role==='anchor-b'?'B':'A';ai.phase='hold';ai.watchPoints=watchPoints(room,p,ai.site);
 const support=supportGoal(room,p,allies,report);if(support&&(!ai.role.startsWith('anchor')||range(report,sitesOf(room)[ai.site])<16)){ai.phase='support';return support;}
 if(report&&now-report.at<6000){
  const sites=sitesOf(room);
  const site=range(report,sites.A)<range(report,sites.B)?'A':'B';
  if(ai.role==='rotator'||ai.role==='mid'||(site==='A'&&ai.role==='anchor-a')||(site==='B'&&ai.role==='anchor-b')){ai.site=site;ai.watchPoints=watchPoints(room,p,site);ai.phase='rotate';return hold(room,p,site);}
 }
 return ['anchor-b','anchor-a'].includes(ai.role)?hold(room,p,ai.site):at(room,({short:'short',mid:'doors',rotator:'short'})[ai.role]);
}
export function shareSighting(room,p,enemy){
 (room.teamIntel||={})[p.team]={...point(enemy),at:room.clock(),observer:p.id};
}
function supportGoal(room,p,allies,report){
 if(!report||room.clock()-report.at>1700||report.observer===p.id||p.hasBomb||p.botAI.engaging)return null;
 const contact=allies.find(q=>q.id===report.observer);if(!contact||range(p,contact)<3||range(p,contact)>14)return null;
 const helper=allies.filter(q=>q.bot&&q!==contact&&!q.hasBomb&&!q.botAI.engaging).sort((a,b)=>range(a,contact)-range(b,contact))[0];
 if(helper!==p)return null;
 const dx=contact.x-report.x,dz=contact.z-report.z,d=Math.max(1,Math.hypot(dx,dz));
 const behind={x:contact.x+dx/d*2.3,y:contact.y,z:contact.z+dz/d*2.3};
 return point(room.nearestNav(behind)||behind);
}
export function separateTeammates(room,p,input){
  if(input.interact||p.grenadeState)return;
 for(const fire of room.grenades.fires){for(const cell of fire.cells){const d=range(p,cell);if(d<.05||d>2.2||Math.abs(p.y-cell.y)>1.4)continue;const x=(p.x-cell.x)/d,z=(p.z-cell.z)/d;input.forward=(-Math.sin(input.yaw)*x-Math.cos(input.yaw)*z);input.right=(Math.cos(input.yaw)*x-Math.sin(input.yaw)*z);return;}}
 for(const q of room.players.values()){
  if(q===p||!q.alive||q.team!==p.team||Math.abs(q.y-p.y)>1.5)continue;
  const d=range(p,q);if(d<.05||d>1.25)continue;
  const x=(p.x-q.x)/d,z=(p.z-q.z)/d,strength=(1.25-d)*.75;
  input.forward+=(-Math.sin(input.yaw)*x-Math.cos(input.yaw)*z)*strength;
  input.right+=(Math.cos(input.yaw)*x-Math.sin(input.yaw)*z)*strength;
 }
 input.forward=Math.max(-1,Math.min(1,input.forward));input.right=Math.max(-1,Math.min(1,input.right));
}

function watchPoints(room,p,site){
 const w=raw(room);
 const positions=site==='A'?(p.team==='T'?w.watchA_T:w.watchA_CT):(p.team==='T'?w.watchB_T:w.watchB_CT);
 return (positions||[]).map(q=>({x:q.x,y:q.y,z:q.z}));
}
function readyToEnter(room,p,allies,site){
 const now=room.clock(),ai=p.botAI,key=site+':'+ai.lane;
 const plans=room.botExecutions||=new Map();let plan=plans.get(key);
 if(!plan){plan={at:now,releaseAt:0};plans.set(key,plan);}
 const mates=allies.filter(q=>q!==p&&q.botAI?.lane===ai.lane);
 const near=mates.some(q=>range(q,p)<8),support=mates.find(q=>q.botAI?.utility&&!q.botAI.utility.released);
 if(!plan.releaseAt&&((near&&!support&&now-plan.at>700)||now-plan.at>4200))plan.releaseAt=now;
 if(!plan.releaseAt)return false;
 // Entry first, trading partner next, bomb carrier last. A bounded delay never
 // leaves survivors waiting forever for a dead or distant teammate.
 const order=[...allies.filter(q=>q.botAI?.lane===ai.lane)].sort((a,b)=>Number(a.hasBomb)-Number(b.hasBomb)||a.seat-b.seat);
 return now>=plan.releaseAt+Math.max(0,order.indexOf(p))*350;
}
