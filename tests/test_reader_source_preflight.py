"""Synthetic-only regressions for the private source discovery gate."""
import importlib.util
import copy
import hashlib
import pathlib
import tempfile
import unittest
import zipfile

MODULE = pathlib.Path(__file__).parents[1]/'tools'/'reader-source-preflight.py'
spec=importlib.util.spec_from_file_location('reader_source_preflight',MODULE)
sp=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sp)

def snapshot(path,mime='application/x-zip-compressed'):
    return {'schema':'reader-source-discovery-input-v1','bookId':'sample-novel',
        'range':[41,60],
        'expected':{'folderId':'folder-abc','fileId':'file-abc',
                    'fileName':'scan-book.zip','sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                    'imageCount':65},
        'lookups':{'searches':[{'query':'scan-book','resultCount':0}],
            'byId':{'attempted':True,'found':True,'item':{'id':'file-abc'}}},
        'folderListing':{'attempted':True,'complete':True,'folderId':'folder-abc',
            'files':[{'id':'file-abc','name':'scan-book.zip','mimeType':mime}]}}
class SourcePreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.zip=pathlib.Path(self.tmp.name)/'source.zip'
        with zipfile.ZipFile(self.zip,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for n in range(1,66):z.writestr(f'originals/{n:03}.jpg',f'SYNTHETIC-ONLY-{n}'.encode())
        self.meta=snapshot(self.zip)
    def run_audit(self):return sp.process(self.meta,self.zip)
    def test_zero_search_and_zip_mime_alias_are_not_missing(self):
        r=self.run_audit()
        self.assertEqual(r['status'],'source_ready_for_ocr',r['errors'])
        self.assertEqual(r['originalImageCount'],65)
        self.assertEqual([x['scan'] for x in r['rangeImages']],list(range(41,61)))
        self.assertIn('SEARCH_ZERO_IS_NOT_SOURCE_ABSENCE',r['warnings'])
        self.assertFalse(r['sourceGloballyAbsent'])
        self.assertFalse(r['requestReupload'])
        self.assertFalse(r['canonical60Certified'])
        self.assertFalse(r['releaseEligible'])
    def test_mounted_files_id_alias(self):
        self.meta['folderListing']['files'][0]['id']='external-gdrive:account:123:file:file-abc'
        self.meta['folderListing']['folderId']='external-gdrive:account:123:folder:folder-abc'
        self.assertEqual(self.run_audit()['status'],'source_ready_for_ocr')
    def test_incomplete_folder_listing_blocks_finding(self):
        self.meta['folderListing']['complete']=False
        r=self.run_audit();self.assertEqual(r['status'],'unresolved')
        self.assertIn('DIRECT_FOLDER_LISTING_INCOMPLETE',r['errors'])
        self.assertFalse(r['requestReupload'])
    def test_missing_pinned_id_not_replaced_by_same_name(self):
        self.meta['folderListing']['files'][0]['id']='different'
        r=self.run_audit();self.assertEqual(r['status'],'unresolved')
        self.assertIn('SOURCE_NOT_IN_EXPECTED_FOLDER',r['errors'])
    def test_duplicate_id_ambiguous(self):
        self.meta['folderListing']['files'].append(dict(self.meta['folderListing']['files'][0]))
        self.assertIn('AMBIGUOUS_SOURCE_DUPLICATE',self.run_audit()['errors'])
    def test_bad_source_archive_sha_blocks(self):
        self.meta['expected']['sha256']='0'*64
        r=self.run_audit();self.assertEqual(r['status'],'blocked')
        self.assertIn('SOURCE_ARCHIVE_SHA256_MISMATCH',r['errors'])
    def test_wrong_metadata_name(self):
        self.meta['folderListing']['files'][0]['name']='scan-book.jpg'
        self.assertNotEqual(self.run_audit()['status'],'source_ready_for_ocr')
    def test_wrong_range_never_invents_missing_pages(self):
        self.meta['range']=[51,70]
        self.assertIn('REQUIRED_SCAN_RANGE_MISSING',self.run_audit()['errors'])
    def test_corrupt_zip_signature_blocks(self):
        self.zip.write_bytes(self.zip.read_bytes()[:150])
        self.meta['expected']['sha256']=hashlib.sha256(self.zip.read_bytes()).hexdigest()
        self.assertIn('INVALID_SOURCE_ZIP_SIGNATURE',self.run_audit()['errors'])
    def test_individual_pinned_image_sha(self):
        self.meta['expected']['imageSha256']={'41':'0'*64}
        r=self.run_audit();self.assertIn('PINNED_PAGE_SHA256_MISMATCH',r['errors'])
        self.assertEqual(r['status'],'blocked')
    def test_metadata_mime_mismatch(self):
        self.meta['folderListing']['files'][0]['mimeType']='text/html'
        self.assertIn('SOURCE_ZIP_NAME_OR_MIME_UNEXPECTED',self.run_audit()['errors'])
    def test_missing_local_archive_is_unresolved(self):
        self.zip.unlink()
        r=self.run_audit();self.assertEqual(r['status'],'unresolved')
        self.assertFalse(r['requestReupload'])
class ExplicitMappingTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.zip=pathlib.Path(self.tmp.name)/'range.zip'
        self.images={n:f'SYNTHETIC-ORIGINAL-{n}'.encode() for n in range(20,42)}
        with zipfile.ZipFile(self.zip,'w') as archive:
            for n,raw in self.images.items():archive.writestr(f'scan_{n:03}.jpg',raw)
        self.meta={
            'schema':'reader-source-discovery-input-v1','bookId':'synthetic-range-book',
            'range':[21,40],
            'expected':{'fileId':'range-zip','folderId':'synthetic-folder',
                'fileName':'stored-range.zip','imageCount':22,
                'sha256':hashlib.sha256(self.zip.read_bytes()).hexdigest(),
                'imageSha256':{str(n):hashlib.sha256(self.images[n]).hexdigest() for n in range(21,41)}},
            'lookups':{'byId':{'attempted':True,'found':True,'item':{'id':'range-zip'}}},
            'folderListing':{'attempted':True,'complete':True,'folderId':'synthetic-folder',
                'files':[{'id':'range-zip','name':'stored-range.zip','mimeType':'application/zip'}]},
            'scanMapping':{'schema':'reader-source-scan-map-v1','archiveScanRange':[20,41],
                'entries':[{'scan':n,'entryName':f'scan_{n:03}.jpg'} for n in range(20,42)]}}

    def audit(self):return sp.process(self.meta,self.zip)
    def blocked(self,code):
        result=self.audit()
        self.assertEqual(result['status'],'blocked',result)
        self.assertIn(code,result['errors'])
        self.assertFalse(result['sourceMappingVerified'])
        self.assertFalse(result['releaseEligible'])

    def test_range_zip_keeps_real_scan_numbers_and_scope(self):
        result=self.audit()
        self.assertEqual(result['status'],'source_ready_for_ocr',result['errors'])
        self.assertEqual(result['originalImageCount'],22)
        self.assertEqual(result['archiveScanRange'],[20,41])
        self.assertEqual([x['scan'] for x in result['rangeImages']],list(range(21,41)))
        self.assertTrue(result['sourceMappingVerified'])
        self.assertTrue(result['targetPageHashesMatchedIndependentIndex'])
        self.assertEqual(result['sourceScope'],'downloaded_archive_only')
        self.assertFalse(result['upstreamArchiveBytesVerified'])
        self.assertFalse(result['canonical60Certified'])
        self.assertFalse(result['releaseEligible'])

    def test_no_mapping_preserves_legacy_ordinal_behavior(self):
        del self.meta['scanMapping']
        result=self.audit()
        self.assertIn('IMAGE_COUNT_EXPECTATION_REQUIRED',result['errors'])
        self.assertIn('REQUIRED_SCAN_RANGE_MISSING',result['errors'])
        self.assertNotIn('sourceSelectionMode',result)

    def test_null_or_unknown_mapping_never_falls_back(self):
        for value in (None,{},[],{'schema':'unknown'}):
            with self.subTest(value=value):
                self.meta['scanMapping']=value
                self.blocked('SCAN_MAPPING_SCHEMA_INVALID')

    def test_all_image_members_including_boundaries_are_required(self):
        self.meta['scanMapping']['entries'].pop(0)
        self.blocked('SCAN_MAPPING_ENTRY_COUNT_MISMATCH')

    def test_extra_mapping_entry_is_rejected(self):
        self.meta['scanMapping']['entries'].append({'scan':42,'entryName':'missing.jpg'})
        self.blocked('SCAN_MAPPING_ENTRY_COUNT_MISMATCH')

    def test_duplicate_scan_is_rejected(self):
        self.meta['scanMapping']['entries'][4]['scan']=23
        self.blocked('SCAN_MAPPING_DUPLICATE_SCAN')

    def test_duplicate_entry_name_is_rejected(self):
        self.meta['scanMapping']['entries'][4]['entryName']='scan_023.jpg'
        self.blocked('SCAN_MAPPING_DUPLICATE_ENTRY')

    def test_nonexistent_entry_name_is_rejected(self):
        self.meta['scanMapping']['entries'][0]['entryName']='scan_020.png'
        self.blocked('SCAN_MAPPING_MEMBER_SET_MISMATCH')

    def test_filename_order_must_match_actual_zip_order(self):
        entries=self.meta['scanMapping']['entries']
        entries[0]['entryName'],entries[-1]['entryName']=entries[-1]['entryName'],entries[0]['entryName']
        self.blocked('SCAN_MAPPING_MEMBER_ORDER_MISMATCH')

    def test_scan_sequence_must_be_contiguous_and_ordered(self):
        entries=self.meta['scanMapping']['entries']
        entries[0]['scan'],entries[1]['scan']=entries[1]['scan'],entries[0]['scan']
        self.blocked('SCAN_MAPPING_SCAN_SEQUENCE_MISMATCH')

    def test_outside_scan_and_target_range_are_rejected(self):
        self.meta['scanMapping']['entries'][0]['scan']=19
        self.blocked('SCAN_MAPPING_SCAN_OUTSIDE_ARCHIVE')
        self.meta['scanMapping']['entries'][0]['scan']=20
        self.meta['range']=[20,42]
        self.blocked('SCAN_MAPPING_TARGET_RANGE_OUTSIDE_ARCHIVE')

    def test_declared_archive_range_must_match_actual_image_count(self):
        self.meta['scanMapping']['archiveScanRange']=[20,42]
        self.blocked('SCAN_MAPPING_ARCHIVE_COUNT_MISMATCH')

    def test_very_large_declared_range_is_rejected_without_allocation(self):
        self.meta['scanMapping']['archiveScanRange']=[20,10**15]
        self.blocked('SCAN_MAPPING_ARCHIVE_COUNT_MISMATCH')

    def test_invalid_scan_and_entry_types_are_rejected(self):
        for field,value,code in [
            ('scan',True,'SCAN_MAPPING_SCAN_INVALID'),
            ('scan','20','SCAN_MAPPING_SCAN_INVALID'),
            ('entryName',None,'SCAN_MAPPING_ENTRY_NAME_INVALID')]:
            prior=copy.deepcopy(self.meta['scanMapping']['entries'][0])
            with self.subTest(field=field,value=value):
                self.meta['scanMapping']['entries'][0][field]=value
                self.blocked(code)
            self.meta['scanMapping']['entries'][0]=prior

    def test_independent_target_image_hashes_are_mandatory(self):
        del self.meta['expected']['imageSha256']
        self.blocked('MAPPED_SOURCE_EXACT_PINNED_PAGE_HASHES_REQUIRED')

    def test_hash_index_must_cover_exact_target_range(self):
        hashes=self.meta['expected']['imageSha256']
        old=hashes.pop('21')
        self.blocked('MAPPED_SOURCE_EXACT_PINNED_PAGE_HASHES_REQUIRED')
        hashes['21']=old;hashes['20']=hashlib.sha256(self.images[20]).hexdigest()
        self.blocked('MAPPED_SOURCE_EXACT_PINNED_PAGE_HASHES_REQUIRED')

    def test_invalid_or_changed_pinned_image_hash_blocks(self):
        self.meta['expected']['imageSha256']['27']='not-a-digest'
        self.blocked('MAPPED_SOURCE_PINNED_PAGE_HASH_INVALID')
        self.meta['expected']['imageSha256']['27']='0'*64
        self.blocked('PINNED_PAGE_SHA256_MISMATCH')

    def test_wrong_archive_identity_still_blocks(self):
        self.meta['expected']['sha256']='0'*64
        self.blocked('SOURCE_ARCHIVE_SHA256_MISMATCH')

    def test_incomplete_listing_cannot_make_mapped_archive_ready(self):
        self.meta['folderListing']['complete']=False
        result=self.audit()
        self.assertNotEqual(result['status'],'source_ready_for_ocr')
        self.assertIn('DIRECT_FOLDER_LISTING_INCOMPLETE',result['errors'])
        self.assertFalse(result['sourceMappingVerified'])

    def test_parent_metadata_does_not_certify_parent_bytes(self):
        self.meta['parentArchiveProvenance']={'metadataVerified':True,'declaredImages':528}
        result=self.audit()
        self.assertEqual(result['originalImageCount'],22)
        self.assertFalse(result['upstreamArchiveBytesVerified'])


if __name__=='__main__':unittest.main()
