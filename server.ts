import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import type * as WebPushType from 'web-push';
import { WebSocketServer, WebSocket } from 'ws';

const require = createRequire(import.meta.url);
const webpush = require('web-push') as typeof WebPushType;

interface EncryptedMessageEnvelope {
  id: string;
  iv: string;
  ciphertext: string;
  timestamp: number;
  expiresAt: number | null;
  senderClientId?: string;
  receiptStatus?: 'sent' | 'delivered' | 'read';
  deletedForEveryone?: boolean;
  deletedByClientId?: string;
}

interface StoredPushSubscription {
  clientId: string;
  subscription: WebPushType.PushSubscription;
}

interface StoredRoom {
  roomId: string;
  gateHash: string;
  createdAt: number;
  messages: EncryptedMessageEnvelope[];
  pushSubscriptions?: StoredPushSubscription[];
}

interface VaultDatabase {
  rooms: Record<string, StoredRoom>;
}

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

interface SubscribedClient {
  ws: WebSocket;
  roomId: string;
  clientId: string;
}

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.resolve(process.cwd(), '.data');
const DATA_FILE = path.join(DATA_DIR, 'vaults.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const MAX_MESSAGES_PER_ROOM = 500;

let db: VaultDatabase = { rooms: {} };
let vapidKeys: VapidKeys;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadOrCreateVapidKeys(): VapidKeys {
  ensureDataDir();
  try {
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8')) as VapidKeys;
      if (parsed.publicKey && parsed.privateKey) {
        return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read VAPID keys:', err);
  }
  const generated = webpush.generateVAPIDKeys();
  fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), 'utf-8');
  return generated;
}

function loadDatabase(): void {
  try {
    ensureDataDir();
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as VaultDatabase;
      if (parsed && typeof parsed === 'object' && parsed.rooms) {
        db = parsed;
      }
    }
  } catch (err) {
    console.error('Failed to load encrypted vault store:', err);
    db = { rooms: {} };
  }
}

function scheduleSave(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      ensureDataDir();
      const tempFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(db), 'utf-8');
      fs.renameSync(tempFile, DATA_FILE);
    } catch (err) {
      console.error('Failed to persist encrypted vault store:', err);
    }
  }, 200);
}

function pruneRoomExpiredMessages(room: StoredRoom): string[] {
  const now = Date.now();
  const expiredIds: string[] = [];
  const kept: EncryptedMessageEnvelope[] = [];
  for (const msg of room.messages) {
    if (msg.expiresAt !== null && msg.expiresAt <= now) {
      expiredIds.push(msg.id);
    } else {
      kept.push(msg);
    }
  }
  if (expiredIds.length > 0) {
    room.messages = kept;
    scheduleSave();
  }
  return expiredIds;
}

loadDatabase();
vapidKeys = loadOrCreateVapidKeys();
webpush.setVapidDetails('mailto:alerts@veil.local', vapidKeys.publicKey, vapidKeys.privateKey);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '25mb' }));

const roomSubscribers = new Map<string, Set<SubscribedClient>>();

function broadcastToRoom(roomId: string, payload: unknown, excludeClientId?: string): void {
  const subscribers = roomSubscribers.get(roomId);
  if (!subscribers) return;
  const serialized = JSON.stringify(payload);
  for (const sub of subscribers) {
    if (excludeClientId && sub.clientId === excludeClientId) continue;
    if (sub.ws.readyState === WebSocket.OPEN) {
      sub.ws.send(serialized);
    }
  }
}

function broadcastPresence(roomId: string): void {
  const subscribers = roomSubscribers.get(roomId);
  if (!subscribers) return;
  const distinctClientIds = new Set<string>();
  for (const sub of subscribers) {
    if (sub.ws.readyState === WebSocket.OPEN) {
      distinctClientIds.add(sub.clientId);
    }
  }
  const activeCount = distinctClientIds.size;
  for (const sub of subscribers) {
    if (sub.ws.readyState === WebSocket.OPEN) {
      let otherCount = 0;
      for (const cid of distinctClientIds) {
        if (cid !== sub.clientId) otherCount += 1;
      }
      sub.ws.send(
        JSON.stringify({
          type: 'presence:update',
          activeCount,
          partnerOnline: otherCount > 0,
        })
      );
    }
  }
}

async function sendHighPriorityPushToPartners(
  room: StoredRoom,
  senderClientId?: string
): Promise<void> {
  const subs = room.pushSubscriptions;
  if (!subs || subs.length === 0) return;

  // Discreet zero-leakage alert payload (no plaintext, no sender name, no space name)
  const payload = JSON.stringify({
    title: 'Internet Edge',
    body: 'New encrypted activity · Open & unlock to view',
    tag: 'veil-private-alert',
  });

  const staleEndpoints = new Set<string>();

  await Promise.all(
    subs.map(async (entry) => {
      if (senderClientId && entry.clientId === senderClientId) return;
      try {
        await webpush.sendNotification(entry.subscription, payload, {
          urgency: 'high',
          TTL: 86400,
        });
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          staleEndpoints.add(entry.subscription.endpoint);
        }
      }
    })
  );

  if (staleEndpoints.size > 0 && room.pushSubscriptions) {
    room.pushSubscriptions = room.pushSubscriptions.filter(
      (s) => !staleEndpoints.has(s.subscription.endpoint)
    );
    scheduleSave();
  }
}

setInterval(() => {
  for (const [roomId, room] of Object.entries(db.rooms)) {
    const expiredIds = pruneRoomExpiredMessages(room);
    if (expiredIds.length > 0) {
      broadcastToRoom(roomId, { type: 'messages:expired', messageIds: expiredIds });
    }
  }
}, 5000);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Exact Device IP & Server-Observed Network Location Headers
app.get('/api/device-info', (req, res) => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const rawIp =
    (forwardedStr ? forwardedStr.split(',')[0].trim() : null) ||
    (typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : null) ||
    req.ip ||
    req.socket.remoteAddress ||
    'Unknown';
  const cleanIp = rawIp.replace(/^::ffff:/, '');

  const city =
    (req.headers['x-appengine-city'] as string | undefined) ||
    (req.headers['cf-ipcity'] as string | undefined) ||
    null;
  const region = (req.headers['x-appengine-region'] as string | undefined) || null;
  const country =
    (req.headers['x-appengine-country'] as string | undefined) ||
    (req.headers['cf-ipcountry'] as string | undefined) ||
    null;

  res.json({
    ip: cleanIp,
    city,
    region,
    country,
    userAgent: req.headers['user-agent'] || 'Unknown',
    serverTime: Date.now(),
  });
});

// Web Push VAPID public key
app.get('/api/push/vapid-public-key', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// Subscribe device for high-priority background/closed-browser push alerts
app.post('/api/rooms/:roomId/push-subscribe', (req, res) => {
  const { roomId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  const { clientId, subscription } = req.body as {
    clientId?: string;
    subscription?: WebPushType.PushSubscription;
  };

  if (!clientId || !subscription || !subscription.endpoint) {
    res.status(400).json({ error: 'Invalid push subscription.' });
    return;
  }

  if (!room.pushSubscriptions) {
    room.pushSubscriptions = [];
  }

  room.pushSubscriptions = room.pushSubscriptions.filter(
    (s) => s.subscription.endpoint !== subscription.endpoint && s.clientId !== clientId
  );
  room.pushSubscriptions.push({ clientId, subscription });
  scheduleSave();
  res.json({ ok: true });
});

app.delete('/api/rooms/:roomId/push-subscribe', (req, res) => {
  const { roomId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const clientId = req.header('x-client-id');
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  if (room.pushSubscriptions && clientId) {
    room.pushSubscriptions = room.pushSubscriptions.filter((s) => s.clientId !== clientId);
    scheduleSave();
  }
  res.json({ ok: true });
});

// Create or verify/join an encrypted space
app.post('/api/rooms/join', (req, res) => {
  const { roomId, gateHash, mode } = req.body as {
    roomId?: string;
    gateHash?: string;
    mode?: 'create' | 'join' | 'auto';
  };

  if (
    !roomId ||
    !gateHash ||
    typeof roomId !== 'string' ||
    typeof gateHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(roomId) ||
    !/^[a-f0-9]{64}$/.test(gateHash)
  ) {
    res.status(400).json({ error: 'Invalid encrypted space identifier or passphrase hash.' });
    return;
  }

  const existing = db.rooms[roomId];
  if (!existing) {
    if (mode === 'join') {
      res.status(404).json({
        error: 'No private space found with that unique name. Switch to Create Space to start it.',
      });
      return;
    }
    const created: StoredRoom = {
      roomId,
      gateHash,
      createdAt: Date.now(),
      messages: [],
      pushSubscriptions: [],
    };
    db.rooms[roomId] = created;
    scheduleSave();
    res.json({ ok: true, isNew: true, messages: [] });
    return;
  }

  if (existing.gateHash !== gateHash) {
    if (mode === 'create') {
      res.status(409).json({
        code: 'SPACE_NAME_TAKEN',
        error:
          'This unique space name is already registered with a different passphrase. Choose a new unique name or switch to Join Partner.',
      });
      return;
    }
    res.status(403).json({
      error: 'Incorrect secret passphrase for this unique space name.',
    });
    return;
  }

  pruneRoomExpiredMessages(existing);
  res.json({ ok: true, isNew: false, messages: existing.messages });
});

// Fetch latest encrypted envelopes
app.get('/api/rooms/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const room = db.rooms[roomId];
  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }
  pruneRoomExpiredMessages(room);
  res.json({ ok: true, messages: room.messages });
});

// Post an encrypted message envelope
app.post('/api/rooms/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const senderClientId = req.header('x-client-id') || undefined;
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  const body = req.body as Partial<EncryptedMessageEnvelope>;
  if (
    !body ||
    typeof body.id !== 'string' ||
    typeof body.iv !== 'string' ||
    typeof body.ciphertext !== 'string' ||
    typeof body.timestamp !== 'number'
  ) {
    res.status(400).json({ error: 'Malformed encrypted envelope.' });
    return;
  }

  if (room.messages.some((m) => m.id === body.id)) {
    res.json({ ok: true, duplicate: true });
    return;
  }

  const hasOnlinePartner = Array.from(roomSubscribers.get(roomId) || []).some(
    (s) => s.clientId !== senderClientId && s.ws.readyState === WebSocket.OPEN
  );

  const envelope: EncryptedMessageEnvelope = {
    id: body.id,
    iv: body.iv,
    ciphertext: body.ciphertext,
    timestamp: body.timestamp,
    expiresAt: typeof body.expiresAt === 'number' ? body.expiresAt : null,
    senderClientId,
    receiptStatus: hasOnlinePartner ? 'delivered' : 'sent',
  };

  room.messages.push(envelope);
  if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
    room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
  }
  scheduleSave();

  broadcastToRoom(roomId, { type: 'message:created', message: envelope });
  sendHighPriorityPushToPartners(room, senderClientId).catch(() => undefined);

  res.json({ ok: true, message: envelope });
});

// Soft-delete a message for everyone (wipes server ciphertext, preserves tombstone)
app.post('/api/rooms/:roomId/messages/:messageId/soft-delete', (req, res) => {
  const { roomId, messageId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const clientId = req.header('x-client-id') || 'unknown';
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  const target = room.messages.find((m) => m.id === messageId);
  if (target) {
    target.deletedForEveryone = true;
    target.deletedByClientId = clientId;
    target.iv = '';
    target.ciphertext = '';
    scheduleSave();
    broadcastToRoom(roomId, {
      type: 'message:soft-deleted',
      messageId,
      deletedByClientId: clientId,
    });
  }
  res.json({ ok: true });
});

// Hard delete a message
app.delete('/api/rooms/:roomId/messages/:messageId', (req, res) => {
  const { roomId, messageId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  const beforeLen = room.messages.length;
  room.messages = room.messages.filter((m) => m.id !== messageId);
  if (room.messages.length !== beforeLen) {
    scheduleSave();
    broadcastToRoom(roomId, { type: 'message:deleted', messageId });
  }
  res.json({ ok: true });
});

// Clear all encrypted messages in the space
app.delete('/api/rooms/:roomId/messages', (req, res) => {
  const { roomId } = req.params;
  const gateHash = req.header('x-gate-hash');
  const room = db.rooms[roomId];

  if (!room) {
    res.status(404).json({ error: 'Private space not found.' });
    return;
  }
  if (!gateHash || room.gateHash !== gateHash) {
    res.status(403).json({ error: 'Unauthorized space access.' });
    return;
  }

  room.messages = [];
  scheduleSave();
  broadcastToRoom(roomId, { type: 'room:cleared' });
  res.json({ ok: true });
});

async function startServer(): Promise<void> {
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 25 * 1024 * 1024,
  });

  wss.on('connection', (ws) => {
    let activeSub: SubscribedClient | null = null;

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          type?: string;
          requestId?: string;
          mode?: 'create' | 'join' | 'auto';
          roomId?: string;
          gateHash?: string;
          clientId?: string;
          isTyping?: boolean;
          message?: EncryptedMessageEnvelope;
          messageId?: string;
          messageIds?: string[];
        };

        if (data.type === 'room:join') {
          const { roomId, gateHash, mode, requestId } = data;
          if (
            !roomId ||
            !gateHash ||
            typeof roomId !== 'string' ||
            typeof gateHash !== 'string' ||
            !/^[a-f0-9]{64}$/.test(roomId) ||
            !/^[a-f0-9]{64}$/.test(gateHash)
          ) {
            ws.send(
              JSON.stringify({
                type: 'room:join:result',
                requestId,
                ok: false,
                status: 400,
                error: 'Invalid encrypted space identifier or passphrase hash.',
              })
            );
            return;
          }

          const existing = db.rooms[roomId];
          if (!existing) {
            if (mode === 'join') {
              ws.send(
                JSON.stringify({
                  type: 'room:join:result',
                  requestId,
                  ok: false,
                  status: 404,
                  error:
                    'No private space found with that unique name. Switch to Create Space to start it.',
                })
              );
              return;
            }
            const created: StoredRoom = {
              roomId,
              gateHash,
              createdAt: Date.now(),
              messages: [],
              pushSubscriptions: [],
            };
            db.rooms[roomId] = created;
            scheduleSave();
            ws.send(
              JSON.stringify({
                type: 'room:join:result',
                requestId,
                ok: true,
                isNew: true,
                messages: [],
              })
            );
            return;
          }

          if (existing.gateHash !== gateHash) {
            if (mode === 'create') {
              ws.send(
                JSON.stringify({
                  type: 'room:join:result',
                  requestId,
                  ok: false,
                  status: 409,
                  code: 'SPACE_NAME_TAKEN',
                  error:
                    'This unique space name is already registered with a different passphrase. Choose a new unique name or switch to Join Partner.',
                })
              );
              return;
            }
            ws.send(
              JSON.stringify({
                type: 'room:join:result',
                requestId,
                ok: false,
                status: 403,
                error: 'Incorrect secret passphrase for this unique space name.',
              })
            );
            return;
          }

          pruneRoomExpiredMessages(existing);
          ws.send(
            JSON.stringify({
              type: 'room:join:result',
              requestId,
              ok: true,
              isNew: false,
              messages: existing.messages,
            })
          );
          return;
        }

        if (data.type === 'room:subscribe') {
          const { roomId, gateHash, clientId } = data;
          if (!roomId || !gateHash || !clientId) return;
          const room = db.rooms[roomId];
          if (!room || room.gateHash !== gateHash) {
            ws.send(
              JSON.stringify({
                type: 'error',
                code: 'UNAUTHORIZED',
                message: 'Space verification failed.',
              })
            );
            return;
          }

          if (activeSub) {
            roomSubscribers.get(activeSub.roomId)?.delete(activeSub);
            broadcastPresence(activeSub.roomId);
          }

          activeSub = { ws, roomId, clientId };
          if (!roomSubscribers.has(roomId)) {
            roomSubscribers.set(roomId, new Set());
          }
          roomSubscribers.get(roomId)!.add(activeSub);

          pruneRoomExpiredMessages(room);

          // Automatically upgrade any 'sent' partner messages to 'delivered' on connect
          const newlyDeliveredIds: string[] = [];
          for (const msg of room.messages) {
            if (
              msg.senderClientId &&
              msg.senderClientId !== clientId &&
              (!msg.receiptStatus || msg.receiptStatus === 'sent')
            ) {
              msg.receiptStatus = 'delivered';
              newlyDeliveredIds.push(msg.id);
            }
          }
          if (newlyDeliveredIds.length > 0) {
            scheduleSave();
            broadcastToRoom(
              roomId,
              { type: 'receipt:updated', messageIds: newlyDeliveredIds, status: 'delivered' },
              clientId
            );
          }

          ws.send(
            JSON.stringify({
              type: 'room:synced',
              messages: room.messages,
            })
          );
          broadcastPresence(roomId);
          return;
        }

        if (!activeSub) return;
        const room = db.rooms[activeSub.roomId];
        if (!room) return;

        if (data.type === 'typing') {
          broadcastToRoom(
            activeSub.roomId,
            {
              type: 'partner:typing',
              clientId: activeSub.clientId,
              isTyping: Boolean(data.isTyping),
            },
            activeSub.clientId
          );
          return;
        }

        if (data.type === 'receipt:delivered' && Array.isArray(data.messageIds)) {
          const idSet = new Set(data.messageIds);
          const updatedIds: string[] = [];
          for (const msg of room.messages) {
            if (
              idSet.has(msg.id) &&
              msg.senderClientId !== activeSub.clientId &&
              (!msg.receiptStatus || msg.receiptStatus === 'sent')
            ) {
              msg.receiptStatus = 'delivered';
              updatedIds.push(msg.id);
            }
          }
          if (updatedIds.length > 0) {
            scheduleSave();
            broadcastToRoom(activeSub.roomId, {
              type: 'receipt:updated',
              messageIds: updatedIds,
              status: 'delivered',
            });
          }
          return;
        }

        if (data.type === 'receipt:read' && Array.isArray(data.messageIds)) {
          const idSet = new Set(data.messageIds);
          const updatedIds: string[] = [];
          for (const msg of room.messages) {
            if (
              idSet.has(msg.id) &&
              msg.senderClientId !== activeSub.clientId &&
              msg.receiptStatus !== 'read'
            ) {
              msg.receiptStatus = 'read';
              updatedIds.push(msg.id);
            }
          }
          if (updatedIds.length > 0) {
            scheduleSave();
            broadcastToRoom(activeSub.roomId, {
              type: 'receipt:updated',
              messageIds: updatedIds,
              status: 'read',
            });
          }
          return;
        }

        if (data.type === 'message:send' && data.message) {
          const msg = data.message;
          if (
            typeof msg.id !== 'string' ||
            typeof msg.iv !== 'string' ||
            typeof msg.ciphertext !== 'string' ||
            typeof msg.timestamp !== 'number'
          ) {
            return;
          }
          if (!room.messages.some((m) => m.id === msg.id)) {
            const hasOnlinePartner = Array.from(
              roomSubscribers.get(activeSub.roomId) || []
            ).some((s) => s.clientId !== activeSub!.clientId && s.ws.readyState === WebSocket.OPEN);

            const envelope: EncryptedMessageEnvelope = {
              id: msg.id,
              iv: msg.iv,
              ciphertext: msg.ciphertext,
              timestamp: msg.timestamp,
              expiresAt: typeof msg.expiresAt === 'number' ? msg.expiresAt : null,
              senderClientId: activeSub.clientId,
              receiptStatus: hasOnlinePartner ? 'delivered' : 'sent',
            };
            room.messages.push(envelope);
            if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
              room.messages = room.messages.slice(-MAX_MESSAGES_PER_ROOM);
            }
            scheduleSave();
            broadcastToRoom(activeSub.roomId, { type: 'message:created', message: envelope });
            sendHighPriorityPushToPartners(room, activeSub.clientId).catch(() => undefined);
          }
          return;
        }

        if (data.type === 'message:delete' && typeof data.messageId === 'string') {
          const before = room.messages.length;
          room.messages = room.messages.filter((m) => m.id !== data.messageId);
          if (room.messages.length !== before) {
            scheduleSave();
            broadcastToRoom(activeSub.roomId, {
              type: 'message:deleted',
              messageId: data.messageId,
            });
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    });

    ws.on('close', () => {
      if (activeSub) {
        const subs = roomSubscribers.get(activeSub.roomId);
        if (subs) {
          subs.delete(activeSub);
          if (subs.size === 0) {
            roomSubscribers.delete(activeSub.roomId);
          } else {
            broadcastToRoom(
              activeSub.roomId,
              { type: 'partner:typing', clientId: activeSub.clientId, isTyping: false },
              activeSub.clientId
            );
            broadcastPresence(activeSub.roomId);
          }
        }
        activeSub = null;
      }
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Internet Edge encrypted server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
