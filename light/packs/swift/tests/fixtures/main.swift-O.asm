	.file	"view.out"
	.tabletype	__indirect_function_table, funcref
	.globaltype	__stack_pointer, i32
	.globaltype	__memory_base, i32, immutable
	.functype	__main_argc_argv (i32, i32) -> (i32)
	.functype	__swift_instantiateConcreteTypeFromMangledName (i32) -> (i32)
	.functype	swift_getTypeByMangledNameInContext2 (i32, i32, i32, i32, i32, i32) -> (i32)
	.functype	swift_allocObject (i32, i32, i32) -> (i32)
	.functype	$s4main6CircleV6radiusACSd_tcfC (f64, i32, i32) -> (f64)
	.functype	.Lobjectdestroy (i32, i32) -> ()
	.functype	swift_deallocObject (i32, i32, i32) -> ()
	.functype	$s4main6SquareV4sideACSd_tcfC (f64, i32, i32) -> (f64)
	.functype	swift_retain (i32) -> (i32)
	.functype	swift_beginAccess (i32, i32, i32, i32) -> ()
	.functype	$s4main5Shape_pWOc (i32, i32) -> (i32)
	.functype	$s4main5Shape_pWOb (i32, i32) -> (i32)
	.functype	__swift_project_boxed_opaque_existential_1 (i32, i32) -> (i32)
	.functype	__swift_destroy_boxed_opaque_existential_1 (i32) -> ()
	.functype	swift_release (i32) -> ()
	.functype	$ss11_StringGutsV4growyySiF (i32, i32, i32) -> ()
	.functype	$sSS6appendyySSF (i32, i32, i32, i32, i32) -> ()
	.functype	$sSd5write2toyxz_ts16TextOutputStreamRzlF (i32, f64, i32, i32, i32, i32) -> ()
	.functype	$ss5print_9separator10terminatoryypd_S2StF (i32, i32, i32, i32, i32, i32, i32, i32, i32) -> ()
	.functype	$s4main6squareyS2iF (i32, i32, i32) -> (i32)
	.section	.text.__main_argc_argv,"R",@
	.globl	__main_argc_argv                # -- Begin function __main_argc_argv
	.type	__main_argc_argv,@function
__main_argc_argv:                       # @__main_argc_argv
.Lfunc_begin0:
	.file	1 "/" "/workspace/main.swift"
	.loc	1 0 0                           # /workspace/main.swift:0:0
	.functype	__main_argc_argv (i32, i32) -> (i32)
	.local  	i32, i32, i32, i32, f64, i32, i32, i64
# %bb.0:
	global.get	__stack_pointer
	i32.const	64
	i32.sub 
	local.tee	2
	global.set	__stack_pointer
.Ltmp0:
	global.get	__memory_base
	local.tee	3
	i32.const	$ss23_ContiguousArrayStorageCy4main5Shape_pGMD@MBREL
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledName
	i32.const	56
	i32.const	3
	call	swift_allocObject
	local.tee	4
	i64.const	17179869186
.Ltmp1:
	i64.store	8:p2align=2
.Ltmp2:
	.loc	1 1 24 prologue_end             # /workspace/main.swift:1:24
	global.get	$s4main6CircleVAA5ShapeAAWP@GOT
	local.set	5
	f64.const	0x1p0
	local.get	2
	local.get	2
	call	$s4main6CircleV6radiusACSd_tcfC
	local.set	6
	local.get	4
	local.get	5
	i32.store	32
	local.get	4
	global.get	$s4main6CircleVN@GOT
	i32.store	28
	local.get	3
	i32.const	.Lmetadata@MBREL
	i32.add 
	i32.const	8
	i32.add 
	local.tee	5
	i32.const	16
	i32.const	7
	call	swift_allocObject
	local.tee	7
	local.get	6
	f64.store	8
	local.get	4
	local.get	7
	i32.store	16
	.loc	1 1 43 is_stmt 0                # /workspace/main.swift:1:43
	global.get	$s4main6SquareVAA5ShapeAAWP@GOT
	local.set	7
	f64.const	0x1p1
	local.get	2
	local.get	2
	call	$s4main6SquareV4sideACSd_tcfC
	local.set	6
	local.get	4
	local.get	7
	i32.store	52
	local.get	4
	global.get	$s4main6SquareVN@GOT
	i32.store	48
	local.get	5
	i32.const	16
	i32.const	7
	call	swift_allocObject
	local.tee	5
	local.get	6
	f64.store	8
	local.get	4
	local.get	5
	i32.store	36
	.loc	1 1 23                          # /workspace/main.swift:1:23
	local.get	3
	i32.const	$s4main6shapesSayAA5Shape_pGvp@MBREL
	i32.add 
	local.get	4
	i32.store	0
	.loc	1 2 13 is_stmt 1                # /workspace/main.swift:2:13
	local.get	3
	i32.const	$s4main5totalSdvp@MBREL
	i32.add 
	local.tee	5
	i64.const	0
	i64.store	0
	.file	2 "/" "<compiler-generated>"
	.loc	2 0 0 is_stmt 0                 # <compiler-generated>:0
	local.get	4
	call	swift_retain
	local.set	7
.Ltmp3:
	local.get	5
	local.get	2
	i32.const	32
	i32.add 
	i32.const	1
	i32.const	0
	call	swift_beginAccess
	local.get	4
	i32.const	16
.Ltmp4:
	.loc	1 1 23 is_stmt 1                # /workspace/main.swift:1:23
	i32.add 
.Ltmp5:
	.loc	2 0 0 is_stmt 0                 # <compiler-generated>:0 @[ <compiler-generated>:0 @[ <compiler-generated>:0 @[ <compiler-generated>:0 @[ /workspace/main.swift:3:1 ] ] ] ]
	local.get	2
	i32.const	44
	i32.add 
	call	$s4main5Shape_pWOc
	drop
.Ltmp6:
	.loc	1 3 21 is_stmt 1                # /workspace/main.swift:3:21
	local.get	2
	i32.const	44
	i32.add 
	local.get	2
	i32.const	8
	i32.add 
	call	$s4main5Shape_pWOb
	drop
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	local.get	2
	i32.load	24
	local.set	4
	local.get	5
	local.get	2
	i32.const	8
	i32.add 
	local.get	2
	i32.load	20
	local.tee	8
	call	__swift_project_boxed_opaque_existential_1
	.loc	1 4 20 is_stmt 1                # /workspace/main.swift:4:20
	local.get	8
	local.get	4
	local.get	2
	local.get	4
	i32.load	4
	call_indirect	 __indirect_function_table, (i32, i32, i32, i32) -> (f64)
	.loc	1 4 11 is_stmt 0                # /workspace/main.swift:4:11
	local.get	5
	f64.load	0
	f64.add 
	f64.store	0
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	2
	i32.const	8
	i32.add 
	call	__swift_destroy_boxed_opaque_existential_1
	local.get	7
	i32.const	36
.Ltmp7:
	i32.add 
	local.get	2
	i32.const	44
	i32.add 
	call	$s4main5Shape_pWOc
	drop
.Ltmp8:
	.loc	1 3 21 is_stmt 1                # /workspace/main.swift:3:21
	local.get	2
	i32.const	44
	i32.add 
	local.get	2
	i32.const	8
	i32.add 
	call	$s4main5Shape_pWOb
	drop
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	local.get	2
	i32.load	24
	local.set	4
	local.get	5
	local.get	2
	i32.const	8
	i32.add 
	local.get	2
	i32.load	20
	local.tee	8
	call	__swift_project_boxed_opaque_existential_1
	.loc	1 4 20 is_stmt 1                # /workspace/main.swift:4:20
	local.get	8
	local.get	4
	local.get	2
	local.get	4
	i32.load	4
	call_indirect	 __indirect_function_table, (i32, i32, i32, i32) -> (f64)
	.loc	1 4 11 is_stmt 0                # /workspace/main.swift:4:11
	local.get	5
	f64.load	0
	f64.add 
	f64.store	0
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	2
	i32.const	8
	i32.add 
	call	__swift_destroy_boxed_opaque_existential_1
	local.get	7
	call	swift_release
.Ltmp9:
	local.get	3
	i32.const	$ss23_ContiguousArrayStorageCyypGMD@MBREL
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledName
	local.tee	7
	i32.const	32
	i32.const	3
	call	swift_allocObject
	local.tee	4
	i64.const	8589934593
.Ltmp10:
	i64.store	8:p2align=2
.Ltmp11:
	local.get	2
	i32.const	8
	i32.add 
	i32.const	8
	i32.add 
	local.tee	8
	i32.const	57344
	i32.store	0
	local.get	2
	i64.const	0
	i64.store	8
	i32.const	13
	local.get	2
	i32.const	8
	i32.add 
	local.get	2
	call	$ss11_StringGutsV4growyySiF
	local.get	2
	local.get	8
	i32.load	0
.Ltmp12:
	.loc	1 6 7 is_stmt 1                 # /workspace/main.swift:6:7
	i32.store	52
.Ltmp13:
	.loc	2 0 0 is_stmt 0                 # <compiler-generated>:0 @[ <compiler-generated>:0 @[ /workspace/main.swift:6:7 ] ]
	local.get	2
	local.get	2
	i64.load	8
.Ltmp14:
	.loc	1 6 7                           # /workspace/main.swift:6:7
	i64.store	44:p2align=2
	i32.const	11
.Ltmp15:
	.loc	2 0 0                           # <compiler-generated>:0 @[ /workspace/main.swift:6:8 ]
	local.get	3
	i32.const	".L.str.11.total area "@MBREL
	i32.add 
	i32.const	-20
	i32.add 
	i32.const	-805273600
	local.get	2
	i32.const	44
	i32.add 
	local.get	2
	call	$sSS6appendyySSF
.Ltmp16:
	.loc	1 6 21                          # /workspace/main.swift:6:21
	local.get	5
	local.get	2
	i32.const	8
	i32.add 
	i32.const	0
	i32.const	0
	call	swift_beginAccess
	local.get	5
	f64.load	0
	local.set	6
.Ltmp17:
	.loc	2 0 0                           # <compiler-generated>:0 @[ <compiler-generated>:0 @[ /workspace/main.swift:6:20 ] ]
	global.get	$ss26DefaultStringInterpolationVs16TextOutputStreamsWP@GOT
	local.set	5
	local.get	2
	i32.const	44
	i32.add 
	local.get	6
	global.get	$ss26DefaultStringInterpolationVN@GOT
	local.get	5
	local.get	2
	local.get	2
	call	$sSd5write2toyxz_ts16TextOutputStreamRzlF
.Ltmp18:
	local.get	2
	i64.load	44:p2align=2
	local.set	9
	local.get	4
	local.get	2
	i32.load	52
	.loc	1 6 7                           # /workspace/main.swift:6:7
	i32.store	24
	local.get	4
	local.get	9
	i64.store	16:p2align=2
	local.get	4
	global.get	$sSSN@GOT
	i32.store	28
	local.get	4
	i32.const	32
	i32.const	0
	i32.const	57600
	i32.const	10
	i32.const	0
	i32.const	57600
	.loc	1 6 1                           # /workspace/main.swift:6:1
	local.get	2
	local.get	2
	call	$ss5print_9separator10terminatoryypd_S2StF
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	4
	call	swift_release
	local.get	7
	i32.const	32
	i32.const	3
.Ltmp19:
	call	swift_allocObject
	local.tee	4
	i64.const	8589934593
.Ltmp20:
	i64.store	8:p2align=2
	local.get	4
	i32.const	7
.Ltmp21:
	.loc	1 7 7 is_stmt 1                 # /workspace/main.swift:7:7
	local.get	2
	local.get	2
	call	$s4main6squareyS2iF
	i32.store	16
	local.get	4
	global.get	$sSiN@GOT
	i32.store	28
	local.get	4
	i32.const	32
	i32.const	0
	i32.const	57600
	i32.const	10
	i32.const	0
	i32.const	57600
	.loc	1 7 1 is_stmt 0                 # /workspace/main.swift:7:1
	local.get	2
	local.get	2
	call	$ss5print_9separator10terminatoryypd_S2StF
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	4
	call	swift_release
	local.get	2
	i32.const	64
	i32.add 
	global.set	__stack_pointer
	i32.const	0
                                        # fallthrough-return
	end_function
.Ltmp22:
.Lfunc_end0:
                                        # -- End function
	.section	.text.__swift_instantiateConcreteTypeFromMangledName,"G",@,__swift_instantiateConcreteTypeFromMangledName,comdat
	.hidden	__swift_instantiateConcreteTypeFromMangledName # -- Begin function __swift_instantiateConcreteTypeFromMangledName
	.weak	__swift_instantiateConcreteTypeFromMangledName
	.type	__swift_instantiateConcreteTypeFromMangledName,@function
__swift_instantiateConcreteTypeFromMangledName: # @__swift_instantiateConcreteTypeFromMangledName
.Lfunc_begin1:
	.loc	2 0 0 is_stmt 1                 # <compiler-generated>:0:0
	.functype	__swift_instantiateConcreteTypeFromMangledName (i32) -> (i32)
	.local  	i64
# %bb.0:
	block   	
	local.get	0
	i64.load	0
	local.tee	1
	i64.const	0
	i64.ge_s
	br_if   	0                               # 0: down to label0
# %bb.1:
	local.get	0
	local.get	1
	i32.wrap_i64
	local.get	0
	i32.add 
	i32.const	0
	local.get	1
	i64.const	32
	i64.shr_u
	i32.wrap_i64
	i32.sub 
	i32.const	0
	i32.const	0
	local.get	0
	local.get	0
	call	swift_getTypeByMangledNameInContext2
	i64.extend_i32_u
	local.tee	1
	i64.store	0
.LBB1_2:
	end_block                               # label0:
	local.get	1
	i32.wrap_i64
                                        # fallthrough-return
	end_function
.Ltmp23:
.Lfunc_end1:
                                        # -- End function
	.section	.text..Lobjectdestroy,"",@
	.type	.Lobjectdestroy,@function       # -- Begin function objectdestroy
.Lobjectdestroy:                        # @objectdestroy
.Lfunc_begin2:
	.functype	.Lobjectdestroy (i32, i32) -> ()
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	local.get	0
	i32.const	16
	i32.const	7
.Ltmp24:
	call	swift_deallocObject
                                        # fallthrough-return
	end_function
.Ltmp25:
.Lfunc_end2:
                                        # -- End function
	.section	".text.$s4main5Shape_pWOc","G",@,"$s4main5Shape_pWOc",comdat
	.hidden	$s4main5Shape_pWOc              # -- Begin function $s4main5Shape_pWOc
	.weak	$s4main5Shape_pWOc
	.type	$s4main5Shape_pWOc,@function
$s4main5Shape_pWOc:                     # @"$s4main5Shape_pWOc"
.Lfunc_begin3:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$s4main5Shape_pWOc (i32, i32) -> (i32)
	.local  	i32
# %bb.0:
	local.get	1
	local.get	0
	i32.load	12
	local.tee	2
	i32.store	12
	local.get	1
	local.get	0
	i32.load	16
	i32.store	16
	local.get	1
	local.get	0
	local.get	2
	local.get	2
	i32.const	-4
	i32.add 
	i32.load	0
	i32.load	0
	call_indirect	 __indirect_function_table, (i32, i32, i32) -> (i32)
	drop
	local.get	1
                                        # fallthrough-return
	end_function
.Ltmp26:
.Lfunc_end3:
                                        # -- End function
	.section	".text.$s4main5Shape_pWOb","G",@,"$s4main5Shape_pWOb",comdat
	.hidden	$s4main5Shape_pWOb              # -- Begin function $s4main5Shape_pWOb
	.weak	$s4main5Shape_pWOb
	.type	$s4main5Shape_pWOb,@function
$s4main5Shape_pWOb:                     # @"$s4main5Shape_pWOb"
.Lfunc_begin4:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$s4main5Shape_pWOb (i32, i32) -> (i32)
# %bb.0:
	local.get	1
	local.get	0
	i64.load	0:p2align=2
	i64.store	0:p2align=2
	local.get	1
	i32.const	16
	i32.add 
	local.get	0
	i32.const	16
	i32.add 
	i32.load	0
	i32.store	0
	local.get	1
	i32.const	8
	i32.add 
	local.get	0
	i32.const	8
	i32.add 
	i64.load	0:p2align=2
	i64.store	0:p2align=2
	local.get	1
                                        # fallthrough-return
	end_function
.Ltmp27:
.Lfunc_end4:
                                        # -- End function
	.section	.text.__swift_project_boxed_opaque_existential_1,"G",@,__swift_project_boxed_opaque_existential_1,comdat
	.hidden	__swift_project_boxed_opaque_existential_1 # -- Begin function __swift_project_boxed_opaque_existential_1
	.weak	__swift_project_boxed_opaque_existential_1
	.type	__swift_project_boxed_opaque_existential_1,@function
__swift_project_boxed_opaque_existential_1: # @__swift_project_boxed_opaque_existential_1
.Lfunc_begin5:
	.functype	__swift_project_boxed_opaque_existential_1 (i32, i32) -> (i32)
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	block   	
	local.get	1
	i32.const	-4
.Ltmp28:
	i32.add 
	i32.load	0
	i32.load	40
	local.tee	1
	i32.const	131072
	i32.and 
	i32.eqz
	br_if   	0                               # 0: down to label1
# %bb.1:
	local.get	0
	i32.load	0
	local.get	1
	i32.const	255
	i32.and 
	local.tee	0
	i32.const	8
	i32.add 
	local.get	0
	i32.const	-1
	i32.xor 
	i32.and 
	i32.add 
	local.set	0
.LBB5_2:
	end_block                               # label1:
	local.get	0
                                        # fallthrough-return
	end_function
.Ltmp29:
.Lfunc_end5:
                                        # -- End function
	.section	.text.__swift_destroy_boxed_opaque_existential_1,"G",@,__swift_destroy_boxed_opaque_existential_1,comdat
	.hidden	__swift_destroy_boxed_opaque_existential_1 # -- Begin function __swift_destroy_boxed_opaque_existential_1
	.weak	__swift_destroy_boxed_opaque_existential_1
	.type	__swift_destroy_boxed_opaque_existential_1,@function
__swift_destroy_boxed_opaque_existential_1: # @__swift_destroy_boxed_opaque_existential_1
.Lfunc_begin6:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	__swift_destroy_boxed_opaque_existential_1 (i32) -> ()
	.local  	i32, i32
# %bb.0:
	block   	
	local.get	0
	i32.load	12
	local.tee	1
	i32.const	-4
	i32.add 
	i32.load	0
	local.tee	2
	i32.load8_u	42
	i32.const	2
	i32.and 
	br_if   	0                               # 0: down to label2
# %bb.1:
	local.get	0
	local.get	1
	local.get	2
	i32.load	4
	call_indirect	 __indirect_function_table, (i32, i32) -> ()
	return
.LBB6_2:
	end_block                               # label2:
	local.get	0
	i32.load	0
	call	swift_release
                                        # fallthrough-return
	end_function
.Ltmp30:
.Lfunc_end6:
                                        # -- End function
	.hidden	$s4main6shapesSayAA5Shape_pGvp  # @"$s4main6shapesSayAA5Shape_pGvp"
	.type	$s4main6shapesSayAA5Shape_pGvp,@object
	.section	".bss.$s4main6shapesSayAA5Shape_pGvp","",@
	.globl	$s4main6shapesSayAA5Shape_pGvp
	.p2align	2, 0x0
$s4main6shapesSayAA5Shape_pGvp:
	.skip	4
	.size	$s4main6shapesSayAA5Shape_pGvp, 4

	.hidden	$s4main5totalSdvp               # @"$s4main5totalSdvp"
	.type	$s4main5totalSdvp,@object
	.section	".bss.$s4main5totalSdvp","",@
	.globl	$s4main5totalSdvp
	.p2align	3, 0x0
$s4main5totalSdvp:
	.skip	8
	.size	$s4main5totalSdvp, 8

	.type	.Lgot.$ss23_ContiguousArrayStorageCMn,@object # @"got.$ss23_ContiguousArrayStorageCMn"
	.section	".data.rel.ro..Lgot.$ss23_ContiguousArrayStorageCMn","",@
	.p2align	2, 0x0
.Lgot.$ss23_ContiguousArrayStorageCMn:
	.int32	$ss23_ContiguousArrayStorageCMn
	.size	.Lgot.$ss23_ContiguousArrayStorageCMn, 4

	.type	.Lgot.$s4main5ShapeMp,@object   # @"got.$s4main5ShapeMp"
	.section	".data.rel.ro..Lgot.$s4main5ShapeMp","",@
	.p2align	2, 0x0
.Lgot.$s4main5ShapeMp:
	.int32	$s4main5ShapeMp
	.size	.Lgot.$s4main5ShapeMp, 4

	.hidden	"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP" # @"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP"
	.type	"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP",@object
	.section	swift5_typeref,"G",@,"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP",comdat
	.weak	"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP"
	.p2align	1, 0x0
"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP":
	.int8	2                               # 0x2
	.int32	.Lgot.$ss23_ContiguousArrayStorageCMn-"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP"-1
	.int8	121
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main5ShapeMp-"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP"-7
	.ascii	"_pG"
	.int8	0                               # 0x0
	.size	"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP", 15

	.hidden	$ss23_ContiguousArrayStorageCy4main5Shape_pGMD # @"$ss23_ContiguousArrayStorageCy4main5Shape_pGMD"
	.type	$ss23_ContiguousArrayStorageCy4main5Shape_pGMD,@object
	.section	".data.$ss23_ContiguousArrayStorageCy4main5Shape_pGMD","G",@,"$ss23_ContiguousArrayStorageCy4main5Shape_pGMD",comdat
	.weak	$ss23_ContiguousArrayStorageCy4main5Shape_pGMD
	.p2align	3, 0x0
$ss23_ContiguousArrayStorageCy4main5Shape_pGMD:
	.int32	"symbolic _____y______pG s23_ContiguousArrayStorageC 4main5ShapeP"-$ss23_ContiguousArrayStorageCy4main5Shape_pGMD
	.int32	4294967282                      # 0xfffffff2
	.size	$ss23_ContiguousArrayStorageCy4main5Shape_pGMD, 8

	.type	.Lgot.$s4main6CircleVMn,@object # @"got.$s4main6CircleVMn"
	.section	".data.rel.ro..Lgot.$s4main6CircleVMn","",@
	.p2align	2, 0x0
.Lgot.$s4main6CircleVMn:
	.int32	$s4main6CircleVMn
	.size	.Lgot.$s4main6CircleVMn, 4

	.hidden	"symbolic _____ 4main6CircleV"  # @"symbolic _____ 4main6CircleV"
	.type	"symbolic _____ 4main6CircleV",@object
	.section	swift5_typeref,"G",@,"symbolic _____ 4main6CircleV",comdat
	.weak	"symbolic _____ 4main6CircleV"
	.p2align	1, 0x0
"symbolic _____ 4main6CircleV":
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main6CircleVMn-"symbolic _____ 4main6CircleV"-1
	.int8	0                               # 0x0
	.size	"symbolic _____ 4main6CircleV", 6

	.type	l__swift5_reflection_descriptor,@object # @"\01l__swift5_reflection_descriptor"
	.section	swift5_capture,"R",@
	.p2align	2, 0x0
l__swift5_reflection_descriptor:
	.int32	1                               # 0x1
	.int32	0                               # 0x0
	.int32	0                               # 0x0
	.int32	"symbolic _____ 4main6CircleV"-l__swift5_reflection_descriptor-12
	.size	l__swift5_reflection_descriptor, 16

	.type	.Lmetadata,@object              # @metadata
	.section	.data.rel.ro..Lmetadata,"",@
	.p2align	2, 0x0
.Lmetadata:
	.int32	.Lobjectdestroy
	.int32	0
	.int32	1024                            # 0x400
	.int32	8                               # 0x8
	.int32	l__swift5_reflection_descriptor
	.size	.Lmetadata, 20

	.type	.Lgot.$s4main6SquareVMn,@object # @"got.$s4main6SquareVMn"
	.section	".data.rel.ro..Lgot.$s4main6SquareVMn","",@
	.p2align	2, 0x0
.Lgot.$s4main6SquareVMn:
	.int32	$s4main6SquareVMn
	.size	.Lgot.$s4main6SquareVMn, 4

	.hidden	"symbolic _____ 4main6SquareV"  # @"symbolic _____ 4main6SquareV"
	.type	"symbolic _____ 4main6SquareV",@object
	.section	swift5_typeref,"G",@,"symbolic _____ 4main6SquareV",comdat
	.weak	"symbolic _____ 4main6SquareV"
	.p2align	1, 0x0
"symbolic _____ 4main6SquareV":
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main6SquareVMn-"symbolic _____ 4main6SquareV"-1
	.int8	0                               # 0x0
	.size	"symbolic _____ 4main6SquareV", 6

	.type	l__swift5_reflection_descriptor.1,@object # @"\01l__swift5_reflection_descriptor.1"
	.section	swift5_capture,"R",@
	.p2align	2, 0x0
l__swift5_reflection_descriptor.1:
	.int32	1                               # 0x1
	.int32	0                               # 0x0
	.int32	0                               # 0x0
	.int32	"symbolic _____ 4main6SquareV"-l__swift5_reflection_descriptor.1-12
	.size	l__swift5_reflection_descriptor.1, 16

	.hidden	"symbolic _____yypG s23_ContiguousArrayStorageC" # @"symbolic _____yypG s23_ContiguousArrayStorageC"
	.type	"symbolic _____yypG s23_ContiguousArrayStorageC",@object
	.section	swift5_typeref,"G",@,"symbolic _____yypG s23_ContiguousArrayStorageC",comdat
	.weak	"symbolic _____yypG s23_ContiguousArrayStorageC"
	.p2align	1, 0x0
"symbolic _____yypG s23_ContiguousArrayStorageC":
	.int8	2                               # 0x2
	.int32	.Lgot.$ss23_ContiguousArrayStorageCMn-"symbolic _____yypG s23_ContiguousArrayStorageC"-1
	.ascii	"yypG"
	.int8	0                               # 0x0
	.size	"symbolic _____yypG s23_ContiguousArrayStorageC", 10

	.hidden	$ss23_ContiguousArrayStorageCyypGMD # @"$ss23_ContiguousArrayStorageCyypGMD"
	.type	$ss23_ContiguousArrayStorageCyypGMD,@object
	.section	".data.$ss23_ContiguousArrayStorageCyypGMD","G",@,"$ss23_ContiguousArrayStorageCyypGMD",comdat
	.weak	$ss23_ContiguousArrayStorageCyypGMD
	.p2align	3, 0x0
$ss23_ContiguousArrayStorageCyypGMD:
	.int32	"symbolic _____yypG s23_ContiguousArrayStorageC"-$ss23_ContiguousArrayStorageCyypGMD
	.int32	4294967287                      # 0xfffffff7
	.size	$ss23_ContiguousArrayStorageCyypGMD, 8

	.type	".L.str.11.total area ",@object # @".str.11.total area "
	.section	".rodata..L.str.11.total area ","S",@
".L.str.11.total area ":
	.asciz	"total area "
	.size	".L.str.11.total area ", 12

	.type	l_entry_point,@object           # @"\01l_entry_point"
	.section	swift5_entry,"R",@
	.p2align	2, 0x0
l_entry_point:
	.int32	__main_argc_argv
	.int32	0                               # 0x0
	.size	l_entry_point, 8

	.hidden	__swift_reflection_version      # @__swift_reflection_version
	.type	__swift_reflection_version,@object
	.section	.rodata.__swift_reflection_version,"GR",@,__swift_reflection_version,comdat
	.weak	__swift_reflection_version
	.p2align	1, 0x0
__swift_reflection_version:
	.int16	3                               # 0x3
	.size	__swift_reflection_version, 2

	.type	.L_swift1_autolink_entries,@object # @_swift1_autolink_entries
	.section	.swift1_autolink_entries,"R",@
	.p2align	2, 0x0
.L_swift1_autolink_entries:
	.asciz	"-lswift_Concurrency\000-lswiftCore\000-lswift_StringProcessing\000-lswift_RegexParser"
	.size	.L_swift1_autolink_entries, 77

	.no_dead_strip	l__swift5_reflection_descriptor
	.no_dead_strip	l__swift5_reflection_descriptor.1
	.no_dead_strip	l_entry_point
	.no_dead_strip	__main_argc_argv
	.no_dead_strip	__swift_reflection_version
	.no_dead_strip	.L_swift1_autolink_entries
	.section	.debug_abbrev,"",@
	.int8	1                               # Abbreviation Code
	.int8	17                              # DW_TAG_compile_unit
	.int8	1                               # DW_CHILDREN_yes
	.int8	37                              # DW_AT_producer
	.int8	14                              # DW_FORM_strp
	.int8	19                              # DW_AT_language
	.int8	5                               # DW_FORM_data2
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.ascii	"\202|"                         # DW_AT_LLVM_sysroot
	.int8	14                              # DW_FORM_strp
	.int8	16                              # DW_AT_stmt_list
	.int8	23                              # DW_FORM_sec_offset
	.int8	27                              # DW_AT_comp_dir
	.int8	14                              # DW_FORM_strp
	.ascii	"\341\177"                      # DW_AT_APPLE_optimized
	.int8	25                              # DW_FORM_flag_present
	.ascii	"\345\177"                      # DW_AT_APPLE_major_runtime_vers
	.int8	11                              # DW_FORM_data1
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	85                              # DW_AT_ranges
	.int8	23                              # DW_FORM_sec_offset
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	2                               # Abbreviation Code
	.int8	46                              # DW_TAG_subprogram
	.int8	0                               # DW_CHILDREN_no
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.int8	32                              # DW_AT_inline
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	3                               # Abbreviation Code
	.int8	46                              # DW_TAG_subprogram
	.int8	0                               # DW_CHILDREN_no
	.int8	32                              # DW_AT_inline
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	4                               # Abbreviation Code
	.int8	46                              # DW_TAG_subprogram
	.int8	1                               # DW_CHILDREN_yes
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	18                              # DW_AT_high_pc
	.int8	6                               # DW_FORM_data4
	.ascii	"\347\177"                      # DW_AT_APPLE_omit_frame_ptr
	.int8	25                              # DW_FORM_flag_present
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	5                               # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	1                               # DW_CHILDREN_yes
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	18                              # DW_AT_high_pc
	.int8	6                               # DW_FORM_data4
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	87                              # DW_AT_call_column
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	6                               # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	0                               # DW_CHILDREN_no
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	18                              # DW_AT_high_pc
	.int8	6                               # DW_FORM_data4
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	7                               # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	1                               # DW_CHILDREN_yes
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	85                              # DW_AT_ranges
	.int8	23                              # DW_FORM_sec_offset
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	87                              # DW_AT_call_column
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	8                               # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	1                               # DW_CHILDREN_yes
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	85                              # DW_AT_ranges
	.int8	23                              # DW_FORM_sec_offset
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	9                               # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	0                               # DW_CHILDREN_no
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	85                              # DW_AT_ranges
	.int8	23                              # DW_FORM_sec_offset
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	10                              # Abbreviation Code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	0                               # DW_CHILDREN_no
	.int8	49                              # DW_AT_abstract_origin
	.int8	19                              # DW_FORM_ref4
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	18                              # DW_AT_high_pc
	.int8	6                               # DW_FORM_data4
	.int8	88                              # DW_AT_call_file
	.int8	11                              # DW_FORM_data1
	.int8	89                              # DW_AT_call_line
	.int8	11                              # DW_FORM_data1
	.int8	87                              # DW_AT_call_column
	.int8	11                              # DW_FORM_data1
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	11                              # Abbreviation Code
	.int8	30                              # DW_TAG_module
	.int8	0                               # DW_CHILDREN_no
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.ascii	"\200|"                         # DW_AT_LLVM_include_path
	.int8	14                              # DW_FORM_strp
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	12                              # Abbreviation Code
	.int8	58                              # DW_TAG_imported_module
	.int8	0                               # DW_CHILDREN_no
	.int8	24                              # DW_AT_import
	.int8	19                              # DW_FORM_ref4
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	13                              # Abbreviation Code
	.int8	17                              # DW_TAG_compile_unit
	.int8	0                               # DW_CHILDREN_no
	.int8	37                              # DW_AT_producer
	.int8	14                              # DW_FORM_strp
	.int8	19                              # DW_AT_language
	.int8	5                               # DW_FORM_data2
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.int8	16                              # DW_AT_stmt_list
	.int8	23                              # DW_FORM_sec_offset
	.int8	27                              # DW_AT_comp_dir
	.int8	14                              # DW_FORM_strp
	.ascii	"\341\177"                      # DW_AT_APPLE_optimized
	.int8	25                              # DW_FORM_flag_present
	.ascii	"\261B"                         # DW_AT_GNU_dwo_id
	.int8	7                               # DW_FORM_data8
	.ascii	"\260B"                         # DW_AT_GNU_dwo_name
	.int8	14                              # DW_FORM_strp
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	0                               # EOM(3)
	.section	.debug_info,"",@
.Lcu_begin0:
	.int32	.Ldebug_info_end0-.Ldebug_info_start0 # Length of Unit
.Ldebug_info_start0:
	.int16	4                               # DWARF version number
	.int32	.debug_abbrev0                  # Offset Into Abbrev. Section
	.int8	4                               # Address Size (in bytes)
	.int8	1                               # Abbrev [1] 0xb:0x17f DW_TAG_compile_unit
	.int32	.Linfo_string0                  # DW_AT_producer
	.int16	30                              # DW_AT_language
	.int32	.Linfo_string1                  # DW_AT_name
	.int32	.Linfo_string2                  # DW_AT_LLVM_sysroot
	.int32	.Lline_table_start0             # DW_AT_stmt_list
	.int32	.Linfo_string3                  # DW_AT_comp_dir
                                        # DW_AT_APPLE_optimized
	.int8	6                               # DW_AT_APPLE_major_runtime_vers
	.int32	0                               # DW_AT_low_pc
	.int32	.Ldebug_ranges3                 # DW_AT_ranges
	.int8	2                               # Abbrev [2] 0x2b:0x6 DW_TAG_subprogram
	.int32	.Linfo_string4                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x31:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	2                               # Abbrev [2] 0x33:0x6 DW_TAG_subprogram
	.int32	.Linfo_string5                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x39:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x3b:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x3d:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	2                               # Abbrev [2] 0x3f:0x6 DW_TAG_subprogram
	.int32	.Linfo_string4                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x45:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x47:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	2                               # Abbrev [2] 0x49:0x6 DW_TAG_subprogram
	.int32	.Linfo_string6                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	2                               # Abbrev [2] 0x4f:0x6 DW_TAG_subprogram
	.int32	.Linfo_string7                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	3                               # Abbrev [3] 0x55:0x2 DW_TAG_subprogram
	.int8	1                               # DW_AT_inline
	.int8	2                               # Abbrev [2] 0x57:0x6 DW_TAG_subprogram
	.int32	.Linfo_string8                  # DW_AT_name
	.int8	1                               # DW_AT_inline
	.int8	4                               # Abbrev [4] 0x5d:0xe6 DW_TAG_subprogram
	.int32	.Lfunc_begin0                   # DW_AT_low_pc
	.int32	.Lfunc_end0-.Lfunc_begin0       # DW_AT_high_pc
                                        # DW_AT_APPLE_omit_frame_ptr
	.int32	.Linfo_string9                  # DW_AT_name
	.int8	5                               # Abbrev [5] 0x6a:0x20 DW_TAG_inlined_subroutine
	.int32	43                              # DW_AT_abstract_origin
	.int32	.Ltmp0                          # DW_AT_low_pc
	.int32	.Ltmp2-.Ltmp0                   # DW_AT_high_pc
	.int8	1                               # DW_AT_call_file
	.int8	1                               # DW_AT_call_line
	.int8	23                              # DW_AT_call_column
	.int8	6                               # Abbrev [6] 0x7a:0xf DW_TAG_inlined_subroutine
	.int32	49                              # DW_AT_abstract_origin
	.int32	.Ltmp1                          # DW_AT_low_pc
	.int32	.Ltmp2-.Ltmp1                   # DW_AT_high_pc
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	7                               # Abbrev [7] 0x8a:0x30 DW_TAG_inlined_subroutine
	.int32	51                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges0                 # DW_AT_ranges
	.int8	1                               # DW_AT_call_file
	.int8	3                               # DW_AT_call_line
	.int8	1                               # DW_AT_call_column
	.int8	8                               # Abbrev [8] 0x96:0x23 DW_TAG_inlined_subroutine
	.int32	61                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges1                 # DW_AT_ranges
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	8                               # Abbrev [8] 0xa1:0x17 DW_TAG_inlined_subroutine
	.int32	59                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges1                 # DW_AT_ranges
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	9                               # Abbrev [9] 0xac:0xb DW_TAG_inlined_subroutine
	.int32	57                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges1                 # DW_AT_ranges
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	0                               # End Of Children Mark
	.int8	0                               # End Of Children Mark
	.int8	5                               # Abbrev [5] 0xba:0x20 DW_TAG_inlined_subroutine
	.int32	63                              # DW_AT_abstract_origin
	.int32	.Ltmp9                          # DW_AT_low_pc
	.int32	.Ltmp11-.Ltmp9                  # DW_AT_high_pc
	.int8	1                               # DW_AT_call_file
	.int8	6                               # DW_AT_call_line
	.int8	7                               # DW_AT_call_column
	.int8	6                               # Abbrev [6] 0xca:0xf DW_TAG_inlined_subroutine
	.int32	69                              # DW_AT_abstract_origin
	.int32	.Ltmp10                         # DW_AT_low_pc
	.int32	.Ltmp11-.Ltmp10                 # DW_AT_high_pc
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	7                               # Abbrev [7] 0xda:0x18 DW_TAG_inlined_subroutine
	.int32	73                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges2                 # DW_AT_ranges
	.int8	1                               # DW_AT_call_file
	.int8	6                               # DW_AT_call_line
	.int8	7                               # DW_AT_call_column
	.int8	9                               # Abbrev [9] 0xe6:0xb DW_TAG_inlined_subroutine
	.int32	71                              # DW_AT_abstract_origin
	.int32	.Ldebug_ranges2                 # DW_AT_ranges
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	10                              # Abbrev [10] 0xf2:0x10 DW_TAG_inlined_subroutine
	.int32	79                              # DW_AT_abstract_origin
	.int32	.Ltmp15                         # DW_AT_low_pc
	.int32	.Ltmp16-.Ltmp15                 # DW_AT_high_pc
	.int8	1                               # DW_AT_call_file
	.int8	6                               # DW_AT_call_line
	.int8	8                               # DW_AT_call_column
	.int8	5                               # Abbrev [5] 0x102:0x20 DW_TAG_inlined_subroutine
	.int32	87                              # DW_AT_abstract_origin
	.int32	.Ltmp17                         # DW_AT_low_pc
	.int32	.Ltmp18-.Ltmp17                 # DW_AT_high_pc
	.int8	1                               # DW_AT_call_file
	.int8	6                               # DW_AT_call_line
	.int8	20                              # DW_AT_call_column
	.int8	6                               # Abbrev [6] 0x112:0xf DW_TAG_inlined_subroutine
	.int32	85                              # DW_AT_abstract_origin
	.int32	.Ltmp17                         # DW_AT_low_pc
	.int32	.Ltmp18-.Ltmp17                 # DW_AT_high_pc
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	5                               # Abbrev [5] 0x122:0x20 DW_TAG_inlined_subroutine
	.int32	63                              # DW_AT_abstract_origin
	.int32	.Ltmp19                         # DW_AT_low_pc
	.int32	.Ltmp21-.Ltmp19                 # DW_AT_high_pc
	.int8	1                               # DW_AT_call_file
	.int8	7                               # DW_AT_call_line
	.int8	7                               # DW_AT_call_column
	.int8	6                               # Abbrev [6] 0x132:0xf DW_TAG_inlined_subroutine
	.int32	69                              # DW_AT_abstract_origin
	.int32	.Ltmp20                         # DW_AT_low_pc
	.int32	.Ltmp21-.Ltmp20                 # DW_AT_high_pc
	.int8	2                               # DW_AT_call_file
	.int8	0                               # DW_AT_call_line
	.int8	0                               # End Of Children Mark
	.int8	0                               # End Of Children Mark
	.int8	11                              # Abbrev [11] 0x143:0x9 DW_TAG_module
	.int32	.Linfo_string23                 # DW_AT_name
	.int32	.Linfo_string24                 # DW_AT_LLVM_include_path
	.int8	12                              # Abbrev [12] 0x14c:0x5 DW_TAG_imported_module
	.int32	323                             # DW_AT_import
	.int8	11                              # Abbrev [11] 0x151:0x9 DW_TAG_module
	.int32	.Linfo_string25                 # DW_AT_name
	.int32	.Linfo_string26                 # DW_AT_LLVM_include_path
	.int8	12                              # Abbrev [12] 0x15a:0x5 DW_TAG_imported_module
	.int32	337                             # DW_AT_import
	.int8	11                              # Abbrev [11] 0x15f:0x9 DW_TAG_module
	.int32	.Linfo_string27                 # DW_AT_name
	.int32	.Linfo_string28                 # DW_AT_LLVM_include_path
	.int8	12                              # Abbrev [12] 0x168:0x5 DW_TAG_imported_module
	.int32	351                             # DW_AT_import
	.int8	11                              # Abbrev [11] 0x16d:0x9 DW_TAG_module
	.int32	.Linfo_string29                 # DW_AT_name
	.int32	.Linfo_string30                 # DW_AT_LLVM_include_path
	.int8	12                              # Abbrev [12] 0x176:0x5 DW_TAG_imported_module
	.int32	365                             # DW_AT_import
	.int8	11                              # Abbrev [11] 0x17b:0x9 DW_TAG_module
	.int32	.Linfo_string31                 # DW_AT_name
	.int32	.Linfo_string32                 # DW_AT_LLVM_include_path
	.int8	12                              # Abbrev [12] 0x184:0x5 DW_TAG_imported_module
	.int32	379                             # DW_AT_import
	.int8	0                               # End Of Children Mark
.Ldebug_info_end0:
.Lcu_begin1:
	.int32	.Ldebug_info_end1-.Ldebug_info_start1 # Length of Unit
.Ldebug_info_start1:
	.int16	4                               # DWARF version number
	.int32	.debug_abbrev0                  # Offset Into Abbrev. Section
	.int8	4                               # Address Size (in bytes)
	.int8	13                              # Abbrev [13] 0xb:0x1f DW_TAG_compile_unit
	.int32	.Linfo_string0                  # DW_AT_producer
	.int16	12                              # DW_AT_language
	.int32	.Linfo_string29                 # DW_AT_name
	.int32	.Lline_table_start0             # DW_AT_stmt_list
	.int32	.Linfo_string30                 # DW_AT_comp_dir
                                        # DW_AT_APPLE_optimized
	.int64	2996294089423176434             # DW_AT_GNU_dwo_id
	.int32	.Linfo_string33                 # DW_AT_GNU_dwo_name
.Ldebug_info_end1:
	.section	.debug_ranges,"",@
.Ldebug_ranges0:
	.int32	.Ltmp3
	.int32	.Ltmp4
	.int32	.Ltmp5
	.int32	.Ltmp6
	.int32	.Ltmp7
	.int32	.Ltmp8
	.int32	0
	.int32	0
.Ldebug_ranges1:
	.int32	.Ltmp5
	.int32	.Ltmp6
	.int32	.Ltmp7
	.int32	.Ltmp8
	.int32	0
	.int32	0
.Ldebug_ranges2:
	.int32	.Ltmp11
	.int32	.Ltmp12
	.int32	.Ltmp13
	.int32	.Ltmp14
	.int32	0
	.int32	0
.Ldebug_ranges3:
	.int32	.Lfunc_begin0
	.int32	.Lfunc_end0
	.int32	.Lfunc_begin1
	.int32	.Lfunc_end1
	.int32	.Lfunc_begin2
	.int32	.Lfunc_end2
	.int32	.Lfunc_begin3
	.int32	.Lfunc_end3
	.int32	.Lfunc_begin4
	.int32	.Lfunc_end4
	.int32	.Lfunc_begin5
	.int32	.Lfunc_end5
	.int32	.Lfunc_begin6
	.int32	.Lfunc_end6
	.int32	0
	.int32	0
	.section	.debug_str,"S",@
.Linfo_string0:
	.asciz	"Swift version 6.3.3 (swift-6.3.3-RELEASE)" # string offset=0
.Linfo_string1:
	.asciz	"/workspace/main.swift"         # string offset=42
.Linfo_string2:
	.asciz	"/sysroot/wasi-sysroot"         # string offset=64
.Linfo_string3:
	.asciz	"/"                             # string offset=86
.Linfo_string4:
	.asciz	"_allocateUninitializedArray"   # string offset=88
.Linfo_string5:
	.asciz	"next"                          # string offset=116
.Linfo_string6:
	.asciz	"init"                          # string offset=121
.Linfo_string7:
	.asciz	"appendLiteral"                 # string offset=126
.Linfo_string8:
	.asciz	"appendInterpolation"           # string offset=140
.Linfo_string9:
	.asciz	"__main_argc_argv"              # string offset=160
.Linfo_string10:
	.asciz	"$ss27_allocateUninitializedArrayySayxG_BptBwlF4main5Shape_p_Tg5" # string offset=177
.Linfo_string11:
	.asciz	"$sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZ4main5Shape_p_Tt1g5" # string offset=241
.Linfo_string12:
	.asciz	"$ss16IndexingIteratorV4next7ElementQzSgyFSay4main5Shape_pG_Tg5" # string offset=332
.Linfo_string13:
	.asciz	"$sSayxGSlsSly7ElementQz5IndexQzcirTW4main5Shape_p_Tg5" # string offset=395
.Linfo_string14:
	.asciz	"$sSayxSicir4main5Shape_p_Tg5"  # string offset=449
.Linfo_string15:
	.asciz	"$sSa11_getElement_20wasNativeTypeChecked22matchingSubscriptCheckxSi_Sbs16_DependenceTokenVtF4main5Shape_p_Tg5" # string offset=478
.Linfo_string16:
	.asciz	"$ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5" # string offset=588
.Linfo_string17:
	.asciz	"$sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZyp_Tt1g5" # string offset=641
.Linfo_string18:
	.asciz	"$ss26DefaultStringInterpolationV15literalCapacity18interpolationCountABSi_SitcfC" # string offset=721
.Linfo_string19:
	.asciz	"$sSS12_createEmpty19withInitialCapacitySSSi_tFZ" # string offset=802
.Linfo_string20:
	.asciz	"$ss26DefaultStringInterpolationV13appendLiteralyySSF" # string offset=850
.Linfo_string21:
	.asciz	"$ss26DefaultStringInterpolationV06appendC0yyxs06CustomB11ConvertibleRzs20TextOutputStreamableRzlFSd_Tg5" # string offset=903
.Linfo_string22:
	.asciz	"$sSds20TextOutputStreamablessAAP5write2toyqd__z_ts0aB6StreamRd__lFTWs26DefaultStringInterpolationV_Tg5" # string offset=1007
.Linfo_string23:
	.asciz	"main"                          # string offset=1110
.Linfo_string24:
	.asciz	"/workspace"                    # string offset=1115
.Linfo_string25:
	.asciz	"Swift"                         # string offset=1126
.Linfo_string26:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/Swift.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=1132
.Linfo_string27:
	.asciz	"_StringProcessing"             # string offset=1221
.Linfo_string28:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/_StringProcessing.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=1239
.Linfo_string29:
	.asciz	"_SwiftConcurrencyShims"        # string offset=1340
.Linfo_string30:
	.asciz	"/sysroot/swift/lib/swift_static/shims" # string offset=1363
.Linfo_string31:
	.asciz	"_Concurrency"                  # string offset=1401
.Linfo_string32:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/_Concurrency.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=1414
.Linfo_string33:
	.asciz	"/tmp/module-cache/3QVTNN1AAOJNU/_SwiftConcurrencyShims-31O3Y2F55MJEQ.pcm" # string offset=1510
	.section	.debug_names,"",@
	.int32	.Lnames_end0-.Lnames_start0     # Header: unit length
.Lnames_start0:
	.int16	5                               # Header: version
	.int16	0                               # Header: padding
	.int32	2                               # Header: compilation unit count
	.int32	0                               # Header: local type unit count
	.int32	0                               # Header: foreign type unit count
	.int32	9                               # Header: bucket count
	.int32	19                              # Header: name count
	.int32	.Lnames_abbrev_end0-.Lnames_abbrev_start0 # Header: abbreviation table size
	.int32	8                               # Header: augmentation string size
	.ascii	"LLVM0700"                      # Header: augmentation string
	.int32	.Lcu_begin0                     # Compilation unit 0
	.int32	.Lcu_begin1                     # Compilation unit 1
	.int32	1                               # Bucket 0
	.int32	4                               # Bucket 1
	.int32	0                               # Bucket 2
	.int32	8                               # Bucket 3
	.int32	9                               # Bucket 4
	.int32	13                              # Bucket 5
	.int32	14                              # Bucket 6
	.int32	17                              # Bucket 7
	.int32	18                              # Bucket 8
	.int32	1257731667                      # Hash in Bucket 0
	.int32	-1454585782                     # Hash in Bucket 0
	.int32	-803633791                      # Hash in Bucket 0
	.int32	1930112038                      # Hash in Bucket 1
	.int32	-1881027012                     # Hash in Bucket 1
	.int32	-1612709130                     # Hash in Bucket 1
	.int32	-91221051                       # Hash in Bucket 1
	.int32	940890936                       # Hash in Bucket 3
	.int32	1857131581                      # Hash in Bucket 4
	.int32	2090370361                      # Hash in Bucket 4
	.int32	2090540740                      # Hash in Bucket 4
	.int32	-1793300427                     # Hash in Bucket 4
	.int32	1295551706                      # Hash in Bucket 5
	.int32	584386683                       # Hash in Bucket 6
	.int32	1538979009                      # Hash in Bucket 6
	.int32	-184171039                      # Hash in Bucket 6
	.int32	-1566096936                     # Hash in Bucket 7
	.int32	1270345436                      # Hash in Bucket 8
	.int32	1440304262                      # Hash in Bucket 8
	.int32	.Linfo_string9                  # String in Bucket 0: __main_argc_argv
	.int32	.Linfo_string7                  # String in Bucket 0: appendLiteral
	.int32	.Linfo_string4                  # String in Bucket 0: _allocateUninitializedArray
	.int32	.Linfo_string10                 # String in Bucket 1: $ss27_allocateUninitializedArrayySayxG_BptBwlF4main5Shape_p_Tg5
	.int32	.Linfo_string21                 # String in Bucket 1: $ss26DefaultStringInterpolationV06appendC0yyxs06CustomB11ConvertibleRzs20TextOutputStreamableRzlFSd_Tg5
	.int32	.Linfo_string17                 # String in Bucket 1: $sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZyp_Tt1g5
	.int32	.Linfo_string8                  # String in Bucket 1: appendInterpolation
	.int32	.Linfo_string20                 # String in Bucket 3: $ss26DefaultStringInterpolationV13appendLiteralyySSF
	.int32	.Linfo_string15                 # String in Bucket 4: $sSa11_getElement_20wasNativeTypeChecked22matchingSubscriptCheckxSi_Sbs16_DependenceTokenVtF4main5Shape_p_Tg5
	.int32	.Linfo_string6                  # String in Bucket 4: init
	.int32	.Linfo_string5                  # String in Bucket 4: next
	.int32	.Linfo_string12                 # String in Bucket 4: $ss16IndexingIteratorV4next7ElementQzSgyFSay4main5Shape_pG_Tg5
	.int32	.Linfo_string19                 # String in Bucket 5: $sSS12_createEmpty19withInitialCapacitySSSi_tFZ
	.int32	.Linfo_string11                 # String in Bucket 6: $sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZ4main5Shape_p_Tt1g5
	.int32	.Linfo_string22                 # String in Bucket 6: $sSds20TextOutputStreamablessAAP5write2toyqd__z_ts0aB6StreamRd__lFTWs26DefaultStringInterpolationV_Tg5
	.int32	.Linfo_string16                 # String in Bucket 6: $ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5
	.int32	.Linfo_string14                 # String in Bucket 7: $sSayxSicir4main5Shape_p_Tg5
	.int32	.Linfo_string13                 # String in Bucket 8: $sSayxGSlsSly7ElementQz5IndexQzcirTW4main5Shape_p_Tg5
	.int32	.Linfo_string18                 # String in Bucket 8: $ss26DefaultStringInterpolationV15literalCapacity18interpolationCountABSi_SitcfC
	.int32	.Lnames0-.Lnames_entries0       # Offset in Bucket 0
	.int32	.Lnames14-.Lnames_entries0      # Offset in Bucket 0
	.int32	.Lnames1-.Lnames_entries0       # Offset in Bucket 0
	.int32	.Lnames2-.Lnames_entries0       # Offset in Bucket 1
	.int32	.Lnames17-.Lnames_entries0      # Offset in Bucket 1
	.int32	.Lnames10-.Lnames_entries0      # Offset in Bucket 1
	.int32	.Lnames16-.Lnames_entries0      # Offset in Bucket 1
	.int32	.Lnames15-.Lnames_entries0      # Offset in Bucket 3
	.int32	.Lnames8-.Lnames_entries0       # Offset in Bucket 4
	.int32	.Lnames11-.Lnames_entries0      # Offset in Bucket 4
	.int32	.Lnames4-.Lnames_entries0       # Offset in Bucket 4
	.int32	.Lnames5-.Lnames_entries0       # Offset in Bucket 4
	.int32	.Lnames13-.Lnames_entries0      # Offset in Bucket 5
	.int32	.Lnames3-.Lnames_entries0       # Offset in Bucket 6
	.int32	.Lnames18-.Lnames_entries0      # Offset in Bucket 6
	.int32	.Lnames9-.Lnames_entries0       # Offset in Bucket 6
	.int32	.Lnames7-.Lnames_entries0       # Offset in Bucket 7
	.int32	.Lnames6-.Lnames_entries0       # Offset in Bucket 8
	.int32	.Lnames12-.Lnames_entries0      # Offset in Bucket 8
.Lnames_abbrev_start0:
	.int8	1                               # Abbrev code
	.int8	46                              # DW_TAG_subprogram
	.int8	1                               # DW_IDX_compile_unit
	.int8	11                              # DW_FORM_data1
	.int8	3                               # DW_IDX_die_offset
	.int8	19                              # DW_FORM_ref4
	.int8	4                               # DW_IDX_parent
	.int8	25                              # DW_FORM_flag_present
	.int8	0                               # End of abbrev
	.int8	0                               # End of abbrev
	.int8	2                               # Abbrev code
	.int8	29                              # DW_TAG_inlined_subroutine
	.int8	1                               # DW_IDX_compile_unit
	.int8	11                              # DW_FORM_data1
	.int8	3                               # DW_IDX_die_offset
	.int8	19                              # DW_FORM_ref4
	.int8	4                               # DW_IDX_parent
	.int8	19                              # DW_FORM_ref4
	.int8	0                               # End of abbrev
	.int8	0                               # End of abbrev
	.int8	0                               # End of abbrev list
.Lnames_abbrev_end0:
.Lnames_entries0:
.Lnames0:
.L0:
	.int8	1                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	93                              # DW_IDX_die_offset
	.int8	0                               # DW_IDX_parent
                                        # End of list: __main_argc_argv
.Lnames14:
.L1:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	242                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: appendLiteral
.Lnames1:
.L14:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	106                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
.L5:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	186                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
.L3:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	290                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: _allocateUninitializedArray
.Lnames2:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	106                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss27_allocateUninitializedArrayySayxG_BptBwlF4main5Shape_p_Tg5
.Lnames17:
.L7:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	258                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss26DefaultStringInterpolationV06appendC0yyxs06CustomB11ConvertibleRzs20TextOutputStreamableRzlFSd_Tg5
.Lnames10:
.L6:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	202                             # DW_IDX_die_offset
	.int32	.L5-.Lnames_entries0            # DW_IDX_parent
.L2:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	306                             # DW_IDX_die_offset
	.int32	.L3-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZyp_Tt1g5
.Lnames16:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	258                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: appendInterpolation
.Lnames15:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	242                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss26DefaultStringInterpolationV13appendLiteralyySSF
.Lnames8:
.L4:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	172                             # DW_IDX_die_offset
	.int32	.L13-.Lnames_entries0           # DW_IDX_parent
	.int8	0                               # End of list: $sSa11_getElement_20wasNativeTypeChecked22matchingSubscriptCheckxSi_Sbs16_DependenceTokenVtF4main5Shape_p_Tg5
.Lnames11:
.L11:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	218                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: init
.Lnames4:
.L10:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	138                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: next
.Lnames5:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	138                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss16IndexingIteratorV4next7ElementQzSgyFSay4main5Shape_pG_Tg5
.Lnames13:
.L8:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	230                             # DW_IDX_die_offset
	.int32	.L11-.Lnames_entries0           # DW_IDX_parent
	.int8	0                               # End of list: $sSS12_createEmpty19withInitialCapacitySSSi_tFZ
.Lnames3:
.L9:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	122                             # DW_IDX_die_offset
	.int32	.L14-.Lnames_entries0           # DW_IDX_parent
	.int8	0                               # End of list: $sSa13_adoptStorage_5countSayxG_SpyxGts016_ContiguousArrayB0CyxGn_SitFZ4main5Shape_p_Tt1g5
.Lnames18:
.L12:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	274                             # DW_IDX_die_offset
	.int32	.L7-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $sSds20TextOutputStreamablessAAP5write2toyqd__z_ts0aB6StreamRd__lFTWs26DefaultStringInterpolationV_Tg5
.Lnames9:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	186                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	290                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5
.Lnames7:
.L13:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	161                             # DW_IDX_die_offset
	.int32	.L15-.Lnames_entries0           # DW_IDX_parent
	.int8	0                               # End of list: $sSayxSicir4main5Shape_p_Tg5
.Lnames6:
.L15:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	150                             # DW_IDX_die_offset
	.int32	.L10-.Lnames_entries0           # DW_IDX_parent
	.int8	0                               # End of list: $sSayxGSlsSly7ElementQz5IndexQzcirTW4main5Shape_p_Tg5
.Lnames12:
	.int8	2                               # Abbreviation code
	.int8	0                               # DW_IDX_compile_unit
	.int32	218                             # DW_IDX_die_offset
	.int32	.L0-.Lnames_entries0            # DW_IDX_parent
	.int8	0                               # End of list: $ss26DefaultStringInterpolationV15literalCapacity18interpolationCountABSi_SitcfC
	.p2align	2, 0x0
.Lnames_end0:
	.no_dead_strip	__indirect_function_table
	.size	$s4main5ShapeMp, 56
	.size	$s4main6CircleVN, 4
	.size	$s4main6CircleVAA5ShapeAAWP, 4
	.size	$s4main6SquareVN, 4
	.size	$s4main6SquareVAA5ShapeAAWP, 4
	.size	$ss26DefaultStringInterpolationVN, 4
	.size	$ss26DefaultStringInterpolationVs16TextOutputStreamsWP, 4
	.size	$sSSN, 4
	.size	$sSiN, 4
	.section	.custom_section.producers,"",@
	.int8	1
	.int8	8
	.ascii	"language"
	.int8	3
	.int8	5
	.ascii	"Swift"
	.int8	0
	.int8	3
	.ascii	"C11"
	.int8	0
	.int8	3
	.ascii	"C99"
	.int8	0
	.section	.debug_names,"",@
	.section	.custom_section.target_features,"",@
	.int8	9
	.int8	43
	.int8	11
	.ascii	"bulk-memory"
	.int8	43
	.int8	15
	.ascii	"bulk-memory-opt"
	.int8	43
	.int8	22
	.ascii	"call-indirect-overlong"
	.int8	43
	.int8	10
	.ascii	"multivalue"
	.int8	43
	.int8	15
	.ascii	"mutable-globals"
	.int8	43
	.int8	19
	.ascii	"nontrapping-fptoint"
	.int8	43
	.int8	15
	.ascii	"reference-types"
	.int8	43
	.int8	8
	.ascii	"sign-ext"
	.int8	45
	.int8	10
	.ascii	"shared-mem"
	.section	.debug_names,"",@
	.section	.debug_line,"",@
.Lline_table_start0:
