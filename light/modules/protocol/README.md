# @yukibana/protocol

What crosses a boundary in Yukibana Light, as TypeScript types and pure
functions: the messages between the editor and a language server, between a
page and a runner, between a host and the runner frame, and what a pack
declares it needs from its host.

## Contract

* Types and pure codecs only: a function here is a function of its
  arguments, with no I/O, timers, globals or DOM. It runs the same in a
  page, a worker, the runner frame and Node.
* A message's shape changes only together with every side that sends or
  receives it; a field a receiver might not know is optional.
* It never names a pack. A pack's needs are data the pack ships
  (`requires.json`), and this module only reads and compares them.

## Allowed imports

Only files of this module, by relative paths ending in `.ts`. Nothing from
`runtime`, `monaco`, the app, npm or Node, so the packs' glue and the runner
frame can bundle it with nothing else.
