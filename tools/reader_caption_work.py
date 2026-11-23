"""Bind a private production manifest's caption audit to its selected source and reader."""
import hashlib
import json
from pathlib import Path
import sys
from collections import defaultdict

from reader_caption_census import WH1_SHELF_HOSTS, audit as audit_census
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def referenced(root, ref):
    if not isinstance(ref, dict) or not isinstance(ref.get("path"), str):
        raise ValueError("CAPTION_FILE_REFERENCE_REQUIRED")
    relative = Path(ref["path"])
    if relative.is_absolute() or ".." in relative.parts or not relative.parts:
        raise ValueError("CAPTION_FILE_OUTSIDE_WORKSPACE")
    file = root / relative
    if file.resolve() != file or not file.is_file() or digest(file.read_bytes()) != ref.get("sha256"):
        raise ValueError("CAPTION_FILE_CHANGED")
    return file


def source_check(index, original, start, end):
    pages = index.get("pages", [])
    for scan in range(start, end + 1):
        rows = [p for p in pages if p.get("scan") == scan]
        if len(rows) == 1 and (not original.get(str(scan)) or (rows[0].get("source") or {}).get("sha256") != original[str(scan)]):
            yield scan


def audit(root, manifest, original, artifact_sha):
    start, end = manifest["range"]
    index_file = referenced(root, manifest.get("captionCensus"))
    index = json.loads(index_file.read_bytes())
    index_start, index_end = index["range"]
    audit_start, audit_end = min(start, index_start), max(end, index_end)
    wrong_source = set(source_check(index, original, start, end))
    bound_sources = dict(original)
    ocr_hashes = None
    if manifest.get("captionOcrOrigins"):
        receipt = json.loads(referenced(root, manifest["captionOcrOrigins"]).read_bytes())
        if (receipt.get("schema") != "reader-caption-ocr-origin-v1" or receipt.get("bookId") != manifest["bookId"]
                or receipt.get("range") != index.get("range")):
            raise ValueError("CAPTION_ORIGINAL_OCR_RECEIPT_MISMATCH")
        rows = receipt["pages"]
        ocr_hashes = {row["scan"]: row.get("rawSha256") for row in rows}
        if len(ocr_hashes) != len(rows):
            raise ValueError("CAPTION_DUPLICATE_OCR_RECEIPT_SCAN")
    readbacks = {'part': [], 'shelf': []}
    bindings = manifest.get("captionReadbacks") or {}
    archive_ref = manifest.get("captionArchive")
    archive = referenced(root, archive_ref) if archive_ref else None
    issues = defaultdict(set)
    bound_wh1 = False
    if archive:
        with zipfile.ZipFile(archive) as packed:
            edition = json.loads(packed.read("manifest.json"))
            if edition.get("bookId") != manifest["bookId"] or not (edition["range"][0] <= start <= end <= edition["range"][1]):
                raise ValueError("CAPTION_ARCHIVE_SCOPE_MISMATCH")
            bound_wh1 = edition.get("readingFlow", {}).get("format") == "wh1-bound-source-v1"
            allowed = {}
            for part in edition.get("segments") or []:
                scope = (part["start"], part["end"])
                display = part.get("display") or {}
                for role, name, expected in (("part", part["part"], part.get("sha256")),
                        ("shelf", display.get("path", part["part"]), display.get("sha256", part.get("sha256")))):
                    key = (role, scope)
                    if key in allowed or (display and part["part"] == display["path"]):
                        raise ValueError("CAPTION_AMBIGUOUS_READING_MEMBER")
                    try:
                        actual = digest(packed.read(name))
                        if expected and actual != expected:
                            raise ValueError("CAPTION_READING_MEMBER_CHANGED")
                        allowed[key] = (name, actual)
                    except (KeyError, ValueError, zipfile.BadZipFile):
                        for n in range(max(scope[0],audit_start), min(scope[1],audit_end)+1):
                            issues[n].add("CAPTION_READING_MEMBER_CHANGED")
            if not edition.get("segments"):
                name = edition.get("entry") or edition.get("engine")
                actual = digest(packed.read(name))
                allowed = {(r, tuple(edition["range"])): (name, actual) for r in ("part", "shelf")}
            if not any(actual == artifact_sha for (role, scope), (_, actual) in allowed.items()
                       if scope[0] <= start <= end <= scope[1]):
                raise ValueError("CAPTION_ARCHIVE_MISSING_ADOPTED_ARTIFACT")
            for key, source in (edition.get("originalScans") or {}).items():
                scan = int(key)
                if not audit_start <= scan <= audit_end:
                    continue
                try:
                    actual = digest(packed.read(source["path"]))
                except (KeyError, zipfile.BadZipFile):
                    wrong_source.add(scan)
                    continue
                if actual != source.get("sha256") or (start <= scan <= end and actual != original.get(key)):
                    wrong_source.add(scan)
                else:
                    bound_sources[key] = actual
    site_name = manifest.get("captionSiteRoot")
    site = (root / site_name) if isinstance(site_name, str) else None
    if site and (not site.is_dir() or not site.resolve().is_relative_to(root) or site.resolve() != site):
        raise ValueError("CAPTION_SITE_ROOT_OUTSIDE_WORKSPACE")
    for route in ("part", "shelf"):
        for ref in bindings.get(route, []):
            affected = range(start, end + 1)
            try:
                file = referenced(root, ref)
                rb = json.loads(file.read_bytes())
                scope = tuple(rb.get("range") or [])
                if len(scope) == 2 and all(type(n) == int for n in scope) and 0 < scope[0] <= scope[1]:
                    affected = range(max(scope[0],audit_start), min(scope[1],audit_end) + 1)
                if rb.get("route") != route or rb.get("bookId") != manifest["bookId"]:
                    raise ValueError("CAPTION_WRONG_BOOK_OR_ROUTE")
                if not archive:
                    if route == "shelf" or rb.get("artifactSha256") != artifact_sha:
                        raise ValueError("CAPTION_DELIVERY_ARCHIVE_REQUIRED")
                else:
                    expected_member, expected_sha = allowed[(route, scope)]
                    if rb.get("artifactSha256") != expected_sha:
                        raise ValueError("CAPTION_WRONG_ARTIFACT")
                    if route == "shelf" or rb.get("archiveSha256") or rb.get("member") or bound_wh1:
                        if rb.get("archiveSha256") != archive_ref["sha256"] or rb.get("member") != expected_member:
                            raise ValueError("CAPTION_WRONG_ARCHIVE_MEMBER")
                    if route == "shelf":
                        hosts = rb.get("hostFiles") or {}
                        required = WH1_SHELF_HOSTS if bound_wh1 else {"reader/library/read.html"}
                        if not site or not isinstance(hosts, dict) or not required.issubset(hosts):
                            raise ValueError("CAPTION_SHELF_HOST_REQUIRED")
                        for name, host_sha in hosts.items():
                            referenced(site, {"path": name, "sha256": host_sha})
                readbacks[route].append((file, rb))
            except (OSError, ValueError, KeyError, TypeError) as error:
                for scan in affected:
                    issues[scan].add("CAPTION_READBACK_BINDING_INVALID " + str(error))
    for scan in wrong_source:
        issues[scan].add("CAPTION_ADOPTED_SOURCE_MISMATCH")
    result = audit_census(index_file, book_id=manifest["bookId"], scan_range=(start, end), page_issues=issues,
                          source_hashes=bound_sources, readbacks=readbacks, ocr_hashes=ocr_hashes,
                          artifact_sha256=artifact_sha, index_sha256=manifest["captionCensus"]["sha256"])
    pages = result.get("pages", [])
    if [p.get("scan") for p in pages] != list(range(start, end + 1)):
        raise ValueError("CAPTION_CENSUS_WRONG_RESULT_SCOPE")
    return result


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = audit(Path(request["root"]).resolve(), request["manifest"], request["original"], request["artifactSha256"])
        print(json.dumps(result, ensure_ascii=False))
    except (OSError, ValueError, TypeError, KeyError) as error:
        sys.exit(str(error))
