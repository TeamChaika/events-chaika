import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(new URL("../src/introPlayback.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { prepareIntroImages, startVisibleIntroTimer } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function fakeClock(initialVisibility = true) {
  let time = 0,
    id = 0,
    visible = initialVisibility;
  const timers = new Map(),
    listeners = new Set();
  return {
    now: () => time,
    visible: () => visible,
    after(callback, delay) {
      const key = ++id;
      timers.set(key, { callback, at: time + delay });
      return key;
    },
    cancel(key) {
      timers.delete(key);
    },
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    setVisible(value) {
      visible = value;
      for (const callback of listeners) callback();
    },
    advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...timers]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      time = end;
    },
    pending: () => timers.size,
    listeners: () => listeners.size,
  };
}
const flush = () => new Promise(setImmediate);

test("background loading does not consume the visible intro duration", () => {
  const clock = fakeClock(false);
  let completed = 0;
  startVisibleIntroTimer(
    4200,
    () => completed++,
    () => {},
    clock,
  );
  clock.advance(20000);
  assert.equal(completed, 0);
  clock.setVisible(true);
  clock.advance(4199);
  assert.equal(completed, 0);
  clock.advance(1);
  assert.equal(completed, 1);
});

test("switching away pauses the clock and resumes only the remaining time", () => {
  const clock = fakeClock(),
    states = [];
  let completed = 0;
  startVisibleIntroTimer(
    6500,
    () => completed++,
    (value) => states.push(value),
    clock,
  );
  clock.advance(2000);
  clock.setVisible(false);
  clock.advance(60000);
  assert.equal(completed, 0);
  clock.setVisible(true);
  clock.advance(4499);
  assert.equal(completed, 0);
  clock.advance(1);
  assert.equal(completed, 1);
  assert.deepEqual(states, [true, false, true, false]);
  assert.equal(clock.listeners(), 0);
});

test("skip or unmount cancels all timer callbacks and visibility listeners", () => {
  const clock = fakeClock();
  let completed = 0;
  const cancel = startVisibleIntroTimer(
    6500,
    () => completed++,
    () => {},
    clock,
  );
  clock.advance(500);
  cancel();
  clock.setVisible(false);
  clock.setVisible(true);
  clock.advance(20000);
  assert.equal(completed, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(clock.listeners(), 0);
});

test("slow image loading and decoding happen before the full playback time", async () => {
  const clock = fakeClock(),
    images = [];
  let decoded,
    completed = 0,
    ready = false;
  prepareIntroImages(
    ["hero.png", "qr.png"],
    () => {
      ready = true;
      startVisibleIntroTimer(
        6500,
        () => completed++,
        () => {},
        clock,
      );
    },
    {
      ...clock,
      createImage() {
        const image = {
          src: "",
          onload: null,
          onerror: null,
          decode: () =>
            new Promise((resolve) => {
              decoded = resolve;
            }),
        };
        images.push(image);
        return image;
      },
    },
  );
  clock.advance(5000);
  images[0].onload();
  await flush();
  assert.equal(ready, false);
  decoded();
  await flush();
  images[1].onload();
  await flush();
  clock.advance(700);
  assert.equal(ready, false);
  decoded();
  await flush();
  assert.equal(ready, true);
  clock.advance(6499);
  assert.equal(completed, 0);
  clock.advance(1);
  assert.equal(completed, 1);
});

test("broken assets and the bounded timeout cannot trap a guest", () => {
  const clock = fakeClock(),
    images = [];
  let ready = 0;
  prepareIntroImages(["broken.png", "stalled.png"], () => ready++, {
    ...clock,
    createImage() {
      const image = { src: "", onload: null, onerror: null };
      images.push(image);
      return image;
    },
  });
  images[0].onerror();
  assert.equal(ready, 0);
  clock.advance(8000);
  assert.equal(ready, 1);
  assert.equal(images[1].onload, null);
  clock.advance(10000);
  assert.equal(ready, 1);
});

test("cancelled image preparation ignores late decode completion", async () => {
  const clock = fakeClock();
  let image,
    decoded,
    ready = 0;
  const cancel = prepareIntroImages(["hero.png"], () => ready++, {
    ...clock,
    createImage() {
      image = {
        src: "",
        onload: null,
        onerror: null,
        decode: () =>
          new Promise((resolve) => {
            decoded = resolve;
          }),
      };
      return image;
    },
  });
  image.onload();
  await flush();
  cancel();
  decoded();
  await flush();
  clock.advance(10000);
  assert.equal(ready, 0);
  assert.equal(clock.pending(), 0);
});
