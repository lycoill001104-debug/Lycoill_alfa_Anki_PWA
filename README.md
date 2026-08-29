# αnki

Windows Ankiを正本とし、iPhoneではカードを編集せず復習だけを行うoffline-first PWAです。

PWA本体は一般的な静的HTTPSホスティングで動作します。ChatGPT Sitesや常駐アプリケーションサーバーは使用しません。Windows側の同期機能はAnkiを開いている間だけ動作します。

## 実装済み

- iPhone向けのカード復習画面
- Again / Hard / Good / Easy
- `ts-fsrs`による次回予定計算
- IndexedDBへのカード・FSRS状態・復習イベント保存
- 未同期レビューの冪等キュー
- Web App Manifest / Service Worker
- QRペアリング対応のWindows Anki同期アドオン
- SafariのMixed Content制限を避けるローカル中継同期
- Ankiのレンダリング済みカードHTMLをsandbox iframeで表示

## ローカル起動

```powershell
npm install
npm run dev
```

ターミナルに表示されたローカルURLを開きます。デモカードは追加されません。

## 静的ビルドと公開

```powershell
npm run build
```

生成される `dist` フォルダーを、GitHub Pages、Cloudflare Pages、Netlifyなどの静的HTTPSホスティングへ配置します。サーバー側のプログラムや環境変数は不要です。ルートドメインでもサブディレクトリでも動作する相対パス構成です。

公開後、Ankiの「ツール → αnki PWA URL設定」に公開URLを一度だけ入力します。

詳しい初回手順は[`docs/static-hosting.md`](docs/static-hosting.md)を参照してください。

## Ankiアドオン

インストール用ファイルは `dist-addon/alpha-anki-sync-0.4.0.ankiaddon` です。Windows Ankiの「ツール → アドオン → ファイルからインストール」から読み込み、Ankiを再起動してください。

再起動後、最初に「ツール → αnki PWA URL設定」で静的ホスティングのHTTPS URLを保存します。その後「ツール → αnki PWA ペアリング」にQRコードを表示し、iPhoneのαnkiから読み取ります。

## 検証

```powershell
npm run validate
```

## 現在の互換性上の境界

v0.1では、オフライン中の回答時刻と順序をPWA側のイベントに正確に保持しますが、Anki Schedulerへの状態遷移は同期時刻に適用します。数日分の過去レビューをAnkiのrevlogへ完全再現する処理は、Ankiのバージョンを固定したうえで追加検証が必要です。

公開HTTPS版PWAからLAN内HTTPへ直接fetchせず、同期時に同一オリジンのローカル中継ページへ画面遷移し、処理後にPWAへ戻る方式を採用しています。対象iPhoneでの最終実機確認は必要です。
