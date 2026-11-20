'use strict';
// Shared PRIVATE consent validation. A conversation record is an operator
// attestation, not an authenticated message signature or a quality certificate.
const crypto=require('node:crypto');
const SHA=/^[a-f0-9]{64}$/;
const SOURCE_KEYS=['raw','canonical','originalIndex','inventory','second','resolutions','boundaries','corrections','lock'];
const STATES=Object.freeze({sourceTranscription:'two_independent_transcriptions_reconciled',fullSourceQA:'pending',canonical60:'incomplete',display24Conditions:'not_run',iphone:'not_run'});
function stable(x){if(x===null||typeof x!=='object')return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(stable).join(',')+']';return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';}
const digest=x=>crypto.createHash('sha256').update(stable(x)).digest('hex');
const same=(a,b)=>stable(a)===stable(b);
function demand(ok,code){if(!ok)throw Error(code);}
function affirmativeReply(text){
 // Context is still mandatory below. Unknown/negative text is never inferred
 // as consent merely because an operator set a Boolean in the record.
 return typeof text==='string'&&/^(?:確認用\s*(?:url|リンク)(?:を)?(?:ください|お願いします)?|はい(?:[、, ]*(?:お願いします|進めてください))?|お願いします|進めてください|受け取ります|yes(?:,? please)?|please proceed|preview url please)[。.!！\s]*$/iu.test(text.trim());
}
function validateV2(consent,{subject,manifest,conversation,assessment,rules}){
 demand(consent?.schema==='reader-preview-consent-v2','PREVIEW_CONSENT_V2_SCHEMA');
 demand(consent.explicit===true&&consent.confirmedByUser===true&&consent.requestedBy==='user'&&
  consent.acceptanceKind==='direct_reply_to_artifact_disclosure'&&consent.previewOnly===true&&
  consent.normalReleaseAuthorized===false,'PREVIEW_CONSENT_V2_EXPLICIT_ACCEPTANCE_REQUIRED');
 demand(consent.bookId===subject.bookId&&same(consent.range,subject.range)&&
  consent.artifactSha256===subject.artifactSha256&&consent.loaderSha256===subject.loaderSha256&&
  SHA.test(consent.artifactSha256||'')&&SHA.test(consent.loaderSha256||''),'PREVIEW_CONSENT_V2_IDENTITY_MISMATCH');
 demand(conversation?.schema==='preview-conversation-acceptance-evidence-v1'&&
  conversation.bookId===subject.bookId&&same(conversation.range,subject.range)&&
  conversation.artifact?.sha256===subject.artifactSha256&&
  conversation.normalReleaseAuthorizedByThisReply===false,'PREVIEW_CONVERSATION_IDENTITY_MISMATCH');
 const disclosure=conversation.assistantDisclosure;
 demand(affirmativeReply(conversation.userReplyExact)&&
  consent.requestText===conversation.userReplyExact&&typeof conversation.acceptanceBasis==='string'&&
  conversation.acceptanceBasis.length>=12&&typeof disclosure?.exactQuestion==='string'&&
  disclosure.exactQuestion.length>=8&&typeof disclosure.visibleIdentity==='string'&&disclosure.visibleIdentity.length>0&&
  Array.isArray(disclosure.disclosedRemainingChecks)&&disclosure.disclosedRemainingChecks.length>0&&
  disclosure.disclosedRemainingChecks.every(x=>typeof x==='string'&&x.length>0)&&
  consent.disclosureSha256===digest(disclosure),'PREVIEW_CONSENT_V2_DISCLOSURE_REPLY_MISMATCH');
 demand(disclosure.visibleIdentity.includes(subject.artifactSha256.slice(0,12))&&
  new RegExp('(?<![0-9])'+String(subject.range[0])+'\\s*(?:〜|～|–|-|—|to)\\s*'+String(subject.range[1])+'(?![0-9])').test(disclosure.visibleIdentity),
  'PREVIEW_CONSENT_V2_VISIBLE_TARGET_MISMATCH');
 demand(consent.recordedAt===conversation.recordedAtUTC&&Number.isFinite(Date.parse(consent.recordedAt||''))&&
  consent.timestampMeaning===conversation.timestampMeaning&&typeof consent.timestampMeaning==='string'&&
  consent.timestampMeaning.length>=12,'PREVIEW_CONSENT_V2_RECORD_TIME_REQUIRED');
 demand(same(consent.reviewState,STATES),'PREVIEW_CONSENT_V2_STATE_UNSUPPORTED');
 demand(SOURCE_KEYS.every(k=>SHA.test(consent.sourceEvidenceDigests?.[k]||'')&&
  consent.sourceEvidenceDigests[k]===manifest[k]?.sha256),'PREVIEW_CONSENT_V2_SOURCE_EVIDENCE_CHANGED');
 demand(assessment?.schema==='private-quality-assessment-60-v1'&&assessment.scope?.bookId===subject.bookId&&
  same(assessment.scope.sourceRange,subject.range)&&assessment.artifact?.sha256===subject.artifactSha256&&
  assessment.conclusion?.sourceQAComplete===false&&assessment.conclusion?.all60Passed===false&&
  assessment.conclusion?.readerComplete===false&&assessment.conclusion?.iphoneConfirmed===false&&
  assessment.conclusion?.releaseApproved===false,'PREVIEW_CONSENT_V2_ASSESSMENT_MISMATCH');
 demand(assessment.notPerformed?.browser24Conditions==='not_run'&&assessment.notPerformed?.iphoneChrome==='not_run',
  'PREVIEW_CONSENT_V2_UNPERFORMED_STATE_MISMATCH');
 demand(Array.isArray(rules)&&rules.length===60&&Array.isArray(assessment.checks)&&
  same(assessment.checks.map(x=>x.id).sort(),rules.slice().sort())&&
  assessment.checks.every(x=>['passed','not_run','failed','needs_source_review','not_applicable'].includes(x.status)),
  'PREVIEW_CONSENT_V2_EXACT_ASSESSMENT_60_REQUIRED');
 const counts={};for(const c of assessment.checks)counts[c.status]=(counts[c.status]||0)+1;
 demand(same(counts,assessment.statusCounts),'PREVIEW_CONSENT_V2_ASSESSMENT_COUNTS_MISMATCH');
 return {schema:consent.schema,explicit:true,reviewState:consent.reviewState,
  conversationEvidenceSha256:consent.conversationEvidence.sha256,
  assessmentSha256:consent.assessmentEvidence.sha256,assessmentStatusCounts:counts,
  unresolvedAssessmentIds:assessment.checks.filter(x=>['failed','needs_source_review'].includes(x.status)).map(x=>x.id),
  canonicalGateCertified:false,contentCertified:false,deviceVerified:false};
}
// Separate protocol for a reviewed but incomplete canonical. V2's exact
// independent-two-transcription / not-run state contract is unchanged.
function validateV3(consent,{subject,manifest,conversation,assessment,rules,scoped}){
 const keys=require('./reader-scoped-review.cjs').SOURCE_KEYS;
 demand(consent?.schema==='reader-preview-consent-v3','PREVIEW_CONSENT_V3_SCHEMA');
 demand(consent.explicit===true&&consent.confirmedByUser===true&&consent.requestedBy==='user'&&
  consent.acceptanceKind==='direct_reply_to_artifact_disclosure'&&consent.previewOnly===true&&
  consent.normalReleaseAuthorized===false&&consent.acknowledgesScopedIncompleteReview===true,
  'PREVIEW_CONSENT_V3_EXPLICIT_ACCEPTANCE_REQUIRED');
 demand(consent.bookId===subject.bookId&&same(consent.range,subject.range)&&
  consent.artifactSha256===subject.artifactSha256&&consent.loaderSha256===subject.loaderSha256&&
  SHA.test(consent.artifactSha256||'')&&SHA.test(consent.loaderSha256||''),'PREVIEW_CONSENT_V3_IDENTITY_MISMATCH');
 demand(conversation?.schema==='preview-conversation-acceptance-evidence-v2'&&
  conversation.bookId===subject.bookId&&same(conversation.range,subject.range)&&
  conversation.artifact?.sha256===subject.artifactSha256&&conversation.loader?.sha256===subject.loaderSha256&&
  conversation.normalReleaseAuthorizedByThisReply===false,'PREVIEW_CONVERSATION_V3_IDENTITY_MISMATCH');
 const d=conversation.assistantDisclosure;
 demand(affirmativeReply(conversation.userReplyExact)&&consent.requestText===conversation.userReplyExact&&
  typeof conversation.acceptanceBasis==='string'&&conversation.acceptanceBasis.length>=12&&
  typeof d?.exactQuestion==='string'&&d.exactQuestion.length>=8&&typeof d.visibleIdentity==='string'&&
  Array.isArray(d.disclosedRemainingChecks)&&d.disclosedRemainingChecks.length>0&&
  d.disclosedRemainingChecks.every(x=>typeof x==='string'&&x.length>0)&&consent.disclosureSha256===digest(d),
  'PREVIEW_CONSENT_V3_DISCLOSURE_REPLY_MISMATCH');
 demand(d.visibleIdentity.includes(subject.artifactSha256.slice(0,12))&&
  new RegExp('(?<![0-9])'+String(subject.range[0])+'\\s*(?:〜|～|–|-|—|to)\\s*'+String(subject.range[1])+'(?![0-9])').test(d.visibleIdentity),
  'PREVIEW_CONSENT_V3_VISIBLE_TARGET_MISMATCH');
 demand(consent.recordedAt===conversation.recordedAtUTC&&Number.isFinite(Date.parse(consent.recordedAt||''))&&
  consent.timestampMeaning===conversation.timestampMeaning&&typeof consent.timestampMeaning==='string'&&consent.timestampMeaning.length>=12,
  'PREVIEW_CONSENT_V3_RECORD_TIME_REQUIRED');
 demand(scoped?.source?.state==='reviewed_partial_canonical'&&scoped.source.fullIndependentSecondTranscription===false&&
  same(consent.reviewState,scoped.reviewState)&&same(d.disclosedState,scoped.reviewState)&&
  same(d.disclosedSourceScope,scoped.source)&&same(d.disclosedDisplayState,scoped.display),
  'PREVIEW_CONSENT_V3_STATE_OR_SCOPE_MISMATCH');
 demand(keys.every(k=>SHA.test(consent.sourceEvidenceDigests?.[k]||'')&&
  consent.sourceEvidenceDigests[k]===manifest[k]?.sha256),'PREVIEW_CONSENT_V3_SOURCE_EVIDENCE_CHANGED');
 demand(assessment?.schema==='private-quality-assessment-60-v1'&&assessment.scope?.bookId===subject.bookId&&
  same(assessment.scope.sourceRange,subject.range)&&assessment.artifact?.sha256===subject.artifactSha256&&
  ['sourceQAComplete','all60Passed','readerComplete','iphoneConfirmed','releaseApproved'].every(k=>assessment.conclusion?.[k]===false)&&
  consent.assessmentEvidence?.sha256===manifest.assessment?.sha256&&
  d.disclosedAssessmentSha256===manifest.assessment?.sha256&&same(d.disclosedAssessmentCounts,scoped.assessment.statusCounts),
  'PREVIEW_CONSENT_V3_ASSESSMENT_MISMATCH');
 demand(Array.isArray(rules)&&rules.length===60&&Array.isArray(assessment.checks)&&
  same(assessment.checks.map(x=>x.id).sort(),rules.slice().sort()),'PREVIEW_CONSENT_V3_EXACT_ASSESSMENT_60_REQUIRED');
 return {schema:consent.schema,explicit:true,reviewState:scoped.reviewState,reviewScope:scoped.source,displayState:scoped.display,
  conversationEvidenceSha256:consent.conversationEvidence.sha256,assessmentSha256:consent.assessmentEvidence.sha256,
  assessmentStatusCounts:scoped.assessment.statusCounts,unresolvedAssessmentIds:scoped.assessment.unresolvedIds,
  canonicalGateCertified:false,contentCertified:false,deviceVerified:false};
}
module.exports={SOURCE_KEYS,STATES,digest,affirmativeReply,validateV2,validateV3};
