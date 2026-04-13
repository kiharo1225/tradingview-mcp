# Browser Mode Parity タスク表

このファイルは、browser mode を親リポジトリの Desktop `.exe` フローにできるだけ近づけるための残タスクを管理します。

## すでに確認できている範囲

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

## ここまでの主な改善

- browser launch を追加し、専用 Chrome profile で起動するようにした
- `draw list` の `getChartApi is not defined` を修正
- `chart_ready` を browser mode 向けに改善した
- replay paywall の失敗理由を明確化した
- batch OHLCV に direct bars fallback を追加した
- `symbol` / `pane symbol` が無限待ちしないようにした
- `symbolResolvingActive=true` の間は ready と見なさないようにした
- 複数 TradingView page target を probe して、応答する target を優先するようにした
- 上段左上の symbol 表示や modal 状態まで見て target score を付けるようにした
- stale な series 読み込み中は `quote` を失敗扱いにして、誤った成功を返しにくくした
- 接続時に `Symbol search`、`Got it!`、`Join for free` などの既知 UI を軽く dismiss する recovery を追加した
- `symbol` / `pane symbol` に、表示更新後も series が詰まる場合の reload fallback を追加した
- CDP の `Runtime.evaluate` 自体が返ってこない場合でも CLI が無限待ちしないよう、evaluate timeout と再接続前提の切断処理を追加した

## 現在のギャップ

最重要課題:

- `symbol` 切替後に、symbol 表示は変わっても bars が前の銘柄のまま残ることがある
- このとき `mainSeries` は `isLoading=true`, `seriesLoaded=false`, `seriesCompleted=false`, `symbolResolvingActive=true` のまま止まることがある
- つまり「target の取り違え」だけでなく「同一 target 内での stale series」もまだ残っている

その他の課題:

- crypto / cross-asset の symbol 切替は clean session で改善し、symbol search を開いたままのケースでも reload fallback で回復できた
- `AAPL -> TSLA -> BTCUSDT -> AAPL` の代表ケースでは、現在は `status` / `quote` / `chart_ready` が揃い、CLI ハングも再現しなくなっている
- 複数 TradingView page が同時にある状態でも、代表ケースでは `status` / `quote` / `chart_symbol` が同じ chart に揃った
- ただし、他の汚れた session パターンでの安定性はまだ要確認
- `batchRun(get_ohlcv)` は、二重待機を外したことで代表ケースでは成功するようになった
- 代表ケースとして `AAPL -> BTCUSDT -> TSLA` の `1D` 取得は、browser モードで約 78 秒で完了し、各銘柄の bars を正しく返した
- `AAPL -> TSLA -> BTCUSDT -> AAPL` の往復でも `status` / `quote` / `ohlcv` の read 系は代表ケースで整合している
- `batchRun(screenshot)` は browser モードで成功した
- `batchRun(get_strategy_results)` は Strategy Tester 未表示時に `success: false` / `Strategy Tester not found` として安全に失敗するようにした
- `Symbol search` を開いたままの汚れた session でも、`BTCUSDT -> AAPL` の代表ケースで `status` / `quote` / `chart_symbol` が揃うことを再確認した
- `cdp_target_title` の stale を減らすため、同一 target id の metadata を `/json/list` から引き直すようにした
- blocking dialog recovery を強化し、`close / dismiss / cancel / not now / maybe later / skip` 系の visible button と複数回の `Escape` で `Symbol search` 残りをより閉じやすくした
- `indicator add/toggle/get/remove` は代表ケースで成功したが、`state` の `studies` 一覧はタイミングにより古い entity が残って見えることがある
- `watchlist add` は現状の browser セッションで `Add symbol button not found in watchlist panel` により失敗
- `watchlist add` は右ペインの `base` タブ優先で改善し、代表ケースでは成功するようになった
- `watchlist add` は `watchlist_visible_rows` を返すようにし、表示反映まで確認できたかの手がかりを返すようにした
- ただし `watchlist get` は現行 UI で `empty` / `panel_closed` を返すことがあり、今回の browser セッションでも `watchlist_visible_rows: false` だったため、読み取り側はまだ追従不足
- `layout list` は成功するが空、`alert list` は空配列 + `error` を返す場合があり、`alert delete --all` は手動確認前提
- `replay status` は取得できるが、現行 browser session の `replay start` は `Replay start timed out after 20000ms` として安全に失敗する
- 今回の回収は `.exe` 版ではなく browser モード前提なので、Desktop 版のような「確認済みバージョンへの固定」を browser 側でどう運用するかを別途整理する必要がある
- 具体的には、TradingView Web の配信更新、Chrome / Edge の更新、専用プロファイル運用でどこまで再現性を持たせられるかを調査する必要がある
- `npm run smoke:browser` は browser version も出力するようにし、確認済み binary / profile の記録に使えるようにした
- stale legend 対策は、過剰に DOM を書き換えて誤検知を隠さないよう注意が必要
- 代表ケースでは `TSLA -> BTCUSDT -> AAPL` の往復で `legend_matches_chart` / `legend_matches_symbol` は維持できている
- データは正しくても、二段目 legend / 説明ラベルだけ古い銘柄名のまま残るケースがある
- `draw shape/remove/clear` の end-to-end 検証がまだ薄い
- `layout switch` は保存済み layout がないため未検証
- `alert create/delete` は account state を変えるので慎重に扱う必要がある
- replay は paywall の影響があり parity にはまだ届いていない
- 単一 target しかないときに blocking dialog を自動 recovery する仕組みは未実装
- 単一 target で stale series に入ったとき、page reload 以外の安定した recovery はまだ未確立

## タスク一覧

| ID | 優先度 | 状態 | タスク | 完了条件 |
|---|---|---|---|---|
| T1 | 高 | 完了 | Pine Editor 系の browser mode 確認 | `pine get`, `pine errors`, `pine console` が browser mode で使える |
| T2 | 高 | 完了 | `chart_ready` 判定の改善 | generic loading DOM だけで false にならず、series 状態も見て判定できる |
| T3 | 高 | 進行中 | mutation 系の検証を進める | `draw`, `indicator`, `watchlist`, `layout`, `alert` の扱いを確認または制約として明記できる |
| T4 | 最重要 | 進行中 | symbol 切替後の stale data 問題を解消する | `symbol`, `quote`, `ohlcv`, `status` が clean session と代表的な汚れた session でも同じ series を一貫して指し、CLI がハングせず安全に失敗できる |
| T5 | 中 | 進行中 | replay の parity を整理する | replay が使えるか、account-gated かを明確にできる |
| T6 | 中 | 進行中 | batch / stream の browser mode 検証 | `stream` は確認済み。`batch_run(get_ohlcv)` は代表ケースで成功済み。残りは時間短縮と他 action の確認 |
| T7 | 中 | 進行中 | README の browser parity 状態を現実に合わせる | verified / partial / blocked が README で明確に分かる |
| T8 | 低 | 未着手 | MSIX 実験文書の位置づけを整理する | `MSIX_EXPERIMENT_GUIDE.md` が実験扱いであることが明確 |
| T9 | 高 | 進行中 | 見ている chart と attach した target のズレを減らす | 複数 page/tab/window の代表ケースで一致は確認済み。残りは長時間運用や複雑な modal 重なりでも安定して attach できること |
| T10 | 高 | 進行中 | blocking dialog がある単一 target の recovery 方針を作る | `Symbol search` や広告 modal が残っていても、検知して閉じるか失敗理由として扱える |
| T11 | 中 | 進行中 | 可視 UI の stale legend 表示を減らす | `legend_matches_chart` が代表的な symbol 往復でも安定して true になる |
| T12 | 中 | 未着手 | browser モードでのバージョン固定・再現性方針を調査する | Chrome / Edge と TradingView Web の更新影響をどこまで抑えられるか、固定可能な範囲と運用手順を整理し、必要なら README に反映できる |

## 今すぐやる順

1. `T4` stale series / stale data 問題をさらに詰める
2. `T9` 見ている chart と attach 先 target のズレを減らす
3. `T10` modal / dialog が残った単一 target の recovery を強くする
4. `T11` stale legend / stale UI 表示を減らす
5. `T6` batch / stream の残課題を締める
6. `T12` browser モードのバージョン固定・再現性運用を仕上げる
7. `T3` mutation 系の未確認領域を埋める
8. `T5` replay の parity を整理する
9. `T7` README の verified / partial / blocked をさらに現実に寄せる
10. `T8` MSIX 実験文書を本流外の調査記録として整理する

## 実行メモ

- まずは `T4` から開始する
- `T4` と `T9` は相互に関係するので、切り分け中に両方へ反映してよい
- `T7` と `T8` は最後にまとめて整える

## ひと段落の条件

次の条件を満たしたら、この作業は「ひと段落」と判断します。

- browser mode の主要 read/write フローが確認済みか、未対応として明記済み
- stale symbol/data 問題が解消済みか、少なくとも安全に失敗する
- attach した target と実際に見ている chart が運用上ズレにくい
- README が現在の browser mode の実態を反映している
- MSIX 関連の文書が本流ではなく実験扱いだと分かる

すべての残タスクが終わったら、ユーザーへ次の文言を伝えること:

`browser mode の parity タスクがひと段落しました。`
