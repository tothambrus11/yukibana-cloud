# What a cross-site runner frame costs

A page that starts the C++ pack's workers itself, against the same workers started
inside a frame on another site (`../../REGISTRY-DESIGN.md` 5): clangd's start and
answers, a GoogleTest run, a program that prints a great deal, and the memory of the
whole browser. It is evidence for `../../PLAN.md` (step 0.3 and stage 1), not a test:
nothing runs it in CI, and it needs the C++ pack installed and Chrome on Windows (the
memory sampling is Windows').

```sh
pnpm install --filter .
pnpm run build
node bench.mjs 5          # rounds; each starts a fresh Chrome per mode
```

The page is loaded from `http://localhost:<port>` and the frame from
`http://127.0.0.1:<port>`: two sites, so Chrome gives the frame a process of its own,
as it would a frame on another domain.

| Mode | What it is |
|---|---|
| `inpage` | The page starts the workers itself, as Light does today |
| `relay` | Workers in the frame; every message passes through the frame's page |
| `direct` | Workers in the frame; the page talks to each over a port of its own |
| `direct-batched` | `direct`, with the worker gathering output into batches |

## What was measured

One run on 2026-11-14, on one machine, stopped by the machine running out of memory
after two rounds and one mode of a third. Times in milliseconds; memory is the private
bytes of every Chrome process after the test runs, and the count of processes.

| Round | Mode | Server ready | First diagnostics | Completion | Edit | Tests, cold | Tests, warm | Loud program | Memory |
|---|---|---|---|---|---|---|---|---|---|
| 0 | inpage | 711 | 25281 | 287 | 525 | 13877 | 14925 | 6768 | 971 MB / 8 |
| 0 | relay | 741 | 17796 | 290 | 548 | 15014 | 13918 | 16048 | 926 MB / 9 |
| 0 | direct | 808 | 17617 | 264 | 537 | 14862 | 13938 | 22280 | 870 MB / 9 |
| 0 | direct-batched | 706 | 22941 | 267 | 549 | 12726 | 13819 | 4566 | 983 MB / 9 |
| 1 | inpage | 638 | 22869 | 258 | 471 | 13100 | 11909 | 5638 | 937 MB / 8 |
| 1 | relay | 561 | 22870 | 222 | 546 | 11643 | 11293 | 16661 | 928 MB / 9 |
| 1 | direct | 711 | 22419 | 228 | 525 | 13179 | 13187 | 18884 | 882 MB / 9 |
| 1 | direct-batched | 705 | 23379 | 282 | 548 | 14567 | 13553 | 5088 | 906 MB / 9 |
| 2 | inpage | 738 | 26757 | 285 | 630 | 15924 | 13811 | 6881 | 968 MB / 8 |

What two and a half rounds support, and no more:

- **The language server and the test runs do not visibly differ.** Every column but
  the loud program varies more between rounds of one mode than between modes.
- **Memory does not visibly differ**, and the frame is one more process.
- **Output is where the frame costs.** A program that prints without pause takes about
  three times as long when each message crosses to the page on its own (`relay`,
  `direct`), and no longer than in the page when the messages are gathered first.

## What it does not show

- **The design that will be built is not among the modes.** `direct-batched` gathers
  output inside the worker, and a worker blocked reading standard input cannot flush
  what it gathered: the prompt a program printed before reading would never arrive.
  The plan is `relay` with the gathering done by the frame's page, which this bench
  does not have yet (`PLAN.md`, 0.3).
- Chrome only. Firefox and Safari place frames and their processes differently.
- No standard input, no debugger, no pack but C++.
