# Launch Compass — token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/wudapeng666/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/wudapeng666/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An offline dashboard that ranks DeFi protocols without a recorded token by a transparent, data-derived implied launch value. It always covers the sealed snapshot's watchlist, then adds below-floor pre-token protocols as an early radar.

The model uses TVL, seven-day TVL growth, time since first tracking, category economics and chain breadth. Protocol names never alter the score. Every ranked row receives six concrete farm steps with cost and time estimates.

## Run it

```sh
MAKEFUN_INPUT_DIR="../input" MAKEFUN_OUTPUT_DIR="out" node main.ts
```

Then open `out/dashboard/index.html`. The dashboard requires no server, framework, network access or external assets.
