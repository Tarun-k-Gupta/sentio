// ─── UI Helpers ───────────────────────────────────────────

/**
 * Show a toast notification.
 */
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100px)';
    toast.style.transition = 'all 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Update chat status badge.
 */
export function setStatus(status, text) {
  const badge = document.getElementById('chat-status');
  const statusText = badge.querySelector('.status-text');
  badge.className = `status-badge status-${status}`;
  statusText.textContent = text;
}

/**
 * Update reputation display.
 */
export function setMyReputation(score) {
  document.getElementById('my-rep-score').textContent = score;
}

export function setPartnerReputation(score) {
  const el = document.getElementById('partner-rep');
  document.getElementById('partner-rep-score').textContent = score;
  el.style.display = 'flex';
}

export function hidePartnerReputation() {
  document.getElementById('partner-rep').style.display = 'none';
}

/**
 * Show/hide the video placeholder.
 */
export function showPlaceholder(text) {
  const placeholder = document.getElementById('remote-placeholder');
  const textEl = document.getElementById('placeholder-text');
  textEl.textContent = text;
  placeholder.classList.remove('hidden');
}

export function hidePlaceholder() {
  document.getElementById('remote-placeholder').classList.add('hidden');
}

/**
 * Show/hide search animation.
 */
export function showSearchAnimation(show) {
  const el = document.getElementById('search-animation');
  if (show) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

/**
 * Enable/disable action buttons.
 */
export function setActionsEnabled(enabled) {
  document.getElementById('btn-like').disabled = !enabled;
  document.getElementById('btn-report').disabled = !enabled;
}

/**
 * Update session timer display.
 */
export function updateTimer(seconds) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  document.getElementById('session-timer').textContent = `${mins}:${secs}`;
}

/**
 * Show/hide report modal.
 */
export function showReportModal(show) {
  document.getElementById('report-modal').style.display = show ? 'flex' : 'none';
}
