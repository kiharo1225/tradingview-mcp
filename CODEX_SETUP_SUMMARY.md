# Codex で動かすための要約

このリポジトリは、TradingView Desktop を Chrome DevTools Protocol（CDP, `--remote-debugging-port=9222`）経由で操作する MCP サーバー / CLI です。

README は主に Claude Code 向けに書かれていますが、Codex で使う場合も、まずはローカルでサーバーと TradingView を正しく起動できる状態を作れば進められます。

## まず理解しておくこと

- TradingView Desktop アプリが必要
- 有効な TradingView サブスクリプションが必要
- Node.js 18 以上が必要
- このツールは TradingView のサーバーには接続せず、ローカル起動中の Desktop アプリにだけ接続する
- TradingView Desktop は `--remote-debugging-port=9222` 付きで起動する必要がある
- 内部 API を使うため、TradingView のアップデートで動かなくなる可能性がある

## Codex で使うときの実施手順

### 1. 依存関係を入れる

このリポジトリで以下を実行します。

```bash
npm install
```

## 2. TradingView Desktop をデバッグモードで起動する

Windows なら README 上の推奨は以下です。

```bat
scripts\launch_tv_debug.bat
```

手動起動する場合は、TradingView の実行ファイルに `--remote-debugging-port=9222` を付けます。

例:

```bat
%LOCALAPPDATA%\TradingView\TradingView.exe --remote-debugging-port=9222
```

## 3. まずは CLI で動作確認する

Codex では、MCP 組み込みより先に CLI で確認するのが安全です。

```bash
node src/cli/index.js status
```

または `npm link` 後に:

```bash
tv status
```

ここで接続確認できれば、CDP 経由の基本動作は通っています。

## 4. 必要なら MCP サーバーとして起動する

このプロジェクトのサーバー本体は [`src/server.js`](/c:/Users/hayan/git/tradingview-mcp/src/server.js) です。

ローカル起動コマンド:

```bash
node src/server.js
```

`package.json` 上の `start` も同じです。

```bash
npm start
```

## 5. MCP クライアントに登録する

README では Claude Code 用に、以下のような MCP 設定を追加する前提になっています。

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/path/to/tradingview-mcp/src/server.js"]
    }
  }
}
```

Codex 側で MCP 設定を使う場合も、基本的な考え方は同じです。

- `command` は `node`
- `args` はこのリポジトリの `src/server.js`
- クライアント再起動が必要な場合がある

注意:

- README に書かれている設定パスは Claude Code 用 (`~/.claude/.mcp.json`)
- Codex 固有の MCP 設定場所は README には書かれていない
- そのため、Codex 連携はまず CLI で確認してから進めるのが安全

## 6. 接続確認の基準

まず試すコマンド:

```bash
node src/cli/index.js status
node src/cli/index.js quote
node src/cli/index.js screenshot -r chart
```

MCP 連携まで行くなら、README では `tv_health_check` の利用が推奨されています。

## よく使う確認コマンド

```bash
node src/cli/index.js status
node src/cli/index.js symbol AAPL
node src/cli/index.js ohlcv --summary
node src/cli/index.js pine compile
```

## テスト

TradingView が `--remote-debugging-port=9222` 付きで起動している状態で:

```bash
npm test
```

利用可能な script は [`package.json`](/c:/Users/hayan/git/tradingview-mcp/package.json) にあります。

## つまずきやすい点

- `cdp_connected: false`
- `ECONNREFUSED`
- `npm` / `node` が見つからない
- TradingView が通常起動で、9222 ポートが開いていない
- MCP クライアントの設定に `src/server.js` の絶対パスが入っていない
- TradingView 起動直後で、画面や Pine Editor がまだ読み込み中

## `npm` が見つからないとき

PowerShell で次のようなエラーが出る場合:

```powershell
npm : 用語 'npm' は、コマンドレット、関数、スクリプト ファイル、または操作可能な
プログラムの名前として認識されません
```

原因はほぼ次のどちらかです。

- Node.js が未インストール
- Node.js は入っているが PATH が通っていない

このリポジトリでは `npm` だけでなく `node` も必要なので、まず Node.js 18 以上を入れてください。

確認コマンド:

```powershell
node -v
npm -v
```

両方ともバージョンが返る状態になってから、改めて以下を実行します。

```powershell
npm install
```

Windows でインストーラ実行後も `node -v` が通らない場合は、`C:\Program Files\nodejs` が PATH に反映されていない可能性があります。

確認ポイント:

```powershell
Test-Path 'C:\Program Files\nodejs\node.exe'
Test-Path 'C:\Program Files\nodejs\npm.cmd'
```

どちらも `True` なのに `node -v` が失敗する場合は、PowerShell を開き直すか、一時的に PATH を通してください。

一時対応:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
node -v
npm -v
```

その後:

```powershell
npm install
```

## Codex でのおすすめ進め方

1. `npm install`
2. TradingView を `--remote-debugging-port=9222` 付きで起動
3. `node src/cli/index.js status` で確認
4. 問題なければ `quote` や `ohlcv --summary` を試す
5. その後に必要なら MCP クライアント設定へ進む

## 補足

この README / SETUP_GUIDE から判断すると、Codex で最短で触る方法は「まず CLI で使うこと」です。MCP 統合はその後段階的に進めるのが現実的です。
