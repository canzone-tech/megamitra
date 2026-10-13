#!/usr/bin/env python3
"""Fixture regression for the complete pinned source-free runtime tree."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile

source = Path(__file__).resolve().parents[1] / "infra/ubuntu-vps/reconcile-staged-runtime.py"
spec = importlib.util.spec_from_file_location("reconcile_staged_runtime", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SHA = "a" * 40
UID = os.getuid()
GID = os.getgid()


def fixture(tmp):
    base = tmp / "megagoldenclub"
    release = base / "releases" / SHA
    for directory in [
        release / "api" / "dist" / "nested",
        release / "api" / "node_modules" / ".bin",
        release / "admin" / "node_modules",
        release / "member" / ".next",
    ]:
        directory.mkdir(parents=True, exist_ok=True)
    for name in [
        "api/dist/main.js",
        "api/dist/nested/chunk.js",
        "api/node_modules/lib.node",
        "admin/server.js",
        "member/server.js",
        "member/.next/trace.json",
    ]:
        file = release / name
        file.write_text("compiled\n")
        file.chmod(0o600)
    (release / "api/node_modules/lib.node").chmod(0o700)
    (release / "api/node_modules/.bin/alias").symlink_to("../lib.node")
    (release / "RELEASE_SHA").write_text(SHA + "\n")
    (release / "RELEASE_SHA").chmod(0o600)
    for p in [base, base / "releases", release, *release.rglob("*")]:
        if p.is_dir() and not p.is_symlink():
            p.chmod(0o700)
    return base, release


def must_fail(fn, description):
    try:
        fn()
    except (RuntimeError, OSError):
        return
    raise AssertionError("Unsafe case accepted: " + description)


with tempfile.TemporaryDirectory(prefix="mgc-runtime-tree-") as t:
    base, release = fixture(Path(t))
    dirs, files = module.reconcile_runtime(release, SHA, GID, base=base, expected_uid=UID)
    assert dirs >= 10 and files >= 7, (dirs, files)
    assert stat.S_IMODE((release / "api/dist/main.js").stat().st_mode) == 0o640
    assert stat.S_IMODE((release / "api/dist/nested").stat().st_mode) == 0o750
    assert stat.S_IMODE((release / "api/node_modules/lib.node").stat().st_mode) == 0o750
    assert (release / "api/node_modules/.bin/alias").is_symlink()
    for p in [base, base / "releases", release]:
        assert p.stat().st_mode & 0o050 == 0o050
    # Normalization must be idempotent and safe to rerun on approved tree.
    module.reconcile_runtime(release, SHA, GID, base=base, expected_uid=UID)

with tempfile.TemporaryDirectory(prefix="mgc-runtime-unsafe-") as t:
    base, release = fixture(Path(t))
    bad = release / "api/dist/nested/chunk.js"
    bad.chmod(0o666)
    must_fail(lambda: module.reconcile_runtime(release, SHA, GID,
              base=base, expected_uid=UID), "world-writable runtime")
    assert stat.S_IMODE((release / "api/dist/main.js").stat().st_mode) == 0o600
    bad.chmod(0o600)
    (release / "api/dist/out").symlink_to(Path(t) / "foreign")
    (Path(t) / "foreign").write_text("untrusted")
    must_fail(lambda: module.reconcile_runtime(release, SHA, GID,
              base=base, expected_uid=UID), "external symlink")
    (release / "api/dist/out").unlink()
    os.link(bad, release / "api/dist/hardlinked.js")
    must_fail(lambda: module.reconcile_runtime(release, SHA, GID,
              base=base, expected_uid=UID), "hardlinked source")
    (release / "api/dist/hardlinked.js").unlink()
    must_fail(lambda: module.reconcile_runtime(release, SHA, GID,
              base=base, expected_uid=UID+1), "foreign owner")
    must_fail(lambda: module.reconcile_runtime(release, "b"*40, GID,
              base=base, expected_uid=UID), "wrong SHA")

print("Compiled runtime nested-file access and unsafe-entry regressions: PASS")
