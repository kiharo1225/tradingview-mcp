# Browser モードのバージョン固定メモ

## 背景

このリポジトリは Windows で TradingView Desktop の MSIX 配布が増えたため、browser モードを本流として使えるように調整しています。

ただし browser モードは、Desktop `.exe` 固定とは違う種類の更新影響を受けます。

- Chrome / Edge 自体の自動更新
- TradingView Web 側の配信更新
- browser profile の状態変化

そのため、browser モードでは「何を固定できて、何は固定できないか」を分けて考える必要があります。

## 現時点の結論

### 固定しやすいもの

- **browser binary のバージョン**
  - `--browser-path` または `TV_MCP_BROWSER_PATH` で明示指定できます
  - 確認済みの Chrome / Edge 実行ファイルや、Chrome for Testing の固定版 binary を使う運用が可能です

- **browser profile**
  - `--browser-profile-dir` または `TV_MCP_BROWSER_PROFILE_DIR` で固定できます
  - 毎回同じ profile を使うことで、ログイン状態や UI 状態の再現性を上げられます

### 固定しにくいもの

- **TradingView Web の配信内容**
  - サーバー側の更新をローカルだけで止めることはできません
  - 同じ browser binary でも、TradingView 側更新で DOM や内部 API が変わる可能性があります

## このリポジトリで追加したこと

- `node src/cli/index.js launch --mode browser --browser-path <path>`
- `node src/cli/index.js launch --mode browser --browser-profile-dir <dir>`
- `tv_launch` に `browser_path`, `browser_profile_dir` を追加
- `TV_MCP_BROWSER_PATH`, `TV_MCP_BROWSER_PROFILE_DIR` に対応

## 推奨運用

1. 確認済みの browser binary を用意する
2. 専用 profile を固定する
3. `status` / `quote` / `ohlcv --summary` などの smoke test を残す
4. 動作確認日と browser バージョンを記録する
5. TradingView Web 側の変化に備えて、壊れたら `status` の診断項目で差分を見る

現在の `npm run smoke:browser` は、read 系確認に加えて browser version も JSON に含めて出力します。確認済み環境を残すときは、この出力を一緒に保存しておくと比較しやすいです。

## 現実的な選択肢

### 1. Chrome for Testing を使う

一番現実的です。通常 Chrome より「この版を使う」がやりやすく、テスト用途に向いています。

### 2. 通常の Chrome / Edge に更新ポリシーを入れる

企業管理端末なら可能性がありますが、個人開発環境では重いです。

### 3. browser binary は固定し、TradingView Web 更新は受け入れる

今のこのリポジトリでは、まずこの方針が現実的です。

## 公式情報

- Chrome for Testing:
  - https://developer.chrome.com/blog/chrome-for-testing

- Chrome update 管理:
  - https://support.google.com/chrome/a/answer/6350036

- Microsoft Edge update policy reference:
  - https://learn.microsoft.com/deployedge/microsoft-edge-update-policies

## 今後の残課題

- Chrome for Testing を前提にした運用手順を README / SETUP にどこまで書くか
- browser 起動結果に browser version をより分かりやすく残すか
- smoke test を簡単に流せるコマンドを増やすか
