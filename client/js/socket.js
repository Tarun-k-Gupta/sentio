// ─── Socket.IO Client Wrapper ─────────────────────────────
import { io } from 'socket.io-client';

let socket = null;
const eventHandlers = new Map();

/**
 * Connect to the Socket.IO server.
 */
export function connect() {
  if (socket?.connected) return socket;

  socket = io(window.location.origin, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5
  });

  socket.on('connect', () => {
    console.log('🔌 Socket connected:', socket.id);
    trigger('connected');
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Socket disconnected:', reason);
    trigger('disconnected', reason);
  });

  // Forward server events
  const events = [
    'authenticated', 'auth-error',
    'queue-joined', 'matched',
    'offer', 'answer', 'ice-candidate',
    'stranger-disconnected',
    'liked', 'reputation-update',
    'action-success', 'action-error'
  ];

  events.forEach(event => {
    socket.on(event, (data) => trigger(event, data));
  });

  return socket;
}

/**
 * Register an event handler.
 */
export function on(event, handler) {
  if (!eventHandlers.has(event)) eventHandlers.set(event, []);
  eventHandlers.get(event).push(handler);
}

/**
 * Trigger event handlers.
 */
function trigger(event, data) {
  const handlers = eventHandlers.get(event) || [];
  handlers.forEach(h => h(data));
}

/**
 * Emit events to server.
 */
export function authenticate(token) {
  socket?.emit('authenticate', { token });
}

export function joinQueue(preferences = {}) {
  socket?.emit('join-queue', preferences);
}

export function sendOffer(offer) {
  socket?.emit('offer', { offer });
}

export function sendAnswer(answer) {
  socket?.emit('answer', { answer });
}

export function sendIceCandidate(candidate) {
  socket?.emit('ice-candidate', { candidate });
}

export function next(preferences = {}) {
  socket?.emit('next', preferences);
}

export function like() {
  socket?.emit('like');
}

export function report(reason) {
  socket?.emit('report', { reason });
}

export function disconnect() {
  socket?.disconnect();
}
