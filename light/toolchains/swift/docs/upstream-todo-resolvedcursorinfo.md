# Upstream todo: `ResolvedCursorInfo` needs a virtual destructor

Status: **not filed**. Patched here as `patches/swift/0005-resolved-cursor-info-virtual-destructor.patch`.
Written 2026-10-24. Nothing has been posted upstream: no issue, no PR, no forum thread.
Open the PR only after a person on this project has read this and decided to.

Each claim below is marked **verified** (read in the upstream source or reproduced) or
**inferred** (follows from the code, not observed directly).

## The bug

`include/swift/IDE/Utils.h`, identical on `swift-6.3.3-RELEASE` and on `main` (fetched
2026-10-24; `main`'s last change to the file is e53ecb9, 2026-09-15) — **verified**:

```cpp
struct ResolvedCursorInfo : public llvm::RefCountedBase<ResolvedCursorInfo> {
  // Kind, SF, Loc; no destructor declared, no virtual functions
};
typedef llvm::IntrusiveRefCntPtr<ResolvedCursorInfo> ResolvedCursorInfoPtr;

struct ResolvedValueRefCursorInfo : public ResolvedCursorInfo { /* 13 fields, 2 SmallVectors */ };
struct ResolvedModuleRefCursorInfo : public ResolvedCursorInfo { ModuleEntity Mod; };
struct ResolvedExprStartCursorInfo : public ResolvedCursorInfo { Expr *TrailingExpr; };
struct ResolvedStmtStartCursorInfo : public ResolvedCursorInfo { Stmt *TrailingStmt; };
```

`llvm::RefCountedBase<Derived>::Release()` does `delete static_cast<const Derived *>(this)`,
with `Derived = ResolvedCursorInfo` (**verified** in `llvm/ADT/IntrusiveRefCntPtr.h`).
That holds whichever pointer type releases the object, including
`ResolvedValueRefCursorInfoPtr`, because `Release` is the base's. Deleting a subclass
object through a base pointer whose destructor is not virtual is undefined behaviour
([expr.delete]/3). What happens in practice:

* Sized deallocation passes `sizeof(ResolvedCursorInfo)` = 24 bytes for a
  `ResolvedValueRefCursorInfo` of 232 bytes (64-bit). ASan reports
  `new-delete-type-mismatch`. 232 = 24 (base) + 3 pointers + bool + 2 `Type`s +
  `optional<pair<ptr, ptr>>` + 2 bools + 2 × `SmallVector<T *>` (64 bytes each, 6
  inline elements) — **verified** by arithmetic against the CI report's 232.
* The subclass destructor never runs. `ReceiverTypes` and `ShorthandShadowedDecls`
  leak their heap buffers once they outgrow six inline elements (a dynamic reference
  through a protocol composition of more than six types, or more than six shorthand
  shadows) — **inferred**.

### Evidence

* **CI, verified:** yukibana-cloud PR #70, workflow `light-swift-lsp-lite.yml`, job `asan`
  (gcc, ASan + LSan + UBSan), ctest `lsp.rename`: `AddressSanitizer:
  new-delete-type-mismatch`, 232-byte object, allocated in
  `CursorInfoResolver::tryResolve` (`lib/IDE/IDERequests.cpp`, the
  `new ResolvedValueRefCursorInfo(...)` at line 175 on 6.3.3), freed on a SourceKit
  work-queue thread under `ASTProducer::enqueueConsumer`, from `~ASTUnit` through the
  evaluator's `PerRequestCache::makeEmpty<CursorInfoRequest>` deleter, inside the
  official 6.3.3 toolchain's `libsourcekitdInProc.so`. The 6.4 release's library does
  the same (reproduced locally by the session that wrote commit fdfeb1b).
* **Reproduction, verified:** a standalone file with the same shape (LLVM's real
  `IntrusiveRefCntPtr.h`, a 24-byte `RefCountedBase` base, an owning subclass, released
  through the base pointer), built with `clang++ -fsanitize=address -fsized-deallocation`:
  `new-delete-type-mismatch ... size of the deallocated type: 24 bytes`. With
  `virtual ~Base() = default;` the report and the leak go away.
* **Why the free happens there:** `CursorInfoRequest` is `Cached` (verified), so the
  evaluator keeps the `ResolvedCursorInfoPtr` alive as long as the AST, and frees it
  in `~ASTUnit` (verified, free stack). That this runs on the producer's
  `BuildOperationsQueue` because a new build operation replaces the old one and drops
  the last `ASTUnitRef` is inferred. That is also
  why upstream's own test suite probably never sees it: `sourcekitd-test` runs a
  request and exits without tearing the AST down, and a leak at exit of a cached
  object is not reported as a mismatch.

## History and intent

* **2017, verified:** swift#11680 renamed `SemaToken` to `ResolvedCursorInfo`; a plain
  value type.
* **2022-11-29, verified:** 6526860 "[IDE] Split `ResolvedCursorInfo` into
  subclasses" (Alex Hoppen, part of swift#62292 "Preparation for solver-based cursor
  info"). Still passed **by value**; the base's comment said subclasses "cannot add
  new stored properties because `ResolvedCursorInfo` is being passed around as its
  base class". No destructor, no virtuals — correct for a value type.
* **2023-02-13, verified:** ee26b4b, [swift#63612] "[SourceKit] Pass `ResolvedCursorInfo`
  as shared pointer instead of by value" (Alex Hoppen, reviewed and approved by Ben
  Barham, merged 2023-02-15, rdar://102853071). Commit message: "This allows us to
  model the `ResolvedCursorInfo` types as a proper type hierarchy instead of having to
  store all values in the base `ResolvedCursorInfo` type." It added
  `RefCountedBase<ResolvedCursorInfo>`, the two `IntrusiveRefCntPtr` typedefs, moved
  the per-kind fields into the subclasses and removed the "don't add stored
  properties" comments. It added no destructor. The review discussed `unique_ptr` vs
  shared ownership ("We cache the result, so we pretty much need to use a shared
  pointer here") and a nullable pointer instead of the `Invalid` kind; nothing about
  destructors, polymorphic deletion or threads.

So the **intent is polymorphic ownership through the base pointer**: the PR exists to
make subclasses with their own fields deletable through `ResolvedCursorInfoPtr`. No
custom `Release`, no `IntrusiveRefCntPtrInfo` specialisation and no kind-switch delete
exist anywhere (**verified**, grep over the 6.3.3 tree). The virtual destructor is the
missing piece of that design, not a change to it — **inferred, high confidence**.

## Nothing relies on the base being non-polymorphic (verified, 6.3.3 tree)

Every mention of the five types, in `lib/IDE`, `lib/IDETool`, `lib/Refactoring/*`,
`tools/SourceKit/lib/SwiftLang/SwiftSourceDocInfo.cpp`, `tools/swift-ide-test` and the
headers:

* Every instance is created with `new` (18 sites) and reached through
  `ResolvedCursorInfoPtr`, `ResolvedValueRefCursorInfoPtr`,
  `std::vector<ResolvedCursorInfoPtr>` (solver-based results) or a reference/pointer
  obtained from one. No instance on the stack, as a member, by value in a container,
  copied (`Resolved…CursorInfo(*x)`), or `memcpy`'d.
* Kinds are distinguished by `CursorInfoKind` + `classof` for `isa`/`dyn_cast`; a vptr
  does not affect that.
* `operator==` compares `SF` and `Loc` only.
* `SWIFT_TYPEID_NAMED(ide::ResolvedCursorInfo, …)` and the cached request store the
  pointer, not the object; no trait (`is_trivially_*`, `has_virtual_destructor`) is
  checked on these types.
* Cost: one vptr (8 bytes) per object, at most a few per request. The implicit copy
  constructor stays (deprecated once a destructor is user-declared, but unused).

## Threads: no second bug (inferred from code, not run under TSan)

`RefCountedBase`'s count is a plain `unsigned`. It would be a race if two threads
retained or released the same object. They do not:

* Consumers of an AST run on that `ASTUnit`'s own serial queue
  (`ASTUnit::Implementation::Queue`, "sourcekit.swift.ConsumeAST"), and each holds an
  `ASTUnitRef` while it runs. `CursorInfoRequest`, the `new … CursorInfo` sites in
  `SwiftSourceDocInfo.cpp` and the refactoring actions all run inside such a consumer,
  and nothing there dispatches a `ResolvedCursorInfoPtr` to another queue (no
  `dispatch`/`performAsync` captures one).
* The solver-based path (`IDEInspectionInstance::cursorInfo`) runs under the
  instance's mutex and hands results to its consumer synchronously.
* The final release happens when the `ASTUnit` (and its `ASTContext` and evaluator
  cache) is destroyed, after its last `shared_ptr` reference is gone, which orders it
  after every consumer.

`ThreadSafeRefCountedBase` would therefore change nothing, and is not proposed.

## Proposed upstream change

```diff
 public:
   ResolvedCursorInfo() = default;
   ResolvedCursorInfo(SourceFile *SF) : SF(SF) {}
 
+  /// Virtual because the subclasses are owned as \c ResolvedCursorInfoPtr,
+  /// whose \c llvm::RefCountedBase<ResolvedCursorInfo> deletes them through a
+  /// \c ResolvedCursorInfo pointer when the last reference goes.
+  virtual ~ResolvedCursorInfo() = default;
```

plus `unittests/IDE/ResolvedCursorInfoTest.cpp` (added to `SwiftIDETests`):

1. `ReleasingThroughBasePointerDestroysSubclass` — a test-local subclass whose
   destructor sets a flag, held and released as `ResolvedCursorInfoPtr`; expects the
   flag set. Fails without the fix on any build, no sanitizer needed (strictly the
   failure is UB, but every compiler skips the derived destructor there).
2. `ReleasingValueRefThroughBasePointer` — a `ResolvedValueRefCursorInfo` with 16
   receiver types (heap-allocated vector) released through the base pointer; fails
   only under ASan/LSan (upstream has `buildbot_incremental_asan` presets).

Why this shape and not another:

* It is what the codebase already does for the same pattern: SourceKit's
  `ImmutableTextUpdate` hierarchy (`virtual ~ImmutableTextUpdate() = default` over
  `ThreadSafeRefCountedBaseVPTR`), and LLVM's `vfs::FileSystem`
  (`ThreadSafeRefCountedBase<FileSystem>` with `virtual ~FileSystem()`). LLVM itself
  dropped its `RefCountedBaseVPTR` in favour of exactly this (a virtual destructor in
  the hierarchy's base, under the CRTP base) — recalled, not re-checked for this note.
* A kind-switch delete (custom `Retain`/`Release`) would be more code, duplicate
  `classof`, and break silently when a kind is added.
* Making the pointer type concrete does not help: `Release` belongs to the base, and
  `CursorInfoRequest`'s result has to be the base pointer.
* Precedent for accepting ASan new/delete-mismatch fixes: swift#83321 "IRGen: correct
  some type deletion" (compnerd, merged 2025-07-27: "ASAN identified mismatched
  operator new and operator delete"), with a follow-up for hosts without sized
  deallocation (swift#83396, superseded by swift#83399).

Who to ask for review (from history, not from CODEOWNERS): Alex Hoppen (author of the
design), Ben Barham (reviewed it), Hamish Knight (recent IDE changes). Target `main`;
a `release/6.3` cherry-pick is optional and needs its own justification form.

### Draft PR description

> **[IDE] Give `ResolvedCursorInfo` a virtual destructor**
>
> Since #63612, the subclasses of `ResolvedCursorInfo` have stored properties of their
> own and are owned through `ResolvedCursorInfoPtr`
> (`IntrusiveRefCntPtr<ResolvedCursorInfo>`). `RefCountedBase<ResolvedCursorInfo>::Release`
> deletes them as `ResolvedCursorInfo *`, and the base has no virtual destructor, so the
> subclass destructors never run and sized deallocation passes the base's size.
> AddressSanitizer reports it as `new-delete-type-mismatch` (232 bytes allocated, 24
> deallocated) when SourceKit drops an AST whose `CursorInfoRequest` result was cached,
> e.g. after an edit; `ResolvedValueRefCursorInfo`'s `SmallVector`s also leak once
> they spill to the heap.
>
> Add `virtual ~ResolvedCursorInfo() = default;` and a unit test that releases a
> subclass through the base pointer.
>
> All instances are heap-allocated and reached through pointers; kind checks use
> `classof`, so the added vptr changes nothing else.

## Confidence and open questions

* Root cause: **high** — the CI report's sizes match the layout exactly, the
  reproduction shows the same report and that the fix removes it, and the standard
  says the delete is UB.
* Fix accepted upstream: **high** for the shape (one line, matches local and LLVM
  convention, precedent for ASan fixes). Medium for the test: reviewers may prefer no
  new unittest file for a one-line fix, or a SourceKit-level test; the second test
  only bites under a sanitizer and could be dropped.
* Open: the unit test was **not compiled** here (no Swift build on this machine); it
  uses only inline header code, but must be built before filing.
* Open: whether Apple's internal ASan bots run SourceKit with sized deallocation and
  an AST teardown; if they did, they would have found it. Unknown.
* Open: the 6.3.3 free stack was read from CI, not re-derived locally; the path
  through `cleanBuildOperations` is inferred.
* Our side: the native `asan` job links the official toolchain's
  `libsourcekitdInProc.so`, which keeps the bug until a release carries the fix.
  Commit fdfeb1b set `new_delete_type_mismatch=0` in `ASAN_OPTIONS` for the tests that
  load sourcekitd (`tools/sourcekit-lsp-lite/tests/CMakeLists.txt`), to be removed
  once the toolchain is fixed; it also hides any other mismatch inside sourcekitd
  meanwhile. The wasm build carries patch `0005`. `lsp_test.py` now prints a
  sanitizer report from its first line (error, sizes, both stacks) instead of only
  the last 4000 characters of the server's stderr.
* Searched swiftlang/swift issues and PRs for `ResolvedCursorInfo` and for SourceKit +
  AddressSanitizer / new-delete-type-mismatch (2026-10-24): no report of this bug.
  The GitHub search API was blocked in this session; the web search pages were used.

[swift#63612]: https://github.com/swiftlang/swift/pull/63612
