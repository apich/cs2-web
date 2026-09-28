// CS2 皮肤稀有度（色条/详情用）；未收录的皮肤按军规级兜底，后续补表即可。
export const RARITY = Object.freeze({
  consumer: '#b0c3d9', industrial: '#5e98d9', milspec: '#4b69ff', restricted: '#8847ff',
  classified: '#d32ce6', covert: '#eb4b4b', contraband: '#e4ae39', extraordinary: '#e4ae39',
});
export const RARITY_NAME = Object.freeze({
  consumer: '消费级', industrial: '工业级', milspec: '军规级', restricted: '受限',
  classified: '保密', covert: '隐秘', contraband: '违禁', extraordinary: '非凡',
});
const RARITY_ORDER = Object.freeze(['consumer', 'industrial', 'milspec', 'restricted', 'classified', 'covert', 'contraband', 'extraordinary']);

const BY_SKIN = {
  'm4a4-howl': 'contraband', 'awp-dragon-lore': 'covert', 'awp-gungnir': 'covert',
  'm4a1-printstream': 'covert', 'deagle-printstream': 'covert', 'usp-kill-confirmed': 'covert',
  'ak47-vulcan': 'classified', 'ak47-fire-serpent': 'covert', 'ak47-wild-lotus': 'covert',
  'pistol-fade': 'restricted', 'karambit-sapphire': 'extraordinary', 'xm1014-tranquility': 'classified',
  'ssg08-dragonfire': 'classified', 'mac10-neon-rider': 'restricted', 'mp9-wild-lily': 'restricted',
  'nova-hyper-beast': 'classified', 'bizon-judgement-of-anubis': 'restricted', 'fiveseven-hyper-beast': 'restricted',
  'galilar-sugar-rush': 'restricted', 'p250-undertow': 'restricted', 'tec9-fuel-injector': 'restricted',
  'elite-cobra-strike': 'restricted', 'sg553-integrale': 'restricted', 'mag7-justice': 'restricted',
  'mp7-bloodsport': 'restricted', 'scar20-cyrex': 'restricted', 'sawedoff-the-kraken': 'restricted',
};

export function rarityKeyOf(skin) { return BY_SKIN[skin?.id] || 'milspec'; }
export function rarityOf(skin) { return RARITY[rarityKeyOf(skin)]; }
export function rarityRank(skin) { return RARITY_ORDER.indexOf(rarityKeyOf(skin)); }
