/* Καθαρή λογική κρατήσεων (χωρίς DOM) — χρησιμοποιείται από την εφαρμογή και από τα τεστ. */
(function (root) {
  'use strict';

  const ACTIVE = ['confirmed', 'seated'];         // καταλαμβάνουν θέση
  const DAY_NAMES = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
  const MONTHS = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μαΐ', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];
  // Ώρες πριν από τις 05:00 θεωρούνται "μετά τα μεσάνυχτα" της ίδιας βάρδιας.
  const DAY_ROLL = 5 * 60;

  function toMin(t) {
    if (t == null || t === '') return null;
    const [h, m] = String(t).split(':').map(Number);
    return h * 60 + (m || 0);
  }
  // Λεπτά στην "ημέρα βάρδιας" (00:30 → 24:30)
  function svcMin(t) {
    const m = toMin(t);
    return m == null ? null : (m < DAY_ROLL ? m + 1440 : m);
  }
  function fromMin(m) {
    m = ((m % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }
  function parseDate(d) { const [y, mo, da] = d.split('-').map(Number); return new Date(y, mo - 1, da); }
  function fmtDate(dt) {
    return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  }
  function addDays(d, n) { const dt = parseDate(d); dt.setDate(dt.getDate() + n); return fmtDate(dt); }
  function weekday(d) { return parseDate(d).getDay(); }
  function dayName(d) { return DAY_NAMES[weekday(d)]; }
  function prettyDate(d) { const dt = parseDate(d); return dt.getDate() + ' ' + MONTHS[dt.getMonth()]; }
  function grDate(d) { const [y, m, da] = d.split('-'); return da + '/' + m + '/' + y; }

  /* Περίοδοι λειτουργίας για μια ημερομηνία: [{start, end}] σε λεπτά βάρδιας */
  function periodsFor(settings, date, closures) {
    if (closures && closures.some(c => c.day === date)) return [];
    const sp = specialFor(settings, date);
    const list = sp ? (sp.periods || []) : ((settings.hours || {})[String(weekday(date))] || []);
    return list.map(p => {
      const s = toMin(p.open);
      let e = toMin(p.close);
      if (e <= s) e += 1440;               // κλείνει μετά τα μεσάνυχτα
      return { start: s, end: e };
    }).filter(p => p.end > p.start).sort((a, b) => a.start - b.start);
  }

  /* Ειδικό ωράριο για συγκεκριμένη ημερομηνία (αντικαθιστά το εβδομαδιαίο) */
  function specialFor(settings, date) {
    const sp = settings && settings.special_hours && settings.special_hours[date];
    return sp && Array.isArray(sp.periods) ? sp : null;
  }
  function periodsText(periods) {
    return (periods || []).map(p => p.open + '–' + p.close).join(', ');
  }

  /* Διαθέσιμες ώρες κράτησης (τελευταία κράτηση = κλείσιμο − 1 slot) */
  function slotsFor(settings, date, closures) {
    const step = settings.slot_minutes || 30;
    const out = [];
    for (const p of periodsFor(settings, date, closures)) {
      for (let m = p.start; m <= p.end - step; m += step) out.push(m);
    }
    return out;
  }

  /* Ώρες για το χρονοδιάγραμμα (από άνοιγμα μέχρι κλείσιμο) */
  function timelineRange(settings, date, closures, reservations) {
    const ps = periodsFor(settings, date, closures);
    let lo = ps.length ? ps[0].start : 12 * 60;
    let hi = ps.length ? ps[ps.length - 1].end : 24 * 60;
    for (const r of reservations || []) {
      const s = svcMin(r.res_time);
      lo = Math.min(lo, s);
      hi = Math.max(hi, s + (r.duration_min || 120));
    }
    const step = settings.slot_minutes || 30;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    return { lo, hi, step };
  }

  function isActive(r) { return ACTIVE.includes(r.status); }
  function overlaps(aS, aD, bS, bD) { return aS < bS + bD && bS < aS + aD; }

  /* Άτομα που βρίσκονται στο μαγαζί σε ένα λεπτό */
  function coversAt(reservations, minute, excludeId) {
    let n = 0;
    for (const r of reservations) {
      if (!isActive(r) || r.id === excludeId) continue;
      const s = svcMin(r.res_time);
      if (minute >= s && minute < s + (r.duration_min || 120)) n += r.party_size;
    }
    return n;
  }

  /* Μέγιστος φόρτος μέσα σε ένα διάστημα (για έλεγχο χωρητικότητας) */
  function peakCovers(reservations, start, dur, step, excludeId) {
    let peak = 0;
    for (let m = start; m < start + dur; m += step) peak = Math.max(peak, coversAt(reservations, m, excludeId));
    return peak;
  }

  function tableConflict(reservations, tableId, start, dur, excludeId) {
    return reservations.find(r =>
      isActive(r) && r.id !== excludeId && (r.table_ids || []).map(Number).includes(Number(tableId)) &&
      overlaps(start, dur, svcMin(r.res_time), r.duration_min || 120)) || null;
  }

  function freeTables(tables, reservations, start, dur, excludeId) {
    return tables.filter(t => t.active !== false && !tableConflict(reservations, t.id, start, dur, excludeId));
  }

  /* Πρόταση τραπεζιών: ένα τραπέζι με τη μικρότερη επάρκεια, αλλιώς ένωση γειτονικών στην ίδια περιοχή */
  /* Κέντρο τραπεζιού στην κάτοψη (αν δεν έχει θέση, χρησιμοποιείται η σειρά του) */
  function tableCenter(t, i) {
    return (t.x != null && t.y != null) ? { x: +t.x, y: +t.y } : { x: (t.sort || i || 0) * 100, y: 0 };
  }
  function areaKey(t) { return t.area_id != null ? String(t.area_id) : (t.area || ''); }

  /* Πρόταση τραπεζιών: ένα τραπέζι με τη μικρότερη επάρκεια,
     αλλιώς ένωση των πιο κοντινών ελεύθερων τραπεζιών του ίδιου χώρου (από την κάτοψη). */
  function suggestTables(tables, reservations, party, start, dur, areaPref, excludeId) {
    const free = freeTables(tables, reservations, start, dur, excludeId)
      .filter(t => !areaPref || areaPref === 'any' || areaKey(t) === String(areaPref))
      .sort((a, b) => ((a.sort || 0) - (b.sort || 0)) || (a.id - b.id));
    const single = free.filter(t => t.seats >= party).sort((a, b) => (a.seats - b.seats) || ((a.sort || 0) - (b.sort || 0)));
    if (single.length) return [single[0].id];

    const pos = new Map(free.map((t, i) => [t.id, tableCenter(t, i)]));
    const dist = (a, b) => { const p = pos.get(a.id), q = pos.get(b.id); return Math.hypot(p.x - q.x, p.y - q.y); };
    let best = null;
    for (const seed of free) {
      const others = free.filter(t => t !== seed && areaKey(t) === areaKey(seed))
        .sort((a, b) => dist(seed, a) - dist(seed, b));
      const pick = [seed]; let sum = seed.seats, spread = 0;
      for (const t of others) {
        if (sum >= party || pick.length >= 6) break;
        pick.push(t); sum += t.seats; spread = Math.max(spread, dist(seed, t));
      }
      if (sum < party) continue;
      const better = !best || pick.length < best.n || (pick.length === best.n && (sum < best.sum ||
        (sum === best.sum && spread < best.spread)));
      if (better) best = { ids: pick.map(t => t.id), n: pick.length, sum, spread };
    }
    return best ? best.ids : [];
  }

  /* Έλεγχοι πριν την αποθήκευση: επιστρέφει { errors:[], warnings:[] } */
  function validate(r, ctx) {
    const { settings, closures, tables, reservations } = ctx;
    const errors = [], warnings = [];
    if (!r.name || !r.name.trim()) errors.push('Συμπλήρωσε όνομα.');
    if (!r.res_date) errors.push('Διάλεξε ημερομηνία.');
    if (!r.res_time) errors.push('Διάλεξε ώρα.');
    if (!(r.party_size > 0)) errors.push('Τα άτομα πρέπει να είναι τουλάχιστον 1.');
    if (errors.length) return { errors, warnings };

    const start = svcMin(r.res_time);
    const dur = r.duration_min || settings.duration_minutes || 120;
    const step = settings.slot_minutes || 30;

    const closed = (closures || []).find(c => c.day === r.res_date);
    if (closed) warnings.push('Το κατάστημα είναι κλειστό αυτή τη μέρα' + (closed.note ? ' (' + closed.note + ')' : '') + '.');
    else {
      const ps = periodsFor(settings, r.res_date, closures);
      if (!ps.length) warnings.push('Δεν υπάρχει ωράριο λειτουργίας για ' + dayName(r.res_date) + '.');
      else if (!ps.some(p => start >= p.start && start < p.end)) warnings.push('Η ώρα ' + fromMin(start) + ' είναι εκτός ωραρίου.');
    }
    if (settings.max_party_size && r.party_size > settings.max_party_size)
      warnings.push('Μεγάλη παρέα (' + r.party_size + ' άτομα).');

    if (isActive(r)) {
      const sameDay = reservations.filter(x => x.res_date === r.res_date);
      const peak = peakCovers(sameDay, start, dur, step, r.id) + r.party_size;
      if (settings.max_covers_per_slot && peak > settings.max_covers_per_slot)
        warnings.push('Ξεπερνιέται η χωρητικότητα: ' + peak + ' / ' + settings.max_covers_per_slot + ' άτομα.');

      const ids = (r.table_ids || []).map(Number);
      for (const id of ids) {
        const c = tableConflict(sameDay, id, start, dur, r.id);
        if (c) {
          const t = tables.find(x => Number(x.id) === id);
          warnings.push('Το τραπέζι ' + (t ? t.name : id) + ' είναι πιασμένο από ' + c.name + ' (' + fromMin(svcMin(c.res_time)) + ').');
        }
      }
      if (ids.length) {
        const seats = ids.reduce((s, id) => s + ((tables.find(t => Number(t.id) === id) || {}).seats || 0), 0);
        if (seats < r.party_size) warnings.push('Οι θέσεις των τραπεζιών (' + seats + ') είναι λιγότερες από τα άτομα (' + r.party_size + ').');
      }
    }
    return { errors, warnings };
  }

  function fillTemplate(tpl, r, settings) {
    const map = {
      'ονομα': (r.name || '').trim().split(/\s+/)[0] || '',
      'ονοματεπωνυμο': (r.name || '').trim(),
      'καταστημα': settings.shop_name || '',
      'ατομα': String(r.party_size || ''),
      'ημερα': r.res_date ? dayName(r.res_date) : '',
      'ημερομηνια': r.res_date ? grDate(r.res_date) : '',
      'ωρα': r.res_time ? fromMin(toMin(r.res_time)) : '',
      'τηλεφωνο': settings.shop_phone || ''
    };
    return String(tpl || '').replace(/\{([^}]+)\}/g, (all, k) => {
      const key = k.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      return key in map ? map[key] : all;
    })
      // αν κάποιο πεδίο έμεινε κενό (π.χ. δεν έχει οριστεί τηλέφωνο), βγάζουμε την πρόταση που κατέληγε σε ": ."
      .replace(/\s*[^.!?\n]*:\s*\.(?=\s|$)/g, '')
      .trim();
  }

  /* Τηλέφωνο σε διεθνή μορφή (Ελλάδα όταν δεν έχει πρόθεμα) */
  function intlPhone(p) {
    let d = String(p || '').replace(/[^\d+]/g, '');
    if (!d) return '';
    if (d.startsWith('00')) d = '+' + d.slice(2);
    if (d.startsWith('+')) return d;
    if (d.length === 10 && /^[26]/.test(d)) return '+30' + d;
    if (d.startsWith('30') && d.length === 12) return '+' + d;
    return d;
  }
  function normPhone(p) { return intlPhone(p).replace(/^\+30/, ''); }

  const api = {
    ACTIVE, DAY_NAMES, toMin, svcMin, fromMin, parseDate, fmtDate, addDays, weekday, dayName, prettyDate, grDate,
    periodsFor, specialFor, periodsText, slotsFor, timelineRange, isActive, overlaps, coversAt, peakCovers, tableConflict, freeTables,
    suggestTables, tableCenter, validate, fillTemplate, intlPhone, normPhone
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);
