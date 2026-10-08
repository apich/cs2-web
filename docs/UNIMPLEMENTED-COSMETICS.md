# 皮肤与外观 · 未实现清单

生成日期：2026-09-28 · 数据源：本机 CS2 VPK 实际枚举
`E:/SteamLibrary/steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk`

**口径说明（重要）**：枪械与刀类均采用「数库存预览」口径 —— 数
`panorama/images/econ/default_generated/weapon_<枪名>_<涂装名>_light_png.vtex_c`，
每款涂装一张预览（`_heavy`/`_medium` 是同一涂装的不同磨损图，不计）。

此前的 `paintkit-candidates.json` 按 **paintkit 材质文件**计数，会漏掉「同一 paint key
在不同武器上重新生成的变体」——例如 `aq_ak47_cartel` 与 `aq_p250_cartel` 共用一个材质
文件，但预览是两张独立的。按材质数只看到一个，导致数字系统性偏低：

- 枪械漏算 **266 款**
- 刀类漏算 **488 款**

---

## 0. 总览

| 类别 | VPK 可用 | 已接入 | 缺口 | 缺口比例 |
|---|---:|---:|---:|---:|
| 枪械涂装（已接入的 23 把枪） | 1107 | 841 | 266 | 24% |
| 枪械涂装（项目未接入的 12 把枪） | 425 | 0 | 425 | 100% |
| **刀类涂装** | **522** | **522** | **0** | **0%** |
| **探员（角色模型）** | **80** | **4** | **76** | **95%** |
| **手套（涂装）** | **72** | **1** | **71** | **99%** |
| **贴纸** | **22872** | **0** | **22872** | 100% |
| 音乐盒 | 103 | 0 | 103 | 100% |
| 涂鸦 / 印花 | 113 | 0 | 113 | 100% |
| 挂件（keychains） | 81 | 0 | 81 | 100% |

---

## 1. 枪械涂装：已接入枪械漏算 266 款

已接入的 23 把枪在 VPK 里实际有 **1107** 款涂装，项目只接入 **841** 款。

| 枪 | VPK | 已接 | 缺口 | | 枪 | VPK | 已接 | 缺口 |
|---|---:|---:|---:|---|---|---:|---:|---:|
| M4A1-S + M4A4 | 110 | 74 | 36 | | deagle | 48 | 36 | 12 |
| ak47 | 65 | 45 | 20 | | nova | 49 | 37 | 12 |
| pistol (Glock) | 62 | 46 | 16 | | mac10 | 57 | 45 | 12 |
| awp | 56 | 40 | 16 | | ssg08 | 43 | 32 | 11 |
| usp | 49 | 35 | 14 | | tec9 | 49 | 38 | 11 |
| mp9 | 47 | 33 | 14 | | elite | 45 | 35 | 10 |
| xm1014 | 48 | 35 | 13 | | galilar | 44 | 34 | 10 |
| p250 | 59 | 47 | 12 | | 其余 6 把 | — | — | 47 |

> **M4 系列存疑**：M4A4 与 M4A1-S 共用 `weapon_m4a1` 预览池（共 110 款）。按名字含
> `m4a4` 归类会误判（有 26 款既无 `silencer_` 也无 `m4a4` 标记，如 `cu_m4_asimov`、
> `cu_poseidon`、`cu_xray_m4`）。精确归属需逐款查 items_game。**合计 110 款 /
> 项目 74 款 / 缺 36 款是可靠的**，但两枪各自的具体数字不可信。

**做这件事不需要重新烘焙已有 841 款**，只需给漏掉的 266 款跑一遍烘焙流水线。

---

## 2. 项目完全没有的 12 把枪（425 款涂装）

VPK 预览池里有这些枪的完整涂装，但项目 `shared/weapons.js` 里没有对应枪种：

| 枪 | 涂装 | | 枪 | 涂装 |
|---|---:|---|---|---:|
| P90 | 55 | | MP5-SD | 33 |
| UMP-45 | 48 | | G3SG1 | 30 |
| AUG | 47 | | R8 左轮 | 28 |
| FAMAS | 47 | | M249 | 27 |
| CZ75-A | 38 | | Negev | 27 |
| P2000 | 38 | | 电击枪 | 7 |
| | | | **合计** | **425** |

**这是「加枪」不是「加皮肤」**：需要武器数据（伤害、后坐力、价格、弹匣）、购买菜单、
换弹/检视动画、弹道表、击杀奖励。工作量与加皮肤完全不同维度。

**已确认列为后期工作。**

---

## 3. 刀类 — 刀型与涂装已全部接入（2026-10-08）

VPK 里有 **19 种刀型、共 522 款涂装**（涂装数为此前枚举口径）。
**19 型刀的原厂涂装已全部接入**（2026-09-29）：每种刀一个模型 GLB +
一个第一人称动画包（`draw / idle / inspect / shoot / shoot2 / heavy` 六段），
走 `animationFamily` 路由，检视与握法随刀型自动变化。

**涂装也已全部接入**（2026-10-08，批次见下表）：
19 型 × 各自 `composite_inputs` 逐刀烘焙，每把刀的涂装与该刀型共享同一套
第一人称动画包（`animationFamily` 为该刀型），握法与检视随刀型自动切换。

刀型名以本地化与 `items_game.txt` 为准（此前表格的生存/吉普赛/毒蛇等名字有误）：

| 模型目录（animationFamily） | 中文 | 英文 | 原厂 | 涂装 |
|---|---|---|:---:|---:|
| knife_bayonet | 刺刀 | Bayonet | ✅ | 34 已接 |
| knife_bowie | 鲍伊猎刀 | Bowie Knife | ✅ | 34 已接 |
| knife_butterfly | 蝴蝶刀 | Butterfly Knife | ✅ | 34 已接 |
| knife_canis | 求生匕首 | Survival Knife | ✅ | 24 已接 |
| knife_cord | 系绳匕首 | Paracord Knife | ✅ | 24 已接 |
| knife_css | 海豹短刀 | Classic Knife | ✅ | 12 已接 |
| knife_falchion | 弯刀 | Falchion Knife | ✅ | 34 已接 |
| knife_flip | 折叠刀 | Flip Knife | ✅ | 34 已接 |
| knife_gut | 穿肠刀 | Gut Knife | ✅ | 34 已接 |
| knife_karambit | 爪子刀 | Karambit | ✅ | 34 已接 |
| knife_kukri | 廓尔喀刀 | Kukri Knife | ✅ | 12 已接 |
| knife_m9 | M9 刺刀 | M9 Bayonet | ✅ | 34 已接 |
| knife_navaja | 折刀 | Navaja Knife | ✅ | 24 已接 |
| knife_outdoor | 流浪者匕首 | Nomad Knife | ✅ | 24 已接 |
| knife_push | 暗影双匕 | Shadow Daggers | ✅ | 34 已接 |
| knife_skeleton | 骷髅匕首 | Skeleton Knife | ✅ | 24 已接 |
| knife_stiletto | 短剑 | Stiletto Knife | ✅ | 24 已接 |
| knife_tactical | 猎杀者匕首 | Huntsman Knife | ✅ | 34 已接 |
| knife_talon | 锯齿爪刀 | Talon Knife | ✅ | 24 已接 |
| knife_ursus | 熊刀 | Ursus Knife | ✅ | 24 已接 |
| **合计 19 型** | | | **19/19** | **522 / 522** |

> 每型「涂装」列 = 该刀型的彩绘 kit 数（原厂涂装另计）。合计 522 = VPK 枚举的
> 刀类涂装总数，与总览行一致。

### 刀型实现机制（已跑通）

每把刀 = 模型 GLB（`body_legacy` 网格 + `weapon`/`weapon_offset` 活动部件节点
+ `normalization` 包装）+ 独立动画包 `<family>-animations.glb`（剪辑名
`<family>/{draw,idle,inspect,shoot,shoot2,heavy}`，轨道覆盖双臂骨架与刀身部件
——蝴蝶刀的 `front/blade/rear/lock` 开合、暗影双匕的 `weapon_l/weapon_r` 都在
剪辑里）。`viewmodel.build` 按 `animationFamily` 取剪辑、按节点名过滤轨道，
握法/检视全部来自剪辑数据，无需按刀写代码。

管线：`scripts/weapon-assets/export-extras.mjs`（逐刀导出模型 + 6 剪辑 + 库存图）
→ `pack-extras.py`（嵌纹理、normalization、打包动画、预览 webp、目录行）
→ `append-knives.mjs`（合并进 `shared/skins.js`）。产物在
`public/assets/weapons/optional/`，每刀约 2–3.5 MB 模型 + 0.8 MB 动画，按需下载。

### 剩余：涂装 —— 已全部接入（2026-10-08）

**蝴蝶刀 34 款**（2026-10-08 首批）→ `bake-knife-batch.mjs` 一次批跑补齐其余 18 型：

```
bayonet 34 · bowie 34 · butterfly 34 · canis 24 · cord 24 · css 12 ·
falchion 34 · flip 34 · gut 34 · kukri 12 · m9 34 · navaja 24 ·
outdoor 24 · push 34 · skeleton 24 · stiletto 24 · tactical 34 ·
talon 24 · ursus 24          （合计 522）
```

批跑命令（幂等，已入目录的刀型 spec 为空、自动跳过）：

```bash
node scripts/weapon-assets/bake-knife-batch.mjs                 # 全部刀型
node scripts/weapon-assets/bake-knife-batch.mjs --knives=falchion,stiletto
```

产物在 `public/assets/weapons/cs2-full/<刀型>-<paintkey>.glb` + `previews/`，
命名沿用本地化 + 区分后缀（多普勒 · Phase 2 / 黑珍珠 / 红宝石 / 蓝宝石），
`animationFamily` 为该刀型，与同型原厂共享动画包。蝴蝶刀已在多普勒 Phase 2
刀身 + 开合检视的实机对局中验证过。

> 反面教材：我一度按 `kit.name` 撞出「每刀 34 款」，那是映射造成的假象。
> 真实数据是上面这张表——css/kukri 各 12 款，canis/cord/navaja/outdoor/
> skeleton/stiletto/talon/ursus 各 24 款。

### 涂装原定要做的事（均已处理）

---

## 4. 探员（角色模型）— 80 个变体，接入 4 个

`AGENT_CATALOG` 现有 4 款：

| id | 名称 | 阵营 | 默认 |
|---|---|---|---|
| ct-sas | 默认反恐精英 · SAS | CT | ✓ |
| t-phoenix | 默认恐怖分子 · 凤凰战士 | T | ✓ |
| ct-ava | 特别探员艾娃 · 联邦调查局 | CT | |
| t-miami | 迈阿密达里尔爵士 · 专业人士 | T | |

VPK `agents/models/` 下有 **11 个探员族、80 个变体模型**（`.vmdl_c`）：

| 探员族 | 变体 | | 探员族 | 变体 |
|---|---:|---|---|---:|
| ctm_diver | 3 | | tm_balkan | 7 |
| ctm_fbi | 9 | | tm_jungle_raider | 8 |
| ctm_gendarmerie | 5 | | tm_leet | 11 |
| ctm_sas | 3 | | tm_phoenix | 9 |
| ctm_st6 | 8 | | tm_professional | 10 |
| ctm_swat | 7 | | **合计** | **80** |

预览图：`panorama/images/econ/characters/customplayer_<变体名>_png.vtex_c`
（另有 `_square` 变体，共 300 张）。

**已接入 4 → 缺 76（95%）。**

---

## 5. 手套 — 72 款涂装，接入 1 款

UI 上 [client/loadout-view.js:32](../client/loadout-view.js) 的手套栏是
**`locked: true`**，不可选；[client/skin-menu.js](../client/skin-menu.js) 只写死一句
「默认手套：运动手套 · 树篱迷宫 · 崭新出厂」。

现有唯一实现是 `gloves-manifest.json`（`Sport Gloves | Hedge Maze`，paintkit 10038，
wear 0.06），烘焙在 `assets/viewmodel/arms.glb` 里。

VPK `gloves/paints/` 有 **72 款涂装、12 种手套模型**：

| 手套模型 | 说明 | | 手套模型 | 说明 |
|---|---|---|---|---|
| glove_sporty | 运动手套（现有唯一） | | glove_handwrap | 缠手绷带 |
| glove_specialist | 专业手套 | | glove_fingerless | 无指手套 |
| glove_bloodhound | 猎血手套 | | glove_hardknuckle | 硬指节 |
| glove_hydra | 九头蛇 | | glove_brokenfang | 破碎之爪 |
| glove_motorcycle | 驾驶手套 | | glove_fullfinger | 全指手套 |
| glove_slick | 精英手套 | | glove_cloth_collision | 布料碰撞体 |

72 款涂装举例：`sporty_green`、`specialist_fade`、`motorcycle_choco_boom`、
`slick_red`、`bloodhound_hydra_snakeskin_brass` 等。

### 做到要做的事（唯一需要改架构的一项）

1. **架构改动**：手套现在**烘焙在第一人称手臂模型里**（`arms.glb` 与手套一体）。
   要换手套，必须把 `arms.glb` 拆成「手臂骨架 + 可替换手套网格」，
   或给每款手套单独出一个 `arms+glove` 组合 —— **已采用后者**
   （`public/assets/viewmodel/gloves/<paintId>.glb`，与武器皮肤同款一皮一 GLB）
2. ~~`loadout-view.js` 解锁 `locked: true`~~ **已解锁**，点卡片或拖到手套槽即装备
3. ~~`skin-menu` 增加手套选择栏~~ **部分**：皮肤仓库的手套栏已显示当前装备的手套；
   完整选择仍走「武器装备」页
4. ~~72 款 × 2–3 MiB ≈ **180–220 MiB**~~ **已烘焙完成**（`shared/gloves.js` 72 款全量目录）
5. 第三人称同样要处理（`scripts/character-assets/pack-gloves.py` 已有打包脚本可复用）—— **待办**

**第一人称换装已于 2026-09-29 完成**：`ViewWeapon.set()` 按 `readGloveLoadout()` 选择手套，
`swapGlove`（`client/agent-arms.js`）把 `arms+glove` GLB 里的手套网格按骨骼名重绑到当前
探员手臂骨架上（两边都是 52 关节的 `weapon_arms` 骨架）。手套 GLB 约 3 MB 按需下载，
未下载完成前保留探员手臂上烘焙的默认手套（运动手套 · 树篱迷宫），就绪后自动换装。
装备时会预下载并显示进度（`equipGlove`）。第三人称模型与服务端同步（供观战/其他玩家
看到）尚未实现——当前手套选择仅本机第一人称生效。

---

## 6. 其他完全未做

| 类别 | VPK 数量 | 说明 |
|---|---:|---|
| **贴纸** | 22872 | 最大的一坨。要贴到枪身指定位置（`sticker_gaps` 网格，烘焙器明确过滤了它） |
| 音乐盒 | 103 | 需要音频管线 + 胜利回合播放逻辑 |
| 涂鸦/印花 | 113 | 探员衣服上的贴花 |
| 挂件 | 81 | 挂在枪上的饰品，需要骨骼锚点 |
| 武器箱 | 688 | 开箱模拟，纯 UI |

---

## 7. 已发现但未修复的缺陷

### 7.1 【已修复 2026-09-28】89 款皮肤名显示内部 token

原本 257 条含 `paintkit` 前缀的 id 中，**89 款名字显示为内部 token**
（如 `#PaintKit_cu_elites_urbanstorm_Tag`）。根因是本地化解析正则漏键：
`csgo_schinese.txt` 是 50374 行、键名带 tab 缩进的 KV 格式，全局正则只捞到
363 条（正确 42373 条），查不到名字就回退成 `kit.name`。

**已修复**：改为逐行解析，89/89 全部取回真名（都市冲击、卡特尔、暗网总机等）。
脚本 `scripts/weapon-assets/fix-damaged-names.mjs`。测试 344/344 通过。

**遗留**：168 款 `id` 仍带 `paintkit` 前缀（不影响显示，但 id 不够干净）。

### 7.2 【已排除】27 款 Fade 类图案

阳极气喷类（`F_PAINT_STYLE 5`）读 `glock-position.f32` 决定渐变走向。
Node 解码 EXR 时曾把 `pixelType` 枚举记反（`UINT=0/HALF=1/FLOAT=2` 当成 2=HALF）。
**用户已进游戏确认渲染良好**，此项排除。

### 7.3 【中】`full-manifest.json` 只剩 37 款记录

`bake-finishes.mjs` 覆盖写而非合并，多轮增量烘焙导致 838 个 GLB 里只有 37 款有元数据。
**目录本身没问题**（测试直接校验 GLB），一次性重跑流水线可修复。

### 7.4 【运维】服务端模块缓存陷阱

`shared/skins.js` 客户端与服务端都读，Node import 时缓存模块。改目录后
**必须重启 `node server/index.js`**，否则 `equipSkin` 查不到新 id、静默回退默认皮。
已在 `scripts/weapon-assets/README.md` 写明，并让两个脚本打印提醒。

---

## 8. 部署现状

`public/assets/` 在 `.gitignore` 里，二进制不进 Git。因此：

| 目标 | 能否用上这批皮肤 |
|---|---|
| 本机 / 局域网（`npm run build && npm start`） | **能**，浏览器从你的 origin 拉 |
| GitHub PR 贡献 | **不能带素材**，只能带代码 |
| 公网域名 | 需要资源托管，由维护者决定 |

`config/assets-lock.json` 的 `baseURL` 是 `https://cs2.duskrain.cn/`，那是项目原作者
apich 的服务器（第一提交即有），**不是你的**。另见 [ONLINE.md](../ONLINE.md)：
公网地址为 `https://duskrain.cn/dust2/`。

---

## 9. 优先级

| # | 问题 | 影响 | 工作量 | 状态 |
|---|---|---|---|---|
| 1 | 89 款名称 token 化 | 用户可见 | 小 | **已修复** |
| 2 | 27 款 Fade 图案 | 可能花屏 | — | **已排除（渲染良好）** |
| 3 | 手套 72 款 | 用户明确要求 | 中（拆 arms.glb） | **第一人称已完成；第三人称待办** |
| 4 | 探员 76 个变体 | 用户明确要求 | 中 | **进行中** |
| 5 | 枪械漏算 266 款 | 数字偏低 | 小（跑流水线） | 待办 |
| 6 | 刀类 522 款涂装 | 最大缺口 | 中（逐刀跑管线，每刀约 5 分钟） | **已全部接入（522/522）** |
| 7 | 12 把缺失枪种 425 款 | 需加枪 | 大 | **后期（已确认）** |
| 8 | `full-manifest.json` 修复 | 元数据 | 小 | 待办 |
