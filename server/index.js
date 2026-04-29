require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const {
  generateChallenge,
  verifyChallenge,
  createSession,
  getSession,
  sessions
} = require('./auth');
const { createCustodialWallet, getWalletInfo } = require('./stellar');
const { addToQueue, removeFromQueue, findMatch, recentPartners } = require('./matchmaking');
const reputation = require('./reputation');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3001;

// CORS — allow all origins for testing; lock down later for production
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// ─── REST API ────────────────────────────────────────────────

// Health check — useful for verifying the backend is alive
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now(), origins: ALLOWED_ORIGINS });
});

// Generate auth challenge for wallet signature
app.get('/api/auth/challenge', (req, res) => {
  const { pubkey } = req.query;
  if (!pubkey) return res.status(400).json({ error: 'Public key required' });

  try {
    const challenge = generateChallenge(pubkey);
    res.json({ success: true, challenge });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate challenge' });
  }
});

// Verify wallet signature and create session
app.post('/api/auth/verify-wallet', async (req, res) => {
  const { publicKey, signature } = req.body;
  if (!publicKey || !signature) {
    return res.status(400).json({ error: 'Public key and signature required' });
  }

  const valid = verifyChallenge(publicKey, signature);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const token = createSession(publicKey, { publicKey, isCustodial: false });
  const rep = await reputation.getReputation(publicKey);

  console.log(`✅ Freighter wallet connected: ${publicKey.slice(0, 8)}...${publicKey.slice(-6)}`);

  res.json({
    success: true,
    token,
    wallet: { publicKey },
    reputation: rep
  });
});

// Create custodial wallet (for users without Freighter)
app.post('/api/auth/create-custodial', async (req, res) => {
  try {
    const wallet = await createCustodialWallet();
    const token = createSession(wallet.publicKey, {
      publicKey: wallet.publicKey,
      secret: wallet.secret,
      isCustodial: true
    });

    // Register the custodial keypair for server-side signing
    reputation.registerCustodialKey(wallet.publicKey, wallet.secret);

    const rep = await reputation.getReputation(wallet.publicKey);

    console.log(`✅ Custodial wallet created: ${wallet.publicKey.slice(0, 8)}...${wallet.publicKey.slice(-6)}`);

    res.json({
      success: true,
      token,
      wallet: { publicKey: wallet.publicKey },
      reputation: rep,
      isCustodial: true
    });
  } catch (err) {
    console.error('Custodial wallet creation failed:', err);
    res.status(500).json({ error: 'Failed to create wallet' });
  }
});

// ─── Guest login (bypass wallet for testing) ─────────────────
app.post('/api/auth/guest', (req, res) => {
  const guestId = `GUEST_${uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
  const token = createSession(guestId, {
    publicKey: guestId,
    isCustodial: false,
    isGuest: true
  });

  console.log(`👤 Guest joined: ${guestId}`);

  res.json({
    success: true,
    token,
    wallet: { publicKey: guestId },
    reputation: 50,
    isGuest: true
  });
});

// Get session info
app.get('/api/auth/session', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = getSession(token);
  if (!session) return res.status(401).json({ error: 'Invalid session' });

  // Guest sessions get default reputation
  if (session.isGuest) {
    return res.json({
      publicKey: session.publicKey,
      wallet: { publicKey: session.publicKey },
      reputation: 50,
      isCustodial: false,
      isGuest: true
    });
  }

  const rep = await reputation.getReputation(session.publicKey);

  res.json({
    publicKey: session.publicKey,
    wallet: { publicKey: session.publicKey },
    reputation: rep,
    isCustodial: session.isCustodial
  });
});

// ─── SOCKET.IO ───────────────────────────────────────────────

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Track active connections: socketId -> { publicKey, token, matchedWith, sessionStart, preferences }
const activeConnections = new Map();

io.on('connection', (socket) => {
  console.log(`🔌 Socket connected: ${socket.id}`);

  // Authenticate socket
  socket.on('authenticate', async ({ token }) => {
    const session = getSession(token);
    if (!session) {
      socket.emit('auth-error', { error: 'Invalid session' });
      return;
    }

    // Guest users get default reputation
    const rep = session.isGuest ? 50 : await reputation.getReputation(session.publicKey);

    activeConnections.set(socket.id, {
      publicKey: session.publicKey,
      token,
      isCustodial: session.isCustodial,
      isGuest: session.isGuest || false,
      matchedWith: null,
      sessionStart: null,
      preferences: {}
    });

    socket.emit('authenticated', {
      publicKey: session.publicKey,
      reputation: rep,
      wallet: { publicKey: session.publicKey }
    });

    console.log(`🔐 Socket authenticated: ${socket.id} → ${session.publicKey.slice(0, 8)}...`);
  });

  // Join matchmaking queue
  socket.on('join-queue', async (preferences = {}) => {
    const conn = activeConnections.get(socket.id);
    if (!conn) return;

    conn.preferences = preferences;
    const rep = await reputation.getReputation(conn.publicKey);

    addToQueue(socket.id, {
      publicKey: conn.publicKey,
      gender: preferences.gender || 'any',
      genderPreference: preferences.genderPreference || 'any',
      reputation: rep
    });

    socket.emit('queue-joined', { position: 'searching' });
    console.log(`🔍 ${conn.publicKey.slice(0, 8)}... joined queue (pref: ${preferences.genderPreference || 'any'})`);

    // Try to find a match immediately
    tryMatch(socket.id);
  });

  async function tryMatch(socketId) {
    const conn = activeConnections.get(socketId);
    if (!conn) return;

    const match = findMatch(socketId);
    if (match) {
      const matchConn = activeConnections.get(match.socketId);
      if (!matchConn) return;

      // Set up the match
      conn.matchedWith = match.socketId;
      conn.sessionStart = Date.now();
      matchConn.matchedWith = socketId;
      matchConn.sessionStart = Date.now();

      // Track recent partners
      if (!recentPartners.has(conn.publicKey)) recentPartners.set(conn.publicKey, []);
      if (!recentPartners.has(matchConn.publicKey)) recentPartners.set(matchConn.publicKey, []);
      recentPartners.get(conn.publicKey).push(matchConn.publicKey);
      recentPartners.get(matchConn.publicKey).push(conn.publicKey);

      // Keep recent partners list manageable
      if (recentPartners.get(conn.publicKey).length > 10) recentPartners.get(conn.publicKey).shift();
      if (recentPartners.get(matchConn.publicKey).length > 10) recentPartners.get(matchConn.publicKey).shift();

      const connRep = await reputation.getReputation(conn.publicKey);
      const matchRep = await reputation.getReputation(matchConn.publicKey);

      // Notify both users — the first one creates the offer
      socket.emit('matched', { role: 'offerer', partnerReputation: matchRep });
      io.to(match.socketId).emit('matched', { role: 'answerer', partnerReputation: connRep });

      console.log(`🤝 Match: ${conn.publicKey.slice(0, 8)}... ↔ ${matchConn.publicKey.slice(0, 8)}...`);
    }
  }

  // WebRTC signaling
  socket.on('offer', ({ offer }) => {
    const conn = activeConnections.get(socket.id);
    if (conn?.matchedWith) {
      io.to(conn.matchedWith).emit('offer', { offer });
    }
  });

  socket.on('answer', ({ answer }) => {
    const conn = activeConnections.get(socket.id);
    if (conn?.matchedWith) {
      io.to(conn.matchedWith).emit('answer', { answer });
    }
  });

  socket.on('ice-candidate', ({ candidate }) => {
    const conn = activeConnections.get(socket.id);
    if (conn?.matchedWith) {
      io.to(conn.matchedWith).emit('ice-candidate', { candidate });
    }
  });

  // Next stranger
  socket.on('next', async (preferences = {}) => {
    const conn = activeConnections.get(socket.id);
    if (!conn) return;

    // Disconnect from current partner
    if (conn.matchedWith) {
      const partnerConn = activeConnections.get(conn.matchedWith);
      if (partnerConn) {
        partnerConn.matchedWith = null;
        partnerConn.sessionStart = null;
        io.to(conn.matchedWith).emit('stranger-disconnected');
      }
      conn.matchedWith = null;
      conn.sessionStart = null;
    }

    // Re-queue with preferences
    conn.preferences = preferences;
    const rep = await reputation.getReputation(conn.publicKey);
    addToQueue(socket.id, {
      publicKey: conn.publicKey,
      gender: preferences.gender || 'any',
      genderPreference: preferences.genderPreference || 'any',
      reputation: rep
    });

    socket.emit('queue-joined', { position: 'searching' });
    tryMatch(socket.id);
  });

  // Like user
  socket.on('like', async () => {
    const conn = activeConnections.get(socket.id);
    if (!conn || !conn.matchedWith) return;

    const partnerConn = activeConnections.get(conn.matchedWith);
    if (!partnerConn) return;

    // Check minimum session duration (30 seconds)
    const sessionDuration = Date.now() - conn.sessionStart;
    if (sessionDuration < 30000) {
      socket.emit('action-error', { error: 'Chat for at least 30 seconds before liking' });
      return;
    }

    const newRep = await reputation.likeUser(conn.publicKey, partnerConn.publicKey);
    io.to(conn.matchedWith).emit('liked', { fromReputation: reputation.getReputationCached(conn.publicKey) });
    socket.emit('action-success', { action: 'like', message: 'Like sent! 👍' });
    io.to(conn.matchedWith).emit('reputation-update', { reputation: newRep });

    console.log(`👍 ${conn.publicKey.slice(0, 8)}... liked ${partnerConn.publicKey.slice(0, 8)}... (new rep: ${newRep})`);
  });

  // Report user
  socket.on('report', async ({ reason }) => {
    const conn = activeConnections.get(socket.id);
    if (!conn || !conn.matchedWith) return;

    const partnerConn = activeConnections.get(conn.matchedWith);
    if (!partnerConn) return;

    const sessionDuration = Date.now() - conn.sessionStart;
    if (sessionDuration < 30000) {
      socket.emit('action-error', { error: 'Chat for at least 30 seconds before reporting' });
      return;
    }

    const newRep = await reputation.reportUser(conn.publicKey, partnerConn.publicKey, reason);
    socket.emit('action-success', { action: 'report', message: 'Report submitted' });
    io.to(conn.matchedWith).emit('reputation-update', { reputation: newRep });

    console.log(`🚩 ${conn.publicKey.slice(0, 8)}... reported ${partnerConn.publicKey.slice(0, 8)}... (reason: ${reason}, new rep: ${newRep})`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    const conn = activeConnections.get(socket.id);
    if (conn) {
      // Notify partner
      if (conn.matchedWith) {
        const partnerConn = activeConnections.get(conn.matchedWith);
        if (partnerConn) {
          partnerConn.matchedWith = null;
          partnerConn.sessionStart = null;
          io.to(conn.matchedWith).emit('stranger-disconnected');
        }
      }
      removeFromQueue(socket.id);
      activeConnections.delete(socket.id);
      console.log(`❌ Disconnected: ${conn.publicKey?.slice(0, 8) || socket.id}...`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n🚀 Knapp server running on port ${PORT}`);
  console.log(`   CORS: all origins allowed (testing mode)`);
  console.log(`   Guest login: enabled`);
  console.log(`   Soroban Contract: ${process.env.SOROBAN_CONTRACT_ID || '(not configured — using in-memory)'}`);
  console.log(`   Network: ${process.env.STELLAR_NETWORK || 'testnet'}\n`);
});
