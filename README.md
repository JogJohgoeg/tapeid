# TapeID — every TapeOut circuit can be a coin

**TapeOut Genesis Transistor Hackathon (X Layer) entry.**

TapeID turns any [TapeOut](https://www.tapeout.net/) circuit into a tradable asset in one click. A circuit taped out on the TapeID processor (or any X Layer processor) can be launched as a coin on [IGNIX](https://ignix.bot/). **80 %** of the trading tax flows into the circuit's ERC‑6551 container — whoever holds the circuit NFT gets it — and **20 %** goes to the author's own buyback Safe. The split is written into IGNIX's non‑upgradeable Tax Distribution Vault at launch; nobody (including us or IGNIX) can change it. The launch page itself is stored on‑chain in the container of circuit `1.2.245` and opens straight from X Layer.

| | |
|---|---|
| Processor | **TapeID #245** on X Layer · circuits `0xA93E807fAB41431827EBBa57443Fb687a95E2AA3` · transistors `0xD346843f023a63770f6f2c2d729920Eaa1de2A96` · supply cap 1,000,000 · 0.0001 OKB each |
| Deployer | `0xC9059E0F59F40920E5BD24307eaa4DeFd81Df145` |
| First circuit | **21 NAND Driver** (TapeID `1.2.245`) — a car controller built from just 21 NAND gates; on‑chain `eval` matches the reference netlist 64/64 |
| First coin | **$NAND21** `0x2831E70D96DD8fb1A0EbE2aE17104147F29CEEEe` — [IGNIX](https://ignix.bot/launch?token=0x2831E70D96DD8fb1A0EbE2aE17104147F29CEEEe) · vault `0xD47188959453617271Fe87c2055981878f5DFA8F`: 80 % container `0x75c6E2D063963561c08c838476111adda7a1a6CD` / 20 % buyback Safe `0x647B12A8E79fb9CF72768125323c832dB960CD7e` |
| On‑chain site | https://1-2-245.aihashrate.stream/ (also https://1-2-245.tapekit.org/) |
| Demo video | https://nand.aihashrate.stream/tapeid/tapeid-demo-xl.mp4 |
| Base edition | https://nand.aihashrate.stream/tapeid/ — Clanker v4 on Base, shows up as an X smart cashtag |

## How it works

- `src/holdings.js` — finds every circuit a wallet owns on BNB Chain / X Layer / Base (per‑processor `balanceOf`, then batched `ownerOf` / `circuitInfo` / container via multicall).
- `src/ignix.js` — IGNIX launch: challenge → wallet signs a message → `/v1/ignix/sign`; every returned parameter is checked locally; `createToken` is simulated; the vault's recipients are **previewed with `eth_simulateV1` before launch** and re‑read after launch.
- `src/buyback_safe.js` — the 20 % recipient is a counterfactual Safe v1.4.1 owned only by the author's wallet (address must match the factory's simulated deployment).
- `src/xlayer.js` / `xlayer.html` — X Layer wizard; `src/app.js` / `index.html` — Base wizard (Clanker v4).
- `xlayer_setup.html` — createCPU → mint 21 NAND → tapeout; `xlayer_site_ops.html` — open container, authorize uploader, activate `1.2.245.tape`; `tape_dist_xl.py` + `tools/site_upload.py` — on‑chain site packaging and upload.
- No custom contracts. Every transaction is signed by the user's wallet.

## Build & test

```sh
npm install && npm run build        # tapeid_coin.bundle.js + xlayer.bundle.js
python3 -m http.server 8787         # open http://localhost:8787/xlayer.html
node test_ignix_dry.mjs             # full IGNIX dry run with a throwaway empty wallet (no transaction)
node e2e_xlayer.mjs                 # headless end‑to‑end with a read‑only mock wallet (needs puppeteer-core)
```

---

**中文**：TapeID 让 TapeOut 电路一键变成可交易的资产。在 TapeID 处理器（或任何 X Layer 处理器）上流片的电路，都能在 IGNIX 一键发币：交易税 80% 进电路的 ERC‑6551 容器（谁持有电路谁拿），20% 进作者专属回购 Safe，比例在发币时写进不可升级的金库合约。发币页本身存放在电路 1.2.245 的容器里，从 X Layer 链上直接打开。
