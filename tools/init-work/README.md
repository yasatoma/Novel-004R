# init-work

ChappyNovelEngine作品repositoryを初期化・同期し、Engine配布物と作品用の基本ディレクトリを配置する制作支援ツールです。

## 基本方針

- 作品IDから `<GitHub owner>/<work_id>` を対象repositoryとして扱う
- 対象repositoryが存在しない場合はpublic repositoryを作成する
- GitHub上の作品repositoryは永続資産として扱い、既存repositoryを削除しない
- `<factory-root>/<work_id>` のローカル作品repositoryは再生成可能な作業領域として扱う
- 再実行時はローカル作品repositoryを `.git` ごと削除し、GitHub上の作品repositoryからcloneし直す
- ローカルの未commit・未追跡変更は再実行時に破棄される
- clone後、Engineの `engine-manifest.json` に定義された配布物を再配置する
- 本ツールはcommit / pushを行わない

## 前提

実行には `git` と `gh` がPATH上で利用でき、GitHub CLIが認証済みである必要があります。実行時に `gh auth status` で認証状態を確認します。

## CLI

```bat
py tools\init-work\init_work.py Novel-005
```

作品IDにはASCII英数字と `.` `_` `-` のみ使用できます。

### オプション

```text
--factory-root <path>   NovelGameFactoryルート
--github-owner <owner>  作品repositoryを作成・参照するGitHub owner
--engine-repo <repo>    配布元Engine repository（owner/name）
```

既定値は実装内の定義を使用します。`NOVEL_GAME_FACTORY_ROOT`、`NOVEL_GAME_GITHUB_OWNER`、`CNE_REPOSITORY` の各環境変数で上書きできます。

## repository準備

対象は `<github-owner>/<work_id>` です。

- GitHub上にrepositoryが存在しない場合のみ `gh repo create --public --add-readme` で作成する
- GitHub上に既存repositoryが存在する場合、そのrepositoryおよびcommit履歴は削除しない
- ローカルの `<factory-root>/<work_id>` が存在する場合は、未commit・未追跡変更を含めてディレクトリを削除する
- その後、GitHub上の対象repositoryを `<factory-root>/<work_id>` へcloneし直す
- clone直後に `git rm -r .` を実行し、`.git` とGit履歴・remote情報は維持したまま、前回の生成成果物をwork treeから全削除する
- 空にしたwork treeへ最新Engine配布物と作品用初期構成を配置する
- 削除対象が `<factory-root>/<work_id>` そのものであることを確認してからローカル削除を行う
- 本ツールからGitHub repositoryを削除する処理は行わない

ローカル作品repositoryは⑧ゲーム実装工程によって再構築可能な作業領域です。残す必要がある手動修正は、再実行前にcommit / pushしてGitHub側へ保存してください。

Google Drive上の制作成果物および `NovelGameFactory/Common` 等の正本・入力資産は本ツールの削除対象ではありません。

## Engine配布物

Engine repositoryを一時cloneし、ルートの `engine-manifest.json` にある `distribution` の各項目を作品repositoryへコピーします。あわせて次を生成します。

```text
index.html
.nojekyll
.gitignore
build-manifest.json
content/
├─ scenario/
├─ images/
│  ├─ bg/
│  ├─ char/
│  ├─ title/
│  └─ item/
├─ audio/
│  ├─ bgm/
│  ├─ ambient/
│  └─ se/
├─ data/
└─ theme.css
logs/
```

`index.html` は `./engine/` へ遷移するルートランチャーです。`build-manifest.json` には作品ID、作品repository、Engine repository、取得したEngine revision、branch、versionを記録します。新規GitHub repositoryを作成した場合は作品repository用の `README.md` も生成します。

## 出力

成功時は最後にJSONを標準出力します。`repositoryAction` は `clone` です。失敗時は標準エラーへ `{"success": false, "error": "<message>"}` 形式のJSONを出力し、終了コード1で終了します。

## 注意事項

本ツールの再実行では、ローカルの `<factory-root>/<work_id>` を `.git` を含めて削除します。未commit・未追跡の変更は失われます。一方、GitHub上の作品repositoryは削除せず、clone元として継続利用します。

本ツールの責務はrepositoryの初期化・ローカル再構築とEngine配布物・基本ディレクトリの配置までです。commit / push、およびGitHub repositoryの削除は行いません。
