"""Synthetic-only regressions for the private source discovery gate."""
import importlib.util
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
if __name__=='__main__':unittest.main()
