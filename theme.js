/* Χρωματικά θέματα: [κύριο χρώμα, δεύτερο χρώμα] για φωτεινό και σκοτεινό. */
(function () {
  'use strict';
  const THEMES = [
    { id: 'lavender', name: 'Λεβάντα',      light: ['#7b6ae8', '#f29bbd'], dark: ['#a497ff', '#f7a8c6'] },
    { id: 'rose',     name: 'Τριαντάφυλλο', light: ['#d4587f', '#f6b0a0'], dark: ['#ff8fb0', '#ffc2b0'] },
    { id: 'peach',    name: 'Ροδάκινο',     light: ['#e07a4f', '#f5c26b'], dark: ['#ffa47a', '#ffd08f'] },
    { id: 'mint',     name: 'Μέντα',        light: ['#2e9c78', '#8fd6c0'], dark: ['#6fd6b0', '#a8e6d2'] },
    { id: 'sky',      name: 'Ουρανός',      light: ['#3f7fd9', '#86d3ef'], dark: ['#8bb8ff', '#9be0f7'] },
    { id: 'sea',      name: 'Θάλασσα',      light: ['#2b97ad', '#a3b8ff'], dark: ['#6fd3e3', '#b8c6ff'] },
    { id: 'sage',     name: 'Φασκόμηλο',    light: ['#5f8a4e', '#c8d98a'], dark: ['#a3cf8b', '#d9e8a6'] },
    { id: 'sunset',   name: 'Ηλιοβασίλεμα', light: ['#9a5de0', '#ff9f6e'], dark: ['#c39bff', '#ffb48f'] },
    { id: 'sand',     name: 'Άμμος',        light: ['#a07a50', '#e8c99a'], dark: ['#d8b48a', '#efd7b2'] },
    { id: 'grill',    name: 'Κάρβουνο',     light: ['#d9480f', '#f59f00'], dark: ['#ff8a4c', '#ffc04d'] }
  ];
  const KEY = 'kratiseis-theme';
  const STYLE_KEY = 'kratiseis-style';
  // Στυλ εμφάνισης (ανά χρήστη): classic = το παστέλ με τα χρωματικά θέματα
  const STYLES = [
    { id: 'classic', name: 'Κλασικό', desc: 'Παστέλ, με επιλογή χρώματος', sw: ['#f6f4fb', '#7b6ae8', '#f29bbd'] },
    { id: 'taverna', name: 'Ψητοπωλείο', desc: 'Τα χρώματα του λογότυπου', sw: ['#f6f2ea', '#2a2626', '#b5502a'] },
    { id: 'service', name: 'Σκοτεινό σέρβις', desc: 'Σκούρο, για το βράδυ', sw: ['#0f1013', '#181a1f', '#ff7a45'] },
    { id: 'clean', name: 'Καθαρό', desc: 'Λευκό, minimal', sw: ['#f4f4f6', '#ffffff', '#111114'] }
  ];
  function getStyle() { try { const v = localStorage.getItem(STYLE_KEY); return STYLES.some(x => x.id === v) ? v : 'classic'; } catch (e) { return 'classic'; } }
  let shop = { theme: 'lavender', mode: 'auto' };
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function loadLocal() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function saveLocal(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }

  function resolved() {
    const l = loadLocal();
    return { theme: l.theme || shop.theme || 'lavender', mode: l.mode || shop.mode || 'auto', local: !!(l.theme || l.mode) };
  }
  function isDark(mode) { return mode === 'dark' || (mode === 'auto' && !!(mq && mq.matches)); }

  function apply() {
    const r = resolved();
    const th = THEMES.find(t => t.id === r.theme) || THEMES[0];
    const root = document.documentElement;
    const style = getStyle();
    root.setAttribute('data-style', style);
    const mode = style === 'service' ? 'dark' : r.mode;     // το «Σκοτεινό σέρβις» είναι πάντα σκούρο
    if (mode === 'auto') root.removeAttribute('data-mode'); else root.setAttribute('data-mode', mode);
    if (style === 'classic') {
      const v = isDark(mode) ? th.dark : th.light;
      root.style.setProperty('--accent', v[0]);
      root.style.setProperty('--accent-2', v[1]);
    } else {                                                // τα άλλα στυλ έχουν δικά τους χρώματα (styles.css)
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-2');
    }
    root.setAttribute('data-theme', th.id);
    const m = document.querySelector('meta[name=theme-color]');
    if (m) requestAnimationFrame(() => { m.content = getComputedStyle(root).getPropertyValue('--bg').trim() || m.content; });
  }
  if (mq) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));

  window.Theme = {
    THEMES, STYLES, apply, resolved, isDark, getStyle,
    setStyle(id) { try { localStorage.setItem(STYLE_KEY, id); } catch (e) {} apply(); },
    setShopDefault(theme, mode) { shop = { theme: theme || 'lavender', mode: mode || 'auto' }; apply(); },
    setLocal(patch) { saveLocal(Object.assign(loadLocal(), patch)); apply(); },
    clearLocal() { try { localStorage.removeItem(KEY); } catch (e) {} apply(); }
  };
  apply();
})();
