# Billing / SDI / Voce — variabili d'ambiente (SERVER-EXTRA)

`server/.env.example` è di CORE: queste variabili vanno aggiunte lì dal coordinatore (solo segnaposto, nessun valore reale).

## Stripe (billing, senza SDK: `fetch` verso api.stripe.com)
| Variabile | Obbligatoria | Note |
|---|---|---|
| `STRIPE_SECRET_KEY` | per checkout/portal | chiave segreta API |
| `STRIPE_PRICE_MONTH`, `STRIPE_PRICE_YEAR` | per checkout | price id dei due piani |
| `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL` | per checkout | |
| `STRIPE_PORTAL_RETURN_URL` | no | default = `STRIPE_SUCCESS_URL` |
| `STRIPE_WEBHOOK_SECRET` | per webhook | HMAC-SHA256, tolleranza 300 s, idempotenza per event id |
| `BILLING_GRACE_DAYS` | no | default 7 (periodo di grazia dopo `invoice.payment_failed`) |

Endpoint Stripe da registrare: `POST /v1/billing/webhook` con eventi `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`.
Costi Stripe e piani: da verificare (vedi ARCHITECTURE-V2 §1.9).

## SDI (`/v1/sdi`) — nessun provider scelto: DISATTIVATO di default
`SDI_PROVIDER` = `mock` (solo non-produzione) | `http` | vuoto (=> `/submit` risponde `unsupported`).
Per `http` (scheletro generico, da adattare al provider scelto): `SDI_HTTP_BASE_URL`, `SDI_HTTP_API_KEY`; opzionali `SDI_HTTP_SUBMIT_PATH` (/invoices), `SDI_HTTP_ID_FIELD` (id), `SDI_HTTP_STATUS_MAP` (JSON stato->RC|NS|MC|INVIO), `SDI_WEBHOOK_SECRET` (HMAC-SHA256 hex del corpo; senza segreto i webhook sono rifiutati), `SDI_WEBHOOK_SIGNATURE_HEADER` (x-signature). Mock: `SDI_MOCK_DELAY_MS`, `SDI_WEBHOOK_SECRET`.
I codici di scarto del mock sono ESEMPI, non il catalogo SDI ufficiale (da verificare).

## Voce (`/v1/voice`)
STT: `STT_PROVIDER` = `http` | `mock` (non-produzione); per `http`: `STT_BASE_URL` (compatibile OpenAI-audio, `/audio/transcriptions`), `STT_API_KEY`, `STT_MODEL`.
Limiti: `VOICE_MAX_AUDIO_BYTES` (2 MB), `VOICE_MAX_DURATION_MS` (30000), `VOICE_MINUTES_FREE` (20), `VOICE_MINUTES_PRO` (120).
LLM fallback: `LLM_PROVIDER` = `http` | `mock`; per `http`: `LLM_BASE_URL` (compatibile /chat/completions), `LLM_API_KEY`, `LLM_MODEL`; prezzi per la metrica di costo: `LLM_PRICE_IN_PER_MTOK`, `LLM_PRICE_OUT_PER_MTOK`.
Privacy: l'audio resta in memoria e viene azzerato dopo l'uso; nessun audio/trascrizione nei log (solo metrica di costo).
