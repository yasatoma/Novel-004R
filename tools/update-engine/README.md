# update-engine

リリース済み・制作中のChappyNovelEngine作品repositoryについて、作品固有の `content/` を変更せず、`engine/` を最新Engineへ交換するツールです。

## 基本方針

- 更新時は既存 `engine/` を残したまま上書きコピーせず、最新版で丸ごと置換する
- 作品側で `engine/` を独自変更していても更新を禁止しない。必要な独自変更の引き継ぎは更新作業の中で別途確認する
- `content/` は変更しない
- migrationは本ツールの責務に含めない。必要な場合は別途migration資料に従って実施する
- Validate・実動作確認も本ツールの後工程とする
- commit / pushは行わない

## build-manifest.json

本ツールの実行には、作品repository直下に `build-manifest.json` が必要です。

### 必須項目

更新前に必要なのは次の3項目です。

- `workId`
- `repository`
- `engine.version`

最小構成例:

```json
{
  "workId": "Novel-004R",
  "repository": "yasatoma/Novel-004R",
  "engine": {
    "version": "1.1"
  }
}
```

`engine.revision`、`engine.repository`、`engine.branch` は更新前の必須項目ではありません。
旧作品など `build-manifest.json` が存在しない作品は、現在使用しているEngine versionを確認し、上記の最小構成を手動で作成してから本ツールを実行できます。

更新成功後は、`engine` 情報を最新版の次の情報へ更新します。

- `repository`
- `revision`（更新時に取得したEngineのGit commit SHA）
- `branch`
- `version`

`revision` は「現在どの時点のEngineを使用しているか」を記録するための情報であり、更新可否の判定には使用しません。

## CLI

```bat
py tools\update-engine\update_engine.py Novel-004R
```

### オプション

```text
--factory-root <path>   NovelGameFactoryルート
--github-owner <owner>  作品repositoryのGitHub owner
--engine-repo <repo>    更新元Engine repository（owner/name）
```

既定値は実装内の定義を使用します。環境変数 `NOVEL_GAME_FACTORY_ROOT`、`NOVEL_GAME_GITHUB_OWNER`、`CNE_REPOSITORY` で上書きできます。

## 処理

1. 対象作品repositoryとoriginを確認する
2. `build-manifest.json` の必須項目と作品ID / repositoryの整合を確認する
3. 最新Engine repositoryを取得する
4. 最新 `engine/` を一時領域へコピーする
5. 既存 `engine/` を全削除する
6. 一時領域の最新版 `engine/` を配置する
7. `build-manifest.json` のEngine repository / revision / branch / versionを更新する

`content/`、`tools/`、`schemas/` は変更しません。

## 独自変更がある作品

作品側の `engine/` に独自変更があっても、本ツールは更新を禁止しません。
本ツールは既存 `engine/` を丸ごと置換するため、必要な独自変更がある場合は更新作業の中で内容を確認し、最新版Engineへ引き継ぐかを判断してください。

自動更新ではなく、人またはAIが意図して実施する保守作業を前提とします。

## 後工程

Engine更新後は、更新元・更新先バージョンを確認します。

migrationが必要なバージョンを跨ぐ場合はmigration資料に従って必要な変更を行い、その後 `validate-work` と実動作確認を実施します。

## 出力

成功時はJSONを標準出力します。更新前のEngine versionは `fromEngineVersion`、更新後は `engineVersion` として出力します。`contentChanged` は常に `false` です。

失敗時は標準エラーへ `{"success": false, "error": "<message>"}` 形式のJSONを出力し、終了コード1で終了します。
