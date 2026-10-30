#!/usr/bin/env python3
"""Initialize a ChappyNovelEngine work repository.

Usage:
    py init_work.py Novel-005

The tool owns repository bootstrap/synchronization and the destructive clean
boundary.  It intentionally never commits or pushes; those actions happen only
after validation in production step 8.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from typing import Sequence

DEFAULT_FACTORY_ROOT = Path(r"C:\Users\TOMATO\source\repos\_codex\NovelGameFactory")
DEFAULT_GITHUB_OWNER = "yasatoma"
DEFAULT_ENGINE_REPO = "yasatoma/ChappyNovelEngine"
WORK_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class InitError(RuntimeError):
    pass


def run(args: Sequence[str], *, cwd: Path | None = None, capture: bool = False) -> str:
    proc = subprocess.run(
        list(args),
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )
    if proc.returncode != 0:
        detail = ""
        if capture:
            detail = (proc.stderr or proc.stdout or "").strip()
        raise InitError(f"command failed ({proc.returncode}): {' '.join(args)}" + (f"\n{detail}" if detail else ""))
    return (proc.stdout or "").strip() if capture else ""


def require_command(name: str) -> None:
    if shutil.which(name) is None:
        raise InitError(f"required command not found in PATH: {name}")


def repo_exists(repo: str) -> bool:
    proc = subprocess.run(
        ["gh", "repo", "view", repo, "--json", "name"],
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return proc.returncode == 0


def normalize_remote(url: str) -> str:
    value = url.strip().removesuffix(".git").rstrip("/")
    if value.startswith("git@github.com:"):
        value = "https://github.com/" + value[len("git@github.com:"):]
    return value.lower()


def ensure_expected_remote(target: Path, repo: str) -> None:
    actual = run(["git", "remote", "get-url", "origin"], cwd=target, capture=True)
    expected = f"https://github.com/{repo}"
    if normalize_remote(actual) != normalize_remote(expected):
        raise InitError(f"origin mismatch: expected {expected}, got {actual}")


def ensure_safe_local_target(factory_root: Path, target: Path, work_id: str) -> None:
    expected = factory_root / work_id
    if target != expected or target.parent != factory_root or target == factory_root:
        raise InitError(f"refusing to replace unexpected local target: {target}")


def _make_writable_and_retry(func, path: str, _exc_info) -> None:
    """Retry one rmtree operation after clearing a Windows read-only attribute."""
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_local_target(target: Path) -> None:
    """Remove a disposable workspace, tolerating transient Windows file access errors."""
    delays = (0.2, 0.5, 1.0)
    for attempt in range(len(delays) + 1):
        try:
            if not target.exists():
                return
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target, onerror=_make_writable_and_retry)
            else:
                target.chmod(stat.S_IWRITE)
                target.unlink()
            return
        except OSError as exc:
            if attempt == len(delays):
                raise InitError(f"failed to remove local work repository after retries: {target}: {exc}") from exc
            delay = delays[attempt]
            print(f"[init_work] local removal blocked; retry in {delay:.1f}s: {target}")
            time.sleep(delay)


def replace_local_repository(factory_root: Path, target: Path, repo: str) -> None:
    ensure_safe_local_target(factory_root, target, target.name)
    if target.exists():
        print(f"[init_work] remove disposable local work repository: {target}")
        remove_local_target(target)
    print(f"[init_work] clone: {repo} -> {target}")
    run(["gh", "repo", "clone", repo, str(target)], cwd=factory_root)
    # Preserve repository metadata/history, but discard the previous generated work tree.
    print(f"[init_work] clear cloned work tree: {target}")
    run(["git", "rm", "-r", "."], cwd=target)


def prepare_repository(factory_root: Path, work_id: str, repo: str) -> tuple[Path, str, bool]:
    target = factory_root / work_id
    factory_root.mkdir(parents=True, exist_ok=True)
    ensure_safe_local_target(factory_root, target, work_id)

    exists_remote = repo_exists(repo)
    created_remote = not exists_remote
    if created_remote:
        print(f"[init_work] create public repository: {repo}")
        run(["gh", "repo", "create", repo, "--public", "--add-readme"])

    # The GitHub repository is persistent.  The local work repository is a
    # disposable generated workspace, so every run starts from a fresh clone.
    replace_local_repository(factory_root, target, repo)
    ensure_expected_remote(target, repo)
    return target, "clone", created_remote


def write_root_launcher(target: Path) -> None:
    html = """<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=./engine/">
  <title>ChappyNovelEngine</title>
  <script>location.replace("./engine/");</script>
</head>
<body><a href="./engine/">ゲームを開く</a></body>
</html>
"""
    (target / "index.html").write_text(html, encoding="utf-8")


def write_new_repository_readme(target: Path, work_id: str) -> None:
    text = f"""# {work_id}

ChappyNovelEngine で制作するノベルゲーム作品リポジトリです。

このリポジトリの初期構成は `init_work.py` により生成されています。
"""
    (target / "README.md").write_text(text, encoding="utf-8")


def copy_engine_distribution(target: Path, engine_repo: str) -> tuple[str, dict]:
    """Copy the distribution declared by the Engine manifest."""
    with tempfile.TemporaryDirectory(prefix="cne-build-") as tmp:
        source = Path(tmp) / "engine-source"
        run(["git", "clone", "--depth", "1", f"https://github.com/{engine_repo}.git", str(source)])
        revision = run(["git", "rev-parse", "HEAD"], cwd=source, capture=True)
        manifest_path = source / "engine-manifest.json"
        if not manifest_path.is_file():
            raise InitError("Engine manifest is missing: engine-manifest.json")
        engine_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        distribution = engine_manifest.get("distribution")
        if not isinstance(distribution, list) or not distribution or not all(isinstance(x, str) and x for x in distribution):
            raise InitError("Engine manifest distribution must be a non-empty string list")
        for name in distribution:
            src = source / name
            if not src.exists(): raise InitError(f"Engine distribution item is missing: {name}")
            if src.is_dir(): shutil.copytree(src, target / name)
            else: shutil.copy2(src, target / name)
        if not (source / "engine" / "index.html").is_file(): raise InitError("Engine entry point is missing: engine/index.html")
        write_root_launcher(target)
        (target / ".nojekyll").write_text("", encoding="utf-8")
        (target / ".gitignore").write_text("# init_work temporary/source directories\nImage-master/\nImage/\naudio_original/\naudio/\nlogs/\n", encoding="utf-8")
        (target / "logs").mkdir(parents=True, exist_ok=True)
        for path in ("content/scenario","content/images/bg","content/images/char","content/images/title","content/images/item","content/audio/bgm","content/audio/ambient","content/audio/se","content/data"):
            (target / path).mkdir(parents=True, exist_ok=True)
        about_template = source / "content" / "data" / "about.html"
        if not about_template.is_file(): raise InitError("Engine about template is missing: content/data/about.html")
        shutil.copy2(about_template, target / "content" / "data" / "about.html")
        (target / "content" / "theme.css").write_text("", encoding="utf-8")
        return revision, engine_manifest


def write_manifest(target: Path, work_id: str, repo: str, engine_repo: str, revision: str, engine_manifest: dict) -> None:
    engine = engine_manifest.get("engine", {})
    manifest = {"workId": work_id, "repository": repo, "engine": {"repository": engine_repo, "revision": revision, "branch": engine.get("defaultBranch", "main"), "version": engine.get("version")}}
    (target / "build-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Initialize a ChappyNovelEngine work repository.")
    parser.add_argument("work_id", help="work ID, e.g. Novel-005")
    parser.add_argument(
        "--factory-root",
        type=Path,
        default=Path(os.environ.get("NOVEL_GAME_FACTORY_ROOT", DEFAULT_FACTORY_ROOT)),
        help="NovelGameFactory root (default: %(default)s; env: NOVEL_GAME_FACTORY_ROOT)",
    )
    parser.add_argument(
        "--github-owner",
        default=os.environ.get("NOVEL_GAME_GITHUB_OWNER", DEFAULT_GITHUB_OWNER),
        help="GitHub owner (env: NOVEL_GAME_GITHUB_OWNER)",
    )
    parser.add_argument(
        "--engine-repo",
        default=os.environ.get("CNE_REPOSITORY", DEFAULT_ENGINE_REPO),
        help="Engine repository owner/name (env: CNE_REPOSITORY)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not WORK_ID_RE.fullmatch(args.work_id):
        raise InitError("work_id may contain only ASCII letters, digits, '.', '_' and '-'")

    require_command("git")
    require_command("gh")
    run(["gh", "auth", "status"], capture=True)

    repo = f"{args.github_owner}/{args.work_id}"
    target, mode, created_remote = prepare_repository(args.factory_root.resolve(), args.work_id, repo)

    revision, engine_manifest = copy_engine_distribution(target, args.engine_repo)
    write_manifest(target, args.work_id, repo, args.engine_repo, revision, engine_manifest)
    if created_remote:
        write_new_repository_readme(target, args.work_id)

    print(json.dumps({
        "success": True,
        "workId": args.work_id,
        "repository": repo,
        "target": str(target),
        "repositoryAction": mode,
        "engineRevision": revision,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except InitError as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
