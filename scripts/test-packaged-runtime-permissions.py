#!/usr/bin/env python3
"""CI: extract the EXACT compiled runtime archive with the production filter.

Then exercise the dedicated service-group reconciliation against all shipped
files, including native binaries, Next.js bundles and npm symlinks. This catches
issues fixtures alone can miss before any VPS deployment instruction is issued.
"""
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tarfile
import tempfile

if len(sys.argv) != 3:
    raise SystemExit("Usage: test-packaged-runtime-permissions.py <archive.tar.gz> <sha>")
archive = Path(sys.argv[1])
sha = sys.argv[2]
assert archive.is_file(), "CI packaged runtime archive is missing"

code = Path(__file__).resolve().parents[1] / "infra/ubuntu-vps/reconcile-staged-runtime.py"
spec = importlib.util.spec_from_file_location("mgc_reconciler", code)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory(prefix="megagoldenclub-real-runtime-ci-") as t:
    base = Path(t) / "megagoldenclub"
    target = base / "releases" / sha
    target.mkdir(parents=True, mode=0o700)
    with tarfile.open(archive, "r:gz") as tar:
        tar.extractall(target, filter="data")
    assert (target / "RELEASE_SHA").read_text().strip() == sha
    # Simulate a root-private staging boundary despite a permissive tar.
    for directory in (base, base / "releases", target):
        directory.chmod(0o700)

    directory_count, file_count = module.reconcile_runtime(
        target, sha, os.getgid(), base=base, expected_uid=os.getuid()
    )
    assert directory_count > 20 and file_count > 100
    for relative in ("api/dist/main.js", "admin/server.js", "member/server.js"):
        program = target / relative
        assert program.is_file() and program.stat().st_mode & stat.S_IRGRP
        for ancestor in (program.parent, *program.parents):
            if ancestor == base.parent:
                break
            assert ancestor.stat().st_mode & stat.S_IXGRP, str(ancestor)
    module.reconcile_runtime(target, sha, os.getgid(),
                             base=base, expected_uid=os.getuid())
    print(f"Exact production archive nested group access: PASS ({directory_count} dirs, {file_count} files)")
