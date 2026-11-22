/**
 * LogicLab example library.
 *
 * Every example is plain data plus a small `build(b)` function that describes the circuit
 * (parts + wires). The app turns that description into a real, editable circuit, so
 * examples behave exactly like circuits you draw yourself.
 *
 * Entry fields
 *   id      unique slug (used in URLs: /?template=half-adder, thumbnails, tests)
 *   title   display name            cat    category shown on the welcome screen
 *   level   Easy | Medium | Hard    desc   one-sentence description
 *   ref     public reference page for the textbook design
 *   expr    boolean expressions (shown on the learn pages)
 *   learn   { what, how } text for the static learn pages (optional)
 *   check   (inputs) => expected outputs, for purely combinational circuits (used by the
 *           learn-page truth tables and the automated tests). Sequential circuits are
 *           verified in tests/ instead.
 *   build   (b) => void, describes the circuit with the helper below.
 *
 * Wire endpoints are "partId" (output 0) or "partId.pin". Gate inputs are numbered
 * ("AND1.0"); flip-flops use pin names ("FF.D", "FF.>", "FF.Q", "FF.Qn").
 * Keep part ids and names to 12 characters or fewer.
 */
(function (root) {
  'use strict';

  /** Tiny netlist builder handed to every build(b) function. */
  function Net() {
    var parts = [];
    var wires = [];
    return {
      parts: parts,
      wires: wires,
      sw: function (id, value, name) {
        parts.push({ id: id, type: 'IN', name: name || id, value: value ? 1 : 0 });
        return id;
      },
      clock: function (id, period) {
        parts.push({ id: id, type: 'CLK', name: id, period: period || 20 });
        return id;
      },
      led: function (id, from, name) {
        parts.push({ id: id, type: 'LED', name: name || id });
        if (from) wires.push({ from: from, to: id });
        return id;
      },
      gate: function (type, id, inputs, name) {
        var p = { id: id, type: type, name: name || id };
        if (inputs.length > 2) p.inputs = inputs.length;
        parts.push(p);
        inputs.forEach(function (src, i) {
          wires.push({ from: src, to: id + '.' + i });
        });
        return id;
      },
      part: function (type, id, pins, extra) {
        parts.push(Object.assign({ id: id, type: type, name: id }, extra));
        Object.keys(pins).forEach(function (pin) {
          wires.push({ from: pins[pin], to: id + '.' + pin });
        });
        return id;
      },
      wire: function (from, to) {
        wires.push({ from: from, to: to });
      }
    };
  }

  var b1 = function (v) {
    return v ? 1 : 0;
  };
  var REF = {
    adder: 'https://en.wikipedia.org/wiki/Adder_(electronics)',
    sub: 'https://en.wikipedia.org/wiki/Subtractor',
    cmp: 'https://en.wikipedia.org/wiki/Digital_comparator',
    mux: 'https://en.wikipedia.org/wiki/Multiplexer',
    demux: 'https://en.wikipedia.org/wiki/Multiplexer#Digital_multiplexers',
    dec: 'https://en.wikipedia.org/wiki/Binary_decoder',
    enc: 'https://en.wikipedia.org/wiki/Priority_encoder',
    seg: 'https://en.wikipedia.org/wiki/Seven-segment_display',
    ff: 'https://en.wikipedia.org/wiki/Flip-flop_(electronics)',
    cnt: 'https://en.wikipedia.org/wiki/Counter_(digital)',
    shift: 'https://en.wikipedia.org/wiki/Shift_register',
    gates: 'https://en.wikipedia.org/wiki/Logic_gate',
    nandxor: 'https://en.wikipedia.org/wiki/NAND_logic',
    maj: 'https://en.wikipedia.org/wiki/Majority_function',
    par: 'https://en.wikipedia.org/wiki/Parity_bit',
    lfsr: 'https://en.wikipedia.org/wiki/Linear-feedback_shift_register',
    ring: 'https://en.wikipedia.org/wiki/Ring_oscillator'
  };

  /** OR of many signals using gates of at most 4 inputs. */
  function orTree(b, id, list) {
    if (list.length === 1) return list[0];
    if (list.length <= 4) return b.gate('OR', id, list);
    var chunks = [];
    for (var i = 0; i < list.length; i += 4) chunks.push(list.slice(i, i + 4));
    return b.gate(
      'OR',
      id,
      chunks.map(function (c, k) {
        return orTree(b, id + '_' + k, c);
      })
    );
  }

  /** Cross-coupled gate latch. Returns the ids of Q and Q-bar gates. */
  function latch(b, type, q, qn, inQ, inQn) {
    b.gate(type, q, [inQ, qn]);
    b.gate(type, qn, [inQn, q]);
  }

  /* 7-segment patterns for 0..9 (a b c d e f g), the common textbook table. */
  var SEG = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg'];

  var E = [];
  function add(def) {
    E.push(def);
  }

  /* ------------------------------------------------------------------ Basics */
  add({
    id: 'basic-gates',
    title: 'Basic logic gates',
    cat: 'Basics',
    level: 'Easy',
    ref: REF.gates,
    desc: 'Two switches feed all six two-input gates so you can compare AND, OR, NAND, NOR, XOR and XNOR side by side.',
    expr: ['AND = A·B', 'OR = A+B', 'NAND = (A·B)′', 'NOR = (A+B)′', 'XOR = A⊕B', 'XNOR = (A⊕B)′'],
    learn: {
      what: 'Logic gates are the building blocks of digital circuits: each one turns one or two input bits into one output bit.',
      how: 'AND outputs 1 only when both inputs are 1. OR outputs 1 when at least one input is 1. NAND and NOR are AND and OR followed by an inverter. XOR outputs 1 when the inputs differ, and XNOR when they match.'
    },
    check: function (i) {
      return {
        AND_Y: i.A & i.B,
        OR_Y: i.A | i.B,
        NAND_Y: b1(!(i.A & i.B)),
        NOR_Y: b1(!(i.A | i.B)),
        XOR_Y: i.A ^ i.B,
        XNOR_Y: b1(!(i.A ^ i.B))
      };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 0);
      ['AND', 'OR', 'NAND', 'NOR', 'XOR', 'XNOR'].forEach(function (t) {
        b.gate(t, t, ['A', 'B']);
        b.led(t + '_Y', t, t);
      });
    }
  });
  add({
    id: 'nand-xor',
    title: 'XOR from four NAND gates',
    cat: 'Basics',
    level: 'Easy',
    ref: REF.nandxor,
    desc: 'NAND is a universal gate: four of them are enough to build an XOR.',
    expr: ['t = (A·B)′', 'Y = ((A·t)′·(B·t)′)′ = A ⊕ B'],
    check: function (i) {
      return { Y: i.A ^ i.B };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 0);
      b.gate('NAND', 'N1', ['A', 'B']);
      b.gate('NAND', 'N2', ['A', 'N1']);
      b.gate('NAND', 'N3', ['B', 'N1']);
      b.gate('NAND', 'N4', ['N2', 'N3']);
      b.led('Y', 'N4');
    }
  });
  add({
    id: 'majority',
    title: '3-input majority voter',
    cat: 'Basics',
    level: 'Easy',
    ref: REF.maj,
    desc: 'The output is 1 when at least two of the three inputs are 1, a classic fault-tolerance building block.',
    expr: ['Y = A·B + B·C + A·C'],
    check: function (i) {
      return { Y: b1(i.A + i.B + i.C >= 2) };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 1);
      b.sw('C', 0);
      b.gate('AND', 'AB', ['A', 'B']);
      b.gate('AND', 'BC', ['B', 'C']);
      b.gate('AND', 'AC', ['A', 'C']);
      b.gate('OR', 'VOTE', ['AB', 'BC', 'AC']);
      b.led('Y', 'VOTE');
    }
  });
  add({
    id: 'parity',
    title: '3-bit even parity generator',
    cat: 'Basics',
    level: 'Easy',
    ref: REF.par,
    desc: 'Two XOR gates produce a parity bit that makes the total number of 1s even, used for simple error detection.',
    expr: ['P = A ⊕ B ⊕ C'],
    check: function (i) {
      return { P: i.A ^ i.B ^ i.C };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 0);
      b.sw('C', 0);
      b.gate('XOR', 'X1', ['A', 'B']);
      b.gate('XOR', 'X2', ['X1', 'C']);
      b.led('P', 'X2', 'Parity');
    }
  });

  /* -------------------------------------------------------------- Arithmetic */
  add({
    id: 'half-adder',
    title: 'Half adder',
    cat: 'Arithmetic',
    level: 'Easy',
    ref: REF.adder + '#Half_adder',
    desc: 'Adds two bits: XOR gives the sum and AND gives the carry.',
    expr: ['Sum = A ⊕ B', 'Carry = A · B'],
    learn: {
      what: 'A half adder is a combinational circuit that adds two single bits and produces a sum bit and a carry bit.',
      how: 'The sum is 1 when exactly one input is 1, which is an XOR. The carry is 1 only when both inputs are 1, which is an AND. It cannot accept a carry from a previous stage, so it is used for the least significant bit; chains of bits need full adders.'
    },
    check: function (i) {
      return { Sum: i.A ^ i.B, Carry: i.A & i.B };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 1);
      b.gate('XOR', 'XOR1', ['A', 'B']);
      b.gate('AND', 'AND1', ['A', 'B']);
      b.led('Sum', 'XOR1');
      b.led('Carry', 'AND1');
    }
  });
  add({
    id: 'full-adder',
    title: 'Full adder',
    cat: 'Arithmetic',
    level: 'Medium',
    ref: REF.adder + '#Full_adder',
    desc: 'Adds two bits plus a carry-in using two XOR gates, two AND gates and one OR gate.',
    expr: ['Sum = A ⊕ B ⊕ Cin', 'Cout = A·B + Cin·(A ⊕ B)'],
    learn: {
      what: 'A full adder adds three bits (A, B and a carry-in) and outputs a sum bit and a carry-out.',
      how: 'The first XOR gate adds A and B, the second adds the carry-in to that result to form the sum. A carry-out occurs when A and B are both 1, or when the carry-in is 1 and exactly one of A or B is 1. Chaining full adders gives a ripple-carry adder of any width.'
    },
    check: function (i) {
      return { Sum: i.A ^ i.B ^ i.Cin, Cout: (i.A & i.B) | (i.Cin & (i.A ^ i.B)) };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 1);
      b.sw('Cin', 0);
      b.gate('XOR', 'XOR1', ['A', 'B']);
      b.gate('XOR', 'XOR2', ['XOR1', 'Cin']);
      b.gate('AND', 'AND1', ['A', 'B']);
      b.gate('AND', 'AND2', ['XOR1', 'Cin']);
      b.gate('OR', 'OR1', ['AND1', 'AND2']);
      b.led('Sum', 'XOR2');
      b.led('Cout', 'OR1');
    }
  });
  add({
    id: 'adder-4bit',
    title: '4-bit ripple-carry adder',
    cat: 'Arithmetic',
    level: 'Hard',
    ref: REF.adder + '#Ripple-carry_adder',
    desc: 'Four full adders in a chain add two 4-bit numbers; each carry ripples into the next stage.',
    expr: ['S = A + B + Cin (4 bits)', 'Cout = carry out of bit 3'],
    learn: {
      what: 'A ripple-carry adder adds two multi-bit binary numbers by chaining one full adder per bit.',
      how: 'Each full adder passes its carry-out to the carry-in of the next bit. It is simple and small, but the final sum must wait for the carry to travel through every stage, so wider adders get slower.'
    },
    check: function (i) {
      var a = i.A0 + 2 * i.A1 + 4 * i.A2 + 8 * i.A3,
        c = i.B0 + 2 * i.B1 + 4 * i.B2 + 8 * i.B3,
        s = a + c + i.Cin;
      return { S0: s & 1, S1: (s >> 1) & 1, S2: (s >> 2) & 1, S3: (s >> 3) & 1, Cout: (s >> 4) & 1 };
    },
    build: function (b) {
      var k;
      for (k = 0; k < 4; k++) {
        b.sw('A' + k, k % 2);
        b.sw('B' + k, k < 2 ? 1 : 0);
      }
      b.sw('Cin', 0);
      var carry = 'Cin';
      for (k = 0; k < 4; k++) {
        b.gate('XOR', 'X' + k, ['A' + k, 'B' + k]);
        b.gate('XOR', 'SUM' + k, ['X' + k, carry]);
        b.gate('AND', 'G' + k, ['A' + k, 'B' + k]);
        b.gate('AND', 'P' + k, ['X' + k, carry]);
        b.gate('OR', 'C' + (k + 1), ['G' + k, 'P' + k]);
        b.led('S' + k, 'SUM' + k);
        carry = 'C' + (k + 1);
      }
      b.led('Cout', 'C4');
    }
  });
  add({
    id: 'half-subtractor',
    title: 'Half subtractor',
    cat: 'Arithmetic',
    level: 'Easy',
    ref: REF.sub,
    desc: 'Subtracts B from A: XOR gives the difference and A′·B gives the borrow.',
    expr: ['Diff = A ⊕ B', 'Borrow = A′ · B'],
    check: function (i) {
      return { Diff: i.A ^ i.B, Borrow: b1(!i.A) & i.B };
    },
    build: function (b) {
      b.sw('A', 0);
      b.sw('B', 1);
      b.gate('XOR', 'XOR1', ['A', 'B']);
      b.gate('NOT', 'NOT1', ['A']);
      b.gate('AND', 'AND1', ['NOT1', 'B']);
      b.led('Diff', 'XOR1');
      b.led('Borrow', 'AND1');
    }
  });
  add({
    id: 'full-subtractor',
    title: 'Full subtractor',
    cat: 'Arithmetic',
    level: 'Medium',
    ref: REF.sub,
    desc: 'Computes A − B − Bin, producing a difference bit and a borrow-out.',
    expr: ['Diff = A ⊕ B ⊕ Bin', 'Bout = A′·B + (A ⊕ B)′·Bin'],
    check: function (i) {
      return { Diff: i.A ^ i.B ^ i.Bin, Bout: b1(i.A < i.B + i.Bin) };
    },
    build: function (b) {
      b.sw('A', 0);
      b.sw('B', 1);
      b.sw('Bin', 0);
      b.gate('XOR', 'XOR1', ['A', 'B']);
      b.gate('XOR', 'XOR2', ['XOR1', 'Bin']);
      b.gate('NOT', 'NOTA', ['A']);
      b.gate('AND', 'AND1', ['NOTA', 'B']);
      b.gate('NOT', 'NOTX', ['XOR1']);
      b.gate('AND', 'AND2', ['NOTX', 'Bin']);
      b.gate('OR', 'OR1', ['AND1', 'AND2']);
      b.led('Diff', 'XOR2');
      b.led('Bout', 'OR1');
    }
  });
  add({
    id: 'comparator-1bit',
    title: '1-bit comparator',
    cat: 'Arithmetic',
    level: 'Easy',
    ref: REF.cmp,
    desc: 'Compares two bits and lights exactly one of A<B, A=B or A>B.',
    expr: ['A>B = A·B′', 'A=B = (A⊕B)′', 'A<B = A′·B'],
    learn: {
      what: 'A digital comparator tells you whether one binary number is less than, equal to, or greater than another.',
      how: 'For one bit, A is greater when A is 1 and B is 0, less when A is 0 and B is 1, and equal when the bits match (an XNOR). Exactly one of the three outputs is 1 at any time.'
    },
    check: function (i) {
      return { LT: b1(i.A < i.B), EQ: b1(i.A === i.B), GT: b1(i.A > i.B) };
    },
    build: function (b) {
      b.sw('A', 1);
      b.sw('B', 0);
      b.gate('NOT', 'NOTA', ['A']);
      b.gate('NOT', 'NOTB', ['B']);
      b.gate('AND', 'AND1', ['NOTA', 'B']);
      b.gate('AND', 'AND2', ['A', 'NOTB']);
      b.gate('XNOR', 'XNOR1', ['A', 'B']);
      b.led('LT', 'AND1', 'A<B');
      b.led('EQ', 'XNOR1', 'A=B');
      b.led('GT', 'AND2', 'A>B');
    }
  });
  add({
    id: 'comparator-2bit',
    title: '2-bit comparator',
    cat: 'Arithmetic',
    level: 'Medium',
    ref: REF.cmp,
    desc: 'Compares two 2-bit numbers by checking the high bits first, then the low bits.',
    expr: ['A>B = A1·B1′ + (A1⊙B1)·A0·B0′', 'A=B = (A1⊙B1)·(A0⊙B0)', 'A<B = A1′·B1 + (A1⊙B1)·A0′·B0'],
    check: function (i) {
      var a = i.A1 * 2 + i.A0,
        c = i.B1 * 2 + i.B0;
      return { LT: b1(a < c), EQ: b1(a === c), GT: b1(a > c) };
    },
    build: function (b) {
      b.sw('A1', 1);
      b.sw('A0', 0);
      b.sw('B1', 0);
      b.sw('B0', 1);
      b.gate('XNOR', 'E1', ['A1', 'B1']);
      b.gate('XNOR', 'E0', ['A0', 'B0']);
      b.gate('NOT', 'NA1', ['A1']);
      b.gate('NOT', 'NA0', ['A0']);
      b.gate('NOT', 'NB1', ['B1']);
      b.gate('NOT', 'NB0', ['B0']);
      b.gate('AND', 'G1', ['A1', 'NB1']);
      b.gate('AND', 'G0', ['E1', 'A0', 'NB0']);
      b.gate('OR', 'GTOR', ['G1', 'G0']);
      b.gate('AND', 'L1', ['NA1', 'B1']);
      b.gate('AND', 'L0', ['E1', 'NA0', 'B0']);
      b.gate('OR', 'LTOR', ['L1', 'L0']);
      b.gate('AND', 'EQAND', ['E1', 'E0']);
      b.led('LT', 'LTOR', 'A<B');
      b.led('EQ', 'EQAND', 'A=B');
      b.led('GT', 'GTOR', 'A>B');
    }
  });

  /* --------------------------------------------- Multiplexing and decoding */
  add({
    id: 'mux-2to1',
    title: '2:1 multiplexer',
    cat: 'Combinational',
    level: 'Easy',
    ref: REF.mux,
    desc: 'A select line chooses which of two data inputs reaches the output.',
    expr: ['Y = S′·I0 + S·I1'],
    check: function (i) {
      return { Y: i.S ? i.I1 : i.I0 };
    },
    build: function (b) {
      b.sw('I0', 1);
      b.sw('I1', 0);
      b.sw('S', 0);
      b.gate('NOT', 'NOTS', ['S']);
      b.gate('AND', 'AND0', ['I0', 'NOTS']);
      b.gate('AND', 'AND1', ['I1', 'S']);
      b.gate('OR', 'OR1', ['AND0', 'AND1']);
      b.led('Y', 'OR1');
    }
  });
  add({
    id: 'mux-4to1',
    title: '4:1 multiplexer',
    cat: 'Combinational',
    level: 'Medium',
    ref: REF.mux,
    desc: 'Two select lines (S1 S0) pick one of four data inputs; four AND gates and an OR gate do the work.',
    expr: ['Y = I0·S1′S0′ + I1·S1′S0 + I2·S1S0′ + I3·S1S0'],
    learn: {
      what: 'A 4:1 multiplexer routes one of four input bits to a single output, chosen by two select bits.',
      how: 'A decoder made of NOT and AND gates enables exactly one of four AND gates for each value of S1 S0. Only that gate passes its data input, and the OR gate merges the four AND outputs into Y.'
    },
    check: function (i) {
      return { Y: i['I' + (i.S1 * 2 + i.S0)] };
    },
    build: function (b) {
      var d = [0, 1, 0, 0];
      d.forEach(function (v, k) {
        b.sw('I' + k, v);
      });
      b.sw('S0', 1);
      b.sw('S1', 0);
      b.gate('NOT', 'NS0', ['S0']);
      b.gate('NOT', 'NS1', ['S1']);
      var sel = [
        ['NS1', 'NS0'],
        ['NS1', 'S0'],
        ['S1', 'NS0'],
        ['S1', 'S0']
      ];
      sel.forEach(function (s, k) {
        b.gate('AND', 'T' + k, ['I' + k, s[0], s[1]]);
      });
      b.gate('OR', 'OR1', ['T0', 'T1', 'T2', 'T3']);
      b.led('Y', 'OR1');
    }
  });
  add({
    id: 'demux-1to2',
    title: '1:2 demultiplexer',
    cat: 'Combinational',
    level: 'Easy',
    ref: REF.demux,
    desc: 'Sends the input to Y0 when S=0 and to Y1 when S=1; the other output stays 0.',
    expr: ['Y0 = I·S′', 'Y1 = I·S'],
    check: function (i) {
      return { Y0: i.I & b1(!i.S), Y1: i.I & i.S };
    },
    build: function (b) {
      b.sw('I', 1);
      b.sw('S', 0);
      b.gate('NOT', 'NOTS', ['S']);
      b.gate('AND', 'AND0', ['I', 'NOTS']);
      b.gate('AND', 'AND1', ['I', 'S']);
      b.led('Y0', 'AND0');
      b.led('Y1', 'AND1');
    }
  });
  add({
    id: 'demux-1to4',
    title: '1:4 demultiplexer',
    cat: 'Combinational',
    level: 'Medium',
    ref: REF.demux,
    desc: 'Routes one input to one of four outputs selected by S1 S0.',
    expr: ['Y0 = I·S1′S0′', 'Y1 = I·S1′S0', 'Y2 = I·S1S0′', 'Y3 = I·S1S0'],
    learn: {
      what: 'A 1:4 demultiplexer takes one input bit and routes it to one of four outputs, chosen by two select bits.',
      how: 'It is the reverse of a multiplexer. Each output is an AND of the input with one combination of the select lines, so only the selected output follows the input while the other three stay 0.'
    },
    check: function (i) {
      var k = i.S1 * 2 + i.S0,
        o = {};
      for (var n = 0; n < 4; n++) o['Y' + n] = n === k ? i.I : 0;
      return o;
    },
    build: function (b) {
      b.sw('I', 1);
      b.sw('S0', 0);
      b.sw('S1', 1);
      b.gate('NOT', 'NS0', ['S0']);
      b.gate('NOT', 'NS1', ['S1']);
      [
        ['NS1', 'NS0'],
        ['NS1', 'S0'],
        ['S1', 'NS0'],
        ['S1', 'S0']
      ].forEach(function (s, k) {
        b.gate('AND', 'A' + k, ['I', s[0], s[1]]);
        b.led('Y' + k, 'A' + k);
      });
    }
  });
  add({
    id: 'decoder-2to4',
    title: '2:4 decoder with enable',
    cat: 'Combinational',
    level: 'Medium',
    ref: REF.dec,
    desc: 'Turns a 2-bit number into one of four active outputs; with EN low every output stays 0.',
    expr: ['Y0 = EN·A1′A0′', 'Y1 = EN·A1′A0', 'Y2 = EN·A1A0′', 'Y3 = EN·A1A0'],
    learn: {
      what: 'A 2-to-4 decoder converts a 2-bit binary input into a one-hot output: exactly one of four lines is 1.',
      how: 'Each output is an AND gate that recognises one input combination, using inverters for the bits that must be 0. The enable input is ANDed into every output so the whole decoder can be switched off.'
    },
    check: function (i) {
      var k = i.A1 * 2 + i.A0,
        o = {};
      for (var n = 0; n < 4; n++) o['Y' + n] = i.EN & b1(n === k);
      return o;
    },
    build: function (b) {
      b.sw('A1', 1);
      b.sw('A0', 0);
      b.sw('EN', 1);
      b.gate('NOT', 'NA1', ['A1']);
      b.gate('NOT', 'NA0', ['A0']);
      [
        ['NA1', 'NA0'],
        ['NA1', 'A0'],
        ['A1', 'NA0'],
        ['A1', 'A0']
      ].forEach(function (s, k) {
        b.gate('AND', 'D' + k, ['EN', s[0], s[1]]);
        b.led('Y' + k, 'D' + k);
      });
    }
  });
  add({
    id: 'decoder-3to8',
    title: '3:8 decoder',
    cat: 'Combinational',
    level: 'Medium',
    ref: REF.dec,
    desc: 'Eight AND gates, one per input combination, give a one-hot output for a 3-bit number.',
    expr: ['Yn = 1 when A2A1A0 = n'],
    check: function (i) {
      var k = i.A2 * 4 + i.A1 * 2 + i.A0,
        o = {};
      for (var n = 0; n < 8; n++) o['Y' + n] = b1(n === k);
      return o;
    },
    build: function (b) {
      b.sw('A2', 1);
      b.sw('A1', 0);
      b.sw('A0', 1);
      ['A2', 'A1', 'A0'].forEach(function (s) {
        b.gate('NOT', 'N' + s, [s]);
      });
      for (var n = 0; n < 8; n++) {
        var ins = [n & 4 ? 'A2' : 'NA2', n & 2 ? 'A1' : 'NA1', n & 1 ? 'A0' : 'NA0'];
        b.gate('AND', 'D' + n, ins);
        b.led('Y' + n, 'D' + n);
      }
    }
  });
  add({
    id: 'encoder-4to2',
    title: '4:2 priority encoder',
    cat: 'Combinational',
    level: 'Medium',
    ref: REF.enc,
    desc: 'Encodes the highest-numbered active input into a 2-bit code and flags when any input is active.',
    expr: ['Y1 = I3 + I2', 'Y0 = I3 + I2′·I1', 'V = I0 + I1 + I2 + I3'],
    learn: {
      what: 'A priority encoder converts the position of the highest active input line into a binary number.',
      how: 'If several inputs are 1 at once, the highest-numbered one wins. Y1 is 1 when I3 or I2 is active, Y0 is 1 for I3 or for I1 when I2 is not active, and the valid output V shows that at least one input is active.'
    },
    check: function (i) {
      return { Y1: i.I3 | i.I2, Y0: i.I3 | (i.I1 & b1(!i.I2)), V: i.I0 | i.I1 | i.I2 | i.I3 };
    },
    build: function (b) {
      for (var k = 0; k < 4; k++) b.sw('I' + k, k === 2 ? 1 : 0);
      b.gate('NOT', 'NI2', ['I2']);
      b.gate('AND', 'T1', ['I1', 'NI2']);
      b.gate('OR', 'OR0', ['I3', 'T1']);
      b.gate('OR', 'OR1', ['I3', 'I2']);
      b.gate('OR', 'ORV', ['I0', 'I1', 'I2', 'I3']);
      b.led('Y1', 'OR1');
      b.led('Y0', 'OR0');
      b.led('V', 'ORV');
    }
  });
  add({
    id: 'bcd-7seg',
    title: 'BCD to 7-segment decoder',
    cat: 'Combinational',
    level: 'Hard',
    ref: REF.seg,
    desc: 'Decodes a 4-bit BCD digit (0 to 9) into the seven segment signals a to g; values 10 to 15 blank the display.',
    expr: ['Segment x = OR of the digits that light it'],
    learn: {
      what: 'A BCD to 7-segment decoder turns a 4-bit binary-coded decimal digit into the seven signals that drive a 7-segment display.',
      how: 'Ten AND gates detect digits 0 to 9. Each segment (a to g) is the OR of the digits that need it lit. Inputs 10 to 15 are not valid BCD, so no digit gate fires and the display stays blank.'
    },
    check: function (i) {
      var v = i.D * 8 + i.C * 4 + i.B * 2 + i.A,
        o = {};
      'abcdefg'.split('').forEach(function (s) {
        o[s] = v < 10 && SEG[v].indexOf(s) >= 0 ? 1 : 0;
      });
      return o;
    },
    build: function (b) {
      b.sw('D', 0);
      b.sw('C', 1);
      b.sw('B', 0);
      b.sw('A', 1);
      ['D', 'C', 'B', 'A'].forEach(function (s) {
        b.gate('NOT', 'N' + s, [s]);
      });
      for (var n = 0; n < 10; n++) {
        b.gate('AND', 'M' + n, [
          n & 8 ? 'D' : 'ND',
          n & 4 ? 'C' : 'NC',
          n & 2 ? 'B' : 'NB',
          n & 1 ? 'A' : 'NA'
        ]);
      }
      'abcdefg'.split('').forEach(function (s) {
        var on = [];
        for (var n = 0; n < 10; n++) if (SEG[n].indexOf(s) >= 0) on.push('M' + n);
        b.led(s, orTree(b, 'OR' + s, on), 'seg ' + s);
      });
    }
  });

  /* ------------------------------------------------ Latches and flip-flops */
  add({
    id: 'sr-latch-nor',
    title: 'SR latch (NOR)',
    cat: 'Latches & flip-flops',
    level: 'Easy',
    ref: REF.ff + '#SR_NOR_latch',
    desc: 'Two cross-coupled NOR gates remember one bit: S sets Q, R resets it, both low holds the value.',
    expr: ['Q⁺ = S + R′·Q', 'S=R=1 is forbidden'],
    learn: {
      what: 'An SR latch is the simplest memory circuit: two cross-coupled gates that store one bit.',
      how: 'In the NOR version a 1 on S sets Q to 1, a 1 on R resets Q to 0, and with both inputs 0 the latch keeps its previous value. Driving S and R high together is forbidden because both outputs go low and the final state becomes unpredictable.'
    },
    build: function (b) {
      b.sw('R', 0);
      b.sw('S', 1);
      latch(b, 'NOR', 'QG', 'QNG', 'R', 'S');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'sr-latch-nand',
    title: 'SR latch (NAND)',
    cat: 'Latches & flip-flops',
    level: 'Easy',
    ref: REF.ff + '#SR_NAND_latch',
    desc: 'The NAND version has active-low inputs: pull S′ low to set, R′ low to reset, keep both high to hold.',
    expr: ['S′=0 sets Q=1', 'R′=0 resets Q=0', 'S′=R′=0 is forbidden'],
    build: function (b) {
      b.sw('Sn', 0, 'S′');
      b.sw('Rn', 1, 'R′');
      latch(b, 'NAND', 'QG', 'QNG', 'Sn', 'Rn');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'gated-sr-latch',
    title: 'Gated SR latch',
    cat: 'Latches & flip-flops',
    level: 'Medium',
    ref: REF.ff + '#Gated_SR_latch',
    desc: 'Adds an enable input: S and R only act while E is high.',
    expr: ['S and R are ANDed with E before reaching the latch'],
    build: function (b) {
      b.sw('S', 1);
      b.sw('E', 0);
      b.sw('R', 0);
      b.gate('NAND', 'SG', ['S', 'E']);
      b.gate('NAND', 'RG', ['R', 'E']);
      latch(b, 'NAND', 'QG', 'QNG', 'SG', 'RG');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'd-latch',
    title: 'Gated D latch',
    cat: 'Latches & flip-flops',
    level: 'Medium',
    ref: REF.ff + '#Gated_D_latch',
    desc: 'While E is high Q follows D (transparent); when E goes low the last value is held.',
    expr: ['E=1: Q = D', 'E=0: Q holds'],
    learn: {
      what: 'A gated D latch stores one bit: while its enable input is high the output follows the data input, and when enable goes low the last value is held.',
      how: 'An inverter makes S and R complementary so the forbidden state cannot happen. The enable gates both NAND inputs of an SR latch. Because the latch is transparent while enabled, a flip-flop (two latches back to back) is used when you need a value captured at a clock edge.'
    },
    build: function (b) {
      b.sw('D', 1);
      b.sw('E', 1);
      b.gate('NOT', 'ND', ['D']);
      b.gate('NAND', 'SG', ['D', 'E']);
      b.gate('NAND', 'RG', ['ND', 'E']);
      latch(b, 'NAND', 'QG', 'QNG', 'SG', 'RG');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'd-flipflop-master-slave',
    title: 'Master-slave D flip-flop',
    cat: 'Latches & flip-flops',
    level: 'Hard',
    ref: REF.ff + '#Master%E2%80%93slave_edge-triggered_D_flip-flop',
    desc: 'Two gated D latches with opposite enables copy D to Q on the rising clock edge only.',
    expr: ['Q⁺ = D at the rising edge of CLK'],
    learn: {
      what: 'A master-slave D flip-flop is an edge-triggered memory element built from two gated D latches.',
      how: 'The master latch is transparent while the clock is low and the slave latch is transparent while the clock is high. At the rising edge the master freezes and the slave copies it, so Q changes once per clock cycle and later changes on D are ignored until the next edge.'
    },
    build: function (b) {
      b.sw('D', 1);
      b.clock('CLK', 20);
      b.gate('NOT', 'NCLK', ['CLK']);
      b.gate('NOT', 'ND', ['D']);
      b.gate('NAND', 'MS', ['D', 'NCLK']);
      b.gate('NAND', 'MR', ['ND', 'NCLK']);
      latch(b, 'NAND', 'MQ', 'MQN', 'MS', 'MR');
      b.gate('NAND', 'SS', ['MQ', 'CLK']);
      b.gate('NAND', 'SR', ['MQN', 'CLK']);
      latch(b, 'NAND', 'QG', 'QNG', 'SS', 'SR');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'jk-flipflop-master-slave',
    title: 'Master-slave JK flip-flop',
    cat: 'Latches & flip-flops',
    level: 'Hard',
    ref: REF.ff + '#JK_flip-flop',
    desc: 'J=K=1 toggles Q once per clock pulse. The master-slave structure removes the race-around problem.',
    expr: ['J=0,K=0 hold · J=1,K=0 set · J=0,K=1 reset · J=K=1 toggle'],
    learn: {
      what: 'A JK flip-flop is a clocked memory element that can hold, set, reset or toggle its output.',
      how: 'With J=1 and K=0 it sets, with J=0 and K=1 it resets, with both 0 it holds, and with both 1 it toggles on every clock pulse. A single level-triggered latch would toggle repeatedly while the clock is high (race-around); the master-slave arrangement captures the inputs while the clock is high and updates the output only after it falls.'
    },
    build: function (b) {
      b.sw('J', 1);
      b.sw('K', 1);
      b.clock('CLK', 40);
      b.gate('NOT', 'NCLK', ['CLK']);
      b.gate('NAND', 'MS', ['J', 'QNG', 'CLK']);
      b.gate('NAND', 'MR', ['K', 'QG', 'CLK']);
      latch(b, 'NAND', 'MQ', 'MQN', 'MS', 'MR');
      b.gate('NAND', 'SS', ['MQ', 'NCLK']);
      b.gate('NAND', 'SR', ['MQN', 'NCLK']);
      latch(b, 'NAND', 'QG', 'QNG', 'SS', 'SR');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });
  add({
    id: 'flipflop-parts',
    title: 'D, T and JK flip-flop parts',
    cat: 'Latches & flip-flops',
    level: 'Easy',
    ref: REF.ff,
    desc: 'The built-in edge-triggered D, T and JK flip-flops share one clock so you can compare how each reacts.',
    expr: ['D: Q⁺ = D', 'T: Q⁺ = Q ⊕ T', 'JK: Q⁺ = J·Q′ + K′·Q'],
    build: function (b) {
      b.clock('CLK', 20);
      b.sw('D', 1);
      b.sw('T', 1);
      b.sw('J', 1);
      b.sw('K', 0);
      b.part('D', 'DFF', { D: 'D', '>': 'CLK' });
      b.part('T', 'TFF', { T: 'T', '>': 'CLK' });
      b.part('JK', 'JKFF', { J: 'J', K: 'K', '>': 'CLK' });
      b.led('Q_D', 'DFF.Q', 'D → Q');
      b.led('Q_T', 'TFF.Q', 'T → Q');
      b.led('Q_JK', 'JKFF.Q', 'JK → Q');
    }
  });

  /* --------------------------------------------------- Counters and registers */
  add({
    id: 'ripple-counter-3bit',
    title: '3-bit ripple counter',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: REF.cnt + '#Asynchronous_(ripple)_counter',
    desc: 'Three toggle flip-flops, each clocked by the falling edge of the previous stage, count 0 to 7.',
    expr: ['Q0 toggles every clock', 'Q1 toggles when Q0 falls', 'Q2 toggles when Q1 falls'],
    learn: {
      what: 'A ripple counter is an asynchronous binary counter made from a chain of toggle flip-flops.',
      how: 'Each flip-flop has T tied to 1, so it toggles whenever its clock input falls. The first stage is clocked by the input clock and every later stage by the output of the stage before it, which halves the frequency at each step. The count therefore runs 0 to 7 and wraps around.'
    },
    build: function (b) {
      b.clock('CLK', 40);
      b.sw('T', 1);
      var clk = 'CLK';
      for (var k = 0; k < 3; k++) {
        b.part('T', 'FF' + k, { T: 'T', '>': clk }, { trigger: 'F' });
        b.led('Q' + k, 'FF' + k + '.Q');
        clk = 'FF' + k + '.Q';
      }
    }
  });
  add({
    id: 'sync-counter-3bit',
    title: '3-bit synchronous counter',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: REF.cnt + '#Synchronous_counter',
    desc: 'All flip-flops share one clock; XOR and AND gates compute the next state, so every bit changes together.',
    expr: ['D0 = Q0′', 'D1 = Q1 ⊕ Q0', 'D2 = Q2 ⊕ (Q1·Q0)'],
    build: function (b) {
      b.clock('CLK', 20);
      b.part('D', 'FF0', { D: 'N0', '>': 'CLK' });
      b.part('D', 'FF1', { D: 'X1', '>': 'CLK' });
      b.part('D', 'FF2', { D: 'X2', '>': 'CLK' });
      b.gate('NOT', 'N0', ['FF0.Q']);
      b.gate('XOR', 'X1', ['FF1.Q', 'FF0.Q']);
      b.gate('AND', 'A1', ['FF1.Q', 'FF0.Q']);
      b.gate('XOR', 'X2', ['FF2.Q', 'A1']);
      for (var k = 0; k < 3; k++) b.led('Q' + k, 'FF' + k + '.Q');
    }
  });
  add({
    id: 'johnson-counter-4bit',
    title: '4-bit Johnson counter',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: 'https://en.wikipedia.org/wiki/Ring_counter#Johnson_counter',
    desc: 'A shift register whose inverted last output feeds the first input cycles through 8 states.',
    expr: ['D0 = Q3′', 'D1 = Q0, D2 = Q1, D3 = Q2'],
    build: function (b) {
      b.clock('CLK', 30);
      b.gate('NOT', 'INV', ['FF3.Q']);
      for (var k = 0; k < 4; k++) {
        b.part('D', 'FF' + k, { D: k ? 'FF' + (k - 1) + '.Q' : 'INV', '>': 'CLK' });
        b.led('Q' + k, 'FF' + k + '.Q');
      }
    }
  });
  add({
    id: 'ring-counter-4bit',
    title: '4-bit ring counter',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: 'https://en.wikipedia.org/wiki/Ring_counter',
    desc: 'A single 1 circulates around four flip-flops. A NOR gate makes it start by itself from all zeros.',
    expr: ['D0 = (Q0 + Q1 + Q2)′', 'D1 = Q0, D2 = Q1, D3 = Q2'],
    build: function (b) {
      b.clock('CLK', 30);
      b.gate('NOR', 'START', ['FF0.Q', 'FF1.Q', 'FF2.Q']);
      for (var k = 0; k < 4; k++) {
        b.part('D', 'FF' + k, { D: k ? 'FF' + (k - 1) + '.Q' : 'START', '>': 'CLK' });
        b.led('Q' + k, 'FF' + k + '.Q');
      }
    }
  });
  add({
    id: 'lfsr-4bit',
    title: '4-bit LFSR (pseudo-random)',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: REF.lfsr,
    desc: 'A shift register with XNOR feedback from the last two bits cycles through 15 pseudo-random states.',
    expr: ['D0 = (Q3 ⊕ Q2)′', 'D1 = Q0, D2 = Q1, D3 = Q2'],
    build: function (b) {
      b.clock('CLK', 30);
      b.gate('XNOR', 'FB', ['FF3.Q', 'FF2.Q']);
      for (var k = 0; k < 4; k++) {
        b.part('D', 'FF' + k, { D: k ? 'FF' + (k - 1) + '.Q' : 'FB', '>': 'CLK' });
        b.led('Q' + k, 'FF' + k + '.Q');
      }
    }
  });
  add({
    id: 'shift-siso',
    title: 'SISO shift register',
    cat: 'Counters & registers',
    level: 'Easy',
    ref: REF.shift,
    desc: 'Serial-in, serial-out: a bit entered at SI reaches SO after four clock edges.',
    expr: ['Each clock edge moves every bit one stage to the right'],
    learn: {
      what: 'A shift register is a chain of flip-flops that moves a stored bit pattern one position on every clock pulse.',
      how: 'In a serial-in, serial-out (SISO) register the data bit enters the first flip-flop and each clock edge passes it to the next, so it appears at the output after as many clocks as there are stages. It works as a digital delay line.'
    },
    build: function (b) {
      b.sw('SI', 1);
      b.clock('CLK', 30);
      for (var k = 0; k < 4; k++) b.part('D', 'FF' + k, { D: k ? 'FF' + (k - 1) + '.Q' : 'SI', '>': 'CLK' });
      b.led('SO', 'FF3.Q');
    }
  });
  add({
    id: 'shift-sipo',
    title: 'SIPO shift register',
    cat: 'Counters & registers',
    level: 'Easy',
    ref: REF.shift,
    desc: 'Serial-in, parallel-out: bits are shifted in one at a time and all four stages can be read at once.',
    expr: ['Q0..Q3 hold the last four bits received'],
    build: function (b) {
      b.sw('SI', 1);
      b.clock('CLK', 30);
      for (var k = 0; k < 4; k++) {
        b.part('D', 'FF' + k, { D: k ? 'FF' + (k - 1) + '.Q' : 'SI', '>': 'CLK' });
        b.led('Q' + k, 'FF' + k + '.Q');
      }
    }
  });
  add({
    id: 'shift-piso',
    title: 'PISO shift register',
    cat: 'Counters & registers',
    level: 'Medium',
    ref: REF.shift,
    desc: 'Parallel-in, serial-out: LD=1 loads D0..D3 on a clock edge, then the bits shift out one at a time on SO.',
    expr: ['LD=1: load D0..D3', 'LD=0: shift toward SO'],
    build: function (b) {
      for (var k = 0; k < 4; k++) b.sw('D' + k, k % 2 === 0);
      b.sw('LD', 1);
      b.clock('CLK', 30);
      b.part('PISO', 'REG', { D0: 'D0', D1: 'D1', D2: 'D2', D3: 'D3', LD: 'LD', '>': 'CLK' });
      b.led('SO', 'REG');
    }
  });
  add({
    id: 'shift-pipo',
    title: 'PIPO register',
    cat: 'Counters & registers',
    level: 'Easy',
    ref: REF.shift,
    desc: 'Parallel-in, parallel-out: four D flip-flops copy D0..D3 to Q0..Q3 on every clock edge.',
    expr: ['Q⁺ = D for each bit'],
    build: function (b) {
      b.clock('CLK', 30);
      for (var k = 0; k < 4; k++) {
        b.sw('D' + k, k % 2 === 0);
        b.part('D', 'FF' + k, { D: 'D' + k, '>': 'CLK' });
        b.led('Q' + k, 'FF' + k + '.Q');
      }
    }
  });

  /* ------------------------------------------------------------ Experiments */
  add({
    id: 'ring-oscillator',
    title: 'Ring oscillator (unstable on purpose)',
    cat: 'Experiments',
    level: 'Easy',
    ref: REF.ring,
    desc: 'Three inverters in a loop never settle, so the output oscillates and LogicLab shows its oscillation warning.',
    expr: ['An odd number of inverters in a loop has no stable state'],
    build: function (b) {
      b.gate('NOT', 'INV1', ['INV3']);
      b.gate('NOT', 'INV2', ['INV1']);
      b.gate('NOT', 'INV3', ['INV2']);
      b.led('Out', 'INV3');
    }
  });
  add({
    id: 'race-around',
    title: 'Race-around in a level-triggered T latch',
    cat: 'Experiments',
    level: 'Medium',
    ref: REF.ff + '#T_flip-flop',
    desc: 'With T=1 and E=1 this latch toggles over and over while E stays high. This is why edge-triggered flip-flops exist.',
    expr: ['R = T·E·Q, S = T·E·Q′'],
    build: function (b) {
      b.sw('T', 1);
      b.sw('E', 0);
      b.gate('AND', 'ANDR', ['T', 'E', 'QG']);
      b.gate('AND', 'ANDS', ['T', 'E', 'QNG']);
      latch(b, 'NOR', 'QG', 'QNG', 'ANDR', 'ANDS');
      b.led('Q', 'QG');
      b.led('Qn', 'QNG', 'Q′');
    }
  });

  root.LogicLabNet = Net;
  root.LOGICLAB_EXAMPLES = E;
})(typeof window !== 'undefined' ? window : globalThis);
