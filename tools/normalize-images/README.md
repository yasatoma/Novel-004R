# normalize-images

高品質PNG原本（`Image-master/`）から、作品repositoryの `content/images/` へゲーム配信用WebPを生成する画像ビルドツールです。

## 基本方針

- 画像生成工程では原本PNGを作成し、リサイズ・WebP化は本ツールでまとめて行う
- 通常は Codex 等のCLI実行から作品単位で一括処理する
- 手動差し替え時は背景・キャラクターを1件だけ再生成できる
- `ALL` / `ALL_BG` / `ALL_CH` は対象の出力先を先に全クリアしてから再生成するため、原本から削除された古い画像が残らない
- 個別指定（`BG_029` / `CH_006` 等）は対象IDだけ削除して再生成する
- `Image-master/` の原本は変更しない
- 背景: 1920x1080へcoverリサイズ＋中央クロップ
- タイトル: 1920x1080へcoverリサイズ＋中央クロップ
- キャラクター: 2000x3000透明キャンバスへ配置
- WebP品質: 既定85（`--quality`で変更可）
- キャラクターのalphaはWebPで維持\n- Item画像: `Image-master/Item/I001.png` → `content/images/item/I001.webp`。`I` はItemを表す論理ID

## 標準入出力

標準運用では、作品IDは `work_root` のフォルダ名から取得します。

```text
入力:
<NovelGameFactory>/Common/Resource/Novel-005/Image-master/

出力:
<NovelGameFactory>/Novel-005/content/images/
├─ bg/
├─ char/
└─ title/
   └─ title.webp
```

NovelGameFactoryルートは `NOVEL_GAME_FACTORY_ROOT` 環境変数を優先し、未設定時はEngine共通の既定値を使用します。

`--output-root` を指定した場合だけ、上記の標準出力先を上書きして任意フォルダへ出力できます。指定先の直下には常に `bg/`、`char/`、`title/` を作成します。

## キャラクター身長比

身長計算の基準画像には `CH_XXX_通常.png` を使用します。
従来作品の互換性のため、通常画像がない場合は `CH_XXX_基本.png` を使用します。
両方ある場合は通常画像を優先します。出力ファイル名は各原本の名前を維持し、両方とも変換します。
どちらもない場合はエラーとし、他の表情から基準を推測しません。

一括処理では `Image-master/character_height_basis.json` を読みます。

```json
{
  "CH_001": 0.90,
  "CH_002": 0.93,
  "CH_003": 0.95,
  "CH_004": 0.99,
  "CH_005": 0.93,
  "CH_006": 1.03
}
```

値は基準人物高2500pxに掛ける身長比です。
別ファイルを使う場合は `--height-basis-file` で指定できます。

## CLI実行

### 作品内の全画像を一括生成（標準）

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005
```

target_id省略時は `ALL` として処理します。

`ALL` 実行時は、最初に出力先の `bg/`、`char/`、`item/` の内容を全て削除してから再生成します。生成物フォルダを完全再構築するため、`Image-master/` から削除された旧画像も残りません。

`TITLE` は `ALL` の対象には含まれません。タイトル画像は後から用意できるよう、必要なタイミングで `TITLE` を個別実行します。

### 出力先を任意に変更

通常はオプション不要で、`<NovelGameFactory>/<work_id>/content/images` へ直接出力します。

別の場所へ出したい場合だけ `--output-root` を指定します。

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 ALL --output-root C:\path\to\custom\images
```

この場合も `<output-root>/bg/`、`char/`、`title/` のEngine形式で出力します。

### 背景だけ / キャラクターだけ

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 ALL_BG
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 ALL_CH
```

`ALL_BG` は出力先の `bg/`、`ALL_CH` は `char/` をそれぞれ先に全クリアしてから再生成します。

### 1件だけ手動再生成

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 BG_029
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 CH_006 --height-basis 1.03
```

キャラクター単体指定では、`--height-basis` を省略すると身長比JSONを参照します。

### タイトル画像を生成

タイトル画像は、原本を次の固定パスへ配置します。

```text
Image-master/Title/title.png
```

次のコマンドでタイトル画像だけを生成します。

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 TITLE
```

出力先は次の固定パスです。

```text
<NovelGameFactory>/Novel-005/content/images/title/title.webp
```

原本が1920x1080の場合はそのサイズのままWebP化します。異なるサイズの場合は、背景画像と同じく1920x1080を覆うように拡大・縮小した後、中央をクロップして1920x1080にします。出力はRGBのWebPで、品質は通常の画像と同じく既定85（`--quality`で変更可）です。

`TITLE` は `ALL` / `ALL_BG` / `ALL_CH` とは独立した単体ターゲットです。`ALL` を実行してもタイトル画像は生成・削除されません。タイトル画像を後から作成・差し替えする場合は、`Image-master/Title/title.png` を配置または更新した後、`TITLE` を再実行してください。

`Image-master/Title/title.png` が存在しない状態で `TITLE` を実行した場合はエラーになります。

`--output-root` を指定した場合、TITLEの出力先も `<output-root>/title/title.webp` に切り替わります。

## Codex等からの自動実行

`--json` を付けると通常ログを抑制し、最後に機械可読なJSONを1行だけ標準出力します。

```bat
python tools\normalize-images\normalize_images.py C:\path\to\Resource\Novel-005 ALL --json
```

成功例:

```json
{"success":true,"target":"ALL","quality":85,"backgrounds":{"targets":29,"files":34},"characters":{"targets":8,"files":21},"failed":[]}
```

一部失敗例:

```json
{"success":false,"target":"ALL","quality":85,"backgrounds":{"targets":29,"files":34},"characters":{"targets":7,"files":19},"failed":[{"target":"CH_006","message":"身長比が未設定です。..."}]}
```

## 終了コード

| code | 意味 |
|---:|---|
| 0 | 全件成功 |
| 1 | 対象処理の一部または単体処理が失敗 |
| 2 | 引数・オプション不備 |
| 3 | 作業ルート・設定等の入力不備 |

Codex等は **終了コードを先に確認し、必要に応じてJSONの `failed` を読む** 想定です。

## BAT

Windowsで手動利用する場合は同梱のBATも使用できます。

```bat
tools\normalize-images\normalize_images.bat C:\path\to\Resource\Novel-005
tools\normalize-images\normalize_images.bat C:\path\to\Resource\Novel-005 BG_029
```

BATはPython本体へ引数をそのまま渡す薄いラッパーです。

Engineを作品へコピーした後は、そのコピー内の `tools/normalize-images/` を使用してください。


## Item画像

会話中に提示する写真・手紙・新聞・スマートフォン画面・小物・証拠品等はItem画像として扱います。

```text
入力 : Image-master/Item/I001.png
出力 : content/images/item/I001.webp
```

IDは `I` + 3桁数字（`I001`～）とし、`I` はItemを表します。シナリオでは `@overlay show id=I001` のように論理IDだけを指定し、拡張子は指定しません。

Itemだけを一括生成する場合は `ALL_ITEM`、単体再生成は `I001` のように指定します。
