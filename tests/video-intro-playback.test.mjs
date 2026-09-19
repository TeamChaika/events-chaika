import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const { outputText } = ts.transpileModule(
  readFileSync(
    new URL("../src/videoIntroPlayback.ts", import.meta.url),
    "utf8",
  ),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  },
);
const { startVideoIntro } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

function setup(play = () => Promise.resolve()) {
  let now = 0;
  let sequence = 0;
  const timers = new Map(),
    listeners = new Set();
  const video = new EventTarget();
  video.paused = true;
  video.ended = false;
  video.play = play;
  video.pause = () => {
    video.paused = true;
  };
  const calls = [];
  const clock = {
    now: () => now,
    after(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    cancel: (id) => timers.delete(id),
    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
  const cancel = startVideoIntro(
    video,
    {
      onStarted: () => calls.push("started"),
      onComplete: () => calls.push("complete"),
      onFallback: () => calls.push("fallback"),
    },
    clock,
  );
  return {
    video,
    calls,
    cancel,
    pending: () => timers.size + listeners.size,
    event: (name) => video.dispatchEvent(new Event(name)),
    resumeAfter(ms) {
      now += ms;
      for (const callback of listeners) callback();
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers]
          .filter(([, t]) => t.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
  };
}

test("slow download does not consume the movie; ended opens the ticket once", () => {
  const player = setup();
  player.advance(7000);
  assert.deepEqual(player.calls, []);
  player.event("playing");
  player.advance(8000);
  assert.deepEqual(player.calls, ["started"]);
  player.event("ended");
  player.event("ended");
  player.advance(20000);
  assert.deepEqual(player.calls, ["started", "complete"]);
  assert.equal(player.pending(), 0);
});

test("blocked mobile autoplay falls back without trapping the guest", async () => {
  const player = setup(() => Promise.reject(new Error("NotAllowedError")));
  await new Promise(setImmediate);
  assert.deepEqual(player.calls, ["fallback"]);
  assert.equal(player.pending(), 0);
});

test("a stalled download reaches its fallback deadline", () => {
  const player = setup();
  player.advance(8000);
  assert.deepEqual(player.calls, ["fallback"]);
  assert.equal(player.pending(), 0);
});

test("decoder stalls and repeated playing events cannot extend the deadline", () => {
  const player = setup();
  player.event("playing");
  player.advance(7000);
  player.event("playing");
  player.advance(5000);
  assert.deepEqual(player.calls, ["started", "complete"]);
  assert.equal(player.pending(), 0);
});

test("return from a suspended browser immediately releases an overdue ticket", () => {
  const player = setup();
  player.event("playing");
  player.resumeAfter(60000);
  assert.deepEqual(player.calls, ["started", "complete"]);
  assert.equal(player.pending(), 0);
});

test("unmount ignores late autoplay rejections and media events", async () => {
  let reject;
  const player = setup(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  player.cancel();
  reject(new Error("AbortError"));
  player.event("playing");
  player.event("ended");
  player.advance(20000);
  await new Promise(setImmediate);
  assert.deepEqual(player.calls, []);
  assert.equal(player.pending(), 0);
});
