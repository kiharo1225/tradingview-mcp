# TradingView MCP Bridge

TradingView Desktop のチャートを扱うための個人向け AI アシスタントです。Chrome DevTools Protocol を通じて、ローカルで起動している TradingView アプリを Claude Code と接続し、AI によるチャート分析、Pine Script 開発、ワークフロー自動化を実現します。

> [!WARNING]
> **このツールは TradingView Inc. と提携・承認・関係しているものではありません。** Chrome DevTools Protocol を通じて、ローカルで動作中の TradingView Desktop アプリケーションとやり取りします。利用前に [免責事項](#disclaimer) を確認してください。

> [!IMPORTANT]
> **有効な TradingView サブスクリプションが必要です。** このツールは TradingView の有料機能やアクセス制御を回避するものではありません。あなたのマシン上ですでに動作している TradingView Desktop アプリを読み取り、操作するだけです。

> [!NOTE]
> **すべてのデータ処理はあなたのローカル環境で完結します。** このツールが TradingView のデータを外部へ送信、保存、再配布することはありません。

> [!CAUTION]
> このツールは Electron のデバッグインターフェース経由で、文書化されていない TradingView の内部 API にアクセスします。これらは TradingView の更新で予告なく変更・破損する可能性があります。安定性が重要なら、TradingView Desktop のバージョン固定を推奨します。

## 仕組み（そして安全に実行できる理由）

このツールは TradingView のサーバーには接続せず、TradingView のファイルを変更せず、ネットワークトラフィックを傍受もしません。通信先は、あなたのローカルで起動している TradingView Desktop インスタンスのみで、接続には Chrome DevTools Protocol（CDP）を使います。CDP は Google が提供する Chromium / Electron 系アプリ共通の標準デバッグインターフェースで、VS Code、Slack、Discord などにも組み込まれています。

デバッグポートはデフォルトでは無効で、標準の Chromium フラグ `--remote-debugging-port=9222` を使って、あなた自身が明示的に有効化する必要があります。その意図的な操作を行わない限り、何も起こりません。

## このツールがしないこと

- TradingView のサーバーや API に接続すること
- 市場データを保存、送信、再配布すること
- 有効な TradingView サブスクリプションや Desktop アプリなしで動作すること
- TradingView の有料機能やアクセス制限を回避すること
- 実際の売買を実行すること（チャート操作のみ）
- TradingView の内部 Electron 構造が変わっても動き続けること

## 研究の背景

このプロジェクトは、次の未解決の研究課題を探るものです。**LLM ベースのエージェントは、専門的なトレーディングインターフェースとどのように相互作用し、人間の意思決定を支援できるのか？**

具体的には、以下を検証しています。

- 構造化されたツール API（MCP）が、LLM と状態を持つデスクトップ金融アプリケーションの橋渡しをどう実現できるか
- エージェントがライブチャートデータ上で動作する際に、どのようなレイテンシ、コンテキスト、信頼性の制約が発生するか
- エージェントが曖昧な金融 UI の状態をどう扱うか（例: Pine Script 出力の解釈、インジケータテーブルの読み取り）
- 自然言語がチャート操作や Pine Script 開発のインターフェースとして有効かどうか
- リアルタイムデータ環境で動く LLM エージェントの失敗パターン

これはトレーディングボットではありません。トレーディングアプリケーションを LLM エージェントにとって理解可能な形にするインターフェース層であり、研究者や開発者が金融ワークフローにおける人間と AI の協調を調査できるようにするものです。

未解決の課題、知見、関連研究については [RESEARCH.md](RESEARCH.md) を参照してください。

## 前提条件

- **TradingView Desktop アプリ**（リアルタイムデータには有料サブスクリプションが必要）
- **Node.js 18+**
- **MCP 対応の Claude Code**（MCP ツール利用時）または任意のターミナル（CLI 利用時）
- **macOS / Windows / Linux**

## できること

あなた自身のチャートに対して、AI アシスタントに「目」と「手」を与えます。

- **Pine Script 開発**: AI の支援で、スクリプトの作成、注入、コンパイル、デバッグ、反復改善ができます
- **チャート操作**: 銘柄変更、時間足変更、日付へのズーム、インジケータの追加・削除ができます
- **ビジュアル分析**: チャート上のインジケータ値、価格レベル、注釈を読み取れます
- **チャートへの描画**: トレンドライン、水平線、矩形、テキスト注釈を追加できます
- **アラート管理**: 価格アラートの作成、一覧表示、削除ができます
- **リプレイ練習**: 過去バーを 1 本ずつ進めながら、エントリーやイグジットの練習ができます
- **スクリーンショット**: AI による視覚分析用にチャート状態をキャプチャできます
- **マルチペインレイアウト**: 2x2、3x1 などのグリッドを作成し、各ペインに異なる銘柄を設定できます
- **チャート監視**: ローカルで動作中のチャートから JSONL をストリーミングし、ローカル監視スクリプトで利用できます
- **CLI アクセス**: すべての MCP ツールは `tv` CLI コマンドとしても利用でき、JSON 出力でパイプ処理しやすくなっています
- **TradingView 起動**: 任意のプラットフォームでインストール先を自動検出し、デバッグモードで起動できます

## Claude Code でのインストール

以下を Claude Code に貼り付ければ、残りを処理してくれます。

> Install the TradingView MCP server. Clone https://github.com/tradesdontlie/tradingview-mcp.git, run npm install, add it to my MCP config at ~/.claude/.mcp.json, and launch TradingView with the debug port. Then verify the connection with tv_health_check.

手動で進める場合は、以下の手順に従ってください。

## クイックスタート

### 1. インストール

```bash
git clone https://github.com/tradesdontlie/tradingview-mcp.git
cd tradingview-mcp
npm install
```

### 2. CDP を有効にして TradingView を起動

TradingView Desktop または TradingView Web を開いた Chromium ブラウザを、ポート 9222 で Chrome DevTools Protocol を有効にした状態で起動している必要があります。

> [!IMPORTANT]
> **Windows では browser モードを推奨します。**
> 現行の TradingView Desktop は MSIX / Store 配布が中心で、CDP を有効化できない場合があります。一方で browser モードは、専用 Chrome プロファイルを使って `https://www.tradingview.com/chart/` を開くため、Windows でも安定して接続しやすいです。

**Mac:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

Windows で TradingView が MSIX / Store 形式で配布されている場合も、`launch_tv_debug.bat` と `tv_launch` は `shell:AppsFolder` 経由の起動を試みます。

> [!WARNING]
> **Windows の現行 MSIX / Store 版では、CDP が有効化できず接続に失敗する場合があります。**
> このリポジトリには MSIX 版を検出して起動を試みる処理が入っていますが、実環境では `ELECTRON_EXTRA_LAUNCH_ARGS` や通常の `--remote-debugging-port=9222` が効かず、`tv status` / `tv_health_check` が失敗するケースを確認しています。
> Windows で動かない場合は、まず `node src/cli/index.js status` で確認してください。`fetch failed` のままなら、現時点ではその MSIX ビルドでは未対応の可能性があります。

> [!NOTE]
> `scripts/launch_tv_debug.vbs`、MSIX 展開、`app.asar` 解析、`Add-AppxPackage -Register AppxManifest.xml` などは **実験的な調査用フロー** です。通常セットアップ手順には含めていません。

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

**推奨: browser モード**
```bash
node src/cli/index.js launch --mode browser
```

このモードは Chrome / Edge を `https://www.tradingview.com/chart/` 付きで起動し、既存の CDP 接続ロジックをそのまま使います。専用の一時プロファイルで起動するため、既存の Chrome セッションに引数が吸われにくく、Windows の現行 MSIX 版で詰まる場合の正式な代替ルートとして使えます。

browser モードで固定した browser binary を使いたい場合:

```bash
node src/cli/index.js launch --mode browser --browser-path "/path/to/chrome-or-edge"
```

または環境変数:

```bash
TV_MCP_BROWSER_PATH=/path/to/chrome-or-edge
TV_MCP_BROWSER_PROFILE_DIR=/path/to/profile
node src/cli/index.js launch --mode browser
```

用途:

- 自動更新される通常の Chrome / Edge ではなく、確認済みの browser binary を明示して使いたい
- 専用 profile を固定して、毎回同じ browser state に近づけたい
- Chrome for Testing のような versioned binary を差し込みたい

補足:

- browser 側のバージョン固定は Desktop `.exe` の固定と完全には同じではありません
- browser binary 自体は固定できても、TradingView Web の配信内容はサーバー側更新の影響を受けます
- そのため browser モードでは「固定 binary + 専用 profile + 動作確認日の記録」で再現性を上げる運用を推奨します

**または任意のプラットフォームで手動起動:**
```bash
/path/to/TradingView --remote-debugging-port=9222
```

**ブラウザを手動起動する場合:**
```bash
/path/to/chrome --remote-debugging-port=9222 --new-window https://www.tradingview.com/chart/
```

**または MCP ツールを使う**（インストール先を自動検出）:
> "Use tv_launch to start TradingView in debug mode"

browser モードを明示する場合:
> "Use tv_launch with mode=browser"

接続確認:
```bash
node src/cli/index.js status
```

browser モードの成功例:

- `target_url: "https://www.tradingview.com/chart/"`
- `api_available: true`
- `chart_symbol`, `chart_resolution`, `chart_type` が返る

Windows + browser モードで確認済みのコマンド:

- `node src/cli/index.js status`
- `node src/cli/index.js quote`
- `node src/cli/index.js ohlcv --summary`
- `node src/cli/index.js discover`
- `node src/cli/index.js ui-state`
- `node src/cli/index.js screenshot -r chart`
- `node src/cli/index.js symbol <ticker>`
- `node src/cli/index.js timeframe <resolution>`
- `node src/cli/index.js watchlist get`
  - 現行 browser UI では `data-symbol-full` ベースで symbol 一覧の取得を確認済みです
  - 現行 session によっては rows が `pending` のまま残ることがあります。その場合でも `hydration_source: "quote_session"` と `hydrated_count` を返し、quote session から取得できた symbol だけ `last/change/change_percent` を部分補完します
- `node src/cli/index.js watchlist add <symbol>` の一部
  - 現行 session では `watchlist_visible_rows: true` と `watchlist_contains_symbol: true` を返し、`state: "confirmed_visible"` まで確認できるケースがあります
- `node src/cli/index.js indicator get <entity_id>`
- `node src/cli/index.js indicator toggle <entity_id>`
- `node src/cli/index.js values`
- `node src/cli/index.js pane list`
- `node src/cli/index.js tab list`
- `node src/cli/index.js layout list`
- `node src/cli/index.js alert list`
  - 内部 API が不安定でも、Alerts パネルに「Create alert」が見えている場合は DOM fallback で `state: "no_alerts"` を返します
- `node src/cli/index.js draw list`
- `node src/cli/index.js pine get`
- `node src/cli/index.js pine errors`
- `node src/cli/index.js pine console`
- `node src/cli/index.js stream quote`
- `node src/cli/index.js stream bars`

browser モードで部分的に確認済み / 条件つきのコマンド:

- `node src/cli/index.js watchlist add <symbol>`
  - 現在の右ペインが watchlist ビューであることが前提です
  - 現在は `watchlist_visible_rows` と `watchlist_contains_symbol` も返し、実際に watchlist 側へ表示反映できたかの手がかりを返します
  - 現行 session では `state: "confirmed_visible"` まで確認できるケースがありますが、環境差はまだ残ります
- `node src/cli/index.js indicator add <name>`
- `node src/cli/index.js indicator remove <entity_id>`
  - mutation 自体は通りますが、`state` の `studies` 一覧はタイミングにより古い entity が残って見える場合があります
- `batchRun(get_ohlcv)`
  - 代表ケースでは成功済みですが、browser モードでは still slower than ideal です
- `batchRun(screenshot)`
  - 成功確認済みです

browser モードで未確認または制約が強いもの:

- `node src/cli/index.js alert create`
  - account state を変更するため慎重に扱っています
- `node src/cli/index.js alert delete --all`
  - 手動確認前提の DOM fallback で、`state: "manual_confirmation_required"` を返します
- `node src/cli/index.js layout switch <name>`
  - 保存済み layout がない環境では未確認ですが、存在しない名前に対しては `Layout "<name>" not found.` で安全に失敗します
- replay 系
  - account / paywall の影響を受けます
  - 現行 browser session では `replay status` は取得でき、`is_replay_toolbar_visible` / `is_ready_to_play` / `ui_ready_to_play` も返します
  - 実機では `replay start` は「Bar replay ボタンは見えているが toolbar が visible にならず、replay UI も ready_to_play にならない。TradingView Web の account / sign-in / feature gate が噛んでいる可能性がある」と分かるメッセージで安全に失敗することを確認しています

補足:

- `chart_ready` の戻り値は改善済みですが、環境やページ状態によってはまだ差が出る可能性があります。
- `pine get`, `pine errors`, `pine console` は browser モードでも read 系として確認済みです。
- `symbol` / `pane symbol` は、symbol search や既知のダイアログが残っている session でも recovery を試み、必要に応じて reload fallback を使います。
- 複数の TradingView page / tab / window が同時にある場合でも、接続時に複数 target を probe して、見ている chart に近い target を優先するようにしています。
- `status` と `quote` には `visible_symbol_button`, `main_series_symbol`, `legend_title`, `legend_matches_chart`, `legend_matches_symbol`, `chart_loading`, `series_loaded`, `series_completed` などの診断情報が含まれます。browser モードで違和感があるときは、まずこれらを確認してください。
- `legend_title` は現行 Web UI では `Change symbol` ボタンのタイトルを優先して拾うため、`Apple Inc.` のような銘柄説明と `Vol` のような indicator 名を取り違えにくくしています。
- `watchlist get` には `pending_count` と `all_pending` も含まれます。値が `null` でも、現時点では parser の問題ではなく widget 側が `pending` だと切り分けしやすくしています。
- TradingView 側の UI 更新が遅れると、データ自体は正しくても legend や説明ラベルだけ古い銘柄名のまま残る場合があります。このため、README の確認済みは「データ面の一致」と「可視 UI の一致」を分けて見ています。現在は best-effort で legend 同期も試みていますが、環境によっては一時的に stale 表示が残る可能性があります。

### 3. Claude Code に追加

Claude Code の MCP 設定（`~/.claude/.mcp.json` またはプロジェクトの `.mcp.json`）に追加します。

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

`/path/to/tradingview-mcp` は実際のパスに置き換えてください。

### 4. 接続確認

Claude に次のように依頼します。*"Use tv_health_check to verify TradingView is connected"*

## CLI

すべての MCP ツールは `tv` CLI コマンドとしても利用できます。出力はすべて JSON なので、`jq` と組み合わせてパイプ処理できます。

```bash
# グローバルインストール（任意）
npm link

# または直接実行
node src/cli/index.js <command>
```

### クイック例

```bash
tv status                          # 接続確認
tv quote                           # 現在価格
tv symbol AAPL                     # 銘柄変更
tv ohlcv --summary                 # 価格サマリー
tv screenshot -r chart             # チャートをキャプチャ
tv pine compile                    # Pine Script をコンパイル
tv pane layout 2x2                 # 4 チャートのグリッド
tv pane symbol 1 ES1!              # ペイン 1 の銘柄を設定
tv stream quote | jq '.close'      # 価格変化を監視
```

### すべてのコマンド

```
tv status / launch / state / symbol / timeframe / type / info / search
tv quote / ohlcv / values
tv data lines/labels/tables/boxes/strategy/trades/equity/depth/indicator
tv pine get/set/compile/analyze/check/save/new/open/list/errors/console
tv draw shape/list/get/remove/clear
tv alert list/create/delete
tv watchlist get/add
tv indicator add/remove/toggle/set/get
tv layout list/switch
tv pane list/layout/focus/symbol
tv tab list/new/close/switch
tv replay start/step/stop/status/autoplay/trade
tv stream quote/bars/values/lines/labels/tables/all
tv ui click/keyboard/hover/scroll/find/eval/type/panel/fullscreen/mouse
tv screenshot / discover / ui-state / range / scroll
```

## ストリーミング

`tv stream` コマンドは、localhost 上の Chrome DevTools Protocol を通じて、ローカルで動作中の TradingView Desktop インスタンスを一定間隔でポーリングします。

TradingView のサーバーへ接続することはなく、データはすべてあなたのマシン内に留まります。

> [!WARNING]
> TradingView データをプログラムから利用することは、データの取得元にかかわらず、利用規約に抵触する可能性があります。利用が規約に準拠していることの確認は、すべてあなたの責任です。

```bash
tv stream quote                          # 価格ティックの監視
tv stream bars                           # バーごとの更新
tv stream values                         # インジケータ値の監視
tv stream lines --filter "NY Levels"     # 価格レベルの監視
tv stream tables --filter Profiler       # テーブルデータの監視
tv stream all                            # すべてのペインを同時監視（複数銘柄）
```

## Claude がどのツールを使うかをどう判断するか

Claude は、このプロジェクトで作業するとき [`CLAUDE.md`](CLAUDE.md) を自動的に読みます。そこには完全な判断フローが書かれています。

| あなたの指示 | Claude が使うもの |
|------------|---------------|
| "What's on my chart?" | `chart_get_state` → `data_get_study_values` → `quote_get` |
| "What levels are showing?" | `data_get_pine_lines` → `data_get_pine_labels` |
| "Read the session table" | `study_filter` 付きの `data_get_pine_tables` |
| "Give me a full analysis" | `quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `data_get_pine_tables` → `data_get_ohlcv`（summary）→ `capture_screenshot` |
| "Switch to AAPL daily" | `chart_set_symbol` → `chart_set_timeframe` |
| "Write a Pine Script for..." | `pine_set_source` → `pine_smart_compile` → `pine_get_errors` |
| "Start replay at March 1st" | `replay_start` → `replay_step` → `replay_trade` |
| "Set up a 4-chart grid" | `pane_set_layout` → 各ペインに対する `pane_set_symbol` |
| "Draw a level at 24500" | `draw_shape`（horizontal_line） |
| "Take a screenshot" | `capture_screenshot` |

## ツールリファレンス（78 個の MCP ツール）

### チャート読み取り

| Tool | 使うタイミング | 出力サイズ |
|------|------------|-------------|
| `chart_get_state` | 最初の呼び出し。銘柄、時間足、すべてのインジケータ名と ID を取得 | ~500B |
| `data_get_study_values` | すべてのインジケータから現在の RSI、MACD、BB、EMA 値を取得 | ~500B |
| `quote_get` | 最新価格、OHLC、出来高を取得 | ~200B |
| `data_get_ohlcv` | 価格バーを取得。コンパクトな統計には **`summary: true` を使用** | 500B（summary）/ 8KB（100 bars） |

### カスタムインジケータデータ（Pine の描画要素）

表示中の Pine インジケータが出力する `line.new()`, `label.new()`, `table.new()`, `box.new()` を読み取れます。

| Tool | 使うタイミング | 出力サイズ |
|------|------------|-------------|
| `data_get_pine_lines` | 水平価格レベル（サポート/レジスタンス、セッションレベルなど）を読む | ~1-3KB |
| `data_get_pine_labels` | テキスト注釈と価格（"PDH 24550", "Bias Long" など）を読む | ~2-5KB |
| `data_get_pine_tables` | データテーブル（セッション統計、分析ダッシュボード）を読む | ~1-4KB |
| `data_get_pine_boxes` | 価格帯 / レンジを {high, low} の組として読む | ~1-2KB |

特定のインジケータを対象にするには、**必ず `study_filter`** を使ってください。例: `study_filter: "Profiler"`。

### チャート操作

| Tool | 内容 |
|------|-------------|
| `chart_set_symbol` | ティッカーを変更（BTCUSD, AAPL, ES1!, NYMEX:CL1!） |
| `chart_set_timeframe` | 解像度を変更（1, 5, 15, 60, D, W, M） |
| `chart_set_type` | 表示形式を変更（Candles, HeikinAshi, Line, Area, Renko） |
| `chart_manage_indicator` | インジケータを追加/削除。**略称ではなく正式名を使うこと**: "RSI" ではなく "Relative Strength Index" |
| `chart_scroll_to_date` | 日付へジャンプ（ISO: "2025-01-15"） |
| `chart_set_visible_range` | 正確な表示範囲へズーム（unix timestamp） |
| `symbol_info` / `symbol_search` | 銘柄メタデータと検索 |
| `indicator_set_inputs` / `indicator_toggle_visibility` | インジケータ設定の変更、表示/非表示 |

### マルチペインレイアウト

| Tool | 内容 |
|------|-------------|
| `pane_list` | すべてのペインと、その銘柄・アクティブ状態を一覧表示 |
| `pane_set_layout` | グリッドを変更: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_focus` | インデックス指定で特定のペインにフォーカス |
| `pane_set_symbol` | 任意のペインの銘柄を設定 |

### タブ管理

| Tool | 内容 |
|------|-------------|
| `tab_list` | 開いているチャートタブを一覧表示 |
| `tab_new` / `tab_close` | タブを開く / 閉じる |
| `tab_switch` | インデックス指定でタブを切り替え |

### Pine Script 開発

| Tool | 手順 |
|------|------|
| `pine_set_source` | 1. エディタにコードを注入 |
| `pine_smart_compile` | 2. 自動判定付きでコンパイル + エラーチェック |
| `pine_get_errors` | 3. コンパイルエラーがあれば取得 |
| `pine_get_console` | 4. `log.info()` の出力を読む |
| `pine_save` | 5. TradingView クラウドに保存 |
| `pine_get_source` | 現在のスクリプトを取得（**注意: 複雑なスクリプトでは 200KB+ になることがあります**） |
| `pine_new` | 空の indicator / strategy / library を作成 |
| `pine_open` / `pine_list_scripts` | 保存済みスクリプトを開く / 一覧表示 |
| `pine_analyze` | オフライン静的解析（チャート不要） |
| `pine_check` | サーバー側コンパイルチェック（チャート不要） |

### リプレイモード

| Tool | 手順 |
|------|------|
| `replay_start` | 指定日からリプレイ開始 |
| `replay_step` | 1 バー進める |
| `replay_autoplay` | 自動送り（速度は ms 指定） |
| `replay_trade` | 買い / 売り / クローズ |
| `replay_status` | ポジション、損益、日付を確認 |
| `replay_stop` | リアルタイム表示に戻る |

### 描画、アラート、UI 自動化

| Tool | 内容 |
|------|-------------|
| `draw_shape` | horizontal_line, trend_line, rectangle, text を描画 |
| `draw_list` / `draw_remove_one` / `draw_clear` | 描画要素を管理 |
| `alert_create` / `alert_list` / `alert_delete` | 価格アラートを管理 |
| `capture_screenshot` | スクリーンショット（regions: full, chart, strategy_tester） |
| `batch_run` | 複数銘柄 / 複数時間足に対して処理を実行 |
| `watchlist_get` / `watchlist_add` | ウォッチリストの読み取り / 変更 |
| `layout_list` / `layout_switch` | 保存済みレイアウトを管理 |
| `ui_open_panel` / `ui_click` / `ui_evaluate` | UI 自動化 |
| `tv_launch` / `tv_health_check` / `tv_discover` | 接続管理 |

## コンテキスト管理

ツールは、コンテキスト消費を抑えるために、デフォルトでコンパクトな出力を返します。典型的な「チャートを分析して」ワークフローでは、必要なコンテキストは約 80KB ではなく約 5-10KB に収まります。

| 機能 | コンテキスト節約の仕組み |
|---------|---------------------|
| Pine lines | すべての line オブジェクトではなく、重複除去した価格レベルのみ返す |
| Pine labels | 各 study あたり 50 件まで。テキスト + 価格のみ |
| Pine tables | セルメタデータを省き、整形済みの行文字列を返す |
| Pine boxes | 重複除去した {high, low} ゾーンのみ返す |
| OHLCV summary mode | すべてのバーではなく、統計 + 直近 5 本を返す |
| Indicator inputs | 暗号化 / エンコードされた blob を自動で除外 |
| `verbose: true` | 必要時は任意の Pine ツールに付けると ID / 色付きの生データを取得可能 |
| `study_filter` | すべてを走査せず、1 つのインジケータだけを対象化 |

## システム上の TradingView の場所を探す

起動スクリプトと `tv_launch` は TradingView を自動検出します。自動検出に失敗する場合は以下を確認してください。

| Platform | よくある場所 |
|----------|-----------------|
| **Mac** | `/Applications/TradingView.app/Contents/MacOS/TradingView` |
| **Windows** | `%LOCALAPPDATA%\TradingView\TradingView.exe`, `%PROGRAMFILES%\WindowsApps\TradingView*\TradingView.exe`, `%LOCALAPPDATA%\Packages\TradingView.Desktop_*` |
| **Linux** | `/opt/TradingView/tradingview`, `~/.local/share/TradingView/TradingView`, `/snap/tradingview/current/tradingview` |

重要なフラグ: `--remote-debugging-port=9222`

Windows の補足:

- `TradingView.exe` が見つからない場合でも、`tv_launch` と `launch_tv_debug.bat` は `%LOCALAPPDATA%\Packages\TradingView.Desktop_*` を見て MSIX / Store 版の起動を試みます。
- ただし、MSIX / Store 版では起動に成功しても `localhost:9222` が開かず、CLI や MCP が接続できないことがあります。
- 現時点では Windows MSIX 版の接続性は **ベストエフォート** です。セットアップに失敗した場合は、まずこの制約を疑ってください。

## テスト

```bash
# TradingView が --remote-debugging-port=9222 付きで起動している必要があります
npm test
```

29 件のテストで、Pine Script の静的解析、サーバー側コンパイル、CLI ルーティングをカバーしています。

## アーキテクチャ

```
Claude Code  <->  MCP Server (stdio)  <->  CDP (port 9222)  <->  TradingView Desktop (Electron)
```

- **Transport**: stdio 上の MCP（78 ツール）+ CLI（`tv` コマンド、30 コマンド / 66 サブコマンド）
- **Connection**: localhost:9222 上の Chrome DevTools Protocol
- **Streaming**: 重複除去付きの poll-and-diff ループ、JSONL を stdout へ出力
- **No dependencies**: `@modelcontextprotocol/sdk` と `chrome-remote-interface` 以外の依存なし

## クレジット / 帰属表示

このプロジェクトは、以下と提携・承認・関係していません。

- **TradingView Inc.**: TradingView は TradingView Inc. の商標です
- **Anthropic**: Claude および Claude Code は Anthropic, PBC の商標です

このツールは、標準 MCP プロトコルを通じて Claude Code に接続する独立した MCP サーバーです。Anthropic のソフトウェアを含まず、変更もしません。

## Disclaimer

このプロジェクトは **個人利用、教育、研究目的に限って** 提供されます。

**このツールの仕組み:** このツールは、Google によってすべての Chromium 系アプリケーションに組み込まれている標準デバッグインターフェース、Chrome DevTools Protocol（CDP）を使用します。独自の TradingView プロトコルをリバースエンジニアリングするものではなく、TradingView のサーバーに接続することも、アクセス制御を回避することもありません。デバッグポートは、標準の Chromium コマンドラインフラグ（`--remote-debugging-port=9222`）によって、利用者が明示的に有効化する必要があります。

このソフトウェアを使用することで、あなたは以下を認識し、同意したものとみなされます。

1. **このツールの利用が [TradingView の利用規約](https://www.tradingview.com/policies/) および適用法令に準拠していることを確認する責任は、すべてあなたにあります。**
2. TradingView の利用規約は、同社プラットフォームおよびデータに対する **自動データ収集、スクレイピング、非表示用途での利用** を制限しています。このツールは Chrome DevTools Protocol を使って TradingView Desktop アプリをプログラム的に操作するため、これらの規約と抵触する可能性があります。
3. **このツールの利用に伴うすべてのリスクは、あなた自身が負うものとします。** 作者は、アカウント停止、利用制限、法的措置、その他あらゆる結果について責任を負いません。
4. Windows 版については、TradingView の現行配布形態が MSIX / Store 中心になっている可能性があります。この場合、標準の `--remote-debugging-port=9222` や `ELECTRON_EXTRA_LAUNCH_ARGS` が効かず、このリポジトリが接続できないことがあります。
5. MSIX の展開、`app.asar` の解析や改変、`Add-AppxPackage -Register AppxManifest.xml` による再登録は、**ローカル研究目的の実験的手順** です。これは通常サポート範囲外であり、TradingView の利用規約上も問題になる可能性があります。
6. このツールは、以下を含むがこれらに限られない用途に **使用してはいけません**。
   - TradingView の市場データの再配布、再販、商用利用
   - TradingView のアクセス制御やサブスクリプション制限の回避
   - 抽出したデータを用いた自動売買やアルゴリズム意思決定
   - Pine Script インジケータ作者の知的財産権の侵害
   - TradingView のサーバーや基盤への接続（アクセスはローカルで動作中の Desktop アプリ経由に限られます）
7. ストリーミング機能が監視するのは、あなたのローカルで動作中の TradingView Desktop インスタンスのみです。TradingView のサーバーに接続したり、TradingView の基盤からデータを抽出したりはしません。
8. このツールを通じて取得した市場データには、引き続き取引所およびデータ提供者のライセンス条件が適用されます。**このツールで取得したデータを再配布、保存、商用利用しないでください。**
9. このツールは、文書化されていない TradingView アプリケーション内部インターフェースにアクセスしており、これらは予告なくいつでも変更・破損する可能性があります。

**自己責任で利用してください。** 想定している使い方が TradingView の規約に準拠しているか不明な場合は、利用しないでください。

## ライセンス

MIT ライセンスです。詳細は [LICENSE](LICENSE) を参照してください。

MIT ライセンスが適用されるのは、このプロジェクトのソースコードに対してのみです。TradingView のソフトウェア、データ、商標、知的財産に関するいかなる権利も付与しません。
