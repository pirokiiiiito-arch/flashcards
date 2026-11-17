#!/usr/bin/env python3
"""Read-only PRIVATE scan-book source discovery + ZIP identity gate.

Drive search results are hints, never proof of absence. A caller must collect
a direct folder listing with a connector and download the original archive
to a private workspace. This tool never queries Drive, changes source bytes,
or certifies OCR, the canonical 60 rules, deployment or iPhone behavior.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import pathlib
import sys
import zipfile
from typing import Any

SCHEMA = 'reader-source-discovery-input-v1'
REPORT_SCHEMA = 'reader-source-preflight-v1'
ZIP_MIME = {'application/zip','application/x-zip-compressed','application/x-zip','application/octet-stream'}
IMAGE_EXT = {'.jpg','.jpeg','.png'}

def sha256_file(path: pathlib.Path) -> str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        while block:=f.read(1024*1024): h.update(block)
    return h.hexdigest()

def norm_id(file_id: Any) -> str:
    """Accept native Google IDs and the mounted Files external-gdrive IDs."""
    if not isinstance(file_id,str): return ''
    if file_id.startswith('external-gdrive:'):
        parts=file_id.rsplit(':',2)
        return parts[-1] if len(parts)==3 and parts[-2] in ('file','folder') else ''
    return file_id

def candidate(record: Any) -> dict | None:
    if not isinstance(record,dict):return None
    raw_id=record.get('id') or record.get('file_id') or record.get('fileId') or ''
    name=record.get('name') or record.get('title') or ''
    mime=record.get('mime_type') or record.get('mimeType') or ''
    if not isinstance(name,str) or not isinstance(mime,str):return None
    return {'id':norm_id(raw_id),'name':name,'mime':mime}

def process(snapshot: dict, archive_path: pathlib.Path | None) -> dict:
    errors=[];warnings=[];steps=[]
    def error(s):
        if s not in errors:errors.append(s)
    def warning(s):
        if s not in warnings:warnings.append(s)
    def step(s):
        if s not in steps:steps.append(s)
    if not isinstance(snapshot,dict) or snapshot.get('schema')!=SCHEMA:
        return {'schema':REPORT_SCHEMA,'status':'blocked','errors':['WRONG_INPUT_SCHEMA'],
                'warnings':[],'checks':[],'canonical60Certified':False,
                'requestReupload':False,'releaseEligible':False}
    book_id=snapshot.get('bookId')
    book_range=snapshot.get('range')
    exp=snapshot.get('expected') or {}
    listing=snapshot.get('folderListing') or {}
    lookups=snapshot.get('lookups') or {}
    searches=lookups.get('searches') or []
    if not isinstance(book_id,str) or len(book_id)<3:error('BOOK_ID_REQUIRED')
    if (not isinstance(book_range,list) or len(book_range)!=2 or
            not all(isinstance(i,int) and not isinstance(i,bool) for i in book_range) or
            book_range[0]<1 or book_range[1]<book_range[0] or book_range[1]-book_range[0]>500):
        error('BAD_SCAN_RANGE')
        book_range=[0,-1]
    if not isinstance(exp,dict):
        exp={};error('EXPECTED_SOURCE_RECORD_INVALID')
    file_id=norm_id(exp.get('fileId'))
    folder_id=norm_id(exp.get('folderId'))
    source_name=exp.get('fileName') or ''
    source_hash=exp.get('sha256') or ''
    total=exp.get('imageCount')
    if not file_id and not source_name:error('FILE_ID_OR_EXACT_SOURCE_NAME_REQUIRED')
    if not folder_id:error('EXPECTED_FOLDER_ID_REQUIRED')
    if not isinstance(total,int) or isinstance(total,bool) or total < book_range[1]:error('IMAGE_COUNT_EXPECTATION_REQUIRED')
    if not isinstance(source_hash,str) or len(source_hash)!=64 or any(c not in '0123456789abcdef' for c in source_hash):
        error('INDEPENDENTLY_RECORDED_SOURCE_HASH_REQUIRED')
    # A failed search is not an absence finding.
    if isinstance(searches,list) and any(isinstance(q,dict) and q.get('resultCount')==0 for q in searches):
        warning('SEARCH_ZERO_IS_NOT_SOURCE_ABSENCE')
    step('SEARCH_HINTS_NON_AUTHORITATIVE')
    by_id=lookups.get('byId') or {}
    if isinstance(by_id,dict) and by_id.get('attempted'):
        step('EXACT_ID_LOOKUP_ATTEMPTED')
        if not by_id.get('found'):warning('KNOWN_ID_LOOKUP_NOT_FOUND_OR_UNAVAILABLE')
        elif file_id and norm_id((candidate(by_id.get('item')) or {}).get('id'))!=file_id:
            error('EXACT_ID_LOOKUP_CONFLICT')
    if listing.get('attempted') is not True:
        error('DIRECT_FOLDER_LISTING_NOT_PERFORMED')
    if listing.get('complete') is not True:
        error('DIRECT_FOLDER_LISTING_INCOMPLETE')
    if folder_id and norm_id(listing.get('folderId'))!=folder_id:
        error('DIRECT_FOLDER_ID_MISMATCH')
    items=listing.get('files')
    if not isinstance(items,list):
        error('DIRECT_FOLDER_FILES_MISSING');items=[]
    step('DIRECT_FOLDER_LISTING_CHECKED')
    normalized=[c for r in items if (c:=candidate(r)) is not None]
    # Never replace a pinned ID with an identically named but different file.
    matches=[c for c in normalized if (c['id']==file_id if file_id else c['name']==source_name)]
    if len(matches)==0:
        error('SOURCE_NOT_IN_EXPECTED_FOLDER')
    elif len(matches)>1:
        error('AMBIGUOUS_SOURCE_DUPLICATE')
    selected=matches[0] if len(matches)==1 else None
    if selected:
        if file_id and selected['id']!=file_id:error('SOURCE_ID_MISMATCH')
        if source_name and selected['name']!=source_name:error('SOURCE_NAME_MISMATCH')
        if not (selected['name'].lower().endswith('.zip') and selected['mime'] in ZIP_MIME):
            error('SOURCE_ZIP_NAME_OR_MIME_UNEXPECTED')
        step('EXACT_FOLDER_ENTRY_MATCHED')

    archive_sha=None
    count=None
    image_manifest=[]
    if archive_path is None or not archive_path.is_file():
        error('PRIVATE_SOURCE_BYTES_NOT_ACQUIRED')
    else:
        archive_sha=sha256_file(archive_path)
        if archive_sha!=source_hash:error('SOURCE_ARCHIVE_SHA256_MISMATCH')
        else:step('SOURCE_ARCHIVE_HASH_MATCHED')
        if not zipfile.is_zipfile(archive_path):error('INVALID_SOURCE_ZIP_SIGNATURE')
        else:
            try:
                with zipfile.ZipFile(archive_path,'r') as z:
                    bad=z.testzip()
                    if bad is not None:error('ZIP_MEMBER_CRC_INVALID')
                    seen=set();infos=[]
                    for info in z.infolist():
                        if info.is_dir():continue
                        n=info.filename.replace('\\','/')
                        ps=pathlib.PurePosixPath(n)
                        if n.startswith('/') or '..' in ps.parts or '.' in ps.parts:
                            error('UNSAFE_ZIP_ENTRY_PATH')
                        if n in seen:error('DUPLICATE_ZIP_ENTRY')
                        seen.add(n)
                        if ps.suffix.lower() in IMAGE_EXT:infos.append(info)
                    count=len(infos)
                    if count!=total:error('SOURCE_IMAGE_COUNT_MISMATCH')
                    start,end=book_range
                    if start>0 and end <= len(infos):
                        for number,info in enumerate(infos[start-1:end],start):
                            h=hashlib.sha256()
                            with z.open(info,'r') as f:
                                while b:=f.read(1024*1024):h.update(b)
                            image_manifest.append({'scan':number,'sha256':h.hexdigest(),
                                'bytes':info.file_size,
                                'entryNameSha256':hashlib.sha256(info.filename.encode('utf-8')).hexdigest()})
                        step('ORDERED_SOURCE_RANGE_HASHED')
                    else:error('REQUIRED_SCAN_RANGE_MISSING')
                    expected_images=exp.get('imageSha256')
                    if expected_images is not None:
                        if not isinstance(expected_images,dict):error('EXPECTED_IMAGE_HASHES_INVALID')
                        else:
                            for item in image_manifest:
                                if item['sha256']!=expected_images.get(str(item['scan'])):
                                    error('PINNED_PAGE_SHA256_MISMATCH')
            except (OSError,zipfile.BadZipFile,RuntimeError,EOFError,ValueError) as exc:
                error('SOURCE_ZIP_READ_FAILURE_'+type(exc).__name__)
    # A direct-listing miss is still 'unresolved', never proof the file does not exist.
    status=('source_ready_for_ocr' if not errors else
            'blocked' if any(x in errors for x in (
                'SOURCE_ARCHIVE_SHA256_MISMATCH','SOURCE_IMAGE_COUNT_MISMATCH',
                'PINNED_PAGE_SHA256_MISMATCH','INVALID_SOURCE_ZIP_SIGNATURE',
                'UNSAFE_ZIP_ENTRY_PATH','DUPLICATE_ZIP_ENTRY','ZIP_MEMBER_CRC_INVALID'))
            else 'unresolved')
    return {'schema':REPORT_SCHEMA,'status':status,'bookId':book_id,'range':book_range,
        'sourceArchiveSha256':archive_sha,
        'sourceArchiveSha256MatchesPinned':archive_sha==source_hash,
        'originalImageCount':count,'rangeImages':image_manifest,
        'folderListingComplete':listing.get('complete') is True,
        'matchedPinnedFileId':bool(selected and file_id and selected['id']==file_id),
        'searchZeroMeansAbsent':False,'sourceGloballyAbsent':False,
        'canonical60Certified':False,'independentOCRProofreading':'not_run',
        'iphoneDevice':'not_run','requestReupload':False,
        'releaseEligible':False,'checks':steps,'errors':errors,'warnings':warnings}

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--snapshot',required=True,help='PRIVATE connector metadata JSON; never commit')
    p.add_argument('--archive',required=True,help='PRIVATE byte-identical downloaded ZIP')
    p.add_argument('--report',required=True,help='PRIVATE verification report JSON')
    args=p.parse_args(argv)
    try:
        snapshot=json.loads(pathlib.Path(args.snapshot).read_text(encoding='utf-8'))
        result=process(snapshot,pathlib.Path(args.archive))
        dest=pathlib.Path(args.report)
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        # Do not print Google IDs, title, ZIP path, entry names, or OCR.
        print(json.dumps({k:result[k] for k in ('schema','status','range','originalImageCount',
              'folderListingComplete','sourceArchiveSha256MatchesPinned',
              'requestReupload','canonical60Certified','errors','warnings')},ensure_ascii=False))
        return 0 if result['status']=='source_ready_for_ocr' else 1
    except Exception as exc:
        print('SOURCE_PREFLIGHT_ERROR '+type(exc).__name__,file=sys.stderr)
        return 2
if __name__=='__main__':sys.exit(main())
