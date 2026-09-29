// Joins a throwaway room and asks the server to equip each listed finish,
// reporting which ones the running server accepts. This is the decisive check
// that the server process loaded the current shared/skins.js catalog.
import {WebSocket} from 'ws';
import {getSkin} from '../../shared/skins.js';

const targets=process.argv.slice(2);
const list=targets.length?targets:['knife-doppler','knife-gamma-doppler-569','karambit-sapphire','butterfly-vanilla','ak47-vulcan','ak47-rat-rod'];
// Resolve each id's weapon from the catalog so knife variants that do not start
// with "knife" (m9-vanilla, butterfly-vanilla) are still sent to the knife slot.
const weaponOf=id=>getSkin(id)?.weapon||((id.startsWith('knife')||id.startsWith('karambit'))?'knife':'ak47');
const results=[];
const socket=new WebSocket('ws://127.0.0.1:3000/ws');

socket.on('open',()=>{
  socket.send(JSON.stringify({type:'join',name:'Skin Probe',movementProtocol:1,room:'SKN'+Math.random().toString(36).slice(2,5).toUpperCase(),mode:'deathmatch',team:'T',primary:'ak47',skins:{},agents:{},bots:0}));
});
socket.on('message',raw=>{
  let data;try{data=JSON.parse(raw);}catch{return;}
  if(data.type==='welcome'){
    let index=0;
    const next=()=>{
      if(index>=list.length){
        const accepted=results.filter(r=>r.ack).map(r=>r.sent);
        const rejected=results.filter(r=>r.error).map(r=>`${r.sent} (${r.error})`);
        const silent=results.filter(r=>!r.ack&&!r.error).map(r=>r.sent);
        console.log(`服务端接受的皮肤: ${accepted.length}/${results.length}`);
        for(const r of results)console.log(`  ${r.ack?'✓':'✗'} ${r.sent}${r.error?' — '+r.error:''}`);
        if(silent.length)console.log(`无回执: ${silent.join(', ')}`);
        process.exit(0);
      }
      const sent=list[index++];
      results.push({sent});
      socket.send(JSON.stringify({type:'equipSkin',weapon:weaponOf(sent),skin:sent}));
      setTimeout(next,300);
    };
    next();
  }
  if(data.type==='skinEquipped'){const last=results[results.length-1];if(last&&!last.ack)last.ack=data.skin;}
  if(data.type==='error'&&String(data.code||'').startsWith('SKIN')){const last=results[results.length-1];if(last&&!last.error)last.error=data.message;}
});
socket.on('error',error=>{console.log('连接失败:',error.message);process.exit(1);});
setTimeout(()=>{console.log('超时');console.log(JSON.stringify(results,null,1));process.exit(1);},20000);
