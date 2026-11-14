"""SPDX-FileCopyrightText: 2026 MSHost contributors
SPDX-License-Identifier: AGPL-3.0-or-later
"""
import json
from pathlib import Path, PurePosixPath
import re
import subprocess

EXCLUDED = {".github/workflows/QA_keystore.jks", ".devcontainer/devcontainer.env", "local.properties"}


def validated_sources(root):
    allowed = set(json.loads((root / "branding/source-files.json").read_text(encoding="utf-8")))
    inventory = subprocess.check_output(
        ["git", "-c", f"safe.directory={root.as_posix()}", "ls-files", "-z",
         "--cached", "--others", "--exclude-standard"], cwd=root,
    ).decode("utf-8").split("\0")
    files = []
    for name in sorted(set(inventory) - {""} - EXCLUDED):
        parts = PurePosixPath(name).parts
        if name not in allowed or ".." in parts or PurePosixPath(name).is_absolute():
            raise ValueError(f"Unapproved source file: {name}")
        file = root / name
        if any((root.joinpath(*parts[:i])).is_symlink() for i in range(1, len(parts) + 1)):
            raise ValueError(f"Source symlink is forbidden: {name}")
        if not file.resolve().is_relative_to(root.resolve()):
            raise ValueError(f"Source path escapes root: {name}")
        if not file.is_file():
            continue
        if file.suffix.lower() in {".jks", ".keystore", ".pfx", ".p12", ".key", ".env"}:
            raise ValueError(f"Private configuration is forbidden: {name}")
        if re.search(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{32,}-----END [A-Z ]*PRIVATE KEY-----", file.read_bytes()):
            raise ValueError(f"Private key content is forbidden: {name}")
        files.append(name)
    return files
