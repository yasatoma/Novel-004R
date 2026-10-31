# Engine UI sounds

ChappyNovelEngine自身が使用する共通UI効果音です。

- `U001.dat`: ゲーム開始／ロード等、ゲーム画面へ入る決定
- `U002.dat`: 通常の決定・メニュー操作
- `U003.dat`: キャンセル／閉じる／初期値リセット
- `credits.json`: Engine標準音源のクレジット情報

作品固有SE (`Sxxx.dat`) とは名前空間と配置を分離します。
ゲーム実装工程では `credits.json` を作品側クレジットへ統合し、同一クレジットは重複掲載しない運用とします。
