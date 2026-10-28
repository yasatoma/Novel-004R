# validate_work

⑧の Git 登録前に作品 repository を**読み取り専用で機械検証**するツールです。ファイルの生成・修正・削除、Git 操作、Pages 確認は行いません。

```bat
py tools\validate-work\validate_work.py Novel-005
```

終了コードは OK=0、検証 NG=1、実行条件エラー=2 です。標準出力は JSON で、`success` を AI の合否判定に使用できます。通常表示はログ肥大化を避けるため、エラー/警告を group 単位に集約し、件数と最初の1件だけを `example` として返します。

全件が必要な場合だけ `--full` を付けます。

```bat
py tools\validate-work\validate_work.py Novel-005 --full
```

初版の検査対象:
- Engine/作品の固定構成
- `config.json` / `assets.json` / `endings.json` / `memo.json` / `ruby.json` の正式 JSON Schema 検証、および `build-manifest.json` の JSON 妥当性
- config の必須値、workId、entryScenario/titleImage/titleBgm の実在
- assets の背景/variant/キャラクター表情の実在
- 参照パスの大文字小文字完全一致
- Engine 本体と同じ parser/validator による entryScenario のコマンド文法、ID/遷移、構造、登録リソース参照の検証\n- scenario 内に明示された content/images/audio/data/scenario 系ファイル参照、および `@bgm play` / `@ambient play` / `@se play` の音声ファイル実在
- 主要素材フォルダのファイル数（info）

endings/memo/ruby は正式 schema に基づいて検証します。未使用素材判定は現在は行わず、主要素材フォルダの件数のみ info として報告します。
