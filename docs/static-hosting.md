# 静的PWAの公開と初回接続

αnki本体は、ビルド済みファイルだけで動く静的PWAです。Node.jsやPythonなどのアプリケーションサーバーを常駐させる必要はありません。

## 1. 公開する

`npm run build`で生成された`dist`フォルダーの**中身**を、HTTPS対応の静的ホスティングへ配置します。

- GitHub Pages
- Cloudflare Pages
- Netlify
- その他の静的HTTPSホスティング

ルートURLとサブディレクトリのどちらにも配置できます。公開後のURLは、末尾の`/`を付けても付けなくても構いません。

## 2. AnkiへURLを保存する

1. Windows Ankiへ`alpha-anki-sync-0.4.0.ankiaddon`をインストールします。
2. Ankiを再起動します。
3. 「ツール → αnki PWA URL設定」を開きます。
4. 手順1で公開したHTTPS URLを入力します。

## 3. iPhoneをペアリングする

1. Windows AnkiとiPhoneを同じWi-Fiへ接続します。
2. Ankiの「ツール → αnki PWA ペアリング」を開きます。
3. iPhoneのαnkiで「設定 → QRコードを読み取る」を選びます。
4. アドオン画面のQRコードを読み取ります。
5. 「同期」を押して復習カードを受信します。

## 動作するタイミング

- PWAの閲覧・復習・回答保存: Ankiを閉じていても動作します。
- Windows Ankiとの送受信: Ankiを開いている間だけ動作します。
- Windowsの常駐サービス: 使用しません。

初回表示と更新時には静的ホスティングへのインターネット接続が必要です。一度読み込んだアプリと同期済みカードは、Service WorkerとIndexedDBに保存され、オフラインでも利用できます。
