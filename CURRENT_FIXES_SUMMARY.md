# 現在の修正サマリ

## 方向性

Windows 版 TradingView Desktop が MSIX 配布中心になり、従来の `.exe --remote-debugging-port=9222` 前提が崩れているため、このリポジトリでは browser mode を本流として進めています。

今回の修正は、主に次の 2 点を改善するためのものです。

- browser mode でも本流コマンドをなるべく Desktop 版に近い形で使えるようにする
- 複数の TradingView ページや不完全な symbol 切替で、見ている chart と取得データが食い違う問題を減らす

加えて、今後の残課題として「browser モードでも Desktop 版のように動作確認済みの組み合わせを固定・再現できるか」を調べる必要があります。これは TradingView Web 自体の配信更新と、Chrome / Edge 側の自動更新の両方に影響されるためです。

この観点では、`npm run smoke:browser` に browser version の記録も追加しました。現在は `Chrome/147.0.7727.55` のような値が JSON に含まれるため、確認済み binary と profile の組み合わせを残しやすくなっています。

## ここまでに入れた主な修正

### 1. browser mode の起動対応

対象ファイル:

- [`src/core/health.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/health.js)
- [`src/tools/health.js`](/c:/Users/hayan/git/tradingview-mcp/src/tools/health.js)
- [`src/cli/commands/health.js`](/c:/Users/hayan/git/tradingview-mcp/src/cli/commands/health.js)

内容:

- `launch --mode browser` を追加
- Chrome / Edge を検出して `https://www.tradingview.com/chart/` を CDP 付きで起動
- 専用の browser profile を使って既存ブラウザセッションとの干渉を減らした

### 2. 複数 target の中から良い TradingView page を選ぶ改善

対象ファイル:

- [`src/connection.js`](/c:/Users/hayan/git/tradingview-mcp/src/connection.js)

内容:

- TradingView の page target が複数ある場合に、単純な先着ではなく複数候補を probe して選ぶようにした
- `document.title`
- 上段左上の symbol ボタン text
- legend title
- API symbol
- main series symbol
- series の loading 状態
- モーダルの有無

などを見て score を付けるようにした

結果:

- stale な page や応答しない page をつかみにくくなった
- `Symbol search` のようなダイアログが開いている page を優先しにくくなった

### 3. status に診断情報を追加

対象ファイル:

- [`src/core/health.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/health.js)

追加した情報:

- `document_title`
- `cdp_target_title`
- `visible_symbol_button`
- `legend_title`
- `has_blocking_dialog`
- `dialog_title`
- `main_series_symbol`
- `symbol_resolving_active`
- `chart_loading`
- `series_loaded`
- `series_completed`
- `series_status`
- `chart_consistent`

これにより、今つないでいる target が本当に見ている chart か、series が読み込み途中で stale data の恐れがあるかを見分けやすくなった

加えて、CDP target metadata の `title` が古いまま残るケースがあるため、`status` の `target_title` は page 側の `document.title` を優先する形に寄せた

### 4. quote の安全性改善

対象ファイル:

- [`src/core/data.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/data.js)

内容:

- `quote` が返す情報に `api_symbol`, `main_series_symbol`, `visible_symbol`, `document_title` などを追加
- series がまだ読み込み中のときは `quote` を成功扱いにせず、明示的に失敗させるようにした

目的:

- symbol 表示だけ切り替わって bars が前の銘柄のまま残っている状態を、誤って正常と見なさないようにする

### 5. chart_ready 判定の改善

対象ファイル:

- [`src/wait.js`](/c:/Users/hayan/git/tradingview-mcp/src/wait.js)

内容:

- `symbolResolvingActive=true` の間は ready と見なさない
- `isLoading()`, `_seriesLoaded`, `_seriesCompleted`, `_seriesStatus` を見て、series が未完成なら ready にしない

### 6. 既存の browser mode 改善

対象ファイル:

- [`src/core/drawing.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/drawing.js)
- [`src/core/replay.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/replay.js)
- [`src/core/batch.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/batch.js)
- [`src/core/chart.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/chart.js)
- [`src/core/pane.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/pane.js)
- [`src/core/stream.js`](/c:/Users/hayan/git/tradingview-mcp/src/core/stream.js)
- [`src/connection.js`](/c:/Users/hayan/git/tradingview-mcp/src/connection.js)

内容:

- `draw list` の不具合修正
- replay が paywall に当たったときのエラーを明確化
- batch OHLCV に direct bars fallback を追加
- `setSymbol()` 系を Promise と timeout を考慮した実装に改善
- stream 文言を browser mode 前提に寄せた
- `Runtime.evaluate` / `awaitPromise` が返ってこないケースでも CLI が無限待ちしないよう、CDP evaluate 自体に timeout を追加した
- evaluate timeout 時は既存 client を切断し、次回接続時に再接続できるようにした

## 実機で確認できたこと

browser mode で確認済み:

- `status`
- `discover`
- `ui-state`
- `screenshot -r chart`
- `watchlist get`
- `watchlist add` の一部
- `indicator get`
- `indicator toggle`
- `values`
- `pane list`
- `tab list`
- `layout list`
- `draw list`
- `pine get`
- `pine errors`
- `pine console`
- `stream quote`
- `stream bars`

## 現在の大きな未解決点

### 1. stale data after symbol change

まだ残っている一番大きな問題はこれです。

- `symbol` が `AAPL` に変わっても、bars が以前の `TSLA` のまま残ることがある
- この状態では `mainSeries` が `isLoading=true`, `seriesLoaded=false`, `seriesCompleted=false`, `symbolResolvingActive=true` のまま止まっている

今回の修正で、この状態の `quote` は失敗として返すようにしたため、誤って成功扱いする危険は下がりました。

また、接続時に `Symbol search`、`Got it!`、`Join for free` などの既知の blocking UI を軽く掃除する recovery を追加したため、modal が残ったまま stale 状態へ入り続けるケースは減っています。

さらに、`symbol` / `pane symbol` には「対象 symbol への表示更新までは進んだが series が詰まっている」と判断できる場合の reload fallback を追加しました。

実機では clean session 上で次を確認できています。

- `AAPL -> TSLA`
- `TSLA -> BTCUSDT`
- `BTCUSDT -> AAPL`

この往復では `status` / `quote` / series state が一致し、`chart_ready=true` で完了しました。

また、意図的に symbol search を開いたまま `AAPL -> BTCUSDT` を実行したケースでも、reload fallback を使って最終的に

- `target_title`
- `chart_symbol`
- `quote`

が `BINANCE:BTCUSDT` に揃うことを確認しました。

さらに、複数の TradingView page が混在した状態でも、

- `status`
- `quote`
- `chart_symbol`

が同じ target に追従し、AAPL / BTCUSDT の切替後も一貫した結果を返せることを確認しています。

加えて、`AAPL -> TSLA` の途中で CLI 自体がぶら下がるケースに対して、CDP evaluate timeout を入れたあとに再確認しました。現在は少なくとも次の代表ケースで、CLI がハングせず `status` / `quote` / `chart_ready` が揃うことを確認しています。

- `AAPL -> TSLA`
- `TSLA -> BTCUSDT`
- `BTCUSDT -> AAPL`

この時点では、stock / crypto をまたぐ切替でも `reload_used: false` のまま通るケースが確認できています。

一方で、`batchRun(get_ohlcv)` は browser モードで追加調整が必要でした。内部で使う symbol 切替を本流の `setSymbol()` / `setTimeframe()` に寄せたうえで、1 件ごとの timeout を追加し、さらに batch 内の二重待機を取り除きました。

その結果、代表ケースとして

- `AAPL`
- `BTCUSDT`
- `TSLA`

の 3 銘柄を `1D` で順に回した `batchRun(get_ohlcv)` が、現在は約 78 秒で完了し、それぞれ正しい last bar を返せるようになっています。browser モードでは `source: "direct_bars_fallback"` での取得が主経路です。

また、単発の read 系確認として

- `AAPL -> TSLA -> BTCUSDT -> AAPL`

の往復で `status` / `quote` の整合を再確認しました。現時点では各ステップで

- `chart_symbol`
- `visible_symbol_button`
- `legend_matches_chart`
- `legend_matches_symbol`
- `series_ready`

が揃っており、代表ケースでは stale legend と stale data は再現していません。

追加で `BTCUSDT -> AAPL` の `ohlcv --summary` も確認し、cross-asset の往復後でもそれぞれ正しい last bar が返ることを確認しています。

さらに、`Symbol search` を意図的に開いたままの汚れた session でも、

- `BTCUSDT`
- `AAPL`

への切替後に `status` / `quote` / `chart_symbol` / `legend_matches_*` が揃うことを再確認しました。このケースでは `target_switched: true` と `reload_used: true` が使われる場合があり、recovery 経路が実際に効いています。

加えて、接続先 target metadata の stale を減らすため、`getTargetInfo()` で `/json/list` から同じ target id の最新 metadata を引き直すようにしました。これにより `cdp_target_title` の古い表示が残りにくくなっています。

また、blocking dialog の recovery も少し強くしました。`dismissKnownBlockingUi()` で

- `Got it!`
- `Close menu`
- `close / dismiss / cancel / not now / maybe later / skip`

のような visible button をより広く拾うようにし、known dialog が見えている間は `Escape` を複数回送るようにしています。実機では `Symbol search` を開いたまま `BTCUSDT` へ切り替えたケースで、最終的に `has_blocking_dialog: false` まで戻ることを確認しました。

`T11` の stale legend については、見かけだけを過剰に書き換えると逆に誤検知を隠す恐れがあるため、同期処理は title button / exchange / logo letter のような限定的な箇所に留めています。その上で、代表ケースとして

- `TSLA`
- `BTCUSDT`
- `AAPL`

の往復で `legend_matches_chart: true` と `legend_matches_symbol: true` を維持できることを再確認しました。

一方で、新しい残課題も見えています。

- `status`
- `quote`
- `chart_symbol`

は正しく揃っていても、page 上の二段目 legend や説明ラベルが古い銘柄名のまま残ることがあります。

そのため現在は、`legend_matches_chart` と `legend_matches_symbol` を返して、可視 UI の stale 表示を検知できるようにしています。

### 2. cross-asset / crypto の symbol parity

stock 同士の切替はかなり安定し、crypto / cross-asset も clean session では改善しています。

ただし、すべての汚れた session パターンを網羅できたわけではないため、再現条件の異なるケースでの追加確認はまだ必要です。特に、より複雑な modal の重なり、長時間運用後の drift、二段目 legend の stale 表示は残確認です。

### 3. batch / stream parity

`stream quote` と `stream bars` は browser モードで確認済みです。

`batchRun(get_ohlcv)` も、現時点では代表ケースで成功まで確認できています。まだ高速とは言いにくいものの、少なくとも

- 複数銘柄を順に回す
- browser モードで正しい bars を返す
- 無限待ちせず完了する

ところまでは進みました。

追加確認として、batch の他 action も見ています。

- `batchRun(screenshot)` は browser モードで成功し、PNG を保存できる
- `batchRun(get_strategy_results)` は Strategy Tester が開いていない環境では `Strategy Tester not found` を返し、現在は **安全に失敗** として扱う

mutation 系の追加確認では、次が分かっています。

- `indicator add Volume` は browser モードで成功する
- `indicator toggle`, `indicator get`, `indicator remove` も API 呼び出し自体は成功する
- 一方で `state` の `studies` 一覧はタイミングによって古い entity が残って見えることがあり、CLI 上の見え方と内部 API の見え方に差が出るケースがある
- 内部 API を直接見ると最終的に `Volume` study は 1 件だけなので、mutation 自体より一覧表示側の整合が残課題

初期段階では `watchlist add AAPL` は `Add symbol button not found in watchlist panel` で失敗していましたが、その後 `watchlist add` は右ペインの `base` タブを優先して開くように修正し、代表ケースでは `success: true` まで改善しました。さらに `watchlist_visible_rows` を返すようにして、実際に watchlist 側へ表示反映できたかの手がかりも返すようにしました。

watchlist の読み取りも改善が進み、現行 browser UI では `data-symbol-full` ベースで既存 watchlist の symbol 一覧を 17 件取得できることを確認しています。加えて、現行 session では `watchlist add AAPL` が `watchlist_visible_rows: true`, `watchlist_contains_symbol: true`, `state: "confirmed_visible"` まで返り、追加後の表示確認まで通るケースも取れました。ただし、session 差はまだ残るため、`watchlist_visible_rows` と `watchlist_contains_symbol` を合わせて見る運用は引き続き有効です。

`layout list` は引き続き成功するものの、現在の session では保存済み layout がなく空です。`layout switch does-not-exist` は `Layout "does-not-exist" not found.` で安全に失敗することも確認しました。`alert list` は内部 API が `error` を返すケースがありますが、現行 session では Alerts パネルの DOM から「Create alert」状態を見て `success: true` / `state: "no_alerts"` にフォールバックできるようになりました。`alert delete --all` は依然として手動確認前提の DOM fallback ですが、いまは `state: "manual_confirmation_required"` を返すので機械的にも扱いやすくなっています。

README には browser モードの verified / partial / blocked を追記し、`MSIX_EXPERIMENT_GUIDE.md` には「本流ではなく調査用の実験メモ」であることを明記しました。

replay についても整理を進めました。`replay status` は browser モードで取得でき、`is_replay_available`, `is_replay_toolbar_visible`, `is_ready_to_play`, `ui_ready_to_play` まで見えるようにしています。実機では、現在の browser session は `is_replay_toolbar_visible: false`, `is_ready_to_play: false`, `ui_ready_to_play: false` のままで、`replay start` は「toolbar が visible にならず、replay UI も ready_to_play にならない」と分かるメッセージで **安全に失敗** するようにしています。date 指定時の `Promise was collected` や 15000ms timeout も、同じく replay 初期化待ちとして意味のあるメッセージに寄せています。少なくとも、以前のような長時間のぶら下がりよりは扱いやすくなっています。

また、stale legend 判定も改善しました。`Change symbol` ボタンのタイトルを優先して拾うようにしたことで、`status` の `legend_title` が `1Vol∅∅` のような indicator 名ではなく `Apple Inc.` を返し、`legend_matches_chart: true` まで回復しています。`quote` 側の `legend_matches_symbol` も同じく `true` を確認しています。

watchlist についても、いまは top-level に `pending_count` と `all_pending` を返すようにして、価格や騰落率が `null` でも widget 側がまだ `pending` だと切り分けやすくしています。実機では 17 件すべてが `pending` のまま返る session を確認しており、これは parser の失敗ではなく TradingView Web 側の widget 状態と見ています。

### 3. モーダルが開いたページの扱い

`Symbol search` や広告系モーダルが開いていると、画面の見え方と series 状態がズレやすいです。target 選択では避けるようにしたものの、単一 target しかない場合の recovery はまだ残課題です。

## 追跡ファイル

残タスクは次を参照します。

- [`BROWSER_PARITY_TASKS.md`](/c:/Users/hayan/git/tradingview-mcp/BROWSER_PARITY_TASKS.md)
## 2026-04-14 追記

- `watchlist get` に quote session 補完を追加しました。現行 browser session では DOM 側の watchlist rows が `pending` のままでも、`getQuoteSessionInstance()` から取得できた symbol については `last/change/change_percent` を埋められます。
- 実機では `watchlist get` が `hydration_source: "quote_session"` / `hydrated_count: 1` を返し、`NASDAQ:AAPL` については `last: 260.48`, `change: -0.01`, `change_percent: 0`, `status: "ok"` まで補完できました。
- まだ全 symbol が埋まるわけではないため、watchlist parity は「一覧取得は安定、価格列は部分補完あり、残りは TradingView Web session 依存」という段階です。
- `replay start` は引き続き browser session 側の制約を明示した形で安全に失敗します。現在の主な文面は「Bar replay ボタンは visible だが toolbar が出ず、UI も `ready_to_play` にならない。TradingView Web の account / sign-in / feature gate が噛んでいる可能性がある」です。
- `replay` の内部状態も追加で確認しました。現行 session では `isReplayAvailable=true` でも、`_replayUIController` 側の `isReplayModeEnabled=false` / `readyToPlay=false` のままで、toolbar object 自体は存在しても visible になっていません。現時点では実装バグより TradingView Web session 側 gate の可能性が高いです。
## 2026-04-14 現在地

- `watchlist get` は partial support のままですが、待機を少し短縮しつつ `quote_session` 補完を維持する形に調整しました。
- タスク表ベースでは、2026-04-14 時点で追跡していた parity タスクは **完了** または **制約つき完了** の状態まで整理できています。
- 現在 repo 側に残っている差分の中心は、新しい未実装ではなく、TradingView Web 側の account / feature gate / widget session 変化に対する将来の追従です。
