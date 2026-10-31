/* Educational firearm-name cards. No images or private user content are bundled. */
(function(root) {
  'use strict';
  const CATEGORIES = Object.freeze([
    {id:'shotgun',ja:'ショットガン',en:'shotgun'},
    {id:'revolver',ja:'リボルバー',en:'revolver'},
    {id:'pistol',ja:'自動拳銃',en:'semi automatic pistol'},
    {id:'bolt',ja:'ボルトアクションライフル',en:'bolt action rifle'},
    {id:'semi-rifle',ja:'半自動ライフル',en:'semi automatic rifle'},
    {id:'lever',ja:'レバーアクションライフル',en:'lever action rifle'},
    {id:'assault',ja:'アサルトライフル',en:'assault rifle'},
    {id:'smg',ja:'サブマシンガン',en:'submachine gun'},
    {id:'machine-gun',ja:'機関銃',en:'machine gun'},
    {id:'other',ja:'その他・未分類',en:'firearm'}
  ]);
  const ITEMS = [
    ['shotgun','Remington Model 870','米国で1950年に登場したポンプアクション式ショットガン。幅広い用途で知られる代表的なモデル。','レミントン・モデル870'],
    ['shotgun','Mossberg 500','米国のモスバーグ社が1961年に発売したポンプアクション式ショットガンのシリーズ。','モスバーグ500'],
    ['shotgun','Winchester Model 1897','ジョン・ブローニングが設計したウィンチェスター社のポンプ式ショットガン。19世紀末から使われた歴史的モデル。','ウィンチェスター・モデル1897'],
    ['shotgun','Browning Auto-5','ジョン・ブローニング設計の自動装填式ショットガン。1902年に生産が始まり、特徴的な角張った機関部で知られる。','ブローニング・オート5'],
    ['revolver','Colt Python','コルト社が1955年に発売した米国のダブルアクション式リボルバー。精緻な外観と仕上げで知られる。','コルト・パイソン'],
    ['revolver','Smith & Wesson Model 10','スミス&ウェッソン社の定番リボルバー。19世紀末に登場したMilitary & Police系統に由来する。','スミス＆ウェッソン・モデル10'],
    ['revolver','Colt Single Action Army','1873年に登場したコルト社のシングルアクション式リボルバー。米国西部開拓時代の象徴的な銃。','コルト・シングルアクション・アーミー'],
    ['revolver','Nagant M1895','ロシア帝国向けに採用された1895年式リボルバー。独特な機構を持つ歴史的な軍用拳銃。','ナガン・エム1895'],
    ['revolver','Ruger GP100','米国スターム・ルガー社のダブルアクション式リボルバー。1980年代に登場した。','ルガー・ジーピー100'],
    ['pistol','Colt M1911','ジョン・ブローニングの設計を基に1911年に米軍が採用した自動拳銃。長い歴史を持つ。','コルト・エム1911'],
    ['pistol','Glock 17','オーストリアのグロック社が開発した自動拳銃。ポリマー製フレームを広く普及させたモデルとして知られる。','グロック17'],
    ['pistol','Beretta 92FS','イタリアのベレッタ社による92シリーズの自動拳銃。米軍がM9として採用した系統で知られる。','ベレッタ92エフエス'],
    ['pistol','SIG Sauer P226','1980年代に登場したSIG Sauerの自動拳銃。各国で警察・軍用として採用例がある。','シグ・ザウエル・ピー226'],
    ['pistol','Walther P38','ドイツで1930年代末に登場した自動拳銃。第二次世界大戦期の軍用拳銃として知られる。','ワルサー・ピー38'],
    ['pistol','Mauser C96','ドイツのマウザー社が19世紀末に開発した自動拳銃。特徴的な外観から「ブルームハンドル」とも呼ばれる。','モーゼル・シー96'],
    ['bolt','Mauser Karabiner 98k','ドイツで1935年に標準採用されたボルトアクション式軍用ライフル。マウザー98系統に属する。','マウザー・カラビナー98カー'],
    ['bolt','Lee–Enfield No. 4 Mk I','英国・英連邦軍で用いられたボルトアクション式ライフル。リー・エンフィールド系列の代表例。','リー・エンフィールド・ナンバー4・マークワン'],
    ['bolt','Mosin–Nagant M1891/30','ロシア帝国・ソビエト連邦の軍用ライフル系統。1930年改良型は第二次世界大戦でも広く用いられた。','モシン・ナガン・エム1891/30'],
    ['bolt','Springfield M1903','米国で1903年に制式採用されたボルトアクション式軍用ライフル。20世紀前半の代表的な米軍小銃。','スプリングフィールド・エム1903'],
    ['semi-rifle','M1 Garand','1930年代に米軍で採用された半自動式ライフル。ジョン・ガーランドの名で知られる。','エムワン・ガーランド'],
    ['semi-rifle','SKS','ソビエト連邦で第二次世界大戦末期に設計された半自動式カービン。シモノフ設計の小銃として知られる。','エスケーエス'],
    ['semi-rifle','Ruger 10/22','米国で1964年に登場した民生用の半自動式小口径ライフル。長く生産が続く定番モデル。','ルガー10/22'],
    ['lever','Winchester Model 1873','米国のウィンチェスター社が1873年に発売したレバーアクション式ライフル。西部開拓時代の象徴的モデル。','ウィンチェスター・モデル1873'],
    ['lever','Winchester Model 1894','ジョン・ブローニングが設計したレバーアクション式ライフル。1894年から長く販売されている。','ウィンチェスター・モデル1894'],
    ['lever','Marlin Model 336','米国マーリン社のレバーアクション式ライフル。1948年に登場した狩猟用モデル。','マーリン・モデル336'],
    ['assault','AK-47','ソビエト連邦でカラシニコフが設計した小銃の系統。1940年代後半に採用された。','エーケー47'],
    ['assault','M16A1','米軍が1960年代に採用したM16系統の小銃。ベトナム戦争期の装備として広く知られる。','エム16エーワン'],
    ['assault','Steyr AUG','オーストリアのシュタイヤー社が開発したブルパップ配置の小銃。1970年代後半に採用された。','シュタイヤー・アウグ'],
    ['assault','FN SCAR-L','ベルギーのFNハースタル社が開発したSCARシリーズの軽量小銃型。現代的なモジュール設計で知られる。','エフエヌ・スカー・エル'],
    ['smg','Thompson M1928','米国のトンプソン系サブマシンガンの一種。1920〜30年代の歴史的な銃として知られる。','トンプソン・エム1928'],
    ['smg','Heckler & Koch MP5','ドイツのH&K社が1960年代に開発したサブマシンガン。世界各地で採用例がある。','ヘッケラー＆コッホ・エムピー5'],
    ['smg','Uzi','イスラエルで1950年代に導入されたサブマシンガン。コンパクトな外観で知られる。','ウージー'],
    ['machine-gun','MG 42','第二次世界大戦期のドイツで採用された汎用機関銃。特徴的な外装と機構で知られる。','エムジー42'],
    ['machine-gun','Bren','チェコ系設計をもとに英国で開発された軽機関銃。第二次世界大戦期の英軍装備として知られる。','ブレン'],
    ['machine-gun','M2 Browning','ジョン・ブローニング設計に由来する米国の重機関銃。1920年代から続く長い使用歴を持つ。','エムツー・ブローニング']
  ];
  // The visible name is Japanese katakana; Google Images always uses the
  // original English model name. IDs and photo keys never change.
  const SEEDS = Object.freeze(ITEMS.map((x,i)=>Object.freeze({
    id:'gun-'+String(i+1).padStart(4,'0'), category:x[0],name:x[3],description:x[2],
    search:x[1]+' '+(CATEGORIES.find(c=>c.id===x[0])?.en||'firearm')+' photos',
    images:['','',''],source:'starter'
  })));
  const ORIGINAL_SEED_NAMES = new Map(ITEMS.map((row,i)=>[
    'gun-'+String(i+1).padStart(4,'0'), {english:row[1],katakana:row[3],
      search:SEEDS[i].search}
  ]));
  const CATEGORY_IDS=new Set(CATEGORIES.map(x=>x.id));
  const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{1,95}$/;
  function sanitizeCard(input) {
    if(!input || typeof input!=='object' || !ID.test(String(input.id||'')))return null;
    const id=String(input.id);
    const legacy=ORIGINAL_SEED_NAMES.get(id);
    const oldName=String(input.name||'').trim().slice(0,180);
    // Old saved cards or previously received Drive journals can contain the
    // English seed name. Convert that display label only; retain images,
    // descriptions, user-chosen alternative names, and the original English
    // search query without modifying the persisted record in-place.
    const name=legacy && oldName===legacy.english ? legacy.katakana : oldName;
    if(!name)return null;
    const category=CATEGORY_IDS.has(input.category)?input.category:'other';
    const images=Array.from({length:3},(_,i)=>{
      const v=Array.isArray(input.images)?input.images[i]:'';
      const s=typeof v==='string'?v.trim():'';
      return /^(idb:gunimg:|gdrive:[\w-]+:[a-f0-9]{64}$|https?:\/\/)/i.test(s)?s:'';
    });
    return {id,category,name,description:String(input.description||'').slice(0,6000),
      search:String(input.search||legacy?.search||name).trim().slice(0,240),images,
      source:input.source==='starter'?'starter':'user'};
  }
  function mergeCards(input) {
    const items=new Map(SEEDS.map(c=>[c.id,sanitizeCard(c)]));
    if(Array.isArray(input))for(const raw of input){
      const c=sanitizeCard(raw);if(c)items.set(c.id,c);
    }
    return [...items.values()];
  }
  const api=Object.freeze({CATEGORIES,SEEDS,sanitizeCard,mergeCards});
  root.GunCatalog=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
