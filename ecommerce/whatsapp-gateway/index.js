require('dotenv').config();

const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const PORT = process.env.PORT || 3001;

const app = express();
app.use(cors());
app.use(express.json());

// In-memory state
let currentQr = null;
let status = 'initializing'; // "initializing" | "qr" | "authenticated" | "ready" | "disconnected"

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

client.on('qr', (qr) => {
  currentQr = qr;
  status = 'qr';
  console.log('[whatsapp-gateway] QR code received. Scan it via GET /qr or the terminal below:');
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('authenticated', () => {
  status = 'authenticated';
  console.log('[whatsapp-gateway] authenticated');
});

client.on('ready', () => {
  currentQr = null;
  status = 'ready';
  console.log('[whatsapp-gateway] client is ready');
});

client.on('disconnected', (reason) => {
  currentQr = null;
  status = 'disconnected';
  console.log('[whatsapp-gateway] disconnected:', reason);
});

client.initialize().catch((err) => {
  console.error('[whatsapp-gateway] failed to initialize client:', err);
});

app.get('/status', (req, res) => {
  res.status(200).json({ status, connected: status === 'ready' });
});

app.get('/qr', async (req, res) => {
  if (currentQr && status !== 'ready') {
    try {
      const qrImageBase64 = await qrcode.toDataURL(currentQr);
      return res.status(200).json({ qr: currentQr, qrImageBase64 });
    } catch (err) {
      console.error('[whatsapp-gateway] failed to render QR image:', err);
      return res.status(200).json({ qr: currentQr, qrImageBase64: null });
    }
  }
  return res.status(200).json({ qr: null, qrImageBase64: null, status });
});

app.post('/send', async (req, res) => {
  const { phone, message } = req.body || {};

  if (!phone || !message) {
    return res.status(400).json({ sent: false, reason: 'missing_phone_or_message' });
  }

  if (status !== 'ready') {
    console.log(`[whatsapp-gateway] (not connected, would send to ${phone}): ${message}`);
    return res.status(200).json({ sent: false, reason: 'not_connected' });
  }

  try {
    await client.sendMessage(`${phone}@c.us`, message);
    return res.status(200).json({ sent: true });
  } catch (err) {
    console.error('[whatsapp-gateway] failed to send message:', err);
    return res.status(200).json({ sent: false, reason: 'send_error' });
  }
});

app.post('/logout', async (req, res) => {
  try {
    await client.logout();
    status = 'disconnected';
    currentQr = null;
    return res.status(200).json({ loggedOut: true });
  } catch (err) {
    console.error('[whatsapp-gateway] failed to logout:', err);
    return res.status(200).json({ loggedOut: false, reason: 'logout_error' });
  }
});

app.listen(PORT, () => {
  console.log(`[whatsapp-gateway] listening on port ${PORT}`);
});
