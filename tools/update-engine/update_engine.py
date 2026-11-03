#!/usr/bin/env python3
"""Replace a work repository's Engine runtime with the latest Engine runtime.

This tool updates only the Engine runtime and its build metadata. It never
migrates content, commits, or pushes.
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


class UpdateError(RuntimeError):
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
        raise UpdateError(
            f"command failed ({proc.returncode}): {' '.join(args)}"
            + (f"\n{detail}" if detail else "")
        )
    return (proc.stdout or "").strip() if capture else ""


def require_command(name: str) -> None:
    if shutil.which(name) is None:
        raise UpdateError(f"required command not found in PATH: {name}")


def normalize_remote(url: str) -> str:
    value = url.strip().removesuffix(".git").rstrip("/")
    if value.startswith("git@github.com:"):
        value = "https://github.com/" + value[len("git@github.com:"):]
    return value.lower()


def ensure_safe_target(factory_root: Path, target: Path, work_id: str) -> None:
    expected = factory_root / work_id
    if target != expected or target.parent != factory_root or target == factory_root:
        raise UpdateError(f"refusing to update unexpected target: {target}")
    if not target.is_dir() or not (target / ".git").exists():
        raise UpdateError(f"work repository is missing or is not a Git repository: {target}")


def ensure_expected_remote(target: Path, repo: str) -> None:
    actual = run(["git", "remote", "get-url", "origin"], cwd=target, capture=True)
    expected = f"https://github.com/{repo}"
    if normalize_remote(actual) != normalize_remote(expected):
        raise UpdateError(f"origin mismatch: expected {expected}, got {actual}")


def read_build_manifest(target: Path) -> dict:
    path = target / "build-manifest.json"
    if not path.is_file():
        raise UpdateError("build-manifest.json is missing")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UpdateError(f"failed to read build-manifest.json: {exc}") from exc
    work_id = manifest.get("workId")
    repository = manifest.get("repository")
    engine = manifest.get("engine")
    if not isinstance(work_id, str) or not work_id:
        raise UpdateError("build-manifest.json does not contain workId")
    if not isinstance(repository, str) or not repository:
        raise UpdateError("build-manifest.json does not contain repository")
    if not isinstance(engine, dict) or not isinstance(engine.get("version"), str) or not engine["version"]:
        raise UpdateError("build-manifest.json does not contain engine.version")
    return manifest


def _make_writable_and_retry(func, path: str, _exc_info) -> None:
    os.chmod(path, stat.S_IWRITE)
    func(path)


def remove_tree(path: Path) -> None:
    delays = (0.2, 0.5, 1.0)
    for attempt in range(len(delays) + 1):
        try:
            if path.exists():
                shutil.rmtree(path, onerror=_make_writable_and_retry)
            return
        except OSError as exc:
            if attempt == len(delays):
                raise UpdateError(f"failed to remove directory after retries: {path}: {exc}") from exc
            time.sleep(delays[attempt])


def load_engine_manifest(source: Path) -> dict:
    path = source / "engine-manifest.json"
    if not path.is_file():
        raise UpdateError("Engine manifest is missing: engine-manifest.json")
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UpdateError(f"failed to read Engine manifest: {exc}") from exc
    engine = manifest.get("engine")
    if not isinstance(engine, dict) or not engine.get("version"):
        raise UpdateError("Engine manifest does not contain engine.version")
    if not (source / "engine" / "index.html").is_file():
        raise UpdateError("Engine entry point is missing: engine/index.html")
    return manifest


def replace_engine(target: Path, source_engine: Path) -> None:
    """Prepare the new runtime first, then replace engine/ so stale files cannot survive."""
    staged = target / ".engine-update-new"
    if staged.exists():
        remove_tree(staged)
    shutil.copytree(source_engine, staged)
    try:
        remove_tree(target / "engine")
        staged.replace(target / "engine")
    except Exception:
        if staged.exists():
            remove_tree(staged)
        raise


def update_build_manifest(
    target: Path,
    manifest: dict,
    engine_repo: str,
    revision: str,
    engine_manifest: dict,
) -> None:
    engine = engine_manifest["engine"]
    manifest["engine"] = {
        "repository": engine_repo,
        "revision": revision,
        "branch": engine.get("defaultBranch", "main"),
        "version": engine.get("version"),
    }
    (target / "build-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update a work repository's ChappyNovelEngine runtime.")
    parser.add_argument("work_id", help="work ID, e.g. Novel-004R")
    parser.add_argument(
        "--factory-root",
        type=Path,
        default=Path(os.environ.get("NOVEL_GAME_FACTORY_ROOT", DEFAULT_FACTORY_ROOT)),
        help="NovelGameFactory root (env: NOVEL_GAME_FACTORY_ROOT)",
    )
    parser.add_argument(
        "--github-owner",
        default=os.environ.get("NOVEL_GAME_GITHUB_OWNER", DEFAULT_GITHUB_OWNER),
        help="work repository owner (env: NOVEL_GAME_GITHUB_OWNER)",
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
        raise UpdateError("work_id may contain only ASCII letters, digits, '.', '_' and '-'")

    require_command("git")
    factory_root = args.factory_root.resolve()
    target = factory_root / args.work_id
    ensure_safe_target(factory_root, target, args.work_id)
    ensure_expected_remote(target, f"{args.github_owner}/{args.work_id}")
    build_manifest = read_build_manifest(target)
    if build_manifest["workId"] != args.work_id:
        raise UpdateError(
            f"build-manifest.json workId mismatch: expected {args.work_id}, got {build_manifest['workId']}"
        )
    expected_repository = f"{args.github_owner}/{args.work_id}"
    if build_manifest["repository"] != expected_repository:
        raise UpdateError(
            "build-manifest.json repository mismatch: "
            f"expected {expected_repository}, got {build_manifest['repository']}"
        )
    previous_version = build_manifest["engine"]["version"]

    with tempfile.TemporaryDirectory(prefix="cne-update-") as tmp:
        source = Path(tmp) / "engine-source"
        run(["git", "clone", "--depth", "1", f"https://github.com/{args.engine_repo}.git", str(source)])
        revision = run(["git", "rev-parse", "HEAD"], cwd=source, capture=True)
        engine_manifest = load_engine_manifest(source)

        replace_engine(target, source / "engine")
        update_build_manifest(
            target,
            build_manifest,
            args.engine_repo,
            revision,
            engine_manifest,
        )

    print(json.dumps({
        "success": True,
        "workId": args.work_id,
        "target": str(target),
        "engineRevision": revision,
        "fromEngineVersion": previous_version,
        "engineVersion": engine_manifest["engine"]["version"],
        "contentChanged": False,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except UpdateError as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
