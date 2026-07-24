# whatsapp-gateway

Small Node.js microservice whose only job is to connect to WhatsApp Web (as
the store's own WhatsApp number) and send outbound text messages on behalf
of the Sunset Tabas Rust backend. It does not implement any business logic — the
Rust API decides *when* to notify a customer (payment confirmed, aguardando
localização, saiu para entrega, etc.) and calls this service's `/send`
endpoint to actually deliver the message via WhatsApp.

Built with `express`, `whatsapp-web.js` (WhatsApp Web automation via
`puppeteer`), `qrcode` (renders the login QR as a PNG data URL) and
`qrcode-terminal` (prints the same QR as ASCII in the terminal, for
convenience).

## Running

```bash
npm install   # first run downloads a bundled Chromium via puppeteer, can take a few minutes
npm run dev   # starts the server on port 3001 (or PORT env var)
```

The server boots and starts listening immediately, even before WhatsApp is
linked — it works in both states:

- **Not connected yet**: `/status` reports `"initializing"` or `"qr"`, and
  `/send` logs the message to the console and responds
  `{"sent": false, "reason": "not_connected"}` instead of erroring, so the
  Rust backend can treat notifications as fire-and-forget.
- **Connected**: `/status` reports `"ready"` and `/send` actually delivers
  the message.

## Linking a WhatsApp number (first run)

On first run there is no saved session, so the client will emit a QR code.
Link it the same way you'd link WhatsApp Web in a browser:

1. Start the service (`npm run dev`) and either watch the terminal (an
   ASCII QR is printed automatically) or open `GET http://localhost:3001/qr`
   in a browser/admin page (it returns a scannable PNG as a base64 data
   URL).
2. On the store's phone: WhatsApp → **Aparelhos conectados** → **Conectar
   um aparelho**, then scan the QR.
3. Once scanned, the session is persisted to `.wwebjs_auth/` so you don't
   need to re-scan on every restart. `/status` will move to `"ready"`.

To unlink and scan a different number, call `POST /logout`.

## Endpoints

- `GET /status` → `{ status, connected }`. `status` is one of
  `"initializing" | "qr" | "authenticated" | "ready" | "disconnected"`.
  Always responds, even mid-initialization.
- `GET /qr` → `{ qr, qrImageBase64 }` while a QR is pending (`qrImageBase64`
  is a `data:image/png;base64,...` string ready for an `<img src>`), or
  `{ qr: null, qrImageBase64: null, status }` once connected / if no QR is
  available.
- `POST /send` — body `{ "phone": "5583999999999", "message": "..." }`
  (`phone` is digits only: country code + area + number, no `+` or
  symbols). Always responds `200`:
  - Not connected: `{ sent: false, reason: "not_connected" }` (message is
    only logged to the console).
  - Connected, delivered: `{ sent: true }`.
  - Connected, send failed: `{ sent: false, reason: "send_error" }`.
- `POST /logout` → logs the client out of WhatsApp Web so a different
  number can be linked. `{ loggedOut: true }`.

## Notes

- Session data lives in `.wwebjs_auth/` and Puppeteer/Chromium cache in
  `.wwebjs_cache/`, both gitignored by the parent repo's `.gitignore`.
- CORS is wide open (`cors()` with no options) — this is local-only dev
  tooling that only the Rust backend and an internal admin page talk to.
