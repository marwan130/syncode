import json
import os
import stat
import sys

ROOT = "/workspace"
MAX_ENTRIES = 500
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_WORKSPACE_BYTES = 32 * 1024 * 1024
BLOCKED_DIRECTORIES = {
    ".git", ".next", ".nuxt", ".venv", "__pycache__", "bin", "build",
    "coverage", "dist", "node_modules", "obj", "out", "packages", "target",
    "vendor", "venv",
}
BLOCKED_EXTENSIONS = {".class", ".dll", ".exe", ".o", ".obj", ".pdb", ".pyc", ".so"}


def validate_path(value):
    if not isinstance(value, str) or not value or len(value) > 512 or value.startswith("/") or "\\" in value:
        raise ValueError("invalid path")
    parts = value.split("/")
    if len(parts) > 32 or any(not part or part in (".", "..") for part in parts):
        raise ValueError("invalid path")
    if any(any(ord(character) < 32 or character in ':*?"<>|' for character in part) for part in parts):
        raise ValueError("invalid path")
    if any(part.lower() in BLOCKED_DIRECTORIES for part in parts) or os.path.splitext(value)[1].lower() in BLOCKED_EXTENSIONS:
        raise ValueError("invalid path")
    return value


def path_type(path):
    try:
        return os.lstat(path).st_mode
    except FileNotFoundError:
        return None


def ensure_safe_parents(relative, create):
    current = ROOT
    parts = relative.split("/")[:-1]
    for part in parts:
        current = os.path.join(current, part)
        mode = path_type(current)
        if mode is None:
            if create:
                os.mkdir(current)
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            raise ValueError("unsafe path")


def main():
    request = json.load(sys.stdin)
    entries = request.get("entries")
    previous_paths = request.get("previousPaths")
    if not isinstance(entries, list) or len(entries) > MAX_ENTRIES or not isinstance(previous_paths, list):
        raise ValueError("invalid workspace")

    snapshot = {}
    total_bytes = 0
    for entry in entries:
        if not isinstance(entry, dict):
            raise ValueError("invalid entry")
        path = validate_path(entry.get("path"))
        is_folder = entry.get("isFolder") is True
        content = entry.get("content")
        if not isinstance(content, str) or is_folder and content:
            raise ValueError("invalid entry")
        if path in snapshot:
            raise ValueError("duplicate path")
        size = len(content.encode("utf-8"))
        total_bytes += size
        if size > MAX_FILE_BYTES or total_bytes > MAX_WORKSPACE_BYTES:
            raise ValueError("workspace limit")
        snapshot[path] = (is_folder, content)

    normalized_previous = {validate_path(path) for path in previous_paths}
    stale_paths = sorted(normalized_previous - snapshot.keys(), key=lambda path: (-path.count("/"), path))
    for relative in stale_paths:
        ensure_safe_parents(relative, False)
        target = os.path.join(ROOT, *relative.split("/"))
        mode = path_type(target)
        if mode is None or stat.S_ISLNK(mode):
            continue
        if stat.S_ISREG(mode):
            os.remove(target)
        elif stat.S_ISDIR(mode):
            try:
                os.rmdir(target)
            except OSError:
                pass

    for relative, (is_folder, content) in sorted(snapshot.items(), key=lambda item: (item[0].count("/"), item[0])):
        ensure_safe_parents(relative, True)
        target = os.path.join(ROOT, *relative.split("/"))
        mode = path_type(target)
        if mode is not None and stat.S_ISLNK(mode):
            raise ValueError("unsafe path")
        if is_folder:
            if mode is not None and not stat.S_ISDIR(mode):
                raise ValueError("path conflict")
            if mode is None:
                os.mkdir(target)
        else:
            if mode is not None and not stat.S_ISREG(mode):
                raise ValueError("path conflict")
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0), 0o644)
            with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as output:
                output.write(content)


try:
    main()
except (OSError, ValueError, json.JSONDecodeError):
    sys.exit(1)
