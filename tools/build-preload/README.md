# build-preload

シナリオを解析し、実行時プリロードの順序を示す `content/data/preload-assets.json` を生成します。

## 実行

```bat
tools\build-preload\build_preload.bat
```

または、

```bat
py tools\build-preload\build_preload.py
```

## 性質

- `preload-assets.json` は性能改善用の補助データです。
- ファイルが無い・古い・プリロードに失敗した場合でも、ゲーム本体は停止しません。
- 実行時に必要になった素材は通常のバックグラウンドプリロードより優先して取得します。
- シナリオの物理行番号ではなく `@text show id=...` を位置アンカーに使います。
- 同じ素材が後半で再利用される場合に備え、使用箇所は text ID ごとに保持します。
- `scenarioRevision` は現在のシナリオとの一致確認用で、Engine更新判定には使いません。

シナリオを手動調整した後は、このツールだけを再実行すれば更新できます。
