# Game Empire Tycoon

A game-making studio that runs in your browser. You start in a garage with a
few tools, and the studio grows as you do.

It's built for kids — specifically for my nephew — on one stubborn principle:
**absolute power with the easiest use ever.** Nothing is locked away behind a
"pro" mode. A ten-year-old and an adult get the same engine; the difference is
only how much of it you've discovered yet.

Everything is offline. No accounts, no cloud, no telemetry, no AI in the
finished product. Your games are yours, saved as a single file.

## What's in the studio

You move between **rooms**, each one a department of your game company:

| Room | What you do there |
|---|---|
| **Build** | Lay out levels in 2D or 3D — drag things in, sculpt terrain, paint it, place water |
| **Art** | Draw sprites, make materials, build 3D models out of parts |
| **Sound** | Design sound effects from scratch, then cut and shape them |
| **Music** | Write songs on a tracker with an on-screen piano — chords, recording, the lot |
| **Rules** | Teach things how to behave using WHEN / IF / DO cards. No typing code |
| **Animate** | Rig characters and animate props |
| **Effects** | Particles, screen effects, post-processing |
| **Ship It** | Export your game as one HTML file you can send to anyone |

## Things it can actually do

- **2D and 3D**, side-view, top-down, or first-person — one engine, no separate modes
- **Terrain** you sculpt like clay, with smooth or blocky styles, painted in layers
- **Water** that really flows — it fills valleys, pours downhill, and you can swim in it
- **VR** — any 3D game you make opens in a headset straight from the browser
- **Touch controls** appear automatically on phones and tablets
- **Behavior bricks** — no code, but real logic: patrol, chase, shoot, collect, win, lose
- **A whole music studio** — write it, record it, and it plays in your game
- **One-file export** — the finished game is a single HTML file. Email it to a friend

## Playing with it

    npm install
    npm run dev

Then open the address it prints. Start in the **Pitch Meeting** (the "New"
button) — there's a **Demo Shelf** there with six finished games you can open,
play, and take apart to see how they were made.

## How it's built

Plain JavaScript, no framework. [Three.js](https://threejs.org) renders
everything — 2D and 3D alike. [Rapier](https://rapier.rs) does the physics.
Built with [Vite](https://vitejs.dev).

The design rules live in `docs/CONSTITUTION.md`, and they're taken seriously:
everything is data, nothing is hardcoded game content, and the whole thing has
to keep working with the network unplugged.

Bundled art and audio are CC0 or made in-house. Nothing under a restrictive
license ships in the box.

## A note on reuse

The source is public so people can read it, learn from it, and see how the
thing works. It is **not** open source — copyright is retained, all rights
reserved. If you want to use a piece of it for something, just ask.

---

Built by Tabulanis, with [Claude Code](https://claude.com/claude-code).
