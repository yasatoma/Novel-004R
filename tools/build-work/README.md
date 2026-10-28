# build_work

⑧ゲーム実装工程で、作品GitHub repositoryを準備し、ChappyNovelEngineの作品作業領域をクリーン再構築するためのツールです。

## 実行

```bat
py tools\build-work\build_work.py Novel-005
```

作品IDは必須です。既定では次を使用します。

- Factory root: `C:\Users\TOMATO\source\repos\_codex\NovelGameFactory`
- GitHub owner: `yasatoma`
- 作品repository: `yasatoma/<作品ID>`
- Engine: `yasatoma/ChappyNovelEngine` の `main`

必要なら `NOVEL_GAME_FACTORY_ROOT`、`NOVEL_GAME_GITHUB_OWNER`、`CNE_REPOSITORY` 環境変数、または対応するコマンドラインoptionで上書きできます。

## 処理

1. GitHubに作品repositoryがなければPublic repositoryを作成する。
2. ローカルに作品repositoryがなければcloneする。
3. 既にclone済みなら `origin` と作業ツリーを確認し、`git pull --ff-only` する。
4. `.git` を保護し、それ以外の作品内容を削除する。
5. ChappyNovelEngine `main` を一時cloneし、`engine/` と `tools/` を配置する。
6. 作品rootの `index.html` は `engine/` へ遷移するランチャーとして生成する。
7. Engine側のサンプル `content/` はコピーせず、作品用 `content/` の空ディレクトリ構造と空の `theme.css` を作る。
8. `.nojekyll` と生成用一時ディレクトリを除外する `.gitignore` を生成する。
9. `build-manifest.json` に作品ID・repository・Engine commit SHAを記録する。

## 安全規則

- `.git` は削除しない。
- `origin` が期待するGitHub repositoryと異なる場合は削除前に停止する。
- 未commitまたは未追跡ファイルがある場合は削除前に停止する。
- pullは `--ff-only` とし、rebase/reset/forceは行わない。
- commit/pushは行わない。検証成功後に⑧工程が実施する。
- Engine repositoryのサンプル作品データは作品repositoryへコピーしない。

## 現段階の責務

この初版は、ENG-01のうち **repository準備・同期・安全なクリーン・Engine配布物配置・Engine revision記録** を実装します。

⑥/⑦成果物、画像変換結果、音声変換結果、scenario/config/data/theme等の作品固有成果物の投入は、各入出力契約が確定した後に同ツールへ追加します。サンプルデータを推測で流用しません。
