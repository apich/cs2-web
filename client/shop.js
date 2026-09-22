import { getWeapon, TEAM_LOADOUTS } from '../shared/weapons.js';
import { EQUIPMENT, equipmentPrice, UTILITY_IDS, MAX_GRENADES, UTILITY_ROUND_LIMITS,teamUtilities } from '../shared/equipment.js';
import { getSkin, DEFAULT_SKINS } from '../shared/skins.js';
import { uiIconUrl } from './ui-icons.js';
import './equipment.css';
const categories=[['equipment','装备'],['pistols','手枪'],['mid','中级'],['rifles','步枪'],['grenades','投掷物']];
const descriptions={armor:'防弹背心 · 身体防护',helmet:'背心与头盔 · 保护头部',defusekit:'拆弹缩短至 5 秒 · 走近拾取',hegrenade:'范围爆炸伤害',flashbang:'致盲视线内的玩家',smokegrenade:'遮挡视线 · 可熄灭火焰',molotov:'落地燃烧 · 匪方专用',incgrenade:'落地燃烧 · 警方专用',decoy:'模拟主武器枪声 · 误导敌人'};
export class WeaponShop {
  constructor(container,{buy,refund,close}) {
    this.container=container;this.buy=buy;this.pending=null;this.category=null;
    container.innerHTML=`<section class="armory-card equipment-card"><header><div class="shop-title"><span class="eyebrow" id="shop-team">LOADOUT</span><h2>购买菜单</h2></div><div class="buy-wallet"><small>可用资金</small><b id="shop-money">$ 0</b></div><button id="close-buy" type="button"><kbd>B</kbd> 返回游戏 ×</button></header><div class="shop-status"><span id="buy-note"></span><b id="shop-time"></b></div><div class="equipment-columns"></div><div class="shop-bottom"><p id="shop-result" role="status">选择武器或装备</p><footer><kbd>左键</kbd> 购买　<kbd>右键</kbd> 退还可退还的枪械　<kbd>1–5</kbd> 分类与装备　<kbd>4</kbd> 切换投掷物</footer></div></section>`;
    container.querySelector('#close-buy').onclick=close;
    container.addEventListener('click',e=>{const category=e.target.closest('[data-category]');if(category){this.category=category.dataset.category;this.highlight();return;}const button=e.target.closest('[data-buy]');if(button&&!button.disabled&&!this.pending&&!button.dataset.refundOnly){this.pending=button.dataset.buy;this.pendingAt=performance.now();this.message('正在确认购买…');buy(this.pending);this.update(this.last);}});
    container.addEventListener('contextmenu',e=>{const button=e.target.closest('[data-buy]');if(!button)return;e.preventDefault();if(this.pending)return;const id=button.dataset.buy,receipt=(this.last?.player?.refundable||[]).find(r=>r.weapon===id);if(!receipt){this.message('该物品无法退还（仅限本回合购买、未使用且未丢弃的枪械）。');this.update(this.last);return;}this.pending=id;this.pendingAt=performance.now();this.message('正在确认退还…');refund(id);this.update(this.last);});
    container.addEventListener('keydown',e=>{if(e.target.matches('input,select,textarea')||e.repeat)return;if(e.code==='Backspace'){e.preventDefault();this.category=null;this.highlight();}if(!/^Digit[1-5]$/.test(e.code))return;e.preventDefault();const i=Number(e.code.at(-1))-1;if(!this.category){this.category=categories[i][0];this.highlight();}else{container.querySelectorAll(`[data-group="${this.category}"] [data-buy]`)[i]?.click();this.category=null;this.highlight();}});
  }
  highlight(){for(const column of this.container.querySelectorAll('[data-group]'))column.classList.toggle('active',column.dataset.group===this.category);}
  render(p){
    this.team=p.team;this.container.dataset.team=p.team;
    this.container.querySelector('#shop-team').textContent=p.team==='CT'?'CT / 防守方装备':'T / 进攻方装备';
    const groups={equipment:p.team==='CT'?['armor','helmet','defusekit']:['armor','helmet'],...TEAM_LOADOUTS[p.team],grenades:teamUtilities(p.team)};
    this.container.querySelector('.equipment-columns').innerHTML=categories.map(([category,label],index)=>`<section data-group="${category}"><button class="equipment-heading" data-category="${category}"><kbd>${index+1}</kbd> ${label}</button>${(groups[category]||[]).map((id,i)=>{const w=EQUIPMENT[id]||getWeapon(id),skin=getSkin(p.skins?.[id]||DEFAULT_SKINS[id]);return `<button class="equipment-item${skin?' weapon-item':' gear-item'}" data-buy="${id}"><kbd>${i+1}</kbd><img loading="lazy" src="${skin?.preview||uiIconUrl(id)}" alt="${w.name}"><b>${w.name}</b><span>${descriptions[id]||`${skin?.name||w.skin}${skin?.condition==='Factory New'?' · 崭新出厂':''}`}</span><div class="equipment-price"><strong></strong><small></small></div></button>`;}).join('')}</section>`).join('');
    this.highlight();
  }
  message(text){this.container.querySelector('#shop-result').textContent=text;}
  result(result){this.pending=null;this.message(result.ok?`已${result.refunded?'退还':'购买'} ${(EQUIPMENT[result.weapon]||getWeapon(result.weapon)).name} · 剩余 $${result.money}`:result.message||'购买未完成');this.update(this.last);}
  update(state){
    if(!state?.player)return;this.last=state;const {player:p,mode,round,time}=state;
    const skinKey=JSON.stringify(p.skins);if(this.team!==p.team||this.skinKey!==skinKey){this.skinKey=skinKey;this.render(p);}
    if(this.pending&&performance.now()-this.pendingAt>3500){this.pending=null;this.message('购买确认超时，请重试。');}
    const free=mode==='deathmatch',remaining=Math.max(0,Math.ceil(((round?.buyEndsAt||0)-time)/1000));
    this.container.querySelector('#shop-money').textContent=`$ ${p.money}`;
    this.container.querySelector('#shop-time').textContent=free?'死斗 · 免费补给':`购买时间 ${remaining}s`;
    this.container.querySelector('#buy-note').textContent=p.buyReason||(free?'存活时可更换装备':'出生区补给');
    const counts=p.utilityCounts||{},budget=p.utilityBudget||{},refundable=p.refundable||[],total=UTILITY_IDS.reduce((n,id)=>n+(counts[id]||0),0);
    for(const button of this.container.querySelectorAll('[data-buy]')){
      const id=button.dataset.buy,item=EQUIPMENT[id],price=free?0:item?equipmentPrice(id,p):getWeapon(id).price;
      const refund=refundable.find(r=>r.weapon===id);
      const roundFull=item?.slot===4&&(budget[id]||0)>=(UTILITY_ROUND_LIMITS[id]||1);
      const full=id==='armor'?p.armor>=100:id==='helmet'?p.armor>=100&&p.helmet:id==='defusekit'?p.defuseKit:item?.slot===4?(counts[id]||0)>=item.maxCount||total>=MAX_GRENADES||roundFull:false;
      const owns=id==='armor'?p.armor>=100:id==='helmet'?p.armor>=100&&p.helmet:id==='defusekit'?p.defuseKit:item?.slot===4?(counts[id]||0)>0:p.inventory?.includes(id);
      // Anything bought this round must stay interactive so right-click can
      // refund it; a disabled button receives no mouse events at all. Grenades
      // are excluded from refund-only because stacking them up to the carry
      // limit is a normal purchase, and clicking the same weapon again has no
      // useful effect once it is already owned.
      const refundOnly=!!refund&&item?.slot!==4;
      const reason=refund?'':!p.alive?'等待重生':p.buyAllowed===false?p.buyReason:p.money<price?'余额不足':full?roundFull?'本回合已购满':'已配齐':this.pending?'确认中':'';
      button.disabled=!!reason;button.classList.toggle('owned',owns);button.dataset.refundOnly=refundOnly?'1':'';button.querySelector('strong').textContent=free?`$${(item||getWeapon(id)).price} · 免费`:`$${price}`;
      button.querySelector('small').textContent=refund?`右键退还 +$${refund.price}`:reason||(item?.slot===4?`${counts[id]||0} / ${item.maxCount}`:owns?'已持有':'购买');
    }
  }
}
