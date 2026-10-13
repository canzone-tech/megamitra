#!/usr/bin/env python3
"""Stage only a SHA-verified source-free CI runtime. Never start applications."""
import hashlib
import io
import os
from pathlib import Path
import re
import shutil
import sys
import tarfile
import tempfile
import zipfile

ARCHIVE = "megagoldenclub-runtime.tar.gz"
CHECKSUM = ARCHIVE + ".sha256"
RELEASE_ROOT = Path("/opt/megagoldenclub/releases")
ALLOWED = {"RELEASE_SHA", "api", "admin", "member"}


def verify_and_stage(zip_file: Path, sha: str, releases: Path = RELEASE_ROOT) -> Path:
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise RuntimeError("Invalid immutable release identity")
    zip_file = Path(zip_file)
    if not zip_file.is_file() or zip_file.is_symlink():
        raise RuntimeError("Artifact ZIP must be a regular file, not a symlink")
    if releases.exists() and (releases.is_symlink() or not releases.is_dir()):
        raise RuntimeError("Release directory identity invalid")
    releases.mkdir(parents=True, exist_ok=True, mode=0o755)
    if releases.is_symlink():
        raise RuntimeError("Release directory is a symlink")
    target = releases / sha
    if target.exists() or target.is_symlink():
        raise RuntimeError("Release already staged; refusing overwrite")

    staging = Path(tempfile.mkdtemp(prefix=".staging-" + sha[:8] + "-", dir=releases))
    try:
        with zipfile.ZipFile(zip_file) as z:
            if sorted(z.namelist()) != sorted([ARCHIVE, CHECKSUM]):
                raise RuntimeError("Unexpected files in authenticated CI artifact ZIP")
            if z.getinfo(CHECKSUM).file_size > 256:
                raise RuntimeError("Unexpected checksum metadata size")
            expected = z.read(CHECKSUM).decode("ascii").strip()
            match = re.fullmatch(r"([0-9a-f]{64})  " + re.escape(ARCHIVE), expected)
            if not match:
                raise RuntimeError("Malformed CI artifact checksum")
            if z.getinfo(ARCHIVE).file_size > 800_000_000:
                raise RuntimeError("Runtime archive exceeds reviewed size bound")
            archive_file = staging / ".runtime.tar.gz"
            digest = hashlib.sha256()
            with z.open(ARCHIVE) as source, archive_file.open("xb") as sink:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
                    sink.write(chunk)
            if digest.hexdigest() != match.group(1):
                raise RuntimeError("Runtime tar SHA256 does not match CI checksum")
        with tarfile.open(archive_file, "r:gz") as t:
            members = t.getmembers()
            if len(members) > 100_000:
                raise RuntimeError("Unexpected number of runtime archive members")
            for member in members:
                name = member.name.removeprefix("./")
                parts = Path(name).parts
                if name not in {"", "."} and (not parts or parts[0] not in ALLOWED):
                    raise RuntimeError("Unexpected top-level runtime path")
                if member.isdev() or member.isfifo():
                    raise RuntimeError("Special files forbidden in runtime")
                if name and (Path(name).is_absolute() or ".." in parts):
                    raise RuntimeError("Unsafe path in runtime archive")
                if member.size > 800_000_000:
                    raise RuntimeError("Unexpected runtime member size")
            # Python 3.12+ 'data' filter prevents path/symlink traversal and
            # strips risky ownership/permissions from tar members.
            t.extractall(staging, filter="data")
        archive_file.unlink()
        actual = (staging / "RELEASE_SHA").read_text(encoding="ascii").strip()
        if actual != sha:
            raise RuntimeError("Embedded RELEASE_SHA does not match approved CI commit")
        for relative in ["api/dist/main.js", "api/node_modules",
                         "admin/server.js", "member/server.js"]:
            if not (staging / relative).exists():
                raise RuntimeError("Required compiled runtime entry missing: " + relative)
        for dirpath, folders, files in os.walk(staging, followlinks=False):
            for filename in folders + files:
                p = Path(dirpath) / filename
                rel = p.relative_to(staging)
                parts = rel.parts
                if ".git" in parts or filename == "docker-compose.yml":
                    raise RuntimeError("Source/Compose metadata forbidden in runtime")
                if "node_modules" not in parts and (
                    filename.endswith((".ts", ".tsx", ".prisma", ".env", ".map"))
                    or filename == "migration.sql" or filename.startswith(".env.")
                ):
                    raise RuntimeError("Original source or secrets forbidden in runtime")
        # Keep immutable runtime tree root-owned, readable by unprivileged PM2.
        staging.chmod(0o755)
        staging.rename(target)
        return target
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise


if __name__ == "__main__":
    try:
        if os.geteuid() != 0 or len(sys.argv) != 3:
            raise RuntimeError("Run as root: stage-runtime.py /root/<artifact>.zip <40-char-sha>")
        result = verify_and_stage(Path(sys.argv[1]), sys.argv[2])
        print("CI artifact ZIP and SHA256 checksum: PASS")
        print("Embedded release SHA and compiled entrypoints: PASS")
        print("Source-free runtime staged: " + str(result))
        print("RUNTIME STAGING: PASS (applications NOT STARTED)")
    except Exception as e:
        print("STOP: Runtime staging failed: " + str(e), file=sys.stderr)
        sys.exit(1)
