# fast-marked

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/auracreation/fast-marked/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/auracreation/fast-marked/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

A dependency-free Markdown renderer that drops in for `marked@18.1.3`:
`parse(markdown)` returns byte-identical HTML on all 720 official
practice cases — 680 CommonMark/GFM spec examples plus 40 long
generated documents — with no dependencies and no native code.

## Speed

Measured warm and in-process on this machine (Node 24), the 40 long
documents render in about 430 ms, against about 670 ms for marked
itself — roughly 1.55× faster — and the 680 spec cases take about
7 ms. Timings vary by machine; correctness is the fixed claim, speed
is the measured one.

## Run it

```sh
node main.ts
```

`main.ts` reads `cases.json` from `$MAKEFUN_INPUT_DIR` (default `/input`)
and writes the rendered HTML array to `html.json` in
`$MAKEFUN_OUTPUT_DIR` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=z1j4n66g&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
