/* Representative manufacturer register for firearm study cards.
 * Important: These attributions have not been externally source-verified in
 * this offline pass. A brand, an inventor, a licensee and a manufacturer are
 * not always the same. Leave genuinely ambiguous entries unresolved instead
 * of assigning a company on the basis of a label alone.
 *
 * This register only proposes missing seed values. Existing nonempty maker
 * fields and user edits are never overwritten. Stable IDs and photos are
 * unaffected. A historical rifle may have multiple factories; where known
 * we name a representative manufacturing organization, not an exclusive one.
 */
(function(root){
'use strict';
const FAMILY=Object.freeze({
 shotgun:Object.freeze({
  'UTAS':'UTAS Defense','Derya':'Derya Arms',
  'Neostead':'Truvelo Manufacturers','Striker':'Armsel'
 }),
 revolver:Object.freeze({
  'Taurus':'Forjas Taurus S.A.'
 }),
 pistol:Object.freeze({
  'Taurus':'Forjas Taurus S.A.',
  'Canik':'Samsun Yurt Savunma (Canik)',
  'Sarsilmaz':'Sarsılmaz Silah Sanayi'
 }),
 bolt:Object.freeze({
  'Arisaka':'Tokyo Army Arsenal (representative arsenal)',
  'Sako':'Sako Ltd',
  'Tikka':'Sako Ltd (Tikka brand)',
  'Mannlicher':'Österreichische Waffenfabriks-Gesellschaft (Steyr)',
  'Carcano':'Fabbrica d’Armi di Terni (representative arsenal)',
  'Krag–Jørgensen':'Kongsberg Våpenfabrikk',
  'Ross':'Ross Rifle Co.',
  'Vz.':'Zbrojovka Brno',
  'Zastava':'Zastava Arms',
  'Mosin–Nagant':'Tula Arms Plant (representative arsenal)',
  'Lee–Enfield':'Royal Small Arms Factory Enfield (representative arsenal)',
  'Mauser':'Mauserwerke (representative producer)'
 }),
 lever:Object.freeze({
  'Rossi':'Amadeo Rossi S.A.',
  'Spencer':'Spencer Repeating Rifle Company',
  'Henry':'New Haven Arms Company'
 }),
 'semi-rifle':Object.freeze({
  'FN':'Fabrique Nationale (FN)',
  'MAS':'Manufacture d’armes de Saint-Étienne (MAS)',
  'SVT':'Tula Arms Plant (representative arsenal)',
  'AG':'Carl Gustafs Stads Gevärsfaktori',
  'ZH':'Zbrojovka Brno',
  'Mondragón':'Schweizerische Industrie Gesellschaft (SIG)',
  'Hakim':'Maadi Military Factory',
  'Rashid':'Maadi Military Factory',
  'L1A1':'Royal Small Arms Factory Enfield (representative arsenal)'
 }),
 assault:Object.freeze({
  'L85':'Royal Ordnance (Enfield; later H&K upgrades)',
  'L22':'Royal Ordnance (Enfield)',
  'EM':'Royal Small Arms Factory Enfield',
  'FAMAS':'Manufacture d’armes de Saint-Étienne (MAS)',
  'QBZ':'China North Industries (Norinco)',
  'Type 56':'China North Industries (Norinco)',
  'Type 81':'China North Industries (Norinco)',
  'Type 63':'China North Industries (Norinco)',
  'Type 86S':'China North Industries (Norinco)',
  'Daewoo':'Daewoo Precision Industries (later S&T/SNT Motiv)',
  'Beryl':'Fabryka Broni Łucznik–Radom',
  'MSBS':'Fabryka Broni Łucznik–Radom',
  'CETME':'Empresa Nacional Santa Bárbara (CETME)',
  'Valmet':'Valmet Oy',
  'Zastava':'Zastava Arms',
  'Vektor':'Denel / Vektor',
  'Type 89':'Howa Machinery',
  'Type 20':'Howa Machinery',
  'Type 64':'Howa Machinery',
  'Colt Canada':'Colt Canada (formerly Diemaco)',
  'Arsenal':'Arsenal AD (Bulgaria)'
 }),
 smg:Object.freeze({
  'MP 18':'Theodor Bergmann GmbH',
  'MP 28':'C. G. Haenel',
  'MP 34':'Steyr-Solothurn',
  'MP 35':'C. G. Haenel (representative producer)',
  'MP 38':'Erma Werke (representative producer)',
  'MP 40':'Erma Werke (representative producer)',
  'MP 41':'C. G. Haenel',
  'Sten':'Royal Small Arms Factory Enfield (representative producer)',
  'Lanchester':'Sterling Engineering Co.',
  'Owen':'Lysaght Works',
  'Austen':'Diecasters Ltd',
  'Suomi':'Tikkakoski Oy',
  'Madsen':'Dansk Industri Syndikat (Madsen)',
  'PPD':'Kovrov Arms Factory (representative producer)',
  'PPS':'Sestroretsk Tool Factory (representative producer)',
  'PPSh':'Tula Arms Plant (representative producer)',
  'PP 19':'Izhmash (Izhevsk)',
  'PP 2000':'KBP Instrument Design Bureau',
  'PP 90':'KBP Instrument Design Bureau',
  'PP 91':'Zlatoust Machine-Building Plant',
  'PP 9':'Zlatoust Machine-Building Plant',
  'PP 93':'KBP Instrument Design Bureau',
  'SR':'TsNIITochMash',
  'OTs':'TsKIB SOO (Tula)',
  'MAC':'Military Armament Corporation',
  'Ingram':'Military Armament Corporation',
  'M3':'General Motors Guide Lamp Division',
  'Reising':'Harrington & Richardson',
  'United Defense':'High Standard Manufacturing Co. (representative producer)',
  'Skorpion':'Česká zbrojovka',
  'PM':'Fabryka Broni Łucznik–Radom',
  'B&T':'Brügger & Thomet (B&T)',
  'Stribog':'Grand Power',
  'CZ':'Česká zbrojovka',
  'Thompson':'Auto-Ordnance (representative producer)'
 }),
 'machine-gun':Object.freeze({
  'Maxim':'Maxim Gun Company (representative early producer)',
  'Vickers':'Vickers Ltd',
  'MG 08':'Spandau Arsenal (representative producer)',
  'MG 34':'Mauserwerke (representative producer)',
  'MG 3':'Rheinmetall',
  'MG 4':'Heckler & Koch',
  'MG 42/59':'Beretta (Italian production)',
  'MG 45':'Mauserwerke (prototype)',
  'MG 5':'Heckler & Koch',
  'MG 36':'Heckler & Koch',
  'MG 15':'Rheinmetall-Borsig',
  'MG 17':'Rheinmetall-Borsig',
  'MG 81':'Rheinmetall-Borsig',
  'MG 131':'Rheinmetall-Borsig',
  'MG 30':'Steyr-Solothurn',
  'Schwarzlose':'Österreichische Waffenfabriks-Gesellschaft (Steyr)',
  'Breda':'Società Italiana Ernesto Breda',
  'Hotchkiss':'Hotchkiss et Cie',
  'Lewis':'Birmingham Small Arms (representative producer)',
  'Bren':'Royal Small Arms Factory Enfield (representative producer)',
  'ZB':'Zbrojovka Brno',
  'Type 11':'Tokyo Army Arsenal (representative producer)',
  'Type 96':'Kokura Army Arsenal (representative producer)',
  'Type 99':'Kokura Army Arsenal (representative producer)',
  'Type 3':'Tokyo Army Arsenal (representative producer)',
  'Type 92':'Tokyo Army Arsenal (representative producer)',
  'Type 1':'Tokyo Army Arsenal (representative producer)',
  'Type 67':'China North Industries (Norinco)',
  'Type 80':'China North Industries (Norinco)',
  'Type 81':'China North Industries (Norinco)',
  'Type 54':'China North Industries (Norinco)',
  'Type 77':'China North Industries (Norinco)',
  'Type 85':'China North Industries (Norinco)',
  'M 1919':'Colt / General Motors (historical producers)',
  'M 37':'Saginaw Steering Gear (General Motors)',
  'M 73':'Rock Island Arsenal (representative producer)',
  'M 85':'General Electric (representative producer)',
  'M 240':'FN Manufacturing',
  'M 249':'FN Manufacturing',
  'M 60':'Saco Defense (representative producer)',
  'M 134':'General Electric',
  'M240':'FN Manufacturing',
  'M249':'FN Manufacturing',
  'M60':'Saco Defense (representative producer)',
  'Mk 46':'FN Manufacturing',
  'Mk 48':'FN Manufacturing',
  'Browning M2':'Colt / FN (historical producers)',
  'GAU 19':'General Dynamics Ordnance',
  'GAU 8':'General Electric',
  'XM':'General Electric',
  'PK':'Kovrov Mechanical Plant (representative producer)',
  'RPK':'Vyatskiye Polyany / Molot (representative producer)',
  'DP':'Degtyaryov Plant (Kovrov)',
  'SG':'Kovrov Mechanical Plant',
  'DShK':'Degtyaryov Plant (Kovrov)',
  'NSV':'Metallist (Uralsk; original Soviet production)',
  'Kord':'Degtyaryov Plant (Kovrov)',
  'KPV':'Degtyaryov Plant (Kovrov)',
  'ShKAS':'Tula Arms Plant (representative producer)',
  'ShVAK':'Tula Arms Plant (representative producer)',
  'UB':'Tula Arms Plant (representative producer)',
  'Negev':'Israel Weapon Industries',
  'Daewoo':'Daewoo Precision Industries (later S&T/SNT Motiv)',
  'QJY':'China North Industries (Norinco)',
  'QJZ':'China North Industries (Norinco)',
  'QJB':'China North Industries (Norinco)'
 })
});
// The screenshot supplied by the user identifies an Armscor company, but
// does not identify the factory that manufactured these three imported
// shotguns. Show the company ONLY as brand owner, explicitly qualifying it
// so nobody mistakes the entry for a verified factory attribution.
const BRAND_ONLY=Object.freeze({
 'shotgun|Armscor VR80':'Armscor Global Defense, Inc.（ブランド元／実製造元未確認）',
 'shotgun|Armscor VR60':'Armscor Global Defense, Inc.（ブランド元／実製造元未確認）',
 'shotgun|Armscor VRF14':'Armscor Global Defense, Inc.（ブランド元／実製造元未確認）'
});
// The generic card G 41 covers separate Mauser and Walther subtypes. This is
// a conditional attribution, not verification of one particular example.
const VARIANT_DEPENDENT=Object.freeze({
 'semi-rifle|G 41':'Carl Walther（G41(W)型）／Mauser（G41(M)型）※該当型式未特定'
});
const EXACT=Object.freeze({
 'bolt|Krag–Jørgensen M1889':'Geværfabriken København (Royal Copenhagen Arsenal)',
 'bolt|Krag–Jørgensen M1894':'Kongsberg Våpenfabrikk',
 'bolt|Krag–Jørgensen M1898':'Springfield Armory',
 'bolt|Arisaka Type 30':'Tokyo Army Arsenal',
 'bolt|Arisaka Type 38':'Tokyo Army Arsenal',
 'bolt|Arisaka Type 44':'Tokyo Army Arsenal',
 'bolt|Arisaka Type 97':'Kokura Army Arsenal',
 'bolt|Arisaka Type 99':'Nagoya Army Arsenal',
 'bolt|Arisaka Type 2':'Nagoya Army Arsenal',
 'bolt|Tikka M55':'Tikkakoski',
 'bolt|Tikka M65':'Tikkakoski',
 'bolt|Tikka M590':'Tikkakoski / Sako',
 'bolt|Tikka M595':'Tikkakoski / Sako',
 'bolt|Tikka M695':'Tikkakoski / Sako',
 'lever|Spencer Model 1865':'Burnside Rifle Company',
 'semi-rifle|G 43':'Walther (representative producer)',
 'smg|Ingram M6':'Police Ordnance Company',
 'smg|MAC M11/9':'SWD (Cobray)',
 'smg|MAC M11A1':'SWD (Cobray)',
 'machine-gun|RPK 16':'Kalashnikov Concern',
 'machine-gun|RPK 203':'Kalashnikov Concern',
 'machine-gun|RPK 201':'Kalashnikov Concern',
 'machine-gun|RPK 202':'Kalashnikov Concern'
});
function lookup(card){
 if(!card||card.maker)return null;
 const name=String(card.name_en||'').trim(),category=String(card.category||'');
 const key=category+'|'+name;
 const brand=BRAND_ONLY[key];
 if(brand)return {maker:brand,basis:'brand-only',externallyVerified:false};
 const variant=VARIANT_DEPENDENT[key];
 if(variant)return {maker:variant,basis:'variant-dependent',externallyVerified:false};
 const exact=EXACT[key];
 if(exact)return {maker:exact,basis:'model-specific',externallyVerified:false};
 const entries=Object.entries(FAMILY[category]||{}).sort((a,b)=>b[0].length-a[0].length);
 // Exact models, space-delimited variants, slash and hyphen subtypes, and
 // letter revisions such as M240B are supported. Never match digit-to-digit
 // continuations: MG 3 must not be mistaken for MG 34.
 const hit=entries.find(([prefix])=>{
   if(name===prefix)return true;
   if(!name.startsWith(prefix))return false;
   const suffix=name.slice(prefix.length);
   return /^[ \t\/-]/.test(suffix)||(/[A-Za-z]/.test(suffix[0]||'')&&/\d$/.test(prefix));
 });
 return hit?{maker:hit[1],basis:'catalog-family',externallyVerified:false}:null;
}
const api=Object.freeze({lookup});
root.GunManufacturerRegister=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
