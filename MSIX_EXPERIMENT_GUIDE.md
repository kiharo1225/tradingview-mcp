# TradingView MSIX 検証手順書

この手順書は、TradingView の Windows 配布が MSIX 形式になっている前提で、Chrome DevTools Protocol（CDP, `--remote-debugging-port=9222`）を有効化できる余地があるかを実験的に検証するためのものです。

目的は、次の 3 つを切り分けることです。

1. MSIX 版 TradingView は通常起動時に CDP を有効化できるのか
2. MSIX を展開して登録し直した場合に、起動経路を制御できるのか
3. もし制御できるなら、このリポジトリから接続できるのか

## 先に結論

この実験は成功保証がありません。

- 成功する可能性はある
- ただし TradingView 側が package identity や MSIX 固有の起動文脈に依存していると失敗する可能性が高い
- 単純な「解凍して exe を叩く」だけでは不十分な場合がある

## 前提

- Windows
- Node.js と `npm install` 済み
- `C:\Users\hayan\git\tradingview-mcp` を使用中
- TradingView の配布物として `.msix` がある
- PowerShell を管理者で開けることが望ましい

## 実験の流れ

1. まず現行の MSIX 版を通常の方法で起動し、CDP が開かないことを再確認する
2. MSIX を展開して中身を確認する
3. 展開した構成に `TradingView.exe` または相当する起動ファイルがあるか調べる
4. 可能なら展開版を登録して起動経路を再構成する
5. そのうえで `localhost:9222` が開くか検証する

## Phase 1: 現状確認

まず、今の状態で CDP が開いていないことを確認します。

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:9222/json/version
```

失敗するのが現状です。

次に、TradingView の接続確認。

```powershell
node src/cli/index.js status
```

想定:

- `fetch failed`
- `CDP connection failed`

この確認が取れたら次に進みます。

## Phase 2: MSIX を展開する

まず作業用フォルダを作ります。

```powershell
New-Item -ItemType Directory -Force C:\Users\hayan\Desktop\tradingview-msix-unpacked
```

次に、`.msix` を zip として展開します。

```powershell
Copy-Item C:\Users\hayan\Downloads\TradingView.msix C:\Users\hayan\Desktop\TradingView.zip
Expand-Archive -LiteralPath C:\Users\hayan\Desktop\TradingView.zip -DestinationPath C:\Users\hayan\Desktop\tradingview-msix-unpacked -Force
```

確認:

```powershell
Get-ChildItem C:\Users\hayan\Desktop\tradingview-msix-unpacked
```

見たいもの:

- `AppxManifest.xml`
- `VFS`
- `Assets`
- `TradingView.exe` またはそれに近い実行ファイル

## Phase 3: 起動ファイルを特定する

展開先から候補を探します。

```powershell
Get-ChildItem C:\Users\hayan\Desktop\tradingview-msix-unpacked -Recurse -Filter *.exe | Select-Object FullName
```

注目する点:

- `TradingView.exe` があるか
- `msedgewebview2` ではなくアプリ本体の exe があるか
- `VFS\ProgramFilesX64\...` 配下に実体があるか

もし exe が見つかったら、そのパスをメモしてください。

## Phase 4: 直起動の可否を試す

exe が見つかった場合だけ、まずは単純起動を試します。

```powershell
& "見つけたexeのフルパス" --remote-debugging-port=9222
```

別ターミナルで確認:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:9222/json/version
```

結果の読み方:

- 9222 が開いた: 直起動の可能性あり
- アプリが起動しない: MSIX の登録文脈が必要な可能性が高い
- 起動するが 9222 が開かない: 引数が無視されている可能性が高い

## Phase 5: Manifest を確認する

`AppxManifest.xml` の中を見て、実際のエントリポイントを確認します。

```powershell
Get-Content C:\Users\hayan\Desktop\tradingview-msix-unpacked\AppxManifest.xml
```

見るポイント:

- `Applications`
- `Executable`
- `EntryPoint`
- `Identity`

ここで、どの exe がアプリ起動の本体かを確認します。

## Phase 6: 展開版を登録して起動する

単純起動がダメでも、登録ベースなら動く可能性があります。

注意:

- これは Windows のアプリ登録に影響します
- 既存の Store 版と競合する可能性があります
- 不安なら先に復元ポイントやメモを残してください

展開フォルダの manifest を登録:

```powershell
Add-AppxPackage -Register C:\Users\hayan\Desktop\tradingview-msix-unpacked\AppxManifest.xml
```

エラーが出る場合は、署名や依存関係の問題で登録できない可能性があります。

登録後、アプリ一覧を確認:

```powershell
Get-AppxPackage | Where-Object { $_.Name -like '*TradingView*' }
```

## Phase 7: 登録後の起動方法を探す

登録後に AppUserModelID が見えるか確認します。

```powershell
Get-StartApps | Where-Object { $_.Name -like '*TradingView*' -or $_.AppID -like '*TradingView*' }
```

見つかったら、`shell:AppsFolder\<AppID>` で起動できるか確認します。

例:

```powershell
explorer.exe "shell:AppsFolder\見つかったAppID"
```

## Phase 8: 起動引数注入を再検証する

登録後のアプリ起動に対して、環境変数で引数注入が効くか試します。

```powershell
$env:ELECTRON_EXTRA_LAUNCH_ARGS="--remote-debugging-port=9222"
explorer.exe "shell:AppsFolder\見つかったAppID"
```

その後:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:9222/json/version
```

ここで成功すれば、このリポジトリ側の MSIX 対応強化に進む価値があります。

## Phase 9: このリポジトリで接続確認

9222 が開いたら、このリポジトリから接続確認します。

```powershell
cd C:\Users\hayan\git\tradingview-mcp
node src/cli/index.js status
node src/cli/index.js quote
```

想定:

- `status` が成功する
- `quote` が返る

これが通れば、MCP / CLI 側は成立します。

## 成功パターン

実験成功とみなせるのは次の状態です。

- `http://localhost:9222/json/version` が返る
- `node src/cli/index.js status` が成功する
- TradingView のチャートターゲットが CDP から見える

## 失敗パターン

次のどれかなら、現時点では Windows MSIX 版は厳しいです。

- 展開しても exe が見つからない
- exe はあるが起動できない
- 起動できても `--remote-debugging-port=9222` が効かない
- 登録し直しても `ELECTRON_EXTRA_LAUNCH_ARGS` が効かない
- 9222 が開いても TradingView のチャート target が見えない

## 実験ログの残し方

最低限、以下をメモしてください。

- どの手順で起動できたか
- `localhost:9222/json/version` が返ったか
- `Get-StartApps` で見えた AppID
- `node src/cli/index.js status` の結果

## おすすめの進め方

最初から大きくいじらず、次の順で進めるのが安全です。

1. 展開して exe の有無を確認
2. exe 直起動を試す
3. ダメなら manifest と entrypoint を確認
4. 必要なら登録して再検証
5. 9222 が開いた時点でこのリポジトリの接続確認をする

## 最後に

この実験は「MSIX でも理論上いけるか」を確かめるためのものです。成功したら、このリポジトリの Windows 起動ロジックをさらに実用レベルへ寄せられます。失敗した場合も、どの段階で詰まったかが分かれば、README に正確な制約を書けます。
