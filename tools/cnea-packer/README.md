# CNEA v1 packer

作品組立工程用の共通変換ツールです。素材音源（OGG/MP3/WAV）は再エンコードせず、CNEA v1の6 byteヘッダーを付与して `.dat` として出力します。

## 標準一括変換

作品IDを指定すると、NovelGameFactory の共通音声素材を作品repositoryへ直接変換・配置します。

```bat
tools\cnea-packer\convert_audio.bat Novel-005
```

標準入出力:

```text
入力:
<NovelGameFactory>/Common/audio/
├─ bgm/
└─ se/

出力:
<NovelGameFactory>/Novel-005/content/audio/
├─ bgm/
│  └─ B001.dat ...
├─ se/
│  └─ S001.dat ...
└─ map.txt
```

NovelGameFactoryルートは `NOVEL_GAME_FACTORY_ROOT` 環境変数を優先し、未設定時はEngine共通の既定値を使用します。

BGMとSEはそれぞれ独立してファイル名順に採番します。

- BGM: `B001.dat`, `B002.dat`, ...
- SE: `S001.dat`, `S002.dat`, ...
- 各種別最大999ファイル
- 同名の出力ファイルが既に存在する場合は上書き
- 出力先全体は削除しないため、今回の変換対象と無関係なファイルは維持

`map.txt` には元ファイル名と変換後ファイル名の対応を出力します。

```text
type    original        packed
BGM     battle.mp3      B001.dat
SE      click.wav       S001.dat
```

## CNEA v1

出力ファイルは次の6 byteヘッダーと元音源データで構成します。

- byte 0-3: `CNEA`
- byte 4: version (`0x01`)
- byte 5: format (`0x01`=OGG, `0x02`=MP3, `0x03`=WAV)
- byte 6以降: 元音源データ

Engineは再生時にこのヘッダーを検証・除去し、元の音声形式として再生します。

## 単一ファイル変換

手動作業用の単一ファイル変換は従来どおり利用できます。入力ファイルを直接指定すると、そのファイルだけ変換します。対応拡張子は `.ogg` / `.mp3` / `.wav`。

```bat
convert_audio.bat "C:\path\to\title.mp3"
```

出力名を省略した場合は入力ファイルと同じ場所へ `title.dat` として出力します。

任意の出力名も指定できます。

```bat
convert_audio.bat "C:\path\to\title.mp3" "B012.dat"
```

第2引数に `.dat` を付けなかった場合は自動で付与します。出力先は入力ファイルと同じフォルダです。

Node.jsから直接実行する場合も同じ引数です。

```bat
node tools/cnea-packer/pack.mjs "C:\path\to\title.mp3" "B012.dat"
```
