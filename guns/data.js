/* Educational firearm-name cards. No images or private user content are bundled. */
(function(root) {
  'use strict';
  // Approximate historical emergence of each ACTION / firearm type, oldest
  // first; NOT the release dates of the 35 individual starter models.
  // Historical boundaries are approximate (e.g. manually cranked vs.
  // fully automatic machine guns). Stable IDs and the ITEMS order below must
  // never be sorted, or existing users' photo references would be affected.
  const CATEGORIES = Object.freeze([
    {id:'shotgun',ja:'ショットガン',en:'shotgun'},                     // early smoothbore shot-firing arms
    {id:'revolver',ja:'リボルバー',en:'revolver'},                   // early 1800s
    {id:'bolt',ja:'ボルトアクションライフル',en:'bolt action rifle'}, // 1820s-1840s
    {id:'lever',ja:'レバーアクションライフル',en:'lever action rifle'},// mid 1800s
    {id:'machine-gun',ja:'機関銃',en:'machine gun'},                // 1860s onward; automatic late 1800s
    {id:'semi-rifle',ja:'半自動ライフル',en:'semi automatic rifle'}, // 1880s
    {id:'pistol',ja:'自動拳銃',en:'semi automatic pistol'},          // 1890s
    {id:'smg',ja:'サブマシンガン',en:'submachine gun'},              // 1910s
    {id:'assault',ja:'アサルトライフル',en:'assault rifle'},          // 1940s, conventional category
    {id:'other',ja:'その他・未分類',en:'firearm'}                    // always last, unsorted
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
  // The national flag refers to the present-day country of a representative
  // manufacturer, not every historical production site or an old state flag.
  // For historically multi-source models, we identify a representative maker;
  // users can override both fields without modifying their images or IDs.
  const COUNTRIES = Object.freeze({
    US:{ja:'アメリカ',image:'./flags/us.svg'}, BE:{ja:'ベルギー',image:'./flags/be.svg'},
    AT:{ja:'オーストリア',image:'./flags/at.svg'}, DE:{ja:'ドイツ',image:'./flags/de.svg'},
    IT:{ja:'イタリア',image:'./flags/it.svg'}, GB:{ja:'イギリス',image:'./flags/gb.svg'},
    RU:{ja:'ロシア（旧ソ連・ロシア帝国を含む）',image:'./flags/ru.svg'},
    IL:{ja:'イスラエル',image:'./flags/il.svg'}, CH:{ja:'スイス',image:'./flags/ch.svg'},
    CZ:{ja:'チェコ',image:'./flags/cz.svg'}, FR:{ja:'フランス',image:'./flags/fr.svg'},
    JP:{ja:'日本',image:'./flags/jp.svg'}, CN:{ja:'中国',image:'./flags/cn.svg'}
  });
  // Aligned with ITEMS by stable ID, never sorted with the visible categories.
  const REPRESENTATIVE_MAKERS = Object.freeze([
    ['US','Remington Arms'],                       // Remington 870
    ['US','O.F. Mossberg & Sons'],                  // Mossberg 500
    ['US','Winchester Repeating Arms'],             // Winchester 1897
    ['BE','Fabrique Nationale (FN)'],               // Browning Auto-5 (early Belgian production)
    ['US',"Colt's Manufacturing Company"],          // Colt Python
    ['US','Smith & Wesson'],                        // S&W Model 10
    ['US',"Colt's Manufacturing Company"],          // Colt SAA
    ['BE','Fabrique d’Armes Nagant'],               // Nagant M1895 (original Belgian manufacturer)
    ['US','Sturm, Ruger & Co.'],                    // Ruger GP100
    ['US',"Colt's Manufacturing Company"],          // Colt M1911
    ['AT','Glock'],                                 // Glock 17
    ['IT','Beretta'],                               // Beretta 92FS
    ['DE','J. P. Sauer & Sohn (SIG Sauer)'],        // SIG P226 (German manufacturing)
    ['DE','Carl Walther'],                          // Walther P38
    ['DE','Mauser'],                                // Mauser C96
    ['DE','Mauser'],                                // Karabiner 98k
    ['GB','Royal Small Arms Factory (Enfield)'],    // Lee-Enfield No. 4
    ['RU','Tula Arms Plant'],                       // Mosin-Nagant 1891/30 (one major maker)
    ['US','Springfield Armory'],                    // Springfield M1903
    ['US','Springfield Armory'],                    // M1 Garand (one major maker)
    ['RU','Tula Arms Plant'],                       // SKS (early production)
    ['US','Sturm, Ruger & Co.'],                    // Ruger 10/22
    ['US','Winchester Repeating Arms'],             // Winchester 1873
    ['US','Winchester Repeating Arms'],             // Winchester 1894
    ['US','Marlin Firearms'],                       // Marlin 336
    ['RU','Izhmash (Izhevsk)'],                     // AK-47 (major Soviet producer)
    ['US',"Colt's Manufacturing Company"],          // M16A1
    ['AT','Steyr-Daimler-Puch'],                   // Steyr AUG
    ['BE','FN Herstal'],                            // FN SCAR-L
    ['US','Auto-Ordnance'],                         // Thompson M1928
    ['DE','Heckler & Koch'],                        // MP5
    ['IL','Israel Military Industries (IMI)'],     // Uzi
    ['DE','Großfuß'],                              // MG 42 (original manufacturer)
    ['GB','Royal Small Arms Factory (Enfield)'],    // Bren (British production)
    ['US',"Colt's Manufacturing Company"]           // M2 Browning (early production)
  ]);
  // Preserve the first 35 stable IDs (and all of their private photo keys).
  // Extended cards use deterministic IDs based on their actual English labels:
  // adding/reordering the study list must never attach old images to a new gun.
  const originalSeeds=ITEMS.map((x,i)=>Object.freeze({
    id:'gun-'+String(i+1).padStart(4,'0'),category:x[0],
    name:x[3],name_en:x[1],description:x[2],
    country:REPRESENTATIVE_MAKERS[i][0],maker:REPRESENTATIVE_MAKERS[i][1],
    search:x[1]+' '+(CATEGORIES.find(c=>c.id===x[0])?.en||'firearm')+' photos',
    images:['','',''],source:'starter'
  }));
  const CATALOG_TARGET=2000;
  function modelIdentity(category,english){
    return category+'|'+String(english).normalize('NFKC').toLowerCase()
      .replace(/[–—]/g,'-').replace(/\\s+/g,' ').trim();
  }
  function extendedId(category,english){
    const identity=modelIdentity(category,english);
    let hash=2166136261;
    for(let i=0;i<identity.length;i++)
      hash=Math.imul(hash^identity.charCodeAt(i),16777619)>>>0;
    const slug=String(english).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,'-')
      .replace(/^-+|-+$/g,'').slice(0,42).replace(/-+$/g,'');
    return 'gun-ext-'+category+'-'+slug+'-'+hash.toString(36);
  }
  const baseExtended=root.GunExtendedCatalog||
    (typeof module!=='undefined'&&module.exports?require('./extended-models.js'):null);
  const variantExtended=root.GunVariantCatalog||
    (typeof module!=='undefined'&&module.exports?require('./extended-variants.js'):null);
  const buckets=new Map(CATEGORIES.map(c=>[c.id,[]]));
  const seen=new Set(originalSeeds.map(c=>modelIdentity(c.category,c.name_en)));
  const knownIds=new Set(originalSeeds.map(c=>c.id));
  for(const item of [...(baseExtended?.entries||[]),...(variantExtended?.entries||[])]){
    if(!item||!buckets.has(item.category)||!item.name_en||!item.name)continue;
    const identity=modelIdentity(item.category,item.name_en);
    if(seen.has(identity))continue;
    const id=extendedId(item.category,item.name_en);
    if(knownIds.has(id))throw Error('銃器カタログのモデルIDが重複しました: '+id);
    seen.add(identity);knownIds.add(id);
    buckets.get(item.category).push(Object.freeze({...item,id,images:['','',''],source:'starter'}));
  }
  // Balance the historic categories before the final 2,000-study-card cutoff.
  // The pool can exceed the target, but only distinct named models become
  // starter cards. Never invent numbered placeholders or duplicate source names.
  const selected=new Map(CATEGORIES.map(c=>[c.id,[]]));
  const countByType=new Map(CATEGORIES.map(c=>[c.id,0]));
  let remaining=CATALOG_TARGET-originalSeeds.length;
  while(remaining>0){
    let added=0;
    for(const category of CATEGORIES){
      if(remaining<=0)break;
      const pool=buckets.get(category.id),index=countByType.get(category.id);
      if(index>=pool.length)continue;
      selected.get(category.id).push(pool[index]);
      countByType.set(category.id,index+1);
      remaining--;added++;
    }
    if(!added)break;
  }
  const extendedSeeds=CATEGORIES.flatMap(c=>selected.get(c.id));
  const SEEDS=Object.freeze([...originalSeeds,...extendedSeeds]);
  const ORIGINAL_SEED_NAMES=new Map(SEEDS.map(c=>[c.id,{
    english:c.name_en,katakana:c.name,search:c.search,country:c.country,maker:c.maker
  }]));
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
    // Stable seed IDs restore the precise English model name even when an
    // older local backup/Drive journal has no separate English field.
    const name_en=String(input.name_en||legacy?.english||'').trim().slice(0,180);
    // Only older saved seed records that lack these keys receive defaults.
    // Explicitly cleared or user-edited values must remain unchanged.
    const maker=Object.prototype.hasOwnProperty.call(input,'maker')
      ? String(input.maker||'').trim().slice(0,200) : String(legacy?.maker||'');
    const countrySource=Object.prototype.hasOwnProperty.call(input,'country')
      ? String(input.country||'').trim().toUpperCase() : String(legacy?.country||'');
    const country=Object.prototype.hasOwnProperty.call(COUNTRIES,countrySource)?countrySource:'';
    const category=CATEGORY_IDS.has(input.category)?input.category:'other';
    const images=Array.from({length:3},(_,i)=>{
      const v=Array.isArray(input.images)?input.images[i]:'';
      const s=typeof v==='string'?v.trim():'';
      return /^(idb:gunimg:|gdrive:[\w-]+:[a-f0-9]{64}$|https?:\/\/)/i.test(s)?s:'';
    });
    return {id,category,name,name_en,maker,country,description:String(input.description||'').slice(0,6000),
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
  const api=Object.freeze({CATEGORIES,COUNTRIES,SEEDS,CATALOG_TARGET,
    catalogueCount:SEEDS.length,sanitizeCard,mergeCards,modelIdentity,extendedId});
  root.GunCatalog=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
