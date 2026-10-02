// Spotify UI: mini player in the sidebar, full player panel and the connection settings.
// All Spotify calls go through the main process; this file never sees tokens.
// Relies on globals from app.js / live.js (esc, render, openModal, buttons, cleanError, fmtClock) at call time.

const POLL_MS = 5000;
const POLL_ERROR_MS = 15000;

const sp = {
  status: null, // { configured, clientId, connected, encrypted, redirectUri }
  player: null, // normalized playback state from main
  devices: [],
  playlists: [],
  notice: '',
  noticeFrom: '', // 'poll' notices clear themselves on the next good poll; 'cmd' notices stay a few seconds
  noticeTimer: null,
  generation: 0, // bumped on init/reset so a late response from a previous session is ignored
  pollTimer: null,
  tickTimer: null,
  fetchedAt: 0,
  dragging: false,
  signature: '',
  panelSignature: '',
};

const SP_ICON = {
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
  next: '<path d="M6 6l9 6-9 6zM17 6h2v12h-2z"/>',
  prev: '<path d="M18 6l-9 6 9 6zM5 6h2v12H5z"/>',
  shuffle: '<path d="M3 7h3c4 0 5 10 9 10h4M3 17h3c1.5 0 2.5-1.2 3.4-2.8M15 7h4M19 7l-2-2M19 7l-2 2M19 17l-2-2M19 17l-2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  repeat: '<path d="M4 11V9a3 3 0 0 1 3-3h11M18 6l-2-2M18 6l-2 2M20 13v2a3 3 0 0 1-3 3H6M6 18l2-2M6 18l2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  note: '<path d="M9 18V6l10-2v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="16" r="2" fill="none" stroke="currentColor" stroke-width="1.8"/>',
};
const spIcon = (name, size = 18) => `<svg class="sp-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${SP_ICON[name]}</svg>`;

function setNotice(text, from) {
  clearTimeout(sp.noticeTimer);
  sp.notice = text || '';
  sp.noticeFrom = text ? from : '';
  if (text && from === 'cmd') {
    sp.noticeTimer = setTimeout(() => {
      sp.notice = '';
      sp.noticeFrom = '';
      updateSpotifyUi();
    }, 8000);
  }
}

// ---------- lifecycle ----------

async function spotifyInit() {
  const generation = ++sp.generation;
  try {
    sp.status = await window.api.spotifyStatus();
  } catch (err) {
    console.error('Could not read Spotify status', err);
    sp.status = null;
  }
  if (generation !== sp.generation) return;
  stopSpotifyTimers();
  if (sp.status?.connected) {
    pollSpotify();
    sp.tickTimer = setInterval(tickSpotifyUi, 1000);
  }
  updateSpotifyUi(true);
}

function stopSpotifyTimers() {
  clearTimeout(sp.pollTimer);
  clearInterval(sp.tickTimer);
  sp.pollTimer = null;
  sp.tickTimer = null;
}

function spotifyReset() {
  sp.generation += 1;
  stopSpotifyTimers();
  sp.status = null;
  sp.player = null;
  sp.devices = [];
  sp.playlists = [];
  setNotice('');
}

async function pollSpotify() {
  if (!sp.status?.connected) return;
  const generation = sp.generation;
  let delay = POLL_MS;
  if (!document.hidden) {
    const player = await window.api.spotifyState().catch((err) => ({ active: false, error: cleanError(err) }));
    if (generation !== sp.generation) return; // signed out or re-initialised while waiting
    sp.fetchedAt = Date.now();
    if (player.code === 'RECONNECT' || player.code === 'NOT_CONNECTED') {
      sp.status.connected = false;
      setNotice(player.error, 'poll');
      stopSpotifyTimers();
      sp.player = null;
      updateSpotifyUi(true);
      return;
    }
    sp.player = player;
    if (player.error) setNotice(player.error, 'poll');
    else if (sp.noticeFrom === 'poll') setNotice('');
    if (player.error) delay = Math.max(POLL_ERROR_MS, (player.retryAfter || 0) * 1000);
    updateSpotifyUi();
  }
  sp.pollTimer = setTimeout(pollSpotify, delay);
}

function refreshSpotifySoon() {
  clearTimeout(sp.pollTimer);
  sp.pollTimer = setTimeout(pollSpotify, 600);
}

// ---------- commands ----------

async function spotifyCmd(action, value) {
  const p = sp.player;
  // Optimistic update so the UI reacts immediately; the next poll confirms the real state.
  if (p?.active) {
    if (action === 'play') p.isPlaying = true;
    if (action === 'pause') p.isPlaying = false;
    if (action === 'shuffle') p.shuffle = !!value;
    if (action === 'repeat') p.repeat = value;
    if (action === 'volume') p.volume = value;
    if (action === 'seek') {
      p.progressMs = value;
      sp.fetchedAt = Date.now();
    }
  }
  updateSpotifyUi();
  try {
    await window.api.spotifyControl({ action, value });
    setNotice('');
  } catch (err) {
    setNotice(cleanError(err), 'cmd');
  }
  updateSpotifyUi();
  refreshSpotifySoon();
}

// ---------- rendering ----------

function currentProgress() {
  const p = sp.player;
  if (!p?.active) return 0;
  const elapsed = p.isPlaying ? Date.now() - sp.fetchedAt : 0;
  return Math.min(p.durationMs || Infinity, p.progressMs + elapsed);
}

const spCover = (url, cls = '') =>
  url ? `<img class="sp-cover ${cls}" src="${esc(url)}" alt="" />` : `<div class="sp-cover blank ${cls}">${spIcon('note', 20)}</div>`;

// A cover that fails to load (offline, blocked) falls back to the placeholder instead of a broken-image icon.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img.tagName !== 'IMG' || !img.classList.contains('sp-cover')) return;
    const holder = document.createElement('div');
    holder.className = `${img.className} blank`;
    holder.innerHTML = spIcon('note', 20);
    img.replaceWith(holder);
  },
  true
);

function spotifyMiniHtml() {
  if (!sp.status?.connected) return '';
  const p = sp.player;
  const hasTrack = p?.active && p.title;
  return `<div class="spotify-mini">
    <div class="sp-row" data-action="open-spotify" title="Abrir reproductor">
      ${spCover(hasTrack ? p.image : '')}
      <div class="sp-text">
        <strong>${esc(hasTrack ? p.title : 'Spotify')}</strong>
        <span class="small muted">${esc(hasTrack ? p.artists : 'Nada sonando')}</span>
      </div>
    </div>
    <div class="sp-bar"><div id="sp-mini-progress"></div></div>
    <div class="sp-controls">
      <button class="ghost" data-action="spotify-prev" aria-label="Anterior">${spIcon('prev')}</button>
      <button class="ghost sp-play" data-action="spotify-toggle" aria-label="${p?.isPlaying ? 'Pausar' : 'Reproducir'}">${spIcon(p?.isPlaying ? 'pause' : 'play', 20)}</button>
      <button class="ghost" data-action="spotify-next" aria-label="Siguiente">${spIcon('next')}</button>
    </div>
    ${sp.notice ? `<div class="small sp-error">${esc(sp.notice)}</div>` : ''}
  </div>`;
}

// Refreshes the sidebar player (and the panel if open) only when something visible changed.
function updateSpotifyUi(force = false) {
  const p = sp.player;
  const signature = JSON.stringify([sp.status?.connected, p?.active, p?.title, p?.artists, p?.image, p?.isPlaying, sp.notice]);
  const mini = document.getElementById('spotify-mini');
  if (mini && (force || signature !== sp.signature)) mini.innerHTML = spotifyMiniHtml();
  sp.signature = signature;

  const panel = document.getElementById('spotify-panel');
  if (panel) {
    const panelSig = JSON.stringify([signature, p?.shuffle, p?.repeat, p?.deviceId, p?.volume === null, sp.devices.length, sp.playlists.length]);
    if (force || panelSig !== sp.panelSignature) {
      sp.panelSignature = panelSig;
      renderSpotifyPanel();
    }
  }
  const label = document.getElementById('spotify-menu-status');
  if (label) label.textContent = sp.status?.connected ? 'Conectado' : 'Conectar cuenta';
  tickSpotifyUi();
}

// Cheap once-a-second update: progress bars and timestamps only.
function tickSpotifyUi() {
  const p = sp.player;
  if (!p?.active || !p.durationMs) {
    const bar = document.getElementById('sp-mini-progress');
    if (bar) bar.style.width = '0%';
    return;
  }
  const progress = currentProgress();
  const bar = document.getElementById('sp-mini-progress');
  if (bar) bar.style.width = `${Math.min(100, (progress / p.durationMs) * 100)}%`;
  const pos = document.getElementById('sp-pos');
  if (pos && !sp.dragging) pos.textContent = fmtClock(progress);
  const seek = document.getElementById('sp-seek');
  if (seek && !sp.dragging) seek.value = Math.round(progress);
}

function renderSpotifyPanel() {
  const panel = document.getElementById('spotify-panel');
  if (!panel) return;
  const p = sp.player;
  const playing = p?.active && p.title;
  const deviceOptions = sp.devices.length
    ? sp.devices.map((d) => `<option value="${esc(d.id)}" ${d.id === p?.deviceId || (!p?.deviceId && d.active) ? 'selected' : ''}>${esc(d.name)} (${esc(d.type)})</option>`).join('')
    : '<option value="">Sin dispositivos disponibles</option>';
  const playlists = sp.playlists.length
    ? sp.playlists
        .map(
          (pl, i) => `<div class="sp-playlist">
            ${spCover(pl.image, 'small')}
            <span class="sp-pl-name">${esc(pl.name)}</span>
            <button data-action="spotify-play-playlist" data-id="${i}">Reproducir</button>
          </div>`
        )
        .join('')
    : '<p class="muted small">No se encontraron playlists.</p>';

  panel.innerHTML = `
    <h2>Spotify</h2>
    <div class="sp-head">
      ${spCover(playing ? p.image : '', 'large')}
      <div class="sp-info">
        <div class="sp-title">${esc(playing ? p.title : 'Nada sonando')}</div>
        <div class="muted">${esc(playing ? p.artists : 'Elegí una playlist o abrí Spotify en un dispositivo.')}</div>
        ${p?.active ? `<div class="small muted">En ${esc(p.deviceName)}</div>` : ''}
      </div>
    </div>
    <div class="sp-seek">
      <span class="small muted" id="sp-pos">0:00</span>
      <input type="range" id="sp-seek" data-sp="seek" min="0" max="${p?.durationMs || 0}" value="${Math.round(currentProgress())}" ${playing ? '' : 'disabled'} />
      <span class="small muted">${fmtClock(p?.durationMs || 0)}</span>
    </div>
    <div class="sp-main">
      <button class="ghost ${p?.shuffle ? 'on' : ''}" data-action="spotify-shuffle" aria-label="Aleatorio">${spIcon('shuffle', 20)}</button>
      <button class="ghost" data-action="spotify-prev" aria-label="Anterior">${spIcon('prev', 22)}</button>
      <button class="primary sp-big" data-action="spotify-toggle" aria-label="${p?.isPlaying ? 'Pausar' : 'Reproducir'}">${spIcon(p?.isPlaying ? 'pause' : 'play', 24)}</button>
      <button class="ghost" data-action="spotify-next" aria-label="Siguiente">${spIcon('next', 22)}</button>
      <button class="ghost ${p?.repeat && p.repeat !== 'off' ? 'on' : ''}" data-action="spotify-repeat" aria-label="Repetir" title="Repetir: ${esc(p?.repeat || 'off')}">${spIcon('repeat', 20)}</button>
    </div>
    <div class="sp-volume">
      <label for="sp-volume">Volumen</label>
      <input type="range" id="sp-volume" data-sp="volume" min="0" max="100" value="${p?.volume ?? 0}" ${p?.volume === null || !p?.active ? 'disabled' : ''} />
    </div>
    <div class="field"><label>Dispositivo</label><select data-sp="device">${deviceOptions}</select></div>
    ${sp.notice ? `<div class="error">${esc(sp.notice)}</div>` : ''}
    <h3 class="sp-section">Tus playlists</h3>
    <div class="sp-playlists">${playlists}</div>
    <div class="buttons"><button type="button" data-action="close-modal">Cerrar</button></div>`;
  tickSpotifyUi();
}

async function openSpotifyPanel() {
  modalRoot.innerHTML = '<div class="overlay"><div class="modal wide spotify-panel" id="spotify-panel"></div></div>';
  sp.panelSignature = '';
  updateSpotifyUi(true);
  const [devices, playlists] = await Promise.allSettled([window.api.spotifyDevices(), window.api.spotifyPlaylists()]);
  if (devices.status === 'fulfilled') sp.devices = devices.value;
  if (playlists.status === 'fulfilled') sp.playlists = playlists.value;
  else if (!sp.notice) setNotice(cleanError(playlists.reason), 'cmd');
  updateSpotifyUi(true);
}

// ---------- settings / connection ----------

function spotifySettingsModal() {
  const s = sp.status || { configured: false, clientId: '', connected: false, encrypted: true, redirectUri: 'http://127.0.0.1:43871/callback' };
  const left = s.connected ? '<button type="button" class="ghost danger left" data-action="spotify-disconnect">Desconectar</button>' : '';
  openModal(
    `<h2>Spotify</h2>
     <p class="${s.connected ? '' : 'muted'}">${s.connected ? 'Cuenta conectada. Podés controlar la reproducción desde la barra lateral.' : 'Conectá tu cuenta para controlar Spotify desde la app. Necesitás Spotify Premium.'}</p>
     <ol class="sp-steps small">
       <li>Entrá a <a href="https://developer.spotify.com/dashboard">developer.spotify.com/dashboard</a> y creá una app (marcá "Web API").</li>
       <li>En <strong>Redirect URIs</strong> agregá exactamente esta dirección:
         <div class="sp-uri"><input type="text" readonly value="${esc(s.redirectUri)}" /><button type="button" data-action="spotify-copy-uri">Copiar</button></div>
       </li>
       <li>Copiá el <strong>Client ID</strong> de la app y pegalo acá.</li>
     </ol>
     <div class="field"><label>Client ID</label><input name="clientId" value="${esc(s.clientId)}" placeholder="32 caracteres" autocomplete="off" /></div>
     ${s.encrypted ? '' : '<p class="small muted">Este equipo no tiene un almacén de claves del sistema: el token se guardará sin cifrar en tu carpeta de usuario.</p>'}
     <p class="small muted" id="sp-wait"></p>
     <div class="buttons">
       ${left}
       <button type="button" data-action="close-modal">Cerrar</button>
       <button type="submit" class="primary">${s.connected ? 'Reconectar' : 'Guardar y conectar'}</button>
     </div>`,
    async ({ clientId }) => {
      await window.api.spotifySaveClientId(clientId);
      document.getElementById('sp-wait').textContent = 'Abrimos Spotify en tu navegador. Autorizá la app y volvé acá…';
      await window.api.spotifyConnect();
      await spotifyInit();
    }
  );
}

// ---------- actions and inputs ----------

const spotifyActions = {
  'spotify-settings': () => spotifySettingsModal(),
  'open-spotify': () => openSpotifyPanel(),
  'spotify-toggle': () => spotifyCmd(sp.player?.isPlaying ? 'pause' : 'play'),
  'spotify-next': () => spotifyCmd('next'),
  'spotify-prev': () => spotifyCmd('previous'),
  'spotify-shuffle': () => spotifyCmd('shuffle', !sp.player?.shuffle),
  'spotify-repeat': () => {
    const order = ['off', 'context', 'track'];
    spotifyCmd('repeat', order[(order.indexOf(sp.player?.repeat || 'off') + 1) % order.length]);
  },
  'spotify-play-playlist': async (index) => {
    const playlist = sp.playlists[index];
    if (!playlist) return;
    try {
      await window.api.spotifyPlayContext(playlist.uri);
      setNotice('');
    } catch (err) {
      setNotice(cleanError(err), 'cmd');
    }
    updateSpotifyUi(true);
    refreshSpotifySoon();
  },
  'spotify-copy-uri': async (_id, el) => {
    const input = el.parentElement.querySelector('input');
    try {
      await navigator.clipboard.writeText(input.value);
      el.textContent = 'Copiado';
    } catch {
      input.select(); // clipboard blocked: let the user copy manually
    }
  },
  'spotify-disconnect': async () => {
    if (!confirm('¿Desconectar Spotify? Vas a tener que autorizar la app de nuevo para volver a usarlo.')) return;
    await window.api.spotifyDisconnect();
    spotifyReset();
    await spotifyInit();
    closeModal();
  },
};

document.addEventListener('pointerdown', (e) => {
  if (e.target.dataset?.sp === 'seek') sp.dragging = true;
});
document.addEventListener('pointerup', () => {
  sp.dragging = false;
});

document.addEventListener('input', (e) => {
  if (e.target.dataset?.sp === 'seek') {
    const pos = document.getElementById('sp-pos');
    if (pos) pos.textContent = fmtClock(Number(e.target.value));
  }
});

document.addEventListener('change', async (e) => {
  const kind = e.target.dataset?.sp;
  if (!kind) return;
  sp.dragging = false;
  if (kind === 'seek') spotifyCmd('seek', Number(e.target.value));
  else if (kind === 'volume') spotifyCmd('volume', Number(e.target.value));
  else if (kind === 'device' && e.target.value) {
    try {
      await window.api.spotifyTransfer(e.target.value);
      setNotice('');
    } catch (err) {
      setNotice(cleanError(err), 'cmd');
    }
    updateSpotifyUi(true);
    refreshSpotifySoon();
  }
});
