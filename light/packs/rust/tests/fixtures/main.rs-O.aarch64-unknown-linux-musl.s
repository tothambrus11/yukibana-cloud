	.file	"shapes.fefd4f1a2552b730-cgu.0"
	.section	.text._RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes,"ax",@progbits
	.hidden	_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes // -- Begin function _RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes
	.globl	_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes
	.p2align	2
	.type	_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes,@function
_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes: // @_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes
.Lfunc_begin0:
	.file	1 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src" "rt.rs"
	.loc	1 199 0                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:199:0
	.cfi_startproc
// %bb.0:
	sub	sp, sp, #32
	.cfi_def_cfa_offset 32
	stp	x29, x30, [sp, #16]             // 16-byte Folded Spill
	add	x29, sp, #16
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
	mov	w4, w3
	mov	x3, x2
	mov	x2, x1
.Ltmp0:
	.loc	1 206 10 prologue_end           // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:10
	str	x0, [sp, #8]
	.loc	1 205 5                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:205:5
	adrp	x1, .Lanon.dc31c475a80c38e81f5caca6441cedf3.0
	add	x1, x1, :lo12:.Lanon.dc31c475a80c38e81f5caca6441cedf3.0
	add	x0, sp, #8
	bl	_RNvNtCsiKaSbYLw9fL_3std2rt19lang_start_internal
	.cfi_def_cfa wsp, 32
	.loc	1 211 2 epilogue_begin          // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:211:2
	ldp	x29, x30, [sp, #16]             // 16-byte Folded Reload
	add	sp, sp, #32
	.cfi_def_cfa_offset 0
	.cfi_restore w30
	.cfi_restore w29
	ret
.Ltmp1:
.Lfunc_end0:
	.size	_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes, .Lfunc_end0-_RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes
	.cfi_endproc
                                        // -- End function
	.section	.text._RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes,"ax",@progbits
	.p2align	2                               // -- Begin function _RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes
	.type	_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes,@function
_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes: // @_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes
.Lfunc_begin1:
	.file	2 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys" "backtrace.rs"
	.loc	2 162 0                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys/backtrace.rs:162:0
	.cfi_startproc
// %bb.0:
	stp	x29, x30, [sp, #-16]!           // 16-byte Folded Spill
	.cfi_def_cfa_offset 16
	mov	x29, sp
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
.Ltmp2:
	.file	3 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops" "function.rs"
	.loc	3 250 5 prologue_end            // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys/backtrace.rs:166:18 ]
	blr	x0
.Ltmp3:
	.file	4 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src" "hint.rs"
	.loc	4 491 5                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/hint.rs:491:5 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys/backtrace.rs:169:5 ]
	//APP
	//NO_APP
.Ltmp4:
	.cfi_def_cfa wsp, 16
	.loc	2 172 2 epilogue_begin          // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/sys/backtrace.rs:172:2
	ldp	x29, x30, [sp], #16             // 16-byte Folded Reload
	.cfi_def_cfa_offset 0
	.cfi_restore w30
	.cfi_restore w29
	ret
.Ltmp5:
.Lfunc_end1:
	.size	_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes, .Lfunc_end1-_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes
	.cfi_endproc
                                        // -- End function
	.section	.text._RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes,"ax",@progbits
	.p2align	2                               // -- Begin function _RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes
	.type	_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes,@function
_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes: // @_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes
.Lfunc_begin2:
	.loc	1 206 0                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:0
	.cfi_startproc
// %bb.0:
	stp	x29, x30, [sp, #-16]!           // 16-byte Folded Spill
	.cfi_def_cfa_offset 16
	mov	x29, sp
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
.Ltmp6:
	.loc	1 206 70 prologue_end           // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:70
	ldr	x0, [x0]
	.loc	1 206 18 is_stmt 0              // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:18
	bl	_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes
	.loc	1 206 93                        // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:93
	mov	w0, wzr
	.cfi_def_cfa wsp, 16
	.loc	1 206 93 epilogue_begin         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:93
	ldp	x29, x30, [sp], #16             // 16-byte Folded Reload
	.cfi_def_cfa_offset 0
	.cfi_restore w30
	.cfi_restore w29
	ret
.Ltmp7:
.Lfunc_end2:
	.size	_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes, .Lfunc_end2-_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes
	.cfi_endproc
                                        // -- End function
	.section	.text._RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes,"ax",@progbits
	.p2align	2                               // -- Begin function _RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes
	.type	_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes,@function
_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes: // @_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes
.Lfunc_begin3:
	.loc	3 250 0 is_stmt 1               // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:0
	.cfi_startproc
// %bb.0:
	stp	x29, x30, [sp, #-16]!           // 16-byte Folded Spill
	.cfi_def_cfa_offset 16
	mov	x29, sp
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
.Ltmp8:
	.loc	3 250 5 prologue_end            // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
	ldr	x0, [x0]
.Ltmp9:
	.loc	1 206 18                        // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/std/src/rt.rs:206:18 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5 ] ]
	bl	_RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes
.Ltmp10:
	.loc	3 250 5                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
	mov	w0, wzr
	.cfi_def_cfa wsp, 16
	.loc	3 250 5 epilogue_begin is_stmt 0 // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/ops/function.rs:250:5
	ldp	x29, x30, [sp], #16             // 16-byte Folded Reload
	.cfi_def_cfa_offset 0
	.cfi_restore w30
	.cfi_restore w29
	ret
.Ltmp11:
.Lfunc_end3:
	.size	_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes, .Lfunc_end3-_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes
	.cfi_endproc
                                        // -- End function
	.section	.text._RNvCslTiMYjnVcvQ_6shapes4main,"ax",@progbits
	.hidden	_RNvCslTiMYjnVcvQ_6shapes4main  // -- Begin function _RNvCslTiMYjnVcvQ_6shapes4main
	.globl	_RNvCslTiMYjnVcvQ_6shapes4main
	.p2align	2
	.type	_RNvCslTiMYjnVcvQ_6shapes4main,@function
_RNvCslTiMYjnVcvQ_6shapes4main:         // @_RNvCslTiMYjnVcvQ_6shapes4main
.Lfunc_begin4:
	.file	5 "src" "main.rs"
	.loc	5 7 0 is_stmt 1                 // src/main.rs:7:0
	.cfi_startproc
// %bb.0:
	sub	sp, sp, #64
	.cfi_def_cfa_offset 64
	stp	x29, x30, [sp, #48]             // 16-byte Folded Spill
	add	x29, sp, #48
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
.Ltmp12:
	.file	6 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src" "alloc.rs"
	.loc	6 99 9 prologue_end             // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/alloc.rs:99:9 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/alloc.rs:210:73 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/alloc.rs:332:9 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/alloc.rs:449:14 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/raw_vec/mod.rs:466:47 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/raw_vec/mod.rs:435:15 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/raw_vec/mod.rs:177:20 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec/mod.rs:975:20 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec/mod.rs:522:9 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec/spec_from_iter_nested.rs:52:33 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec/spec_from_iter.rs:33:9 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec/mod.rs:3941:9 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/iter/traits/iterator.rs:2090:9 @[ src/main.rs:8:44 ] ] ] ] ] ] ] ] ] ] ] ] ]
	bl	_RNvCs1njKG4L9aB3_7___rustc35___rust_no_alloc_shim_is_unstable_v2
	mov	w8, #385                        // =0x181
	mov	x9, #4617315517961601024        // =0x4014000000000000
	add	x10, sp, #4
.Ltmp13:
	.file	7 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/iter/traits" "accum.rs"
	.loc	7 74 17                         // /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/iter/traits/accum.rs:74:17 @[ /rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/iter/traits/iterator.rs:3674:9 @[ src/main.rs:9:31 ] ]
	str	w8, [sp, #4]
.Ltmp14:
	.loc	5 10 5                          // src/main.rs:10:5
	adrp	x8, :got:_RNvXs9_NtNtNtCs2kXltWtc1W_4core3fmt3num3implNtB9_7Display3fmt
.Ltmp15:
	.loc	5 10 5 is_stmt 0                // src/main.rs:10:5
	adrp	x0, .Lanon.dc31c475a80c38e81f5caca6441cedf3.1
	add	x0, x0, :lo12:.Lanon.dc31c475a80c38e81f5caca6441cedf3.1
	.loc	5 10 28                         // src/main.rs:10:28
	str	x9, [sp, #8]
.Ltmp16:
	.loc	5 10 5                          // src/main.rs:10:5
	adrp	x9, :got:_RNvXs7_NtNtCs2kXltWtc1W_4core3fmt5floatdNtB7_7Display3fmt
	ldr	x8, [x8, :got_lo12:_RNvXs9_NtNtNtCs2kXltWtc1W_4core3fmt3num3implNtB9_7Display3fmt]
.Ltmp17:
	.loc	5 10 5                          // src/main.rs:10:5
	add	x1, sp, #16
.Ltmp18:
	.loc	5 10 5                          // src/main.rs:10:5
	stp	x10, x8, [sp, #16]
	add	x8, sp, #8
	ldr	x9, [x9, :got_lo12:_RNvXs7_NtNtCs2kXltWtc1W_4core3fmt5floatdNtB7_7Display3fmt]
	stp	x8, x9, [sp, #32]
.Ltmp19:
	.loc	5 10 5                          // src/main.rs:10:5
	bl	_RNvNtNtCsiKaSbYLw9fL_3std2io5stdio6__print
.Ltmp20:
	.cfi_def_cfa wsp, 64
	.loc	5 11 2 epilogue_begin is_stmt 1 // src/main.rs:11:2
	ldp	x29, x30, [sp, #48]             // 16-byte Folded Reload
	add	sp, sp, #64
	.cfi_def_cfa_offset 0
	.cfi_restore w30
	.cfi_restore w29
	ret
.Ltmp21:
.Lfunc_end4:
	.size	_RNvCslTiMYjnVcvQ_6shapes4main, .Lfunc_end4-_RNvCslTiMYjnVcvQ_6shapes4main
	.cfi_endproc
	.file	8 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/core/src/iter/traits" "iterator.rs"
	.file	9 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec" "mod.rs"
	.file	10 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec" "spec_from_iter.rs"
	.file	11 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/vec" "spec_from_iter_nested.rs"
	.file	12 "/rustc/48a229ceaefd4985c50990b14116b6d856af0985/library/alloc/src/raw_vec" "mod.rs"
                                        // -- End function
	.section	.text.main,"ax",@progbits
	.globl	main                            // -- Begin function main
	.p2align	2
	.type	main,@function
main:                                   // @main
.Lfunc_begin5:
	.cfi_startproc
// %bb.0:
	sub	sp, sp, #32
	stp	x29, x30, [sp, #16]             // 16-byte Folded Spill
	add	x29, sp, #16
	.cfi_def_cfa w29, 16
	.cfi_offset w30, -8
	.cfi_offset w29, -16
	adrp	x8, :got:__rustc_debug_gdb_scripts_section__
                                        // kill: def $w0 killed $w0 def $x0
	sxtw	x2, w0
	mov	x3, x1
	ldr	x8, [x8, :got_lo12:__rustc_debug_gdb_scripts_section__]
	adrp	x1, .Lanon.dc31c475a80c38e81f5caca6441cedf3.0
	add	x1, x1, :lo12:.Lanon.dc31c475a80c38e81f5caca6441cedf3.0
	add	x0, sp, #8
	mov	w4, wzr
	ldrb	wzr, [x8]
	adrp	x8, _RNvCslTiMYjnVcvQ_6shapes4main
	add	x8, x8, :lo12:_RNvCslTiMYjnVcvQ_6shapes4main
	str	x8, [sp, #8]
	bl	_RNvNtCsiKaSbYLw9fL_3std2rt19lang_start_internal
	ldp	x29, x30, [sp, #16]             // 16-byte Folded Reload
                                        // kill: def $w0 killed $w0 killed $x0
	add	sp, sp, #32
	ret
.Lfunc_end5:
	.size	main, .Lfunc_end5-main
	.cfi_endproc
                                        // -- End function
	.type	.Lanon.dc31c475a80c38e81f5caca6441cedf3.0,@object // @anon.dc31c475a80c38e81f5caca6441cedf3.0
	.section	.data.rel.ro..Lanon.dc31c475a80c38e81f5caca6441cedf3.0,"aw",@progbits
	.p2align	3, 0x0
.Lanon.dc31c475a80c38e81f5caca6441cedf3.0:
	.asciz	"\000\000\000\000\000\000\000\000\b\000\000\000\000\000\000\000\b\000\000\000\000\000\000"
	.xword	_RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes
	.xword	_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes
	.xword	_RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes
	.size	.Lanon.dc31c475a80c38e81f5caca6441cedf3.0, 48

	.type	.Lanon.dc31c475a80c38e81f5caca6441cedf3.1,@object // @anon.dc31c475a80c38e81f5caca6441cedf3.1
	.section	.rodata.str1.1,"aMS",@progbits,1
.Lanon.dc31c475a80c38e81f5caca6441cedf3.1:
	.asciz	"\300\001 \300\001\n"
	.size	.Lanon.dc31c475a80c38e81f5caca6441cedf3.1, 7

	.type	__rustc_debug_gdb_scripts_section__,@object // @__rustc_debug_gdb_scripts_section__
	.section	.debug_gdb_scripts,"aMS",@progbits,1,unique,1
	.weak	__rustc_debug_gdb_scripts_section__
__rustc_debug_gdb_scripts_section__:
	.asciz	"\001gdb_load_rust_pretty_printers.py"
	.size	__rustc_debug_gdb_scripts_section__, 34

	.section	.debug_abbrev,"",@progbits
	.byte	1                               // Abbreviation Code
	.byte	17                              // DW_TAG_compile_unit
	.byte	1                               // DW_CHILDREN_yes
	.byte	37                              // DW_AT_producer
	.byte	14                              // DW_FORM_strp
	.byte	19                              // DW_AT_language
	.byte	5                               // DW_FORM_data2
	.byte	3                               // DW_AT_name
	.byte	14                              // DW_FORM_strp
	.byte	16                              // DW_AT_stmt_list
	.byte	23                              // DW_FORM_sec_offset
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	85                              // DW_AT_ranges
	.byte	23                              // DW_FORM_sec_offset
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	2                               // Abbreviation Code
	.byte	46                              // DW_TAG_subprogram
	.byte	0                               // DW_CHILDREN_no
	.byte	3                               // DW_AT_name
	.byte	14                              // DW_FORM_strp
	.byte	32                              // DW_AT_inline
	.byte	11                              // DW_FORM_data1
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	3                               // Abbreviation Code
	.byte	46                              // DW_TAG_subprogram
	.byte	1                               // DW_CHILDREN_yes
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	18                              // DW_AT_high_pc
	.byte	6                               // DW_FORM_data4
	.byte	3                               // DW_AT_name
	.byte	14                              // DW_FORM_strp
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	4                               // Abbreviation Code
	.byte	29                              // DW_TAG_inlined_subroutine
	.byte	0                               // DW_CHILDREN_no
	.byte	49                              // DW_AT_abstract_origin
	.byte	19                              // DW_FORM_ref4
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	18                              // DW_AT_high_pc
	.byte	6                               // DW_FORM_data4
	.byte	88                              // DW_AT_call_file
	.byte	11                              // DW_FORM_data1
	.byte	89                              // DW_AT_call_line
	.byte	11                              // DW_FORM_data1
	.byte	87                              // DW_AT_call_column
	.byte	11                              // DW_FORM_data1
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	5                               // Abbreviation Code
	.byte	29                              // DW_TAG_inlined_subroutine
	.byte	1                               // DW_CHILDREN_yes
	.byte	49                              // DW_AT_abstract_origin
	.byte	19                              // DW_FORM_ref4
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	18                              // DW_AT_high_pc
	.byte	6                               // DW_FORM_data4
	.byte	88                              // DW_AT_call_file
	.byte	11                              // DW_FORM_data1
	.byte	89                              // DW_AT_call_line
	.byte	11                              // DW_FORM_data1
	.byte	87                              // DW_AT_call_column
	.byte	11                              // DW_FORM_data1
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	6                               // Abbreviation Code
	.byte	29                              // DW_TAG_inlined_subroutine
	.byte	1                               // DW_CHILDREN_yes
	.byte	49                              // DW_AT_abstract_origin
	.byte	19                              // DW_FORM_ref4
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	18                              // DW_AT_high_pc
	.byte	6                               // DW_FORM_data4
	.byte	88                              // DW_AT_call_file
	.byte	11                              // DW_FORM_data1
	.byte	89                              // DW_AT_call_line
	.byte	5                               // DW_FORM_data2
	.byte	87                              // DW_AT_call_column
	.byte	11                              // DW_FORM_data1
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	7                               // Abbreviation Code
	.byte	29                              // DW_TAG_inlined_subroutine
	.byte	0                               // DW_CHILDREN_no
	.byte	49                              // DW_AT_abstract_origin
	.byte	19                              // DW_FORM_ref4
	.byte	17                              // DW_AT_low_pc
	.byte	1                               // DW_FORM_addr
	.byte	18                              // DW_AT_high_pc
	.byte	6                               // DW_FORM_data4
	.byte	88                              // DW_AT_call_file
	.byte	11                              // DW_FORM_data1
	.byte	89                              // DW_AT_call_line
	.byte	5                               // DW_FORM_data2
	.byte	87                              // DW_AT_call_column
	.byte	11                              // DW_FORM_data1
	.byte	0                               // EOM(1)
	.byte	0                               // EOM(2)
	.byte	0                               // EOM(3)
	.section	.debug_info,"",@progbits
.Lcu_begin0:
	.word	.Ldebug_info_end0-.Ldebug_info_start0 // Length of Unit
.Ldebug_info_start0:
	.hword	4                               // DWARF version number
	.word	.debug_abbrev                   // Offset Into Abbrev. Section
	.byte	8                               // Address Size (in bytes)
	.byte	1                               // Abbrev [1] 0xb:0x257 DW_TAG_compile_unit
	.word	.Linfo_string0                  // DW_AT_producer
	.hword	28                              // DW_AT_language
	.word	.Linfo_string1                  // DW_AT_name
	.word	.Lline_table_start0             // DW_AT_stmt_list
	.xword	0                               // DW_AT_low_pc
	.word	.Ldebug_ranges0                 // DW_AT_ranges
	.byte	2                               // Abbrev [2] 0x26:0x6 DW_TAG_subprogram
	.word	.Linfo_string2                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0x2c:0x6 DW_TAG_subprogram
	.word	.Linfo_string3                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	3                               // Abbrev [3] 0x32:0x3a DW_TAG_subprogram
	.xword	.Lfunc_begin1                   // DW_AT_low_pc
	.word	.Lfunc_end1-.Lfunc_begin1       // DW_AT_high_pc
	.word	.Linfo_string18                 // DW_AT_name
	.byte	4                               // Abbrev [4] 0x43:0x14 DW_TAG_inlined_subroutine
	.word	38                              // DW_AT_abstract_origin
	.xword	.Ltmp2                          // DW_AT_low_pc
	.word	.Ltmp3-.Ltmp2                   // DW_AT_high_pc
	.byte	2                               // DW_AT_call_file
	.byte	166                             // DW_AT_call_line
	.byte	18                              // DW_AT_call_column
	.byte	4                               // Abbrev [4] 0x57:0x14 DW_TAG_inlined_subroutine
	.word	44                              // DW_AT_abstract_origin
	.xword	.Ltmp3                          // DW_AT_low_pc
	.word	.Ltmp4-.Ltmp3                   // DW_AT_high_pc
	.byte	2                               // DW_AT_call_file
	.byte	169                             // DW_AT_call_line
	.byte	5                               // DW_AT_call_column
	.byte	0                               // End Of Children Mark
	.byte	2                               // Abbrev [2] 0x6c:0x6 DW_TAG_subprogram
	.word	.Linfo_string4                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0x72:0x6 DW_TAG_subprogram
	.word	.Linfo_string5                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	3                               // Abbrev [3] 0x78:0x3b DW_TAG_subprogram
	.xword	.Lfunc_begin3                   // DW_AT_low_pc
	.word	.Lfunc_end3-.Lfunc_begin3       // DW_AT_high_pc
	.word	.Linfo_string5                  // DW_AT_name
	.byte	5                               // Abbrev [5] 0x89:0x29 DW_TAG_inlined_subroutine
	.word	114                             // DW_AT_abstract_origin
	.xword	.Ltmp9                          // DW_AT_low_pc
	.word	.Ltmp10-.Ltmp9                  // DW_AT_high_pc
	.byte	3                               // DW_AT_call_file
	.byte	250                             // DW_AT_call_line
	.byte	5                               // DW_AT_call_column
	.byte	4                               // Abbrev [4] 0x9d:0x14 DW_TAG_inlined_subroutine
	.word	108                             // DW_AT_abstract_origin
	.xword	.Ltmp9                          // DW_AT_low_pc
	.word	.Ltmp10-.Ltmp9                  // DW_AT_high_pc
	.byte	3                               // DW_AT_call_file
	.byte	250                             // DW_AT_call_line
	.byte	5                               // DW_AT_call_column
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	2                               // Abbrev [2] 0xb3:0x6 DW_TAG_subprogram
	.word	.Linfo_string6                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xb9:0x6 DW_TAG_subprogram
	.word	.Linfo_string7                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xbf:0x6 DW_TAG_subprogram
	.word	.Linfo_string8                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xc5:0x6 DW_TAG_subprogram
	.word	.Linfo_string9                  // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xcb:0x6 DW_TAG_subprogram
	.word	.Linfo_string10                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xd1:0x6 DW_TAG_subprogram
	.word	.Linfo_string11                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xd7:0x6 DW_TAG_subprogram
	.word	.Linfo_string12                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xdd:0x6 DW_TAG_subprogram
	.word	.Linfo_string12                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xe3:0x6 DW_TAG_subprogram
	.word	.Linfo_string13                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xe9:0x6 DW_TAG_subprogram
	.word	.Linfo_string14                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xef:0x6 DW_TAG_subprogram
	.word	.Linfo_string14                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xf5:0x6 DW_TAG_subprogram
	.word	.Linfo_string14                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0xfb:0x6 DW_TAG_subprogram
	.word	.Linfo_string15                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0x101:0x6 DW_TAG_subprogram
	.word	.Linfo_string16                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	2                               // Abbrev [2] 0x107:0x6 DW_TAG_subprogram
	.word	.Linfo_string17                 // DW_AT_name
	.byte	1                               // DW_AT_inline
	.byte	3                               // Abbrev [3] 0x10d:0x154 DW_TAG_subprogram
	.xword	.Lfunc_begin4                   // DW_AT_low_pc
	.word	.Lfunc_end4-.Lfunc_begin4       // DW_AT_high_pc
	.word	.Linfo_string19                 // DW_AT_name
	.byte	5                               // Abbrev [5] 0x11e:0x118 DW_TAG_inlined_subroutine
	.word	251                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	5                               // DW_AT_call_file
	.byte	8                               // DW_AT_call_line
	.byte	44                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x132:0x103 DW_TAG_inlined_subroutine
	.word	245                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	8                               // DW_AT_call_file
	.hword	2090                            // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x147:0xed DW_TAG_inlined_subroutine
	.word	239                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	9                               // DW_AT_call_file
	.hword	3941                            // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	5                               // Abbrev [5] 0x15c:0xd7 DW_TAG_inlined_subroutine
	.word	233                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	10                              // DW_AT_call_file
	.byte	33                              // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	5                               // Abbrev [5] 0x170:0xc2 DW_TAG_inlined_subroutine
	.word	227                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	11                              // DW_AT_call_file
	.byte	52                              // DW_AT_call_line
	.byte	33                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x184:0xad DW_TAG_inlined_subroutine
	.word	221                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	9                               // DW_AT_call_file
	.hword	522                             // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x199:0x97 DW_TAG_inlined_subroutine
	.word	215                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	9                               // DW_AT_call_file
	.hword	975                             // DW_AT_call_line
	.byte	20                              // DW_AT_call_column
	.byte	5                               // Abbrev [5] 0x1ae:0x81 DW_TAG_inlined_subroutine
	.word	209                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	12                              // DW_AT_call_file
	.byte	177                             // DW_AT_call_line
	.byte	20                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x1c2:0x6c DW_TAG_inlined_subroutine
	.word	203                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	12                              // DW_AT_call_file
	.hword	435                             // DW_AT_call_line
	.byte	15                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x1d7:0x56 DW_TAG_inlined_subroutine
	.word	197                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	12                              // DW_AT_call_file
	.hword	466                             // DW_AT_call_line
	.byte	47                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x1ec:0x40 DW_TAG_inlined_subroutine
	.word	191                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	6                               // DW_AT_call_file
	.hword	449                             // DW_AT_call_line
	.byte	14                              // DW_AT_call_column
	.byte	6                               // Abbrev [6] 0x201:0x2a DW_TAG_inlined_subroutine
	.word	185                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	6                               // DW_AT_call_file
	.hword	332                             // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	4                               // Abbrev [4] 0x216:0x14 DW_TAG_inlined_subroutine
	.word	179                             // DW_AT_abstract_origin
	.xword	.Ltmp12                         // DW_AT_low_pc
	.word	.Ltmp13-.Ltmp12                 // DW_AT_high_pc
	.byte	6                               // DW_AT_call_file
	.byte	210                             // DW_AT_call_line
	.byte	73                              // DW_AT_call_column
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	5                               // Abbrev [5] 0x236:0x2a DW_TAG_inlined_subroutine
	.word	263                             // DW_AT_abstract_origin
	.xword	.Ltmp13                         // DW_AT_low_pc
	.word	.Ltmp14-.Ltmp13                 // DW_AT_high_pc
	.byte	5                               // DW_AT_call_file
	.byte	9                               // DW_AT_call_line
	.byte	31                              // DW_AT_call_column
	.byte	7                               // Abbrev [7] 0x24a:0x15 DW_TAG_inlined_subroutine
	.word	257                             // DW_AT_abstract_origin
	.xword	.Ltmp13                         // DW_AT_low_pc
	.word	.Ltmp14-.Ltmp13                 // DW_AT_high_pc
	.byte	8                               // DW_AT_call_file
	.hword	3674                            // DW_AT_call_line
	.byte	9                               // DW_AT_call_column
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
	.byte	0                               // End Of Children Mark
.Ldebug_info_end0:
	.section	.text._RINvNtCsiKaSbYLw9fL_3std2rt10lang_startuECslTiMYjnVcvQ_6shapes,"ax",@progbits
.Lsec_end0:
	.section	.text._RINvNtNtCsiKaSbYLw9fL_3std3sys9backtrace28___rust_begin_short_backtraceFEuuECslTiMYjnVcvQ_6shapes,"ax",@progbits
.Lsec_end1:
	.section	.text._RNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0CslTiMYjnVcvQ_6shapes,"ax",@progbits
.Lsec_end2:
	.section	.text._RNSNvYNCINvNtCsiKaSbYLw9fL_3std2rt10lang_startuE0INtNtNtCs2kXltWtc1W_4core3ops8function6FnOnceuE9call_once6vtableCslTiMYjnVcvQ_6shapes,"ax",@progbits
.Lsec_end3:
	.section	.text._RNvCslTiMYjnVcvQ_6shapes4main,"ax",@progbits
.Lsec_end4:
	.section	.debug_aranges,"",@progbits
	.word	108                             // Length of ARange Set
	.hword	2                               // DWARF Arange version number
	.word	.Lcu_begin0                     // Offset Into Debug Info Section
	.byte	8                               // Address Size (in bytes)
	.byte	0                               // Segment Size (in bytes)
	.zero	4,255
	.xword	.Lfunc_begin0
	.xword	.Lsec_end0-.Lfunc_begin0
	.xword	.Lfunc_begin1
	.xword	.Lsec_end1-.Lfunc_begin1
	.xword	.Lfunc_begin2
	.xword	.Lsec_end2-.Lfunc_begin2
	.xword	.Lfunc_begin3
	.xword	.Lsec_end3-.Lfunc_begin3
	.xword	.Lfunc_begin4
	.xword	.Lsec_end4-.Lfunc_begin4
	.xword	0                               // ARange terminator
	.xword	0
	.section	.debug_ranges,"",@progbits
.Ldebug_ranges0:
	.xword	.Lfunc_begin0
	.xword	.Lfunc_end0
	.xword	.Lfunc_begin1
	.xword	.Lfunc_end1
	.xword	.Lfunc_begin2
	.xword	.Lfunc_end2
	.xword	.Lfunc_begin3
	.xword	.Lfunc_end3
	.xword	.Lfunc_begin4
	.xword	.Lfunc_end4
	.xword	0
	.xword	0
	.section	.debug_str,"MS",@progbits,1
.Linfo_string0:
	.asciz	"clang LLVM (rustc version 1.98.1 (48a229cea 2026-09-01))" // string offset=0
.Linfo_string1:
	.asciz	"src/main.rs/@/shapes.fefd4f1a2552b730-cgu.0" // string offset=57
.Linfo_string2:
	.asciz	"call_once<fn(), ()>"           // string offset=101
.Linfo_string3:
	.asciz	"black_box<()>"                 // string offset=121
.Linfo_string4:
	.asciz	"{closure#0}<()>"               // string offset=135
.Linfo_string5:
	.asciz	"call_once<std::rt::lang_start::{closure_env#0}<()>, ()>" // string offset=151
.Linfo_string6:
	.asciz	"alloc"                         // string offset=207
.Linfo_string7:
	.asciz	"alloc_impl_runtime"            // string offset=213
.Linfo_string8:
	.asciz	"alloc_impl"                    // string offset=232
.Linfo_string9:
	.asciz	"allocate"                      // string offset=243
.Linfo_string10:
	.asciz	"try_allocate_in<alloc::alloc::Global>" // string offset=252
.Linfo_string11:
	.asciz	"with_capacity_in<alloc::alloc::Global>" // string offset=290
.Linfo_string12:
	.asciz	"with_capacity_in<i32, alloc::alloc::Global>" // string offset=329
.Linfo_string13:
	.asciz	"with_capacity<i32>"            // string offset=373
.Linfo_string14:
	.asciz	"from_iter<i32, core::iter::adapters::map::Map<core::ops::range::RangeInclusive<i32>, fn(i32) -> i32>>" // string offset=392
.Linfo_string15:
	.asciz	"collect<core::iter::adapters::map::Map<core::ops::range::RangeInclusive<i32>, fn(i32) -> i32>, alloc::vec::Vec<i32, alloc::alloc::Global>>" // string offset=494
.Linfo_string16:
	.asciz	"sum<core::slice::iter::Iter<i32>>" // string offset=633
.Linfo_string17:
	.asciz	"sum<core::slice::iter::Iter<i32>, i32>" // string offset=667
.Linfo_string18:
	.asciz	"__rust_begin_short_backtrace<fn(), ()>" // string offset=706
.Linfo_string19:
	.asciz	"main"                          // string offset=745
	.ident	"rustc version 1.98.1 (48a229cea 2026-09-01)"
	.section	".note.GNU-stack","",@progbits
	.section	.debug_line,"",@progbits
.Lline_table_start0:
