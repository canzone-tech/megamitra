#!/usr/bin/env python3
"""No external secrets or VPS operations: synthetic source-free fixtures."""
import hashlib
from importlib.machinery import SourceFileLoader
import io
from pathlib import Path
import tarfile
import tempfile
import zipfile

src = Path(__file__).resolve().parents[1] / "infra/ubuntu-vps/stage-runtime.py"
module = SourceFileLoader("runtime_stager", str(src)).load_module()
SHA = "b" * 40


def make_zip(path, *, invalid_sha=False, malicious=False):
    tar_bytes = io.BytesIO()
    with tarfile.open(fileobj=tar_bytes, mode="w:gz") as tar:
        for name, data in [
            ("RELEASE_SHA", (("a" * 40 if invalid_sha else SHA) + "\n").encode()),
            ("api/dist/main.js", b"console.log('ci')"),
            ("api/node_modules/.keep", b"safe"),
            ("admin/server.js", b"console.log('admin')"),
            ("member/server.js", b"console.log('member')"),
        ]:
            member = tarfile.TarInfo(name)
            member.size = len(data)
            tar.addfile(member, io.BytesIO(data))
        if malicious:
            extra = tarfile.TarInfo("../../escaped")
            extra.size = 1
            tar.addfile(extra, io.BytesIO(b"!"))
    b = tar_bytes.getvalue()
    checksum = (hashlib.sha256(b).hexdigest() + "  megagoldenclub-runtime.tar.gz\n").encode()
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("megagoldenclub-runtime.tar.gz", b)
        z.writestr("megagoldenclub-runtime.tar.gz.sha256", checksum)


with tempfile.TemporaryDirectory(prefix="megagoldenclub-runtime-ci-") as temp:
    temp = Path(temp)
    path = temp / "artifact.zip"
    releases = temp / "releases"
    make_zip(path)
    stage = module.verify_and_stage(path, SHA, releases)
    assert (stage / "RELEASE_SHA").read_text().strip() == SHA
    assert (stage / "api/dist/main.js").exists()
    try:
        module.verify_and_stage(path, SHA, releases)
    except RuntimeError as e:
        assert "already staged" in str(e)
    else:
        raise AssertionError("Release overwrite must fail")
    make_zip(path, invalid_sha=True)
    try:
        module.verify_and_stage(path, "c" * 40, releases)
    except RuntimeError as e:
        assert "Embedded RELEASE_SHA" in str(e)
    else:
        raise AssertionError("Tampered commit must fail")
    make_zip(path, malicious=True)
    try:
        module.verify_and_stage(path, "c" * 40, releases)
    except RuntimeError:
        pass
    else:
        raise AssertionError("Tar path traversal must fail")
print("Source-free runtime ZIP staging safety regression: PASS")
