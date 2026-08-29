# αnki Sync Protocol v0.1

## Transport

- Default endpoint: `http://<windows-lan-ip>:8766`
- Authentication: `Authorization: Bearer <pairing-token>`
- Maximum request body: 5 MB
- Card/note content direction: Windows Anki → PWA only
- Review direction: PWA → Windows Anki only

## `GET /v1/status`

Returns server availability and its current time.

## `POST /v1/sync`

Request:

```json
{
  "deviceId": "uuid",
  "cursor": "opaque cursor",
  "reviews": [{ "id": "uuid", "ankiCardId": 123, "rating": 3, "reviewedAt": 1787968800000 }]
}
```

Response includes rendered due cards, accepted/rejected review event IDs, deleted card IDs and the next opaque cursor. Review event IDs make uploads idempotent.

## `GET /bridge`

Safariでは公開HTTPSページからLAN内HTTPサーバーへの直接`fetch()`がMixed Contentとして失敗するため、PWAは同期要求をURLフラグメントへ圧縮してトップレベルの`/bridge`へ遷移します。中継ページは同一オリジンの`/v1/sync`を呼び、結果を圧縮したURLフラグメントでHTTPS PWAへ戻します。フラグメント中のペアリング情報はHTTPリクエストやSitesサーバーログへ送信されません。

## Security boundary

Every non-preflight request requires the pairing token. The add-on does not expose create/update/delete endpoints for cards or notes. Deployment must still verify Safari's HTTPS-to-local-network behavior on the target iPhone and Wi-Fi.
