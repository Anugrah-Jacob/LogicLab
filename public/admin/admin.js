/**
 * LogicLab admin panel. One script, no framework.
 * Pages: dashboard, users, circuits, ai (usage), settings (AI provider, sign-ups), system.
 * Everything talks to /api/admin/* and needs a signed-in administrator.
 */
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const num = (n) => Number(n || 0).toLocaleString();

  /* ---------- icons (stroke paths, 24x24) ---------- */
  const ICON = {
    home: 'M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    users:
      'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    cpu: 'M6 6h12v12H6zM9 9h6v6H9zM9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4',
    spark: 'M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z',
    gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3.3 7.5L12 12.5l8.7-5M12 22V12.5',
    clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    plus: 'M12 5v14M5 12h14',
    menu: 'M4 6h16M4 12h16M4 18h16',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'
  };
  const ic = (name) =>
    '<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[name] + '"/></svg>';

  /* ---------- state and helpers ---------- */
  const state = {
    me: null,
    claim: null,
    page: 'dashboard',
    users: { q: '', offset: 0 },
    circuits: { q: '', offset: 0 }
  };
  const PAGES = {
    dashboard: ['Dashboard', 'Manage the LogicLab platform', 'home'],
    users: ['Users', 'Accounts, roles and AI limits', 'users'],
    circuits: ['Circuits', 'Projects your users have synced', 'cpu'],
    ai: ['AI usage', 'Requests per day and top users', 'spark'],
    settings: ['Settings', 'AI provider, sign-ups and limits', 'gear'],
    system: ['System', 'Health and configuration checks', 'server']
  };

  async function api(path, options = {}) {
    const res = await fetch('/api' + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'Server error (' + res.status + ')');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = 'ts ' + type;
    el.textContent = message;
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4000);
  }

  const rel = (t) => {
    if (!t) return 'never';
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hours ago';
    return Math.floor(s / 86400) + ' days ago';
  };
  const initials = (name) =>
    String(name || '?')
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  const exampleTitle = (id) => {
    const ex = (window.LOGICLAB_EXAMPLES || []).find((e) => e.id === id);
    return ex ? ex.title : id;
  };
  const debounce = (fn, ms) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };

  /** Show a modal with a form. onSubmit gets the form element; throw an Error to show a message and keep it open. */
  function modal(title, bodyHtml, { submit = 'Save', danger = false, onSubmit }) {
    const el = document.createElement('div');
    el.className = 'mo';
    el.innerHTML =
      '<form class="mc"><h3>' +
      esc(title) +
      '</h3>' +
      bodyHtml +
      '<div class="alert bad" hidden></div><div class="row"><button type="button" class="btn" data-x>Cancel</button><button class="btn ' +
      (danger ? 'danger' : 'pr') +
      '">' +
      esc(submit) +
      '</button></div></form>';
    const close = () => el.remove();
    el.addEventListener('click', (e) => {
      if (e.target === el || e.target.dataset.x !== undefined) close();
    });
    el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = el.querySelector('button.btn:last-child');
      btn.disabled = true;
      try {
        await onSubmit(e.target);
        close();
      } catch (err) {
        const box = el.querySelector('.alert');
        box.textContent = err.message;
        box.hidden = false;
        btn.disabled = false;
      }
    });
    document.body.append(el);
    const first = el.querySelector('input,select');
    if (first) first.focus();
  }

  /* ---------- charts (SVG) ---------- */
  function niceMax(m) {
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(m, 1))));
    return [1, 2, 4, 5, 10].map((k) => k * p).find((v) => v >= m) || m;
  }
  function lineChart(days, series) {
    const W = 640,
      H = 250,
      L = 44,
      R = 12,
      T = 10,
      B = 28;
    const max = niceMax(Math.max(1, ...series.flatMap((s) => s.data)));
    const x = (i) => L + ((W - L - R) * i) / (days.length - 1);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    let out =
      '<svg class="chart" viewBox="0 0 ' +
      W +
      ' ' +
      H +
      '" role="img" aria-label="Chart of the last 30 days">';
    for (let g = 0; g <= 4; g++) {
      const v = (max * g) / 4,
        yy = y(v);
      out +=
        '<line x1="' +
        L +
        '" x2="' +
        (W - R) +
        '" y1="' +
        yy +
        '" y2="' +
        yy +
        '" stroke="#ece8fb"/><text x="' +
        (L - 8) +
        '" y="' +
        (yy + 4) +
        '" text-anchor="end" font-size="11" fill="#6b6893">' +
        Math.round(v) +
        '</text>';
    }
    days.forEach((d, i) => {
      if (i % 5 === 0 || i === days.length - 1)
        out +=
          '<text x="' +
          x(i) +
          '" y="' +
          (H - 8) +
          '" text-anchor="middle" font-size="11" fill="#6b6893">' +
          d.slice(5) +
          '</text>';
    });
    series.forEach((s) => {
      const pts = s.data.map((v, i) => x(i) + ',' + y(v)).join(' L');
      if (s.area)
        out +=
          '<path d="M' +
          x(0) +
          ',' +
          y(0) +
          ' L' +
          pts +
          ' L' +
          x(days.length - 1) +
          ',' +
          y(0) +
          'Z" fill="' +
          s.color +
          '" opacity=".14"/>';
      out +=
        '<path d="M' +
        pts +
        '" fill="none" stroke="' +
        s.color +
        '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
    });
    return out + '</svg>';
  }
  const legend = (series) =>
    '<div class="legend">' +
    series.map((s) => '<span><i style="background:' + s.color + '"></i>' + esc(s.name) + '</span>').join('') +
    '</div>';

  function donut(items) {
    const total = items.reduce((s, i) => s + i.value, 0) || 1;
    const R = 70,
      C = 2 * Math.PI * R;
    let offset = 0,
      arcs = '';
    items.forEach((it) => {
      const len = (it.value / total) * C;
      arcs +=
        '<circle r="' +
        R +
        '" cx="100" cy="100" fill="none" stroke="' +
        it.color +
        '" stroke-width="30" stroke-dasharray="' +
        len +
        ' ' +
        (C - len) +
        '" stroke-dashoffset="' +
        -offset +
        '" transform="rotate(-90 100 100)"/>';
      offset += len;
    });
    const count = items.reduce((s, i) => s + i.value, 0);
    return (
      '<div class="donutwrap"><svg viewBox="0 0 200 200" width="190" role="img" aria-label="User distribution"><circle r="' +
      R +
      '" cx="100" cy="100" fill="none" stroke="#eee9fb" stroke-width="30"/>' +
      arcs +
      '<text x="100" y="104" text-anchor="middle" font-size="26" font-weight="700" fill="#19153f">' +
      num(count) +
      '</text><text x="100" y="124" text-anchor="middle" font-size="12" fill="#6b6893">Users</text></svg><ul>' +
      items
        .map(
          (i) =>
            '<li><i style="background:' +
            i.color +
            '"></i>' +
            esc(i.label) +
            '<b>' +
            num(i.value) +
            '</b></li>'
        )
        .join('') +
      '</ul></div>'
    );
  }

  /* ---------- views before sign-in ---------- */
  const BRAND_DARK =
    '<a class="brand" href="/"><img src="/logo-mark.svg" alt="" /><div><b>LogicLab</b><small>Admin Panel</small></div></a>';

  function loginView() {
    $('#root').innerHTML =
      '<div class="center"><form class="mc" id="lf">' +
      BRAND_DARK +
      '<h3 style="text-align:center">Sign in to the admin panel</h3>' +
      '<label class="f">Email<input class="in" type="email" name="email" autocomplete="email" required></label>' +
      '<label class="f">Password<input class="in" type="password" name="password" autocomplete="current-password" required></label>' +
      '<div class="alert bad" hidden></div><button class="btn pr" style="width:100%">Sign in</button>' +
      '<p class="muted" style="text-align:center;margin-bottom:0"><a href="/">Back to LogicLab</a></p></form></div>';
    $('#lf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await api('/auth/login', {
          method: 'POST',
          body: { email: f.email.value, password: f.password.value }
        });
        await boot();
      } catch (err) {
        const box = $('.alert', e.target);
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  }

  function gateView() {
    const open = state.claim && state.claim.open;
    $('#root').innerHTML =
      '<div class="center"><form class="mc" id="cf">' +
      BRAND_DARK +
      (open
        ? '<h3 style="text-align:center">Become the administrator</h3><p class="muted">No administrator exists yet. Enter the setup code you saved as the <code>ADMIN_SETUP_CODE</code> secret.</p>' +
          (state.claim.codeSet
            ? ''
            : '<div class="alert bad">ADMIN_SETUP_CODE is not set on the server yet. Add it in Cloudflare and redeploy.</div>') +
          '<label class="f">Setup code<input class="in" type="password" name="code" autocomplete="off" required></label><div class="alert bad" id="cerr" hidden></div><button class="btn pr" style="width:100%">Claim administrator</button>'
        : '<h3 style="text-align:center">Administrators only</h3><p class="muted">You are signed in as ' +
          esc(state.me.email) +
          ', which is not an administrator. Ask an administrator to promote your account.</p>') +
      '<p class="muted" style="text-align:center;margin-bottom:0"><a href="/">Back to LogicLab</a> · <a href="#" id="lo">Sign out</a></p></form></div>';
    $('#lo').addEventListener('click', async (e) => {
      e.preventDefault();
      await logout();
    });
    const form = $('#cf');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!open) return;
      try {
        await api('/admin/claim', { method: 'POST', body: { code: form.elements.code.value } });
        toast('You are now the administrator.', 'success');
        await boot();
      } catch (err) {
        const box = $('#cerr');
        box.textContent = err.message;
        box.hidden = false;
      }
    });
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.me = null;
    render();
  }

  /* ---------- shell ---------- */
  function shell() {
    const nav = Object.entries(PAGES)
      .map(
        ([id, p]) =>
          '<a href="#/' +
          id +
          '" data-page="' +
          id +
          '">' +
          ic(p[2]) +
          '<span class="lbl">' +
          p[0] +
          '</span>' +
          (id === 'system' ? '<span class="badge-ok lbl" id="syshealth">…</span>' : '') +
          '</a>'
      )
      .join('');
    $('#root').innerHTML =
      '<div class="shell' +
      (localStorage.getItem('ll:admin:collapsed') === '1' ? ' collapsed' : '') +
      '" id="shell">' +
      '<aside class="sb"><a class="brand" href="/admin/"><img src="/logo-mark-light.svg" alt="" /><div><b>LogicLab</b><small>Admin Panel</small></div></a>' +
      '<nav class="nav">' +
      nav +
      '<div class="grow"></div></nav>' +
      '<div class="usercard" id="uc"><div class="avatar">' +
      esc(initials(state.me.name)) +
      '</div><div style="min-width:0"><div class="nm">' +
      esc(state.me.name) +
      '</div><small>Administrator</small></div>' +
      '<div class="usermenu" id="um"><a href="/">Open LogicLab</a><button id="lo2">Sign out</button></div></div></aside>' +
      '<div class="main"><header class="top"><button class="iconbtn" id="menu" aria-label="Toggle menu">' +
      ic('menu') +
      '</button><div><h1 id="pt"></h1><p id="ps"></p></div><div class="grow"></div>' +
      '<label class="search">' +
      ic('search') +
      '<input id="gq" type="search" placeholder="Search users and circuits…" aria-label="Search"></label><div class="avatar" title="' +
      esc(state.me.email) +
      '">' +
      esc(initials(state.me.name)) +
      '</div></header>' +
      '<main id="pg"></main></div></div>';
    $('#menu').addEventListener('click', () => {
      const s = $('#shell');
      if (matchMedia('(max-width:860px)').matches) s.classList.toggle('open-nav');
      else {
        s.classList.toggle('collapsed');
        localStorage.setItem('ll:admin:collapsed', s.classList.contains('collapsed') ? '1' : '0');
      }
    });
    $('#uc').addEventListener('click', (e) => {
      if (!e.target.closest('.usermenu')) $('#um').classList.toggle('open');
    });
    $('#lo2').addEventListener('click', logout);
    $('.nav').addEventListener('click', () => $('#shell').classList.remove('open-nav'));
    $('#gq').addEventListener(
      'input',
      debounce((e) => {
        const q = e.target.value.trim();
        if (state.page === 'users' || state.page === 'circuits') {
          state[state.page] = { q, offset: 0 };
          route();
        }
      }, 300)
    );
    $('#pg').addEventListener('click', onPageClick);
    api('/admin/health')
      .then((h) => {
        const el = $('#syshealth');
        const good = h.db && h.migrated;
        el.textContent = good ? 'Healthy' : 'Check';
        el.classList.toggle('badge-bad', !good);
      })
      .catch(() => {});
  }

  /* ---------- routing ---------- */
  async function route() {
    state.page = location.hash.replace('#/', '') || 'dashboard';
    if (!PAGES[state.page]) state.page = 'dashboard';
    document
      .querySelectorAll('.nav a')
      .forEach((a) => a.classList.toggle('on', a.dataset.page === state.page));
    $('#pt').textContent = PAGES[state.page][0];
    $('#ps').textContent = PAGES[state.page][1];
    $('#gq').value = (state[state.page] && state[state.page].q) || '';
    const pg = $('#pg');
    pg.innerHTML = '<p class="muted">Loading…</p>';
    try {
      pg.innerHTML = await VIEWS[state.page]();
      if (AFTER[state.page]) AFTER[state.page]();
    } catch (err) {
      pg.innerHTML = '<div class="alert bad">' + esc(err.message) + '</div>';
    }
  }

  /* ---------- pages ---------- */
  const VIEWS = {
    async dashboard() {
      const [s, a, h] = await Promise.all([
        api('/admin/stats'),
        api('/admin/activity?limit=6'),
        api('/admin/health')
      ]);
      const t = s.totals;
      const series = [
        { name: 'New users', color: '#2563eb', data: s.series.signups, area: true },
        { name: 'Circuits created', color: '#60a5fa', data: s.series.projects },
        { name: 'AI requests', color: '#bfdbfe', data: s.series.ai }
      ];
      const card = (icon, value, label, extra) =>
        '<div class="card stat"><div class="ic">' +
        ic(icon) +
        '</div><div><b>' +
        num(value) +
        '</b><span>' +
        label +
        '</span></div><em>' +
        extra +
        '</em></div>';
      const ai =
        h.ai && !h.ai.enabled
          ? ['warn', 'Switched off']
          : h.ai && h.ai.configured
            ? ['', 'Configured']
            : ['warn', 'Not set up'];
      const status = [
        ['', 'Web application', 'Online'],
        [h.db ? '' : 'bad', 'Database', h.db ? 'Online' : 'Offline'],
        [h.migrated ? '' : 'bad', 'Database migrations', h.migrated ? 'Up to date' : 'Run migrations'],
        [ai[0], 'AI provider' + (h.ai && h.ai.configured ? ' (' + esc(h.ai.provider) + ')' : ''), ai[1]]
      ];
      const events = a.events.length
        ? a.events
            .map(
              (e) =>
                '<li><span class="ic">' +
                ic(e.kind === 'user' ? 'users' : 'box') +
                '</span><div><b>' +
                esc(e.title) +
                '</b><small>' +
                esc(e.detail) +
                '</small></div><span class="tm">' +
                rel(e.t) +
                '</span></li>'
            )
            .join('')
        : '<li class="muted">Nothing yet.</li>';
      const pop = s.templates.length
        ? s.templates
            .map(
              (p) =>
                '<li><img src="/thumbs/' +
                esc(p.id) +
                '.jpg" alt="" loading="lazy"><div><b>' +
                esc(exampleTitle(p.id)) +
                '</b><small>' +
                num(p.n) +
                ' projects</small></div><div class="bar"><i style="width:' +
                p.pct +
                '%"></i></div><b style="width:42px;text-align:right">' +
                p.pct +
                '%</b></li>'
            )
            .join('')
        : '<li class="muted">No projects have been started from a template yet.</li>';
      const d = s.distribution;
      return (
        '<div class="g4">' +
        card('users', t.users, 'Total users', '+' + num(t.newUsers30) + '<br>last 30 days') +
        card(
          'box',
          t.projects,
          'Circuits created',
          num(s.series.projects.reduce((a, b) => a + b, 0)) + '<br>last 30 days'
        ) +
        card('spark', t.aiTotal, 'AI requests', num(t.ai30) + '<br>last 30 days') +
        card('chart', (window.LOGICLAB_EXAMPLES || []).length, 'Example circuits', 'built in') +
        '</div>' +
        '<div class="g3"><div class="card"><h2>' +
        ic('chart') +
        'Usage overview<a href="#/ai">AI usage</a></h2>' +
        legend(series) +
        lineChart(s.days, series) +
        '</div>' +
        '<div class="card"><h2>' +
        ic('server') +
        'System status</h2><ul class="list status">' +
        status
          .map(
            (r) =>
              '<li><span class="dot ' +
              r[0] +
              '">' +
              (r[0] ? '!' : '✓') +
              '</span>' +
              r[1] +
              '<span class="pill ' +
              r[0] +
              '">' +
              r[2] +
              '</span></li>'
          )
          .join('') +
        '</ul><p class="muted" style="margin:10px 0 0">Database answered in ' +
        h.dbMs +
        ' ms</p></div>' +
        '<div class="card"><h2>' +
        ic('bolt') +
        'Quick actions</h2><div class="qa"><button class="btn pr" data-act="adduser">' +
        ic('plus') +
        'Add user</button><a class="btn soft" href="#/users">' +
        ic('users') +
        'Manage users</a><a class="btn soft" href="#/settings">' +
        ic('spark') +
        'AI provider settings</a><a class="btn soft" href="/">' +
        ic('cpu') +
        'Open LogicLab</a></div></div></div>' +
        '<div class="g3b"><div class="card"><h2>' +
        ic('clock') +
        'Recent activity</h2><ul class="list">' +
        events +
        '</ul></div>' +
        '<div class="card"><h2>' +
        ic('chart') +
        'Popular templates</h2><ul class="list pop">' +
        pop +
        '</ul></div>' +
        '<div class="card"><h2>' +
        ic('users') +
        'User distribution</h2>' +
        donut([
          { label: 'Users', value: d.users, color: '#2563eb' },
          { label: 'Administrators', value: d.admins, color: '#60a5fa' },
          { label: 'Disabled', value: d.disabled, color: '#d8c8ff' }
        ]) +
        '</div></div>'
      );
    },

    async users() {
      const u = state.users,
        limit = 25;
      const r = await api(
        '/admin/users?limit=' + limit + '&offset=' + u.offset + '&q=' + encodeURIComponent(u.q)
      );
      const rows = r.users
        .map(
          (x) =>
            '<tr><td><div class="who"><div class="avatar">' +
            esc(initials(x.name)) +
            '</div><div><b>' +
            esc(x.name) +
            '</b><small>' +
            esc(x.email) +
            '</small></div></div></td>' +
            '<td><span class="pill ' +
            (x.role === 'admin' ? 'purple' : 'gray') +
            '">' +
            esc(x.role) +
            '</span></td>' +
            '<td>' +
            (x.disabled ? '<span class="pill bad">Disabled</span>' : '<span class="pill">Active</span>') +
            '</td>' +
            '<td>' +
            num(x.projects) +
            '</td><td>' +
            num(x.ai_today) +
            ' / ' +
            num(x.ai_total) +
            (x.ai_limit != null ? '<small class="muted"> (limit ' + x.ai_limit + ')</small>' : '') +
            '</td>' +
            '<td>' +
            rel(x.created) +
            '</td><td>' +
            rel(x.last_login) +
            '</td>' +
            '<td><div class="acts"><button class="btn sm" data-act="edit" data-id="' +
            x.id +
            '">Edit</button><button class="btn sm" data-act="pw" data-id="' +
            x.id +
            '">Password</button>' +
            '<button class="btn sm" data-act="toggle" data-id="' +
            x.id +
            '" data-disabled="' +
            (x.disabled ? 1 : 0) +
            '">' +
            (x.disabled ? 'Enable' : 'Disable') +
            '</button><button class="btn sm danger" data-act="del" data-id="' +
            x.id +
            '" data-name="' +
            esc(x.email) +
            '">Delete</button></div></td></tr>'
        )
        .join('');
      VIEWS._users = Object.fromEntries(r.users.map((x) => [x.id, x]));
      return (
        '<div class="toolbar"><div class="grow muted">' +
        num(r.total) +
        ' user' +
        (r.total === 1 ? '' : 's') +
        (u.q ? ' matching “' + esc(u.q) + '”' : '') +
        '</div><button class="btn pr" data-act="adduser">' +
        ic('plus') +
        'Add user</button></div>' +
        '<div class="card"><div class="tablewrap"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Circuits</th><th>AI today / total</th><th>Joined</th><th>Last seen</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="8" class="muted">No users found.</td></tr>') +
        '</tbody></table></div>' +
        pager(u.offset, limit, r.total) +
        '</div>'
      );
    },

    async circuits() {
      const c = state.circuits,
        limit = 25;
      const r = await api(
        '/admin/projects?limit=' + limit + '&offset=' + c.offset + '&q=' + encodeURIComponent(c.q)
      );
      const rows = r.projects
        .map(
          (p) =>
            '<tr><td><b>' +
            esc(p.name) +
            '</b></td><td><div class="who"><div class="avatar">' +
            esc(initials(p.owner)) +
            '</div><div>' +
            esc(p.owner) +
            '<small>' +
            esc(p.email) +
            '</small></div></div></td>' +
            '<td><span class="pill purple">' +
            esc(p.type || 'Circuit') +
            '</span></td><td>' +
            num(p.count) +
            '</td><td>' +
            (p.tpl ? esc(exampleTitle(p.tpl)) : '<span class="muted">from scratch</span>') +
            '</td><td>' +
            rel(p.updated) +
            '</td>' +
            '<td><div class="acts"><button class="btn sm danger" data-act="delproj" data-uid="' +
            esc(p.uid) +
            '" data-id="' +
            esc(p.id) +
            '" data-name="' +
            esc(p.name) +
            '">Delete</button></div></td></tr>'
        )
        .join('');
      return (
        '<div class="toolbar"><div class="grow muted">' +
        num(r.total) +
        ' circuit' +
        (r.total === 1 ? '' : 's') +
        '</div></div><div class="card"><div class="tablewrap"><table class="t"><thead><tr><th>Name</th><th>Owner</th><th>Type</th><th>Parts</th><th>Started from</th><th>Updated</th><th></th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="7" class="muted">No circuits have been synced yet.</td></tr>') +
        '</tbody></table></div>' +
        pager(c.offset, limit, r.total) +
        '</div>'
      );
    },

    async ai() {
      const [s, st] = await Promise.all([api('/admin/stats'), api('/admin/settings')]);
      const series = [{ name: 'AI requests per day', color: '#2563eb', data: s.series.ai, area: true }];
      const top = s.topAi.length
        ? s.topAi
            .map(
              (u) =>
                '<li><div class="avatar">' +
                esc(initials(u.name)) +
                '</div><div><b>' +
                esc(u.name) +
                '</b><small>' +
                esc(u.email) +
                '</small></div><b style="margin-left:auto">' +
                num(u.n) +
                '</b></li>'
            )
            .join('')
        : '<li class="muted">No AI requests in the last 30 days.</li>';
      return (
        '<div class="g4"><div class="card stat"><div class="ic">' +
        ic('spark') +
        '</div><div><b>' +
        num(s.totals.aiTotal) +
        '</b><span>AI requests, all time</span></div></div>' +
        '<div class="card stat"><div class="ic">' +
        ic('chart') +
        '</div><div><b>' +
        num(s.totals.ai30) +
        '</b><span>Last 30 days</span></div></div>' +
        '<div class="card stat"><div class="ic">' +
        ic('users') +
        '</div><div><b>' +
        num(s.topAi.length) +
        '</b><span>Top users shown</span></div></div>' +
        '<div class="card stat"><div class="ic">' +
        ic('gear') +
        '</div><div><b>' +
        num(st.dailyLimit) +
        '</b><span>Daily limit per user</span></div></div></div>' +
        '<div class="g2"><div class="card"><h2>' +
        ic('chart') +
        'Requests per day</h2>' +
        legend(series) +
        lineChart(s.days, series) +
        '</div><div class="card"><h2>' +
        ic('users') +
        'Top users (30 days)</h2><ul class="list">' +
        top +
        '</ul><p class="muted">Limits can be changed per user on the Users page and for everyone under Settings.</p></div></div>'
      );
    },

    async settings() {
      const s = await api('/admin/settings');
      VIEWS._providers = s.providers;
      const p = s.providers[s.provider];
      const opts = Object.entries(s.providers)
        .map(
          ([id, v]) =>
            '<option value="' +
            id +
            '"' +
            (id === s.provider ? ' selected' : '') +
            '>' +
            esc(v.label) +
            '</option>'
        )
        .join('');
      const fallbackOptions = (selected, primary) =>
        '<option value="">No second provider</option>' +
        Object.entries(s.providers)
          .filter(([id]) => id !== primary)
          .map(
            ([id, provider]) =>
              '<option value="' +
              esc(id) +
              '"' +
              (id === selected ? ' selected' : '') +
              '>' +
              esc(provider.label) +
              '</option>'
          )
          .join('');
      const providerKeyInput = (provider, name, placeholder) => {
        const keyInfo = provider && s.providers[provider];
        const hint = keyInfo?.hasKey
          ? 'Saved (' + esc(keyInfo.keyHint) + '). Type a new key to replace it.'
          : keyInfo?.keyHint
            ? 'Configured (' + esc(keyInfo.keyHint) + ')'
            : placeholder;
        const input =
          '<input class="in" type="password" name="' +
          name +
          '"' +
          (provider ? ' data-provider-key="' + esc(provider) + '"' : '') +
          ' autocomplete="new-password" placeholder="' +
          hint +
          '">';
        return (
          input +
          (keyInfo?.hasKey
            ? '<button type="button" class="btn danger sm" data-act="clearProviderKey" data-id="' +
              esc(provider) +
              '"' +
              (name === 'apiKey' ? ' data-primary-key-remove' : '') +
              '>Remove saved key</button>'
            : '')
        );
      };
      return (
        '<div class="g2"><form class="card" id="aiform"><h2>' +
        ic('spark') +
        'AI provider</h2>' +
        '<label class="f">Provider<select class="in" name="provider">' +
        opts +
        '</select></label>' +
        '<label class="f">Model<input class="in" name="model" value="' +
        esc(s.model) +
        '" list="models" autocomplete="off" placeholder="model name"><datalist id="models">' +
        p.models.map((m) => '<option value="' + esc(m) + '">').join('') +
        '</datalist><small id="modelhint"></small></label>' +
        '<label class="f">API key' +
        providerKeyInput(s.provider, 'apiKey', 'Paste ' + p.label + ' API key') +
        '<small>The key is encrypted and never shown again.</small></label>' +
        '<div class="fallback-provider"><h3>Fallback providers</h3><p class="muted">If the primary provider is rate-limited or unavailable, LogicLab tries these providers in order.</p>' +
        '<label class="f">2nd provider<select class="in" name="fallbackProvider">' +
        fallbackOptions(s.fallbackProvider, s.provider) +
        '</select></label>' +
        '<label class="f">2nd provider model<input class="in" name="fallbackModel" value="' +
        esc(s.fallbackModel || '') +
        '" autocomplete="off" placeholder="Uses provider default if empty"><small>Choose the model used when the primary provider is unavailable.</small></label>' +
        '<label class="f">2nd provider API key' +
        providerKeyInput(s.fallbackProvider, 'fallbackApiKey', 'Choose a second provider first') +
        '</label></div>' +
        '<label class="f">Daily AI requests per user<input class="in" type="number" min="1" name="dailyLimit" value="' +
        s.dailyLimit +
        '"></label>' +
        '<label class="sw"><input type="checkbox" name="aiEnabled"' +
        (s.aiEnabled ? ' checked' : '') +
        '>LogicLab AI is switched on</label>' +
        '<div id="aimsg"></div><div class="acts" style="justify-content:flex-start"><button class="btn pr">Save</button><button type="button" class="btn soft" data-act="testai">Test connection</button>' +
        '</div></form>' +
        '<div><form class="card" id="platform"><h2>' +
        ic('users') +
        'Accounts</h2><label class="sw"><input type="checkbox" name="signupsOpen"' +
        (s.signupsOpen ? ' checked' : '') +
        '>Anyone can create an account</label><p class="muted">When off, only administrators can add users (Users page, “Add user”). Existing users can still sign in.</p><button class="btn pr">Save</button></form>' +
        '<div class="card" style="margin-top:16px"><h2>' +
        ic('gear') +
        'Good to know</h2><ul class="muted" style="padding-left:18px;margin:0"><li>LogicLab AI builds circuits by calling tools, so pick a model that supports <b>tool / function calling</b>.</li><li>Model names change over time. Check your provider’s model list if the test fails with “model not found”.</li><li>Changing providers keeps every user’s chat working; no data needs to be migrated.</li></ul></div></div></div>'
      );
    },

    async system() {
      const h = await api('/admin/health');
      const row = (label, ok, text) =>
        '<tr><td>' +
        label +
        '</td><td><span class="pill ' +
        (ok ? '' : 'bad') +
        '">' +
        (ok ? 'OK' : 'Problem') +
        '</span></td><td class="muted">' +
        text +
        '</td></tr>';
      return (
        '<div class="card"><h2>' +
        ic('server') +
        'Health checks</h2><div class="tablewrap"><table class="t" style="min-width:520px"><tbody>' +
        row('Database connection', h.db, 'Answered in ' + h.dbMs + ' ms') +
        row(
          'Database migrations',
          h.migrated,
          h.migrated
            ? 'All tables and columns are present'
            : 'Run: npx wrangler d1 migrations apply logiclab --remote'
        ) +
        row(
          'Live collaboration tables',
          h.collab,
          h.collab
            ? 'Share links, signalling and history are ready'
            : 'Run: npx wrangler d1 migrations apply logiclab --remote'
        ) +
        (h.mongo
          ? row(
              'MongoDB (project storage)',
              h.mongo.ok,
              h.mongo.ok ? 'Answered in ' + h.mongo.ms + ' ms' : 'Not reachable: ' + esc(h.mongo.error || '')
            )
          : '') +
        row(
          'JWT_SECRET',
          h.env.jwtSecret,
          h.env.jwtSecret
            ? 'Set (32+ characters recommended)'
            : 'Missing or shorter than 16 characters. Sessions and the stored AI key depend on it'
        ) +
        row(
          'ADMIN_SETUP_CODE',
          h.env.adminSetupCode,
          h.env.adminSetupCode
            ? 'Set. It only works while no administrator exists'
            : 'Not set. Only needed to create the first administrator'
        ) +
        row(
          'AI provider',
          !!(h.ai && h.ai.configured),
          h.ai
            ? h.ai.configured
              ? esc(h.ai.provider) + ' · ' + esc(h.ai.model)
              : 'No key saved yet, see Settings'
            : 'Unknown'
        ) +
        '</tbody></table></div><p class="muted">Checked ' +
        esc(h.time) +
        '</p></div>'
      );
    }
  };

  /** Run after a page is drawn (forms need listeners). */
  const AFTER = {
    settings() {
      const form = $('#aiform');
      const fallbackOptions = (selected, primary) =>
        '<option value="">No second provider</option>' +
        Object.entries(VIEWS._providers)
          .filter(([id]) => id !== primary)
          .map(
            ([id, provider]) =>
              '<option value="' +
              esc(id) +
              '"' +
              (id === selected ? ' selected' : '') +
              '>' +
              esc(provider.label) +
              '</option>'
          )
          .join('');
      form.elements.provider.addEventListener('change', async () => {
        const selectedProvider = form.elements.provider.value;
        const p = VIEWS._providers[selectedProvider];
        const previousFallback = form.elements.fallbackProvider.value;
        form.elements.fallbackProvider.innerHTML = fallbackOptions(previousFallback, selectedProvider);
        if (form.elements.fallbackProvider.value !== previousFallback) {
          form.elements.fallbackApiKey.value = '';
          const fallback = form.elements.fallbackProvider.value;
          form.elements.fallbackModel.value = fallback ? VIEWS._providers[fallback].model : '';
        }
        form.elements.apiKey.dataset.providerKey = selectedProvider;
        form.elements.apiKey.placeholder = p.hasKey
          ? 'Saved (' + p.keyHint + '). Type a new key to replace it.'
          : p.keyHint
            ? 'Configured (' + p.keyHint + ')'
            : 'Paste ' + p.label + ' API key';
        const primaryRemove = form.querySelector('[data-primary-key-remove]');
        if (primaryRemove) {
          primaryRemove.dataset.id = selectedProvider;
          primaryRemove.hidden = !p.hasKey;
        }
        form.elements.fallbackApiKey.dataset.providerKey = form.elements.fallbackProvider.value;
        form.elements.fallbackApiKey.placeholder = form.elements.fallbackProvider.value
          ? 'Paste ' + VIEWS._providers[form.elements.fallbackProvider.value].label + ' API key'
          : 'Choose a second provider first';
        form.elements.model.value = p.model;
        $('#models').innerHTML = p.models.map((m) => '<option value="' + esc(m) + '">').join('');
      });
      form.elements.fallbackProvider.addEventListener('change', () => {
        const provider = form.elements.fallbackProvider.value;
        if (form.elements.fallbackApiKey.dataset.providerKey !== provider)
          form.elements.fallbackApiKey.value = '';
        form.elements.fallbackApiKey.dataset.providerKey = provider;
        form.elements.fallbackApiKey.placeholder = provider
          ? 'Paste ' + VIEWS._providers[provider].label + ' API key'
          : 'Choose a second provider first';
        form.elements.fallbackModel.value = provider ? VIEWS._providers[provider].model : '';
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const f = form.elements;
        const body = {
          provider: f.provider.value,
          model: f.model.value,
          dailyLimit: Number(f.dailyLimit.value),
          aiEnabled: f.aiEnabled.checked
        };
        body.fallbackProvider = f.fallbackProvider.value;
        body.fallbackModel = f.fallbackModel.value;
        body.providerKeys = {};
        form.querySelectorAll('[data-provider-key]').forEach((input) => {
          if (input.dataset.providerKey && input.value.trim())
            body.providerKeys[input.dataset.providerKey] = input.value.trim();
        });
        try {
          await api('/admin/settings', { method: 'PUT', body });
          toast('AI settings saved.', 'success');
          route();
        } catch (err) {
          $('#aimsg').innerHTML = '<div class="alert bad">' + esc(err.message) + '</div>';
        }
      });
      $('#platform').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api('/admin/settings', {
            method: 'PUT',
            body: { signupsOpen: e.target.elements.signupsOpen.checked }
          });
          toast('Saved.', 'success');
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
  };

  function pager(offset, limit, total) {
    if (total <= limit) return '';
    return (
      '<div class="pager"><span>' +
      (offset + 1) +
      '–' +
      Math.min(total, offset + limit) +
      ' of ' +
      num(total) +
      '</span><button class="btn sm" data-act="prev"' +
      (offset ? '' : ' disabled') +
      '>Previous</button><button class="btn sm" data-act="next"' +
      (offset + limit < total ? '' : ' disabled') +
      '>Next</button></div>'
    );
  }

  /* ---------- actions (event delegation) ---------- */
  function userForm(u) {
    const v = u || { name: '', email: '', role: 'user', ai_limit: null, disabled: 0 };
    return (
      '<label class="f">Name<input class="in" name="name" value="' +
      esc(v.name) +
      '" maxlength="60"></label>' +
      (u
        ? ''
        : '<label class="f">Email<input class="in" type="email" name="email" required></label><label class="f">Password<input class="in" type="password" name="password" minlength="8" autocomplete="new-password" required><small>At least 8 characters. Share it with the user; they can use it to sign in.</small></label>') +
      '<label class="f">Role<select class="in" name="role"><option value="user"' +
      (v.role === 'user' ? ' selected' : '') +
      '>User</option><option value="admin"' +
      (v.role === 'admin' ? ' selected' : '') +
      '>Administrator</option></select></label>' +
      (u
        ? '<label class="f">AI requests per day<input class="in" type="number" min="0" name="ai_limit" value="' +
          (v.ai_limit == null ? '' : v.ai_limit) +
          '" placeholder="Platform default"><small>Leave empty for the platform default.</small></label>'
        : '')
    );
  }

  async function onPageClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act,
      id = b.dataset.id;
    const after = () => route();
    if (act === 'prev' || act === 'next') {
      const s = state[state.page];
      s.offset = Math.max(0, s.offset + (act === 'next' ? 25 : -25));
      return route();
    }
    if (act === 'adduser') {
      return modal('Add user', userForm(null), {
        submit: 'Create user',
        onSubmit: async (f) => {
          const x = f.elements;
          await api('/admin/users', {
            method: 'POST',
            body: { name: x.name.value, email: x.email.value, password: x.password.value, role: x.role.value }
          });
          toast('User created.', 'success');
          after();
        }
      });
    }
    if (act === 'edit') {
      const u = VIEWS._users[id];
      return modal('Edit ' + u.email, userForm(u), {
        onSubmit: async (f) => {
          const x = f.elements;
          await api('/admin/users/' + id, {
            method: 'PATCH',
            body: {
              name: x.name.value,
              role: x.role.value,
              ai_limit: x.ai_limit.value === '' ? null : Number(x.ai_limit.value)
            }
          });
          toast('Saved.', 'success');
          after();
        }
      });
    }
    if (act === 'pw') {
      const u = VIEWS._users[id];
      return modal(
        'New password for ' + u.email,
        '<label class="f">New password<input class="in" type="password" name="password" minlength="8" autocomplete="new-password" required></label><p class="muted">The user can sign in with it immediately. Their old sessions stay valid until they sign out.</p>',
        {
          submit: 'Set password',
          onSubmit: async (f) => {
            await api('/admin/users/' + id + '/password', {
              method: 'POST',
              body: { password: f.elements.password.value }
            });
            toast('Password changed.', 'success');
          }
        }
      );
    }
    if (act === 'toggle') {
      try {
        await api('/admin/users/' + id, { method: 'PATCH', body: { disabled: b.dataset.disabled !== '1' } });
        toast(b.dataset.disabled === '1' ? 'Account enabled.' : 'Account disabled.', 'success');
        after();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }
    if (act === 'del') {
      return modal(
        'Delete user',
        '<p>Delete <b>' + esc(b.dataset.name) + '</b> and all of their circuits? This cannot be undone.</p>',
        {
          submit: 'Delete',
          danger: true,
          onSubmit: async () => {
            await api('/admin/users/' + id, { method: 'DELETE' });
            toast('User deleted.', 'success');
            after();
          }
        }
      );
    }
    if (act === 'delproj') {
      return modal(
        'Delete circuit',
        '<p>Delete <b>' +
          esc(b.dataset.name) +
          '</b>? The owner’s device keeps its own copy and may sync it again.</p>',
        {
          submit: 'Delete',
          danger: true,
          onSubmit: async () => {
            await api('/admin/projects/' + encodeURIComponent(b.dataset.uid) + '/' + encodeURIComponent(id), {
              method: 'DELETE'
            });
            toast('Circuit deleted.', 'success');
            after();
          }
        }
      );
    }
    if (act === 'testai') {
      const box = $('#aimsg');
      box.innerHTML = '<div class="alert info">Testing… (save your changes first)</div>';
      const r = await api('/admin/settings/test', { method: 'POST' }).catch((err) => ({
        ok: false,
        error: err.message
      }));
      box.innerHTML = r.ok
        ? '<div class="alert ok">Connected in ' +
          r.ms +
          ' ms. The model replied: “' +
          esc(r.reply) +
          '”.</div>'
        : '<div class="alert bad">' + esc(r.error) + '</div>';
      return;
    }
    if (act === 'clearkey') {
      await api('/admin/settings', { method: 'PUT', body: { clearKey: true } });
      toast('Saved key removed.', 'success');
      return route();
    }
    if (act === 'clearGeminiKey') {
      await api('/admin/settings', { method: 'PUT', body: { clearGeminiKey: true } });
      toast('Gemini fallback key removed.', 'success');
      return route();
    }
    if (act === 'clearProviderKey') {
      await api('/admin/settings', { method: 'PUT', body: { clearProviderKey: id } });
      toast('Provider key removed.', 'success');
      return route();
    }
  }

  /* ---------- start ---------- */
  function render() {
    if (!state.me) return loginView();
    if (state.me.role !== 'admin') return gateView();
    shell();
    route();
  }

  async function boot() {
    try {
      state.me = (await api('/me')).user;
    } catch {
      state.me = null;
    }
    state.claim = null;
    if (state.me && state.me.role !== 'admin') state.claim = await api('/admin/claim').catch(() => null);
    render();
  }

  addEventListener('hashchange', () => {
    if (state.me && state.me.role === 'admin' && $('#pg')) route();
  });
  boot();
})();
