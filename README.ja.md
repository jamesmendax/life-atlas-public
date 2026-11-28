# Life Atlas

[English](./README.md) | 日本語 | [简体中文](./README.zh-CN.md)

Life Atlas はローカルファーストな Windows 向けパーソナルワークスペースです。SQLite ベースのページと多視点データベースで知識を整理し、暗号化キー格納庫（Key Vault）に認証情報やファイルを安全に保管し、オフライン OCR で日本語・英語・中国語のテキストを抽出できます。右下の AI アシスタントは、任意の OpenAI 互換 API エンドポイントに接続して利用できます。

## `1.7.0` の主な特長

- **5 ロケール多言語対応（`EN-US` / `EN-SG` / `JA-JP` / `ZH-CN` / `ZH-SG`）** — 4 つのウィンドウ（ワークスペース、キー格納庫、初回セットアップ、Markdown プレビュー）、ネイティブメニューやダイアログ、数値・日付・曜日の `Intl` ロケール書式、日英中フォントスタック、多言語 NSIS インストーラーまで統一対応。
- **Notion スタイルのページ & 11 種類のデータベースビュー** — マルチカラム編集、三項演算対応の数式、リレーションロールアップ、繰り返しタスク、アクションボタン、通貨換算、オフライン地図、1 万行対応の仮想テーブルを備えています。
- **暗号化キー格納庫（`Argon2id` + `AES-256-GCM`）** — 分離されたフルワイド UI 内で `/` スラッシュブロック付きリッチメモ、暗号化添付ファイル、TOTP シークレットを管理できます。
- **公式マーケット & オフラインサンドボックス** — 署名済み `.atlaspack` ウィジェット／テンプレートをプレビュー付きで個別ダウンロード（日本の 47 都道府県・中国 477 地域・世界 176 か国対応のインタラクティブ足跡マップ、ポモドーロ、習慣ヒートマップ、旅行タイムライン、手描きホワイトボード、Carbon 風コードカード、意思決定レビュー、収支台帳など）。
- **クラウド同期フォルダ対応バックアップ** — OneDrive や Google Drive で同期されるローカルフォルダへ `.lifeatlas` 暗号化バックアップを書き出せます。

[Windows リリース](https://github.com/jamesmendax/life-atlas-public/releases/latest) · [オンラインマーケット](https://jamesmendax.github.io/life-atlas-public/market/)

## ダウンロードとアップデート（Windows x64）

[最新リリースページ](https://github.com/jamesmendax/life-atlas-public/releases/latest) からインストーラー、`SHA256SUMS.txt`、`.blockmap`、`THIRD_PARTY_NOTICES.md` を入手できます。

### 旧バージョンからの更新手順

1. 起動中の Life Atlas を終了してから新しいインストーラーを実行してください。同一 Windows アカウント環境では既存のデータルートが自動的に引き継がれます。
2. 更新前に **バックアップと復元 → フルバックアップ** から `.lifeatlas` を書き出して検証しておくことを推奨します（キー格納庫を含める場合は該当チェックを有効化）。
3. 初回セットアップ画面が表示された場合は、既存のデータフォルダを選択して **このワークスペースを開く** をクリックしてください。

## 公式マーケット

アプリ内のサイドバー **テンプレート → 公式マーケット**（または [オンラインマーケット](https://jamesmendax.github.io/life-atlas-public/market/)）から各作品の説明やパッケージサイズを確認し、必要な署名済み `.atlaspack` のみをオフライン環境へ保存できます。

- [オンラインマーケットを見る](https://jamesmendax.github.io/life-atlas-public/market/) · [作品を投稿する](https://github.com/jamesmendax/life-atlas-public/issues/new?template=market-submission.yml) · [不具合・要望を報告](https://github.com/jamesmendax/life-atlas-public/issues/new?template=feedback.yml) · [投稿ガイド](./market/CONTRIBUTING.md)

## データ互換性

`npm run desktop:build` の実行前および GitHub Actions（Windows / Linux）では、`npm run test:compatibility` によって既存 SQLite ワークスペース、マスターパスワード／リカバリキー、暗号化 `.lifeatlas` バックアップの互換性が検証されます。詳細は [`tests/fixtures/compatibility/README.md`](./tests/fixtures/compatibility/README.md) を参照してください。

## ローカル開発

Windows 上で **Node.js 24** と `npm` を使用します。

```powershell
npm ci
node node_modules/electron/install.js
npm run test:compatibility
npm run desktop:dev
```

Windows インストーラーのビルド手順およびキャッシュ設定は [英語版 README](./README.md#building-the-windows-installer) と同じコマンドを利用できます。

## サードパーティライセンス

同梱ライブラリおよびデータセットのライセンス表記は [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) に記載しています。
