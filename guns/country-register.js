/* Reference flag country of each representative historic maker.
 * Not independently primary-source verified. The Armscor code PH describes
 * the brand headquarters, not the shotguns' physical manufacture.
 */
(function(root){
'use strict';
const BY_MAKER=Object.freeze(Object.fromEntries([["Forjas Taurus S.A.","BR"],["Sako Ltd","FI"],["Zastava Arms","RS"],["Sako Ltd (Tikka brand)","FI"],["Brügger & Thomet (B&T)","CH"],["Colt Canada (formerly Diemaco)","CA"],["Arsenal AD (Bulgaria)","BG"],["Daewoo Precision Industries (later S&T/SNT Motiv)","KR"],["Fabryka Broni Łucznik–Radom","PL"],["Österreichische Waffenfabriks-Gesellschaft (Steyr)","AT"],["Česká zbrojovka","CZ"],["Denel / Vektor","ZA"],["Fabbrica d’Armi di Terni (representative arsenal)","IT"],["Grand Power","SK"],["Armscor Global Defense, Inc.（ブランド元／実製造元未確認）","PH"],["Tikkakoski / Sako","FI"],["Amadeo Rossi S.A.","BR"],["Tikkakoski Oy","FI"],["Dansk Industri Syndikat (Madsen)","DK"],["Empresa Nacional Santa Bárbara (CETME)","ES"],["Valmet Oy","FI"],["Tikkakoski","FI"],["Maxim Gun Company (representative early producer)","GB"],["Manufacture d’armes de Saint-Étienne (MAS)","FR"],["Tula Arms Plant (representative arsenal)","RU"],["Maadi Military Factory","EG"],["UTAS Defense","TR"],["Derya Arms","TR"],["Truvelo Manufacturers","ZA"],["Armsel","ZA"],["Kongsberg Våpenfabrikk","NO"],["Springfield Armory","US"],["Geværfabriken København (Royal Copenhagen Arsenal)","DK"],["Ross Rifle Co.","CA"],["Fabrique Nationale (FN)","BE"],["Carl Gustafs Stads Gevärsfaktori","SE"],["Carl Walther（G41(W)型）／Mauser（G41(M)型）※該当型式未特定","DE"],["Walther (representative producer)","DE"],["Zbrojovka Brno","CZ"],["Schweizerische Industrie Gesellschaft (SIG)","CH"],["Royal Small Arms Factory Enfield (representative arsenal)","GB"],["Lysaght Works","AU"],["Diecasters Ltd","AU"]]));
function lookup(card){
 if(!card||card.country||!card.maker)return null;
 const country=BY_MAKER[String(card.maker).trim()]||'';
 if(!country)return null;
 return Object.freeze({country,basis:card.maker.includes('ブランド元／実製造元未確認')?'brand-home':'maker-home',externallyVerified:false});
}
const api=Object.freeze({lookup,knownMakers:BY_MAKER});
root.GunCountryRegister=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
