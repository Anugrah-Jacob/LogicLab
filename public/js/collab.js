/**
 * LogicLab live collaboration: share link, people, chat, voice and version history.
 * Loaded after app.js and merge.js. It talks to the app only through window.LogicLabHost and window.LogicLabHook.
 *
 *   Share link     the owner picks "Only you", "Anyone with the link can view" or "... can edit" (like a Docs/Canva share box).
 *   Live editing   people connect browser to browser (WebRTC data channels). Edits, switches, cursors and chat go
 *                  straight between them. The server only passes the first handshake messages and saves the project.
 *   Voice          WebRTC audio over the same connections. Nothing is recorded or relayed by the server.
 *   Permissions    "view" people can run the circuit and press switches and buttons on their own screen; everyone
 *                  ignores their edits. The server also refuses their saves.
 * See docs/COLLABORATION.md.
 */
(() => {
  'use strict';
  const host = window.LogicLabHost,
    HOOK = window.LogicLabHook,
    M = window.LLMerge;
  if (!host || !HOOK || !M) return;
  const $ = (s, r = document) => r.querySelector(s),
    esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'),
    rid = () => Math.random().toString(36).slice(2, 10);
  const COLORS = [
    '#e8543a',
    '#2f80ed',
    '#16a34a',
    '#3b82f6',
    '#f59e0b',
    '#06b6d4',
    '#ec4899',
    '#84cc16',
    '#6366f1',
    '#14b8a6',
    '#f43f5e',
    '#2563eb'
  ];
  const initials = (n) =>
    String(n || '?')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?';
  const canEdit = (r) => r === 'edit' || r === 'owner';
  const ROLE_TEXT = { owner: 'Owner', edit: 'Can edit', view: 'View only' };
  const ago = (t) => {
    const s = (Date.now() - t) / 1000;
    return s < 60
      ? 'Just now'
      : s < 3600
        ? Math.floor(s / 60) + ' min ago'
        : s < 86400
          ? Math.floor(s / 3600) + ' h ago'
          : new Date(t).toLocaleDateString();
  };
  const ICON = {
    lock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    globe:
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.3 3 14.7 0 18M12 3c-3 3.3-3 14.7 0 18"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    hist: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    dl: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
    more: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
    share:
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-6"/></svg>',
    send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 20l18-8L3 4v6l11 2-11 2z"/></svg>'
  };

  /* ---------------------------------------------------------------- network helpers */
  async function api(path, body, method) {
    const res = await fetch('/api' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || 'Request failed (' + res.status + ')');
      e.status = res.status;
      throw e;
    }
    return data;
  }
  const toast = (m, t, ms) => host.toast(m, t || 'info', ms || 3500);

  /* ---------------------------------------------------------------- state */
  let S = null; // the live session, or null
  let share = null; // the owner's share record for the open project
  let ui = { open: false, menu: false, more: false, download: false, chat: false, busy: '', note: '' };
  const authName = () => {
    const u = host.user();
    return u ? u.name : localStorage.getItem('ll:guestname') || '';
  };

  /* ---------------------------------------------------------------- session */
  async function startSession(info, asOwner) {
    if (S) await leave(true);
    const rep = new M.Replica(info.slot);
    S = {
      room: info.room,
      peer: info.peer,
      token: info.token,
      role: info.role,
      slot: info.slot,
      name: info.name,
      ice: info.ice,
      title: info.title,
      rep,
      pcs: new Map(),
      roster: new Map(),
      since: 0,
      polling: 0,
      synced: !(info.peers && info.peers.length),
      needFrom: null,
      tries: new Map(),
      chat: [],
      unread: 0,
      cursors: new Map(),
      mic: null,
      dirty: 0,
      saveT: 0,
      lastSave: 0,
      owner: asOwner,
      speaking: new Set(),
      pending: 0
    };
    if (!asOwner) host.load(info.doc, info.title);
    host.readOnly(info.role === 'view');
    host.ownRange((info.slot + 1) * 1e6, (info.slot + 2) * 1e6);
    rep.seed(host.doc());
    HOOK.live = true;
    HOOK.commit = scheduleLocal;
    HOOK.sw = (n, v) => {
      if (S && canEdit(S.role)) broadcast({ t: 'sw', id: n.id, v });
    };
    HOOK.cursor = sendCursor;
    HOOK.home = () => leave();
    (info.peers || []).forEach((p) => S.roster.set(p.peer, p));
    syncRoster(info.peers || []);
    if (!S.synced)
      setTimeout(() => S && !S.synced && ((S.synced = true), S.needFrom && (S.needFrom = null)), 9000);
    pollLoop();
    cursorLoop();
    levelLoop();
    renderBar();
    renderPopover();
    return S;
  }

  async function leave(quiet) {
    const s = S;
    if (!s) return;
    S = null;
    clearTimeout(s.saveT);
    if (s.dirty && canEdit(s.role) && !s.owner) await saveDoc(s).catch(() => {});
    api('/collab/' + s.room + '/leave', { peer: s.peer, token: s.token }).catch(() => {});
    s.pcs.forEach((c) => closeConn(c, true));
    if (s.mic) {
      s.mic.track.stop();
    }
    HOOK.live = false;
    HOOK.commit = HOOK.sw = HOOK.cursor = HOOK.home = null;
    if (s.role === 'view') host.readOnly(false);
    $('#cb-cursors') && ($('#cb-cursors').innerHTML = '');
    ui.chat = false;
    renderBar();
    renderPopover();
    renderChat();
    if (!quiet) toast('You left the live session.');
  }
  addEventListener('pagehide', () => {
    if (!S) return;
    try {
      navigator.sendBeacon(
        '/api/collab/' + S.room + '/leave',
        new Blob([JSON.stringify({ peer: S.peer, token: S.token })], { type: 'application/json' })
      );
    } catch (e) {}
  });

  /* ---- signalling poll: only used to find people and exchange the WebRTC handshake ---- */
  async function pollLoop() {
    const s = S;
    if (!s || s.polling) return;
    s.polling = 1;
    let fails = 0;
    while (S === s) {
      try {
        const r = await api('/collab/' + s.room + '/poll', { peer: s.peer, token: s.token, since: s.since });
        fails = 0;
        syncRoster(r.peers);
        for (const sig of r.signals) {
          s.since = Math.max(s.since, sig.id);
          await onSignal(sig).catch((e) => console.warn('signal', e));
        }
      } catch (e) {
        if (e.status === 410 || e.status === 403) {
          toast(
            e.status === 410 ? 'This session ended or the link changed.' : 'The session was closed.',
            'warn',
            5000
          );
          leave(true);
          return;
        }
        fails++;
      }
      if (S !== s) return;
      const waiting =
        [...s.pcs.values()].some((c) => c.state !== 'open') ||
        [...s.roster.keys()].some((id) => id !== s.peer && !s.pcs.has(id));
      const delay = fails
        ? Math.min(30000, 2000 * fails)
        : waiting && Date.now() - s.pending < 40000
          ? 1200
          : 6000;
      await new Promise((ok) => setTimeout(ok, delay));
    }
  }

  function syncRoster(list) {
    const s = S;
    if (!s) return;
    const ids = new Set(list.map((p) => p.peer));
    ids.add(s.peer);
    for (const p of list) s.roster.set(p.peer, p);
    for (const id of [...s.roster.keys()]) {
      if (!ids.has(id)) {
        s.roster.delete(id);
        const c = s.pcs.get(id);
        if (c) closeConn(c, true);
        s.cursors.delete(id);
        s.tries.delete(id);
      }
    }
    // The person with the larger id makes the offer, so two people never offer to each other at once.
    for (const p of list) {
      if (p.peer === s.peer || s.pcs.has(p.peer) || s.peer < p.peer) continue;
      const t = s.tries.get(p.peer) || { n: 0, at: 0 };
      if (t.n >= 5 || Date.now() - t.at < 4000) continue;
      s.tries.set(p.peer, { n: t.n + 1, at: Date.now() });
      s.pending = Date.now();
      connect(p.peer, true);
    }
    renderBar();
    renderPopover();
  }
  const roleOf = (id) => (S && S.roster.get(id) ? S.roster.get(id).role : 'view');
  const nameOf = (id) => (S && S.roster.get(id) ? S.roster.get(id).name : 'Someone');

  function signal(to, kind, data) {
    if (!S) return;
    S.pending = Date.now();
    api('/collab/' + S.room + '/signal', {
      peer: S.peer,
      token: S.token,
      to,
      kind,
      data: JSON.stringify(data)
    }).catch(() => {});
  }

  /* ---- peer connections ---- */
  function connect(id, initiator) {
    const s = S,
      pc = new RTCPeerConnection({ iceServers: s.ice }),
      c = {
        id,
        pc,
        dc: null,
        state: 'connecting',
        ice: [],
        early: [],
        iceT: 0,
        audio: null,
        speaking: 0,
        muted: 0,
        chunks: new Map()
      };
    s.pcs.set(id, c);
    // The offering side adds the audio line; the answering side adopts the one in the offer (see onSignal).
    if (initiator) {
      c.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (s.mic) c.sender.replaceTrack(s.mic.track).catch(() => {});
    }
    pc.ontrack = (e) => playRemote(c, e.streams[0] || new MediaStream([e.track]));
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        c.ice.push(e.candidate.toJSON());
        clearTimeout(c.iceT);
        c.iceT = setTimeout(() => flushIce(c), 250);
      } else flushIce(c);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (S === s && s.pcs.get(id) === c) {
          closeConn(c, true);
          renderBar();
          renderPopover();
        }
      }
    };
    if (initiator) {
      setupChannel(c, pc.createDataChannel('ll', { ordered: true }));
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => signal(id, 'offer', pc.localDescription))
        .catch((e) => console.warn('offer', e));
    } else pc.ondatachannel = (e) => setupChannel(c, e.channel);
    return c;
  }
  function flushIce(c) {
    clearTimeout(c.iceT);
    if (c.ice.length) {
      signal(c.id, 'ice', c.ice);
      c.ice = [];
    }
  }
  async function onSignal({ from, kind, data }) {
    const s = S;
    if (!s) return;
    const d = JSON.parse(data);
    let c = s.pcs.get(from);
    if (kind === 'offer') {
      if (c) closeConn(c, true);
      c = connect(from, false);
      await c.pc.setRemoteDescription(d);
      const t = c.pc.getTransceivers().find((x) => x.receiver.track && x.receiver.track.kind === 'audio');
      if (t) {
        t.direction = 'sendrecv'; // answer with sending enabled so voice works in both directions
        c.sender = t.sender;
        if (s.mic) t.sender.replaceTrack(s.mic.track).catch(() => {});
      }
      for (const x of c.early.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
      const a = await c.pc.createAnswer();
      await c.pc.setLocalDescription(a);
      signal(from, 'answer', c.pc.localDescription);
    } else if (kind === 'answer' && c) {
      await c.pc.setRemoteDescription(d);
      for (const x of c.early.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
    } else if (kind === 'ice' && c) {
      for (const x of Array.isArray(d) ? d : []) {
        if (c.pc.remoteDescription) await c.pc.addIceCandidate(x).catch(() => {});
        else c.early.push(x);
      }
    }
  }
  function closeConn(c, drop) {
    try {
      c.pc.onconnectionstatechange = null;
      c.pc.close();
    } catch (e) {}
    if (c.audio) c.audio.remove();
    if (drop && S) S.pcs.delete(c.id);
    if (S && S.needFrom === c.id) S.needFrom = null;
  }

  /* ---- data channel messages ---- */
  const CHUNK = 60000;
  function setupChannel(c, dc) {
    c.dc = dc;
    dc.onopen = () => {
      c.state = 'open';
      if (S && !S.synced && !S.needFrom && canEdit(roleOf(c.id))) {
        S.needFrom = c.id;
        sendTo(c, { t: 'need' });
        setTimeout(() => S && !S.synced && S.needFrom === c.id && (S.needFrom = null), 7000);
      }
      renderBar();
      renderPopover();
    };
    dc.onclose = () => {
      c.state = 'closed';
      renderBar();
    };
    dc.onmessage = (e) => onData(c, e.data);
  }
  function sendTo(c, obj) {
    if (!c.dc || c.dc.readyState !== 'open') return;
    const s = JSON.stringify(obj);
    if (s.length <= CHUNK) return c.dc.send(s);
    const id = rid(),
      n = Math.ceil(s.length / CHUNK);
    for (let i = 0; i < n; i++)
      c.dc.send(JSON.stringify({ t: 'chunk', id, i, n, d: s.slice(i * CHUNK, (i + 1) * CHUNK) }));
  }
  function broadcast(obj) {
    if (S) S.pcs.forEach((c) => sendTo(c, obj));
  }
  function onData(c, text) {
    let m;
    try {
      m = JSON.parse(text);
    } catch (e) {
      return;
    }
    if (m.t === 'chunk') {
      if (typeof m.id !== 'string' || !(m.n > 0 && m.n < 200)) return;
      const a = c.chunks.get(m.id) || { n: m.n, parts: [], got: 0 };
      if (!a.parts[m.i]) {
        a.parts[m.i] = String(m.d);
        a.got++;
      }
      c.chunks.set(m.id, a);
      if (a.got === a.n) {
        c.chunks.delete(m.id);
        onData(c, a.parts.join(''));
      }
      if (c.chunks.size > 4) c.chunks.delete(c.chunks.keys().next().value);
      return;
    }
    if (!S) return;
    const role = roleOf(c.id);
    if (m.t === 'ops') {
      if (canEdit(role)) applyRemote(m.ops);
    } else if (m.t === 'full') {
      if (canEdit(role) && S.needFrom === c.id) {
        applyRemote(m.ops);
        if (m.sw && typeof m.sw === 'object')
          for (const [id, v] of Object.entries(m.sw)) host.setSwitch(+id, v);
        S.synced = true;
        S.needFrom = null;
        toast('Connected. You have the latest version.', 'ok', 2200);
      }
    } else if (m.t === 'need') {
      if (canEdit(S.role)) {
        flushLocalNow();
        sendTo(c, { t: 'full', ops: S.rep.full(), sw: host.switches() });
      }
    } else if (m.t === 'sw') {
      if (canEdit(role) && Number.isFinite(+m.id)) host.setSwitch(+m.id, m.v);
    } else if (m.t === 'cur') {
      if (Number.isFinite(m.x) && Number.isFinite(m.y))
        S.cursors.set(c.id, { x: m.x, y: m.y, at: Date.now() });
    } else if (m.t === 'chat') {
      const text = String(m.text || '')
        .slice(0, 600)
        .trim();
      if (text) addChat({ from: c.id, name: nameOf(c.id), text, ts: Date.now(), me: false });
    }
  }

  /* ---- applying and sending changes ---- */
  function applyRemote(ops) {
    if (!S) return;
    flushLocalNow();
    if (!S.rep.remote(ops)) return;
    const ch = S.rep.reconcile(host.doc());
    if (ch.length) host.applyChanges(ch);
  }
  let lt = 0,
    ltMax = 0;
  function scheduleLocal() {
    if (!S || S.role === 'view') return;
    clearTimeout(lt);
    if (!ltMax) ltMax = setTimeout(flushLocalNow, 150);
    lt = setTimeout(flushLocalNow, 40);
  }
  function flushLocalNow() {
    clearTimeout(lt);
    clearTimeout(ltMax);
    lt = ltMax = 0;
    if (!S || S.role === 'view') return;
    const ops = S.rep.local(host.doc());
    if (!ops.length) return;
    broadcast({ t: 'ops', ops });
    markDirty();
  }
  function markDirty() {
    const s = S;
    if (!s || s.owner) return; // the owner's own account sync already saves the project
    s.dirty = 1;
    clearTimeout(s.saveT);
    s.saveT = setTimeout(
      () => S === s && saveDoc(s).catch(() => {}),
      Math.max(2500, 5000 - (Date.now() - s.lastSave))
    );
  }
  async function saveDoc(s) {
    if (!s.dirty) return;
    s.dirty = 0;
    s.lastSave = Date.now();
    try {
      await api(
        '/collab/' + s.room + '/doc',
        { peer: s.peer, token: s.token, doc: host.project(), name: host.doc().name },
        'PUT'
      );
    } catch (e) {
      s.dirty = 1;
      if (e.status === 404) toast(e.message, 'warn', 6000);
    }
  }

  /* ---- cursors ---- */
  let curT = 0;
  function sendCursor(x, y) {
    const now = Date.now();
    if (!S || now - curT < 60 || !S.pcs.size) return;
    curT = now;
    broadcast({ t: 'cur', x: Math.round(x), y: Math.round(y) });
  }
  function cursorLoop() {
    const s = S;
    if (!s) return;
    let box = $('#cb-cursors');
    if (!box) {
      box = document.createElement('div');
      box.id = 'cb-cursors';
      ($('#wrk') || document.body).append(box);
    }
    const v = host.view();
    const seen = new Set();
    if (v) {
      const r = v.el.getBoundingClientRect(),
        w = box.getBoundingClientRect();
      for (const [id, c] of s.cursors) {
        if (Date.now() - c.at > 8000 || !s.roster.has(id)) {
          s.cursors.delete(id);
          continue;
        }
        seen.add(id);
        let el = box.querySelector('[data-p="' + id + '"]');
        const p = s.roster.get(id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'cb-cur';
          el.dataset.p = id;
          el.innerHTML =
            '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1l5 13 2-5 5-2z" fill="currentColor" stroke="#fff" stroke-width="1"/></svg><span></span>';
          el.style.setProperty('--c', COLORS[p.slot % COLORS.length]);
          el.lastChild.textContent = p.name;
          box.append(el);
        }
        el.style.transform =
          'translate(' +
          (r.left - w.left + v.v.x + c.x * v.v.s) +
          'px,' +
          (r.top - w.top + v.v.y + c.y * v.v.s) +
          'px)';
      }
    }
    box.querySelectorAll('.cb-cur').forEach((el) => !seen.has(el.dataset.p) && el.remove());
    requestAnimationFrame(() => S === s && cursorLoop());
  }

  /* ---- voice ---- */
  let actx = null;
  function level(stream) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const an = actx.createAnalyser();
      an.fftSize = 512;
      actx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      return () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const b of buf) sum += (b - 128) * (b - 128);
        return Math.sqrt(sum / buf.length) > 7;
      };
    } catch (e) {
      return () => false;
    }
  }
  function playRemote(c, stream) {
    if (!c.audio) {
      c.audio = document.createElement('audio');
      c.audio.autoplay = true;
      c.audio.playsInline = true;
      c.audio.hidden = true;
      document.body.append(c.audio);
    }
    c.audio.srcObject = stream;
    c.audio.muted = !!c.muted;
    c.audio.play().catch(() => {});
    c.lvl = level(stream);
  }
  function levelLoop() {
    const s = S;
    if (!s) return;
    const sp = new Set();
    s.pcs.forEach((c, id) => c.lvl && !c.muted && c.lvl() && sp.add(id));
    if (s.mic && s.mic.lvl && s.mic.lvl()) sp.add(s.peer);
    if ([...sp].sort().join() !== [...s.speaking].sort().join()) {
      s.speaking = sp;
      renderBar();
      renderPopover();
    }
    setTimeout(() => S === s && levelLoop(), 200);
  }
  async function toggleMic() {
    if (!S) return;
    if (S.mic) {
      S.mic.track.stop();
      S.mic = null;
      S.pcs.forEach((c) => c.sender && c.sender.replaceTrack(null).catch(() => {}));
    } else {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
        return toast('Voice needs a secure (https) page and a modern browser.', 'warn');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        if (!S) return stream.getTracks().forEach((t) => t.stop());
        S.mic = { stream, track: stream.getAudioTracks()[0], lvl: level(stream) };
        if (actx && actx.state === 'suspended') actx.resume();
        S.pcs.forEach((c) => c.sender && c.sender.replaceTrack(S.mic.track).catch(() => {}));
        S.mic.track.onended = () => S && S.mic && toggleMic();
      } catch (e) {
        toast('Microphone access was blocked. Allow it in the address bar to talk.', 'warn', 5000);
      }
    }
    renderBar();
    renderPopover();
  }

  /* ---- chat ---- */
  function addChat(m) {
    if (!S) return;
    S.chat.push(m);
    if (S.chat.length > 200) S.chat.shift();
    if (!ui.chat && !m.me) S.unread++;
    renderChat();
    renderBar();
  }
  function sendChat(text) {
    text = String(text || '')
      .trim()
      .slice(0, 600);
    if (!text || !S) return;
    broadcast({ t: 'chat', text });
    addChat({ from: S.peer, name: S.name, text, ts: Date.now(), me: true });
  }

  /* ---------------------------------------------------------------- owner: share record and access level */
  const accessOf = (sh) => (!sh || (!sh.viewOn && !sh.editOn) ? 'none' : sh.editOn ? 'edit' : 'view');
  const linkOf = (sh) =>
    sh ? location.origin + '/#join=' + sh.id + '.' + (sh.editOn ? sh.editKey : sh.viewKey) : '';
  async function loadShare() {
    const pid = host.pid();
    share = null;
    if (!host.user() || !pid) return;
    try {
      share = (await api('/collab/share?pid=' + encodeURIComponent(pid))).share;
    } catch (e) {
      /* collaboration tables may not be migrated yet */
    }
  }
  async function setAccess(level) {
    const pid = host.pid();
    if (!host.user()) return;
    ui.busy = 'access';
    ui.menu = false;
    renderPopover();
    try {
      if (!share && level !== 'none') {
        try {
          share = (await api('/collab/share', { action: 'create', pid })).share;
        } catch (e) {
          if (e.status !== 404) throw e;
          ui.note = 'Saving this project to your account…';
          renderPopover();
          await host.syncNow();
          await new Promise((ok) => setTimeout(ok, 600));
          share = (await api('/collab/share', { action: 'create', pid })).share;
        }
      }
      if (share)
        share = (
          await api('/collab/share', {
            action: 'toggle',
            pid,
            viewOn: level === 'view',
            editOn: level === 'edit'
          })
        ).share;
      ui.note = '';
      if (level !== 'none' && !S) await goLive();
      else if (level === 'none' && S && S.owner) await leave(true);
    } catch (e) {
      ui.note = e.message;
    }
    ui.busy = '';
    renderPopover();
    renderBar();
  }
  async function goLive() {
    try {
      const info = await api('/collab/host', { pid: host.pid(), name: (host.user() || {}).name });
      await startSession(info, true);
    } catch (e) {
      ui.note = e.message;
    }
  }
  async function resetLink() {
    ui.busy = 'reset';
    renderPopover();
    try {
      share = (await api('/collab/share', { action: 'rotate', pid: host.pid() })).share;
      ui.note = 'New link created. The old one no longer works.';
    } catch (e) {
      ui.note = e.message;
    }
    ui.busy = '';
    renderPopover();
  }
  async function addInvite() {
    const email = ($('#cb-em') || {}).value?.trim() || '';
    const role = ($('#cb-inv-role') || {}).value || 'edit';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) return toast('Enter a valid email address.', 'warn');
    ui.busy = 'invite';
    ui.note = '';
    renderPopover();
    try {
      share = (await api('/collab/share', { action: 'invite', pid: host.pid(), email, role })).share;
      ui.note = 'Access added for ' + email + '. They must sign in or sign up with this email.';
    } catch (e) {
      ui.note = e.message;
    }
    ui.busy = '';
    renderPopover();
  }
  async function removeInvite(email) {
    ui.busy = 'invite';
    try {
      share = (await api('/collab/share', { action: 'uninvite', pid: host.pid(), email })).share;
      ui.note = 'Access removed for ' + email + '.';
    } catch (e) {
      ui.note = e.message;
    }
    ui.busy = '';
    renderPopover();
  }
  async function protectLink(password) {
    ui.busy = 'password';
    ui.note = '';
    renderPopover();
    try {
      share = (await api('/collab/share', { action: 'password', pid: host.pid(), password })).share;
      ui.note = password
        ? 'Password protection is on. Invitees must sign in and enter this password.'
        : 'Password protection removed.';
    } catch (e) {
      ui.note = e.message;
    }
    ui.busy = '';
    renderPopover();
  }
  async function stopSharing() {
    if (!confirm('Stop sharing? Everyone is disconnected and the link stops working.')) return;
    try {
      await api('/collab/share', { action: 'delete', pid: host.pid() });
    } catch (e) {}
    share = null;
    if (S && S.owner) await leave(true);
    ui.more = false;
    renderPopover();
    renderBar();
  }

  /* ---------------------------------------------------------------- join by link */
  function parseJoin() {
    const m = /^#join=([A-Za-z0-9_-]{6,40})\.([A-Za-z0-9_-]{6,60})$/.exec(location.hash);
    return m ? { room: m[1], key: m[2] } : null;
  }
  function parseInvite() {
    const m = /^#invite=([A-Za-z0-9_-]{6,40})$/.exec(location.hash);
    return m ? { room: m[1], invite: true, roomOnly: true } : null;
  }
  async function openInvitation(invite) {
    if (!host.user()) {
      host.auth(
        'login',
        'Sign in or create an account using the email address this project was shared with.',
        () => openInvitation(invite)
      );
      return;
    }
    const d = document.createElement('div');
    d.className = 'cb-modal';
    d.innerHTML =
      '<div class="cb-card" role="dialog" aria-modal="true" aria-labelledby="cbi"><h2 id="cbi">You’ve been invited to a LogicLab project</h2><p class="cb-mu">You’re signed in as <b>' +
      esc(host.user().email) +
      '.</b></p><div class="cb-row"><button class="cb-btn" id="cb-no">Not now</button><button class="cb-btn cb-pri" id="cb-go">Join project</button></div></div>';
    document.body.append(d);
    $('#cb-no', d).onclick = () => d.remove();
    $('#cb-go', d).onclick = async () => {
      $('#cb-go', d).disabled = true;
      $('#cb-go', d).textContent = 'Joining…';
      try {
        const info = await api('/collab/invite/join', {
          share: invite.room,
          name: (host.user() || {}).name
        });
        d.remove();
        await startSession(info, false);
        toast(
          info.role === 'view' ? 'Joined as view only.' : 'Joined. Your changes are shared live.',
          'ok',
          4500
        );
      } catch (e) {
        d.remove();
        if (e.status === 401) host.auth('login', e.message, () => openInvitation(invite));
        else toast(e.message, 'error', 5000);
      }
    };
  }
  function joinDialog(j, err, savedPassword = '', savedName = '') {
    closeDialog();
    const d = document.createElement('div');
    d.className = 'cb-modal';
    d.id = 'cb-join';
    d.innerHTML =
      '<div class="cb-card" role="dialog" aria-modal="true" aria-labelledby="cbj">' +
      '<h2 id="cbj">You’ve been invited to a LogicLab project</h2>' +
      '<p class="cb-mu">' +
      (j.roomOnly
        ? 'Sign in with the email address this project was shared with.'
        : 'Pick a name so others can see who you are. If this link is password-protected, enter its password.') +
      '</p>' +
      (err ? '<div class="cb-err">' + esc(err) + '</div>' : '') +
      (j.roomOnly ? '' : '<input id="cb-nm" maxlength="24" placeholder="Your name" autocomplete="name" />') +
      (j.roomOnly
        ? ''
        : '<input id="cb-jpw" type="password" placeholder="Password (if required)" autocomplete="current-password" />') +
      '<div class="cb-row"><button class="cb-btn" id="cb-no">Not now</button><button class="cb-btn cb-pri" id="cb-go">Join project</button></div></div>';
    document.body.append(d);
    const nm = $('#cb-nm', d);
    if (nm) {
      nm.value = savedName || authName();
      nm.focus();
    } else $('#cb-go', d).focus();
    const go = async () => {
      const name = (nm && nm.value.trim()) || (host.user() || {}).name || 'Guest';
      const password = ($('#cb-jpw', d) || {}).value || '';
      if (nm) localStorage.setItem('ll:guestname', name);
      $('#cb-go', d).disabled = true;
      $('#cb-go', d).textContent = 'Joining…';
      try {
        const info = j.invite
          ? await api('/collab/invite/join', { share: j.room, name })
          : await api('/collab/join', { share: j.room, key: j.key, name, password });
        d.remove();
        await startSession(info, false);
        toast(
          info.role === 'view'
            ? 'Joined as view only. You can run the circuit and press switches.'
            : 'Joined. Your changes are shared live.',
          'ok',
          4500
        );
        if (actx && actx.state === 'suspended') actx.resume();
      } catch (e) {
        if (e.status === 401 && /sign in/i.test(e.message)) {
          d.remove();
          host.auth('login', e.message, () => joinDialog(j, null, password, name));
          return;
        }
        joinDialog(j, e.message, password, name);
      }
    };
    $('#cb-go', d).onclick = go;
    if (nm) nm.onkeydown = (e) => e.key === 'Enter' && go();
    const pw = $('#cb-jpw', d);
    if (pw) {
      pw.value = savedPassword;
      pw.onkeydown = (e) => e.key === 'Enter' && go();
    }
    $('#cb-no', d).onclick = () => {
      d.remove();
      history.replaceState(null, '', location.pathname + location.search);
    };
  }
  function closeDialog() {
    document.querySelectorAll('.cb-modal').forEach((m) => m.remove());
  }

  /* ---------------------------------------------------------------- history */
  async function histApi(body) {
    if (S)
      return api('/collab/' + S.room + '/history', Object.assign({ peer: S.peer, token: S.token }, body));
    return api('/projects/' + encodeURIComponent(host.pid()) + '/history', body);
  }
  async function openHistory() {
    closeDialog();
    const d = document.createElement('div');
    d.className = 'cb-modal';
    d.innerHTML =
      '<div class="cb-card cb-wide" role="dialog" aria-modal="true" aria-labelledby="cbh"><div class="cb-hd"><h2 id="cbh">Version history</h2><button class="cb-x cb-mx" aria-label="Close">×</button></div>' +
      '<p class="cb-mu">Versions are saved automatically while you work. Restoring one keeps the current circuit in history too.</p>' +
      '<div class="cb-row cb-save"><input id="cb-lb" maxlength="60" placeholder="Name this version (optional)" /><button class="cb-btn cb-pri" id="cb-sv">Save version</button></div>' +
      '<div id="cb-list" class="cb-list"><div class="cb-mu">Loading…</div></div></div>';
    document.body.append(d);
    d.onclick = (e) => e.target === d && d.remove();
    $('.cb-x', d).onclick = () => d.remove();
    const list = $('#cb-list', d);
    const load = async () => {
      try {
        const { versions } = await histApi({ action: 'list' });
        list.innerHTML = versions.length
          ? versions
              .map(
                (v) =>
                  '<div class="cb-ver"><div><b>' +
                  esc(v.label || 'Automatic version') +
                  '</b><span class="cb-mu">' +
                  esc(ago(v.ts)) +
                  (v.by ? ' · ' + esc(v.by) : '') +
                  ' · ' +
                  Math.max(1, Math.round(v.bytes / 1024)) +
                  ' KB</span></div><button class="cb-btn" data-v="' +
                  esc(v.id) +
                  '">Restore</button></div>'
              )
              .join('')
          : '<div class="cb-mu">No versions yet. Make a change, or save one now.</div>';
      } catch (e) {
        list.innerHTML = '<div class="cb-err">' + esc(e.message) + '</div>';
      }
    };
    load();
    $('#cb-sv', d).onclick = async () => {
      try {
        const r = await histApi({
          action: 'save',
          label: $('#cb-lb', d).value.trim() || 'Saved version',
          doc: host.project()
        });
        toast(r.unchanged ? 'Nothing changed since the last version.' : 'Version saved.', 'ok');
        $('#cb-lb', d).value = '';
        load();
      } catch (e) {
        toast(e.message, 'warn');
      }
    };
    list.onclick = async (e) => {
      const id = e.target.dataset && e.target.dataset.v;
      if (!id) return;
      e.target.disabled = true;
      try {
        const v = await histApi({ action: 'get', vid: id });
        await histApi({ action: 'save', label: 'Before restore', doc: host.project() });
        host.restoreDoc(v.doc);
        flushLocalNow();
        d.remove();
        toast('Restored “' + (v.label || ago(v.ts)) + '”. You can undo this with Ctrl+Z.', 'ok', 5000);
      } catch (err) {
        toast(err.message, 'warn');
        e.target.disabled = false;
      }
    };
  }

  /* ---------------------------------------------------------------- UI: header button, presence bar, popover */
  const hr = $('.hr');
  const bar = document.createElement('span');
  bar.id = 'cb-bar';
  const shareBtn = document.createElement('button');
  shareBtn.id = 'cb-share';
  shareBtn.className = 'pr';
  shareBtn.title = 'Share this project and work together live';
  shareBtn.innerHTML = ICON.share + '<span>Share</span>';
  if (hr) hr.insertBefore(shareBtn, $('#av'));
  ($('#wrk') || document.body).append(bar); // the presence bar floats over the canvas so the header never overflows
  const pop = document.createElement('div');
  pop.id = 'cb-pop';
  pop.hidden = true;
  document.body.append(pop);
  const chatBox = document.createElement('div');
  chatBox.id = 'cb-chat';
  chatBox.hidden = true;
  document.body.append(chatBox);

  const avatar = (p, id, big) =>
    '<span class="cb-av' +
    (S && S.speaking.has(id) ? ' cb-sp' : '') +
    (big ? ' cb-big' : '') +
    '" style="background:' +
    COLORS[(p.slot || 0) % COLORS.length] +
    '" title="' +
    esc(p.name) +
    '">' +
    esc(initials(p.name)) +
    '</span>';
  function everyone() {
    if (!S) return [];
    const me = { peer: S.peer, name: S.name + ' (you)', role: S.role, slot: S.slot };
    return [me, ...[...S.roster.values()].filter((p) => p.peer !== S.peer)];
  }
  function renderBar() {
    if (!S) {
      bar.innerHTML = '';
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const people = everyone();
    bar.innerHTML =
      '<span class="cb-stack">' +
      people
        .slice(0, 4)
        .map((p) => avatar(p, p.peer))
        .join('') +
      (people.length > 4 ? '<span class="cb-av cb-more">+' + (people.length - 4) + '</span>' : '') +
      '</span>' +
      (S.role === 'view' ? '<span class="cb-pill">View only</span>' : '') +
      '<button class="cb-ic' +
      (S.mic ? ' cb-on' : '') +
      '" id="cb-mic" title="' +
      (S.mic ? 'Turn microphone off' : 'Talk to everyone') +
      '" aria-label="Microphone">' +
      ICON.mic +
      '</button>' +
      '<button class="cb-ic' +
      (ui.chat ? ' cb-on' : '') +
      '" id="cb-cht" title="Chat" aria-label="Chat">' +
      ICON.chat +
      (S.unread ? '<i>' + S.unread + '</i>' : '') +
      '</button>';
    $('#cb-mic', bar).onclick = toggleMic;
    $('#cb-cht', bar).onclick = toggleChat;
  }
  function placePop() {
    if (innerWidth <= 800) return pop.removeAttribute('style');
    const r = shareBtn.getBoundingClientRect();
    pop.style.top = r.bottom + 8 + 'px';
    pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
  }
  function togglePopover(on) {
    ui.open = on === undefined ? !ui.open : on;
    ui.menu = false;
    if (!ui.open) ui.download = false;
    pop.hidden = !ui.open;
    shareBtn.classList.toggle('cb-open', ui.open);
    if (ui.open) {
      placePop();
      loadShare().then(() => {
        renderPopover();
        const u = host.user();
        if (u && share && accessOf(share) !== 'none' && !S && host.pid()) goLive();
      });
      renderPopover();
    }
  }
  shareBtn.onclick = (e) => {
    e.stopPropagation();
    togglePopover();
  };
  document.addEventListener('click', (e) => {
    // composedPath() is fixed when the click starts, so it still works after a button re-rendered the popover.
    const inside = e.composedPath();
    if (
      ui.open &&
      !inside.includes(pop) &&
      !inside.includes(shareBtn) &&
      !inside.some((n) => n.classList && n.classList.contains('cb-modal'))
    )
      togglePopover(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const m = document.querySelector('.cb-modal');
    if (m) m.remove();
    else if (ui.open) togglePopover(false);
  });
  addEventListener('resize', () => ui.open && placePop());

  const ACCESS = {
    none: {
      icon: ICON.lock,
      title: 'Only you can access',
      text: 'Only you can open this project using this link.'
    },
    view: {
      icon: ICON.globe,
      title: 'Anyone with the link can view',
      text: 'They can look around, run the circuit and press switches. They cannot change it. <b>Sign-in is optional unless you add a password.</b>'
    },
    edit: {
      icon: ICON.globe,
      title: 'Anyone with the link can edit',
      text: 'They can change the circuit together with you, live. <b>Sign-in is optional unless you add a password.</b>'
    }
  };
  function renderPopover() {
    if (pop.hidden) return;
    const u = host.user(),
      owner = !S || S.owner,
      acc = accessOf(share);
    let h = '<h3>' + (S && !S.owner ? 'Live session' : 'Share this project') + '</h3>';
    if (S && !S.owner) {
      h +=
        '<p class="cb-mu">' +
        esc(S.title || 'Shared project') +
        ' · you can <b>' +
        (S.role === 'view' ? 'view and run' : 'edit') +
        '</b> this circuit.</p>';
    } else if (!u) {
      h +=
        '<div class="cb-note">Sign in to share this project. Your projects are saved to your account so others can open them.</div><button class="cb-btn cb-pri cb-full" id="cb-si">Sign in</button>';
    } else {
      h += '<label class="cb-lbl">People with access</label>';
      h +=
        '<div class="cb-ppl">' +
        (S
          ? everyone()
              .map((p) => avatar(p, p.peer, 1))
              .join('')
          : avatar({ name: u.name, slot: 0 }, '', 1)) +
        '</div>';
      if (share && share.invites && share.invites.length) {
        h +=
          '<div class="cb-invite-list">' +
          share.invites
            .map(
              (inv) =>
                '<div class="cb-invite-row"><span class="cb-invite-mail">' +
                esc(inv.email) +
                '<small>Can ' +
                (inv.role === 'edit' ? 'edit' : 'view') +
                ' · account required</small></span><button class="cb-invite-mailbtn" data-mail="' +
                esc(inv.email) +
                '" title="Email invite link">Email</button><button class="cb-invite-remove" data-remove="' +
                esc(inv.email) +
                '" aria-label="Remove ' +
                esc(inv.email) +
                '" title="Remove access">×</button></div>'
            )
            .join('') +
          '</div>';
      }
      h +=
        '<div class="cb-inv"><input id="cb-em" type="email" placeholder="Invite by email" autocomplete="email" /><select id="cb-inv-role" aria-label="Invitation access"><option value="edit">Can edit</option><option value="view">Can view</option></select><button class="cb-btn cb-pri" id="cb-add-invite" ' +
        (ui.busy === 'invite' ? 'disabled' : '') +
        '>Add</button></div>';
      h +=
        '<p class="cb-mu cb-sm">Invitees sign in or sign up using this email address. An invite link is available after adding them.</p>';
      h += '<label class="cb-lbl">Collaboration link</label>';
      h +=
        '<button class="cb-sel" id="cb-acc" ' +
        (ui.busy ? 'disabled' : '') +
        '><span class="cb-i">' +
        ACCESS[acc].icon +
        '</span><span>' +
        ACCESS[acc].title +
        '</span>' +
        ICON.down +
        '</button>';
      if (ui.menu) {
        h +=
          '<div class="cb-menu" id="cb-mn">' +
          ['none', 'view', 'edit']
            .map(
              (k) =>
                '<button data-a="' +
                k +
                '" class="' +
                (k === acc ? 'cb-cur-opt' : '') +
                '"><span class="cb-i">' +
                ACCESS[k].icon +
                '</span><span class="cb-tx"><b>' +
                ACCESS[k].title +
                '</b><small>' +
                ACCESS[k].text +
                '</small></span>' +
                (k === acc ? '<span class="cb-ck">' + ICON.check + '</span>' : '') +
                '</button>'
            )
            .join('') +
          '</div>';
      }
      if (acc !== 'none') {
        h += '<button class="cb-btn cb-pri cb-full" id="cb-copy">Copy link</button>';
        h +=
          '<div class="cb-password"><input id="cb-link-pw" type="password" maxlength="128" placeholder="' +
          (share && share.hasPassword
            ? 'Change password (8+ characters)'
            : 'Add password protection (8+ characters)') +
          '" autocomplete="new-password" /><button class="cb-btn" id="cb-save-pw" ' +
          (ui.busy === 'password' ? 'disabled' : '') +
          '>Save password</button>' +
          (share && share.hasPassword
            ? '<button class="cb-btn cb-clear-pw" id="cb-clear-pw">Remove</button>'
            : '') +
          '</div>' +
          '<p class="cb-mu cb-sm">' +
          (share && share.hasPassword
            ? 'Password protection is on. People need an account and the password to join.'
            : 'Password protection is optional. Protected links require a LogicLab account.') +
          '</p>';
      } else h += '<p class="cb-mu cb-sm">' + ACCESS.none.text + '</p>';
    }
    if (ui.note) h += '<div class="cb-note">' + esc(ui.note) + '</div>';
    if (S) {
      h +=
        '<div class="cb-sep"></div><label class="cb-lbl">In this session</label><div class="cb-list2">' +
        everyone()
          .map(
            (p) =>
              '<div class="cb-person">' +
              avatar(p, p.peer) +
              '<span class="cb-nm">' +
              esc(p.name) +
              '</span><span class="cb-role">' +
              ROLE_TEXT[p.role] +
              '</span>' +
              peerState(p) +
              '</div>'
          )
          .join('') +
        '</div>';
    }
    h += '<div class="cb-sep"></div><div class="cb-rows">';
    if (S) {
      h += row('cb-r-chat', ICON.chat, 'Chat', S.unread ? S.unread + ' new' : '');
      h += row('cb-r-mic', ICON.mic, S.mic ? 'Turn microphone off' : 'Talk (voice chat)', S.mic ? 'On' : '');
    }
    if (u && host.pid() && (!S || canEdit(S.role)))
      h += row('cb-r-hist', ICON.hist, 'Version history', '', 1);
    h += row('cb-r-dl', ICON.dl, 'Download', '', 1);
    if (ui.download)
      h +=
        '<div class="cb-downloads"><button class="cb-rw" data-download="proj">Project file (.logiclab.json)</button><button class="cb-rw" data-download="png">Export PNG image</button><button class="cb-rw" data-download="pdf">Export PDF</button></div>';
    if (S) h += row('cb-r-leave', ICON.more, S.owner ? 'End my live session' : 'Leave session', '');
    if (owner && u && share) h += row('cb-r-more', ICON.more, 'More', '', 1);
    h += '</div>';
    if (ui.more && share)
      h +=
        '<div class="cb-sub"><button id="cb-rst" class="cb-btn cb-full">Reset link (old link stops working)</button><button id="cb-stop" class="cb-btn cb-full cb-dng">Stop sharing</button></div>';
    pop.innerHTML = h;
    wirePopover();
  }
  const row = (id, icon, label, badge, chev) =>
    '<button class="cb-rw" id="' +
    id +
    '"><span class="cb-i">' +
    icon +
    '</span><span class="cb-tx">' +
    label +
    '</span>' +
    (badge ? '<em>' + esc(badge) + '</em>' : '') +
    (chev ? ICON.chev : '') +
    '</button>';
  function peerState(p) {
    if (!S || p.peer === S.peer) return '';
    const c = S.pcs.get(p.peer);
    const st =
      c && c.state === 'open'
        ? ['cb-ok', 'Connected']
        : (S.tries.get(p.peer) || { n: 0 }).n >= 5
          ? ['cb-bad', 'Can’t connect']
          : ['cb-wait', 'Connecting…'];
    return (
      '<i class="cb-dot ' +
      st[0] +
      '" title="' +
      st[1] +
      '"></i>' +
      (c && c.audio
        ? '<button class="cb-mute" data-m="' +
          esc(p.peer) +
          '" title="Mute or unmute this person">' +
          (c.muted ? 'Muted' : 'Audio') +
          '</button>'
        : '')
    );
  }
  function wirePopover() {
    const g = (id) => $('#' + id, pop);
    if (g('cb-si')) g('cb-si').onclick = () => (togglePopover(false), $('#av').click());
    if (g('cb-acc')) g('cb-acc').onclick = () => ((ui.menu = !ui.menu), renderPopover());
    pop.querySelectorAll('#cb-mn [data-a]').forEach((b) => (b.onclick = () => setAccess(b.dataset.a)));
    if (g('cb-copy'))
      g('cb-copy').onclick = async () => {
        const link = linkOf(share);
        try {
          await navigator.clipboard.writeText(link);
        } catch (e) {
          const t = document.createElement('textarea');
          t.value = link;
          document.body.append(t);
          t.select();
          document.execCommand('copy');
          t.remove();
        }
        g('cb-copy').textContent = 'Link copied ✓';
        setTimeout(() => g('cb-copy') && (g('cb-copy').textContent = 'Copy link'), 1800);
      };
    if (g('cb-add-invite')) g('cb-add-invite').onclick = addInvite;
    if (g('cb-em'))
      g('cb-em').onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addInvite();
        }
      };
    pop.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = () => removeInvite(b.dataset.remove)));
    pop.querySelectorAll('[data-mail]').forEach(
      (b) =>
        (b.onclick = () => {
          const email = b.dataset.mail;
          const body =
            'You have been invited to collaborate on a LogicLab project. Sign in or sign up using ' +
            email +
            ', then open this invitation:\n' +
            location.origin +
            '/#invite=' +
            share.id;
          location.href =
            'mailto:' +
            encodeURIComponent(email) +
            '?subject=' +
            encodeURIComponent('LogicLab project invitation') +
            '&body=' +
            encodeURIComponent(body);
        })
    );
    if (g('cb-save-pw'))
      g('cb-save-pw').onclick = () => {
        const value = ($('#cb-link-pw', pop) || {}).value || '';
        if (!/^[\s\S]{8,128}$/.test(value))
          return toast('Use a password between 8 and 128 characters.', 'warn');
        protectLink(value);
      };
    if (g('cb-clear-pw')) g('cb-clear-pw').onclick = () => protectLink('');
    if (g('cb-r-chat')) g('cb-r-chat').onclick = () => (togglePopover(false), toggleChat(true));
    if (g('cb-r-mic')) g('cb-r-mic').onclick = toggleMic;
    if (g('cb-r-hist')) g('cb-r-hist').onclick = () => (togglePopover(false), openHistory());
    if (g('cb-r-dl')) g('cb-r-dl').onclick = () => ((ui.download = !ui.download), renderPopover());
    pop.querySelectorAll('[data-download]').forEach(
      (b) =>
        (b.onclick = () => {
          togglePopover(false);
          host.download(b.dataset.download);
        })
    );
    if (g('cb-r-leave')) g('cb-r-leave').onclick = () => leave();
    if (g('cb-r-more')) g('cb-r-more').onclick = () => ((ui.more = !ui.more), renderPopover());
    if (g('cb-rst')) g('cb-rst').onclick = resetLink;
    if (g('cb-stop')) g('cb-stop').onclick = stopSharing;
    pop.querySelectorAll('[data-m]').forEach(
      (b) =>
        (b.onclick = () => {
          const c = S && S.pcs.get(b.dataset.m);
          if (!c) return;
          c.muted = c.muted ? 0 : 1;
          if (c.audio) c.audio.muted = !!c.muted;
          renderPopover();
        })
    );
  }

  /* ---- chat panel ---- */
  function toggleChat(on) {
    if (!S) return;
    ui.chat = on === undefined ? !ui.chat : on;
    if (ui.chat) S.unread = 0;
    renderChat();
    renderBar();
    if (ui.chat) setTimeout(() => $('#cb-ci') && $('#cb-ci').focus(), 50);
  }
  function renderChat() {
    chatBox.hidden = !(S && ui.chat);
    if (chatBox.hidden) return;
    const log = S.chat
      .map(
        (m) =>
          '<div class="cb-msg' +
          (m.me ? ' cb-me' : '') +
          '"><span class="cb-who" style="color:' +
          COLORS[((S.roster.get(m.from) || { slot: S.slot }).slot || 0) % COLORS.length] +
          '">' +
          (m.me ? 'You' : esc(m.name)) +
          '</span><span class="cb-body">' +
          esc(m.text) +
          '</span></div>'
      )
      .join('');
    const keep = $('#cb-ci', chatBox) ? $('#cb-ci', chatBox).value : '';
    chatBox.innerHTML =
      '<div class="cb-hd"><b>Chat</b><span class="cb-mu">' +
      everyone().length +
      ' here</span><button class="cb-x" id="cb-cx" aria-label="Close chat">×</button></div>' +
      '<div class="cb-log" id="cb-log">' +
      (log ||
        '<div class="cb-mu cb-empty">Messages go straight to the people in this session. They are not stored.</div>') +
      '</div>' +
      '<form class="cb-form" id="cb-cf"><input id="cb-ci" maxlength="600" placeholder="Message everyone…" autocomplete="off" /><button class="cb-send" aria-label="Send">' +
      ICON.send +
      '</button></form>';
    const l = $('#cb-log', chatBox);
    l.scrollTop = l.scrollHeight;
    const inp = $('#cb-ci', chatBox);
    inp.value = keep;
    $('#cb-cx', chatBox).onclick = () => toggleChat(false);
    $('#cb-cf', chatBox).onsubmit = (e) => {
      e.preventDefault();
      const text = inp.value;
      inp.value = '';
      sendChat(text);
      const next = $('#cb-ci', chatBox);
      if (next) {
        next.value = '';
        next.focus();
      }
    };
  }

  /* ---------------------------------------------------------------- start-up */
  window.LogicLabCollab = { session: () => S, leave, openHistory, accessOf, _flush: flushLocalNow };
  const j = parseJoin();
  const invite = parseInvite();
  if (j) {
    if (!window.RTCPeerConnection) toast('This browser cannot join live sessions.', 'error');
    else setTimeout(() => joinDialog(j), 250);
  } else if (invite) {
    setTimeout(() => openInvitation(invite), 250);
  }
  addEventListener('hashchange', () => {
    const x = parseJoin();
    if (x && !S) joinDialog(x);
    const i = parseInvite();
    if (i && !S) openInvitation(i);
  });
})();
