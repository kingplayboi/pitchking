const path = require('path');
const pino = require('pino');
const store = require('./store');
const dbAuthState = require('./dbAuth');

const AUTH = path.join(__dirname, '..', '..', 'auth');
const num = (jid) => String(jid || '').split('@')[0].split(':')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const known = new Map();
const decodeSession = (sid) => Buffer.from(String(sid).split('~').pop().trim(), 'base64').toString('utf8');

async function start(handle) {
  const mod = await import('@whiskeysockets/baileys');
  const pick = (k) => mod[k] || (mod.default && mod.default[k]);
  const makeWASocket = typeof mod.default === 'function' ? mod.default : (mod.default && mod.default.default) || mod.makeWASocket;
  const DisconnectReason = pick('DisconnectReason');
  const downloadMediaMessage = pick('downloadMediaMessage');

  let state, saveCreds;
  const auth = store.authStore();
  const BufferJSON = pick('BufferJSON');
  if (auth) {
    if (!(await auth.get('creds')) && process.env.SESSION_ID) {
      const json = decodeSession(process.env.SESSION_ID);
      let ok = false;
      try { ok = !!JSON.parse(json, BufferJSON.reviver).noiseKey; } catch {}
      if (!ok) { console.error('SESSION_ID is not a valid session. Generate a new one.'); process.exit(1); }
      await auth.set('creds', json);
      console.log('Session imported from SESSION_ID');
    }
    ({ state, saveCreds } = await dbAuthState(auth, {
      BufferJSON, initAuthCreds: pick('initAuthCreds'), proto: pick('proto'),
    }));
  } else {
    ({ state, saveCreds } = await pick('useMultiFileAuthState')(AUTH));
  }

  const { version } = await pick('fetchLatestBaileysVersion')();
  const logger = pino({ level: 'silent' });
  const sock = makeWASocket({ version, auth: state, logger, browser: pick('Browsers').macOS('Chrome'), markOnlineOnConnect: false });

  if (!sock.authState.creds.registered) {
    const n = (process.env.PAIR_NUMBER || '').replace(/\D/g, '');
    if (!n) { console.log('Not paired yet. Run: PAIR_NUMBER=2547XXXXXXXX npm start'); process.exit(1); }
    setTimeout(async () => {
      try { console.log('\n🔗 Pairing code:', await sock.requestPairingCode(n), '\n'); }
      catch (e) { console.error('Could not get pairing code:', e.message); }
    }, 3000);
  }

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('✅ WhatsApp connected');
    if (connection === 'close') {
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      if (code === DisconnectReason.loggedOut) { console.log('Logged out. Clear the saved session and pair again.'); process.exit(1); }
      if (code === DisconnectReason.connectionReplaced) { console.log('Another copy of this bot took over this number. Exiting.'); process.exit(1); }
      console.log('Connection closed, reconnecting...');
      setTimeout(() => start(handle).catch(console.error), 3000);
    }
  });

  const send = async (to, m) => {
    const jid = known.get(num(to)) || `${num(to)}@s.whatsapp.net`;
    try { await sock.sendPresenceUpdate('composing', jid); } catch {}
    await sleep(600 + Math.random() * 1200);
    if (m.image) {
      if (/^https?:/.test(m.image)) return sock.sendMessage(jid, { image: { url: m.image }, caption: m.text });
      const buf = await store.getImage(m.image);
      if (buf) return sock.sendMessage(jid, { image: buf, caption: m.text });
    }
    return sock.sendMessage(jid, { text: m.text });
  };

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const m of messages) {
      try {
        if (!m.message || m.key.fromMe) continue;
        const jid = m.key.remoteJid;
        if (!jid || /@(g\.us|broadcast|newsletter)$/.test(jid)) continue;
        const real = jid.endsWith('@lid') && m.key.remoteJidAlt ? m.key.remoteJidAlt : jid;
        const from = num(real);
        known.set(from, jid);
        const msg = m.message;
        const text = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || (msg.imageMessage && msg.imageMessage.caption) || '';
        const media = msg.imageMessage
          ? { getBuffer: () => downloadMediaMessage(m, 'buffer', {}, { logger, reuploadRequest: sock.updateMediaMessage }) }
          : null;
        console.log(`[in] ${from}: ${text || '[image]'}`);
        await handle(from, text, send, media);
      } catch (e) {
        console.error('Handler error:', e.message);
      }
    }
  });
}

module.exports = { start };
