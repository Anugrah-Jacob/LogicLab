/**
 * LogicLab live-collaboration merge engine (no DOM, no network; also loaded by the tests in Node).
 *
 * A project is split into small "items": a part (n:<id>), a wire (w:<a>:<ap>:<b>:<bp>), a drawing (a:<id>),
 * a group (g:<id>), a layer (l:<id>) and the project name (m:name). Every item carries a timestamp and the
 * sender's slot. When two people change the same item, the newer one wins (the slot breaks exact ties), and a
 * deleted item stays as a "tombstone" so a late edit cannot bring it back. Changes to different items never
 * conflict, so two people can work on different parts of a circuit at the same moment without losing anything.
 * Every browser ends up with the same result whatever order the messages arrive in.
 */
(function (root) {
  'use strict';
  const NODE_FIELDS = ['id', 'type', 'x', 'y', 'name', 'nin', 'per', 'trig', 'probe', 'hide', 'mom'];
  const TYPES = new Set([
    'AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR', 'NOT', 'BUF', 'D', 'T', 'JK', 'IN', 'CLK', 'LED', 'METER', 'SIPO', 'PISO'
  ]);
  const MAX_SKEW = 10 * 60 * 1000; // ignore timestamps more than 10 minutes in the future

  /** JSON with sorted keys, so two equal objects always give the same text. */
  const canon = (v) =>
    JSON.stringify(v, (k, x) =>
      x && typeof x === 'object' && !Array.isArray(x)
        ? Object.keys(x)
            .sort()
            .reduce((o, kk) => ((o[kk] = x[kk]), o), {})
        : x
    );
  const wkey = (w) => 'w:' + w.a + ':' + w.ap + ':' + w.b + ':' + w.bp;

  /** Split a project document into items: Map key -> value. */
  function items(doc) {
    const m = new Map();
    (doc.nodes || []).forEach((n) => {
      const v = {};
      NODE_FIELDS.forEach((f) => {
        if (n[f] !== undefined) v[f] = n[f];
      });
      m.set('n:' + n.id, v);
    });
    (doc.wires || []).forEach((w) => m.set(wkey(w), 1));
    (doc.notes || []).forEach((a) => {
      if (a && a.id != null) m.set('a:' + a.id, a);
    });
    (doc.groups || []).forEach((g) =>
      m.set('g:' + g.id, { id: g.id, name: g.name, ids: g.ids, nids: g.nids || [] })
    );
    (doc.layers || []).forEach((l) => m.set('l:' + l.id, l));
    if (doc.name != null) m.set('m:name', String(doc.name));
    return m;
  }

  const num = (x) => typeof x === 'number' && isFinite(x);
  /** Reject anything that is not a well-formed item, so a bad message can never crash someone's editor. */
  function valid(k, v) {
    if (typeof k !== 'string' || k.length > 80) return false;
    if (k === 'm:name') return v === null || typeof v === 'string';
    const kind = k[0],
      id = Number(k.slice(2));
    if (k[1] !== ':' && kind !== 'w') return false;
    if (kind === 'w') {
      const p = k.split(':').slice(1).map(Number);
      return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0) && (v === 1 || v === null);
    }
    if (v === null) return 'nagl'.includes(kind) && Number.isFinite(id);
    if (typeof v !== 'object' || Array.isArray(v) || !Number.isFinite(id)) return false;
    if (kind === 'n')
      return (
        v.id === id &&
        TYPES.has(v.type) &&
        num(v.x) &&
        num(v.y) &&
        (v.name === undefined || (typeof v.name === 'string' && v.name.length <= 16)) &&
        (v.nin === undefined || (Number.isInteger(v.nin) && v.nin >= 1 && v.nin <= 16)) &&
        (v.per === undefined || num(v.per))
      );
    if (kind === 'a') return v.id === id && JSON.stringify(v).length < 200000;
    if (kind === 'g') return v.id === id && Array.isArray(v.ids) && v.ids.every(num);
    if (kind === 'l') return v.id === id;
    return false;
  }

  const newer = (a, b) => a.t > b.t || (a.t === b.t && a.p > b.p);

  class Replica {
    constructor(slot) {
      this.slot = slot | 0;
      this.clock = 0;
      this.st = new Map(); // key -> { v (null = deleted), s (canonical text), t, p }
    }
    next() {
      this.clock = Math.max(Date.now(), this.clock + 1);
      return this.clock;
    }
    /** Adopt a document as the starting point (timestamp 0, so any real edit wins over it). */
    seed(doc) {
      this.st.clear();
      for (const [k, v] of items(doc)) this.st.set(k, { v, s: canon(v), t: 0, p: 0 });
    }
    /** Compare the live document with what we last knew; returns the ops for what this person changed. */
    local(doc) {
      const ops = [],
        cur = items(doc);
      for (const [k, v] of cur) {
        const s = canon(v),
          e = this.st.get(k);
        if (!e || e.v === null || e.s !== s) {
          const t = this.next();
          this.st.set(k, { v, s, t, p: this.slot });
          ops.push({ k, v, t, p: this.slot });
        }
      }
      for (const [k, e] of this.st) {
        if (e.v !== null && !cur.has(k)) {
          const t = this.next();
          this.st.set(k, { v: null, s: 'null', t, p: this.slot });
          ops.push({ k, v: null, t, p: this.slot });
        }
      }
      return ops;
    }
    /** Merge ops from another person. Returns how many changed our state. */
    remote(ops) {
      let n = 0;
      const limit = Date.now() + MAX_SKEW;
      for (const op of Array.isArray(ops) ? ops : []) {
        if (!op || !num(op.t) || !Number.isInteger(op.p) || op.t > limit || op.t < 0) continue;
        if (!valid(op.k, op.v === undefined ? null : op.v)) continue;
        const v = op.v === undefined ? null : op.v,
          e = this.st.get(op.k);
        if (op.t > this.clock) this.clock = op.t;
        if (!e || newer(op, e)) {
          this.st.set(op.k, { v, s: v === null ? 'null' : canon(v), t: op.t, p: op.p });
          n++;
        }
      }
      return n;
    }
    /** Everything we know, including deletions: sent to a person who just joined. */
    full() {
      return [...this.st].map(([k, e]) => ({ k, v: e.v, t: e.t, p: e.p }));
    }
    /** The items that should exist. Of two wires into the same input pin only the newer one counts. */
    desired() {
      const out = new Map(),
        dest = new Map();
      for (const [k, e] of this.st) {
        if (e.v === null) continue;
        if (k[0] === 'w') {
          const q = k.split(':'),
            d = q[3] + ':' + q[4],
            prev = dest.get(d);
          if (!prev || newer(e, prev.e)) dest.set(d, { k, e });
        } else out.set(k, e.v);
      }
      for (const { k } of dest.values()) out.set(k, 1);
      return out;
    }
    /** What must change in the live document so it matches our state: [{ k, v }], parts first. */
    reconcile(doc) {
      const have = items(doc),
        want = this.desired(),
        ch = [];
      for (const [k, v] of want) {
        const h = have.get(k);
        if (h === undefined || canon(h) !== canon(v)) ch.push({ k, v });
      }
      for (const k of have.keys()) if (!want.has(k)) ch.push({ k, v: null });
      return ch.sort((a, b) => (a.k[0] === 'n' ? 0 : 1) - (b.k[0] === 'n' ? 0 : 1));
    }
  }

  const api = { Replica, items, canon, valid, NODE_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.LLMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
