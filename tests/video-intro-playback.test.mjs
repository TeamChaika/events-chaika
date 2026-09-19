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

function setup(play = () => Promise.resolve(), autoPlay = true) {
  let now = 0;
  let sequence = 0;
  const timers = new Map(),
    listeners = new Set();
  const video = new EventTarget();
  video.paused = true;
  video.ended = false;
  video.currentTime = 0;
  video.error = null;
  video.load = () => {
    video.error = null;
  };
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
  const controller = startVideoIntro(
    video,
    {
      onStarted: () => calls.push("started"),
      onComplete: () => calls.push("complete"),
      onPlayRequired: () => calls.push("play-required"),
    },
    clock,
    { autoPlay },
  );
  return {
    video,
    calls,
    cancel: () => controller.stop(),
    play: () => controller.play(),
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

test("blocked autoplay waits for a tap, then plays the same video", async () => {
  const player = setup(() =>
    Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  );
  await new Promise(setImmediate);
  assert.deepEqual(player.calls, ["play-required"]);
  player.advance(60000);
  player.resumeAfter(1000);
  assert.deepEqual(player.calls, ["play-required"]);
  let played = 0;
  player.video.play = () => {
    played++;
    return Promise.resolve();
  };
  player.play();
  assert.equal(
    played,
    1,
    "play() must run synchronously inside the tap handler",
  );
  assert.equal(player.video.muted, true);
  assert.equal(player.video.defaultMuted, true);
  assert.equal(player.video.playsInline, true);
  player.event("playing");
  player.advance(8000);
  player.event("ended");
  assert.deepEqual(player.calls, ["play-required", "started", "complete"]);
  assert.equal(player.pending(), 0);
});

test("slow loading offers a retry without cancelling pending playback", () => {
  const player = setup();
  let pauses = 0;
  player.video.pause = () => {
    pauses++;
  };
  player.advance(20000);
  assert.deepEqual(player.calls, ["play-required"]);
  assert.equal(pauses, 0);
  player.event("playing");
  assert.deepEqual(player.calls, ["play-required", "started"]);
  player.event("ended");
  assert.deepEqual(player.calls, ["play-required", "started", "complete"]);
});

test("reduced motion waits for explicit playback and never autoplays", () => {
  let attempts = 0;
  const player = setup(() => {
    attempts++;
    return Promise.resolve();
  }, false);
  assert.equal(attempts, 0);
  assert.deepEqual(player.calls, ["play-required"]);
  player.resumeAfter(60000);
  assert.equal(attempts, 0);
  player.play();
  assert.equal(attempts, 1);
  player.event("playing");
  player.event("ended");
  assert.deepEqual(player.calls, ["play-required", "started", "complete"]);
});

test("unsupported video and media errors keep the invitation open for retry", async () => {
  const unsupported = setup(() =>
    Promise.reject(new DOMException("Unsupported", "NotSupportedError")),
  );
  await new Promise(setImmediate);
  assert.deepEqual(unsupported.calls, ["play-required"]);
  const broken = setup();
  broken.video.error = { code: 2 };
  broken.event("error");
  broken.advance(60000);
  assert.deepEqual(broken.calls, ["play-required"]);
});

test("one retry reloads a failed media resource and plays inside the tap", () => {
  const player = setup();
  player.video.error = { code: 3 };
  player.event("error");
  const sequence = [];
  player.video.load = () => {
    sequence.push("load");
    player.video.error = null;
  };
  player.video.play = () => {
    sequence.push("play");
    assert.equal(player.video.error, null);
    return Promise.resolve();
  };
  player.play();
  assert.deepEqual(sequence, ["load", "play"]);
  player.event("playing");
  player.event("ended");
  assert.deepEqual(player.calls, ["play-required", "started", "complete"]);
});

test("focus does not issue competing play requests during loading", () => {
  let attempts = 0;
  const player = setup(() => {
    attempts++;
    return new Promise(() => {});
  });
  player.resumeAfter(50);
  player.resumeAfter(50);
  assert.equal(attempts, 1);
  player.cancel();
});

test("autoplay rejection never pauses the resource", async () => {
  const player = setup(() =>
    Promise.reject(new DOMException("Blocked", "NotAllowedError")),
  );
  let pauses = 0;
  player.video.pause = () => {
    pauses++;
  };
  await new Promise(setImmediate);
  assert.equal(pauses, 0);
  assert.deepEqual(player.calls, ["play-required"]);
});

test("late rejection from an older attempt cannot interrupt manual playback", async () => {
  let reject;
  const player = setup(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  player.advance(20000);
  player.video.play = () => Promise.resolve();
  player.play();
  player.event("playing");
  reject(new DOMException("Aborted", "AbortError"));
  await new Promise(setImmediate);
  player.event("ended");
  assert.deepEqual(player.calls, ["play-required", "started", "complete"]);
});

test("a stalled decoder offers retry instead of silently opening the ticket", () => {
  const player = setup();
  player.event("playing");
  player.advance(7000);
  player.event("playing");
  player.advance(8000);
  assert.deepEqual(player.calls, ["started", "play-required"]);
});

test("return from a suspended browser keeps an unfinished invitation available", () => {
  const player = setup();
  player.event("playing");
  player.resumeAfter(60000);
  assert.deepEqual(player.calls, ["started", "play-required"]);
});

test("actual media progress renews the stall timeout during buffering", () => {
  const player = setup();
  player.video.paused = false;
  player.event("playing");
  player.advance(14000);
  player.video.currentTime = 2;
  player.event("timeupdate");
  player.advance(14000);
  assert.deepEqual(player.calls, ["started"]);
  player.event("ended");
  assert.deepEqual(player.calls, ["started", "complete"]);
});

test("an unexpected browser pause exposes a resume button", () => {
  const player = setup();
  player.event("playing");
  player.event("pause");
  assert.deepEqual(player.calls, ["started", "play-required"]);
  player.play();
  player.event("playing");
  player.event("ended");
  assert.deepEqual(player.calls, [
    "started",
    "play-required",
    "started",
    "complete",
  ]);
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
