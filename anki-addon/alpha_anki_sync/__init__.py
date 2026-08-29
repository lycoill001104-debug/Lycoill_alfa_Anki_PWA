from __future__ import annotations

import base64
import json
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Callable
from urllib.parse import urlparse

from aqt import gui_hooks, mw
from aqt.qt import QAction, QDialog, QInputDialog, QLabel, QLineEdit, QPushButton, QVBoxLayout
from aqt.utils import showInfo
from aqt.webview import AnkiWebView


ADDON_MODULE = __name__
SERVER: "SyncServer | None" = None


def _config() -> dict[str, Any]:
    config = mw.addonManager.getConfig(ADDON_MODULE) or {}
    if not config.get("token"):
        config["token"] = secrets.token_urlsafe(18)
        mw.addonManager.writeConfig(ADDON_MODULE, config)
    return config


def _run_on_main(function: Callable[[], Any], timeout: float = 20.0) -> Any:
    completed = threading.Event()
    result: dict[str, Any] = {}

    def invoke() -> None:
        try:
            result["value"] = function()
        except Exception as error:  # returned to the request thread
            result["error"] = error
        finally:
            completed.set()

    mw.taskman.run_on_main(invoke)
    if not completed.wait(timeout):
        raise TimeoutError("Anki main thread did not respond")
    if "error" in result:
        raise result["error"]
    return result.get("value")


def _lan_ip() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        return str(probe.getsockname()[0])
    except OSError:
        return "<WindowsのIPアドレス>"
    finally:
        probe.close()


def _set_pwa_url() -> str | None:
    config = _config()
    current = str(config.get("pwa_url", ""))
    value, accepted = QInputDialog.getText(
        mw,
        "αnki PWA URL設定",
        "静的ホスティングで公開したαnkiのHTTPS URLを入力してください。",
        QLineEdit.EchoMode.Normal,
        current,
    )
    if not accepted:
        return None
    pwa_url = value.strip().rstrip("/")
    parsed = urlparse(pwa_url)
    if parsed.scheme != "https" or not parsed.netloc:
        showInfo("https:// から始まる公開済みPWAのURLを入力してください。")
        return None
    config["pwa_url"] = pwa_url
    mw.addonManager.writeConfig(ADDON_MODULE, config)
    return pwa_url


def _pwa_url() -> str | None:
    configured = str(_config().get("pwa_url", "")).strip().rstrip("/")
    return configured or _set_pwa_url()


def _pairing_url(pwa_url: str) -> str:
    config = _config()
    endpoint = f"http://{_lan_ip()}:{int(config.get('port', 8766))}"
    payload = json.dumps(
        {"version": 1, "endpoint": endpoint, "token": config["token"], "transport": "bridge"},
        separators=(",", ":"),
    ).encode("utf-8")
    encoded = base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")
    return f"{pwa_url}/#pair={encoded}"


def _show_pairing() -> None:
    pwa_url = _pwa_url()
    if not pwa_url:
        return
    pair_url = _pairing_url(pwa_url)
    addon_dir = os.path.dirname(__file__)
    with open(os.path.join(addon_dir, "web", "qrcode.js"), "r", encoding="utf-8") as source:
        qr_script = source.read()

    dialog = QDialog(mw)
    dialog.setWindowTitle("αnki PWA ペアリング")
    dialog.resize(440, 590)
    dialog.setMinimumSize(410, 540)
    layout = QVBoxLayout(dialog)
    explanation = QLabel("iPhoneを同じWi-Fiへ接続し、ホーム画面のαnkiで\n「設定 → QRコードを読み取る」を開いてください。")
    explanation.setWordWrap(True)
    layout.addWidget(explanation)
    web = AnkiWebView(parent=dialog, title="alpha-anki-pairing")
    web.setHtml(
        "<!doctype html><meta charset='utf-8'><style>"
        "body{margin:0;background:#f4f7f2;color:#203327;font-family:system-ui,sans-serif;text-align:center}"
        ".wrap{box-sizing:border-box;padding:14px;overflow:hidden}.qr{display:inline-block;padding:14px;background:white;border-radius:18px;box-shadow:0 10px 30px #1733221f}"
        ".qr svg{display:block;width:min(232px,72vw);height:auto;max-width:100%}.ok{margin-top:14px;font-weight:750;font-size:17px}"
        ".hint{margin:10px auto 0;max-width:340px;color:#607066;font-size:12px;line-height:1.55}"
        "</style><div class='wrap'><div id='qr' class='qr'></div><div class='ok'>αnkiアプリから読み取ってペアリング</div>"
        "<p class='hint'>QRコードには、このPCだけで使う接続情報が含まれます。<br>第三者へ共有しないでください。</p>"
        f"</div><script>{qr_script}</script><script>"
        f"const pairUrl={json.dumps(pair_url)};const qr=qrcode(0,'M');qr.addData(pairUrl);qr.make();"
        "document.getElementById('qr').innerHTML=qr.createSvgTag({cellSize:4,margin:0,scalable:true});</script>"
    )
    layout.addWidget(web)
    close_button = QPushButton("閉じる")
    close_button.clicked.connect(dialog.accept)
    layout.addWidget(close_button)
    dialog.exec()


BRIDGE_HTML = r"""<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>αnki 同期中</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef3ec;color:#25372b;font-family:system-ui,sans-serif}
.card{width:min(430px,calc(100% - 40px));box-sizing:border-box;padding:34px;border:1px solid #d5e0d4;border-radius:28px;background:white;text-align:center;box-shadow:0 24px 70px #17332222}
.mark{display:grid;place-items:center;width:52px;height:52px;margin:auto;border-radius:18px;background:#39754f;color:white;font-size:22px;font-weight:900}
h1{margin:20px 0 8px;font-size:22px}.status{color:#657368;font-size:14px;line-height:1.7}.spinner{width:26px;height:26px;margin:24px auto 0;border:3px solid #dce6dc;border-top-color:#39754f;border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
<main class="card"><div class="mark">A</div><h1>Windows Ankiと同期中</h1><p id="status" class="status">この画面は自動的にαnkiへ戻ります。</p><div class="spinner"></div></main>
<script>
const statusNode=document.getElementById('status');
function fromB64(value){const s=value.replace(/-/g,'+').replace(/_/g,'/');const b=atob(s+'='.repeat((4-s.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0))}
function toB64(bytes){let b='';for(let i=0;i<bytes.length;i+=32768)b+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(b).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
async function decode(value){const [kind,data]=value.split('.',2);const bytes=fromB64(data);if(kind==='j')return JSON.parse(new TextDecoder().decode(bytes));if(kind!=='z'||!('DecompressionStream'in window))throw new Error('同期要求を読み取れません');const raw=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return JSON.parse(new TextDecoder().decode(raw))}
async function encode(value){const bytes=new TextEncoder().encode(JSON.stringify(value));if(!('CompressionStream'in window))return'j.'+toB64(bytes);const zip=await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();return'z.'+toB64(new Uint8Array(zip))}
async function run(){let request;try{request=await decode(location.hash.slice(1));const response=await fetch('/v1/sync',{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+request.token},body:JSON.stringify(request.body)});const payload=await response.json();if(!response.ok)throw new Error(payload.message||'同期に失敗しました');statusNode.textContent='同期完了。αnkiへ戻ります…';const encoded=await encode(payload);location.replace(request.returnUrl+'?bridge=1#'+encoded)}catch(error){statusNode.textContent='同期できませんでした: '+(error instanceof Error?error.message:String(error));document.querySelector('.spinner').remove();if(request?.returnUrl)setTimeout(()=>location.replace(request.returnUrl+'?bridgeError='+encodeURIComponent(error instanceof Error?error.message:String(error))),1800)}}
void run();
</script>"""


def _due_cards() -> list[dict[str, Any]]:
    if not mw.col:
        return []
    now = int(time.time() * 1000)
    card_ids = mw.col.find_cards("is:due")
    cards: list[dict[str, Any]] = []
    for card_id in card_ids:
        card = mw.col.get_card(card_id)
        note = card.note()
        deck_id = int(card.did)
        cards.append(
            {
                "id": int(card.id),
                "deckId": deck_id,
                "deckName": mw.col.decks.name(deck_id),
                "question": card.question(),
                "answer": card.answer(),
                "tags": list(note.tags),
                "dueAt": now,
                "updatedAt": int(getattr(card, "mod", int(time.time())) * 1000),
            }
        )
    return cards


def _apply_reviews(reviews: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, str]]]:
    config = _config()
    applied = set(config.get("applied_review_ids", []))
    accepted: list[str] = []
    rejected: list[dict[str, str]] = []
    if not mw.col:
        return accepted, [{"id": str(item.get("id", "")), "reason": "Collection is not open"} for item in reviews]

    for review in sorted(reviews, key=lambda item: int(item.get("reviewedAt", 0))):
        event_id = str(review.get("id", ""))
        if not event_id:
            continue
        if event_id in applied:
            accepted.append(event_id)
            continue
        try:
            card_id = int(review["ankiCardId"])
            rating = int(review["rating"])
            if rating not in (1, 2, 3, 4):
                raise ValueError("Rating must be 1-4")
            card = mw.col.get_card(card_id)
            if not card or not card.id:
                raise ValueError("Card was deleted")
            # The scheduler remains the only writer of scheduling state. The
            # historical timestamp is preserved in the PWA event, while Anki
            # applies the transition at import time in this v0.1 protocol.
            mw.col.sched.answerCard(card, rating)
            applied.add(event_id)
            accepted.append(event_id)
        except Exception as error:
            rejected.append({"id": event_id, "reason": str(error)})

    config["applied_review_ids"] = list(applied)[-10000:]
    mw.addonManager.writeConfig(ADDON_MODULE, config)
    return accepted, rejected


class SyncHandler(BaseHTTPRequestHandler):
    server_version = "AlphaAnkiSync/0.4"

    def _origin(self) -> str:
        origin = self.headers.get("Origin", "*")
        allowed = _config().get("allowed_origins", ["*"])
        return origin if "*" in allowed or origin in allowed else "null"

    def _headers(self, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", self._origin())
        self.send_header("Access-Control-Allow-Headers", "authorization, content-type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        self._headers(status)
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def _html(self, status: int, body: str) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        expected = f"Bearer {_config().get('token', '')}"
        return bool(expected != "Bearer " and secrets.compare_digest(self.headers.get("Authorization", ""), expected))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._headers(204)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] == "/bridge":
            self._html(200, BRIDGE_HTML)
            return
        if self.path != "/v1/status":
            self._json(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        self._json(200, {"ok": True, "ankiOpen": mw.col is not None, "serverTime": int(time.time() * 1000)})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/sync":
            self._json(404, {"error": "not_found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 5_000_000)
            body = json.loads(self.rfile.read(length) or b"{}")
            reviews = body.get("reviews", [])
            if not isinstance(reviews, list):
                raise ValueError("reviews must be an array")
            accepted, rejected = _run_on_main(lambda: _apply_reviews(reviews))
            cards = _run_on_main(_due_cards)
            now = int(time.time() * 1000)
            self._json(200, {
                "cursor": str(now), "serverTime": now, "cards": cards,
                "deletedCardIds": [], "acceptedReviewIds": accepted, "rejectedReviews": rejected,
            })
        except Exception as error:
            self._json(500, {"error": "sync_failed", "message": str(error)})

    def log_message(self, format: str, *args: Any) -> None:
        return


class SyncServer:
    def __init__(self) -> None:
        config = _config()
        self.httpd = ThreadingHTTPServer((str(config.get("bind", "0.0.0.0")), int(config.get("port", 8766))), SyncHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="alpha-anki-sync", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def _start_server() -> None:
    global SERVER
    if SERVER is not None:
        return
    try:
        SERVER = SyncServer()
        SERVER.start()
    except OSError as error:
        SERVER = None
        showInfo(f"αnki Syncを起動できませんでした。\n\n{error}")


def _stop_server() -> None:
    global SERVER
    if SERVER is not None:
        SERVER.stop()
        SERVER = None


action = QAction("αnki PWA ペアリング", mw)
action.triggered.connect(_show_pairing)
mw.form.menuTools.addAction(action)
url_action = QAction("αnki PWA URL設定", mw)
url_action.triggered.connect(_set_pwa_url)
mw.form.menuTools.addAction(url_action)
gui_hooks.profile_did_open.append(_start_server)
gui_hooks.profile_will_close.append(_stop_server)
