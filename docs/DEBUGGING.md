# Debugging

Open the browser console on any page of the app. The global `LogicLab` object lets you inspect and drive the simulator.

```js
LogicLab.load('half-adder')   // load an example (returns builder warnings; [] is clean)
LogicLab.pause()              // stop the automatic simulation
LogicLab.setInput('A', 1)     // flip a switch by name
LogicLab.step(40)             // advance 40 ticks
LogicLab.outputs()            // LED values
LogicLab.oscillating()        // null, or the names of gates that keep changing
LogicLab.analysis()           // the truth-table analysis of the whole circuit
LogicLab.parts()              // [{ id, type, name }, ...]
LogicLab.exportProject()      // the same JSON that Save writes
LogicLab.convert('NAND')      // rebuild every gate from NAND gates
```

Tips

- **A circuit misbehaves:** `LogicLab.pause()`, set the inputs, `LogicLab.step(1)` repeatedly and watch `outputs()`.
  If gates keep toggling the orange oscillation badge appears; that is almost always a feedback loop.
- **A flip-flop changes at the wrong time:** check its trigger (rising/falling edge or level) in the Properties panel.
  Level-triggered latches with toggle inputs race by design (see the "Race-around" example).
- **An example fails a test:** run `npm test`; the message names the input combination and the output that differs.
- **Storage problems:** projects are in `localStorage` under keys starting with `gf:`. Clearing site data removes the local copy.
- **Sync problems:** the status text next to the project name says what happened. The network tab shows `/api/projects` calls.
- **Server errors:** `wrangler pages dev` prints function errors in the terminal; in production use `wrangler pages deployment tail`.
