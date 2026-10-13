#!/usr/bin/env python3
"""Safely reconcile access to one pinned, source-free MegaGoldenClub release.

No source checkout, PM2 action, Apache action or datastore changes. Validate
the complete release tree before changing any metadata. Only root-owned
regular files/directories within the exact approved SHA tree are touched.
Symlinks are never modified or followed; they must resolve inside the tree.
"""
from __future__ import annotations
import grp
import os
from pathlib import Path
import re
import stat
import sys

BASE = Path("/opt/megagoldenclub")
EXPECTED_SERVICE_GROUP = "megagoldenclub"
EXPECTED_PROGRAMS = ("api/dist/main.js", "admin/server.js", "member/server.js")
MAX_MEMBERS = 250000


def stop(message: str) -> None:
    raise RuntimeError("STOP: " + message)


def reconcile_runtime(
    release: Path,
    sha: str,
    gid: int,
    *,
    base: Path = BASE,
    expected_uid: int = 0,
) -> tuple[int, int]:
    """Only metadata changes on approved tree; CI tests with disposable paths."""
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        stop("invalid pinned compiled release SHA")
    if not isinstance(gid, int) or gid < 0:
        stop("invalid dedicated service group")
    base = Path(base)
    release = Path(release)
    if release != base / "releases" / sha:
        stop("release path is not the exact approved dedicated SHA")

    # Validate all ancestors inside our dedicated location without following
    # links. Do not chmod /opt or any other hosting application directory.
    dedicated_parents = (base, base / "releases")
    for directory in (*dedicated_parents, release):
        info = directory.lstat()
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            stop("dedicated release boundary is not a real directory")
        if info.st_uid != expected_uid or info.st_gid not in (0, gid):
            stop("dedicated release boundary has unexpected ownership")
        if info.st_mode & (stat.S_IWGRP | stat.S_IWOTH | stat.S_ISUID |
                           stat.S_ISGID | stat.S_ISVTX):
            stop("dedicated release directory has unsafe mode")
    release_sha = release / "RELEASE_SHA"
    if not stat.S_ISREG(release_sha.lstat().st_mode):
        stop("release marker is not a regular file")
    if release_sha.read_text(encoding="ascii").strip() != sha:
        stop("release marker mismatches pinned artifact")
    for relative in EXPECTED_PROGRAMS:
        file = release / relative
        if not stat.S_ISREG(file.lstat().st_mode):
            stop("compiled entrypoint missing or not a regular file")

    # Audit first, normalize second. Not a generic recursive chmod; we only
    # grant read/traverse to the dedicated service GROUP on immutable runtime.
    entries: list[tuple[Path, os.stat_result]] = []
    count = 0
    for root, dirs, files in os.walk(release, topdown=True, followlinks=False):
        root_path = Path(root)
        for name in dirs + files:
            path = root_path / name
            info = path.lstat()
            count += 1
            if count > MAX_MEMBERS:
                stop("runtime contains too many filesystem entries")
            if stat.S_ISLNK(info.st_mode):
                # Require the fully-resolved destination to stay within the
                # reviewed release; symlinks themselves are never chmodded.
                try:
                    destination = path.resolve(strict=True)
                except (OSError, RuntimeError):
                    stop("broken or cyclic runtime symlink")
                if not destination.is_relative_to(release):
                    stop("runtime symlink escapes pinned release tree")
                continue
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                stop("unexpected special filesystem entry in runtime")
            if info.st_uid != expected_uid or info.st_gid not in (0, gid):
                stop("unexpected runtime owner/group; refusing mutation")
            if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                stop("hardlinked runtime file; refusing mutation")
            if info.st_mode & (stat.S_IWGRP | stat.S_IWOTH | stat.S_ISUID |
                               stat.S_ISGID | stat.S_ISVTX):
                stop("unsafe writable or special runtime file mode")
            entries.append((path, info))

    # Parent directories may be world-traversable from previous staged
    # attempts. Leave existing web-facing parent permissions unchanged;
    # only supply dedicated group traversal if not already present.
    for directory in dedicated_parents:
        info = directory.lstat()
        current = stat.S_IMODE(info.st_mode)
        os.chown(directory, -1, gid, follow_symlinks=False)
        os.chmod(directory, (current | stat.S_IRGRP | stat.S_IXGRP)
                 & ~(stat.S_IWGRP | stat.S_IWOTH))

    # Parent release and every nested directory/file become accessible to the
    # dedicated group; nothing gets group write or broader world access.
    release_info = release.lstat()
    entries.insert(0, (release, release_info))
    directories = 0
    files = 0
    for path, info in entries:
        os.chown(path, -1, gid, follow_symlinks=False)
        if stat.S_ISDIR(info.st_mode):
            new_mode = 0o750
            directories += 1
        else:
            new_mode = 0o640 | (0o110 if info.st_mode & stat.S_IXUSR else 0)
            files += 1
        os.chmod(path, new_mode, follow_symlinks=False)

    return directories, files


def main():
    if os.geteuid() != 0 or len(sys.argv) != 2:
        stop("reconcile-staged-runtime.py must run as root with only pinned SHA")
    sha = sys.argv[1]
    group_id = grp.getgrnam(EXPECTED_SERVICE_GROUP).gr_gid
    release = BASE / "releases" / sha
    dirs, files = reconcile_runtime(release, sha, group_id)
    print("Validated pinned source-free runtime tree: PASS")
    print(f"Dedicated-only traversal/read access: PASS ({dirs} directories, {files} files)")
    print("Existing applications, root PM2 and databases: UNTOUCHED")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError, UnicodeError) as error:
        print("STOP: dedicated runtime reconciliation failed: " + str(error),
              file=sys.stderr)
        sys.exit(1)
