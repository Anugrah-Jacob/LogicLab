// Engine and example verification. Run with: npm test
import { serve, openApp, chromium, test, eq, ok, summary } from './harness.mjs';

const { server, url } = await serve();
const browser = await chromium.launch();
const { page, problems } = await openApp(browser, url);
const run = (fn, arg) => page.evaluate(fn, arg);
await run(() => LogicLab.pause());

/* ---- helpers that run inside the page ---- */
const helpers = () => {
  window.T = {
    settle: (n = 40) => LogicLab.step(n),
    /** Apply every combination of the switches, compare with expected(inputs); return mismatches. */
    sweep(expected, limit = 4) {
      const names = Object.keys(LogicLab.inputs());
      const bad = [];
      let combos = 0;
      for (let m = 0; m < 1 << names.length; m++) {
        const inp = {};
        names.forEach((nm, i) => {
          inp[nm] = (m >> i) & 1;
          LogicLab.setInput(nm, inp[nm]);
        });
        T.settle(40);
        const got = LogicLab.outputs(),
          want = expected(inp);
        combos++;
        for (const k of Object.keys(want)) {
          if (got[k] !== want[k] && bad.length < limit) bad.push({ inp, out: k, want: want[k], got: got[k] });
        }
      }
      return { combos, bad };
    },
    bits: (names) => names.map((n) => LogicLab.outputs()[n]).join(''),
    ex: (id) => LOGICLAB_EXAMPLES.find((e) => e.id === id)
  };
};
await run(helpers);

/* ---- 1. every basic gate, every input count ---- */
const REF = {
  AND: (a) => +a.every(Boolean),
  OR: (a) => +a.some(Boolean),
  NAND: (a) => +!a.every(Boolean),
  NOR: (a) => +!a.some(Boolean),
  XOR: (a) => a.reduce((x, y) => x ^ y, 0),
  XNOR: (a) => +!a.reduce((x, y) => x ^ y, 0)
};
for (const type of Object.keys(REF)) {
  await test('gate ' + type + ' with 2 to 6 inputs matches its truth table', async () => {
    const r = await run(
      ([type, src]) => {
        const ref = new Function('return ' + src)();
        const out = [];
        for (let n = 2; n <= 6; n++) {
          const parts = [],
            wires = [];
          for (let i = 0; i < n; i++) {
            parts.push({ id: 'I' + i, type: 'IN' });
            wires.push({ from: 'I' + i, to: 'G.' + i });
          }
          parts.push({ id: 'G', type, inputs: n }, { id: 'Y', type: 'LED' });
          wires.push({ from: 'G', to: 'Y' });
          const res = LogicLab.build({ replace: true, parts, wires });
          if (res.warnings.length) return { warn: res.warnings };
          const sw = T.sweep((inp) => ({ Y: ref(Array.from({ length: n }, (_, i) => inp['I' + i])) }));
          if (sw.bad.length) return { n, bad: sw.bad };
        }
        return { good: true };
      },
      [type, REF[type].toString()]
    );
    ok(r.good, JSON.stringify(r));
  });
}
await test('NOT and BUF gates', async () => {
  const r = await run(() => {
    const out = {};
    for (const [t, f] of [
      ['NOT', (a) => 1 - a],
      ['BUF', (a) => a]
    ]) {
      LogicLab.build({
        replace: true,
        parts: [
          { id: 'A', type: 'IN' },
          { id: 'G', type: t },
          { id: 'Y', type: 'LED' }
        ],
        wires: [
          { from: 'A', to: 'G' },
          { from: 'G', to: 'Y' }
        ]
      });
      out[t] = T.sweep((i) => ({ Y: f(i.A) })).bad.length;
    }
    return out;
  });
  eq(r, { NOT: 0, BUF: 0 });
});

/* ---- 2. library sanity + every combinational example ---- */
await test('the library has unique ids and titles, and every example loads without warnings', async () => {
  const r = await run(() => {
    const ids = LOGICLAB_EXAMPLES.map((e) => e.id),
      titles = LOGICLAB_EXAMPLES.map((e) => e.title);
    const warn = LOGICLAB_EXAMPLES.map((e) => [e.id, LogicLab.load(e.id)]).filter((x) => x[1].length);
    return {
      dupIds: ids.length - new Set(ids).size,
      dupTitles: titles.length - new Set(titles).size,
      warn,
      count: ids.length
    };
  });
  eq([r.dupIds, r.dupTitles, r.warn], [0, 0, []]);
  ok(r.count >= 30, 'expected at least 30 examples, got ' + r.count);
});
const comb = await run(() => LOGICLAB_EXAMPLES.filter((e) => e.check).map((e) => e.id));
for (const id of comb) {
  await test('example "' + id + '" produces the right outputs for every input combination', async () => {
    const r = await run((id) => {
      LogicLab.load(id);
      LogicLab.pause();
      return T.sweep(T.ex(id).check);
    }, id);
    eq(r.bad, [], 'wrong outputs (' + r.combos + ' combinations tried)');
  });
}

/* ---- 3. NAND-only / NOR-only conversion keeps every circuit equivalent ---- */
for (const style of ['NAND', 'NOR']) {
  await test(
    'converting all combinational examples to ' + style + '-only keeps their behaviour',
    async () => {
      const r = await run((style) => {
        const problems = [];
        for (const e of LOGICLAB_EXAMPLES.filter((x) => x.check)) {
          LogicLab.load(e.id);
          LogicLab.pause();
          const res = LogicLab.convert(style);
          const types = [...new Set(LogicLab.parts().map((p) => p.type))].filter(
            (t) => !['IN', 'LED', 'CLK', style].includes(t)
          );
          if (types.length) problems.push(e.id + ' still has ' + types.join(','));
          const sw = T.sweep(e.check, 1);
          if (sw.bad.length) problems.push(e.id + ' differs: ' + JSON.stringify(sw.bad[0]));
          if (res.skipped) problems.push(e.id + ' skipped ' + res.skipped);
        }
        return problems;
      }, style);
      eq(r, []);
    }
  );
}

/* ---- 4. the app's own truth-table analysis agrees with direct simulation ---- */
await test('truth-table analysis matches simulation for small combinational examples', async () => {
  const r = await run(() => {
    const problems = [];
    for (const e of LOGICLAB_EXAMPLES.filter(
      (x) => x.check && Object.keys((LogicLab.load(x.id), LogicLab.inputs())).length <= 5
    )) {
      LogicLab.load(e.id);
      LogicLab.pause();
      LogicLab.step(40);
      const m = LogicLab.analysis();
      if (!m || !m.rows) {
        problems.push(e.id + ': no analysis');
        continue;
      }
      const inNames = Object.keys(LogicLab.inputs()),
        outNames = Object.keys(LogicLab.outputs());
      m.rows.forEach((row) => {
        const inp = {};
        inNames.forEach((n, i) => (inp[n] = row.b[i]));
        const want = e.check(inp);
        outNames.forEach((n, i) => {
          if (want[n] !== undefined && Number(row.o[i]) !== want[n])
            problems.push(e.id + ' ' + JSON.stringify(inp) + ' ' + n);
        });
      });
    }
    return problems.slice(0, 5);
  });
  eq(r, []);
});

/* ---- 5. sequential circuits ---- */
const seq = (name, fn) =>
  test(name, async () => {
    await fn();
  });
const loadPaused = (id) =>
  run((id) => {
    LogicLab.load(id);
    LogicLab.pause();
    return LogicLab.step(0);
  }, id);
const step = (n) => run((n) => LogicLab.step(n), n);
const set = (n, v) => run(([n, v]) => LogicLab.setInput(n, v), [n, v]);
const out = () => run(() => LogicLab.outputs());
const word = async (names) => {
  const o = await out();
  return names.map((n) => o[n]).join('');
};

await seq('ripple counter counts 0 to 7 on falling clock edges and wraps', async () => {
  await loadPaused('ripple-counter-3bit');
  for (let k = 1; k <= 17; k++) {
    await step(40);
    const o = await out();
    eq(o.Q0 + 2 * o.Q1 + 4 * o.Q2, k % 8, 'after ' + k + ' clock cycles');
  }
});
await seq('synchronous counter counts 0 to 7 on rising clock edges', async () => {
  await loadPaused('sync-counter-3bit');
  for (let k = 1; k <= 17; k++) {
    await step(20);
    const o = await out();
    eq(o.Q0 + 2 * o.Q1 + 4 * o.Q2, k % 8, 'after ' + k + ' edges');
  }
});
await seq('Johnson counter walks through its 8 states', async () => {
  await loadPaused('johnson-counter-4bit');
  const want = ['0000', '1000', '1100', '1110', '1111', '0111', '0011', '0001'];
  for (let k = 1; k <= 17; k++) {
    await step(30);
    eq(await word(['Q0', 'Q1', 'Q2', 'Q3']), want[k % 8], 'edge ' + k);
  }
});
await seq('ring counter circulates a single 1 and starts by itself', async () => {
  await loadPaused('ring-counter-4bit');
  const want = { 1: '1000', 2: '0100', 3: '0010', 0: '0001' };
  for (let k = 1; k <= 13; k++) {
    await step(30);
    eq(await word(['Q0', 'Q1', 'Q2', 'Q3']), want[k % 4], 'edge ' + k);
  }
});
await seq('4-bit LFSR visits 15 distinct states and never locks up', async () => {
  await loadPaused('lfsr-4bit');
  let st = [0, 0, 0, 0];
  const seen = new Set();
  for (let k = 1; k <= 30; k++) {
    await step(30);
    st = [+!(st[3] ^ st[2]), st[0], st[1], st[2]];
    const got = await word(['Q0', 'Q1', 'Q2', 'Q3']);
    eq(got, st.join(''), 'edge ' + k);
    seen.add(got);
  }
  eq([seen.size, seen.has('1111')], [15, false]);
});
await seq('SISO shift register delays a bit by four clocks', async () => {
  await loadPaused('shift-siso');
  const o = [];
  for (let k = 1; k <= 5; k++) {
    await step(30);
    o.push((await out()).SO);
  }
  eq(o, [0, 0, 0, 1, 1]);
  await set('SI', 0);
  const p = [];
  for (let k = 1; k <= 5; k++) {
    await step(30);
    p.push((await out()).SO);
  }
  eq(p, [1, 1, 1, 0, 0]);
});
await seq('SIPO shift register holds the last four bits', async () => {
  await loadPaused('shift-sipo');
  const bits = [1, 0, 1, 1, 0, 0, 1];
  const hist = [];
  for (const b of bits) {
    await set('SI', b);
    await step(30);
    hist.unshift(b);
    const o = await out();
    eq(
      [o.Q0, o.Q1, o.Q2, o.Q3],
      [0, 1, 2, 3].map((i) => (hist[i] === undefined ? 0 : hist[i]))
    );
  }
});
await seq('PIPO register copies D to Q on the clock edge', async () => {
  await loadPaused('shift-pipo');
  for (const d of [
    [1, 0, 1, 0],
    [0, 1, 1, 1],
    [0, 0, 0, 0]
  ]) {
    for (let i = 0; i < 4; i++) await set('D' + i, d[i]);
    await step(30);
    const o = await out();
    eq([o.Q0, o.Q1, o.Q2, o.Q3], d);
  }
});
await seq('PISO shift register loads in parallel then shifts out D3 first', async () => {
  await loadPaused('shift-piso');
  for (const [i, v] of [
    [0, 1],
    [1, 1],
    [2, 0],
    [3, 0]
  ])
    await set('D' + i, v);
  await set('LD', 1);
  await step(30);
  await set('LD', 0);
  const got = [(await out()).SO];
  for (let k = 0; k < 3; k++) {
    await step(30);
    got.push((await out()).SO);
  }
  eq(got, [0, 0, 1, 1], 'SO after load and three shifts');
});
await seq('SR latch (NOR) sets, holds and resets', async () => {
  await loadPaused('sr-latch-nor');
  for (const [R, S, Q] of [
    [0, 1, 1],
    [0, 0, 1],
    [1, 0, 0],
    [0, 0, 0],
    [0, 1, 1],
    [0, 0, 1]
  ]) {
    await set('R', R);
    await set('S', S);
    await step(20);
    const o = await out();
    eq([o.Q, o.Qn], [Q, 1 - Q], 'R=' + R + ' S=' + S);
  }
});
await seq('SR latch (NAND) uses active-low inputs', async () => {
  await loadPaused('sr-latch-nand');
  for (const [Sn, Rn, Q] of [
    [0, 1, 1],
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 1]
  ]) {
    await set('Sn', Sn);
    await set('Rn', Rn);
    await step(20);
    const o = await out();
    eq([o.Q, o.Qn], [Q, 1 - Q], 'Sn=' + Sn + ' Rn=' + Rn);
  }
});
await seq('gated SR latch ignores S and R while E is low', async () => {
  await loadPaused('gated-sr-latch');
  const steps = [
    [0, 0, 1, null],
    [1, 0, 1, 1],
    [0, 0, 1, 1],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 0, 0, 0]
  ]; // E,R? see below
  for (const [E, R, S, Q] of [
    [0, 0, 1, null],
    [1, 0, 1, 1],
    [0, 1, 0, 1],
    [1, 1, 0, 0],
    [0, 0, 1, 0],
    [1, 0, 1, 1]
  ]) {
    await set('E', E);
    await set('R', R);
    await set('S', S);
    await step(20);
    const o = await out();
    if (Q !== null) eq([o.Q, o.Qn], [Q, 1 - Q], 'E=' + E + ' R=' + R + ' S=' + S);
  }
});
await seq('gated D latch is transparent while E is high and holds when low', async () => {
  await loadPaused('d-latch');
  for (const [E, D, Q] of [
    [1, 1, 1],
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 1],
    [0, 1, 1],
    [1, 0, 0],
    [0, 1, 0]
  ]) {
    await set('E', E);
    await set('D', D);
    await step(20);
    const o = await out();
    eq([o.Q, o.Qn], [Q, 1 - Q], 'E=' + E + ' D=' + D);
  }
});
await seq('master-slave D flip-flop captures D only at the rising clock edge', async () => {
  await loadPaused('d-flipflop-master-slave'); // clock: rises at step 10, falls at 20, rises at 30 ...
  await set('D', 1);
  await step(15);
  eq((await out()).Q, 1, 'after first rising edge with D=1');
  await set('D', 0);
  await step(4);
  eq((await out()).Q, 1, 'D changes while CLK is high are ignored');
  await step(8);
  eq((await out()).Q, 1, 'Q holds while CLK is low');
  await step(10);
  const o = await out();
  eq([o.Q, o.Qn], [0, 1], 'next rising edge captures D=0');
});
await seq('master-slave JK flip-flop: set, reset, hold, and exactly one toggle per clock', async () => {
  await loadPaused('jk-flipflop-master-slave'); // period 40: high from step 20 to 40
  const q = async () => (await out()).Q;
  await set('J', 1);
  await set('K', 0);
  await step(45);
  eq(await q(), 1, 'J=1 K=0 sets');
  await set('J', 0);
  await set('K', 0);
  await step(40);
  eq(await q(), 1, 'J=0 K=0 holds');
  await set('J', 0);
  await set('K', 1);
  await step(40);
  eq(await q(), 0, 'J=0 K=1 resets');
  await set('J', 1);
  await set('K', 1);
  const trace = await run(() => {
    const t = [];
    for (let i = 0; i < 160; i++) {
      LogicLab.step(1);
      t.push(LogicLab.outputs().Q);
    }
    return t;
  });
  const flips = trace.slice(1).filter((v, i) => v !== trace[i]).length;
  eq(flips, 4, 'J=K=1 must flip Q once per clock period (4 periods observed), not repeatedly');
});
await seq('built-in D, T and JK flip-flops follow their rules on each rising edge', async () => {
  await loadPaused('flipflop-parts'); // rising edges at steps 10, 30, 50 ...
  await step(15);
  let o = await out();
  eq([o.Q_D, o.Q_T, o.Q_JK], [1, 1, 1], 'edge 1: D=1, T toggles to 1, J=1/K=0 sets');
  await step(20);
  o = await out();
  eq([o.Q_D, o.Q_T, o.Q_JK], [1, 0, 1], 'edge 2: T toggles back to 0');
  await set('D', 0);
  await set('J', 0);
  await set('K', 1);
  await step(20);
  o = await out();
  eq([o.Q_D, o.Q_T, o.Q_JK], [0, 1, 0], 'edge 3: D=0, T toggles, J=0/K=1 resets');
});
await seq('race-around latch holds with E=0 and oscillates (with a warning) with T=E=1', async () => {
  await loadPaused('race-around');
  await step(30);
  eq(await run(() => LogicLab.oscillating()), null, 'stable while E=0');
  const q0 = (await out()).Q;
  await step(30);
  eq((await out()).Q, q0, 'Q holds');
  await set('E', 1);
  const trace = await run(() => {
    const t = [];
    for (let i = 0; i < 40; i++) {
      LogicLab.step(1);
      const o = LogicLab.outputs();
      t.push(o.Q + '' + o.Qn);
    }
    return t;
  });
  ok(new Set(trace).size > 1, 'outputs should toggle');
  ok(await run(() => !!LogicLab.oscillating()), 'oscillation warning expected');
  await set('E', 0);
  await step(30);
  eq(await run(() => LogicLab.oscillating()), null, 'warning clears when E returns to 0');
});
await seq('ring oscillator never settles and is reported', async () => {
  await loadPaused('ring-oscillator');
  const trace = await run(() => {
    const t = [];
    for (let i = 0; i < 30; i++) {
      LogicLab.step(1);
      t.push(LogicLab.outputs().Out);
    }
    return t;
  });
  ok(new Set(trace).size === 2, 'output should toggle');
  ok(await run(() => !!LogicLab.oscillating()));
});
await seq('stable examples never show the oscillation warning', async () => {
  const bad = await run(() =>
    LOGICLAB_EXAMPLES.filter((e) => e.id !== 'ring-oscillator')
      .filter((e) => {
        LogicLab.load(e.id);
        LogicLab.pause();
        LogicLab.step(120);
        return LogicLab.oscillating();
      })
      .map((e) => e.id)
  );
  eq(bad, []);
});

/* ---- 6. real-voltage mode and project save/load ---- */
await test('real-voltage mode gives the same answers for combinational examples', async () => {
  await page.selectOption('#mdl', '1');
  const r = await run(() => {
    const bad = [];
    for (const id of ['half-adder', 'full-adder', 'mux-4to1', 'decoder-2to4', 'comparator-2bit']) {
      LogicLab.load(id);
      LogicLab.pause();
      const names = Object.keys(LogicLab.inputs());
      for (let m = 0; m < 1 << names.length; m++) {
        const inp = {};
        names.forEach((n, i) => {
          inp[n] = (m >> i) & 1;
          LogicLab.setInput(n, inp[n]);
        });
        LogicLab.step(120);
        const want = T.ex(id).check(inp),
          got = LogicLab.outputs();
        for (const k of Object.keys(want)) if (got[k] !== want[k]) bad.push(id + JSON.stringify(inp) + k);
      }
    }
    return bad.slice(0, 5);
  });
  await page.selectOption('#mdl', '0');
  eq(r, []);
});
await test('saving and reopening a project reproduces the same circuit and behaviour', async () => {
  const r = await run(() => {
    const bad = [];
    for (const id of ['full-adder', 'd-flipflop-master-slave', 'bcd-7seg', 'ripple-counter-3bit']) {
      LogicLab.load(id);
      LogicLab.pause();
      LogicLab.step(75);
      const before = JSON.stringify(LogicLab.outputs()),
        parts = LogicLab.parts().length;
      const doc = JSON.parse(JSON.stringify(LogicLab.exportProject()));
      LogicLab.load('');
      LogicLab.importProject(doc);
      if (LogicLab.parts().length !== parts) bad.push(id + ' part count');
      LogicLab.pause();
      if (
        JSON.stringify(Object.values(LogicLab.outputs())) !==
        JSON.stringify(Object.values(JSON.parse(before)))
      )
        bad.push(id + ' state: ' + before + ' vs ' + JSON.stringify(LogicLab.outputs()));
    }
    return bad;
  });
  eq(r, []);
});
/* ---- 7. main power and reset ---- */
await test('power off sets every output to zero, forgets memory, and power on starts from a clean state', async () => {
  await loadPaused('ripple-counter-3bit');
  await step(130);
  const before = await out();
  ok(before.Q0 + before.Q1 + before.Q2 > 0, 'the counter has counted');
  await run(() => LogicLab.power(false));
  await step(5);
  eq(await out(), { Q0: 0, Q1: 0, Q2: 0 }, 'all outputs are 0 while off');
  eq(await run(() => LogicLab.isPowered()), false);
  const hist = await run(() => LogicLab.history('Q1'));
  eq(hist.slice(-5), [0, 0, 0, 0, 0], 'the waveform shows a flat line while off');
  await run(() => LogicLab.power(true));
  eq(await out(), { Q0: 0, Q1: 0, Q2: 0 }, 'a power-up starts counting from zero');
  await step(40);
  eq((await out()).Q0, 1, 'and counts again');
});
await test('with the power off a switch-driven circuit shows zero and recovers when switched on', async () => {
  await loadPaused('half-adder');
  await set('A', 1);
  await set('B', 1);
  await step(10);
  eq(await out(), { Sum: 0, Carry: 1 });
  await run(() => LogicLab.power(false));
  await step(3);
  eq(await out(), { Sum: 0, Carry: 0 });
  await run(() => LogicLab.power(true));
  await step(10);
  eq(await out(), { Sum: 0, Carry: 1 });
});
await test('reset restarts the circuit and clears the waveform', async () => {
  await loadPaused('johnson-counter-4bit');
  await step(100);
  ok((await run(() => LogicLab.history('Q0'))).length >= 100);
  await run(() => LogicLab.reset());
  eq(await word(['Q0', 'Q1', 'Q2', 'Q3']), '0000', 'all flip-flops are cleared');
  eq((await run(() => LogicLab.history('Q0'))).length, 0, 'waveform history is cleared');
  await step(30);
  eq(await word(['Q0', 'Q1', 'Q2', 'Q3']), '1000', 'the sequence restarts from the first state');
  await run(() => LogicLab.power(false));
  await run(() => LogicLab.reset());
  eq(await word(['Q0', 'Q1', 'Q2', 'Q3']), '0000', 'reset keeps everything at zero while off');
  await run(() => LogicLab.power(true));
});
await test('in real-voltage mode the outputs rise gradually after power-on', async () => {
  await page.selectOption('#mdl', '1');
  await loadPaused('half-adder');
  await set('A', 1);
  await set('B', 1);
  await step(60);
  eq((await out()).Carry, 1);
  await run(() => LogicLab.power(false));
  await step(2);
  await run(() => LogicLab.power(true));
  await step(1);
  eq((await out()).Carry, 0, 'still below the logic threshold right after power-on');
  await step(60);
  eq((await out()).Carry, 1, 'reaches the full level after a short time');
  await page.selectOption('#mdl', '0');
});
await test('no script errors were reported during the run', async () => {
  eq(problems, []);
});

await browser.close();
server.close();
summary();
