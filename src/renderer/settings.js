// User preferences stored locally in the renderer. Loaded in <head> so the theme applies before first paint.

const THEME_KEY = 'theme';
const THEME_CHOICES = ['light', 'dark', 'system'];
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function getThemePref() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEME_CHOICES.includes(saved) ? saved : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(pref = getThemePref()) {
  const resolved = pref === 'system' ? (systemDark.matches ? 'dark' : 'light') : pref;
  document.documentElement.dataset.theme = resolved;
}

function setThemePref(pref) {
  if (!THEME_CHOICES.includes(pref)) return;
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* storage unavailable: the choice lasts until the app closes */
  }
  applyTheme(pref);
}

// "Keep me signed in" token (random string; the database stores only its hash).
const REMEMBER_KEY = 'rememberToken';

function getRememberToken() {
  try {
    return localStorage.getItem(REMEMBER_KEY);
  } catch {
    return null;
  }
}

function setRememberToken(token) {
  try {
    localStorage.setItem(REMEMBER_KEY, token);
  } catch {
    /* storage unavailable: the session will not be kept */
  }
}

function clearRememberToken() {
  try {
    localStorage.removeItem(REMEMBER_KEY);
  } catch {
    /* nothing to clear */
  }
}

systemDark.addEventListener('change', () => {
  if (getThemePref() === 'system') applyTheme();
});

applyTheme();
