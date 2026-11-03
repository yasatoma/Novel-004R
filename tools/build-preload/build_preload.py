#!/usr/bin/env python3
"""Generate content/data/preload-assets.json from the current scenario.

The output is an optimization hint only. Runtime remains functional when the
file is missing or stale.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


class BuildPreloadError(RuntimeError):
    pass


def parse_atom(value: str):
    if value == "true":
        return True
    if value == "false":
        return False
    if value and (value.isdigit() or (value.startswith("-") and value[1:].isdigit())):
        return int(value)
    return value


def tokenize(line: str, line_number: int) -> list[str]:
    tokens: list[str] = []
    current: list[str] = []
    quoted = False
    for char in line:
        if char == '"':
            quoted = not quoted
            continue
        if char.isspace() and not quoted:
            if current:
                tokens.append("".join(current))
                current = []
            continue
        current.append(char)
    if quoted:
        raise BuildPreloadError(f"scenario:{line_number}: 引用符が閉じていません")
    if current:
        tokens.append("".join(current))
    return tokens


def parse_scenario(source: str) -> list[dict]:
    lines = source.replace("\r", "").split("\n")
    commands: list[dict] = []
    index = 0
    while index < len(lines):
        line_number = index + 1
        trimmed = lines[index].strip()
        if not trimmed or trimmed.startswith("#"):
            index += 1
            continue
        if not trimmed.startswith("@"):
            raise BuildPreloadError(f"scenario:{line_number}: 命令外の本文です")
        tokens = tokenize(trimmed, line_number)
        if len(tokens) < 2:
            raise BuildPreloadError(f"scenario:{line_number}: command/action が必要です")
        command = {"type": tokens[0][1:], "action": tokens[1], "args": {}}
        for token in tokens[2:]:
            separator = token.find("=")
            if separator < 1:
                raise BuildPreloadError(f"scenario:{line_number}: key=value ではありません: {token}")
            key = token[:separator]
            if key in command["args"]:
                raise BuildPreloadError(f"scenario:{line_number}: key重複: {key}")
            command["args"][key] = parse_atom(token[separator + 1:])
        if command["type"] == "text" and command["action"] == "show":
            body_index = index + 1
            while body_index < len(lines) and not lines[body_index].strip():
                body_index += 1
            body = lines[body_index].strip() if body_index < len(lines) else ""
            if not body or body.startswith("@") or body.startswith("#"):
                raise BuildPreloadError(f"scenario:{line_number}: @text show の本文がありません")
            command["text"] = lines[body_index]
            index = body_index
        commands.append(command)
        index += 1
    return commands


def scenario_revision(commands: list[dict]) -> str:
    payload = []
    for command in commands:
        item = {"type": command["type"], "action": command["action"], "args": command["args"]}
        if "text" in command:
            item["text"] = command["text"]
        payload.append(item)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    encoded = text.encode("utf-16-le", errors="surrogatepass")
    value = 2166136261
    for index in range(0, len(encoded), 2):
        code_unit = encoded[index] | (encoded[index + 1] << 8)
        value ^= code_unit
        value = (value * 16777619) & 0xFFFFFFFF
    return f"scenario-{value:x}"


def background_file(assets: dict, asset_id: str, variant: str = "base") -> str:
    registered = assets.get("backgrounds", {}).get(asset_id)
    if not registered:
        raise BuildPreloadError(f"background asset not registered: {asset_id}")
    if isinstance(registered, str):
        if variant != "base":
            raise BuildPreloadError(f"background variant not registered: {asset_id}/{variant}")
        return registered
    variants = registered.get("variants", registered)
    file = variants.get(variant)
    if not file:
        raise BuildPreloadError(f"background variant not registered: {asset_id}/{variant}")
    return file


def character_file(assets: dict, asset_id: str, expression: str) -> str:
    file = assets.get("characters", {}).get(asset_id, {}).get("expressions", {}).get(expression)
    if not file:
        raise BuildPreloadError(f"character asset not registered: {asset_id}/{expression}")
    return file


def command_assets(command: dict, assets: dict) -> list[dict]:
    kind = command["type"]
    action = command["action"]
    args = command["args"]
    result: list[dict] = []
    if kind == "bg" and action == "show":
        result.append({"kind": "image", "path": f"images/bg/{background_file(assets, str(args.get('id')), str(args.get('image', 'base')))}"})
    elif kind == "compare" and action == "show":
        for id_key, image_key in (("left_id", "left_image"), ("right_id", "right_image")):
            result.append({"kind": "image", "path": f"images/bg/{background_file(assets, str(args.get(id_key)), str(args.get(image_key, 'base')))}"})
    elif kind == "char" and action in {"show", "change"}:
        result.append({"kind": "image", "path": f"images/char/{character_file(assets, str(args.get('id')), str(args.get('expression')))}"})
    elif kind == "overlay" and action == "show":
        result.append({"kind": "image", "path": f"images/item/{args.get('id')}.webp"})
    elif kind in {"bgm", "ambient", "se"} and action == "play":
        result.append({"kind": "audio", "path": f"audio/{kind}/{args.get('file')}"})
    return result


def build_manifest(commands: list[dict], assets: dict, entry_scenario: str) -> dict:
    anchors: list[dict] = [{"textId": None, "chapterId": None, "assets": []}]
    current = anchors[0]
    current_chapter = None

    for command in commands:
        if command["type"] == "chapter":
            if command["action"] == "start":
                current_chapter = command["args"].get("id")
                current["chapterId"] = current_chapter
            elif command["action"] == "end" and command["args"].get("id") == current_chapter:
                current_chapter = None

        if command["type"] == "text" and command["action"] == "show":
            current = {
                "textId": command["args"].get("id"),
                "chapterId": current_chapter,
                "assets": [],
            }
            anchors.append(current)
            continue

        for asset in command_assets(command, assets):
            if asset not in current["assets"]:
                current["assets"].append(asset)

    return {
        "schemaVersion": 1,
        "entryScenario": entry_scenario,
        "scenarioRevision": scenario_revision(commands),
        "anchors": anchors,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate ChappyNovelEngine preload asset manifest.")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="work repository root (default: repository containing this tool)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    config_path = root / "content" / "data" / "config.json"
    assets_path = root / "content" / "data" / "assets.json"
    if not config_path.is_file():
        raise BuildPreloadError(f"config not found: {config_path}")
    if not assets_path.is_file():
        raise BuildPreloadError(f"assets not found: {assets_path}")

    config = json.loads(config_path.read_text(encoding="utf-8"))
    assets = json.loads(assets_path.read_text(encoding="utf-8"))
    entry_scenario = config.get("entryScenario", "scenario/main.txt")
    scenario_path = root / "content" / entry_scenario
    if not scenario_path.is_file():
        raise BuildPreloadError(f"scenario not found: {scenario_path}")

    commands = parse_scenario(scenario_path.read_text(encoding="utf-8"))
    manifest = build_manifest(commands, assets, entry_scenario)
    output = root / "content" / "data" / "preload-assets.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "success": True,
        "output": str(output),
        "scenarioRevision": manifest["scenarioRevision"],
        "anchors": len(manifest["anchors"]),
        "assetUsages": sum(len(anchor["assets"]) for anchor in manifest["anchors"]),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BuildPreloadError, json.JSONDecodeError) as exc:
        print(json.dumps({"success": False, "error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
