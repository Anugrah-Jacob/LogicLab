/**
 * LogicLab: Digital Electronics Suite (application script).
 * Open source, MIT licence. Set your repository URL in js/config.js.
 *
 * This file is one classic script wrapped in a function, so everything below shares one scope.
 * Search for the section banners (/* ---------- name ---------- *\/) to find your way around:
 *
 *   analysis
 *   selection & inspector
 *   view
 *   pointer
 *   UI wiring
 *   examples (data-driven: see js/examples.js)
 *   automatic layout
 *   convert a circuit to NAND-only or NOR-only
 *   debugging and test hooks: window.LogicLab (see docs/DEBUGGING.md)
 *   groups, undo/redo, save/open, drawing
 *   projects, export, oscillation badge, pointers
 *   accounts
 *   local project index + offline-first sync
 *   welcome screen
 *   LogicLab AI (agent loop: the server calls the model, tools run here in the browser)
 *   start-up
 *
 * Data model (see docs/ARCHITECTURE.md):
 *   node  { id, type, x, y, name, nin, per, trig, v, o[], q, r[], ... }   a part on the canvas
 *   wire  { a, ap, b, bp }   output pin `ap` of node `a` -> input pin `bp` of node `b`
 *   DEF   per-type pin names and behaviour (gates, flip-flops, registers)
 * Debug in the browser console with `LogicLab` (see docs/DEBUGGING.md).
 */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s),
    esc = (s) => String(s).replace(/[&<>"]/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const cv = $('#cv'),
    g = cv.getContext('2d'),
    pc = $('#pcb'),
    pg = pc.getContext('2d'),
    sc = $('#sc'),
    sg = sc.getContext('2d'),
    S = getComputedStyle(document.documentElement);
  const K = {},
    KS = ['--bg', '--pn', '--tx', '--mu', '--bd', '--ac', '--hi', '--lo', '--cv', '--grid'],
    cs = (k) => K[k],
    rk = () => KS.forEach((k) => (K[k] = S.getPropertyValue(k).trim()));
  rk();
  let dpr = 1;
  const fit = (c) => {
      const r = c.getBoundingClientRect();
      dpr = Math.min(2, devicePixelRatio || 1);
      c.width = Math.max(1, r.width * dpr);
      c.height = Math.max(1, r.height * dpr);
    },
    fitAll = () => [cv, pc, sc].forEach(fit);
  new ResizeObserver(fitAll).observe(document.body);
  new ResizeObserver(fitAll).observe($('#wrk'));
  const DEF = {};
  ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'].forEach((t) => (DEF[t] = { ins: ['', ''], outs: [''] }));
  DEF.NOT = { ins: [''], outs: [''] };
  DEF.BUF = { ins: [''], outs: [''] };
  DEF.D = { ins: ['D', '>'], outs: ['Q', 'Q̄'], ff: 1 };
  DEF.T = { ins: ['T', '>'], outs: ['Q', 'Q̄'], ff: 1 };
  DEF.JK = { ins: ['J', '>', 'K'], outs: ['Q', 'Q̄'], ff: 1 };
  DEF.IN = { ins: [], outs: [''] };
  DEF.CLK = { ins: [], outs: [''] };
  DEF.LED = { ins: [''], outs: [] };
  DEF.METER = { ins: [''], outs: [] };
  DEF.SIPO = { ins: ['SI', '>'], outs: ['Q0', 'Q1', 'Q2', 'Q3'], reg: 1 };
  DEF.PISO = { ins: ['D0', 'D1', 'D2', 'D3', 'LD', '>'], outs: ['SO'], reg: 1 };
  const MULTI = new Set(['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR']),
    INV = /^(NAND|NOR|XNOR|NOT)$/,
    isG = (n) => MULTI.has(n.type) || n.type == 'NOT' || n.type == 'BUF';
  const FN = {
    AND: (a) => +a.every((x) => x),
    OR: (a) => +a.some((x) => x),
    NAND: (a) => +!a.every((x) => x),
    NOR: (a) => +!a.some((x) => x),
    XOR: (a) => a.reduce((p, x) => p ^ x, 0),
    XNOR: (a) => 1 - a.reduce((p, x) => p ^ x, 0),
    NOT: (a) => 1 - a[0],
    BUF: (a) => a[0]
  };
  const nx = (t, a, k, q) => (t == 'D' ? a : t == 'T' ? q ^ a : a && k ? 1 - q : a ? 1 : k ? 0 : q);
  const PAL = [
      ['IN', 'CLK'],
      ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'BUF'],
      ['D', 'T', 'JK', 'SIPO', 'PISO'],
      ['LED', 'METER']
    ],
    TIP = {
      IN: 'Switch',
      PB: 'Push button: outputs 1 only while you hold it down',
      CLK: 'Clock',
      LED: 'LED',
      METER: 'Voltmeter',
      SIPO: '4-bit SIPO shift register',
      PISO: '4-bit PISO shift register'
    };
  const nI = (n) => (MULTI.has(n.type) ? n.nin : DEF[n.type].ins.length),
    nO = (n) => DEF[n.type].outs.length;
  const W = 76,
    HM = 1000,
    hh = (n) =>
      n.type == 'METER'
        ? 64
        : n.type == 'IN' || n.type == 'CLK'
          ? 44
          : MULTI.has(n.type)
            ? Math.max(48, nI(n) * 16 + 16)
            : n.type == 'NOT' || n.type == 'BUF'
              ? 40
              : Math.max(44, Math.max(nI(n), nO(n)) * 24 + 12);
  const ip = (n, i) => ({ x: n.x, y: n.y + (hh(n) * (i + 1)) / (nI(n) + 1) }),
    op = (n, i) => ({ x: n.x + W, y: n.y + (hh(n) * (i + 1)) / (nO(n) + 1) });
  const ICN = {
    AND2: '74LS08',
    OR2: '74LS32',
    NAND2: '74LS00',
    NOR2: '74LS02',
    XOR2: '74LS86',
    XNOR2: '74LS266',
    AND3: '74LS11',
    NAND3: '74LS10',
    NOR3: '74LS27',
    OR3: 'CD4075',
    AND4: '74LS21',
    NAND4: '74LS20',
    NOR4: '74LS25',
    OR4: 'CD4072',
    NAND8: '74LS30',
    NOT: '74LS04',
    BUF: '74LS07',
    D: '74LS74',
    T: '74LS74+T',
    JK: '74LS76',
    SIPO: '74LS164',
    PISO: '74LS165'
  };
  const IC = (n) => ICN[n.type + (MULTI.has(n.type) ? n.nin : '')] || n.nin + '-IN ' + n.type;
  let osc = null,
    oc = 0,
    ok_ = '',
    RV = false,
    hv = {},
    selN = new Set(),
    PID = null,
    groups = [],
    notes = [],
    layers = [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }],
    actL = 1,
    dr = null,
    md = 0,
    snapOn = true,
    UN = [],
    RE = [],
    lh = '',
    nodes = [],
    wires = [],
    idm = new Map(),
    inMap = new Map(),
    uid = 1,
    cnt = {},
    hist = {},
    run = true,
    sps = 40,
    acc = 0,
    last = 0,
    T0 = 0,
    sel = new Set(),
    selW = null,
    pend = null,
    mouse = { x: 0, y: 0 },
    dirty = true,
    vcc = 5,
    drag = null,
    pan = null,
    marq = null,
    hd = null,
    V = [
      { s: 1, x: 0, y: 0 },
      { s: 1, x: 0, y: 0 }
    ],
    view = V[0],
    BB = null,
    tool = 'sel',
    win = 300,
    tab = 'tt',
    lp = 0,
    PR = 10;
  /** Main power. When false every output is 0 V and nothing is remembered (see powerOffTick). */
  let power = true;
  /**
   * Live collaboration (js/collab.js) plugs in here. `HOOK` holds its callbacks (commit, sw, cursor, home, live);
   * `RO` is true for people who joined through a view-only link: they can look around and press switches and
   * buttons, but every structural change is refused (see commit and the guards in the pointer and key handlers).
   */
  const HOOK = (window.LogicLabHook = window.LogicLabHook || {});
  let RO = false;
  /**
   * Rebuild the id lookup tables after nodes or wires change, prune empty groups, then settle the circuit.
   */
  const reindex = () => {
      idm = new Map(nodes.map((n) => [n.id, n]));
      groups.forEach((g) => {
        g.ids = g.ids.filter((i) => idm.has(i));
        g.nids = (g.nids || []).filter((i) => notes.some((a) => a.id == i));
      });
      groups = groups.filter((g) => g.ids.length + g.nids.length > 1);
      inMap = new Map(wires.map((w) => [w.b * 64 + w.bp, w]));
      settle();
      if (!power) clearState();
    },
    one = () => (sel.size == 1 && !selN.size ? [...sel][0] : null),
    isP = (n) => n.probe || n.type == 'IN' || n.type == 'CLK' || n.type == 'LED';
  /**
   * Find a stable state after the circuit was edited. Sets `osc` when a feedback loop never settles.
   */
  function settle() {
    let ok = 0;
    osc = null;
    oc = 0;
    for (let p = 0; p < 60; p++) {
      let ch = 0;
      nodes.forEach((n) => {
        const t = n.type,
          d = DEF[t];
        let o;
        if (t == 'IN' || t == 'CLK') o = [n.v];
        else if (d.ff) o = [n.q, 1 - n.q];
        else if (d.reg) o = t == 'SIPO' ? n.r.slice() : [n.r[3]];
        else if (t == 'LED' || t == 'METER') o = [val(n, 0)];
        else o = [FN[t](Array.from({ length: nI(n) }, (_, i) => val(n, i)))];
        if (o.length != n.o.length || o.some((v, i) => v !== n.o[i])) ch = 1;
        n.o = o;
      });
      if (!ch) {
        ok = 1;
        break;
      }
    }
    if (!ok && nodes.some(isG)) osc = ['feedback loop never settles'];
    nodes.forEach((n) => {
      const d = DEF[n.type];
      if (d.ff || d.reg) n.pc = val(n, d.ins.length - 1);
    });
  }
  /**
   * Create a part at (x, y) (snapped to the grid) and return it.
   */
  function add(type, x, y) {
    const c = (cnt[type] = (cnt[type] || 0) + 1),
      k = nodes.length;
    const name =
      type == 'IN' ? String.fromCharCode(64 + c) : ({ CLK: 'CLK', LED: 'Y', METER: 'VM' }[type] || 'U') + c;
    const n = {
      id: uid++,
      type,
      x: gs(x ?? 30 + (k % 5) * 100),
      y: gs(y ?? 30 + Math.floor(k / 5) * 100),
      name,
      nin: 2,
      o: [0, 0],
      pc: 0,
      q: 0,
      cnt: 0,
      v: 0,
      per: 20,
      avg: 0,
      probe: 0,
      hide: 0,
      r: [0, 0, 0, 0],
      trig: 'R',
      act: -99
    };
    nodes.push(n);
    reindex();
    dirty = true;
    return n;
  }
  /**
   * Connect output pin `ap` of node `a` to input pin `bp` of node `b` (replaces any wire already on that input).
   */
  function link(a, ap, b, bp) {
    wires = wires.filter((w) => !(w.b == b.id && w.bp == bp));
    wires.push({ a: a.id, ap, b: b.id, bp });
    reindex();
    dirty = true;
  }
  const val = (n, i) => {
    const w = inMap.get(n.id * 64 + i);
    return w ? idm.get(w.a).o[w.ap] : 0;
  };
  /**
   * Advance the circuit by one simulation tick.
   * Order: switches and clocks, then flip-flops and registers (repeated as "delta cycles" so ripple clocks
   * line up), then the logic gates. Flip-flops sample their inputs before the gates change.
   */
  function step(frz) {
    nodes.forEach((n) => {
      if (n.type == 'IN') n.o = [n.v];
      else if (n.type == 'CLK') {
        if (!frz && ++n.cnt >= n.per / 2) {
          n.cnt = 0;
          n.v ^= 1;
        }
        n.o = [n.v];
      }
    });
    for (let dl = 0; dl < 8; dl++) {
      let ch = 0;
      const out = nodes.map((n) => {
        const t = n.type,
          d = DEF[t];
        if (d.ff) {
          const c = val(n, 1),
            m = n.trig;
          if (dl && (m == 'H' || m == 'L')) return null;
          const a = m == 'R' ? c && !n.pc : m == 'F' ? !c && n.pc : m == 'H' ? c : !c;
          if (a) {
            n.q = nx(t, val(n, 0), t == 'JK' ? val(n, 2) : 0, n.q);
            if (!frz) n.act = T0;
          }
          n.pc = c;
          return [n.q, 1 - n.q];
        }
        if (d.reg) {
          const c = val(n, d.ins.length - 1);
          if (c && !n.pc) {
            if (!frz) n.act = T0;
            if (t == 'SIPO') n.r = [val(n, 0), n.r[0], n.r[1], n.r[2]];
            else n.r = val(n, 4) ? [0, 1, 2, 3].map((i) => val(n, i)) : [0, n.r[0], n.r[1], n.r[2]];
          }
          n.pc = c;
          return t == 'SIPO' ? n.r.slice() : [n.r[3]];
        }
        return null;
      });
      nodes.forEach((n, i) => {
        const o = out[i];
        if (o) {
          if (o.some((v, j) => v !== n.o[j])) ch = 1;
          n.o = o;
        }
      });
      comb();
      if (!ch) break;
    }
    if (RV) {
      rc();
      // LEDs and meters must show the delayed, thresholded level, not the ideal gate output
      nodes.forEach((n) => {
        if (n.type === 'LED' || n.type === 'METER') n.o = [val(n, 0)];
      });
    }
  }
  /**
   * Evaluate every combinational gate.
   * Ideal mode updates gates one after another, so cross-coupled latches settle into a valid state like real
   * hardware. Real-voltage mode evaluates all gates from one snapshot so RC delays add up along a path.
   */
  function comb() {
    const f = (n) => [FN[n.type](Array.from({ length: nI(n) }, (_, i) => val(n, i)))];
    if (RV) {
      const t = nodes.map((n) => (isG(n) ? f(n) : null));
      nodes.forEach((n, i) => {
        if (t[i]) n.o = t[i];
      });
    } else
      nodes.forEach((n) => {
        if (isG(n)) n.o = f(n);
      });
    nodes.forEach((n) => {
      if (n.type == 'LED' || n.type == 'METER') n.o = [val(n, 0)];
    });
  }
  /**
   * Real-voltage model: move each output toward its target voltage (first-order RC) and convert it back to
   * a logic level with 30% / 70% thresholds and hysteresis.
   */
  function rc() {
    nodes.forEach((n) => {
      if (n.type == 'LED' || n.type == 'METER') return;
      if (!n.av || n.av.length != n.o.length) n.av = n.o.map((v) => (v ? vcc : 0));
      const a = n.type == 'IN' || n.type == 'CLK' ? 1 : 0.42 + ((n.id * 37) % 11) / 60;
      const po = n.po;
      n.o = n.o.map((t, j) => {
        n.av[j] += ((t ? vcc - 0.05 : 0.05) - n.av[j]) * a;
        return n.av[j] >= 0.7 * vcc ? 1 : n.av[j] <= 0.3 * vcc ? 0 : po ? po[j] : t;
      });
      n.po = n.o;
    });
  }

  const sn = () => JSON.stringify(nodes.map((n) => [n.o, n.pc, n.q, n.cnt, n.v, n.r])),
    rs = (s) => {
      const a = JSON.parse(s);
      nodes.forEach((n, i) => ([n.o, n.pc, n.q, n.cnt, n.v, n.r] = a[i]));
    };
  /**
   * One simulation step plus bookkeeping: oscillation detection, meter averaging and waveform history.
   */
  function tick() {
    tickN++;
    if (!power) {
      powerOffTick();
      return;
    }
    const pre = nodes.map((n) => n.o.join());
    step(false);
    T0++;
    const gc = [];
    let sc_ = 0;
    nodes.forEach((n, i) => {
      if (n.o.join() != pre[i]) {
        if (isG(n)) gc.push(n.name);
        else if (n.type != 'LED' && n.type != 'METER') sc_ = 1;
      }
    });
    if (gc.length && !sc_) {
      if (++oc >= 6) osc = gc;
    } else {
      oc = 0;
      if (!gc.length) osc = null;
    }
    recordHistory();
    releaseLate();
  }

  /** Append every probed output (and voltage in real mode) to the waveform history. */
  function recordHistory() {
    nodes.forEach((n) => {
      if (n.type == 'METER') {
        const w = inMap.get(n.id * 64),
          q = w && idm.get(w.a);
        n.avg += ((RV && q && q.av ? q.av[w.ap] / vcc : n.o[0]) - n.avg) * 0.05;
      }
      const vv = RV
        ? n.av
          ? n.av[0]
          : n.type == 'LED'
            ? (() => {
                const w = inMap.get(n.id * 64),
                  q = w && idm.get(w.a);
                return q && q.av ? q.av[w.ap] : n.o[0] * vcc;
              })()
            : null
        : null;
      if (vv !== null) {
        const h = hv[n.id] || (hv[n.id] = []);
        h.push(vv);
        if (h.length > HM) h.shift();
      }
      if (isP(n)) {
        const h = hist[n.id] || (hist[n.id] = []);
        h.push(n.o[0]);
        if (h.length > HM) h.shift();
      }
    });
  }
  /* ---------- main power and reset ---------- */

  /** Zero every part: outputs, flip-flop and register memory, clock phase and analog voltages. */
  function clearState() {
    nodes.forEach((n) => {
      n.o = n.o.map(() => 0);
      n.q = 0;
      n.r = [0, 0, 0, 0];
      n.pc = 0;
      n.cnt = 0;
      n.act = -99;
      n.avg = 0;
      if (n.av) n.av = n.av.map(() => 0);
      n.po = null;
      if (n.type === 'CLK') n.v = 0;
    });
    osc = null;
    oc = 0;
  }

  /** One tick with the power off: everything stays at 0 V, but time moves on so the waveform shows a flat line. */
  function powerOffTick() {
    clearState();
    T0++;
    recordHistory();
  }

  /**
   * Restart the circuit as if it had just been powered on: all memory cleared, clocks at phase 0, and the
   * combinational start state found again. In real-voltage mode the outputs then rise from 0 V.
   */
  function restartCircuit(clearHistory) {
    clearState();
    if (clearHistory) {
      hist = {};
      hv = {};
      T0 = 0;
    }
    reindex();
    if (RV) {
      // Real-voltage mode: everything except the switches and clocks starts at 0 V and rises through the RC model.
      nodes.forEach((n) => {
        if (n.type === 'IN' || n.type === 'CLK') return;
        n.o = n.o.map(() => 0);
        if (n.type === 'LED' || n.type === 'METER') return;
        n.av = n.o.map(() => 0);
        n.po = n.o.map(() => 0);
      });
    }
  }

  function setPower(on) {
    on = !!on;
    if (on === power) return;
    power = on;
    if (on) restartCircuit(false);
    else clearState();
    updatePowerUI();
  }

  /** Reset button: restart the circuit and the waveform. With the power off it only clears the waveform. */
  function resetCircuit() {
    restartCircuit(true);
    if (!power) clearState();
  }

  function updatePowerUI() {
    const button = $('#pwr');
    button.classList.toggle('on', power);
    button.classList.toggle('off', !power);
    button.querySelector('span').textContent = power ? 'ON' : 'OFF';
    button.setAttribute('aria-label', power ? 'Power ON' : 'Power OFF');
    $('#poff').hidden = power;
    document.body.classList.toggle('pwr-off', !power);
  }
  $('#pwr').onclick = () => setPower(!power);
  $('#rst').onclick = () => {
    resetCircuit();
    toast(power ? 'Circuit restarted from zero.' : 'Waveform cleared. The power is off.', 'info', 1800);
  };

  function frame(t) {
    const dt = Math.min(100, t - last);
    last = t;
    rk();
    if (run) {
      acc += (dt * sps) / 1000;
      let k = 0;
      while (acc >= 1 && k < 60) {
        acc--;
        tick();
        k++;
      }
      if (k == 60) acc = 0;
    }
    if (dirty) {
      dirty = false;
      BB = null;
      render();
      chips();
    }
    oscUI();
    draw(cv, g, vw[0], t);
    if (vw[1]) draw(pc, pg, vw[1], t);
    if (!document.body.classList.contains('hf')) scope();
    $('#zl').textContent = Math.round(view.s * 100) + '%';
    requestAnimationFrame(frame);
  }
  function shape(c, t, x, y, w, h) {
    const iv = INV.test(t),
      bx = x + w - (iv ? 10 : 0),
      m = y + h / 2,
      o = /XOR|XNOR/.test(t) ? 8 : 0,
      x0 = x + o,
      bw = bx - x0;
    c.beginPath();
    if (/AND/.test(t)) {
      const mid = x + (bx - x) * 0.5,
        k = mid + (bx - mid) * 1.34;
      c.moveTo(x, y);
      c.lineTo(mid, y);
      c.bezierCurveTo(k, y, k, y + h, mid, y + h);
      c.lineTo(x, y + h);
      c.closePath();
    } else if (/OR/.test(t)) {
      c.moveTo(x0, y);
      c.bezierCurveTo(x0 + bw * 0.5, y, x0 + bw * 0.85, y + h * 0.25, bx, m);
      c.bezierCurveTo(x0 + bw * 0.85, y + h * 0.75, x0 + bw * 0.5, y + h, x0, y + h);
      c.quadraticCurveTo(x0 + bw * 0.3, m, x0, y);
    } else {
      c.moveTo(x, y);
      c.lineTo(bx, m);
      c.lineTo(x, y + h);
      c.closePath();
    }
    c.fill();
    c.stroke();
    if (o) {
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + bw * 0.3, m, x, y + h);
      c.stroke();
    }
    if (iv) {
      c.beginPath();
      c.arc(bx + 5, m, 5, 0, 7);
      c.fill();
      c.stroke();
    }
  }
  function route(w, p, q) {
    if (w.via) {
      const v = w.via,
        qx = q.x - 16;
      return { P: [p, { x: v.x, y: p.y }, v, { x: qx, y: v.y }, { x: qx, y: q.y }, q], h: v, f: 0 };
    }
    if (q.x > p.x + 24) {
      const m = w.mx ?? (p.x + q.x) / 2;
      return { P: [p, { x: m, y: p.y }, { x: m, y: q.y }, q], h: { x: m, y: (p.y + q.y) / 2 }, f: 1 };
    }
    const yy = w.my ?? Math.min(p.y, q.y) - 44,
      a = p.x + 16,
      b = q.x - 16;
    return {
      P: [p, { x: a, y: p.y }, { x: a, y: yy }, { x: b, y: yy }, { x: b, y: q.y }, q],
      h: { x: (a + b) / 2, y: yy }
    };
  }
  const clean = (P) => {
    const o = [];
    P.forEach((p) => {
      const l = o[o.length - 1];
      if (!l || Math.abs(l.x - p.x) > 0.5 || Math.abs(l.y - p.y) > 0.5) o.push(p);
    });
    return o.filter((p, i) => {
      if (!i || i == o.length - 1) return 1;
      const a = o[i - 1],
        b = o[i + 1];
      return !(
        (Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5) ||
        (Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5)
      );
    });
  };
  function poly(c, P, r) {
    P = clean(P);
    c.beginPath();
    c.moveTo(P[0].x, P[0].y);
    for (let i = 1; i < P.length - 1; i++) {
      const a = P[i - 1],
        b = P[i],
        n = P[i + 1],
        rr = Math.min(r, Math.hypot(b.x - a.x, b.y - a.y) / 2, Math.hypot(n.x - b.x, n.y - b.y) / 2);
      c.arcTo(b.x, b.y, n.x, n.y, rr);
    }
    c.lineTo(P[P.length - 1].x, P[P.length - 1].y);
  }
  function wdraw(c, w, pcb, t, bb) {
    const a = idm.get(w.a),
      b = idm.get(w.b);
    if (!a || !b) return;
    const R = route(w, op(a, w.ap), ip(b, w.bp)),
      on = a.o[w.ap],
      s = w === selW || sel.has(a) || sel.has(b);
    if (bb) {
      jumper(c, R, w, on, s, t);
      return;
    }
    poly(c, R.P, pcb ? 3 : 12);
    c.lineJoin = 'round';
    if (pcb) {
      c.lineWidth = 4;
      c.strokeStyle = s ? '#ffb26b' : on ? '#ffd66b' : '#b9812e';
    } else {
      c.lineWidth = on || s ? 3 : 2;
      c.strokeStyle = s ? cs('--ac') : cs(on ? '--hi' : '--lo');
    }
    c.setLineDash(!pcb && on ? [8, 8] : []);
    c.lineDashOffset = -(t / 30) % 16;
    c.stroke();
    c.setLineDash([]);
    if (pcb && on) {
      c.setLineDash([6, 10]);
      c.lineDashOffset = -(t / 25) % 16;
      c.lineWidth = 2;
      c.strokeStyle = '#fff7d6';
      c.stroke();
      c.setLineDash([]);
    }
    if (w === selW) {
      c.beginPath();
      c.arc(R.h.x, R.h.y, 7, 0, 7);
      c.fillStyle = cs('--ac');
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.stroke();
    }
  }
  function draw(c, x, m, t) {
    const pcb = m == 'pcb',
      bb = m == 'bb',
      tr = m == 'tr';
    view = V[c === cv ? 0 : 1];
    const r = c.getBoundingClientRect(),
      s = view.s;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, r.width, r.height);
    x.fillStyle = pcb ? '#083d2a' : bb ? '#cfd2d4' : cs('--cv');
    x.fillRect(0, 0, r.width, r.height);
    x.setTransform(dpr * s, 0, 0, dpr * s, dpr * view.x, dpr * view.y);
    const x0 = -view.x / s,
      y0 = -view.y / s,
      st = s < 0.5 ? 96 : s < 0.9 ? 48 : 24;
    x.fillStyle = pcb ? '#0f5a3d' : bb ? '#b9bdc1' : cs('--grid');
    for (let a = Math.floor(x0 / st) * st; a < x0 + r.width / s; a += st)
      for (let b = Math.floor(y0 / st) * st; b < y0 + r.height / s; b += st) x.fillRect(a, b, 1.5, 1.5);
    if (bb && nodes.length) {
      const B = bbB();
      x.fillStyle = '#f4f2ec';
      x.strokeStyle = '#a9a79f';
      x.lineWidth = 2;
      x.beginPath();
      x.roundRect(B.x, B.y, B.w, B.h, 10);
      x.fill();
      x.stroke();
      x.fillStyle = '#c7c4bb';
      for (let a = B.x + 16; a < B.x + B.w - 10; a += 12)
        for (let b = B.y + 24; b < B.y + B.h - 24; b += 12)
          if (Math.abs(b - (B.y + B.h / 2)) > 6) x.fillRect(a, b, 3, 3);
      x.fillStyle = '#d34b4b';
      x.fillRect(B.x + 12, B.y + 8, B.w - 24, 2.5);
      x.fillStyle = '#3b6fd0';
      x.fillRect(B.x + 12, B.y + 13, B.w - 24, 2.5);
      x.fillStyle = '#b9bdc1';
      x.fillRect(B.x + 12, B.y + B.h / 2 - 3, B.w - 24, 6);
      x.fillStyle = '#d34b4b';
      x.fillRect(B.x + 12, B.y + B.h - 11, B.w - 24, 2.5);
      x.fillStyle = '#3b6fd0';
      x.fillRect(B.x + 12, B.y + B.h - 16, B.w - 24, 2.5);
    }
    if (pcb && nodes.length) {
      const B = bbox(60, 70);
      x.fillStyle = '#0b6b47';
      x.strokeStyle = '#d9b24a';
      x.lineWidth = 3;
      x.beginPath();
      x.roundRect(B.x, B.y, B.w, B.h, 14);
      x.fill();
      x.stroke();
      [
        [B.x + 14, B.y + 14],
        [B.x + B.w - 14, B.y + 14],
        [B.x + 14, B.y + B.h - 14],
        [B.x + B.w - 14, B.y + B.h - 14]
      ].forEach((h) => {
        x.fillStyle = '#083d2a';
        x.beginPath();
        x.arc(h[0], h[1], 6, 0, 7);
        x.fill();
        x.strokeStyle = '#d9b24a';
        x.lineWidth = 2;
        x.stroke();
      });
      x.fillStyle = '#e9f5ee';
      x.font = 'bold 10px monospace';
      x.textAlign = 'left';
      x.fillText('GATEFORGE REV A   VCC ' + vcc + 'V  GND', B.x + 32, B.y + B.h - 12);
    }
    if (!bb) groups.forEach((gr) => gbox(x, gr));
    if (bb) bbDraw(x, t);
    else wires.forEach((w) => wdraw(x, w, pcb, t, bb));
    if (pend) {
      poly(x, route({}, op(pend.n, pend.i), mouse).P, pcb ? 3 : 12);
      x.lineWidth = 2;
      x.strokeStyle = cs('--ac');
      x.setLineDash([6, 6]);
      x.stroke();
      x.setLineDash([]);
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    if (!bb) nodes.forEach((n) => (pcb ? pcbPart(x, n) : tr ? trPart(x, n) : part(x, n)));
    if (!bb) nDraw(x);
    if (marq) {
      x.fillStyle = '#ff6d5a22';
      x.strokeStyle = cs('--ac');
      x.lineWidth = 1;
      x.setLineDash([5, 4]);
      const m = marq;
      x.fillRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
      x.strokeRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0);
      x.setLineDash([]);
    }
  }
  function bbox(mx, my) {
    const R = nodes
      .map((n) => [n.x, n.y, n.x + W + 30, n.y + hh(n) + 10])
      .concat(
        notes
          .filter((a) => {
            const l = layerOf(a);
            return l && l.vis;
          })
          .map((a) => {
            const b = nBox(a);
            return [b[0], b[1], b[2] + 10, b[3] + 10];
          })
      );
    if (!R.length) return { x: 0, y: 0, w: 100, h: 100 };
    const X = Math.min(...R.map((r) => r[0])) - mx,
      Y = Math.min(...R.map((r) => r[1])) - my,
      X2 = Math.max(...R.map((r) => r[2])) + mx,
      Y2 = Math.max(...R.map((r) => r[3])) + mx;
    return { x: X, y: Y, w: X2 - X, h: Y2 - Y };
  }
  function pin(c, p, v, pcb) {
    c.beginPath();
    c.arc(p.x, p.y, pcb ? 4.5 : 4, 0, 7);
    c.fillStyle = pcb ? (v ? '#fff3b0' : '#d9b24a') : v ? cs('--hi') : cs('--pn');
    c.fill();
    c.lineWidth = 1.5;
    c.strokeStyle = pcb ? '#6b4e10' : v ? cs('--hi') : cs('--mu');
    c.stroke();
    if (pcb) {
      c.fillStyle = '#083d2a';
      c.beginPath();
      c.arc(p.x, p.y, 1.6, 0, 7);
      c.fill();
    }
  }
  function pins(c, n, pcb) {
    for (let i = 0; i < nI(n); i++) pin(c, ip(n, i), val(n, i), pcb);
    for (let i = 0; i < nO(n); i++) pin(c, op(n, i), n.o[i], pcb);
  }
  function part(c, n) {
    const t = n.type,
      h = hh(n),
      on = n.o[0],
      cx = n.x + W / 2,
      cy = n.y + h / 2,
      sl = sel.has(n),
      d = DEF[t];
    c.lineWidth = sl ? 3 : 2;
    c.strokeStyle = sl ? cs('--ac') : cs('--tx');
    c.fillStyle = cs('--pn');
    c.lineJoin = 'round';
    c.font = '600 13px system-ui,sans-serif';
    if (sl) {
      c.shadowColor = cs('--ac');
      c.shadowBlur = 16;
    }
    if (isG(n)) {
      shape(c, t, n.x, n.y, W, h);
      c.shadowBlur = 0;
      if (/OR/.test(t)) {
        const o = /XOR|XNOR/.test(t) ? 8 : 0,
          bw = W - (INV.test(t) ? 10 : 0) - o;
        c.beginPath();
        for (let i = 0; i < nI(n); i++) {
          const p = ip(n, i),
            u = 1 - (p.y - n.y) / h;
          c.moveTo(p.x, p.y);
          c.lineTo(n.x + o + 0.6 * bw * u * (1 - u), p.y);
        }
        c.stroke();
      }
    } else if (t == 'IN' && n.mom) {
      // Push button: a round cap that sinks while it is held down (output 1 only while pressed).
      c.fillStyle = cs('--pn');
      c.beginPath();
      c.roundRect(n.x + 12, cy - 15, W - 28, 30, 8);
      c.fill();
      c.stroke();
      c.beginPath();
      c.moveTo(n.x + W - 16, cy);
      c.lineTo(n.x + W, cy);
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = on ? cs('--hi') : cs('--lo');
      c.beginPath();
      c.arc(n.x + 34, cy + (on ? 1 : 0), on ? 9 : 11, 0, 7);
      c.fill();
      c.lineWidth = 1.2;
      c.stroke();
      c.fillStyle = cs('--tx');
      c.font = '700 8px system-ui,sans-serif';
      c.fillText('PB', n.x + 53, cy + 3);
      c.fillStyle = '#fff';
    } else if (t == 'IN') {
      c.fillStyle = on ? cs('--hi') : cs('--lo');
      c.beginPath();
      c.roundRect(n.x + 14, cy - 11, W - 30, 22, 11);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(on ? n.x + W - 27 : n.x + 27, cy, 8, 0, 7);
      c.fill();
      c.beginPath();
      c.moveTo(n.x + W - 16, cy);
      c.lineTo(n.x + W, cy);
      c.stroke();
    } else if (t == 'LED') {
      c.beginPath();
      c.moveTo(n.x, cy);
      c.lineTo(cx - 13, cy);
      c.stroke();
      c.save();
      if (on) {
        c.shadowColor = cs('--hi');
        c.shadowBlur = 18;
      }
      c.fillStyle = on ? cs('--hi') : cs('--lo');
      c.beginPath();
      c.arc(cx, cy, 13, 0, 7);
      c.fill();
      c.restore();
      c.stroke();
    } else if (t == 'METER') {
      c.beginPath();
      c.roundRect(n.x + 6, n.y, W - 6, h, 8);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.beginPath();
      c.moveTo(n.x, cy);
      c.lineTo(n.x + 6, cy);
      c.stroke();
      const gx = cx + 3,
        gy = n.y + 36;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(gx, gy, 22, Math.PI, 0);
      c.stroke();
      const a = Math.PI + n.avg * Math.PI;
      c.strokeStyle = cs('--ac');
      c.lineWidth = 2.5;
      c.beginPath();
      c.moveTo(gx, gy);
      c.lineTo(gx + 20 * Math.cos(a), gy + 20 * Math.sin(a));
      c.stroke();
      c.fillStyle = cs('--mu');
      c.font = '10px system-ui,sans-serif';
      c.fillText((n.avg * vcc).toFixed(2) + ' V avg', gx, n.y + 55);
    } else if (t == 'CLK') {
      c.beginPath();
      c.roundRect(n.x, n.y, W, h, 6);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = cs('--tx');
      c.fillText('CLK', cx, cy - 9);
      c.strokeStyle = cs('--ac');
      c.beginPath();
      const y1 = cy + 3,
        y0 = cy + 13;
      c.moveTo(cx - 24, y0);
      c.lineTo(cx - 24, y1);
      c.lineTo(cx - 8, y1);
      c.lineTo(cx - 8, y0);
      c.lineTo(cx + 8, y0);
      c.lineTo(cx + 8, y1);
      c.lineTo(cx + 24, y1);
      c.stroke();
    } else {
      c.beginPath();
      c.roundRect(n.x, n.y, W, h, 6);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = cs('--tx');
      c.fillText(DEF[t].reg ? t : t + ' FF', cx, cy);
      c.font = '10px system-ui,sans-serif';
      c.fillStyle = cs('--mu');
      d.ins.forEach((s, i) => {
        const p = ip(n, i);
        c.textAlign = 'left';
        c.fillText(s, p.x + 7, p.y);
      });
      d.outs.forEach((s, i) => {
        const p = op(n, i);
        c.textAlign = 'right';
        c.fillText(s, p.x - 7, p.y);
      });
      c.textAlign = 'center';
    }
    c.shadowBlur = 0;
    c.font = '10px system-ui,sans-serif';
    c.fillStyle = sl ? cs('--ac') : cs('--mu');
    c.fillText(n.name, cx, n.y - 8);
    pins(c, n, 0);
    if (d.ff || d.reg) trigBox(c, n);
  }
  function trigBox(c, n) {
    const d = DEF[n.type],
      m = d.reg ? 'R' : n.trig,
      ck = val(n, d.ins.length - 1),
      on = m == 'R' || m == 'F' ? T0 - n.act < Math.max(4, Math.round(sps / 5)) : m == 'H' ? ck : !ck,
      x = n.x + W / 2 - 27,
      y = n.y + hh(n) - 17,
      lb = { R: 'edge ↑', F: 'edge ↓', H: 'level H', L: 'level L' }[m];
    c.fillStyle = on ? cs('--hi') : cs('--pn');
    c.strokeStyle = on ? cs('--hi') : cs('--bd');
    c.lineWidth = 1.2;
    c.beginPath();
    c.roundRect(x, y, 54, 14, 4);
    c.fill();
    c.stroke();
    c.strokeStyle = on ? '#fff' : cs('--mu');
    c.lineWidth = 1.4;
    c.beginPath();
    if (m == 'R') {
      c.moveTo(x + 4, y + 10);
      c.lineTo(x + 9, y + 10);
      c.lineTo(x + 9, y + 4);
      c.lineTo(x + 14, y + 4);
    } else if (m == 'F') {
      c.moveTo(x + 4, y + 4);
      c.lineTo(x + 9, y + 4);
      c.lineTo(x + 9, y + 10);
      c.lineTo(x + 14, y + 10);
    } else if (m == 'H') {
      c.moveTo(x + 4, y + 10);
      c.lineTo(x + 6, y + 10);
      c.lineTo(x + 6, y + 4);
      c.lineTo(x + 13, y + 4);
      c.lineTo(x + 13, y + 10);
    } else {
      c.moveTo(x + 4, y + 4);
      c.lineTo(x + 6, y + 4);
      c.lineTo(x + 6, y + 10);
      c.lineTo(x + 13, y + 10);
      c.lineTo(x + 13, y + 4);
    }
    c.stroke();
    c.font = '9px system-ui,sans-serif';
    c.textAlign = 'left';
    c.fillStyle = on ? '#fff' : cs('--mu');
    c.fillText(lb, x + 18, y + 7.5);
    c.textAlign = 'center';
  }
  const zig = (c, x, y, L, v) => {
    c.beginPath();
    c.moveTo(x, y);
    const d = L / 6;
    for (let i = 0; i < 6; i++) {
      const o = i % 2 ? -3 : 3;
      v ? c.lineTo(x + o, y + d * (i + 0.5)) : c.lineTo(x + d * (i + 0.5), y + o);
    }
    v ? c.lineTo(x, y + L) : c.lineTo(x + L, y);
    c.stroke();
  };
  const ln = (c, ...a) => {
    c.beginPath();
    c.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) c.lineTo(a[i], a[i + 1]);
    c.stroke();
  };
  function bjt(c, x, y, r) {
    c.fillStyle = cs('--pn');
    c.beginPath();
    c.arc(x, y, r, 0, 7);
    c.fill();
    c.stroke();
    ln(c, x - r * 0.35, y - r * 0.55, x - r * 0.35, y + r * 0.55);
    ln(c, x - r * 0.35, y - r * 0.2, x + r * 0.45, y - r * 0.78);
    ln(c, x - r * 0.35, y + r * 0.2, x + r * 0.45, y + r * 0.78);
    c.fillStyle = cs('--tx');
    c.beginPath();
    c.moveTo(x + r * 0.45, y + r * 0.78);
    c.lineTo(x + r * 0.05, y + r * 0.6);
    c.lineTo(x + r * 0.25, y + r * 0.3);
    c.fill();
  }
  function vtri(c, x, y) {
    ln(c, x, y, x, y - 6);
    c.fillStyle = cs('--tx');
    c.beginPath();
    c.moveTo(x - 4, y - 6);
    c.lineTo(x + 4, y - 6);
    c.lineTo(x, y - 12);
    c.fill();
    c.font = '8px system-ui,sans-serif';
    c.fillText('Vcc', x + 13, y - 8);
  }
  function gnd(c, x, y) {
    ln(c, x, y, x, y + 4);
    ln(c, x - 6, y + 4, x + 6, y + 4);
    ln(c, x - 4, y + 7, x + 4, y + 7);
    ln(c, x - 2, y + 10, x + 2, y + 10);
  }
  function trPart(c, n) {
    const t = n.type;
    if (!(isG(n) && t != 'XOR' && t != 'XNOR' && t != 'BUF') && t != 'IN' && t != 'LED') {
      part(c, n);
      return;
    }
    const h = hh(n),
      cx = n.x + W / 2,
      sl = sel.has(n),
      on = n.o[0],
      r = 6.5,
      o = op(n, 0),
      cy = n.y + h / 2;
    c.lineWidth = sl ? 2.6 : 1.6;
    c.strokeStyle = sl ? cs('--ac') : cs('--tx');
    c.fillStyle = cs('--tx');
    c.lineJoin = 'round';
    c.font = '9px system-ui,sans-serif';
    c.textAlign = 'center';
    if (sl) {
      c.shadowColor = cs('--ac');
      c.shadowBlur = 12;
    }
    if (t == 'IN' && n.mom) {
      const by = on ? cy - 3 : cy - 10;
      vtri(c, n.x + 10, cy - 14);
      ln(c, n.x + 10, cy - 14, n.x + 10, cy - 2);
      ln(c, n.x + 8, by, n.x + 32, by);
      ln(c, n.x + 20, by - 8, n.x + 20, by);
      ln(c, n.x + 14, by - 8, n.x + 26, by - 8);
      [10, 30].forEach((x) => {
        c.beginPath();
        c.arc(n.x + x, cy, 2.2, 0, 7);
        c.stroke();
      });
      zig(c, n.x + 32, cy, 26);
      ln(c, n.x + 58, cy, n.x + W, cy);
      c.fillText('PUSH', n.x + 45, cy - 8);
    } else if (t == 'IN') {
      const by = on ? cy - 3 : cy - 10;
      vtri(c, n.x + 10, cy - 14);
      ln(c, n.x + 10, cy - 14, n.x + 10, cy - 2);
      ln(c, n.x + 8, by, n.x + 32, by);
      [10, 30].forEach((x) => {
        c.beginPath();
        c.arc(n.x + x, cy, 2.2, 0, 7);
        c.stroke();
      });
      zig(c, n.x + 32, cy, 26);
      ln(c, n.x + 58, cy, n.x + W, cy);
      c.fillText('10K', n.x + 45, cy - 8);
    } else if (t == 'LED') {
      ln(c, n.x, cy, n.x + 24, cy);
      c.beginPath();
      c.moveTo(n.x + 24, cy - 7);
      c.lineTo(n.x + 24, cy + 7);
      c.lineTo(n.x + 42, cy);
      c.closePath();
      if (on) c.fillStyle = cs('--hi');
      c.fill();
      c.stroke();
      ln(c, n.x + 42, cy - 7, n.x + 42, cy + 7);
      ln(c, n.x + 42, cy, n.x + 52, cy);
      zig(c, n.x + 52, cy, 16);
      ln(c, n.x + 68, cy, n.x + 68, cy + 10);
      gnd(c, n.x + 68, cy + 10);
      ln(c, n.x + 34, cy - 10, n.x + 40, cy - 16);
      c.fillStyle = cs('--tx');
      c.fillText('330Ω', n.x + 60, cy - 8);
    } else {
      const ys = [...Array(nI(n))].map((_, i) => ip(n, i).y),
        par = /OR/.test(t),
        xt = n.x + (par ? 34 : 40);
      if (t == 'NOT') {
        const y = ys[0];
        zig(c, n.x, y, 20);
        ln(c, n.x + 20, y, xt - r * 0.35, y);
        ln(c, xt + 3, y - r * 0.8, xt + 3, n.y + 4);
        ln(c, xt + 3, y + r * 0.8, xt + 3, y + r + 8);
        ln(c, xt + 3, y - 8, n.x + W, o.y);
        bjt(c, xt, y, r);
        vtri(c, xt + 3, n.y + 4);
        gnd(c, xt + 3, y + r + 8);
      } else {
        const yb = ys[ys.length - 1] + r + 4,
          y0 = ys[0] - r - 6,
          xc = n.x + 56,
          xe = n.x + 64,
          xv = par ? xc : xt + 3,
          xo = par ? xe : xt + 3;
        ys.forEach((y) => {
          zig(c, n.x, y, 20);
          ln(c, n.x + 20, y, xt - r * 0.35, y);
        });
        if (!par) ln(c, xt + 3, y0, xt + 3, yb);
        else {
          ys.forEach((y) => {
            ln(c, xt + r * 0.45, y - r * 0.78, xc, y - r * 0.78);
            ln(c, xt + r * 0.45, y + r * 0.78, xe, y + r * 0.78);
          });
          ln(c, xc, y0, xc, ys[ys.length - 1] - r * 0.78);
          ln(c, xe, ys[0] + r * 0.78, xe, yb);
        }
        ys.forEach((y) => bjt(c, xt, y, r));
        vtri(c, xv, y0);
        ln(c, xo, yb, xo, yb + 3);
        zig(c, xo, yb + 3, 12, 1);
        gnd(c, xo, yb + 15);
        ln(c, xo, yb, n.x + W, yb, n.x + W, o.y);
        c.fillText('1K', xo + 10, yb + 9);
      }
      if (INV.test(t)) {
        c.fillStyle = cs('--pn');
        c.beginPath();
        c.arc(n.x + W - 5, o.y, 4, 0, 7);
        c.fill();
        c.stroke();
      }
    }
    c.shadowBlur = 0;
    c.fillStyle = sl ? cs('--ac') : cs('--mu');
    c.fillText(n.name + ' · BJT', cx, n.y - 8);
    pins(c, n, 0);
  }
  const JC = ['#f5c518', '#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1'];
  function jumper(c, R, w, on, s, t) {
    const p = R.P[0],
      q = R.P[R.P.length - 1],
      v = w.via,
      m = v
        ? { x: 2 * v.x - (p.x + q.x) / 2, y: 2 * v.y - (p.y + q.y) / 2 }
        : { x: (p.x + q.x) / 2, y: Math.min(p.y, q.y) - 28 - Math.abs(q.x - p.x) * 0.12 };
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.quadraticCurveTo(m.x, m.y, q.x, q.y);
    c.lineCap = 'round';
    c.lineWidth = s ? 7 : 5;
    c.strokeStyle = s ? '#ffb26b' : JC[w.a % 7];
    c.stroke();
    if (on) {
      c.lineWidth = 2;
      c.strokeStyle = '#fff';
      c.setLineDash([2, 10]);
      c.lineDashOffset = -(t / 25) % 12;
      c.stroke();
      c.setLineDash([]);
    }
    [p, q].forEach((e) => {
      c.fillStyle = '#222';
      c.beginPath();
      c.arc(e.x, e.y, 4, 0, 7);
      c.fill();
    });
    c.lineCap = 'butt';
    if (w === selW) {
      const h = v || { x: 0.25 * p.x + 0.5 * m.x + 0.25 * q.x, y: 0.25 * p.y + 0.5 * m.y + 0.25 * q.y };
      c.beginPath();
      c.arc(h.x, h.y, 7, 0, 7);
      c.fillStyle = cs('--ac');
      c.fill();
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.stroke();
    }
  }
  function bbPart(c, n) {
    const t = n.type,
      h = hh(n),
      cx = n.x + W / 2,
      cy = n.y + h / 2,
      on = n.o[0],
      sl = sel.has(n),
      ic = isG(n) || DEF[t].ff;
    if (sl) {
      c.shadowColor = '#ff6d5a';
      c.shadowBlur = 18;
    }
    if (ic) {
      c.fillStyle = '#202226';
      c.beginPath();
      c.roundRect(n.x + 8, n.y, W - 16, h, 3);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#c9ccd1';
      for (let y = n.y + 4; y < n.y + h - 2; y += 9) {
        c.fillRect(n.x + 2, y, 8, 3);
        c.fillRect(n.x + W - 10, y, 8, 3);
      }
      c.fillStyle = '#07080a';
      c.beginPath();
      c.arc(cx, n.y, 5, 0, Math.PI);
      c.fill();
      c.fillStyle = '#eee';
      c.font = '600 9px monospace';
      c.fillText(IC(n), cx, cy);
    } else if (t == 'IN') {
      c.fillStyle = '#1a1b1e';
      c.beginPath();
      c.roundRect(cx - 17, cy - 17, 34, 34, 4);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = on ? '#6dff9a' : '#555';
      c.beginPath();
      c.arc(cx, cy, on ? 9 : 11, 0, 7);
      c.fill();
      c.fillStyle = '#c9ccd1';
      [
        [-17, -10],
        [-17, 10],
        [17, -10],
        [17, 10]
      ].forEach(([a, b]) => c.fillRect(cx + a - (a < 0 ? 5 : 0), cy + b - 1.5, 5, 3));
      res(c, n.x + 14, n.y + h + 12, 28, ['bn', 'bk', 'or']);
    } else if (t == 'LED') {
      c.shadowBlur = 0;
      res(c, n.x + 6, cy, 16, ['bn', 'bk', 'rd']);
      to92(c, n.x + 40, cy - 4);
      c.save();
      if (on) {
        c.shadowColor = '#ff5a5a';
        c.shadowBlur = 24;
      }
      c.fillStyle = on ? '#ff4d4d' : '#7a2b2b';
      c.beginPath();
      c.arc(n.x + W + 14, cy, 10, 0, 7);
      c.fill();
      c.restore();
      c.strokeStyle = '#eee';
      c.lineWidth = 1.5;
      c.stroke();
    } else if (t == 'CLK') {
      c.fillStyle = '#202226';
      c.beginPath();
      c.roundRect(n.x + 10, n.y + 2, W - 30, h - 4, 3);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#eee';
      c.font = '600 9px monospace';
      c.fillText('NE555', n.x + W / 2 - 10, cy);
      res(c, n.x + 10, n.y + h + 12, 24, ['bn', 'bk', 'or']);
    } else {
      c.fillStyle = '#e9b52a';
      c.beginPath();
      c.roundRect(n.x + 8, n.y, W - 8, h, 5);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = '#111';
      c.font = 'bold 11px monospace';
      c.fillText((on * vcc).toFixed(1) + 'V', cx + 4, cy);
    }
    c.shadowBlur = 0;
    c.font = 'bold 10px monospace';
    c.fillStyle = sl ? '#d9381e' : '#333';
    c.fillText(n.name, cx, n.y - 9);
    const hole = (p) => {
      c.fillStyle = '#222';
      c.beginPath();
      c.arc(p.x, p.y, 3.2, 0, 7);
      c.fill();
      c.strokeStyle = '#888';
      c.lineWidth = 1;
      c.stroke();
    };
    for (let i = 0; i < nI(n); i++) hole(ip(n, i));
    for (let i = 0; i < nO(n); i++) hole(op(n, i));
  }
  const bbL = () => BB || (BB = bbBuild()),
    bbB = () => bbL().b,
    bbHit = (p) =>
      bbL().items.find(
        (it) =>
          it.k == 'src' &&
          it.n.type == 'IN' &&
          p.x >= it.x &&
          p.x <= it.x + it.w &&
          p.y >= it.y &&
          p.y <= it.y + it.h
      );
  function bbBuild() {
    let N = 1;
    const nn = () => N++,
      cells = [],
      al = {},
      net = {},
      R = (x) => (al[x] !== undefined ? R(al[x]) : x),
      g = (k, ins, out) => {
        out = out ?? nn();
        cells.push({ k, ins, out });
        return out;
      };
    nodes.forEach((n) => {
      for (let i = 0; i < nO(n); i++) net[n.id + ':' + i] = nn();
    });
    const In = (n, i) => {
        const w = inMap.get(n.id * 64 + i);
        return w ? net[w.a + ':' + w.ap] : 0;
      },
      X2 = (a, b) => g('AND', [g('OR', [a, b]), g('NAND', [a, b])]);
    const lat = (en, d, q, qn) => {
      q = q ?? nn();
      qn = qn ?? nn();
      const nd = g('NOT', [d]),
        s = g('NAND', [d, en]),
        r = g('NAND', [nd, en]);
      g('NAND', [s, qn], q);
      g('NAND', [r, q], qn);
      return [q, qn];
    };
    const dff = (d, ck, q, qn) => {
      const m = lat(g('NOT', [ck]), d);
      return lat(ck, m[0], q, qn);
    };
    const ex = (n, I) => {
      const t = n.type;
      if (MULTI.has(t) || t == 'NOT' || t == 'BUF') {
        if (t == 'XOR' || t == 'XNOR') {
          const o = I.reduce((a, b) => X2(a, b));
          return [t == 'XOR' ? o : g('NOT', [o])];
        }
        return [t == 'BUF' ? g('NOT', [g('NOT', [I[0]])]) : g(t, I)];
      }
      if (t == 'D') return dff(I[0], I[1]);
      if (t == 'T') {
        const q = nn(),
          qn = nn();
        return dff(X2(I[0], q), I[1], q, qn);
      }
      if (t == 'JK') {
        const q = nn(),
          qn = nn();
        return dff(g('OR', [g('AND', [I[0], qn]), g('AND', [g('NOT', [I[2]]), q])]), I[1], q, qn);
      }
      if (t == 'SIPO') {
        let p = I[0];
        return [0, 1, 2, 3].map(() => (p = dff(p, I[1])[0]));
      }
      const nl = g('NOT', [I[4]]);
      let p = null;
      for (let i = 0; i < 4; i++) {
        const a = g('AND', [I[4], I[i]]);
        p = dff(p === null ? a : g('OR', [a, g('AND', [nl, p])]), I[5])[0];
      }
      return [p];
    };
    const src = [],
      snk = [],
      ownN = {};
    nodes.forEach((n) => {
      const t = n.type;
      if (t == 'IN' || t == 'CLK') src.push({ n, net: net[n.id + ':0'] });
      else if (t == 'LED' || t == 'METER') snk.push({ n, net: In(n, 0) });
      else
        ex(
          n,
          Array.from({ length: nI(n) }, (_, i) => In(n, i))
        ).forEach((p, i) => (al[net[n.id + ':' + i]] = p));
    });
    nodes.forEach((n) => {
      for (let i = 0; i < nO(n); i++) ownN[R(net[n.id + ':' + i])] = [n, i];
    });
    const dn = {};
    src.forEach((s) => (dn[s.net] = 0));
    cells.forEach((c) => {
      c.d = 1 + Math.max(0, ...c.ins.map((i) => dn[R(i)] ?? 0));
      dn[c.out] = c.d;
    });
    const items = [
        ...src.map((s) => ({ k: 'src', n: s.n, d: 0, w: 72, h: 64, net: s.net })),
        ...cells.map((c) => {
          const nt = c.k == 'NOT' ? 1 : /^N/.test(c.k) ? c.ins.length + 1 : c.ins.length;
          return { k: c.k, c, d: c.d, nt, w: nt * 26 + 30, h: 64, net: c.out };
        })
      ],
      D = Math.max(0, ...cells.map((c) => c.d));
    snk.forEach((s) => items.push({ k: 'snk', n: s.n, d: D + 1, w: 84, h: 64, net: s.net }));
    const cols = [];
    items.forEach((it) => (cols[it.d] = cols[it.d] || []).push(it));
    let x0 = 30,
      mh = 60;
    cols.forEach((col) => {
      if (!col) return;
      const cw = Math.max(...col.map((i) => i.w));
      col.forEach((it, r) => {
        it.x = x0;
        it.y = 34 + r * 92;
        mh = Math.max(mh, it.y + it.h);
      });
      x0 += cw + 80;
    });
    const own = {};
    items.forEach((it) => {
      if (it.k == 'src') {
        it.po = { x: it.x + it.w, y: it.y + it.h / 2 };
        it.pi = [];
      } else if (it.k == 'snk') it.pi = [{ x: it.x, y: it.y + it.h / 2 }];
      else {
        it.pi = it.c.ins.map((_, i) => ({ x: it.x - 2 + i * 26, y: it.y + 14 }));
        it.po = { x: it.x + it.w - 4, y: it.y + it.h - 8 };
      }
      if (it.po) own[it.net] = it.po;
    });
    const ws = [];
    items.forEach((it) =>
      it.pi.forEach((q, i) => {
        const nt = R(it.k == 'snk' ? it.net : it.c.ins[i]),
          p = own[nt];
        if (nt && p) ws.push({ p, q, nt, ref: ownN[nt] });
      })
    );
    return { items, ws, R, ownN, b: { x: 0, y: 0, w: x0 + 10, h: mh + 50 } };
  }
  function bbDraw(c, t) {
    const L = bbL();
    bbEval(L);
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    L.items.forEach((it) => {
      const { x, y, w, h } = it;
      c.font = 'bold 9px monospace';
      if (it.k == 'src') {
        const n = it.n,
          on = n.o[0];
        if (n.type == 'IN') {
          c.fillStyle = '#1a1b1e';
          c.beginPath();
          c.roundRect(x + 8, y + 8, 34, 34, 4);
          c.fill();
          c.fillStyle = on ? '#6dff9a' : '#555';
          c.beginPath();
          c.arc(x + 25, y + 25, on ? 9 : 11, 0, 7);
          c.fill();
          res(c, x + 8, y + h - 10, 24, ['bn', 'bk', 'or']);
        } else {
          c.fillStyle = '#202226';
          c.beginPath();
          c.roundRect(x + 6, y + 6, 42, 46, 3);
          c.fill();
          c.fillStyle = '#eee';
          c.fillText('NE555', x + 27, y + 26);
          res(c, x + 8, y + h - 8, 22, ['bn', 'bk', 'or']);
        }
        c.strokeStyle = '#999';
        c.lineWidth = 2;
        ln(c, x + 44, y + h / 2, it.po.x, it.po.y);
        c.fillStyle = '#d9381e';
        c.font = 'bold 9px monospace';
        c.fillText(n.name, x + w / 2, y - 4);
      } else if (it.k == 'snk') {
        const n = it.n,
          on = n.o[0];
        res(c, x + 6, y + h / 2, 16, ['bn', 'bk', 'rd']);
        if (n.type == 'LED') {
          c.save();
          if (on) {
            c.shadowColor = '#ff5a5a';
            c.shadowBlur = 22;
          }
          c.fillStyle = on ? '#ff4d4d' : '#7a2b2b';
          c.beginPath();
          c.arc(x + 54, y + h / 2, 12, 0, 7);
          c.fill();
          c.restore();
        } else {
          c.fillStyle = '#e9b52a';
          c.beginPath();
          c.roundRect(x + 30, y + 10, 50, 44, 5);
          c.fill();
          c.fillStyle = '#111';
          c.fillText((on * vcc).toFixed(1) + 'V', x + 55, y + 32);
        }
        c.fillStyle = '#d9381e';
        c.font = 'bold 9px monospace';
        c.fillText(n.name, x + w / 2, y - 4);
      } else {
        c.fillStyle = '#ebe8de';
        c.strokeStyle = '#bdb9ac';
        c.lineWidth = 1;
        c.beginPath();
        c.roundRect(x - 6, y - 8, w + 12, h + 16, 6);
        c.fill();
        c.stroke();
        c.fillStyle = '#d34b4b';
        c.fillRect(x - 6, y - 8, w + 12, 2.5);
        c.fillStyle = '#3b6fd0';
        c.fillRect(x - 6, y + h + 5.5, w + 12, 2.5);
        cellInner(c, it, t);
        c.font = 'bold 9px monospace';
        c.fillStyle = '#555';
        c.fillText(it.k + (it.c.ins.length > 1 ? it.c.ins.length : ''), x + w / 2, y - 14);
      }
      [...(it.pi || []), ...(it.po ? [it.po] : [])].forEach((p) => {
        c.fillStyle = '#222';
        c.beginPath();
        c.arc(p.x, p.y, 3.2, 0, 7);
        c.fill();
      });
    });
    L.ws.forEach((w) => jumper(c, { P: [w.p, w.q] }, { a: w.nt }, L.nv[w.nt], 0, t));
  }
  function bbEval(L) {
    let nv = L.nv;
    if (!nv) {
      nv = L.nv = {};
      for (const k in L.ownN) {
        const q = L.ownN[k];
        nv[k] = q[0].o[q[1]];
      }
    }
    L.items.forEach((it) => {
      if (it.k == 'src') nv[it.net] = it.n.o[0];
    });
    for (let p = 0; p < 4; p++)
      L.items.forEach((it) => {
        const c = it.c;
        if (c) nv[c.out] = FN[c.k](c.ins.map((i) => nv[L.R(i)] | 0));
      });
  }
  function cellInner(c, it, t) {
    const { x, y, w, h } = it,
      cd = it.c,
      k = cd.k,
      L = bbL(),
      nv = L.nv,
      iv = cd.ins.map((i) => nv[L.R(i)] | 0),
      nt = it.nt,
      inv = k == 'NOT' || /^N/.test(k),
      m = k == 'NOT' ? 0 : inv ? nt - 1 : nt,
      xs = (i) => x + 22 + i * 26,
      TB = y + 44,
      tA = y + 49,
      tB = y + 55,
      RY = y + 56,
      xn = x + w - 4,
      yv = y - 6.5,
      yg = y + h + 6.5,
      ser = /AND/.test(k),
      s1 = ser ? iv.every((v) => v) : iv.some((v) => v),
      cv = k == 'NOT' ? iv[0] : s1,
      ex = xs(Math.max(0, m - 1)) + 4;
    const P = (pts, on) => {
      c.beginPath();
      pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
      c.lineJoin = 'round';
      c.setLineDash([]);
      c.lineWidth = 3;
      c.strokeStyle = on ? '#ffb300' : '#8a8e96';
      c.stroke();
      if (on) {
        c.lineWidth = 1.6;
        c.strokeStyle = '#fff6c8';
        c.setLineDash([3, 7]);
        c.lineDashOffset = -(t / 25) % 10;
        c.stroke();
        c.setLineDash([]);
      }
    };
    for (let i = 0; i < nt; i++)
      P(
        [
          [xs(i), y + 14],
          [xs(i), TB]
        ],
        i < m ? iv[i] : cv
      );
    if (m) {
      if (ser) {
        P(
          [
            [x - 4, yv],
            [x - 4, tB],
            [xs(0) - 4, tB],
            [xs(0) - 4, TB]
          ],
          s1
        );
        for (let i = 0; i < m - 1; i++)
          P(
            [
              [xs(i) + 4, TB],
              [xs(i) + 4, tA],
              [xs(i + 1) - 4, tA],
              [xs(i + 1) - 4, TB]
            ],
            s1
          );
      } else {
        P(
          [
            [x - 4, yv],
            [x - 4, tB],
            [xs(m - 1) - 4, tB]
          ],
          s1
        );
        for (let i = 0; i < m; i++) {
          P(
            [
              [xs(i) - 4, tB],
              [xs(i) - 4, TB]
            ],
            iv[i]
          );
          P(
            [
              [xs(i) + 4, TB],
              [xs(i) + 4, tA]
            ],
            iv[i]
          );
        }
      }
      if (inv)
        P(
          ser
            ? [
                [ex, TB],
                [ex, y + 14]
              ]
            : [
                [xs(0) + 4, tA],
                [ex, tA],
                [ex, y + 14]
              ],
          s1
        );
      else {
        P(
          ser
            ? [
                [ex, TB],
                [ex, tA],
                [xn, tA],
                [xn, RY]
              ]
            : [
                [xs(0) + 4, tA],
                [xn, tA],
                [xn, RY]
              ],
          s1
        );
        P(
          [
            [x + w - 32, RY],
            [x + w - 32, yg]
          ],
          s1
        );
      }
    }
    if (inv) {
      const j = m;
      P(
        [
          [x + w - 32, yv],
          [x + w - 32, RY]
        ],
        cv
      );
      P(
        [
          [xn, RY],
          [xn, tA],
          [xs(j) - 4, tA],
          [xs(j) - 4, TB]
        ],
        cv
      );
      P(
        [
          [xs(j) + 4, TB],
          [xs(j) + 4, yg]
        ],
        cv
      );
    }
    for (let i = 0; i < nt; i++) res(c, x + 4 + i * 26, y + 14, 12, ['bn', 'bk', 'or']);
    res(c, x + w - 26, RY, 16, ['bn', 'bk', 'rd']);
    for (let i = 0; i < nt; i++) to92(c, xs(i), y + 34);
  }
  const BD = { bn: '#6b3b12', bk: '#111', rd: '#d22', or: '#f80' };
  function res(c, x, y, w, b) {
    c.strokeStyle = '#cfd2d6';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x - 6, y);
    c.lineTo(x + w + 6, y);
    c.stroke();
    c.fillStyle = '#d9c79a';
    c.beginPath();
    c.roundRect(x, y - 4, w, 8, 3);
    c.fill();
    b.forEach((k, i) => {
      c.fillStyle = BD[k];
      c.fillRect(x + 4 + (i * (w - 8)) / b.length, y - 4, 2.5, 8);
    });
  }
  function to92(c, x, y) {
    c.fillStyle = '#17181b';
    c.beginPath();
    c.arc(x, y, 7, Math.PI, 0);
    c.lineTo(x + 7, y + 3);
    c.lineTo(x - 7, y + 3);
    c.closePath();
    c.fill();
    c.strokeStyle = '#cfd2d6';
    c.lineWidth = 1.3;
    [-4, 0, 4].forEach((d) => {
      c.beginPath();
      c.moveTo(x + d, y + 3);
      c.lineTo(x + d, y + 10);
      c.stroke();
    });
    c.fillStyle = '#9ab';
    c.font = '5px monospace';
    c.fillText('BC547', x, y - 1);
  }
  function pcbPart(c, n) {
    const t = n.type,
      h = hh(n),
      cx = n.x + W / 2,
      cy = n.y + h / 2,
      on = n.o[0],
      sl = sel.has(n),
      ic = isG(n) || DEF[t].ff || DEF[t].reg;
    if (sl) {
      c.shadowColor = '#ffb26b';
      c.shadowBlur = 18;
    }
    c.strokeStyle = '#d9b24a';
    c.lineWidth = 3;
    c.beginPath();
    for (let i = 0; i < nI(n); i++) {
      const p = ip(n, i);
      c.moveTo(p.x, p.y);
      c.lineTo(p.x + 8, p.y);
    }
    for (let i = 0; i < nO(n); i++) {
      const p = op(n, i);
      c.moveTo(p.x, p.y);
      c.lineTo(p.x - 8, p.y);
    }
    c.stroke();
    c.lineWidth = sl ? 3 : 1.5;
    c.strokeStyle = sl ? '#ffb26b' : '#2c2f36';
    c.font = '600 9px monospace';
    if (ic) {
      c.strokeStyle = '#7a6320';
      c.lineWidth = 2;
      c.beginPath();
      for (let y = n.y + 5; y < n.y + h - 2; y += 9) {
        c.moveTo(n.x + 2, y);
        c.lineTo(n.x + 8, y);
        c.moveTo(n.x + W - 8, y);
        c.lineTo(n.x + W - 2, y);
      }
      c.stroke();
      c.lineWidth = sl ? 3 : 1.5;
      c.strokeStyle = sl ? '#ffb26b' : '#2c2f36';
      c.fillStyle = '#16181d';
      c.beginPath();
      c.roundRect(n.x + 8, n.y, W - 16, h, 3);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#07080a';
      c.beginPath();
      c.arc(cx, n.y, 5, 0, Math.PI);
      c.fill();
      c.fillStyle = '#9aa';
      c.beginPath();
      c.arc(n.x + 14, n.y + h - 8, 2, 0, 7);
      c.fill();
      c.fillStyle = '#eee';
      c.fillText(IC(n), cx, cy - 3);
      c.fillStyle = '#8a8f99';
      c.font = '7px monospace';
      c.fillText(t, cx, cy + 8);
      c.fillText('VCC', n.x + W - 18, n.y + 6);
      c.fillText('GND', n.x + 20, n.y + h - 6);
      c.fillStyle = '#e0a030';
      c.fillRect(cx - 6, n.y + h + 4, 12, 7);
    } else if (t == 'IN') {
      c.fillStyle = '#cfd3da';
      c.beginPath();
      c.roundRect(n.x + 14, cy - 10, W - 28, 20, 3);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#15171c';
      c.fillRect(on ? n.x + W - 34 : n.x + 18, cy - 7, 16, 14);
      c.fillStyle = '#333';
      c.fillText(on ? 'ON' : 'OFF', on ? n.x + 28 : n.x + W - 28, cy);
      res(c, n.x + 18, n.y + h + 10, 28, ['bn', 'bk', 'or']);
    } else if (t == 'CLK') {
      c.fillStyle = '#16181d';
      c.beginPath();
      c.roundRect(n.x + 10, n.y + 2, W - 30, h - 4, 3);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#eee';
      c.fillText('NE555', n.x + W / 2 - 10, cy);
      c.strokeStyle = '#d9b24a';
      c.beginPath();
      c.moveTo(n.x + W - 20, cy);
      c.lineTo(n.x + W, cy);
      c.stroke();
      res(c, n.x + 10, n.y + h + 10, 24, ['bn', 'bk', 'or']);
      c.fillStyle = '#5a7bd8';
      c.beginPath();
      c.arc(n.x + 54, n.y + h + 10, 5, 0, 7);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText('1µ', n.x + 54, n.y + h + 10);
    } else if (t == 'LED') {
      c.shadowBlur = 0;
      res(c, n.x + 8, cy, 14, ['bn', 'bk', 'rd']);
      to92(c, n.x + 40, cy - 4);
      c.save();
      if (on) {
        c.shadowColor = '#6dff9a';
        c.shadowBlur = 24;
      }
      c.fillStyle = on ? '#6dff9a' : '#25503a';
      c.beginPath();
      c.arc(n.x + W + 14, cy, 10, 0, 7);
      c.fill();
      c.restore();
      c.strokeStyle = '#e8f5ee';
      c.lineWidth = 2;
      c.stroke();
    } else {
      c.fillStyle = '#111';
      c.beginPath();
      c.roundRect(n.x + 8, n.y, W - 8, h, 4);
      c.fill();
      c.stroke();
      c.shadowBlur = 0;
      c.fillStyle = '#7cf';
      c.fillText('VOLT', cx + 4, n.y + 16);
      c.font = 'bold 12px monospace';
      c.fillText((on * vcc).toFixed(1) + 'V', cx + 4, cy + 6);
    }
    c.shadowBlur = 0;
    c.font = 'bold 10px monospace';
    c.fillStyle = sl ? '#ffb26b' : '#f5f5f5';
    c.fillText(n.name, cx, n.y - 9);
    pins(c, n, 1);
  }
  function chips() {
    const e = $('#chips');
    e.innerHTML = '';
    nodes.filter(isP).forEach((n) => {
      const b = document.createElement('button');
      b.textContent = n.name;
      b.className = n.hide ? 'off' : '';
      b.title = 'Show or hide this waveform';
      b.onclick = () => {
        n.hide ^= 1;
        chips();
      };
      e.append(b);
    });
  }
  function scope() {
    const r = sc.getBoundingClientRect(),
      w = r.width,
      h = r.height;
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.clearRect(0, 0, w, h);
    sg.textBaseline = 'middle';
    const ps = nodes.filter((n) => isP(n) && !n.hide),
      L = 88,
      dx = (w - L - 8) / win;
    sg.font = '11px system-ui,sans-serif';
    sg.fillStyle = cs('--mu');
    sg.textAlign = 'right';
    sg.fillText('High = ' + vcc + ' V · ' + win + ' steps', w - 8, 8);
    if (!ps.length) {
      sg.textAlign = 'left';
      sg.fillText('Waveforms appear here. Use the chips above to show or hide traces.', 10, h / 2);
      return;
    }
    sg.strokeStyle = cs('--grid');
    sg.lineWidth = 1;
    for (let j = 0; j <= win; j++)
      if ((((T0 - win + j) % 10) + 10) % 10 == 0) {
        const x = L + j * dx;
        sg.beginPath();
        sg.moveTo(x, 16);
        sg.lineTo(x, h);
        sg.stroke();
      }
    const rh = Math.min(46, (h - 18) / ps.length);
    ps.forEach((n, k) => {
      const y0 = 18 + k * rh,
        hi = y0 + 5,
        lo = y0 + rh - 9,
        an = RV && hv[n.id],
        hs = (an || hist[n.id] || []).slice(-win),
        off = win - hs.length;
      sg.textAlign = 'left';
      sg.fillStyle = cs('--tx');
      sg.font = '600 11px system-ui,sans-serif';
      sg.fillText(n.name, 8, y0 + rh / 2 - (rh >= 30 ? 6 : 0));
      sg.font = '10px system-ui,sans-serif';
      sg.fillStyle = cs('--mu');
      if (rh >= 30) sg.fillText((n.av && RV ? n.av[0] : n.o[0] * vcc).toFixed(2) + ' V', 8, y0 + rh / 2 + 8);
      if (an) {
        sg.save();
        sg.setLineDash([2, 3]);
        sg.strokeStyle = cs('--grid');
        [0.3, 0.7].forEach((f) => {
          const yy = lo - (lo - hi) * f;
          sg.beginPath();
          sg.moveTo(L, yy);
          sg.lineTo(L + win * dx, yy);
          sg.stroke();
        });
        sg.restore();
      }
      sg.beginPath();
      let py = 0;
      hs.forEach((v, i) => {
        const x = L + (off + i) * dx,
          y = an ? lo - (lo - hi) * Math.max(0, Math.min(1.05, v / vcc)) : v ? hi : lo;
        if (!i) sg.moveTo(x, y);
        else {
          if (!an) sg.lineTo(x, py);
          sg.lineTo(x, y);
        }
        py = y;
      });
      sg.lineTo(L + win * dx, py);
      sg.lineWidth = sel.has(n) ? 3 : 2;
      sg.strokeStyle = cs(n.type == 'CLK' ? '--ac' : '--hi');
      sg.stroke();
    });
  }
  /* ---------- analysis ---------- */
  const NM = (i) => String.fromCharCode(65 + i),
    tb = (hd, rows, cur, oc) =>
      '<table><tr>' +
      hd.map((h) => '<th>' + esc(h) + '</th>').join('') +
      '</tr>' +
      rows
        .map(
          (r, i) =>
            '<tr' +
            (i == cur ? ' class="cur"' : '') +
            '>' +
            r.map((x, j) => '<td' + (j >= oc ? ' class="o"' : '') + '>' + x + '</td>').join('') +
            '</tr>'
        )
        .join('') +
      '</table>';
  function qm(n, ms) {
    let cur = ms.map((m) => m.toString(2).padStart(n, '0')),
      pi = [];
    while (cur.length) {
      const nxs = new Set(),
        used = new Set();
      for (let i = 0; i < cur.length; i++)
        for (let j = i + 1; j < cur.length; j++) {
          let d = -1,
            ok = 1;
          for (let k = 0; k < n; k++)
            if (cur[i][k] != cur[j][k]) {
              if (cur[i][k] == '-' || cur[j][k] == '-' || d >= 0) {
                ok = 0;
                break;
              }
              d = k;
            }
          if (ok && d >= 0) {
            nxs.add(cur[i].slice(0, d) + '-' + cur[i].slice(d + 1));
            used.add(i);
            used.add(j);
          }
        }
      cur.forEach((c, i) => {
        if (!used.has(i)) pi.push(c);
      });
      cur = [...nxs];
    }
    const cov = (p) =>
      ms.filter((m) => {
        const b = m.toString(2).padStart(n, '0');
        return [...p].every((c, k) => c == '-' || c == b[k]);
      });
    let left = new Set(ms),
      res = [];
    pi = [...new Set(pi)];
    while (left.size) {
      let best = null,
        bc = 0;
      pi.forEach((p) => {
        const c = cov(p).filter((m) => left.has(m)).length;
        if (c > bc) {
          bc = c;
          best = p;
        }
      });
      if (!best) break;
      res.push(best);
      cov(best).forEach((m) => left.delete(m));
    }
    return res;
  }
  const sop = (names, ms) => {
    const n = names.length;
    if (!ms.length) return '0';
    if (ms.length == 1 << n) return '1';
    return qm(n, ms)
      .map((p) => [...p].map((c, k) => (c == '-' ? '' : esc(names[k]) + (c == '0' ? '′' : ''))).join('·'))
      .join(' + ');
  };
  function kmap(names, vals) {
    const n = names.length,
      rv = n >> 1,
      cn = n - rv,
      gr = (k) => [...Array(1 << k).keys()].map((i) => i ^ (i >> 1)),
      R = gr(rv),
      C = gr(cn),
      bs = (v, k) => (k ? v.toString(2).padStart(k, '0') : '');
    let h =
      '<table><tr><th>' +
      names.slice(0, rv).join('') +
      '\\' +
      names.slice(rv).join('') +
      '</th>' +
      C.map((c) => '<th>' + bs(c, cn) + '</th>').join('') +
      '</tr>';
    R.forEach((r) => {
      h +=
        '<tr><th>' +
        bs(r, rv) +
        '</th>' +
        C.map((c) => {
          const v = vals[(r << cn) | c];
          return '<td' + (v == 1 ? ' class="o"' : '') + '>' + v + '</td>';
        }).join('') +
        '</tr>';
    });
    return h + '</table>';
  }
  /**
   * Truth-table analysis of the selected part, or of the whole circuit when nothing is selected.
   */
  function model() {
    const o = one(),
      I = nodes.filter((n) => n.type == 'IN'),
      O = nodes.filter((n) => n.type == 'LED');
    if (o && isG(o)) {
      const n = MULTI.has(o.type) ? o.nin : 1;
      if (n > 6) return { err: 'Selected gate has more than 6 inputs.' };
      const names = [...Array(n)].map((_, i) => NM(i)),
        rows = [];
      for (let m = 0; m < 1 << n; m++) {
        const b = names.map((_, i) => (m >> (n - 1 - i)) & 1);
        rows.push({ b, o: [FN[o.type](b)] });
      }
      return { I: names, O: ['Y'], rows, part: o, cur: -1 };
    }
    if (!I.length || !O.length) return { err: 'Add switches and LEDs to analyse the circuit.' };
    if (I.length > 8) return { err: 'Analysis supports up to 8 switches.' };
    const snap = sn(),
      live = I.map((n) => n.v).join(''),
      rows = [];
    let cur = -1;
    for (let m = 0; m < 1 << I.length; m++) {
      rs(snap);
      const b = I.map((n, i) => (n.v = (m >> (I.length - 1 - i)) & 1));
      let pv;
      for (let s = 0; s < 40; s++) {
        pv = O.map((n) => n.o[0]);
        step(true);
      }
      rows.push({ b, o: O.map((n, i) => (n.o[0] != pv[i] ? '~' : n.o[0])) });
      if (b.join('') == live) cur = m;
    }
    rs(snap);
    return { I: I.map((n) => n.name), O: O.map((n) => n.name), rows, cur };
  }
  const CH = { D: 'Q⁺ = D', T: 'Q⁺ = T ⊕ Q', JK: 'Q⁺ = J·Q̄ + K̄·Q' },
    GE = {
      AND: 'A·B·…',
      OR: 'A + B + …',
      NAND: '(A·B·…)′',
      NOR: '(A + B + …)′',
      XOR: 'A ⊕ B ⊕ …',
      XNOR: '(A ⊕ B ⊕ …)′',
      NOT: 'A′',
      BUF: 'A'
    };
  function ffHTML() {
    const o = one(),
      F = nodes.filter((n) => DEF[n.type].ff),
      ts = [...new Set(o && DEF[o.type].ff ? [o.type] : F.map((n) => n.type))];
    if (!ts.length)
      return '<p class="mu">Add a D, T or JK flip-flop to see its function table, characteristic equation and excitation table.</p>';
    return ts
      .map((t) => {
        const jk = t == 'JK',
          hd = jk ? ['J', 'K', 'Q', 'Q⁺'] : [t, 'Q', 'Q⁺'],
          rows = [];
        for (let a = 0; a < (jk ? 4 : 2); a++)
          for (let q = 0; q < 2; q++)
            rows.push((jk ? [a >> 1, a & 1] : [a]).concat([q, nx(t, jk ? a >> 1 : a, jk ? a & 1 : 0, q)]));
        const ex = [
          [0, 0],
          [0, 1],
          [1, 0],
          [1, 1]
        ].map(([q, q2]) =>
          [q, q2].concat(
            t == 'D'
              ? [q2]
              : t == 'T'
                ? [q ^ q2]
                : [
                    ['0', 'X'],
                    ['1', 'X'],
                    ['X', '1'],
                    ['X', '0']
                  ][q * 2 + q2]
          )
        );
        return (
          '<p><b>' +
          t +
          ' flip-flop</b></p><p>Characteristic equation: <b>' +
          CH[t] +
          '</b></p>' +
          tb(hd, rows, -1, hd.length - 1) +
          '<p class="mu">Excitation table</p>' +
          tb(['Q', 'Q⁺'].concat(jk ? ['J', 'K'] : [t]), ex, -1, 2)
        );
      })
      .join('');
  }
  function svgSt(L, E) {
    const N = L.length,
      P = L.map((_, i) =>
        N == 2
          ? { x: 60 + i * 120, y: 100 }
          : {
              x: 130 + 85 * Math.cos((2 * Math.PI * i) / N - Math.PI / 2),
              y: 110 + 85 * Math.sin((2 * Math.PI * i) / N - Math.PI / 2)
            }
      ),
      M = new Map();
    E.forEach(([s, t, l]) => {
      const k = s + '>' + t;
      M.set(k, (M.get(k) || []).concat(l));
    });
    let h =
      '<svg class="st" viewBox="0 0 260 ' +
      (N == 2 ? 200 : 230) +
      '" stroke="currentColor" fill="none"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="currentColor" stroke="none"/></marker></defs>';
    P.forEach(
      (p, i) =>
        (h +=
          '<circle cx="' +
          p.x +
          '" cy="' +
          p.y +
          '" r="17"/><text x="' +
          p.x +
          '" y="' +
          (p.y + 4) +
          '" text-anchor="middle" fill="currentColor" stroke="none" font-size="11">' +
          esc(L[i]) +
          '</text>')
    );
    M.forEach((ls, k) => {
      const [s, t] = k.split('>').map(Number),
        a = P[s],
        b = P[t],
        lb = esc([...new Set(ls)].join(' '));
      if (s == t) {
        const ux = a.x - 130 || 0,
          uy = a.y - 110 || -1,
          l = Math.hypot(ux, uy) || 1,
          ox = ux / l,
          oy = uy / l;
        h +=
          '<path d="M' +
          (a.x + ox * 14 - oy * 8) +
          ' ' +
          (a.y + oy * 14 + ox * 8) +
          'C' +
          (a.x + ox * 46 - oy * 26) +
          ' ' +
          (a.y + oy * 46 + ox * 26) +
          ' ' +
          (a.x + ox * 46 + oy * 26) +
          ' ' +
          (a.y + oy * 46 - ox * 26) +
          ' ' +
          (a.x + ox * 14 + oy * 8) +
          ' ' +
          (a.y + oy * 14 - ox * 8) +
          '" marker-end="url(#ah)"/><text x="' +
          (a.x + ox * 52) +
          '" y="' +
          (a.y + oy * 52) +
          '" text-anchor="middle" fill="currentColor" stroke="none" font-size="9">' +
          lb +
          '</text>';
      } else {
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2,
          dx = b.x - a.x,
          dy = b.y - a.y,
          l = Math.hypot(dx, dy),
          cx = mx - (dy / l) * 22,
          cy = my + (dx / l) * 22,
          sh = (p, q) => {
            const d = Math.hypot(q.x - p.x, q.y - p.y);
            return { x: p.x + ((q.x - p.x) / d) * 18, y: p.y + ((q.y - p.y) / d) * 18 };
          },
          s1 = sh(a, { x: cx, y: cy }),
          e1 = sh(b, { x: cx, y: cy });
        h +=
          '<path d="M' +
          s1.x +
          ' ' +
          s1.y +
          'Q' +
          cx +
          ' ' +
          cy +
          ' ' +
          e1.x +
          ' ' +
          e1.y +
          '" marker-end="url(#ah)"/><text x="' +
          (cx * 0.5 + mx * 0.5) +
          '" y="' +
          (cy * 0.5 + my * 0.5) +
          '" text-anchor="middle" fill="currentColor" stroke="none" font-size="9">' +
          lb +
          '</text>';
      }
    });
    return h + '</svg>';
  }
  function trans() {
    const F = nodes.filter((n) => DEF[n.type].ff),
      C = nodes.filter((n) => n.type == 'CLK'),
      I = nodes.filter((n) => n.type == 'IN').slice(0, 3);
    if (!F.length || !C.length || F.length > 4) return null;
    const snap = sn(),
      E = [],
      k = F.length;
    for (let s = 0; s < 1 << k; s++)
      for (let c = 0; c < 1 << I.length; c++) {
        rs(snap);
        C.forEach((n) => (n.v = 0));
        F.forEach((n, i) => {
          n.q = (s >> (k - 1 - i)) & 1;
          n.o = [n.q, 1 - n.q];
          n.pc = 0;
        });
        I.forEach((n, i) => (n.v = (c >> (I.length - 1 - i)) & 1));
        for (let t = 0; t < 24; t++) step(true);
        C.forEach((n) => (n.v = 1));
        for (let t = 0; t < 6; t++) step(true);
        C.forEach((n) => (n.v = 0));
        for (let t = 0; t < 6; t++) step(true);
        E.push([s, F.reduce((a, n) => a * 2 + n.q, 0), c]);
      }
    rs(snap);
    return { F, I, E };
  }
  function stHTML() {
    const o = one();
    if (o && DEF[o.type].ff) {
      const t = o.type;
      return (
        '<p class="mu">' +
        t +
        ' flip-flop state diagram (per clock edge)</p>' +
        svgSt(
          ['Q=0', 'Q=1'],
          t == 'D'
            ? [
                [0, 0, 'D=0'],
                [0, 1, 'D=1'],
                [1, 0, 'D=0'],
                [1, 1, 'D=1']
              ]
            : t == 'T'
              ? [
                  [0, 0, 'T=0'],
                  [0, 1, 'T=1'],
                  [1, 1, 'T=0'],
                  [1, 0, 'T=1']
                ]
              : [
                  [0, 0, 'J=0'],
                  [0, 1, 'J=1'],
                  [1, 1, 'K=0'],
                  [1, 0, 'K=1']
                ]
        )
      );
    }
    const T = trans();
    if (!T)
      return '<p class="mu">Needs 1–4 flip-flops and a clock. Select a single flip-flop to see its own diagram.</p>';
    const k = T.F.length,
      ni = T.I.length,
      bs = (v, n) => (n ? v.toString(2).padStart(n, '0') : '—');
    return (
      '<p class="mu">State = ' +
      T.F.map((n) => esc(n.name)).join('') +
      (ni ? ' · inputs = ' + T.I.map((n) => esc(n.name)).join('') : '') +
      '</p>' +
      svgSt(
        [...Array(1 << k).keys()].map((s) => bs(s, k)),
        T.E.map(([s, t, c]) => [s, t, bs(c, ni)])
      ) +
      '<p class="mu">State table</p>' +
      tb(
        ['State'].concat(
          T.I.map((n) => n.name),
          ['Next']
        ),
        T.E.map(([s, t, c]) => [bs(s, k)].concat(ni ? bs(c, ni).split('') : [], [bs(t, k)])),
        -1,
        ni + 1
      )
    );
  }
  function render() {
    const e = $('#an');
    let h = '';
    if (tab == 'ff') h = ffHTML();
    else if (tab == 'st') h = stHTML();
    else {
      const M = model();
      if (M.err) h = '<p class="mu">' + M.err + '</p>';
      else if (tab == 'tt')
        h =
          '<p class="mu">' +
          (M.part
            ? esc(M.part.name) + ' · ' + M.part.type + ' gate truth table'
            : 'Final circuit truth table') +
          '</p>' +
          tb(
            M.I.concat(M.O),
            M.rows.map((r) => r.b.concat(r.o)),
            M.cur,
            M.I.length
          ) +
          (M.part
            ? ''
            : '<p class="mu">~ = oscillating. Latches and flip-flops start from their stored state.</p>');
      else if (tab == 'eq')
        h =
          (M.part ? '<p>Y = <b>' + GE[M.part.type] + '</b></p>' : '') +
          M.O.map(
            (o, j) =>
              '<p><b>' +
              esc(o) +
              '</b> = ' +
              sop(
                M.I,
                M.rows.map((r, i) => (r.o[j] == 1 ? i : -1)).filter((i) => i >= 0)
              ) +
              '</p>'
          ).join('') +
          (nodes.some((n) => DEF[n.type].ff)
            ? '<p class="mu">Minimised sum-of-products of the combinational view.</p>'
            : '');
      else
        h =
          M.I.length > 4
            ? '<p class="mu">K-map supports up to 4 inputs.</p>'
            : M.O.map(
                (o, j) =>
                  '<p><b>' +
                  esc(o) +
                  '</b></p>' +
                  kmap(
                    M.I,
                    M.rows.map((r) => r.o[j])
                  )
              ).join('');
    }
    e.innerHTML = h;
  }
  /* ---------- selection & inspector ---------- */
  function changed() {
    dirty = true;
    insp();
    commit();
  }
  function insp() {
    const e = $('#insp'),
      n = one();
    if (selW && !sel.size) {
      e.innerHTML =
        '<p class="mu">Wire selected. Drag anywhere on it to move it; the route adapts.</p><button id="rr">Reset route</button> <button id="dl">Delete wire</button>';
      $('#rr').onclick = () => {
        delete selW.mx;
        delete selW.my;
        delete selW.via;
      };
      $('#dl').onclick = delSel;
      return;
    }
    if (!sel.size && !selN.size) {
      e.innerHTML =
        '<p class="mu">' +
        (exampleNote(cur) ||
          'Nothing selected: showing the whole circuit. Click a part for its own tables.') +
        '</p>';
      return;
    }
    if (!n) {
      const gr = groups.find(
        (g) =>
          g.ids.length == sel.size &&
          g.nids.length == selN.size &&
          g.ids.every((i) => sel.has(idm.get(i))) &&
          g.nids.every((i) => [...selN].some((a) => a.id == i))
      );
      e.innerHTML =
        '<p>' +
        (sel.size + selN.size) +
        ' items selected (parts and drawings)</p>' +
        (gr
          ? '<label>Group <input type="text" id="gn" maxlength="20" size="12"></label><button id="ug">Ungroup</button> '
          : '<button id="gp">Group</button> ') +
        '<button id="du">Duplicate</button> <button id="dl">Delete</button>';
      if (gr) {
        $('#gn').value = gr.name;
        $('#gn').oninput = (ev) => {
          gr.name = ev.target.value;
          dirty = true;
        };
        $('#ug').onclick = ungroup;
      } else $('#gp').onclick = group;
      $('#du').onclick = dup;
      $('#dl').onclick = delSel;
      return;
    }
    const c = n.type == 'CLK',
      p = !['IN', 'CLK', 'LED'].includes(n.type),
      m = MULTI.has(n.type);
    e.innerHTML =
      '<label>Name <input type="text" id="nm" maxlength="8" size="8"></label>' +
      (m ? '<label>Inputs <input type="number" id="ni" min="2" max="16" style="width:64px"></label>' : '') +
      (c
        ? '<label>Period <input type="range" id="pe" min="4" max="200" step="2" style="width:100px"><span id="pv" class="mu"></span></label>'
        : '') +
      (DEF[n.type].ff
        ? '<label>Trigger <select id="tg"><option value="R">Rising edge ↑</option><option value="F">Falling edge ↓</option><option value="H">Level high</option><option value="L">Level low</option></select></label>'
        : '') +
      (p ? '<label><input type="checkbox" id="pb"> Show on scope</label>' : '') +
      (isG(n) || DEF[n.type].ff ? '<p class="mu" id="ic"></p>' : '') +
      '<button id="dl">Delete part</button>';
    $('#nm').value = n.name;
    $('#nm').oninput = (ev) => {
      n.name = ev.target.value;
      dirty = true;
    };
    const ic = () => {
      if ($('#ic')) $('#ic').textContent = 'PCB part: ' + IC(n);
    };
    ic();
    if (m) {
      $('#ni').value = n.nin;
      $('#ni').oninput = (ev) => {
        const v = Math.max(2, Math.min(16, +ev.target.value || 2));
        n.nin = v;
        wires = wires.filter((w) => !(w.b == n.id && w.bp >= v));
        reindex();
        ic();
        dirty = true;
      };
    }
    if (c) {
      const f = () => ($('#pv').textContent = n.per + ' steps');
      $('#pe').value = n.per;
      f();
      $('#pe').oninput = (ev) => {
        n.per = +ev.target.value;
        f();
      };
    }
    if ($('#tg')) {
      $('#tg').value = n.trig;
      $('#tg').onchange = (ev) => {
        n.trig = ev.target.value;
        dirty = true;
      };
    }
    if (p) {
      $('#pb').checked = !!n.probe;
      $('#pb').onchange = (ev) => {
        n.probe = ev.target.checked ? 1 : 0;
        chips();
      };
    }
    $('#dl').onclick = delSel;
  }
  /**
   * Delete the selected parts, drawings or wire.
   */
  function delSel() {
    if (selN.size) {
      notes = notes.filter((a) => !selN.has(a));
      selN = new Set();
    }
    if (selW && !sel.size) {
      wires = wires.filter((w) => w !== selW);
      selW = null;
    } else {
      wires = wires.filter((w) => !sel.has(idm.get(w.a)) && !sel.has(idm.get(w.b)));
      nodes = nodes.filter((n) => !sel.has(n));
      sel = new Set();
    }
    reindex();
    changed();
  }
  /**
   * Duplicate the selection (parts, internal wires, drawings and groups).
   */
  function dup() {
    const map = new Map();
    [...sel].forEach((n) => {
      const c = add(n.type, n.x + 30, n.y + 30);
      Object.assign(c, { nin: n.nin, per: n.per, v: n.v, trig: n.trig });
      c.name = n.name + '’';
      map.set(n.id, c);
    });
    wires
      .filter((w) => map.has(w.a) && map.has(w.b))
      .forEach((w) => link(map.get(w.a), w.ap, map.get(w.b), w.bp));
    const nm = new Map();
    [...selN].forEach((a) => {
      const c = JSON.parse(JSON.stringify(a));
      c.id = uid++;
      mvNote(c, a, 30, 30);
      notes.push(c);
      nm.set(a.id, c);
    });
    groups
      .filter((g) => g.ids.every((i) => map.has(i)) && g.nids.every((i) => nm.has(i)))
      .forEach((g) =>
        groups.push({
          id: uid++,
          name: g.name + '’',
          ids: g.ids.map((i) => map.get(i).id),
          nids: g.nids.map((i) => nm.get(i).id)
        })
      );
    sel = new Set(map.values());
    selN = new Set(nm.values());
    changed();
  }
  function selAll() {
    sel = new Set(nodes);
    selN = new Set(notes.filter((a) => lyOK(layerOf(a))));
    selW = null;
    changed();
  }
  function segD(p, a, b) {
    const dx = b.x - a.x,
      dy = b.y - a.y,
      l = dx * dx + dy * dy,
      t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function wireAt(p) {
    for (const w of wires) {
      const a = idm.get(w.a),
        b = idm.get(w.b);
      if (!a || !b) continue;
      const P = route(w, op(a, w.ap), ip(b, w.bp)).P;
      for (let i = 0; i < P.length - 1; i++)
        if (segD(p, P[i], P[i + 1]) < 7 / Math.max(0.6, view.s)) return w;
    }
  }
  function nodeAt(p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (p.x >= n.x && p.x <= n.x + W && p.y >= n.y && p.y <= n.y + hh(n)) return n;
    }
  }
  function pinHit(p) {
    for (const n of nodes) {
      for (let i = 0; i < nO(n); i++) {
        const q = op(n, i);
        if (Math.hypot(q.x - p.x, q.y - p.y) < PR) return { n, i, out: 1 };
      }
      for (let i = 0; i < nI(n); i++) {
        const q = ip(n, i);
        if (Math.hypot(q.x - p.x, q.y - p.y) < PR) return { n, i, out: 0 };
      }
    }
  }
  function menu(x, y, items) {
    const m = $('#cm');
    m.innerHTML = '';
    items.forEach(([l, f]) => {
      const b = document.createElement('button');
      b.textContent = l;
      b.onclick = () => {
        m.hidden = true;
        f();
      };
      m.append(b);
    });
    m.hidden = false;
    const r = $('#wrk').getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x - r.left, r.width - 170)) + 'px';
    m.style.top = Math.max(4, Math.min(y - r.top, r.height - items.length * 34 - 8)) + 'px';
  }
  function ctx(x, y, p) {
    const n = nodeAt(p),
      w = n ? null : wireAt(p);
    if (n) {
      if (!sel.has(n)) {
        const gp = pickSet(n, 0, 0);
        sel = new Set(gp.ns);
        selN = new Set(gp.as);
        selW = null;
        changed();
      }
      const o = one(),
        it = [
          ['Duplicate', dup],
          ['Group', group],
          ['Ungroup', ungroup],
          ['Delete', delSel],
          [
            'Disconnect wires',
            () => {
              wires = wires.filter((w) => !sel.has(idm.get(w.a)) && !sel.has(idm.get(w.b)));
              reindex();
              dirty = true;
            }
          ]
        ];
      if ((o && isP(o)) || o)
        it.push([
          'Toggle waveform',
          () => {
            [...sel].forEach((n) => (n.probe ^= 1));
            chips();
          }
        ]);
      if (o && MULTI.has(o.type)) {
        it.push(
          [
            '+ Input',
            () => {
              o.nin = Math.min(16, o.nin + 1);
              insp();
              dirty = true;
            }
          ],
          [
            '− Input',
            () => {
              o.nin = Math.max(2, o.nin - 1);
              wires = wires.filter((w) => !(w.b == o.id && w.bp >= o.nin));
              reindex();
              insp();
              dirty = true;
            }
          ]
        );
      }
      menu(x, y, it);
    } else if (w) {
      selW = w;
      sel = new Set();
      changed();
      menu(x, y, [
        ['Delete wire', delSel],
        [
          'Reset route',
          () => {
            delete w.mx;
            delete w.my;
            delete w.via;
          }
        ]
      ]);
    } else {
      const a = noteAt(p);
      if (a) {
        if (!selN.has(a)) {
          const gp = pickSet(a, 1, 0);
          sel = new Set(gp.ns);
          selN = new Set(gp.as);
          changed();
        }
        menu(x, y, [
          ['Duplicate', dup],
          ['Group', group],
          ['Ungroup', ungroup],
          ['Delete', delSel]
        ]);
      } else
        menu(x, y, [
          ['Select all', selAll],
          ['Fit to screen', fitView]
        ]);
    }
  }
  /* ---------- view ---------- */
  const vis = () => (cv.offsetParent ? cv : pc).getBoundingClientRect();
  function zoom(f, cx, cy, c) {
    (c ? [c] : [cv, pc].slice(0, vw.length)).forEach((k) => {
      view = V[k === cv ? 0 : 1];
      const r = k.getBoundingClientRect(),
        x = cx ?? r.width / 2,
        y = cy ?? r.height / 2,
        s = Math.max(0.15, Math.min(3, view.s * f)),
        q = s / view.s;
      view.x = x - (x - view.x) * q;
      view.y = y - (y - view.y) * q;
      view.s = s;
    });
  }
  function fitView() {
    [cv, pc].slice(0, vw.length).forEach((k) => {
      view = V[k === cv ? 0 : 1];
      const r = k.getBoundingClientRect(),
        B = vw[k === cv ? 0 : 1] == 'bb' ? bbB() : bbox(30, 40),
        s = Math.min(1.5, r.width / B.w, r.height / B.h);
      view.s = s;
      view.x = (r.width - B.w * s) / 2 - B.x * s;
      view.y = (r.height - B.h * s) / 2 - B.y * s;
    });
  }
  /* ---------- switches and push buttons ---------- */
  /**
   * A push button is a switch part with `mom` set: it outputs 1 only while it is held down.
   * `held` maps a pointer to the button it is pressing; a press shorter than one simulation tick is kept
   * until the next tick so the circuit always sees it at least once.
   */
  const held = new Map(),
    late = [];
  let tickN = 0;
  function setSw(n, v) {
    v = v ? 1 : 0;
    if (n.v === v) return;
    n.v = v;
    dirty = true;
    if (HOOK.sw) HOOK.sw(n, v);
  }
  function pressBtn(id, n) {
    if (held.has(id)) return;
    held.set(id, { n, tk: tickN });
    setSw(n, 1);
  }
  function releaseBtn(id) {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    if (h.tk === tickN && run && power) late.push(h.n);
    else setSw(h.n, 0);
  }
  function releaseLate() {
    while (late.length) {
      const n = late.shift();
      if (![...held.values()].some((h) => h.n === n)) setSw(n, 0);
    }
  }
  addEventListener('blur', () => [...held.keys()].forEach(releaseBtn));
  /* ---------- pointer ---------- */
  const ptr = new Map();
  let pd = 0;
  function bind(c) {
    const pos = (e) => {
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left - view.x) / view.s, y: (e.clientY - r.top - view.y) / view.s };
    };
    c.onpointerdown = (e) => {
      view = V[c === cv ? 0 : 1];
      if (e.button == 2) return;
      c.setPointerCapture(e.pointerId);
      ptr.set(e.pointerId, e);
      PR = e.pointerType == 'touch' ? 16 : 10;
      if (ptr.size == 2) {
        drag = marq = pan = hd = null;
        pd = 0;
        clearTimeout(lp);
        return;
      }
      if ((c === cv ? vw[0] : vw[1]) == 'bb') {
        const p = pos(e),
          h = bbHit(p);
        if (h) {
          if (h.n.mom) pressBtn(e.pointerId, h.n);
          else setSw(h.n, h.n.v ^ 1);
        } else pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
        return;
      }
      if (RO) {
        // View-only: press switches and buttons, otherwise just pan.
        const q = pos(e),
          hit = nodeAt(q);
        if (hit && hit.type == 'IN') {
          if (hit.mom) pressBtn(e.pointerId, hit);
          else setSw(hit, hit.v ^ 1);
        } else pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
        return;
      }
      if (DT.includes(tool)) {
        nStart(pos(e));
        return;
      }
      const p = (mouse = pos(e)),
        ph = pinHit(p),
        add_ = e.shiftKey || e.ctrlKey || e.metaKey;
      if (e.pointerType == 'touch') {
        clearTimeout(lp);
        lp = setTimeout(() => {
          if ((drag && !drag.m) || !drag) ctx(e.clientX, e.clientY, p);
        }, 550);
      }
      if (selW) {
        const a = idm.get(selW.a),
          b = idm.get(selW.b);
        if (a && b) {
          const h = route(selW, op(a, selW.ap), ip(b, selW.bp)).h;
          if (Math.hypot(h.x - p.x, h.y - p.y) < 12) {
            hd = selW;
            hd.s0 = p;
            return;
          }
        }
      }
      if (pend) {
        if (ph && !ph.out) {
          link(pend.n, pend.i, ph.n, ph.i);
          pend = null;
          return;
        }
        pend = null;
      }
      if (ph) {
        if (ph.out) pend = { n: ph.n, i: ph.i, sx: p.x, sy: p.y };
        else {
          const w = inMap.get(ph.n.id * 64 + ph.i);
          if (w) {
            wires = wires.filter((x) => x !== w);
            reindex();
            pend = { n: idm.get(w.a), i: w.ap, sx: p.x, sy: p.y };
            dirty = true;
          }
        }
        return;
      }
      const n = nodeAt(p);
      if (n) {
        selW = null;
        const gp = pickSet(n, 0, e.altKey);
        if (add_) {
          const h = sel.has(n);
          gp.ns.forEach((q) => (h ? sel.delete(q) : sel.add(q)));
          gp.as.forEach((q) => (h ? selN.delete(q) : selN.add(q)));
        } else if (!sel.has(n)) {
          sel = new Set(gp.ns);
          selN = new Set(gp.as);
        }
        if (n.type == 'IN' && n.mom && !add_) pressBtn(e.pointerId, n);
        drag = {
          hit: n,
          L: [...sel].map((q) => [q, q.x, q.y]),
          N: [...selN].map((a) => [a, JSON.stringify(a)]),
          px: p.x,
          py: p.y,
          m: 0,
          sh: add_
        };
        changed();
        return;
      }
      const na = noteAt(p);
      if (na) {
        selW = null;
        const gp = pickSet(na, 1, e.altKey);
        if (add_) {
          const h = selN.has(na);
          gp.ns.forEach((q) => (h ? sel.delete(q) : sel.add(q)));
          gp.as.forEach((q) => (h ? selN.delete(q) : selN.add(q)));
        } else if (!selN.has(na)) {
          sel = new Set(gp.ns);
          selN = new Set(gp.as);
        }
        drag = {
          hit: na,
          isN: 1,
          L: [...sel].map((q) => [q, q.x, q.y]),
          N: [...selN].map((a) => [a, JSON.stringify(a)]),
          px: p.x,
          py: p.y,
          m: 0,
          sh: add_
        };
        changed();
        return;
      }
      const w = wireAt(p);
      if (w) {
        selW = w;
        sel = new Set();
        changed();
        hd = w;
        hd.s0 = p;
        return;
      }
      if (tool == 'pan' || e.button == 1) {
        pan = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
      } else {
        if (!add_) {
          sel = new Set();
          selN = new Set();
        }
        selW = null;
        marq = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: add_ };
        changed();
      }
    };
    c.onpointermove = (e) => {
      view = V[c === cv ? 0 : 1];
      if (HOOK.cursor && c === cv) {
        const q = pos(e);
        HOOK.cursor(q.x, q.y);
      }
      if (ptr.has(e.pointerId)) ptr.set(e.pointerId, e);
      if (ptr.size == 2) {
        const [a, b] = [...ptr.values()],
          d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          r = c.getBoundingClientRect();
        if (pd) zoom(d / pd, (a.clientX + b.clientX) / 2 - r.left, (a.clientY + b.clientY) / 2 - r.top, c);
        pd = d;
        return;
      }
      const p = (mouse = pos(e));
      if (dr) {
        nMove(p);
        return;
      }
      if (hd) {
        if (Math.hypot(p.x - hd.s0.x, p.y - hd.s0.y) > 4)
          hd.via = { x: Math.round(p.x / 6) * 6, y: Math.round(p.y / 6) * 6 };
        return;
      }
      if (drag) {
        if (Math.hypot(p.x - drag.px, p.y - drag.py) > 3) {
          drag.m = 1;
          clearTimeout(lp);
        }
        if (drag.m) {
          drag.L.forEach(([n, x, y]) => {
            n.x = gs(x + p.x - drag.px);
            n.y = gs(y + p.y - drag.py);
          });
          const dx = gs(p.x - drag.px),
            dy = gs(p.y - drag.py);
          (drag.N || []).forEach(([a, o]) => mvNote(a, JSON.parse(o), dx, dy));
        }
      }
      if (marq) {
        marq.x1 = p.x;
        marq.y1 = p.y;
        const a = Math.min(marq.x0, marq.x1),
          b = Math.max(marq.x0, marq.x1),
          c0 = Math.min(marq.y0, marq.y1),
          d = Math.max(marq.y0, marq.y1);
        if (!marq.add) {
          sel = new Set();
          selN = new Set();
        }
        nodes.forEach((n) => {
          if (n.x < b && n.x + W > a && n.y < d && n.y + hh(n) > c0) sel.add(n);
        });
        notes.forEach((q) => {
          const bx = nBox(q);
          if (lyOK(layerOf(q)) && bx[0] < b && bx[2] > a && bx[1] < d && bx[3] > c0) selN.add(q);
        });
      }
      if (pan) {
        view.x = pan.ox + e.clientX - pan.x;
        view.y = pan.oy + e.clientY - pan.y;
      }
    };
    c.onpointerup = (e) => {
      view = V[c === cv ? 0 : 1];
      ptr.delete(e.pointerId);
      releaseBtn(e.pointerId);
      clearTimeout(lp);
      if (ptr.size < 2) pd = 0;
      const p = pos(e);
      if (dr) {
        nEnd();
        return;
      }
      if (pend && Math.hypot(p.x - pend.sx, p.y - pend.sy) > 14) {
        const ph = pinHit(p);
        if (ph && !ph.out) link(pend.n, pend.i, ph.n, ph.i);
        pend = null;
      }
      if (drag && !drag.m && !drag.sh) {
        const gp = pickSet(drag.hit, drag.isN, e.altKey);
        sel = new Set(gp.ns);
        selN = new Set(gp.as);
        if (!drag.isN && drag.hit.type == 'IN' && !drag.hit.mom) setSw(drag.hit, drag.hit.v ^ 1);
        changed();
      }
      if (marq) changed();
      drag = marq = pan = hd = null;
      commit();
    };
    c.onpointercancel = c.onpointerup;
    c.oncontextmenu = (e) => {
      e.preventDefault();
      if (RO) return;
      view = V[c === cv ? 0 : 1];
      if ((c === cv ? vw[0] : vw[1]) != 'bb') ctx(e.clientX, e.clientY, pos(e));
    };
    c.onwheel = (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      view = V[c === cv ? 0 : 1];
      zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top, c);
    };
  }
  bind(cv);
  bind(pc);
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (!e.target.closest('#cm')) $('#cm').hidden = true;
    },
    true
  );
  onkeydown = (e) => {
    if (document.activeElement.tagName == 'INPUT' || document.activeElement.tagName == 'TEXTAREA') return;
    if (RO) return;
    const k = e.key.toLowerCase(),
      m = e.ctrlKey || e.metaKey;
    if (m && k == 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (m && k == 'y') {
      e.preventDefault();
      redo();
    } else if (m && k == 'g') {
      e.preventDefault();
      e.shiftKey ? ungroup() : group();
    } else if (m && k == 's') {
      e.preventDefault();
      save();
    } else if (k == 'delete' || k == 'backspace') {
      e.preventDefault();
      delSel();
    } else if (m && k == 'a') {
      e.preventDefault();
      selAll();
    } else if (m && k == 'd') {
      e.preventDefault();
      dup();
    } else if (k == 'escape') {
      pend = null;
      sel = new Set();
      selN = new Set();
      selW = null;
      changed();
    }
  };
  /* ---------- UI wiring ---------- */
  function icon(t) {
    const k = document.createElement('canvas');
    k.width = 80;
    k.height = 60;
    k.style.cssText = 'width:36px;height:27px';
    const c = k.getContext('2d');
    c.scale(2, 2);
    c.lineWidth = 1.6;
    c.strokeStyle = c.fillStyle = cs('--tx');
    c.lineJoin = 'round';
    if (MULTI.has(t) || t == 'NOT' || t == 'BUF') {
      c.fillStyle = cs('--pn');
      shape(c, t, 5, 4, 30, 22);
    } else if (t == 'IN') {
      c.beginPath();
      c.roundRect(7, 8, 26, 14, 7);
      c.stroke();
      c.beginPath();
      c.arc(26, 15, 5, 0, 7);
      c.fill();
    } else if (t == 'PB') {
      c.beginPath();
      c.roundRect(8, 12, 24, 12, 3);
      c.stroke();
      c.beginPath();
      c.arc(20, 11, 6, Math.PI, 0);
      c.fill();
    } else if (t == 'CLK') {
      c.beginPath();
      c.moveTo(5, 22);
      c.lineTo(5, 8);
      c.lineTo(15, 8);
      c.lineTo(15, 22);
      c.lineTo(25, 22);
      c.lineTo(25, 8);
      c.lineTo(35, 8);
      c.stroke();
    } else if (t == 'LED') {
      c.beginPath();
      c.arc(20, 15, 9, 0, 7);
      c.stroke();
      c.beginPath();
      c.moveTo(14, 9);
      c.lineTo(26, 21);
      c.moveTo(26, 9);
      c.lineTo(14, 21);
      c.stroke();
    } else if (t == 'METER') {
      c.beginPath();
      c.arc(20, 21, 13, Math.PI, 0);
      c.stroke();
      c.beginPath();
      c.moveTo(20, 21);
      c.lineTo(28, 11);
      c.stroke();
    } else {
      c.strokeRect(7, 4, 26, 22);
      c.font = 'bold 9px system-ui';
      c.textAlign = 'center';
      c.fillText(t, 20, 19);
    }
    return k;
  }

  let vw = ['sch'];
  $('#seg').onclick = (e) => {
    const v = e.target.dataset.v;
    if (!v) return;
    if (vw.includes(v)) {
      if (vw.length > 1) vw = vw.filter((x) => x != v);
    } else {
      vw.push(v);
      if (vw.length > 2) vw.shift();
    }
    $('main').dataset.n = vw.length;
    [...$('#seg').children].forEach((b) => b.classList.toggle('on', vw.includes(b.dataset.v)));
    requestAnimationFrame(() => {
      fitAll();
      fitView();
    });
  };
  $('#tabs').onclick = (e) => {
    const t = e.target.dataset.t;
    if (!t) return;
    tab = t;
    [...$('#tabs').children].forEach((b) => b.classList.toggle('on', b === e.target));
    dirty = true;
  };
  const tg = (id, fn) =>
    ($(id).onclick = (e) => {
      e.currentTarget.classList.toggle('on');
      fn(e.currentTarget.classList.contains('on'));
      requestAnimationFrame(fitAll);
    });
  tg('#tpal', (o) => $('main').classList.toggle('hp', !o));
  tg('#tan', (o) => $('main').classList.toggle('hs', !o));
  tg('#tsc', (o) => document.body.classList.toggle('hf', !o));
  $('#tsel').onclick = () => setTool('sel');
  $('#tpan').onclick = () => setTool('pan');
  $('#sim').onclick = () => {
    run = !run;
    $('#sim').textContent = run ? '❚❚ Pause' : '▶ Run';
  };
  $('#stp').onclick = () => {
    run = false;
    $('#sim').textContent = '▶ Run';
    tick();
  };
  $('#spd').oninput = (e) => (sps = +e.target.value);
  $('#wz').oninput = (e) => (win = +e.target.value);
  $('#vc').onchange = (e) => (vcc = +e.target.value);
  $('#clr').onclick = () => {
    if (!confirm('Clear the whole page? You can undo this.')) return;
    selAll();
    delSel();
    notes = [];
    groups = [];
    commit();
  };
  $('#pre').onchange = (e) => {
    if (nodes.length && !confirm('Replace this project’s circuit with the example?')) {
      e.target.value = '';
      return;
    }
    cur = e.target.value;
    load(cur);
    e.target.value = '';
  };
  $('#zo').onclick = () => zoom(0.85);
  $('#zi').onclick = () => zoom(1.18);
  $('#zf').onclick = fitView;
  /* ---------- examples (data-driven: see js/examples.js) ---------- */
  let cur = '';
  const EXAMPLES = window.LOGICLAB_EXAMPLES || [];
  const exampleById = (id) => EXAMPLES.find((e) => e.id === id);
  const exampleNote = (id) => {
    const ex = exampleById(id);
    return ex ? ex.title + ': ' + ex.desc : '';
  };

  /** Empty the page and reset the simulation clock (zoom, theme and settings are kept). */
  function resetProject() {
    nodes = [];
    wires = [];
    groups = [];
    notes = [];
    layers = [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }];
    actL = 1;
    cnt = {};
    hist = {};
    hv = {};
    sel = new Set();
    selN = new Set();
    selW = null;
    pend = null;
    T0 = 0;
    reindex();
  }

  /**
   * Load an example by id, or an empty page when id is ''.
   * Returns the list of warnings from the netlist builder (empty when the example is clean).
   */
  function load(id) {
    resetProject();
    let warnings = [];
    const ex = exampleById(id);
    if (ex) {
      const net = window.LogicLabNet();
      ex.build(net);
      warnings = toolBuild({ replace: false, parts: net.parts, wires: net.wires }).warnings;
      if (warnings.length) console.warn('LogicLab example "' + id + '" has problems:', warnings);
    }
    changed();
    newHist();
    requestAnimationFrame(() => {
      fitAll();
      fitView();
    });
    return warnings;
  }

  /** Examples for the welcome screen and the Examples drop-down, in library order. */
  function tplList() {
    return EXAMPLES.map((e) => ({ k: e.id, t: e.title, c: e.cat, l: e.level }));
  }

  /** Fill the Examples drop-down (grouped by category). */
  function populateExamples() {
    const select = $('#pre');
    select.innerHTML = '<option value="">Examples…</option>';
    [...new Set(EXAMPLES.map((e) => e.cat))].forEach((cat) => {
      const group = document.createElement('optgroup');
      group.label = cat;
      EXAMPLES.filter((e) => e.cat === cat).forEach((e) => {
        const option = document.createElement('option');
        option.value = e.id;
        option.textContent = e.title;
        group.append(option);
      });
      select.append(group);
    });
  }

  /** Open /?template=<id> links (used by the learn pages) as a new project. */
  function handleDeepLink() {
    const id = new URLSearchParams(location.search).get('template');
    const ex = id && exampleById(id);
    if (!ex) return;
    newProj(ex.id, ex.title);
    history.replaceState(null, '', location.pathname);
  }

  function tplRender() {
    const q = WZ.q;
    const cats = ['All', ...new Set(WZ.tpl.map((t) => t.c))];
    $('#wf').innerHTML = cats
      .map(
        (c) =>
          '<button data-c="' + esc(c) + '" class="' + (c == WZ.cat ? 'on' : '') + '">' + esc(c) + '</button>'
      )
      .join('');
    const levels = { Easy: 'e', Medium: 'm', Hard: 'h' };
    const blank = q
      ? ''
      : '<div class="tc blank" data-k="" data-t="Untitled"><div class="pl">+</div><b>Blank Project</b><span class="mu">Create a new circuit from scratch.</span></div>';
    const cards = WZ.tpl
      .filter(
        (t) =>
          (WZ.cat == 'All' || t.c == WZ.cat) &&
          (!q || t.t.toLowerCase().includes(q) || t.c.toLowerCase().includes(q))
      )
      .map(
        (t) =>
          '<div class="tc" data-k="' +
          t.k +
          '" data-t="' +
          esc(t.t) +
          '">' +
          '<img src="thumbs/' +
          t.k +
          '.jpg" alt="Circuit diagram: ' +
          esc(t.t) +
          '" width="720" height="450" loading="lazy">' +
          '<div class="tm"><b>' +
          esc(t.t) +
          '</b><div class="tg"><i class="d ' +
          (levels[t.l] || 'e') +
          '"></i>' +
          esc(t.l || 'Easy') +
          '<em>' +
          esc(t.c) +
          '</em></div></div></div>'
      )
      .join('');
    $('#wc').innerHTML = blank + cards;
  }

  /* ---------- automatic layout ---------- */
  /**
   * Left-to-right automatic layout: switches and clocks on the left, LEDs on the right, columns by logic depth.
   * Feedback wires (the ones that close a loop) are ignored when computing depth, so latches stay compact.
   */
  /**
   * Left-to-right automatic layout: inputs on the left, outputs on the right, columns by logic depth.
   */
  function aiLayout(ns) {
    const ids = new Set(ns.map((n) => n.id));
    const next = new Map(ns.map((n) => [n.id, []]));
    const prev = new Map(ns.map((n) => [n.id, []]));
    wires.forEach((w) => {
      if (ids.has(w.a) && ids.has(w.b) && w.a !== w.b) {
        next.get(w.a).push(w.b);
        prev.get(w.b).push(w.a);
      }
    });
    // 1. depth-first search from the sources: a wire that points back into the current path is feedback
    const state = new Map();
    const feedback = new Set();
    const visit = (u) => {
      state.set(u, 1);
      next.get(u).forEach((v) => {
        const s = state.get(v) || 0;
        if (s === 1) feedback.add(u + '>' + v);
        else if (s === 0) visit(v);
      });
      state.set(u, 2);
    };
    ns.filter((n) => n.type === 'IN' || n.type === 'CLK' || !prev.get(n.id).length).forEach((n) => {
      if (!state.get(n.id)) visit(n.id);
    });
    ns.forEach((n) => {
      if (!state.get(n.id)) visit(n.id);
    });
    // 2. column = longest path from a source over the remaining (loop-free) wires
    const level = new Map(ns.map((n) => [n.id, 0]));
    for (let pass = 0; pass < ns.length; pass++) {
      let moved = false;
      ns.forEach((n) =>
        next.get(n.id).forEach((v) => {
          if (feedback.has(n.id + '>' + v) || level.get(n.id) + 1 <= level.get(v)) return;
          level.set(v, level.get(n.id) + 1);
          moved = true;
        })
      );
      if (!moved) break;
    }
    const isSink = (n) => n.type === 'LED' || n.type === 'METER';
    const lastColumn = Math.max(0, ...ns.filter((n) => !isSink(n)).map((n) => level.get(n.id))) + 1;
    ns.filter(isSink).forEach((n) => level.set(n.id, lastColumn));
    // 3. order each column by the average height of the parts feeding it, then place it
    const columns = new Map();
    ns.forEach((n) => {
      const l = level.get(n.id);
      if (!columns.has(l)) columns.set(l, []);
      columns.get(l).push(n);
    });
    const tallest = Math.max(...[...columns.values()].map((c) => c.length));
    const yOf = new Map();
    [...columns.keys()]
      .sort((a, b) => a - b)
      .forEach((l) => {
        const column = columns.get(l);
        const key = (n, i) => {
          const p = prev.get(n.id).filter((x) => yOf.has(x));
          return p.length ? p.reduce((s, x) => s + yOf.get(x), 0) / p.length : i * 90;
        };
        column
          .map((n, i) => ({ n, k: key(n, i), i }))
          .sort((a, b) => a.k - b.k || a.i - b.i)
          .forEach((item, row) => {
            item.n.x = gs(30 + l * 150);
            item.n.y = gs(30 + (tallest - column.length) * 45 + row * 90);
            yOf.set(item.n.id, item.n.y);
          });
      });
  }

  /* ---------- convert a circuit to NAND-only or NOR-only ---------- */
  const CONVERTIBLE = ['AND', 'OR', 'NOT', 'BUF', 'NAND', 'NOR', 'XOR', 'XNOR'];

  /**
   * Rebuild every basic gate from one universal gate type ('NAND' or 'NOR').
   * Gates with an unconnected input are left alone. The page is laid out again afterwards.
   * Returns { converted, skipped }.
   */
  function convertGates(style) {
    const nandStyle = style === 'NAND';
    let made = 0;
    let converted = 0;
    let skipped = 0;
    const signal = (n, pin) => ({ n, pin });
    const gate2 = (a, b) => {
      const g = add(style, 0, 0);
      g.name = style + ++made;
      link(a.n, a.pin, g, 0);
      link(b.n, b.pin, g, 1);
      return signal(g, 0);
    };
    const inv = (a) => gate2(a, a);
    const and2 = (a, b) => (nandStyle ? inv(gate2(a, b)) : gate2(inv(a), inv(b)));
    const or2 = (a, b) => (nandStyle ? gate2(inv(a), inv(b)) : inv(gate2(a, b)));
    const xor2 = (a, b) => {
      const t = gate2(a, b);
      const m = gate2(gate2(a, t), gate2(b, t)); // XOR with NAND, XNOR with NOR
      return nandStyle ? m : inv(m);
    };
    const fold = (f, list) => list.slice(1).reduce((acc, x) => f(acc, x), list[0]);

    nodes
      .filter((g) => CONVERTIBLE.includes(g.type))
      .forEach((g) => {
        const sources = [];
        for (let i = 0; i < nI(g); i++) {
          const w = wires.find((x) => x.b === g.id && x.bp === i);
          if (!w) {
            skipped++;
            return;
          }
          sources.push(signal(idm.get(w.a), w.ap));
        }
        if (g.type === style && sources.length === 2) return; // already the target gate
        let out;
        if (g.type === 'BUF') out = sources[0];
        else if (g.type === 'NOT') out = inv(sources[0]);
        else if (g.type === 'AND') out = fold(and2, sources);
        else if (g.type === 'OR') out = fold(or2, sources);
        else if (g.type === 'XOR') out = fold(xor2, sources);
        else if (g.type === 'NAND') out = inv(fold(and2, sources));
        else if (g.type === 'NOR') out = inv(fold(or2, sources));
        else out = inv(fold(xor2, sources)); // XNOR
        wires
          .filter((w) => w.a === g.id)
          .forEach((w) => {
            w.a = out.n.id;
            w.ap = out.pin;
          });
        wires = wires.filter((w) => w.b !== g.id);
        nodes = nodes.filter((x) => x !== g);
        reindex();
        converted++;
      });
    if (converted) {
      aiLayout(nodes);
      changed();
      requestAnimationFrame(() => {
        fitAll();
        fitView();
      });
    }
    return { converted, skipped };
  }

  function doConvert(style) {
    const r = convertGates(style);
    if (!r.converted) toast('Nothing to convert: no basic gates found.', 'info');
    else
      toast(
        'Converted ' +
          r.converted +
          ' gate(s) to ' +
          style +
          '-only' +
          (r.skipped ? ' (' + r.skipped + ' with open inputs skipped)' : '') +
          '.',
        'success'
      );
  }
  $('#cvn').onclick = () => doConvert('NAND');
  $('#cvr').onclick = () => doConvert('NOR');

  /* ---------- live collaboration host API (used by js/collab.js; see docs/COLLABORATION.md) ---------- */
  const NODE_DEFAULTS = {
    pc: 0,
    q: 0,
    cnt: 0,
    v: 0,
    per: 20,
    avg: 0,
    trig: 'R',
    act: -99,
    nin: 2,
    probe: 0,
    hide: 0
  };
  window.LogicLabHost = {
    /** The structural document (parts, wires, groups, drawings, layers) plus the project name. */
    doc: () => Object.assign(snapDoc(0), { name: pname }),
    /** The whole project file (same as Save), including settings and simulation state. */
    project: () => JSON.parse(JSON.stringify(docJSON())),
    switches() {
      const o = {};
      nodes.forEach((n) => {
        if (n.type == 'IN') o[n.id] = n.v;
      });
      return o;
    },
    /** Set a switch without telling collab (used for values that arrive from other people). */
    setSwitch(id, v) {
      const n = idm.get(id);
      if (n && n.type == 'IN') {
        n.v = v ? 1 : 0;
        dirty = true;
      }
    },
    /**
     * Apply changes from other people in place, so what you are dragging or selecting stays yours.
     * `chs` is a list of { k, v }: k names the item (n:<part> w:<a>:<ap>:<b>:<bp> a:<drawing> g:<group> l:<layer> m:name),
     * v is its new value, or null when it was deleted.
     */
    applyChanges(chs) {
      if (!chs || !chs.length) return;
      const busyN = new Set((drag && drag.L ? drag.L : []).map((q) => q[0].id)),
        busyA = new Set((drag && drag.N ? drag.N : []).map((q) => q[0].id)),
        selI = [...sel].map((n) => n.id),
        selA = [...selN].map((a) => a.id),
        selK = selW ? [selW.a, selW.ap, selW.b, selW.bp].join(':') : null,
        byId = new Map(nodes.map((n) => [n.id, n])),
        touched = new Set();
      let layersChanged = 0;
      for (const { k, v } of chs) {
        const kind = k[0],
          key = k.slice(2);
        if (kind == 'n') {
          const id = +key,
            cur = byId.get(id);
          if (v === null) {
            if (cur) {
              nodes = nodes.filter((n) => n !== cur);
              byId.delete(id);
            }
          } else if (cur) {
            if (busyN.has(id)) continue;
            FLD.forEach((f) => {
              if (f in v) cur[f] = v[f];
              else if (f == 'mom' || f == 'probe' || f == 'hide') cur[f] = 0;
            });
            touched.add(id);
          } else {
            const n = Object.assign({}, NODE_DEFAULTS, { o: [0, 0], r: [0, 0, 0, 0] }, v);
            nodes.push(n);
            byId.set(id, n);
          }
        } else if (kind == 'w') {
          const [a, ap, b, bp] = key.split(':').map(Number),
            has = wires.some((w) => w.a == a && w.ap == ap && w.b == b && w.bp == bp);
          if (v === null) wires = wires.filter((w) => !(w.a == a && w.ap == ap && w.b == b && w.bp == bp));
          else if (!has && byId.has(a) && byId.has(b)) {
            wires = wires.filter((w) => !(w.b == b && w.bp == bp));
            wires.push({ a, ap, b, bp });
          }
        } else if (kind == 'a') {
          const id = +key,
            i = notes.findIndex((x) => x.id == id);
          if (busyA.has(id)) continue;
          if (v === null) {
            if (i >= 0) notes.splice(i, 1);
          } else if (i >= 0) notes[i] = v;
          else notes.push(v);
        } else if (kind == 'g') {
          const id = +key;
          groups = groups.filter((x) => x.id != id);
          if (v !== null) groups.push(v);
        } else if (kind == 'l') {
          const id = +key,
            i = layers.findIndex((x) => x.id == id);
          layersChanged = 1;
          if (v === null) {
            if (i >= 0) layers.splice(i, 1);
          } else if (i >= 0) layers[i] = v;
          else layers.push(v);
        } else if (k == 'm:name' && v !== null) {
          pname = String(v);
          if (document.activeElement !== $('#pn')) $('#pn').value = pname;
        }
      }
      wires = wires.filter((w) => byId.has(w.a) && byId.has(w.b));
      if (!layers.length) layers = [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }];
      if (!layers.some((l) => l.id == actL)) actL = layers[0].id;
      reindex();
      sel = new Set(selI.map((i) => idm.get(i)).filter(Boolean));
      selN = new Set(selA.map((i) => notes.find((a) => a.id == i)).filter(Boolean));
      if (selK) selW = wires.find((w) => [w.a, w.ap, w.b, w.bp].join(':') == selK) || null;
      if (drag && drag.hit && idm.get(drag.hit.id) !== drag.hit && !notes.includes(drag.hit)) drag = null;
      if (pend && idm.get(pend.n.id) !== pend.n) pend = null;
      if (layersChanged) lyr();
      if (selI.some((i) => touched.has(i)) && !$('#insp').contains(document.activeElement)) insp();
      dirty = true;
      lh = dstr(); // other people's edits are not yours to undo
      UN = [];
      RE = [];
      ur();
      schedSave();
    },
    /** Replace the whole project with a version (for example from history) as a normal, undoable edit. */
    restoreDoc(d) {
      restore(JSON.parse(JSON.stringify(d)), 1);
      if (d.name) {
        pname = d.name;
        $('#pn').value = pname;
      }
      changed();
    },
    /** Open a shared project (not saved on this device). */
    load(d, name) {
      PID = null;
      loadDoc(d, name);
      showApp();
    },
    /** View-only mode for people who joined through a view link. */
    readOnly(on) {
      RO = !!on;
      document.body.classList.toggle('ro', RO);
      $('#pn').readOnly = RO;
      if (RO) {
        tool = 'sel';
        sel = new Set();
        selN = new Set();
        selW = null;
        pend = null;
        drag = marq = null;
        insp();
      }
    },
    isReadOnly: () => RO,
    /** Give this person their own range of ids so two people never create the same id. */
    ownRange(lo, hi) {
      const ids = [
        ...nodes.map((n) => n.id),
        ...notes.map((a) => a.id),
        ...groups.map((g) => g.id),
        ...layers.map((l) => l.id)
      ].filter((i) => i >= lo && i < hi);
      uid = ids.length ? Math.max(...ids) + 1 : lo + 1;
    },
    /** Pan/zoom of the main canvas (null while the breadboard view is shown, where part positions differ). */
    view: () => (vw[0] == 'bb' ? null : { v: V[0], el: cv }),
    user: () => USER,
    pid: () => PID,
    auth: (mode, message, after) => authOpen(mode, message, after),
    /** Save on this device and push to the account now; resolves when the sync attempt has finished. */
    async syncNow() {
      autosave();
      await syncAll(true);
    },
    toast: (m, t, ms) => toast(m, t, ms),
    download(type) {
      if (type === 'proj') save();
      else if (type === 'png' || type === 'pdf') expImg(type === 'pdf');
    }
  };

  /* ---------- debugging and test hooks: window.LogicLab (see docs/DEBUGGING.md) ---------- */
  window.LogicLab = {
    version: '1.0.0',
    exampleIds: () => EXAMPLES.map((e) => e.id),
    /** Load an example (or '' for an empty page). Returns builder warnings. */
    load,
    /** Stop the automatic simulation so tests and the console can step it by hand. */
    pause() {
      run = false;
      $('#sim').textContent = '▶ Run';
    },
    setInput(name, value) {
      const n = nodes.find((x) => x.type === 'IN' && (x.key === name || x.name === name));
      if (!n) throw new Error('No switch named ' + name);
      n.v = value ? 1 : 0;
    },
    /** Advance the simulation by n steps. */
    step(n = 1) {
      for (let i = 0; i < n; i++) tick();
    },
    /** Current LED values, keyed by example part id (or the part name for hand-drawn circuits). */
    outputs() {
      const o = {};
      nodes.filter((n) => n.type === 'LED').forEach((n) => (o[n.key || n.name] = n.o[0]));
      return o;
    },
    inputs() {
      const o = {};
      nodes.filter((n) => n.type === 'IN').forEach((n) => (o[n.key || n.name] = n.v));
      return o;
    },
    parts: () => nodes.map((n) => ({ id: n.id, type: n.type, name: n.name })),
    oscillating: () => (osc ? [...new Set(osc)] : null),
    /** The app's own truth-table analysis of the whole circuit. */
    analysis() {
      const keep = [sel, selN];
      sel = new Set();
      selN = new Set();
      try {
        return JSON.parse(JSON.stringify(model()));
      } finally {
        [sel, selN] = keep;
      }
    },
    /** Build a circuit from a netlist ({ parts, wires, replace }), the same format the AI agent uses. */
    build: (netlist) => toolBuild(netlist),
    /** Main power: LogicLab.power(false) sets every output to 0 V, power(true) starts from a clean state. */
    power: setPower,
    /** Restart the circuit and the waveform. */
    reset: resetCircuit,
    isPowered: () => power,
    /** Recorded waveform values of a part (by example id or name), oldest first. */
    history(name) {
      const n = nodes.find((x) => x.key === name || x.name === name);
      return n && hist[n.id] ? hist[n.id].slice() : [];
    },
    convert: convertGates,
    /** JPEG data URL of the whole circuit (used to generate template thumbnails). */
    snapshot: (w = 720, h = 450) => snapCanvas(w, h, 'sch').toDataURL('image/jpeg', 0.85),
    /** Serialise / restore the whole project (same format as Save). */
    exportProject: () => JSON.parse(JSON.stringify(docJSON())),
    importProject: (d) => restore(d, 0)
  };

  /* ---------- groups, undo/redo, save/open, drawing ---------- */
  function gs(v) {
    return snapOn ? Math.round(v / 12) * 12 : v;
  }
  function gm(n) {
    const g = groups.find((g) => g.ids.includes(n.id));
    return g ? g.ids.map((i) => idm.get(i)).filter(Boolean) : [n];
  }
  /**
   * Group the selected parts and drawings so they move together.
   */
  function group() {
    if (sel.size + selN.size < 2) return;
    const ids = [...sel].map((n) => n.id),
      nids = [...selN].map((a) => a.id);
    groups.forEach((g) => {
      g.ids = g.ids.filter((i) => !ids.includes(i));
      g.nids = (g.nids || []).filter((i) => !nids.includes(i));
    });
    groups.push({ id: uid++, name: 'Group ' + (groups.length + 1), ids, nids });
    reindex();
    changed();
  }
  /**
   * Dissolve the groups that contain the selection.
   */
  function ungroup() {
    groups = groups.filter(
      (g) => !(g.ids.some((i) => sel.has(idm.get(i))) || g.nids.some((i) => [...selN].some((a) => a.id == i)))
    );
    changed();
  }
  const layerOf = (a) => layers.find((l) => l.id == a.l);
  function noteAt(p) {
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      if (!lyOK(L)) continue;
      for (let j = notes.length - 1; j >= 0; j--) {
        const a = notes[j];
        if (a.l == L.id && nHit(a, p)) return a;
      }
    }
  }
  function pickSet(it, isN, alt) {
    const g = alt ? null : groups.find((g) => (isN ? g.nids : g.ids).includes(it.id));
    return g
      ? {
          ns: g.ids.map((i) => idm.get(i)).filter(Boolean),
          as: g.nids.map((i) => notes.find((a) => a.id == i)).filter(Boolean)
        }
      : { ns: isN ? [] : [it], as: isN ? [it] : [] };
  }
  function mvNote(a, q, dx, dy) {
    if (q.p) a.p = q.p.map(([x, y]) => [x + dx, y + dy]);
    a.x0 = q.x0 + dx;
    a.y0 = q.y0 + dy;
    a.x1 = q.x1 + dx;
    a.y1 = q.y1 + dy;
  }
  function gbox(c, gr) {
    const P = gr.ids.map((i) => idm.get(i)).filter(Boolean),
      A = (gr.nids || []).map((i) => notes.find((a) => a.id == i)).filter(Boolean),
      R = P.map((n) => [n.x, n.y, n.x + W, n.y + hh(n)]).concat(A.map(nBox));
    if (!R.length) return;
    const x0 = Math.min(...R.map((r) => r[0])) - 18,
      y0 = Math.min(...R.map((r) => r[1])) - 26,
      x1 = Math.max(...R.map((r) => r[2])) + 18,
      y1 = Math.max(...R.map((r) => r[3])) + 18,
      s = P.every((n) => sel.has(n)) && A.every((a) => selN.has(a));
    c.save();
    c.fillStyle = s ? '#ff6d5a14' : '#8d909912';
    c.strokeStyle = s ? cs('--ac') : cs('--mu');
    c.lineWidth = 1.5;
    c.setLineDash([7, 5]);
    c.beginPath();
    c.roundRect(x0, y0, x1 - x0, y1 - y0, 12);
    c.fill();
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = s ? cs('--ac') : cs('--mu');
    c.font = '600 11px system-ui,sans-serif';
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(gr.name, x0 + 10, y0 + 6);
    c.restore();
  }
  const FLD = ['id', 'type', 'x', 'y', 'name', 'nin', 'per', 'trig', 'probe', 'hide', 'mom'];
  function snapDoc(rt) {
    return {
      nodes: nodes.map((n) => {
        const o = {};
        (rt ? [...FLD, 'v', 'q', 'r', 'o', 'pc', 'cnt'] : FLD).forEach((k) => (o[k] = n[k]));
        return o;
      }),
      wires,
      groups,
      notes,
      layers,
      al: actL,
      uid,
      cnt
    };
  }
  const dstr = () => JSON.stringify(snapDoc(0)),
    ur = () => {
      $('#undo').disabled = !UN.length;
      $('#redo').disabled = !RE.length;
    };
  /**
   * Record an undo step if the project structure changed since the last step.
   */
  function commit() {
    const s = dstr();
    if (s === lh) return;
    if (RO && lh) {
      restore(JSON.parse(lh), 1); // view-only: put back whatever was changed
      return;
    }
    if (lh) {
      UN.push(lh);
      if (UN.length > 100) UN.shift();
    }
    RE = [];
    lh = s;
    md = 1;
    ur();
    schedSave();
    if (HOOK.commit) HOOK.commit();
  }
  function newHist() {
    UN = [];
    RE = [];
    lh = dstr();
    md = 0;
    ur();
  }
  /**
   * Undo the last structural change (switch values and simulation state are kept).
   */
  function undo() {
    if (RO || !UN.length) return;
    RE.push(lh);
    lh = UN.pop();
    restore(JSON.parse(lh), 1);
    md = 1;
    ur();
    schedSave();
  }
  /**
   * Redo the change that was just undone.
   */
  function redo() {
    if (RO || !RE.length) return;
    UN.push(lh);
    lh = RE.pop();
    restore(JSON.parse(lh), 1);
    md = 1;
    ur();
    schedSave();
  }
  /**
   * Replace the whole project with a saved/serialised one. When `keep` is true the live simulation state of
   * parts that still exist is preserved (used by undo/redo).
   */
  function restore(d, keep) {
    const old = new Map(nodes.map((n) => [n.id, n])),
      RT = ['o', 'pc', 'q', 'cnt', 'v', 'r', 'avg', 'act'];
    nodes = d.nodes.map((x) => {
      const n = Object.assign(
          {
            o: [0, 0],
            pc: 0,
            q: 0,
            cnt: 0,
            v: 0,
            per: 20,
            avg: 0,
            r: [0, 0, 0, 0],
            trig: 'R',
            act: -99,
            nin: 2,
            probe: 0,
            hide: 0
          },
          x
        ),
        o = keep && old.get(x.id);
      if (o) RT.forEach((k) => (n[k] = o[k]));
      return n;
    });
    wires = d.wires || [];
    groups = d.groups || [];
    notes = d.notes || [];
    layers = d.layers && d.layers.length ? d.layers : [{ id: 1, name: 'Layer 1', vis: 1, lock: 0 }];
    actL = d.al || layers[0].id;
    uid = d.uid || Math.max(0, ...nodes.map((n) => n.id)) + 1;
    cnt = d.cnt || {};
    sel = new Set();
    selN = new Set();
    selW = null;
    pend = null;
    notes.forEach((a) => {
      if (!a.id) a.id = uid++;
    });
    reindex();
    chips();
    insp();
    lyr();
    dirty = true;
  }
  let pname = 'Untitled';
  $('#nw').onclick = $('#wn').onclick = () => newProj();
  $('#op').onclick = $('#wo').onclick = () => $('#fi').click();
  $('#hm').onclick = showWelcome;
  $('#hm2').onclick = showWelcome;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#fi').onchange = (e) => {
    openFile(e.target.files[0]);
    e.target.value = '';
  };
  $('#pn').oninput = (e) => {
    if (RO) return;
    pname = e.target.value;
    md = 1;
    schedSave();
    if (HOOK.commit) HOOK.commit();
  };
  $('#insp').onchange = () => commit();
  $('#snp').onclick = (e) => {
    snapOn = !snapOn;
    e.currentTarget.classList.toggle('on', snapOn);
  };
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    if (RO) return;
    openFile(e.dataTransfer.files[0]);
  });
  addEventListener('pagehide', autosave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) autosave();
  });
  setInterval(() => {
    if (PID && $('#wl').hidden) autosave();
  }, 5000);
  const DT = ['pen', 'line', 'arrow', 'rect', 'ell', 'text', 'erase'];
  function setTool(t) {
    tool = t;
    $('#tsel').classList.toggle('on', t == 'sel');
    $('#tpan').classList.toggle('on', t == 'pan');
    document.querySelectorAll('#dt [data-k]').forEach((b) => b.classList.toggle('on', b.dataset.k == t));
    [cv, pc].forEach((c) => curUpd(c, { clientX: -9e3, clientY: -9e3 }));
  }
  $('#dt').onclick = (e) => {
    const k = e.target.dataset.k;
    if (k) setTool(k);
  };
  $('#ly').onclick = () => {
    $('#lp').hidden = !$('#lp').hidden;
    lyr();
  };
  function nBox(a) {
    if (a.t == 'pen') {
      const X = a.p.map((q) => q[0]),
        Y = a.p.map((q) => q[1]);
      return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)];
    }
    if (a.t == 'text') return [a.x0, a.y0, a.x0 + a.s.length * a.fs * 0.6, a.y0 + a.fs];
    return [Math.min(a.x0, a.x1), Math.min(a.y0, a.y1), Math.max(a.x0, a.x1), Math.max(a.y0, a.y1)];
  }
  function nHit(a, p) {
    const t = 7 + a.w;
    if (a.t == 'pen') {
      for (let i = 0; i < a.p.length - 1; i++)
        if (segD(p, { x: a.p[i][0], y: a.p[i][1] }, { x: a.p[i + 1][0], y: a.p[i + 1][1] }) < t) return 1;
      return a.p.length == 1 && Math.hypot(p.x - a.p[0][0], p.y - a.p[0][1]) < t;
    }
    if (a.t == 'line' || a.t == 'arrow') return segD(p, { x: a.x0, y: a.y0 }, { x: a.x1, y: a.y1 }) < t;
    const b = nBox(a),
      i = p.x >= b[0] - t && p.x <= b[2] + t && p.y >= b[1] - t && p.y <= b[3] + t;
    return a.t == 'text' ? i : i && !(p.x > b[0] + t && p.x < b[2] - t && p.y > b[1] + t && p.y < b[3] - t);
  }
  const lyOK = (l) => l && l.vis && !l.lock;
  function nErase(p) {
    for (let i = notes.length - 1; i >= 0; i--) {
      const a = notes[i];
      if (lyOK(layers.find((l) => l.id == a.l)) && nHit(a, p)) {
        notes.splice(i, 1);
        return;
      }
    }
  }
  /**
   * Begin a drawing tool action (pen, shapes, text, eraser).
   */
  function nStart(p) {
    const L = layers.find((l) => l.id == actL);
    if (!lyOK(L)) {
      $('#lp').hidden = false;
      lyr();
      return;
    }
    if (tool == 'erase') {
      nErase(p);
      dr = { er: 1 };
      return;
    }
    const a = {
      id: uid++,
      t: tool,
      l: actL,
      c: $('#dc').value,
      w: +$('#dw').value,
      x0: p.x,
      y0: p.y,
      x1: p.x,
      y1: p.y
    };
    if (tool == 'text') {
      const s = prompt('Text:');
      if (s) {
        a.s = s;
        a.fs = a.w * 4 + 10;
        notes.push(a);
        commit();
      }
      return;
    }
    if (tool == 'pen') a.p = [[p.x, p.y]];
    notes.push(a);
    dr = a;
  }
  function nMove(p) {
    if (dr.er) {
      nErase(p);
      return;
    }
    if (dr.t == 'pen') dr.p.push([p.x, p.y]);
    else {
      dr.x1 = p.x;
      dr.y1 = p.y;
    }
  }
  function nEnd() {
    if (!dr.er && dr.t != 'pen' && Math.hypot(dr.x1 - dr.x0, dr.y1 - dr.y0) < 4)
      notes.splice(notes.indexOf(dr), 1);
    dr = null;
    commit();
  }
  function nDraw(x) {
    layers.forEach((L) => {
      if (!L.vis) return;
      notes.forEach((a) => {
        if (a.l != L.id) return;
        x.strokeStyle = x.fillStyle = a.c;
        x.lineWidth = a.w;
        x.lineCap = x.lineJoin = 'round';
        x.setLineDash([]);
        x.beginPath();
        if (a.t == 'pen') {
          a.p.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])));
          if (a.p.length == 1) x.lineTo(a.p[0][0] + 0.1, a.p[0][1]);
          x.stroke();
        } else if (a.t == 'text') {
          x.font = '600 ' + a.fs + 'px system-ui,sans-serif';
          x.textAlign = 'left';
          x.textBaseline = 'top';
          x.fillText(a.s, a.x0, a.y0);
        } else if (a.t == 'rect') {
          const b = nBox(a);
          x.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        } else if (a.t == 'ell') {
          const b = nBox(a);
          x.ellipse(
            (b[0] + b[2]) / 2,
            (b[1] + b[3]) / 2,
            Math.max(1, (b[2] - b[0]) / 2),
            Math.max(1, (b[3] - b[1]) / 2),
            0,
            0,
            7
          );
          x.stroke();
        } else {
          x.moveTo(a.x0, a.y0);
          x.lineTo(a.x1, a.y1);
          x.stroke();
          if (a.t == 'arrow') {
            const t = Math.atan2(a.y1 - a.y0, a.x1 - a.x0),
              h = 10 + a.w * 2;
            x.beginPath();
            x.moveTo(a.x1, a.y1);
            x.lineTo(a.x1 - h * Math.cos(t - 0.45), a.y1 - h * Math.sin(t - 0.45));
            x.lineTo(a.x1 - h * Math.cos(t + 0.45), a.y1 - h * Math.sin(t + 0.45));
            x.closePath();
            x.fill();
          }
        }
      });
    });
    selN.forEach((a) => {
      const b = nBox(a);
      x.save();
      x.setLineDash([5, 4]);
      x.lineWidth = 1.5;
      x.strokeStyle = cs('--ac');
      x.strokeRect(b[0] - 6, b[1] - 6, b[2] - b[0] + 12, b[3] - b[1] + 12);
      x.restore();
    });
    x.textAlign = 'center';
    x.textBaseline = 'middle';
  }
  function lyr() {
    const e = $('#lp');
    if (e.hidden) return;
    e.innerHTML =
      '<b>Layers</b> <span class="mu">top row = in front</span>' +
      [...layers]
        .reverse()
        .map(
          (l) =>
            '<div class="lr" data-i="' +
            l.id +
            '"><input type="radio" name="al" data-a="act"' +
            (l.id == actL ? ' checked' : '') +
            ' title="Draw on this layer"><input type="text" value="' +
            esc(l.name) +
            '" data-a="nm"><button data-a="vis" class="' +
            (l.vis ? 'on' : '') +
            '" title="Show / hide">◉</button><button data-a="lock" class="' +
            (l.lock ? 'on' : '') +
            '" title="Lock">Lock</button><button data-a="up" title="Bring forward">↑</button><button data-a="dn" title="Send back">↓</button><button data-a="del" title="Delete layer">✕</button></div>'
        )
        .join('') +
      '<button data-a="add">+ New layer</button>';
  }
  $('#lp').onclick = (e) => {
    const t = e.target,
      a = t.dataset.a;
    if (!a) return;
    const r = t.closest('.lr'),
      id = r && +r.dataset.i,
      i = layers.findIndex((l) => l.id == id),
      L = layers[i];
    if (a == 'add') {
      const n = {
        id: Math.max(0, ...layers.map((l) => l.id)) + 1,
        name: 'Layer ' + (layers.length + 1),
        vis: 1,
        lock: 0
      };
      layers.push(n);
      actL = n.id;
    } else if (a == 'act') actL = id;
    else if (a == 'vis') L.vis ^= 1;
    else if (a == 'lock') L.lock ^= 1;
    else if (a == 'up' && i < layers.length - 1) [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]];
    else if (a == 'dn' && i > 0) [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]];
    else if (a == 'del') {
      if (layers.length < 2) return;
      if (notes.some((n) => n.l == id) && !confirm('Delete this layer and its drawings?')) return;
      notes = notes.filter((n) => n.l != id);
      layers.splice(i, 1);
      if (actL == id) actL = layers[layers.length - 1].id;
    } else return;
    lyr();
    commit();
  };
  $('#lp').onchange = (e) => {
    if (e.target.dataset.a == 'nm') {
      layers.find((l) => l.id == +e.target.closest('.lr').dataset.i).name = e.target.value;
      commit();
    }
  };

  /* ---------- projects, export, oscillation badge, pointers ---------- */
  const lsG = (k) => {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    },
    lsS = (k, v) => {
      try {
        localStorage.setItem(k, v);
        return 1;
      } catch (e) {
        return 0;
      }
    },
    lsD = (k) => {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    };
  const idxGet = () => {
      try {
        return JSON.parse(lsG(kk('idx')) || '[]');
      } catch (e) {
        return [];
      }
    },
    newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const ago = (t) => {
    if (!t) return '—';
    const s = (Date.now() - t) / 1000;
    return s < 60
      ? 'just now'
      : s < 3600
        ? Math.floor(s / 60) + ' min ago'
        : s < 86400
          ? Math.floor(s / 3600) + ' hours ago'
          : Math.floor(s / 86400) + ' days ago';
  };
  /**
   * Serialise the project: parts, wires, groups, drawings, layers, settings and simulation state.
   */
  function docJSON() {
    return Object.assign(
      {
        app: 'LogicLab',
        ver: 2,
        name: pname,
        saved: new Date().toISOString(),
        vcc,
        sps,
        win,
        snap: snapOn,
        rv: RV,
        view: V[0]
      },
      snapDoc(1)
    );
  }
  let sT = 0;
  function schedSave() {
    if (!PID) return;
    clearTimeout(sT);
    sT = setTimeout(autosave, 700);
  }

  /**
   * Render the circuit to an off-screen canvas (used for thumbnails and PNG/PDF export).
   */
  function snapCanvas(w, h, mode, fix) {
    const B = bbox(30, 30),
      s = fix || Math.min(w / B.w, h / B.h, 1.2),
      oc = document.createElement('canvas');
    oc.width = w * dpr;
    oc.height = h * dpr;
    oc.getBoundingClientRect = () => ({ width: w, height: h, left: 0, top: 0 });
    const sv = V[1],
      a = sel,
      b = selN,
      c = selW,
      d = pend,
      e = marq;
    V[1] = {
      s,
      x: fix ? -B.x * s : (w - B.w * s) / 2 - B.x * s,
      y: fix ? -B.y * s : (h - B.h * s) / 2 - B.y * s
    };
    sel = new Set();
    selN = new Set();
    selW = null;
    pend = null;
    marq = null;
    try {
      draw(oc, oc.getContext('2d'), mode, 0);
    } finally {
      V[1] = sv;
      sel = a;
      selN = b;
      selW = c;
      pend = d;
      marq = e;
      view = V[0];
    }
    return oc;
  }
  function dl(b, fn) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = fn;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const fname = (x) => (pname.replace(/[^\w\- ]+/g, '_') || 'project') + x;
  /**
   * Download the project as a .logiclab.json file.
   */
  function save() {
    dl(new Blob([JSON.stringify(docJSON())], { type: 'application/json' }), fname('.logiclab.json'));
    md = 0;
  }
  /**
   * Wrap a canvas as a one-page PDF (JPEG image) without any library.
   */
  function pdfFrom(oc) {
    const d = atob(oc.toDataURL('image/jpeg', 0.92).split(',')[1]),
      n = d.length,
      im = new Uint8Array(n);
    for (let i = 0; i < n; i++) im[i] = d.charCodeAt(i);
    const pw = Math.round((oc.width / dpr) * 0.75),
      ph = Math.round((oc.height / dpr) * 0.75),
      en = (t) => new TextEncoder().encode(t),
      P = [],
      O = [];
    let L = 0;
    const pu = (b) => {
        P.push(b);
        L += b.length;
      },
      ob = (i, hd, body) => {
        O[i] = L;
        pu(en(i + ' 0 obj\n' + hd + '\n'));
        if (body) {
          pu(en('stream\n'));
          pu(body);
          pu(en('\nendstream\n'));
        }
        pu(en('endobj\n'));
      };
    pu(en('%PDF-1.4\n'));
    ob(1, '<</Type/Catalog/Pages 2 0 R>>');
    ob(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>');
    ob(
      3,
      '<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' +
        pw +
        ' ' +
        ph +
        ']/Contents 4 0 R/Resources<</XObject<</I 5 0 R>>>>>>'
    );
    const q = 'q ' + pw + ' 0 0 ' + ph + ' 0 0 cm /I Do Q';
    ob(4, '<</Length ' + q.length + '>>', en(q));
    ob(
      5,
      '<</Type/XObject/Subtype/Image/Width ' +
        oc.width +
        '/Height ' +
        oc.height +
        '/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ' +
        n +
        '>>',
      im
    );
    const xr = L;
    let t = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i < 6; i++) t += String(O[i]).padStart(10, '0') + ' 00000 n \n';
    pu(en(t + 'trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n' + xr + '\n%%EOF'));
    return new Blob(P, { type: 'application/pdf' });
  }
  function expImg(pdf) {
    const B = bbox(40, 40),
      s = Math.min(2, 3200 / B.w),
      c = snapCanvas(Math.ceil(B.w * s), Math.ceil(B.h * s), vw[0] == 'bb' ? 'sch' : vw[0], s);
    if (pdf) dl(pdfFrom(c), fname('.pdf'));
    else c.toBlob((b) => dl(b, fname('.png')));
  }
  $('#mdl').onchange = (e) => {
    RV = e.target.value == '1';
    nodes.forEach((n) => {
      n.av = null;
      n.po = null;
    });
    hv = {};
    dirty = true;
  };
  /**
   * Apply a saved project document and its settings to the editor.
   */
  function loadDoc(d, nm) {
    hist = {};
    hv = {};
    T0 = 0;
    vcc = d.vcc || 5;
    sps = d.sps || 40;
    win = d.win || 300;
    snapOn = d.snap !== false;
    RV = !!d.rv;
    $('#vc').value = vcc;
    $('#spd').value = sps;
    $('#wz').value = win;
    $('#mdl').value = RV ? 1 : 0;
    $('#snp').classList.toggle('on', snapOn);
    cur = '';
    restore(d, 0);
    pname = d.name || nm || 'Untitled';
    $('#pn').value = pname;
    if (d.view && d.view.s) Object.assign(V[0], d.view);
    else fitView();
    newHist();
  }
  /**
   * Import a project file chosen by the user as a new project.
   */
  function openFile(f) {
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!['LogicLab', 'GateForge'].includes(d.app) || !Array.isArray(d.nodes) || !Array.isArray(d.wires))
          throw 0;
        PID = null;
        loadDoc(d, f.name.replace(/(\.(logiclab|gateforge))?\.json$/, ''));
        PID = newId();
        showApp();
        autosave();
      } catch (x) {
        alert('This is not a valid LogicLab project file.');
      }
    };
    r.readAsText(f);
  }
  /**
   * Start a new project (blank or from an example id) and store it in the project list.
   */
  function newProj(k, title) {
    PID = null;
    cur = k || '';
    load(k || '');
    pname = title || 'Untitled';
    $('#pn').value = pname;
    PID = newId();
    showApp();
    autosave();
    if (k) idxUpd(PID, (e) => (e.tpl = k));
  }

  const showApp = () => {
    $('#wl').hidden = true;
    document.body.classList.remove('wl-open');
  };

  const WZ = { tpl: [], cat: 'All', q: '' };

  $('#wf').onclick = (e) => {
    if (e.target.dataset.c) {
      WZ.cat = e.target.dataset.c;
      tplRender();
    }
  };
  $('#wc').onclick = (e) => {
    const k = e.target.closest('.tc');
    if (k) newProj(k.dataset.k, k.dataset.t.replace(/&amp;/g, '&'));
  };

  document.querySelectorAll('#wl .nv').forEach(
    (b) =>
      (b.onclick = () => {
        document.querySelectorAll('#wl .nv').forEach((x) => x.classList.toggle('on', x === b));
        $('#' + b.dataset.s).scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
  );

  function oscUI() {
    const k = osc ? [...new Set(osc)].slice(0, 6).join(', ') : '';
    if (k !== ok_) {
      ok_ = k;
      const b = $('#osc');
      b.hidden = !k;
      if (k) b.textContent = '⚠ Oscillating: ' + k + ' (race-around or unstable feedback)';
    }
  }
  /* pointers inspired by the neon set */
  const CU = (() => {
    const df =
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5eead4"/><stop offset="1" stop-color="#60a5fa"/></linearGradient></defs>',
      U = (b, x, y, f) =>
        'url("data:image/svg+xml,' +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
            df +
            b +
            '</svg>'
        ) +
        '") ' +
        x +
        ' ' +
        y +
        ', ' +
        f,
      st =
        'fill="#0f1536" stroke="url(#g)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"',
      gl = 'fill="none" stroke="#7c5cff" stroke-opacity=".4" stroke-width="5" stroke-linejoin="round"',
      AR = 'M5 3V23L10 18.5L13.5 26.5L17 25L13.5 17.5H21Z',
      ar =
        '<path d="' +
        AR +
        '" ' +
        gl +
        '/><path d="' +
        AR +
        '" ' +
        st +
        '/><path d="M8 9h3v3" fill="none" stroke="#5eead4" stroke-width="1"/><circle cx="11" cy="12" r="1.2" fill="#5eead4"/>',
      HD =
        'M12 14V5a2 2 0 0 1 4 0v8h1v-2a2 2 0 0 1 4 0v2h1v-1a2 2 0 0 1 4 0v8c0 5-3 8-8 8h-1c-4 0-6-2-8-5l-3-5a2 2 0 0 1 3-2l2 2z';
    return {
      arrow: U(ar, 5, 3, 'default'),
      wire: U(
        ar + '<path d="M25 15l-4 6h3l-1.5 5 5-7h-3.2z" fill="#fbbf24" stroke="#f59e0b" stroke-width=".8"/>',
        5,
        3,
        'crosshair'
      ),
      hand: U(
        '<path d="' +
          HD +
          '" ' +
          gl +
          '/><path d="' +
          HD +
          '" ' +
          st +
          '/><path d="M18 18l-2.5 4h2l-1 3.5 3.5-4.5h-2z" fill="#fbbf24"/>',
        14,
        3,
        'pointer'
      ),
      grab: U(
        '<path d="M11 15V8M15 15V6M19 15V6.5M23 15V9" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round" fill="none"/><rect x="8" y="14" width="18" height="13" rx="6" ' +
          st +
          '/><path d="M11 21h2l1.2-2 2 4 2-4 1.2 2h2" fill="none" stroke="#5eead4" stroke-width="1"/>',
        16,
        16,
        'grab'
      ),
      grabbing: U(
        '<path d="M11 15v-3M15 15v-4M19 15v-4M23 15v-3" stroke="url(#g)" stroke-width="3.4" stroke-linecap="round" fill="none"/><rect x="8" y="14" width="18" height="12" rx="6" ' +
          st +
          '/><path d="M11 20h2l1.2-2 2 4 2-4 1.2 2h2" fill="none" stroke="#5eead4" stroke-width="1"/>',
        16,
        16,
        'grabbing'
      ),
      move: U(
        '<path d="M16 2l-4 4h3v7H8v-3l-4 4 4 4v-3h7v7h-3l4 4 4-4h-3v-7h7v3l4-4-4-4v3h-7V6h3z" ' +
          st +
          '/><circle cx="16" cy="16" r="3.2" fill="#0f1536" stroke="#5eead4" stroke-width="1.2"/>',
        16,
        16,
        'move'
      ),
      cross: U(
        '<circle cx="16" cy="16" r="8" fill="none" stroke="url(#g)" stroke-width="1.6"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="url(#g)" stroke-width="1.6" stroke-linecap="round"/><path d="M13 12.5l7 3.5-7 3.5z" fill="#fb923c"/>',
        16,
        16,
        'crosshair'
      ),
      ibeam: U(
        '<path d="M10 4h12M16 4v24M10 28h12" stroke="#7c5cff" stroke-opacity=".4" stroke-width="5" stroke-linecap="round" fill="none"/><path d="M10 4h12M16 4v24M10 28h12" stroke="url(#g)" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
        16,
        16,
        'text'
      )
    };
  })();
  const curSet = (c, k) => {
    if (c.dataset.cu != k) {
      c.dataset.cu = k;
      c.style.cursor = CU[k];
    }
  };
  /**
   * Choose the mouse pointer that matches what is under the cursor and the active tool.
   */
  function curUpd(c, e) {
    let k = 'arrow';
    if (pan) k = 'grabbing';
    else if (tool == 'pan') k = 'grab';
    else if (DT.includes(tool)) k = tool == 'text' ? 'ibeam' : 'cross';
    else if (drag && drag.m) k = 'move';
    else if (pend) k = 'wire';
    else if ((c === cv ? vw[0] : vw[1]) != 'bb') {
      view = V[c === cv ? 0 : 1];
      const r = c.getBoundingClientRect(),
        p = { x: (e.clientX - r.left - view.x) / view.s, y: (e.clientY - r.top - view.y) / view.s };
      if (pinHit(p)) k = 'wire';
      else {
        const n = nodeAt(p);
        if (n) k = n.type == 'IN' ? 'hand' : 'move';
        else if (noteAt(p)) k = 'move';
      }
    }
    curSet(c, k);
  }
  [cv, pc].forEach((c) => {
    c.addEventListener('pointermove', (e) => curUpd(c, e));
    c.addEventListener('pointerdown', (e) => curUpd(c, e));
    curSet(c, 'arrow');
  });

  /* ======== v3: cloud shell (accounts, offline sync, AI agent, new UI) ======== */
  let USER = null,
    NSP = 'gf:guest:',
    lastSig = '',
    AFTER = null,
    AMODE = 'login',
    syncing = 0,
    syncT = 0;
  const kk = (s) => NSP + s;
  (() => {
    const o = lsG('gf:idx');
    if (o && !lsG('gf:guest:idx')) {
      lsS('gf:guest:idx', o);
      try {
        JSON.parse(o).forEach((e) =>
          ['p', 't'].forEach((c) => {
            const v = lsG('gf:' + c + ':' + e.id);
            if (v) lsS('gf:guest:' + c + ':' + e.id, v);
          })
        );
      } catch (e) {}
    }
    try {
      const u = JSON.parse(lsG('gf:lastuser') || 'null');
      if (u && u.id) {
        USER = u;
        NSP = 'gf:' + u.id + ':';
      }
    } catch (e) {}
    const t = lsG('gf:theme');
    if (t) document.documentElement.dataset.theme = t;
  })();
  function toast(msg, type, ms) {
    type = type || 'info';
    ms = ms === undefined ? 3800 : ms;
    const t = document.createElement('div');
    t.className = 'ts ' + type;
    t.innerHTML =
      '<i>' +
      { success: '✓', info: 'i', warn: '!', error: '✕' }[type] +
      '</i><div>' +
      esc(msg) +
      '</div><button aria-label="Dismiss">×</button>';
    t.querySelector('button').onclick = () => t.remove();
    $('#toasts').append(t);
    if (ms) setTimeout(() => t.remove(), ms);
  }
  window.alert = (m) => toast(String(m), 'warn', 6000);
  /**
   * Call the LogicLab API (same origin). Throws an Error with `.status` set for HTTP errors.
   */
  async function api(path, opt) {
    opt = opt || {};
    const r = await fetch('/api' + path, {
      method: opt.method || 'GET',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    let j = null;
    try {
      j = await r.json();
    } catch (e) {}
    if (!r.ok) {
      const e = new Error((j && j.error) || 'Server error (' + r.status + ')');
      e.status = r.status;
      e.retryAfter = Number((j && j.retryAfter) || r.headers.get('retry-after')) || 0;
      throw e;
    }
    return j;
  }
  function stat(t, c) {
    const e = $('#ss');
    e.textContent = t;
    e.className = 'st ' + (c || '');
  }
  const mdx = (t) =>
    String(t)
      .split(/(```[\s\S]*?```)/g)
      .map((p) =>
        p.startsWith('```')
          ? '<pre>' + esc(p.replace(/^```\w*\n?/, '').replace(/```$/, '')) + '</pre>'
          : esc(p)
              .replace(/`([^`\n]+)`/g, '<code>$1</code>')
              .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
              .replace(/^[-*] /gm, '• ')
              .replace(/\n/g, '<br>')
      )
      .join('');
  /* theme + menus */
  const isDark = () =>
    (document.documentElement.dataset.theme ||
      (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) == 'dark';
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    lsS('gf:theme', t);
    document.querySelector('meta[name=theme-color]').content = t == 'dark' ? '#111c33' : '#2563eb';
  }
  $('#th').onclick = $('#wth').onclick = () => setTheme(isDark() ? 'light' : 'dark');
  const closeMenus = () => ['#mm', '#avm'].forEach((q) => ($(q).hidden = true));
  document.body.insertAdjacentHTML('beforeend', '<div id="avm" hidden></div>');
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dd,#avm,.avb')) closeMenus();
  });
  $('#mo').onclick = (e) => {
    e.stopPropagation();
    const h = $('#mm').hidden;
    closeMenus();
    $('#mm').hidden = !h;
  };
  $('#mm').onclick = (e) => {
    if (e.target.closest('button')) $('#mm').hidden = true;
  };
  document.querySelectorAll('.mo').forEach((m) =>
    m.addEventListener('click', (e) => {
      if (e.target == m || e.target.dataset.close !== undefined) m.hidden = true;
    })
  );
  $('#hlp').onclick = $('#wh').onclick = () => ($('#mhelp').hidden = false);
  addEventListener('keydown', (e) => {
    if (e.key == 'Escape') {
      document.querySelectorAll('.mo').forEach((m) => (m.hidden = true));
      closeMenus();
      if (!$('#ai').hidden && document.activeElement != $('#aq')) $('#ai').hidden = true;
    }
  });
  /* header controls */
  $('#side .stabs').onclick = (e) => {
    const t = e.target.dataset.t;
    if (!t) return;
    document.querySelectorAll('.stabs button').forEach((b) => b.classList.toggle('on', b.dataset.t == t));
    $('#tc').hidden = t != 'c';
    $('#ta').hidden = t != 'a';
  };
  function cdUpd() {
    const g = nodes.filter(isG).length,
      i = nodes.filter((n) => n.type == 'IN' || n.type == 'CLK').length,
      o = nodes.filter((n) => n.type == 'LED' || n.type == 'METER').length,
      f = nodes.filter((n) => DEF[n.type].ff || DEF[n.type].reg).length,
      h =
        '<span>Gates</span><b>' +
        g +
        '</b><span>Inputs</span><b>' +
        i +
        '</b><span>Outputs</span><b>' +
        o +
        '</b><span>Flip-flops / registers</span><b>' +
        f +
        '</b><span>Components</span><b>' +
        nodes.length +
        '</b>';
    if ($('#cd').dataset.h != h) {
      $('#cd').dataset.h = h;
      $('#cd').innerHTML = h;
    }
  }
  setInterval(cdUpd, 500);
  /* palette with search */
  const CATS = [
      ['Logic Gates', ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'BUF']],
      ['Inputs & Outputs', ['IN', 'PB', 'CLK', 'LED', 'METER']],
      ['Flip-Flops', ['D', 'T', 'JK']],
      ['Registers', ['SIPO', 'PISO']]
    ],
    LBL = { IN: 'Switch', PB: 'Push button', CLK: 'Clock', LED: 'LED', METER: 'Voltmeter', BUF: 'Buffer' };
  function palBuild() {
    const p = $('#pal');
    p.innerHTML =
      '<div class="ps"><span>⌕</span><input type="search" id="pq" placeholder="Search components…" aria-label="Search components"></div><div id="pcat"></div>';
    const box = $('#pcat');
    CATS.forEach(([t, l]) => {
      const d = document.createElement('details');
      d.open = true;
      d.innerHTML = '<summary>' + esc(t) + '</summary><div class="pg"></div>';
      l.forEach((k) => {
        const b = document.createElement('button');
        b.title = TIP[k] || (DEF[k].ff ? k + ' flip-flop' : k + ' gate');
        b.dataset.k = k;
        b.append(icon(k));
        const s = document.createElement('span');
        s.textContent = LBL[k] || k;
        b.append(s);
        b.onclick = () => {
          view = V[0];
          const n = add(
            k == 'PB' ? 'IN' : k,
            (-view.x + 80) / view.s + Math.random() * 60,
            (-view.y + 60) / view.s + Math.random() * 60
          );
          if (k == 'PB') {
            n.mom = 1;
            cnt.IN--;
            n.name = 'PB' + (cnt.PB = (cnt.PB || 0) + 1);
          }
          sel = new Set([n]);
          selN = new Set();
          selW = null;
          changed();
          document.body.classList.remove('sh-pal');
        };
        d.querySelector('.pg').append(b);
      });
      box.append(d);
    });
    $('#pq').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      box
        .querySelectorAll('button')
        .forEach(
          (b) =>
            (b.hidden = !(b.textContent.toLowerCase().includes(q) || b.dataset.k.toLowerCase().includes(q)))
        );
      box.querySelectorAll('details').forEach((d) => {
        d.hidden = ![...d.querySelectorAll('button')].some((b) => !b.hidden);
        if (q) d.open = true;
      });
    };
  }
  palBuild();
  /* ---- accounts ---- */
  function setUser(u) {
    USER = u;
    NSP = u ? 'gf:' + u.id + ':' : 'gf:guest:';
    if (u) lsS('gf:lastuser', JSON.stringify(u));
    else lsD('gf:lastuser');
    avUI();
  }
  function avUI() {
    const ini = USER
      ? USER.name
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : '';
    ['#av', '#wav'].forEach((q) => {
      const b = $(q);
      b.textContent = USER ? ini : 'Sign in';
      b.classList.toggle('in', !!USER);
      b.title = USER ? USER.email : 'Sign in to sync';
    });
    $('#wbn').hidden = !!USER;
    $('#avm').innerHTML = USER
      ? '<div class="who"><b>' +
        esc(USER.name) +
        '</b><small>' +
        esc(USER.email) +
        '</small></div>' +
        (USER.role === 'admin' ? '<a href="/admin/">⚙ Admin panel</a>' : '') +
        '<button id="snc">⟳ Sync now</button><button id="lo">⎋ Log out</button>'
      : '';
  }
  function avClick(e) {
    e.stopPropagation();
    if (!USER) return authOpen('login');
    const m = $('#avm'),
      h = m.hidden;
    closeMenus();
    m.hidden = !h;
    m.style.top = e.currentTarget.getBoundingClientRect().bottom + 8 + 'px';
  }
  $('#av').onclick = $('#wav').onclick = avClick;
  $('#wsi').onclick = () => authOpen('login');
  $('#avm').onclick = async (e) => {
    const id = e.target.id;
    if (id == 'snc') {
      closeMenus();
      toast('Syncing…', 'info', 1500);
      await syncAll(true);
    }
    if (id == 'lo') await logout();
  };
  function authOpen(mode, msg, after) {
    AFTER = after || null;
    AMODE = mode || 'login';
    const su = AMODE == 'signup',
      f = $('#au').elements;
    $('#at').textContent = su ? 'Create your account' : 'Welcome back';
    $('#as').textContent =
      msg ||
      (su
        ? 'Get started with LogicLab and build amazing circuits.'
        : 'Log in to sync your projects and use LogicLab AI.');
    f.fname.hidden = f.password2.hidden = $('#terms').hidden = !su;
    $('#asb').textContent = su ? 'Sign up' : 'Log in';
    $('#asw').innerHTML = su
      ? 'Already have an account? <a>Log in</a>'
      : 'Don’t have an account? <a>Sign up</a>';
    f.password.autocomplete = su ? 'new-password' : 'current-password';
    $('#aerr').hidden = true;
    $('#mauth').hidden = false;
    setTimeout(() => (su ? f.fname : f.email).focus(), 60);
  }
  const authErr = (m) => {
    const e = $('#aerr');
    e.textContent = m;
    e.hidden = false;
  };
  $('#asw').onclick = (e) => {
    if (e.target.tagName == 'A') authOpen(AMODE == 'signup' ? 'login' : 'signup', '', AFTER);
  };
  $('#aoff').onclick = () => ($('#mauth').hidden = true);
  $('#au').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target.elements,
      su = AMODE == 'signup',
      body = { email: f.email.value.trim(), password: f.password.value };
    if (su) {
      if (f.password.value !== f.password2.value) return authErr('Passwords do not match.');
      if (!f.terms.checked) return authErr('Please accept the Terms of Service and Privacy Policy.');
      body.name = f.fname.value.trim();
    }
    const b = $('#asb');
    b.disabled = true;
    try {
      const r = await api('/auth/' + (su ? 'signup' : 'login'), { method: 'POST', body });
      adopt(r.user);
      $('#mauth').hidden = true;
      f.password.value = f.password2.value = '';
      toast('Welcome, ' + r.user.name + '!', 'success');
      syncAll();
      if (AFTER) {
        const a = AFTER;
        AFTER = null;
        a();
      }
    } catch (x) {
      if (x.status === 404 && !su) {
        const email = f.email.value;
        authOpen('signup', 'No account was found for this email. Create one to continue.', AFTER);
        f.email.value = email;
      } else {
        authErr(x.status ? x.message : 'Can’t reach the server. Check your connection and try again.');
      }
    }
    b.disabled = false;
  };
  function adopt(u) {
    let g = [];
    try {
      g = JSON.parse(lsG('gf:guest:idx') || '[]');
    } catch (e) {}
    setUser(u);
    if (g.length && confirm('Add the ' + g.length + ' project(s) saved on this device to your account?')) {
      const mine = idxGet();
      g.forEach((e) => {
        if (!mine.find((m) => m.id == e.id)) {
          mine.push(Object.assign({}, e, { dirty: 1 }));
          ['p', 't'].forEach((c) => {
            const v = lsG('gf:guest:' + c + ':' + e.id);
            if (v) lsS(kk(c + ':') + e.id, v);
          });
        }
      });
      lsS(kk('idx'), JSON.stringify(mine));
    }
    rcRender();
  }
  async function logout() {
    closeMenus();
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    PID = null;
    load('');
    showWelcome();
    toast('Logged out. Your projects stay in your account.', 'info');
  }
  async function initAuth() {
    try {
      const r = await api('/me');
      if (!r.user) {
        if (USER) {
          setUser(null);
          rcRender();
          toast('Your session expired. Sign in again to keep syncing.', 'warn', 6000);
        }
        return;
      }
      USER = r.user;
      setUser(r.user);
      rcRender();
      syncAll();
    } catch (e) {}
  }
  /* ---- local project index + offline-first sync ---- */
  function idxUpd(id, fn) {
    const x = idxGet();
    let e = x.find((i) => i.id == id);
    if (!e) {
      e = { id, created: Date.now() };
      x.push(e);
    }
    fn(e);
    lsS(kk('idx'), JSON.stringify(x));
    return e;
  }
  function hasCycle() {
    const g = new Map();
    wires.forEach((w) => {
      (g.get(w.a) || g.set(w.a, []).get(w.a)).push(w.b);
    });
    const st = new Map(),
      dfs = (u) => {
        st.set(u, 1);
        for (const v of g.get(u) || []) {
          const q = st.get(v);
          if (q == 1) return true;
          if (!q && dfs(v)) return true;
        }
        st.set(u, 2);
        return false;
      };
    return nodes.some((n) => !st.get(n.id) && dfs(n.id));
  }
  const projType = () =>
    nodes.some((n) => DEF[n.type].ff || DEF[n.type].reg) || hasCycle() ? 'Sequential' : 'Combinational';
  const sigNow = () =>
    PID +
    '|' +
    pname +
    '|' +
    dstr() +
    '|' +
    nodes
      .filter((n) => n.type == 'IN')
      .map((n) => n.v)
      .join('');
  const isOn = () => USER && navigator.onLine;
  function syncSoon() {
    clearTimeout(syncT);
    if (isOn()) syncT = setTimeout(syncAll, 2500);
  }
  /**
   * Save the open project on this device (only when something changed) and schedule a cloud sync.
   */
  function autosave() {
    if (!PID) return;
    try {
      const sg_ = sigNow();
      if (sg_ === lastSig) return;
      lastSig = sg_;
      const ok = lsS(kk('p:') + PID, JSON.stringify(docJSON()));
      lsS(kk('t:') + PID, snapCanvas(240, 150, vw[0] == 'bb' ? 'sch' : vw[0]).toDataURL('image/jpeg', 0.6));
      idxUpd(PID, (e) => {
        e.name = pname;
        e.updated = Date.now();
        e.dirty = 1;
        e.type = projType();
        e.count = nodes.length;
      });
      if (!ok) stat('⚠ Device storage full', 'warn');
      else if (!USER) stat('✓ Saved on this device', 'ok');
      else if (!navigator.onLine) stat('⚠ Offline · saved on this device', 'warn');
      else stat('Saving…');
    } catch (e) {
      stat('⚠ Could not save', 'warn');
    }
    syncSoon();
  }
  /**
   * Two-way sync with the server: push local changes, pull newer versions, apply deletions.
   * Conflict rule: the most recent edit wins.
   */
  async function syncAll(force) {
    if (!isOn() || syncing) return;
    syncing = 1;
    stat('☁ Syncing…');
    try {
      const srv = (await api('/projects')).projects,
        sm = new Map(srv.map((p) => [p.id, p]));
      let del = [];
      try {
        del = JSON.parse(lsG(kk('del')) || '[]');
      } catch (e) {}
      for (const id of del.slice()) {
        try {
          await api('/projects/' + id, { method: 'DELETE' });
          del = del.filter((x) => x != id);
        } catch (e) {
          if (e.status == 404) del = del.filter((x) => x != id);
        }
      }
      lsS(kk('del'), JSON.stringify(del));
      for (const p of srv) {
        if (del.includes(p.id)) continue;
        const l = idxGet().find((e) => e.id == p.id);
        if (!l || (p.updated > l.updated && !l.dirty)) {
          const r = await api('/projects/' + p.id);
          lsS(kk('p:') + p.id, JSON.stringify(r.doc));
          idxUpd(p.id, (e) => {
            e.name = p.name;
            e.created = p.created;
            e.updated = p.updated;
            e.dirty = 0;
            e.type = p.type;
            e.count = p.count;
            e.tpl = p.tpl;
          });
          if (p.id == PID && !HOOK.live)
            toast(
              'This project was updated on another device. Reopen it from Home to see the changes.',
              'info',
              7000
            );
        }
      }
      for (const e of idxGet()) {
        const sv = sm.get(e.id);
        if (!sv || e.dirty || e.updated > sv.updated) {
          const doc = lsG(kk('p:') + e.id);
          if (!doc) continue;
          const r = await api('/projects/' + e.id, {
            method: 'PUT',
            body: {
              name: e.name,
              created: e.created,
              updated: e.updated,
              type: e.type,
              count: e.count,
              tpl: e.tpl || '',
              doc: JSON.parse(doc)
            }
          });
          idxUpd(e.id, (x) => {
            x.dirty = 0;
            if (r.conflict) {
              x.updated = 0;
            }
          });
        }
      }
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      stat('✓ Synced ' + t, 'ok');
      if (force) toast('All projects are in sync.', 'success', 2000);
      rcRender();
    } catch (e) {
      if (e.status === 401) {
        setUser(null);
        toast('Your session expired. Sign in again to keep syncing.', 'warn', 6000);
      } else stat('⚠ Sync paused: ' + (navigator.onLine ? e.message : 'offline'), 'warn');
    }
    syncing = 0;
  }
  addEventListener('online', () => {
    toast('Back online.', 'success', 2000);
    syncAll();
  });
  addEventListener('offline', () => {
    toast(
      'You are offline. Changes are saved on this device and will sync when you reconnect.',
      'warn',
      5000
    );
    if (USER) stat('⚠ Offline · saved on this device', 'warn');
  });
  setInterval(() => {
    if (isOn()) syncAll();
  }, 60000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http'))
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  /* ---- welcome screen ---- */

  function rcRender() {
    const q = WZ.q,
      x = idxGet()
        .filter((e) => !q || (e.name || '').toLowerCase().includes(q))
        .sort((a, b) => b.updated - a.updated);
    $('#rl').innerHTML = x.length
      ? '<div class="rr rh"><span></span><span>Project</span><span>Type</span><span>Components</span><span>Last modified</span><span></span></div>' +
        x
          .map(
            (e) =>
              '<div class="rr" data-id="' +
              e.id +
              '"><img src="' +
              (lsG(kk('t:') + e.id) || '') +
              '" alt=""><b>' +
              esc(e.name) +
              '<small>Logic circuit' +
              (e.dirty && USER ? ' · not synced yet' : '') +
              '</small></b><span class="ty">' +
              esc(e.type || 'Circuit') +
              '</span><span>⚙ ' +
              (e.count || 0) +
              '</span><span class="mu">' +
              ago(e.updated) +
              '</span><button data-del="' +
              e.id +
              '" title="Delete project" aria-label="Delete project">✕</button></div>'
          )
          .join('')
      : '<p class="mu">' +
        (q
          ? 'No projects match your search.'
          : 'No projects yet. Start a new one or pick a template above. Projects are saved automatically.') +
        '</p>';
  }

  function showWelcome(section) {
    if (HOOK.home) HOOK.home();
    autosave();
    rcRender();
    tplRender();
    avUI();
    $('#wl').hidden = false;
    document.body.classList.add('wl-open');
    document.body.classList.remove('sh-pal', 'sh-side', 'sh-wave');
    $('#wc').scrollLeft = 0;
    $('#wmain').scrollTop = 0;
    if (typeof section === 'string')
      requestAnimationFrame(() => $('#' + section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  function openRecent(id) {
    const j = lsG(kk('p:') + id);
    if (!j) return toast('That project is not on this device yet.', 'warn');
    try {
      PID = null;
      loadDoc(JSON.parse(j));
      PID = id;
      lastSig = sigNow();
      stat(
        USER
          ? navigator.onLine
            ? '✓ Synced'
            : '⚠ Offline · saved on this device'
          : '✓ Saved on this device',
        'ok'
      );
      showApp();
    } catch (e) {
      toast('Could not open this project.', 'error');
    }
  }
  $('#rl').onclick = (e) => {
    const d = e.target.dataset.del;
    if (d) {
      if (confirm('Delete this project from this device' + (USER ? ' and your account' : '') + '?')) {
        lsD(kk('p:') + d);
        lsD(kk('t:') + d);
        lsS(kk('idx'), JSON.stringify(idxGet().filter((i) => i.id != d)));
        if (USER) {
          let x = [];
          try {
            x = JSON.parse(lsG(kk('del')) || '[]');
          } catch (e) {}
          x.push(d);
          lsS(kk('del'), JSON.stringify(x));
          syncSoon();
        }
        rcRender();
      }
      return;
    }
    const r = e.target.closest('.rr[data-id]');
    if (r) openRecent(r.dataset.id);
  };
  $('#wq').oninput = (e) => {
    WZ.q = e.target.value.trim().toLowerCase();
    tplRender();
    rcRender();
  };
  $('#wn2').onclick = () => newProj();
  $('#wex').onclick = () => $('#wt').scrollIntoView({ behavior: 'smooth' });
  $('#wai').onclick = makeWithAI;
  document.querySelectorAll('#wl .nv').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('#wl .nv').forEach((x) => x.classList.toggle('on', x == b));
    })
  );
  document.querySelectorAll('#wl .nt').forEach(
    (b) =>
      (b.onclick = () => {
        newProj();
        document.querySelector('#seg [data-v="' + b.dataset.v + '"]').click();
      })
  );
  /* mobile bottom nav */
  $('#bn').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = b.dataset.n,
      B = document.body;
    if (k == 'templates') return showWelcome('wt');
    if (k == 'ai') return openAI();
    const c = 'sh-' + k,
      on = !B.classList.contains(c);
    B.classList.remove('sh-pal', 'sh-side', 'sh-wave');
    if (on) B.classList.add(c);
    document
      .querySelectorAll('#bn button')
      .forEach((x) => x.classList.toggle('on', B.classList.contains('sh-' + x.dataset.n)));
  };
  [cv, pc].forEach((c) =>
    c.addEventListener('pointerdown', () => {
      document.body.classList.remove('sh-pal', 'sh-side', 'sh-wave');
      document.querySelectorAll('#bn button').forEach((x) => x.classList.remove('on'));
    })
  );
  /* ---- LogicLab AI (agent loop: the server calls the model, tools run here in the browser) ---- */
  const AI = { msgs: [], busy: 0 };
  function openAI() {
    if (!USER) return authOpen('login', 'Sign in to use LogicLab AI.', openAI);
    $('#ai').hidden = false;
    setTimeout(() => $('#aq').focus(), 80);
  }
  $('#aib').onclick = openAI;
  $('#ax').onclick = () => ($('#ai').hidden = true);
  function makeWithAI() {
    if (!USER) return authOpen('login', 'Sign in to use LogicLab AI.', makeWithAI);
    if (!navigator.onLine) return toast('LogicLab AI needs an internet connection.', 'warn');
    newProj('', 'AI project');
    openAI();
  }
  function aiAdd(role, html) {
    const d = document.createElement('div');
    d.className = 'bb ' + role;
    d.innerHTML = html;
    $('#am').append(d);
    $('#ah0').hidden = true;
    d.scrollIntoView({ block: 'end' });
    return d;
  }
  $('#ah0').onclick = (e) => {
    const b = e.target.closest('button[data-p]');
    if (b) aiSend(b.dataset.p);
  };
  $('#asg').onclick = (e) => {
    if (e.target.tagName == 'BUTTON')
      aiSend(
        e.target.textContent +
          (e.target.textContent == 'Quiz me'
            ? ' about this circuit with 3 questions'
            : e.target.textContent == 'Explain this circuit'
              ? ' step by step'
              : e.target.textContent == 'Generate Verilog'
                ? ' for this circuit'
                : ' for this circuit')
      );
  };
  $('#af').onsubmit = (e) => {
    e.preventDefault();
    const q = $('#aq').value;
    $('#aq').value = '';
    $('#aq').style.height = '';
    aiSend(q);
  };
  $('#aq').addEventListener('keydown', (e) => {
    if (e.key == 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#af').requestSubmit();
    }
  });
  $('#aq').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(110, e.target.scrollHeight) + 'px';
  });
  function trimMsgs() {
    let m = AI.msgs;
    if (m.length <= 30) return m;
    let i = m.length - 30;
    while (i < m.length && !(m[i].role == 'user' && typeof m[i].content == 'string')) i++;
    return m.slice(i);
  }
  const DOTS = '<span class="dots"><i></i><i></i><i></i></span>';
  const AI_RETRY_DELAYS = [5, 5];
  const aiWait = (node, seconds, visible = true) =>
    new Promise((resolve) => {
      if (!visible) {
        const timer = setTimeout(resolve, seconds * 1000);
        node.className = 'bb a ai-working';
        node.innerHTML = DOTS;
        node._hiddenRetryTimer = timer;
        return;
      }
      let remaining = seconds;
      node.className = 'bb a ai-retrying';
      node.innerHTML =
        '<span class="ai-retry-message">Still working…</span><span class="ai-retry-count">Retrying automatically in ' +
        remaining +
        's</span><button type="button" class="ai-retry-now">Retry now</button>';
      const count = node.querySelector('.ai-retry-count');
      const button = node.querySelector('.ai-retry-now');
      let timer;
      const finish = () => {
        clearInterval(timer);
        button.removeEventListener('click', finish);
        resolve();
      };
      button.addEventListener('click', finish);
      timer = setInterval(() => {
        remaining--;
        if (remaining <= 0) finish();
        else count.textContent = 'Retrying automatically in ' + remaining + 's';
      }, 1000);
    });
  async function aiRequest(body, node) {
    let attempt = 0;
    while (true) {
      try {
        return await api('/ai', { method: 'POST', body });
      } catch (e) {
        if (e.status && ![429, 502, 503, 504].includes(e.status)) throw e;
        if (attempt >= 2) throw e;
        const visible = attempt === 1;
        await aiWait(node, AI_RETRY_DELAYS[Math.min(attempt, 1)], visible);
        attempt++;
      }
    }
  }
  function showAIError(error, step, requestBody, workflow) {
    const message = 'The AI service is temporarily unavailable. Please try again.';
    const retryable =
      !error.status ||
      [502, 503, 504].includes(error.status) ||
      (error.status === 429 && error.retryAfter > 0);
    const node = aiAdd(
      'err',
      '<span>' +
        esc(message) +
        '</span>' +
        (retryable
          ? '<button type="button" id="aretry" class="ai-retry-now">Continue this request</button>'
          : '')
    );
    const retryButton = node.querySelector('#aretry');
    if (retryButton)
      retryButton.onclick = async () => {
        node.remove();
        AI.busy = 1;
        $('#as').disabled = true;
        try {
          await runAgent(step, requestBody, workflow);
        } finally {
          AI.busy = 0;
          $('#as').disabled = false;
        }
      };
    if (error.status === 401) {
      setUser(null);
      authOpen('login', 'Your session expired. Sign in again.');
    }
  }
  function aiWorkflow() {
    const node = aiAdd(
      'workflow',
      '<div class="ai-workflow-head"><span class="ai-workflow-icon">⌘</span><b>Running agentic workflow…</b><span class="ai-workflow-state">Running</span><button type="button" class="ai-workflow-toggle" aria-label="Collapse workflow details" aria-expanded="true">−</button></div><div class="ai-workflow-steps"></div>'
    );
    return node;
  }
  $('#am').addEventListener('click', (e) => {
    const toggle = e.target.closest('.ai-workflow-toggle');
    if (!toggle) return;
    const workflow = toggle.closest('.workflow');
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.setAttribute('aria-label', expanded ? 'Expand workflow details' : 'Collapse workflow details');
    toggle.textContent = expanded ? '+' : '−';
    workflow.classList.toggle('collapsed', expanded);
  });
  function aiWorkflowStep(node, label) {
    const step = document.createElement('div');
    step.className = 'ai-workflow-step';
    step.innerHTML = '<span class="ai-step-check">✓</span><span class="ai-step-icon">⚙</span><span></span>';
    step.lastElementChild.textContent = label;
    node.querySelector('.ai-workflow-steps').append(step);
    node.scrollIntoView({ block: 'end' });
  }
  function finishAIWorkflow(node) {
    if (!node) return;
    node.classList.add('done');
    node.querySelector('.ai-workflow-state').textContent = 'Complete';
    node.querySelector('.ai-workflow-icon').textContent = '✓';
    node.querySelector('.ai-workflow-head b').textContent = 'Agent workflow completed';
    node.classList.add('collapsed');
    const toggle = node.querySelector('.ai-workflow-toggle');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Expand workflow details');
    toggle.textContent = '+';
  }
  /**
   * Send a chat message to LogicLab AI and run the tool loop until the model gives a final answer.
   */
  async function aiSend(text) {
    text = (text || '').trim();
    if (!text || AI.busy) return;
    if (!USER) return authOpen('login', 'Sign in to use LogicLab AI.');
    if (!navigator.onLine) return toast('LogicLab AI needs an internet connection.', 'warn');
    AI.busy = 1;
    $('#as').disabled = true;
    aiAdd('u', esc(text));
    AI.msgs.push({ role: 'user', content: text });
    try {
      await runAgent(0);
    } finally {
      AI.busy = 0;
      $('#as').disabled = false;
    }
  }
  async function runAgent(startStep, retryBody, resumedWorkflow = null) {
    let node = aiAdd('a', DOTS);
    let workflow = resumedWorkflow;
    for (let i = startStep; i < 8; i++) {
      const requestBody =
        i === startStep && retryBody
          ? retryBody
          : {
              messages: trimMsgs(),
              context: ctxSummary(),
              templates: WZ.tpl.map((t) => t.k + '=' + t.t).join('; ')
            };
      let r;
      try {
        r = await aiRequest(requestBody, node);
      } catch (error) {
        if (node.isConnected) node.remove();
        showAIError(error, i, requestBody, workflow);
        return;
      }
      AI.msgs.push({ role: 'assistant', content: r.content });
      const txt = r.content
        .filter((b) => b.type == 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      if (txt) {
        node.className = 'bb a';
        node.innerHTML = mdx(txt);
      } else node.remove();
      const uses = r.content.filter((b) => b.type == 'tool_use');
      if (!uses.length) {
        finishAIWorkflow(workflow);
        return;
      }
      workflow = workflow || aiWorkflow();
      if (workflow.querySelector('.ai-workflow-steps').childElementCount === 0)
        aiWorkflowStep(workflow, 'Analyzed the request');
      const res = uses.map((u) => {
        let out;
        try {
          out = execTool(u.name, u.input || {});
        } catch (e) {
          out = { error: String((e && e.message) || e) };
        }
        aiWorkflowStep(workflow, toolLabel(u.name, out));
        const o = { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 7000) };
        if (out.error) o.is_error = true;
        return o;
      });
      AI.msgs.push({ role: 'user', content: res });
      node = aiAdd('a', DOTS);
    }
    if (node.isConnected && node.querySelector('.dots')) node.remove();
    finishAIWorkflow(workflow);
  }
  function toolLabel(n, o) {
    if (o.error) return n.replace('_', ' ') + ' failed: ' + o.error;
    return (
      {
        build_circuit:
          'Built ' +
          o.parts +
          ' parts and ' +
          o.wires +
          ' wires' +
          (o.warnings && o.warnings.length ? ' (' + o.warnings.length + ' warnings)' : ''),
        set_input: 'Set ' + o.name + ' = ' + o.value,
        get_state: 'Checked the circuit',
        control_simulation: 'Simulation: ' + o.action,
        load_template: 'Loaded template',
        clear_circuit: 'Cleared the canvas'
      }[n] || n
    );
  }
  function ctxSummary() {
    const P = nodes
        .map(
          (n) =>
            n.id +
            ':' +
            n.type +
            ' "' +
            n.name +
            '"' +
            (n.type == 'IN' ? '=' + n.v : '') +
            (MULTI.has(n.type) && n.nin > 2 ? ' (' + n.nin + ' inputs)' : '')
        )
        .join('; '),
      W = wires.map((w) => '#' + w.a + (w.ap ? '.' + w.ap : '') + '->#' + w.b + '.' + w.bp).join(', ');
    return (
      'Project "' +
      pname +
      '". Parts (id:type "name"): ' +
      (P || 'none') +
      '. Wires (#from.outPin->#to.inPin): ' +
      (W || 'none') +
      '.' +
      (osc ? ' The circuit is currently oscillating.' : '') +
      (run ? ' Simulation is running.' : ' Simulation is paused.')
    );
  }
  function pinIdx(n, ref, out) {
    const L = out ? DEF[n.type].outs : DEF[n.type].ins;
    if (ref === undefined || ref === '') return out ? 0 : -1;
    const r = String(ref);
    if (/^\d+$/.test(r)) return +r;
    const al = { clk: '>', clock: '>', qn: 'Q̄', qbar: 'Q̄', "q'": 'Q̄', q̄: 'Q̄' },
      k = (al[r.toLowerCase()] || r).toLowerCase();
    return L.findIndex((x) => x.toLowerCase() == k);
  }

  /**
   * Create parts and wires from a netlist description (shared by examples and the AI agent).
   */
  function toolBuild(a) {
    if (!Array.isArray(a.parts) || !a.parts.length) throw new Error('parts is empty');
    if (a.parts.length > 80) throw new Error('Too many parts (max 80).');
    if (a.replace !== false) {
      selAll();
      delSel();
      notes = [];
      groups = [];
    }
    const map = new Map(),
      warn = [];
    a.parts.forEach((p) => {
      if (!DEF[p.type]) {
        warn.push('Unknown type ' + p.type);
        return;
      }
      const n = add(p.type, 0, 0);
      n.name = String(p.name || p.id).slice(0, 12);
      if (MULTI.has(p.type) && p.inputs > 2 && p.inputs <= 6) n.nin = p.inputs | 0;
      if (p.type == 'IN' && p.value) n.v = 1;
      if (p.type == 'CLK' && p.period) n.per = Math.max(4, p.period | 0);
      if (DEF[p.type].ff && ['R', 'F', 'H', 'L'].includes(p.trigger)) n.trig = p.trigger;
      n.key = String(p.id);
      map.set(String(p.id), n);
    });
    let ok = 0;
    (a.wires || []).forEach((w) => {
      const fs = String(w.from).split('.'),
        ts = String(w.to).split('.'),
        A = map.get(fs[0]),
        B = map.get(ts[0]);
      if (!A || !B) {
        warn.push('Skipped wire ' + w.from + ' -> ' + w.to + ': unknown part');
        return;
      }
      const ap = pinIdx(A, fs[1], 1);
      let bp = pinIdx(B, ts[1], 0);
      if (bp < 0) {
        const used = new Set(wires.filter((x) => x.b == B.id).map((x) => x.bp));
        bp = 0;
        while (used.has(bp)) bp++;
      }
      if (ap < 0 || ap >= DEF[A.type].outs.length) {
        warn.push('Bad output pin in ' + w.from);
        return;
      }
      if (bp >= nI(B)) {
        warn.push('Bad input pin in ' + w.to);
        return;
      }
      link(A, ap, B, bp);
      ok++;
    });
    aiLayout([...map.values()]);
    changed();
    requestAnimationFrame(() => {
      fitAll();
      fitView();
    });
    return { ok: true, parts: map.size, wires: ok, warnings: warn };
  }
  function toolState() {
    const s0 = sel,
      s1 = selN;
    sel = new Set();
    selN = new Set();
    let m;
    try {
      m = model();
    } finally {
      sel = s0;
      selN = s1;
    }
    const outs = {},
      ins = {};
    nodes.filter((n) => n.type == 'LED').forEach((n) => (outs[n.name] = n.o[0]));
    nodes.filter((n) => n.type == 'IN').forEach((n) => (ins[n.name] = n.v));
    const r = {
      circuit: ctxSummary(),
      inputs: ins,
      outputs: outs,
      oscillating: osc ? [...new Set(osc)] : null
    };
    if (m && !m.err)
      r.truth_table = {
        inputs: m.I,
        outputs: m.O,
        rows: m.rows.slice(0, 64).map((x) => x.b.join('') + ' -> ' + x.o.join(''))
      };
    else r.truth_table_note = m && m.err;
    return r;
  }
  /**
   * Run one AI tool call in the browser and return its JSON result.
   */
  function execTool(name, a) {
    switch (name) {
      case 'build_circuit':
        return toolBuild(a);
      case 'set_input': {
        const n = nodes.find((x) => x.type == 'IN' && x.name.toLowerCase() == String(a.name).toLowerCase());
        if (!n)
          throw new Error(
            'No switch named ' +
              a.name +
              '. Switches: ' +
              nodes
                .filter((x) => x.type == 'IN')
                .map((x) => x.name)
                .join(', ')
          );
        n.v = a.value ? 1 : 0;
        dirty = true;
        return { ok: true, name: n.name, value: n.v };
      }
      case 'get_state':
        return toolState();
      case 'control_simulation': {
        if (a.action == 'step') {
          run = false;
          $('#sim').textContent = '▶ Run';
          for (let i = 0; i < Math.min(200, a.steps || 1); i++) tick();
        } else if (a.action == 'reset') {
          resetCircuit();
        } else if (a.action == 'power_on' || a.action == 'power_off') {
          setPower(a.action == 'power_on');
        } else {
          run = a.action == 'run';
          $('#sim').textContent = run ? '❚❚ Pause' : '▶ Run';
        }
        const o = {};
        nodes.filter((n) => n.type == 'LED').forEach((n) => (o[n.name] = n.o[0]));
        return { ok: true, action: a.action, outputs: o };
      }
      case 'load_template': {
        if (!WZ.tpl.find((t) => t.k == a.key)) throw new Error('Unknown template ' + a.key);
        cur = a.key;
        load(a.key);
        return { ok: true, summary: ctxSummary() };
      }
      case 'clear_circuit':
        selAll();
        delSel();
        notes = [];
        groups = [];
        commit();
        return { ok: true };
      default:
        throw new Error('Unknown tool ' + name);
    }
  }
  avUI();
  initAuth();

  /* ---------- adjustable panels (drag the handles; double-click a handle to reset) ---------- */
  const PANELS = {
    pal: { prop: '--pal-w', min: 180, max: 460, label: 'components panel' },
    side: { prop: '--side-w', min: 240, max: 560, label: 'properties panel' },
    foot: { prop: '--foot-h', min: 110, max: 520, label: 'waveform panel' }
  };
  const LAYOUT_KEY = 'gf:ui';
  const savedLayout = () => {
    try {
      return JSON.parse(lsG(LAYOUT_KEY) || '{}');
    } catch (e) {
      return {};
    }
  };

  /** Set a panel size in pixels (clamped to the screen) and remember it on this device. */
  function setPanel(key, value, save = true) {
    const p = PANELS[key];
    const limit = key === 'foot' ? innerHeight * 0.6 : innerWidth * 0.45;
    const size = Math.round(Math.max(p.min, Math.min(p.max, limit, value)));
    document.documentElement.style.setProperty(p.prop, size + 'px');
    if (save) lsS(LAYOUT_KEY, JSON.stringify({ ...savedLayout(), [key]: size }));
    return size;
  }

  function resetLayout() {
    Object.values(PANELS).forEach((p) => document.documentElement.style.removeProperty(p.prop));
    lsD(LAYOUT_KEY);
  }

  /** Create a drag handle; `measure` gives the panel's current size, `delta` converts pointer movement to growth. */
  function addHandle(key, className, where, anchor, measure, delta) {
    const handle = document.createElement('div');
    handle.className = className;
    handle.tabIndex = 0;
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-label', 'Resize the ' + PANELS[key].label);
    handle.title = 'Drag to resize, double-click to reset';
    anchor[where](handle);
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('drag');
      const start = { x: e.clientX, y: e.clientY, size: measure() };
      const move = (m) => setPanel(key, start.size + delta(m.clientX - start.x, m.clientY - start.y));
      const stop = () => {
        handle.classList.remove('drag');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    });
    handle.addEventListener('dblclick', () => {
      document.documentElement.style.removeProperty(PANELS[key].prop);
      const rest = savedLayout();
      delete rest[key];
      lsS(LAYOUT_KEY, JSON.stringify(rest));
    });
    handle.addEventListener('keydown', (e) => {
      const step =
        e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -16
          : e.key === 'ArrowRight' || e.key === 'ArrowDown'
            ? 16
            : 0;
      if (!step) return;
      e.preventDefault();
      setPanel(key, measure() + delta(step, step));
    });
  }

  function initPanels() {
    const pal = $('#pal'),
      side = $('#side'),
      foot = $('footer');
    addHandle(
      'pal',
      'rz',
      'after',
      pal,
      () => pal.getBoundingClientRect().width,
      (dx) => dx
    );
    addHandle(
      'side',
      'rz',
      'before',
      side,
      () => side.getBoundingClientRect().width,
      (dx) => -dx
    );
    addHandle(
      'foot',
      'rzh',
      'before',
      foot,
      () => foot.getBoundingClientRect().height,
      (dx, dy) => -dy
    );
    const saved = savedLayout();
    Object.keys(PANELS).forEach((k) => saved[k] && setPanel(k, saved[k], false));
  }
  $('#rsz').onclick = resetLayout;

  /* ---------- start-up ---------- */
  initPanels();
  updatePowerUI();
  document.addEventListener(
    'error',
    (e) => {
      if (e.target && e.target.tagName === 'IMG') e.target.style.visibility = 'hidden';
    },
    true
  );
  load('');
  WZ.tpl = tplList();
  populateExamples();
  showWelcome();
  handleDeepLink();
  requestAnimationFrame((t) => {
    last = t;
    requestAnimationFrame(frame);
  });
})();
