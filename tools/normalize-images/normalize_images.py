from pathlib import Path
from PIL import Image
import argparse
import json
import os
import re
import sys

CHARACTER_CANVAS_SIZE = (2000, 3000)
CHARACTER_BASE_HEIGHT = 2500
BACKGROUND_SIZE = (1920, 1080)
DEFAULT_WEBP_QUALITY = 85
DEFAULT_FACTORY_ROOT = Path(r"C:\\Users\\TOMATO\\source\\repos\\_codex\\NovelGameFactory")

EXIT_OK = 0
EXIT_PARTIAL_FAILURE = 1
EXIT_USAGE = 2
EXIT_INPUT_ERROR = 3

JSON_MODE = False


class ToolError(Exception):
    def __init__(self, message: str, exit_code: int = EXIT_INPUT_ERROR):
        super().__init__(message)
        self.exit_code = exit_code


def log(message: str):
    if not JSON_MODE:
        print(message)


def fail(message: str, exit_code: int = EXIT_INPUT_ERROR):
    raise ToolError(message, exit_code)


def get_alpha_bbox(image: Image.Image):
    if image.mode != "RGBA":
        image = image.convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        fail("画像内に不透明ピクセルがありません。")
    return bbox


def save_webp(image: Image.Image, path: Path, quality: int, keep_alpha: bool):
    path.parent.mkdir(parents=True, exist_ok=True)
    output = image.convert("RGBA" if keep_alpha else "RGB")
    output.save(path, "WEBP", quality=quality, method=6)


def load_height_basis(path: Path):
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"身長比設定を読み込めません: {path} ({exc})")
    if not isinstance(data, dict):
        fail(f"身長比設定はJSONオブジェクトで指定してください: {path}")

    result = {}
    for key, value in data.items():
        try:
            basis = float(value)
        except (TypeError, ValueError):
            fail(f"身長比が数値ではありません: {key}={value}")
        if basis <= 0:
            fail(f"身長比は0より大きい値にしてください: {key}={value}")
        result[str(key).upper()] = basis
    return result


def normalize_character(work_root: Path, dst_dir: Path, character_id: str, height_basis: float, quality: int):
    src_dir = work_root / "Image-master" / "Character"
    if not src_dir.exists():
        fail(f"入力フォルダがありません: {src_dir}")
    dst_dir.mkdir(parents=True, exist_ok=True)

    basic_path = src_dir / f"{character_id}_通常.png"
    if not basic_path.exists():
        basic_path = src_dir / f"{character_id}_基本.png"
    if not basic_path.exists():
        fail(f"基準立ち絵がありません: {character_id}_通常.png または {character_id}_基本.png ({src_dir})")

    with Image.open(basic_path) as img:
        basic = img.convert("RGBA")
    bbox = get_alpha_bbox(basic)
    body_height = bbox[3] - bbox[1]
    if body_height <= 0:
        fail(f"人物本体の高さを取得できません: {basic_path}")

    target_height = round(CHARACTER_BASE_HEIGHT * height_basis)
    scale = target_height / body_height
    log(f"[INFO] キャラクター : {character_id}")
    log(f"[INFO] 身長基準     : {height_basis}")
    log(f"[INFO] 目標人物高さ : {target_height}px")
    log(f"[INFO] 拡大率       : {scale:.6f}")

    for extension in ("png", "webp"):
        for old_file in dst_dir.glob(f"{character_id}_*.{extension}"):
            log(f"[DELETE] {old_file.name}")
            old_file.unlink()

    source_files = sorted(src_dir.glob(f"{character_id}_*.png"))
    if not source_files:
        fail(f"対象画像がありません: {character_id}")

    for src_path in source_files:
        with Image.open(src_path) as img:
            src = img.convert("RGBA")
        resized = src.resize(
            (max(1, round(src.width * scale)), max(1, round(src.height * scale))),
            Image.Resampling.LANCZOS,
        )
        body_left, _, body_right, body_bottom = get_alpha_bbox(resized)
        body_center_x = (body_left + body_right) / 2
        paste_x = round(CHARACTER_CANVAS_SIZE[0] / 2 - body_center_x)
        paste_y = CHARACTER_CANVAS_SIZE[1] - body_bottom

        canvas = Image.new("RGBA", CHARACTER_CANVAS_SIZE, (0, 0, 0, 0))
        canvas.alpha_composite(resized, (paste_x, paste_y))
        dst_path = dst_dir / f"{src_path.stem}.webp"
        save_webp(canvas, dst_path, quality, keep_alpha=True)
        log(f"[WEBP] {src_path.name} -> {dst_path.name}")

    log(f"[DONE] {character_id} 正規化完了")
    return len(source_files)


def resize_background_cover(image: Image.Image):
    target_w, target_h = BACKGROUND_SIZE
    scale = max(target_w / image.width, target_h / image.height)
    new_w = max(1, round(image.width * scale))
    new_h = max(1, round(image.height * scale))
    resized = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    left = (new_w - target_w) // 2
    top = (new_h - target_h) // 2
    return resized.crop((left, top, left + target_w, top + target_h))


def normalize_title(work_root: Path, dst_dir: Path, quality: int):
    src_path = work_root / "Image-master" / "Title" / "title.png"
    dst_path = dst_dir / "title.webp"
    if not src_path.exists():
        fail(f"タイトル画像がありません: {src_path}")

    with Image.open(src_path) as img:
        src = img.convert("RGB")
    result = src if src.size == BACKGROUND_SIZE else resize_background_cover(src)
    save_webp(result, dst_path, quality, keep_alpha=False)
    log(
        f"[WEBP] {src_path.name}: "
        f"{src.width}x{src.height} -> "
        f"{BACKGROUND_SIZE[0]}x{BACKGROUND_SIZE[1]} / quality={quality}"
    )
    log("[DONE] TITLE 正規化完了")
    return 1


def normalize_background(work_root: Path, dst_dir: Path, background_id: str, quality: int):
    src_dir = work_root / "Image-master" / "Background"
    if not src_dir.exists():
        fail(f"入力フォルダがありません: {src_dir}")
    dst_dir.mkdir(parents=True, exist_ok=True)

    source_files = sorted(src_dir.glob(f"{background_id}*.png"))
    if not source_files:
        fail(f"対象背景画像がありません: {background_id}")

    for extension in ("png", "webp"):
        for old_file in dst_dir.glob(f"{background_id}*.{extension}"):
            log(f"[DELETE] {old_file.name}")
            old_file.unlink()

    for src_path in source_files:
        with Image.open(src_path) as img:
            src = img.convert("RGB")
        result = src if src.size == BACKGROUND_SIZE else resize_background_cover(src)
        dst_path = dst_dir / f"{src_path.stem}.webp"
        save_webp(result, dst_path, quality, keep_alpha=False)
        log(
            f"[WEBP] {src_path.name}: "
            f"{src.width}x{src.height} -> "
            f"{BACKGROUND_SIZE[0]}x{BACKGROUND_SIZE[1]} / quality={quality}"
        )

    log(f"[DONE] {background_id} 正規化完了")
    return len(source_files)


def normalize_item(work_root: Path, dst_dir: Path, item_id: str, quality: int):
    src_dir = work_root / "Image-master" / "Item"
    if not src_dir.exists():
        fail(f"入力フォルダがありません: {src_dir}")
    src_path = src_dir / f"{item_id}.png"
    if not src_path.exists():
        fail(f"Item画像がありません: {src_path}")
    dst_dir.mkdir(parents=True, exist_ok=True)
    dst_path = dst_dir / f"{item_id}.webp"
    with Image.open(src_path) as img:
        src = img.convert("RGBA")
    save_webp(src, dst_path, quality, keep_alpha=True)
    log(f"[WEBP] {src_path.name} -> {dst_path.name}")
    log(f"[DONE] {item_id} Item正規化完了")
    return 1


def clear_output_directory(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    deleted = 0
    for path in sorted(directory.rglob("*"), reverse=True):
        if path.is_file():
            log(f"[DELETE] {path}")
            path.unlink()
            deleted += 1
        elif path.is_dir():
            try:
                path.rmdir()
            except OSError:
                pass
    log(f"[CLEAN] {directory} ({deleted} files)")
    return deleted


def discover_ids(directory: Path, pattern: str, regex: str):
    if not directory.exists():
        return []
    ids = set()
    compiled = re.compile(regex, re.IGNORECASE)
    for path in directory.glob(pattern):
        match = compiled.match(path.name)
        if match:
            ids.add(match.group(1).upper())
    return sorted(ids)


def emit_summary(summary):
    if JSON_MODE:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(
            f"[SUMMARY] success={summary['success']} "
            f"backgrounds={summary['backgrounds']['targets']} targets/"
            f"{summary['backgrounds']['files']} files "
            f"characters={summary['characters']['targets']} targets/"
            f"{summary['characters']['files']} files "
            f"failed={len(summary['failed'])}"
        )
        for item in summary["failed"]:
            print(f"[FAILED] {item['target']}: {item['message']}")


def main():
    global JSON_MODE

    parser = argparse.ArgumentParser(
        description="NovelGame画像ビルド（高品質PNG原本から配信用WebPを生成）"
    )
    parser.add_argument(
        "work_root",
        type=Path,
        help="Image-master を含む作品リソースルート",
    )
    parser.add_argument(
        "target_id",
        nargs="?",
        default="ALL",
        help="ALL（既定）/ ALL_BG / ALL_CH / TITLE / CH_006 / BG_029",
    )
    parser.add_argument(
        "--height-basis",
        type=float,
        default=None,
        help="単体キャラクター指定時の身長基準 例: 1.03",
    )
    parser.add_argument(
        "--height-basis-file",
        type=Path,
        default=None,
        help="キャラクター身長比JSON。既定: Image-master/character_height_basis.json",
    )
    parser.add_argument(
        "--output-root",
        type=Path,
        default=None,
        help="出力ルート。未指定時は <NovelGameFactory>/<work_id>/content/images。指定時は任意の出力ルート",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_WEBP_QUALITY,
        help=f"WebP品質 1..100（既定: {DEFAULT_WEBP_QUALITY}）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="ログを抑制し、結果をJSON 1行だけ標準出力する（自動実行向け）",
    )
    args = parser.parse_args()
    JSON_MODE = args.json

    if not 1 <= args.quality <= 100:
        fail("--quality は 1..100 で指定してください。", EXIT_USAGE)

    work_root = args.work_root.resolve()
    if not work_root.exists():
        fail(f"作業ルートがありません: {work_root}")

    if args.output_root:
        output_root = args.output_root.resolve()
    else:
        factory_root = Path(os.environ.get("NOVEL_GAME_FACTORY_ROOT", DEFAULT_FACTORY_ROOT)).resolve()
        output_root = factory_root / work_root.name / "content" / "images"

    background_output = output_root / "bg"
    character_output = output_root / "char"
    title_output = output_root / "title"
    item_output = output_root / "item"

    target_id = args.target_id.upper()
    valid_all = {"ALL", "ALL_BG", "ALL_CH", "ALL_ITEM", "TITLE"}
    if target_id not in valid_all and not target_id.startswith(("CH_", "BG_", "I")):
        fail(
            "target_id は ALL / ALL_BG / ALL_CH / ALL_ITEM / TITLE / CH_XXX / BG_XXX / IXXX の形式で指定してください。",
            EXIT_USAGE,
        )

    basis_file = (
        args.height_basis_file.resolve()
        if args.height_basis_file
        else work_root / "Image-master" / "character_height_basis.json"
    )
    height_basis_map = load_height_basis(basis_file)

    bg_ids = discover_ids(
        work_root / "Image-master" / "Background",
        "BG_*.png",
        r"^(BG_\d+)",
    )
    ch_ids = discover_ids(
        work_root / "Image-master" / "Character",
        "CH_*.png",
        r"^(CH_\d+)_",
    )
    item_ids = discover_ids(
        work_root / "Image-master" / "Item",
        "I*.png",
        r"^(I\d{3})\.png$",
    )

    if target_id == "ALL":
        targets = bg_ids + ch_ids + item_ids
    elif target_id == "ALL_BG":
        targets = bg_ids
    elif target_id == "ALL_CH":
        targets = ch_ids
    elif target_id == "ALL_ITEM":
        targets = item_ids
    else:
        targets = [target_id]

    if not targets:
        fail(f"対象画像が見つかりません: {target_id}")

    summary = {
        "success": True,
        "target": target_id,
        "quality": args.quality,
        "height_basis_file": str(basis_file),
        "output_root": str(output_root),
        "backgrounds": {"targets": 0, "files": 0},
        "title": {"targets": 0, "files": 0},
        "items": {"targets": 0, "files": 0},
        "characters": {"targets": 0, "files": 0},
        "failed": [],
    }

    log(f"[INFO] 作業ルート : {work_root}")
    log(f"[INFO] 対象         : {target_id}")
    log(f"[INFO] 出力ルート   : {output_root}")
    log(f"[INFO] WebP品質    : {args.quality}")

    if target_id in {"ALL", "ALL_BG"}:
        clear_output_directory(background_output)
    if target_id in {"ALL", "ALL_CH"}:
        clear_output_directory(character_output)
    if target_id in {"ALL", "ALL_ITEM"}:
        clear_output_directory(item_output)

    for current in targets:
        try:
            if current == "TITLE":
                file_count = normalize_title(work_root, title_output, args.quality)
                summary["title"]["targets"] += 1
                summary["title"]["files"] += file_count
            elif re.fullmatch(r"I\d{3}", current):
                file_count = normalize_item(work_root, item_output, current, args.quality)
                summary["items"]["targets"] += 1
                summary["items"]["files"] += file_count
            elif current.startswith("BG_"):
                file_count = normalize_background(work_root, background_output, current, args.quality)
                summary["backgrounds"]["targets"] += 1
                summary["backgrounds"]["files"] += file_count
            else:
                basis = args.height_basis if len(targets) == 1 and args.height_basis is not None else height_basis_map.get(current)
                if basis is None:
                    fail(
                        f"身長比が未設定です。{basis_file} に {current} を追加するか、単体実行で --height-basis を指定してください。"
                    )
                file_count = normalize_character(work_root, character_output, current, basis, args.quality)
                summary["characters"]["targets"] += 1
                summary["characters"]["files"] += file_count
        except Exception as exc:
            message = str(exc)
            summary["failed"].append({"target": current, "message": message})
            if len(targets) == 1:
                break

    summary["success"] = not summary["failed"]
    emit_summary(summary)
    return EXIT_OK if summary["success"] else EXIT_PARTIAL_FAILURE


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ToolError as exc:
        if JSON_MODE:
            print(json.dumps({"success": False, "failed": [{"target": "setup", "message": str(exc)}]}, ensure_ascii=False))
        else:
            print(f"[ERROR] {exc}", file=sys.stderr)
        sys.exit(exc.exit_code)
    except KeyboardInterrupt:
        if not JSON_MODE:
            print("[ERROR] 中断されました。", file=sys.stderr)
        sys.exit(EXIT_PARTIAL_FAILURE)
