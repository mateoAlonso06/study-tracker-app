// Spotify integration (main process only): OAuth PKCE login through a loopback redirect,
// token storage/refresh and thin wrappers over the Web API player endpoints.
// Renderer never sees tokens.

const http = require('http');
const crypto = require('crypto');

// Overridable only so the integration can be tested against a local mock server.
const ACCOUNTS = process.env.SPOTIFY_ACCOUNTS_BASE || 'https://accounts.spotify.com';
const API = process.env.SPOTIFY_API_BASE || 'https://api.spotify.com/v1';

const REDIRECT_PORT = 43871;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');
const CONNECT_TIMEOUT_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const CLIENT_ID_KEY = 'spotify.clientId';

const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

class SpotifyError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function register({ ipcMain, db, shell, safeStorage, requireUser }) {
  let pendingLogin = null;

  // ---------- storage ----------

  const getSetting = (uid, key) => db.prepare('SELECT value FROM user_settings WHERE user_id = ? AND key = ?').get(uid, key)?.value ?? null;
  const setSetting = (uid, key, value) =>
    db.prepare(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
    ).run(uid, key, value);

  const canEncrypt = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };
  const seal = (text) => (canEncrypt() ? { value: safeStorage.encryptString(text).toString('base64'), encrypted: 1 } : { value: text, encrypted: 0 });
  const unseal = (value, encrypted) => (encrypted ? safeStorage.decryptString(Buffer.from(value, 'base64')) : value);

  function loadTokens(uid) {
    const row = db.prepare('SELECT access_token, refresh_token, expires_at, encrypted FROM spotify_tokens WHERE user_id = ?').get(uid);
    if (!row) return null;
    try {
      return {
        accessToken: unseal(row.access_token, row.encrypted),
        refreshToken: unseal(row.refresh_token, row.encrypted),
        expiresAt: row.expires_at,
        encrypted: !!row.encrypted,
      };
    } catch {
      clearTokens(uid); // undecryptable (e.g. keyring changed): force a fresh login
      return null;
    }
  }

  function saveTokens(uid, payload, previousRefresh) {
    const access = seal(payload.access_token);
    const refresh = seal(payload.refresh_token || previousRefresh);
    db.prepare(
      `INSERT INTO spotify_tokens (user_id, access_token, refresh_token, expires_at, encrypted) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
         expires_at = excluded.expires_at, encrypted = excluded.encrypted`
    ).run(uid, access.value, refresh.value, Date.now() + (Number(payload.expires_in) || 3600) * 1000, access.encrypted);
  }

  const clearTokens = (uid) => db.prepare('DELETE FROM spotify_tokens WHERE user_id = ?').run(uid);

  // ---------- http helpers ----------

  async function tokenRequest(params) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new SpotifyError(data.error_description || data.error || `Spotify respondió ${res.status}`, data.error || 'TOKEN');
    return data;
  }

  async function refreshAccessToken(uid, tokens) {
    const clientId = getSetting(uid, CLIENT_ID_KEY);
    try {
      const payload = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken, client_id: clientId });
      saveTokens(uid, payload, tokens.refreshToken);
    } catch (err) {
      if (err.code === 'invalid_grant') {
        clearTokens(uid);
        throw new SpotifyError('La sesión de Spotify venció. Volvé a conectar tu cuenta.', 'RECONNECT');
      }
      throw err;
    }
    return loadTokens(uid);
  }

  async function accessToken(uid) {
    let tokens = loadTokens(uid);
    if (!tokens) throw new SpotifyError('Spotify no está conectado.', 'NOT_CONNECTED');
    if (tokens.expiresAt - 60000 < Date.now()) tokens = await refreshAccessToken(uid, tokens);
    return tokens.accessToken;
  }

  function describeError(status, body, headers) {
    const reason = body?.error?.reason;
    const message = body?.error?.message || '';
    if (status === 404 && (reason === 'NO_ACTIVE_DEVICE' || /no active device/i.test(message))) {
      return new SpotifyError('No hay ningún dispositivo de Spotify activo. Abrí Spotify en tu PC o celular.', 'NO_DEVICE');
    }
    if (status === 403 && reason === 'PREMIUM_REQUIRED') return new SpotifyError('Esta acción requiere Spotify Premium.', 'PREMIUM');
    if (status === 403) {
      return new SpotifyError('Spotify rechazó la acción. Revisá que tu usuario esté habilitado en la app de Spotify for Developers.', 'FORBIDDEN');
    }
    if (status === 429) {
      const wait = Number(headers.get('retry-after')) || 5;
      const err = new SpotifyError(`Spotify está limitando las solicitudes. Reintentá en ${wait} s.`, 'RATE_LIMIT');
      err.retryAfter = wait;
      return err;
    }
    return new SpotifyError(message || `Spotify respondió ${status}`, 'HTTP');
  }

  // Calls the Web API. Returns the parsed JSON body, or null for 204.
  async function api(uid, method, path, { query, body } = {}, retried = false) {
    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken(uid)}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof SpotifyError) throw err;
      throw new SpotifyError('No se pudo conectar con Spotify. Revisá tu conexión.', 'NETWORK');
    }
    if (res.status === 401 && !retried) {
      const tokens = loadTokens(uid);
      if (tokens) await refreshAccessToken(uid, tokens);
      return api(uid, method, path, { query, body }, true);
    }
    if (res.status === 204 || res.status === 202) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) throw describeError(res.status, data, res.headers);
    return data;
  }

  // Runs a player command; if no device is active, wakes the first available one and retries once.
  async function withDevice(uid, run) {
    try {
      return await run();
    } catch (err) {
      if (err.code !== 'NO_DEVICE') throw err;
      const devices = (await api(uid, 'GET', '/me/player/devices'))?.devices || [];
      if (!devices.length) throw err;
      await api(uid, 'PUT', '/me/player', { body: { device_ids: [devices[0].id], play: false } });
      await new Promise((resolve) => setTimeout(resolve, 600));
      return run();
    }
  }

  // ---------- login (PKCE + loopback redirect) ----------

  // Starts a one-shot HTTP server on the loopback address that receives Spotify's redirect.
  function startCallbackServer(state) {
    let settle;
    const result = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    const timer = setTimeout(() => settle.reject(new SpotifyError('Se agotó el tiempo para conectar Spotify. Intentá de nuevo.', 'TIMEOUT')), CONNECT_TIMEOUT_MS);

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const denied = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      const valid = !denied && code && url.searchParams.get('state') === state;
      res.writeHead(valid ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        valid
          ? '<h2>Spotify conectado</h2><p>Ya podés cerrar esta pestaña y volver a la app.</p>'
          : '<h2>No se pudo conectar Spotify</h2><p>Cerrá esta pestaña y volvé a intentarlo desde la app.</p>'
      );
      if (denied) settle.reject(new SpotifyError('Cancelaste la conexión con Spotify.', 'DENIED'));
      else if (!valid) settle.reject(new SpotifyError('La respuesta de Spotify no es válida. Intentá de nuevo.', 'STATE'));
      else settle.resolve(code);
    });

    const ready = new Promise((resolve, reject) => {
      server.once('error', (err) => {
        clearTimeout(timer);
        reject(
          err.code === 'EADDRINUSE'
            ? new SpotifyError(`El puerto ${REDIRECT_PORT} está ocupado. Cerrá lo que lo usa e intentá de nuevo.`, 'PORT')
            : err
        );
      });
      server.listen(REDIRECT_PORT, '127.0.0.1', resolve);
    });

    return {
      ready,
      result,
      cancel: () => settle.reject(new SpotifyError('Conexión cancelada.', 'CANCELLED')),
      close: () => {
        clearTimeout(timer);
        server.close();
      },
    };
  }

  async function connect(uid) {
    const clientId = getSetting(uid, CLIENT_ID_KEY);
    if (!clientId) throw new SpotifyError('Primero guardá tu Client ID de Spotify.', 'NO_CLIENT');
    if (pendingLogin) pendingLogin.cancel();

    const verifier = base64url(crypto.randomBytes(64));
    const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
    const state = base64url(crypto.randomBytes(16));
    const authUrl = new URL(`${ACCOUNTS}/authorize`);
    authUrl.search = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: challenge,
    }).toString();

    const login = startCallbackServer(state);
    pendingLogin = login;
    try {
      await login.ready; // listen first, so the redirect can never arrive before the server is up
      console.log('[spotify] authorize url:', authUrl.toString());
      if (!process.env.SPOTIFY_NO_BROWSER) shell.openExternal(authUrl.toString());
      const code = await login.result;
      const payload = await tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: verifier,
      });
      saveTokens(uid, payload);
    } finally {
      login.close();
      if (pendingLogin === login) pendingLogin = null;
    }
  }

  // ---------- normalizers ----------

  function pickImage(images) {
    return images?.[1]?.url || images?.[0]?.url || '';
  }

  function normalizePlayback(data) {
    if (!data || !data.device) return { active: false };
    const item = data.item;
    return {
      active: true,
      isPlaying: !!data.is_playing,
      progressMs: data.progress_ms || 0,
      durationMs: item?.duration_ms || 0,
      title: item?.name || '',
      artists: (item?.artists || []).map((a) => a.name).join(', ') || item?.show?.name || '',
      image: pickImage(item?.album?.images || item?.images || item?.show?.images),
      deviceName: data.device.name,
      deviceId: data.device.id,
      volume: data.device.volume_percent ?? null,
      shuffle: !!data.shuffle_state,
      repeat: data.repeat_state || 'off',
      kind: data.currently_playing_type || 'track',
    };
  }

  const clamp = (n, min, max) => Math.min(max, Math.max(min, Math.round(Number(n) || 0)));

  const controls = {
    play: (uid) => api(uid, 'PUT', '/me/player/play'),
    pause: (uid) => api(uid, 'PUT', '/me/player/pause'),
    next: (uid) => api(uid, 'POST', '/me/player/next'),
    previous: (uid) => api(uid, 'POST', '/me/player/previous'),
    seek: (uid, v) => api(uid, 'PUT', '/me/player/seek', { query: { position_ms: clamp(v, 0, 86400000) } }),
    volume: (uid, v) => api(uid, 'PUT', '/me/player/volume', { query: { volume_percent: clamp(v, 0, 100) } }),
    shuffle: (uid, v) => api(uid, 'PUT', '/me/player/shuffle', { query: { state: !!v } }),
    repeat: (uid, v) => api(uid, 'PUT', '/me/player/repeat', { query: { state: ['off', 'track', 'context'].includes(v) ? v : 'off' } }),
  };

  // ---------- ipc ----------

  ipcMain.handle('spotify:status', () => {
    const uid = requireUser();
    const tokens = loadTokens(uid);
    return {
      configured: !!getSetting(uid, CLIENT_ID_KEY),
      clientId: getSetting(uid, CLIENT_ID_KEY) || '',
      connected: !!tokens,
      encrypted: tokens ? tokens.encrypted : canEncrypt(),
      redirectUri: REDIRECT_URI,
    };
  });

  ipcMain.handle('spotify:save-client-id', (_e, clientId) => {
    const uid = requireUser();
    const id = String(clientId || '').trim();
    if (!/^[A-Za-z0-9]{16,64}$/.test(id)) throw new Error('El Client ID no parece válido (son letras y números, unos 32 caracteres).');
    if (getSetting(uid, CLIENT_ID_KEY) !== id) clearTokens(uid); // tokens belong to the previous app
    setSetting(uid, CLIENT_ID_KEY, id);
  });

  ipcMain.handle('spotify:connect', (_e) => connect(requireUser()));

  ipcMain.handle('spotify:disconnect', () => {
    clearTokens(requireUser());
  });

  ipcMain.handle('spotify:state', async () => {
    const uid = requireUser();
    try {
      return normalizePlayback(await api(uid, 'GET', '/me/player'));
    } catch (err) {
      return { active: false, error: err.message, code: err.code, retryAfter: err.retryAfter };
    }
  });

  ipcMain.handle('spotify:control', async (_e, { action, value }) => {
    const uid = requireUser();
    const fn = controls[action];
    if (!fn) throw new Error('Acción de Spotify desconocida');
    await withDevice(uid, () => fn(uid, value));
  });

  ipcMain.handle('spotify:devices', async () => {
    const data = await api(requireUser(), 'GET', '/me/player/devices');
    return (data?.devices || []).map((d) => ({ id: d.id, name: d.name, type: d.type, active: !!d.is_active }));
  });

  ipcMain.handle('spotify:transfer', async (_e, deviceId) => {
    await api(requireUser(), 'PUT', '/me/player', { body: { device_ids: [String(deviceId)], play: true } });
  });

  ipcMain.handle('spotify:playlists', async () => {
    const data = await api(requireUser(), 'GET', '/me/playlists', { query: { limit: 50 } });
    return (data?.items || []).filter(Boolean).map((p) => ({ id: p.id, name: p.name, uri: p.uri, image: pickImage(p.images) }));
  });

  ipcMain.handle('spotify:play-context', async (_e, uri) => {
    const uid = requireUser();
    if (!/^spotify:(playlist|album|artist):[A-Za-z0-9]+$/.test(String(uri))) throw new Error('Contexto de Spotify no válido');
    await withDevice(uid, () => api(uid, 'PUT', '/me/player/play', { body: { context_uri: uri } }));
  });
}

module.exports = { register, REDIRECT_URI };
