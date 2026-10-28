	.file	"view.out"
	.tabletype	__indirect_function_table, funcref
	.globaltype	__stack_pointer, i32
	.globaltype	__memory_base, i32, immutable
	.functype	__main_argc_argv (i32, i32) -> (i32)
	.functype	$ss27_allocateUninitializedArrayySayxG_BptBwlF (i32, i32, i32, i32, i32) -> ()
	.functype	__swift_instantiateConcreteTypeFromMangledName (i32) -> (i32)
	.functype	swift_getTypeByMangledNameInContext2 (i32, i32, i32, i32, i32, i32) -> (i32)
	.functype	$s4main6CircleV6radiusACSd_tcfC (f64, i32, i32) -> (f64)
	.functype	.Lobjectdestroy (i32, i32) -> ()
	.functype	swift_deallocObject (i32, i32, i32) -> ()
	.functype	swift_allocObject (i32, i32, i32) -> (i32)
	.functype	$s4main6SquareV4sideACSd_tcfC (f64, i32, i32) -> (f64)
	.functype	$ss27_finalizeUninitializedArrayySayxGABnlF (i32, i32, i32, i32) -> (i32)
	.functype	swift_retain (i32) -> (i32)
	.functype	$sSlss16IndexingIteratorVyxG0B0RtzrlE04makeB0ACyF (i32, i32, i32, i32, i32) -> ()
	.functype	$sSay4main5Shape_pGSayxGSlsWl () -> (i32)
	.functype	__swift_instantiateConcreteTypeFromMangledNameAbstract (i32) -> (i32)
	.functype	swift_getTypeByMangledNameInContextInMetadataState2 (i32, i32, i32, i32, i32, i32, i32) -> (i32)
	.functype	swift_getWitnessTable (i32, i32, i32) -> (i32)
	.functype	$ss16IndexingIteratorV4next7ElementQzSgyF (i32, i32, i32, i32) -> ()
	.functype	$ss16IndexingIteratorVySay4main5Shape_pGGWOh (i32) -> (i32)
	.functype	swift_release (i32) -> ()
	.functype	$ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5 (i32, i32, i32, i32) -> ()
	.functype	$ss26DefaultStringInterpolationV15literalCapacity18interpolationCountABSi_SitcfC (i32, i32, i32, i32, i32) -> ()
	.functype	$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC (i32, i32, i32, i32, i32, i32) -> ()
	.functype	$ss26DefaultStringInterpolationV13appendLiteralyySSF (i32, i32, i32, i32, i32) -> ()
	.functype	$ss13_StringObjectV7VariantOWOe (i32, i32) -> ()
	.functype	swift_beginAccess (i32, i32, i32, i32) -> ()
	.functype	swift_endAccess (i32) -> ()
	.functype	$ss26DefaultStringInterpolationV06appendC0yyxs06CustomB11ConvertibleRzs20TextOutputStreamableRzlF (i32, i32, i32, i32, i32, i32) -> ()
	.functype	$ss13_StringObjectV7VariantOWOy (i32, i32) -> ()
	.functype	$ss26DefaultStringInterpolationVWOh (i32) -> (i32)
	.functype	$sSS19stringInterpolationSSs013DefaultStringB0V_tcfC (i32, i32, i32, i32, i32, i32) -> ()
	.functype	$ss5print_9separator10terminatoryypd_S2StFfA0_ (i32, i32, i32) -> ()
	.functype	$ss5print_9separator10terminatoryypd_S2StFfA1_ (i32, i32, i32) -> ()
	.functype	$ss5print_9separator10terminatoryypd_S2StF (i32, i32, i32, i32, i32, i32, i32, i32, i32) -> ()
	.functype	$s4main6squareyS2iF (i32, i32, i32) -> (i32)
	.functype	$s4main5Shape_pWOb (i32, i32) -> (i32)
	.functype	__swift_project_boxed_opaque_existential_1 (i32, i32) -> (i32)
	.functype	__swift_destroy_boxed_opaque_existential_1 (i32) -> ()
	.functype	$sSa12_endMutationyyF (i32, i32, i32) -> ()
	.functype	$sSaMa (i32, i32, i32, i32, i32) -> ()
	.section	.text.__main_argc_argv,"R",@
	.globl	__main_argc_argv                # -- Begin function __main_argc_argv
	.type	__main_argc_argv,@function
__main_argc_argv:                       # @__main_argc_argv
.Lfunc_begin0:
	.file	1 "/" "/workspace/main.swift"
	.loc	1 0 0                           # /workspace/main.swift:0:0
	.functype	__main_argc_argv (i32, i32) -> (i32)
	.local  	i32, i64, i32, i32, i32, i32, i32, i32, i32, f64, i32, i32, i32, i32, f64, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, f64, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, f64, i32, i32, i32
# %bb.0:
	global.get	__stack_pointer
	i32.const	432
	i32.sub 
	local.set	2
	local.get	2
	global.set	__stack_pointer
	i64.const	0
	local.set	3
	local.get	2
	local.get	3
	i64.store	424
.Ltmp0:
	.loc	1 1 23 prologue_end             # /workspace/main.swift:1:23
	i32.const	$s4main5Shape_pMD@MBREL
	local.set	4
	global.get	__memory_base
	local.set	5
	local.get	5
	local.get	4
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledName
	local.set	6
	i32.const	2
	local.set	7
	local.get	2
	i32.const	144
	i32.add 
	local.get	7
	local.get	6
	local.get	9
	local.get	8
	call	$ss27_allocateUninitializedArrayySayxG_BptBwlF
	local.get	2
	i32.load	144
	local.set	10
	f64.const	0x1p0
	i32.const	0
	i32.const	0
	.loc	1 1 24 is_stmt 0                # /workspace/main.swift:1:24
	call	$s4main6CircleV6radiusACSd_tcfC
	local.set	11
	local.get	10
	global.get	$s4main6CircleVN@GOT
	i32.store	28
	local.get	10
	global.get	$s4main6CircleVAA5ShapeAAWP@GOT
	i32.store	32
	local.get	5
	i32.const	.Lmetadata@MBREL
	i32.add 
	i32.const	8
	i32.add 
	local.set	12
	i32.const	7
	local.set	13
	i32.const	16
	local.set	14
	local.get	12
	local.get	14
	local.get	13
	call	swift_allocObject
	local.set	15
	local.get	10
	local.get	15
	i32.store	16
	local.get	15
	local.get	11
	f64.store	8
	f64.const	0x1p1
	i32.const	0
	i32.const	0
	.loc	1 1 43                          # /workspace/main.swift:1:43
	call	$s4main6SquareV4sideACSd_tcfC
	local.set	16
	local.get	10
	global.get	$s4main6SquareVN@GOT
	i32.store	48
	local.get	10
	global.get	$s4main6SquareVAA5ShapeAAWP@GOT
	i32.store	52
	local.get	12
	local.get	14
	local.get	13
	call	swift_allocObject
	local.set	17
	local.get	10
	local.get	17
	i32.store	36
	local.get	17
	local.get	16
	f64.store	8
	local.get	10
	local.get	6
	i32.const	0
	i32.const	0
	.loc	1 1 23                          # /workspace/main.swift:1:23
	call	$ss27_finalizeUninitializedArrayySayxGABnlF
	local.set	18
	local.get	18
	call	swift_retain
	drop
	local.get	5
	i32.const	$s4main6shapesSayAA5Shape_pGvp@MBREL
	i32.add 
	local.get	18
	i32.store	0
	.loc	1 2 13 is_stmt 1                # /workspace/main.swift:2:13
	local.get	5
	i32.const	$s4main5totalSdvp@MBREL
	i32.add 
	local.get	3
	i64.store	0
	.loc	1 3 14                          # /workspace/main.swift:3:14
	local.get	2
	local.get	18
	i32.store	420
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	i32.const	$sSay4main5Shape_pGMD@MBREL
	global.get	__memory_base
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledName
	local.set	19
	call	$sSay4main5Shape_pGSayxGSlsWl
	local.set	20
	local.get	2
	i32.const	424
	i32.add 
	local.get	19
	local.get	20
	local.get	2
	i32.const	420
	i32.add 
	local.get	21
	call	$sSlss16IndexingIteratorVyxG0B0RtzrlE04makeB0ACyF
.LBB0_1:                                # =>This Inner Loop Header: Depth=1
	loop    	i32                             # label0:
	i32.const	$ss16IndexingIteratorVySay4main5Shape_pGGMD@MBREL
	global.get	__memory_base
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledName
	local.set	22
	local.get	2
	i32.const	400
	i32.add 
	local.get	22
	local.get	2
	i32.const	424
	i32.add 
	local.get	23
	call	$ss16IndexingIteratorV4next7ElementQzSgyF
	.loc	1 3 1 is_stmt 1                 # /workspace/main.swift:3:1
	block   	
	local.get	2
	i32.load	412
	br_if   	0                               # 0: down to label1
# %bb.2:
	.file	2 "/" "<compiler-generated>"
	.loc	2 0 0 is_stmt 0                 # <compiler-generated>:0
	local.get	2
	i32.const	424
	i32.add 
	call	$ss16IndexingIteratorVySay4main5Shape_pGGWOh
	drop
	i32.const	1
	local.set	24
	local.get	2
	i32.const	104
	i32.add 
	local.get	24
	local.get	26
	local.get	25
	call	$ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5
	local.get	2
	i32.load	104
	local.set	27
	i32.const	11
	local.set	28
	.loc	1 6 7 is_stmt 1                 # /workspace/main.swift:6:7
	local.get	2
	i32.const	88
	i32.add 
	local.get	28
	local.get	24
	local.get	30
	local.get	29
	call	$ss26DefaultStringInterpolationV15literalCapacity18interpolationCountABSi_SitcfC
	local.get	2
	i32.load	96
	local.set	31
	local.get	2
	i32.load	92
	local.set	32
	local.get	2
	local.get	2
	i32.load	88
	i32.store	372
	local.get	2
	local.get	32
	i32.store	376
	i32.const	8
	local.set	33
	local.get	33
	local.get	2
	i32.const	372
	i32.add 
	i32.add 
	local.set	34
	local.get	34
	local.get	31
	i32.store	0
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	local.get	33
	local.get	2
	i32.const	384
	i32.add 
	i32.add 
	local.set	35
	local.get	35
	local.get	34
	i32.load	0
	i32.store	0
	local.get	2
	local.get	2
	i64.load	372:p2align=2
	i64.store	384
	.loc	1 6 7                           # /workspace/main.swift:6:7
	i32.const	".L.str.11.total area "@MBREL
	local.set	36
	global.get	__memory_base
	local.set	37
	local.get	37
	local.get	36
	i32.add 
	local.set	38
	local.get	2
	i32.const	72
	i32.add 
	local.get	38
	local.get	28
	local.get	24
	local.get	40
	local.get	39
	call	$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC
	local.get	2
	i32.load	80
	local.set	41
	local.get	2
	i32.load	76
	local.set	42
	local.get	2
	local.get	2
	i32.load	72
	i32.store	360
	local.get	2
	local.get	42
	i32.store	364
	local.get	2
	local.get	41
	i32.store	368
	local.get	2
	i32.load	360
	local.set	43
	local.get	2
	i32.load	364
	local.set	44
	local.get	2
	i32.load8_u	368
	local.set	45
	local.get	2
	i32.load8_u	369
	local.set	46
	local.get	2
	i32.load16_u	370
	local.set	47
	.loc	1 0 0                           # /workspace/main.swift:0
	local.get	2
	local.get	43
	i32.store	348
	local.get	2
	local.get	44
	i32.store	352
	local.get	2
	local.get	45
	i32.store8	356
	local.get	2
	local.get	46
	i32.store8	357
	local.get	2
	local.get	47
	i32.store16	358
	local.get	2
	i32.load	348
	local.set	48
	local.get	2
	i32.load	352
	local.set	49
	local.get	2
	i32.load	356
	local.set	50
	local.get	48
	local.get	49
	local.get	50
	local.get	2
	i32.const	384
	i32.add 
	local.get	51
	call	$ss26DefaultStringInterpolationV13appendLiteralyySSF
	local.get	44
	local.get	45
	call	$ss13_StringObjectV7VariantOWOe
	.loc	1 6 21                          # /workspace/main.swift:6:21
	local.get	37
	i32.const	$s4main5totalSdvp@MBREL
	i32.add 
	local.set	52
	i32.const	0
	local.set	53
	i32.const	32
	local.set	54
	local.get	52
	local.get	2
	i32.const	336
	i32.add 
	local.get	54
	local.get	53
	call	swift_beginAccess
	local.get	52
	f64.load	0
	local.set	55
	.loc	1 0 0                           # /workspace/main.swift:0
	local.get	2
	i32.const	336
	i32.add 
	call	swift_endAccess
	local.get	2
	local.get	55
	f64.store	328
	.loc	1 6 20                          # /workspace/main.swift:6:20
	global.get	$sSds20TextOutputStreamablesWP@GOT
	local.set	56
	global.get	$sSds23CustomStringConvertiblesWP@GOT
	local.set	57
	global.get	$sSdN@GOT
	local.set	58
	local.get	2
	i32.const	328
	i32.add 
	local.get	58
	local.get	57
	local.get	56
	local.get	2
	i32.const	384
	i32.add 
	local.get	59
	call	$ss26DefaultStringInterpolationV06appendC0yyxs06CustomB11ConvertibleRzs20TextOutputStreamableRzlF
	.loc	1 6 27                          # /workspace/main.swift:6:27
	local.get	37
	i32.const	.L.str.0.@MBREL
	i32.add 
	local.set	60
	local.get	2
	i32.const	56
	i32.add 
	local.get	60
	local.get	53
	local.get	24
	local.get	62
	local.get	61
	call	$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC
	local.get	2
	i32.load	64
	local.set	63
	local.get	2
	i32.load	60
	local.set	64
	local.get	2
	local.get	2
	i32.load	56
	i32.store	316
	local.get	2
	local.get	64
	i32.store	320
	local.get	2
	local.get	63
	i32.store	324
	local.get	2
	i32.load	316
	local.set	65
	local.get	2
	i32.load	320
	local.set	66
	local.get	2
	i32.load8_u	324
	local.set	67
	local.get	2
	i32.load8_u	325
	local.set	68
	local.get	2
	i32.load16_u	326
	local.set	69
	.loc	1 0 0                           # /workspace/main.swift:0
	local.get	2
	local.get	65
	i32.store	304
	local.get	2
	local.get	66
	i32.store	308
	local.get	2
	local.get	67
	i32.store8	312
	local.get	2
	local.get	68
	i32.store8	313
	local.get	2
	local.get	69
	i32.store16	314
	local.get	2
	i32.load	304
	local.set	70
	local.get	2
	i32.load	308
	local.set	71
	local.get	2
	i32.load	312
	local.set	72
	local.get	70
	local.get	71
	local.get	72
	local.get	2
	i32.const	384
	i32.add 
	local.get	73
	call	$ss26DefaultStringInterpolationV13appendLiteralyySSF
	local.get	66
	local.get	67
	call	$ss13_StringObjectV7VariantOWOe
	local.get	2
	i32.load	384
	local.set	74
	local.get	2
	i32.load	388
	local.set	75
	local.get	35
	i32.load8_u	0
	local.set	76
	local.get	2
	i32.load8_u	393
	local.set	77
	local.get	2
	i32.load16_u	394
	local.set	78
	local.get	75
	local.get	76
	call	$ss13_StringObjectV7VariantOWOy
	local.get	2
	i32.const	384
	i32.add 
	call	$ss26DefaultStringInterpolationVWOh
	drop
	.loc	1 6 7                           # /workspace/main.swift:6:7
	local.get	2
	local.get	74
	i32.store	292
	local.get	2
	local.get	75
	i32.store	296
	local.get	2
	local.get	76
	i32.store8	300
	local.get	2
	local.get	77
	i32.store8	301
	local.get	2
	local.get	78
	i32.store16	302
	local.get	2
	i32.load	292
	local.set	79
	local.get	2
	i32.load	296
	local.set	80
	local.get	2
	i32.load	300
	local.set	81
	local.get	2
	i32.const	40
	i32.add 
	local.get	79
	local.get	80
	local.get	81
	local.get	83
	local.get	82
	call	$sSS19stringInterpolationSSs013DefaultStringB0V_tcfC
	local.get	2
	i32.load	48
	local.set	84
	local.get	2
	i32.load	44
	local.set	85
	local.get	2
	local.get	2
	i32.load	40
	i32.store	280
	local.get	2
	local.get	85
	i32.store	284
	local.get	2
	local.get	84
	i32.store	288
	local.get	2
	i32.load	280
	local.set	86
	local.get	2
	i32.load	284
	local.set	87
	local.get	2
	i32.load8_u	288
	local.set	88
	local.get	2
	i32.load8_u	289
	local.set	89
	local.get	2
	i32.load16_u	290
	local.set	90
	local.get	27
	global.get	$sSSN@GOT
	i32.store	28
	local.get	27
	local.get	86
	i32.store	16
	local.get	27
	local.get	87
	i32.store	20
	local.get	27
	local.get	88
	i32.store8	24
	local.get	27
	local.get	89
	i32.store8	25
	local.get	27
	local.get	90
	i32.store16	26
	.loc	1 0 0                           # /workspace/main.swift:0
	local.get	27
	global.get	$sypN@GOT
	i32.const	4
	i32.add 
	i32.const	0
	i32.const	0
	call	$ss27_finalizeUninitializedArrayySayxGABnlF
	local.set	91
	local.get	2
	i32.const	24
	i32.add 
	local.get	93
	local.get	92
	call	$ss5print_9separator10terminatoryypd_S2StFfA0_
	local.get	2
	i32.load	32
	local.set	94
	local.get	2
	i32.load	28
	local.set	95
	local.get	2
	local.get	2
	i32.load	24
	i32.store	268
	local.get	2
	local.get	95
	i32.store	272
	local.get	2
	local.get	94
	i32.store	276
	local.get	2
	i32.load	268
	local.set	96
	local.get	2
	i32.load	272
	local.set	97
	local.get	2
	i32.load8_u	276
	local.set	98
	local.get	2
	i32.load8_u	277
	local.set	99
	local.get	2
	i32.load16_u	278
	local.set	100
	local.get	2
	i32.const	8
	i32.add 
	local.get	102
	local.get	101
	call	$ss5print_9separator10terminatoryypd_S2StFfA1_
	local.get	2
	i32.load	16
	local.set	103
	local.get	2
	i32.load	12
	local.set	104
	local.get	2
	local.get	2
	i32.load	8
	i32.store	256
	local.get	2
	local.get	104
	i32.store	260
	local.get	2
	local.get	103
	i32.store	264
	local.get	2
	i32.load	256
	local.set	105
	local.get	2
	i32.load	260
	local.set	106
	local.get	2
	i32.load8_u	264
	local.set	107
	local.get	2
	i32.load8_u	265
	local.set	108
	local.get	2
	i32.load16_u	266
	local.set	109
	.loc	1 6 1                           # /workspace/main.swift:6:1
	local.get	2
	local.get	96
	i32.store	244
	local.get	2
	local.get	97
	i32.store	248
	local.get	2
	local.get	98
	i32.store8	252
	local.get	2
	local.get	99
	i32.store8	253
	local.get	2
	local.get	100
	i32.store16	254
	local.get	2
	i32.load	244
	local.set	110
	local.get	2
	i32.load	248
	local.set	111
	local.get	2
	i32.load	252
	local.set	112
	local.get	2
	local.get	105
	i32.store	232
	local.get	2
	local.get	106
	i32.store	236
	local.get	2
	local.get	107
	i32.store8	240
	local.get	2
	local.get	108
	i32.store8	241
	local.get	2
	local.get	109
	i32.store16	242
	local.get	91
	local.get	110
	local.get	111
	local.get	112
	local.get	2
	i32.load	232
	local.get	2
	i32.load	236
	local.get	2
	i32.load	240
	i32.const	0
	i32.const	0
	call	$ss5print_9separator10terminatoryypd_S2StF
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	106
	local.get	107
	call	$ss13_StringObjectV7VariantOWOe
	local.get	97
	local.get	98
	call	$ss13_StringObjectV7VariantOWOe
	local.get	91
	call	swift_release
	local.get	2
	local.get	24
	i32.const	0
	i32.const	0
	call	$ss27_allocateUninitializedArrayySayxG_BptBwlFyp_Tg5
	local.get	2
	i32.load	0
	local.set	113
	i32.const	7
	i32.const	0
	i32.const	0
	.loc	1 7 7 is_stmt 1                 # /workspace/main.swift:7:7
	call	$s4main6squareyS2iF
	local.set	114
	local.get	113
	global.get	$sSiN@GOT
	i32.store	28
	local.get	113
	local.get	114
	i32.store	16
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	local.get	113
	global.get	$sypN@GOT
	i32.const	4
	i32.add 
	i32.const	0
	i32.const	0
	call	$ss27_finalizeUninitializedArrayySayxGABnlF
	local.set	115
	local.get	2
	i32.const	112
	i32.add 
	local.get	117
	local.get	116
	call	$ss5print_9separator10terminatoryypd_S2StFfA0_
	local.get	2
	i32.load	120
	local.set	118
	local.get	2
	i32.load	116
	local.set	119
	local.get	2
	local.get	2
	i32.load	112
	i32.store	220
	local.get	2
	local.get	119
	i32.store	224
	local.get	2
	local.get	118
	i32.store	228
	local.get	2
	i32.load	220
	local.set	120
	local.get	2
	i32.load	224
	local.set	121
	local.get	2
	i32.load8_u	228
	local.set	122
	local.get	2
	i32.load8_u	229
	local.set	123
	local.get	2
	i32.load16_u	230
	local.set	124
	local.get	2
	i32.const	128
	i32.add 
	local.get	126
	local.get	125
	call	$ss5print_9separator10terminatoryypd_S2StFfA1_
	local.get	2
	i32.load	136
	local.set	127
	local.get	2
	i32.load	132
	local.set	128
	local.get	2
	local.get	2
	i32.load	128
	i32.store	208
	local.get	2
	local.get	128
	i32.store	212
	local.get	2
	local.get	127
	i32.store	216
	local.get	2
	i32.load	208
	local.set	129
	local.get	2
	i32.load	212
	local.set	130
	local.get	2
	i32.load8_u	216
	local.set	131
	local.get	2
	i32.load8_u	217
	local.set	132
	local.get	2
	i32.load16_u	218
	local.set	133
	.loc	1 7 1                           # /workspace/main.swift:7:1
	local.get	2
	local.get	120
	i32.store	196
	local.get	2
	local.get	121
	i32.store	200
	local.get	2
	local.get	122
	i32.store8	204
	local.get	2
	local.get	123
	i32.store8	205
	local.get	2
	local.get	124
	i32.store16	206
	local.get	2
	i32.load	196
	local.set	134
	local.get	2
	i32.load	200
	local.set	135
	local.get	2
	i32.load	204
	local.set	136
	local.get	2
	local.get	129
	i32.store	184
	local.get	2
	local.get	130
	i32.store	188
	local.get	2
	local.get	131
	i32.store8	192
	local.get	2
	local.get	132
	i32.store8	193
	local.get	2
	local.get	133
	i32.store16	194
	local.get	115
	local.get	134
	local.get	135
	local.get	136
	local.get	2
	i32.load	184
	local.get	2
	i32.load	188
	local.get	2
	i32.load	192
	i32.const	0
	i32.const	0
	call	$ss5print_9separator10terminatoryypd_S2StF
	.loc	2 0 0                           # <compiler-generated>:0
	local.get	130
	local.get	131
	call	$ss13_StringObjectV7VariantOWOe
	local.get	121
	local.get	122
	call	$ss13_StringObjectV7VariantOWOe
	local.get	115
	call	swift_release
	i32.const	0
	local.set	137
	local.get	2
	i32.const	432
	i32.add 
	global.set	__stack_pointer
	local.get	137
	return
.LBB0_3:                                #   in Loop: Header=BB0_1 Depth=1
	end_block                               # label1:
	.loc	1 3 21 is_stmt 1                # /workspace/main.swift:3:21
	local.get	2
	i32.const	400
	i32.add 
	local.get	2
	i32.const	164
	i32.add 
	call	$s4main5Shape_pWOb
	drop
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	local.get	2
	i32.load	176
	local.set	138
	local.get	2
	i32.load	180
	local.set	139
	local.get	2
	i32.const	164
	i32.add 
	local.get	138
	call	__swift_project_boxed_opaque_existential_1
	local.set	140
	.loc	1 4 20 is_stmt 1                # /workspace/main.swift:4:20
	local.get	139
	i32.load	4
	local.set	141
	local.get	140
	local.get	138
	local.get	139
	i32.const	0
	local.get	141
	call_indirect	 __indirect_function_table, (i32, i32, i32, i32) -> (f64)
	local.set	142
	.loc	1 0 0 is_stmt 0                 # /workspace/main.swift:0
	i32.const	$s4main5totalSdvp@MBREL
	global.get	__memory_base
	i32.add 
	local.set	143
	i32.const	0
	local.set	144
	i32.const	33
	local.set	145
	local.get	143
	local.get	2
	i32.const	152
	i32.add 
	local.get	145
	local.get	144
	call	swift_beginAccess
	.loc	1 4 11                          # /workspace/main.swift:4:11
	local.get	143
	local.get	142
	local.get	143
	f64.load	0
	f64.add 
	f64.store	0
	.loc	1 0 0                           # /workspace/main.swift:0
	local.get	2
	i32.const	152
	i32.add 
	call	swift_endAccess
	.loc	1 5 1 is_stmt 1                 # /workspace/main.swift:5:1
	local.get	2
	i32.const	164
	i32.add 
	call	__swift_destroy_boxed_opaque_existential_1
	br      	0                               # 0: up to label0
.Ltmp1:
.LBB0_4:
	.loc	1 0 1 is_stmt 0                 # /workspace/main.swift:0:1
	end_loop
	end_function
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
	.local  	i64, i32, i64, i32, i32, i32, i32, i64
# %bb.0:
	local.get	0
	i64.load	0
	local.set	1
	local.get	1
	i64.const	0
	i64.lt_s
	i32.const	1
	i32.and 
	local.set	2
	local.get	1
	local.set	3
	block   	
	local.get	2
	i32.eqz
	br_if   	0                               # 0: down to label2
# %bb.1:
	local.get	1
	i64.const	32
	i64.shr_s
	i32.wrap_i64
	local.set	4
	i32.const	0
	local.get	4
	i32.sub 
	local.set	5
	local.get	0
	local.get	1
	i32.wrap_i64
	i32.add 
	local.set	6
	i32.const	0
	local.set	7
	local.get	6
	local.get	5
	local.get	7
	local.get	7
	i32.const	0
	i32.const	0
	call	swift_getTypeByMangledNameInContext2
	i64.extend_i32_u
	local.set	8
	local.get	0
	local.get	8
	i64.store	0
	local.get	8
	local.set	3
.LBB1_2:
	end_block                               # label2:
	local.get	3
	i32.wrap_i64
	return
	end_function
.Ltmp2:
.Lfunc_end1:
                                        # -- End function
	.section	.text..Lobjectdestroy,"",@
	.type	.Lobjectdestroy,@function       # -- Begin function objectdestroy
.Lobjectdestroy:                        # @objectdestroy
.Lfunc_begin2:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	.Lobjectdestroy (i32, i32) -> ()
# %bb.0:
	local.get	0
	i32.const	16
	i32.const	7
	call	swift_deallocObject
	return
	end_function
.Ltmp3:
.Lfunc_end2:
                                        # -- End function
	.section	".text.$ss27_finalizeUninitializedArrayySayxGABnlF","G",@,"$ss27_finalizeUninitializedArrayySayxGABnlF",comdat
	.hidden	$ss27_finalizeUninitializedArrayySayxGABnlF # -- Begin function $ss27_finalizeUninitializedArrayySayxGABnlF
	.weak	$ss27_finalizeUninitializedArrayySayxGABnlF
	.type	$ss27_finalizeUninitializedArrayySayxGABnlF,@function
$ss27_finalizeUninitializedArrayySayxGABnlF: # @"$ss27_finalizeUninitializedArrayySayxGABnlF"
.Lfunc_begin3:
	.functype	$ss27_finalizeUninitializedArrayySayxGABnlF (i32, i32, i32, i32) -> (i32)
	.local  	i32, i32, i32, i32
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	global.get	__stack_pointer
	i32.const	16
	i32.sub 
	local.set	4
	local.get	4
	global.set	__stack_pointer
	local.get	4
	local.get	1
	i32.store	12
.Ltmp4:
	local.get	4
	local.get	0
	i32.store	8
	local.get	4
	i32.const	0
	local.get	1
	i32.const	0
	i32.const	0
	call	$sSaMa
	local.get	4
	i32.load	4
	drop
	local.get	4
	i32.load	0
	local.set	5
	local.get	5
	local.get	4
	i32.const	8
	i32.add 
	local.get	6
	call	$sSa12_endMutationyyF
	local.get	4
	i32.load	8
	local.set	7
	local.get	4
	i32.const	16
	i32.add 
	global.set	__stack_pointer
	local.get	7
	return
	end_function
.Ltmp5:
.Lfunc_end3:
                                        # -- End function
	.section	".text.$sSay4main5Shape_pGSayxGSlsWl","G",@,"$sSay4main5Shape_pGSayxGSlsWl",comdat
	.hidden	$sSay4main5Shape_pGSayxGSlsWl   # -- Begin function $sSay4main5Shape_pGSayxGSlsWl
	.weak	$sSay4main5Shape_pGSayxGSlsWl
	.type	$sSay4main5Shape_pGSayxGSlsWl,@function
$sSay4main5Shape_pGSayxGSlsWl:          # @"$sSay4main5Shape_pGSayxGSlsWl"
.Lfunc_begin4:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$sSay4main5Shape_pGSayxGSlsWl () -> (i32)
	.local  	i32, i32, i32, i32, i32, i32, i32
# %bb.0:
	i32.const	$sSay4main5Shape_pGSayxGSlsWL@MBREL
	global.get	__memory_base
	i32.add 
	i32.load	0
	local.set	0
	local.get	0
	i32.const	0
	i32.eq  
	i32.const	1
	i32.and 
	local.set	1
	local.get	0
	local.set	2
	block   	
	local.get	1
	i32.eqz
	br_if   	0                               # 0: down to label3
# %bb.1:
	i32.const	$sSay4main5Shape_pGMD@MBREL
	local.set	3
	global.get	__memory_base
	local.set	4
	local.get	4
	local.get	3
	i32.add 
	call	__swift_instantiateConcreteTypeFromMangledNameAbstract
	local.set	5
	global.get	$sSayxGSlsMc@GOT
	local.get	5
	i32.const	0
	call	swift_getWitnessTable
	local.set	6
	local.get	4
	i32.const	$sSay4main5Shape_pGSayxGSlsWL@MBREL
	i32.add 
	local.get	6
	i32.store	0
	local.get	6
	local.set	2
.LBB4_2:
	end_block                               # label3:
	local.get	2
	return
	end_function
.Ltmp6:
.Lfunc_end4:
                                        # -- End function
	.section	.text.__swift_instantiateConcreteTypeFromMangledNameAbstract,"G",@,__swift_instantiateConcreteTypeFromMangledNameAbstract,comdat
	.hidden	__swift_instantiateConcreteTypeFromMangledNameAbstract # -- Begin function __swift_instantiateConcreteTypeFromMangledNameAbstract
	.weak	__swift_instantiateConcreteTypeFromMangledNameAbstract
	.type	__swift_instantiateConcreteTypeFromMangledNameAbstract,@function
__swift_instantiateConcreteTypeFromMangledNameAbstract: # @__swift_instantiateConcreteTypeFromMangledNameAbstract
.Lfunc_begin5:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	__swift_instantiateConcreteTypeFromMangledNameAbstract (i32) -> (i32)
	.local  	i64, i32, i64, i32, i32, i32, i32, i64
# %bb.0:
	local.get	0
	i64.load	0
	local.set	1
	local.get	1
	i64.const	0
	i64.lt_s
	i32.const	1
	i32.and 
	local.set	2
	local.get	1
	local.set	3
	block   	
	local.get	2
	i32.eqz
	br_if   	0                               # 0: down to label4
# %bb.1:
	local.get	1
	i64.const	32
	i64.shr_s
	i32.wrap_i64
	local.set	4
	i32.const	0
	local.get	4
	i32.sub 
	local.set	5
	local.get	0
	local.get	1
	i32.wrap_i64
	i32.add 
	local.set	6
	i32.const	0
	local.set	7
	i32.const	255
	local.get	6
	local.get	5
	local.get	7
	local.get	7
	i32.const	0
	i32.const	0
	call	swift_getTypeByMangledNameInContextInMetadataState2
	i64.extend_i32_u
	local.set	8
	local.get	0
	local.get	8
	i64.store	0
	local.get	8
	local.set	3
.LBB5_2:
	end_block                               # label4:
	local.get	3
	i32.wrap_i64
	return
	end_function
.Ltmp7:
.Lfunc_end5:
                                        # -- End function
	.section	".text.$ss16IndexingIteratorVySay4main5Shape_pGGWOh","G",@,"$ss16IndexingIteratorVySay4main5Shape_pGGWOh",comdat
	.hidden	$ss16IndexingIteratorVySay4main5Shape_pGGWOh # -- Begin function $ss16IndexingIteratorVySay4main5Shape_pGGWOh
	.weak	$ss16IndexingIteratorVySay4main5Shape_pGGWOh
	.type	$ss16IndexingIteratorVySay4main5Shape_pGGWOh,@function
$ss16IndexingIteratorVySay4main5Shape_pGGWOh: # @"$ss16IndexingIteratorVySay4main5Shape_pGGWOh"
.Lfunc_begin6:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$ss16IndexingIteratorVySay4main5Shape_pGGWOh (i32) -> (i32)
# %bb.0:
	local.get	0
	i32.load	0
	call	swift_release
	local.get	0
	return
	end_function
.Ltmp8:
.Lfunc_end6:
                                        # -- End function
	.section	".text.$ss13_StringObjectV7VariantOWOe","G",@,"$ss13_StringObjectV7VariantOWOe",comdat
	.hidden	$ss13_StringObjectV7VariantOWOe # -- Begin function $ss13_StringObjectV7VariantOWOe
	.weak	$ss13_StringObjectV7VariantOWOe
	.type	$ss13_StringObjectV7VariantOWOe,@function
$ss13_StringObjectV7VariantOWOe:        # @"$ss13_StringObjectV7VariantOWOe"
.Lfunc_begin7:
	.functype	$ss13_StringObjectV7VariantOWOe (i32, i32) -> ()
	.local  	i32
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	local.get	1
	i32.const	-1
.Ltmp9:
	i32.add 
	i32.const	255
	i32.and 
	local.set	2
	local.get	2
	i32.const	1
	i32.gt_u
	drop
	block   	
	block   	
	block   	
	local.get	2
	br_table 	{0, 1, 2}               # 1: down to label6
                                        # 2: down to label5
.LBB7_1:
	end_block                               # label7:
	local.get	0
	call	swift_release
	br      	1                               # 1: down to label5
.LBB7_2:
	end_block                               # label6:
	local.get	0
	call	swift_release
.LBB7_3:
	end_block                               # label5:
	return
	end_function
.Ltmp10:
.Lfunc_end7:
                                        # -- End function
	.section	".text.$ss13_StringObjectV7VariantOWOy","G",@,"$ss13_StringObjectV7VariantOWOy",comdat
	.hidden	$ss13_StringObjectV7VariantOWOy # -- Begin function $ss13_StringObjectV7VariantOWOy
	.weak	$ss13_StringObjectV7VariantOWOy
	.type	$ss13_StringObjectV7VariantOWOy,@function
$ss13_StringObjectV7VariantOWOy:        # @"$ss13_StringObjectV7VariantOWOy"
.Lfunc_begin8:
	.functype	$ss13_StringObjectV7VariantOWOy (i32, i32) -> ()
	.local  	i32
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	local.get	1
	i32.const	-1
.Ltmp11:
	i32.add 
	i32.const	255
	i32.and 
	local.set	2
	local.get	2
	i32.const	1
	i32.gt_u
	drop
	block   	
	block   	
	block   	
	local.get	2
	br_table 	{0, 1, 2}               # 1: down to label9
                                        # 2: down to label8
.LBB8_1:
	end_block                               # label10:
	local.get	0
	call	swift_retain
	drop
	br      	1                               # 1: down to label8
.LBB8_2:
	end_block                               # label9:
	local.get	0
	call	swift_retain
	drop
.LBB8_3:
	end_block                               # label8:
	return
	end_function
.Ltmp12:
.Lfunc_end8:
                                        # -- End function
	.section	".text.$ss26DefaultStringInterpolationVWOh","G",@,"$ss26DefaultStringInterpolationVWOh",comdat
	.hidden	$ss26DefaultStringInterpolationVWOh # -- Begin function $ss26DefaultStringInterpolationVWOh
	.weak	$ss26DefaultStringInterpolationVWOh
	.type	$ss26DefaultStringInterpolationVWOh,@function
$ss26DefaultStringInterpolationVWOh:    # @"$ss26DefaultStringInterpolationVWOh"
.Lfunc_begin9:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$ss26DefaultStringInterpolationVWOh (i32) -> (i32)
# %bb.0:
	local.get	0
	i32.load	4
	local.get	0
	i32.load8_u	8
	call	$ss13_StringObjectV7VariantOWOe
	local.get	0
	return
	end_function
.Ltmp13:
.Lfunc_end9:
                                        # -- End function
	.section	".text.$ss5print_9separator10terminatoryypd_S2StFfA0_","G",@,"$ss5print_9separator10terminatoryypd_S2StFfA0_",comdat
	.hidden	$ss5print_9separator10terminatoryypd_S2StFfA0_ # -- Begin function $ss5print_9separator10terminatoryypd_S2StFfA0_
	.weak	$ss5print_9separator10terminatoryypd_S2StFfA0_
	.type	$ss5print_9separator10terminatoryypd_S2StFfA0_,@function
$ss5print_9separator10terminatoryypd_S2StFfA0_: # @"$ss5print_9separator10terminatoryypd_S2StFfA0_"
.Lfunc_begin10:
	.functype	$ss5print_9separator10terminatoryypd_S2StFfA0_ (i32, i32, i32) -> ()
	.local  	i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	global.get	__stack_pointer
	i32.const	48
	i32.sub 
	local.set	3
	local.get	3
	global.set	__stack_pointer
.Ltmp14:
	i32.const	".L.str.1. "@MBREL
	global.get	__memory_base
	i32.add 
	local.set	4
	i32.const	1
	local.set	5
	local.get	3
	i32.const	8
	i32.add 
	local.get	4
	local.get	5
	local.get	5
	local.get	7
	local.get	6
	call	$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC
	local.get	3
	i32.load	16
	local.set	8
	local.get	3
	i32.load	12
	local.set	9
	local.get	3
	local.get	3
	i32.load	8
	i32.store	36
	local.get	3
	local.get	9
	i32.store	40
	local.get	3
	local.get	8
	i32.store	44
	local.get	3
	i32.load	36
	local.set	10
	local.get	3
	i32.load	40
	local.set	11
	local.get	3
	i32.load8_u	44
	local.set	12
	local.get	3
	i32.load8_u	45
	local.set	13
	local.get	3
	i32.load16_u	46
	local.set	14
	local.get	3
	local.get	10
	i32.store	24
	local.get	3
	local.get	11
	i32.store	28
	local.get	3
	local.get	12
	i32.store8	32
	local.get	3
	local.get	13
	i32.store8	33
	local.get	3
	local.get	14
	i32.store16	34
	local.get	3
	i32.load	24
	local.set	15
	local.get	3
	i32.load	28
	local.set	16
	local.get	0
	local.get	3
	i32.load	32
	i32.store	8
	local.get	0
	local.get	16
	i32.store	4
	local.get	0
	local.get	15
	i32.store	0
	local.get	3
	i32.const	48
	i32.add 
	global.set	__stack_pointer
	return
	end_function
.Ltmp15:
.Lfunc_end10:
                                        # -- End function
	.section	".text.$ss5print_9separator10terminatoryypd_S2StFfA1_","G",@,"$ss5print_9separator10terminatoryypd_S2StFfA1_",comdat
	.hidden	$ss5print_9separator10terminatoryypd_S2StFfA1_ # -- Begin function $ss5print_9separator10terminatoryypd_S2StFfA1_
	.weak	$ss5print_9separator10terminatoryypd_S2StFfA1_
	.type	$ss5print_9separator10terminatoryypd_S2StFfA1_,@function
$ss5print_9separator10terminatoryypd_S2StFfA1_: # @"$ss5print_9separator10terminatoryypd_S2StFfA1_"
.Lfunc_begin11:
	.functype	$ss5print_9separator10terminatoryypd_S2StFfA1_ (i32, i32, i32) -> ()
	.local  	i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32, i32
# %bb.0:
	.loc	2 0 0 prologue_end              # <compiler-generated>:0:0
	global.get	__stack_pointer
	i32.const	48
	i32.sub 
	local.set	3
	local.get	3
	global.set	__stack_pointer
.Ltmp16:
	i32.const	".L.str.1.\n"@MBREL
	global.get	__memory_base
	i32.add 
	local.set	4
	i32.const	1
	local.set	5
	local.get	3
	i32.const	8
	i32.add 
	local.get	4
	local.get	5
	local.get	5
	local.get	7
	local.get	6
	call	$sSS21_builtinStringLiteral17utf8CodeUnitCount7isASCIISSBp_BwBi1_tcfC
	local.get	3
	i32.load	16
	local.set	8
	local.get	3
	i32.load	12
	local.set	9
	local.get	3
	local.get	3
	i32.load	8
	i32.store	36
	local.get	3
	local.get	9
	i32.store	40
	local.get	3
	local.get	8
	i32.store	44
	local.get	3
	i32.load	36
	local.set	10
	local.get	3
	i32.load	40
	local.set	11
	local.get	3
	i32.load8_u	44
	local.set	12
	local.get	3
	i32.load8_u	45
	local.set	13
	local.get	3
	i32.load16_u	46
	local.set	14
	local.get	3
	local.get	10
	i32.store	24
	local.get	3
	local.get	11
	i32.store	28
	local.get	3
	local.get	12
	i32.store8	32
	local.get	3
	local.get	13
	i32.store8	33
	local.get	3
	local.get	14
	i32.store16	34
	local.get	3
	i32.load	24
	local.set	15
	local.get	3
	i32.load	28
	local.set	16
	local.get	0
	local.get	3
	i32.load	32
	i32.store	8
	local.get	0
	local.get	16
	i32.store	4
	local.get	0
	local.get	15
	i32.store	0
	local.get	3
	i32.const	48
	i32.add 
	global.set	__stack_pointer
	return
	end_function
.Ltmp17:
.Lfunc_end11:
                                        # -- End function
	.section	".text.$s4main5Shape_pWOb","G",@,"$s4main5Shape_pWOb",comdat
	.hidden	$s4main5Shape_pWOb              # -- Begin function $s4main5Shape_pWOb
	.weak	$s4main5Shape_pWOb
	.type	$s4main5Shape_pWOb,@function
$s4main5Shape_pWOb:                     # @"$s4main5Shape_pWOb"
.Lfunc_begin12:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$s4main5Shape_pWOb (i32, i32) -> (i32)
	.local  	i32, i32
# %bb.0:
	local.get	1
	local.get	0
	i64.load	0:p2align=2
	i64.store	0:p2align=2
	i32.const	16
	local.set	2
	local.get	1
	local.get	2
	i32.add 
	local.get	0
	local.get	2
	i32.add 
	i32.load	0
	i32.store	0
	i32.const	8
	local.set	3
	local.get	1
	local.get	3
	i32.add 
	local.get	0
	local.get	3
	i32.add 
	i64.load	0:p2align=2
	i64.store	0:p2align=2
	local.get	1
	return
	end_function
.Ltmp18:
.Lfunc_end12:
                                        # -- End function
	.section	.text.__swift_project_boxed_opaque_existential_1,"G",@,__swift_project_boxed_opaque_existential_1,comdat
	.hidden	__swift_project_boxed_opaque_existential_1 # -- Begin function __swift_project_boxed_opaque_existential_1
	.weak	__swift_project_boxed_opaque_existential_1
	.type	__swift_project_boxed_opaque_existential_1,@function
__swift_project_boxed_opaque_existential_1: # @__swift_project_boxed_opaque_existential_1
.Lfunc_begin13:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	__swift_project_boxed_opaque_existential_1 (i32, i32) -> (i32)
	.local  	i32, i32, i32
# %bb.0:
	local.get	1
	i32.const	-4
	i32.add 
	i32.load	0
	i32.load	40
	local.set	2
	block   	
	local.get	2
	i32.const	131072
	i32.and 
	br_if   	0                               # 0: down to label11
# %bb.1:
	local.get	0
	return
.LBB13_2:
	end_block                               # label11:
	local.get	0
	i32.load	0
	local.set	3
	local.get	2
	i32.const	255
	i32.and 
	local.set	4
	local.get	3
	local.get	4
	i32.const	8
	i32.add 
	local.get	4
	i32.const	-1
	i32.xor 
	i32.and 
	i32.add 
	return
	end_function
.Ltmp19:
.Lfunc_end13:
                                        # -- End function
	.section	.text.__swift_destroy_boxed_opaque_existential_1,"G",@,__swift_destroy_boxed_opaque_existential_1,comdat
	.hidden	__swift_destroy_boxed_opaque_existential_1 # -- Begin function __swift_destroy_boxed_opaque_existential_1
	.weak	__swift_destroy_boxed_opaque_existential_1
	.type	__swift_destroy_boxed_opaque_existential_1,@function
__swift_destroy_boxed_opaque_existential_1: # @__swift_destroy_boxed_opaque_existential_1
.Lfunc_begin14:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	__swift_destroy_boxed_opaque_existential_1 (i32) -> ()
	.local  	i32
# %bb.0:
	local.get	0
	i32.load	12
	local.set	1
	block   	
	local.get	1
	i32.const	-4
	i32.add 
	i32.load	0
	i32.load	40
	i32.const	131072
	i32.and 
	br_if   	0                               # 0: down to label12
# %bb.1:
	local.get	0
	local.get	1
	local.get	1
	i32.const	-4
	i32.add 
	i32.load	0
	i32.load	4
	call_indirect	 __indirect_function_table, (i32, i32) -> ()
	return
.LBB14_2:
	end_block                               # label12:
	local.get	0
	i32.load	0
	call	swift_release
	return
	end_function
.Ltmp20:
.Lfunc_end14:
                                        # -- End function
	.section	".text.$sSa12_endMutationyyF","G",@,"$sSa12_endMutationyyF",comdat
	.hidden	$sSa12_endMutationyyF           # -- Begin function $sSa12_endMutationyyF
	.weak	$sSa12_endMutationyyF
	.type	$sSa12_endMutationyyF,@function
$sSa12_endMutationyyF:                  # @"$sSa12_endMutationyyF"
.Lfunc_begin15:
	.loc	2 0 0                           # <compiler-generated>:0:0
	.functype	$sSa12_endMutationyyF (i32, i32, i32) -> ()
# %bb.0:
	local.get	1
	local.get	1
	i32.load	0
	i32.store	0
	return
	end_function
.Ltmp21:
.Lfunc_end15:
                                        # -- End function
	.hidden	$s4main6shapesSayAA5Shape_pGvp  # @"$s4main6shapesSayAA5Shape_pGvp"
	.type	$s4main6shapesSayAA5Shape_pGvp,@object
	.section	".bss.$s4main6shapesSayAA5Shape_pGvp","R",@
	.globl	$s4main6shapesSayAA5Shape_pGvp
	.p2align	2, 0x0
$s4main6shapesSayAA5Shape_pGvp:
	.skip	4
	.size	$s4main6shapesSayAA5Shape_pGvp, 4

	.hidden	$s4main5totalSdvp               # @"$s4main5totalSdvp"
	.type	$s4main5totalSdvp,@object
	.section	".bss.$s4main5totalSdvp","R",@
	.globl	$s4main5totalSdvp
	.p2align	3, 0x0
$s4main5totalSdvp:
	.skip	8
	.size	$s4main5totalSdvp, 8

	.type	.Lgot.$s4main5ShapeMp,@object   # @"got.$s4main5ShapeMp"
	.section	".data.rel.ro..Lgot.$s4main5ShapeMp","",@
	.p2align	2, 0x0
.Lgot.$s4main5ShapeMp:
	.int32	$s4main5ShapeMp
	.size	.Lgot.$s4main5ShapeMp, 4

	.hidden	"symbolic ______p 4main5ShapeP" # @"symbolic ______p 4main5ShapeP"
	.type	"symbolic ______p 4main5ShapeP",@object
	.section	swift5_typeref,"G",@,"symbolic ______p 4main5ShapeP",comdat
	.weak	"symbolic ______p 4main5ShapeP"
	.p2align	1, 0x0
"symbolic ______p 4main5ShapeP":
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main5ShapeMp-"symbolic ______p 4main5ShapeP"-1
	.ascii	"_p"
	.int8	0                               # 0x0
	.size	"symbolic ______p 4main5ShapeP", 8

	.hidden	$s4main5Shape_pMD               # @"$s4main5Shape_pMD"
	.type	$s4main5Shape_pMD,@object
	.section	".data.$s4main5Shape_pMD","G",@,"$s4main5Shape_pMD",comdat
	.weak	$s4main5Shape_pMD
	.p2align	3, 0x0
$s4main5Shape_pMD:
	.int32	"symbolic ______p 4main5ShapeP"-$s4main5Shape_pMD
	.int32	4294967289                      # 0xfffffff9
	.size	$s4main5Shape_pMD, 8

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

	.hidden	"symbolic Say______pG 4main5ShapeP" # @"symbolic Say______pG 4main5ShapeP"
	.type	"symbolic Say______pG 4main5ShapeP",@object
	.section	swift5_typeref,"G",@,"symbolic Say______pG 4main5ShapeP",comdat
	.weak	"symbolic Say______pG 4main5ShapeP"
	.p2align	1, 0x0
"symbolic Say______pG 4main5ShapeP":
	.ascii	"Say"
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main5ShapeMp-"symbolic Say______pG 4main5ShapeP"-4
	.ascii	"_pG"
	.int8	0                               # 0x0
	.size	"symbolic Say______pG 4main5ShapeP", 12

	.hidden	$sSay4main5Shape_pGMD           # @"$sSay4main5Shape_pGMD"
	.type	$sSay4main5Shape_pGMD,@object
	.section	".data.$sSay4main5Shape_pGMD","G",@,"$sSay4main5Shape_pGMD",comdat
	.weak	$sSay4main5Shape_pGMD
	.p2align	3, 0x0
$sSay4main5Shape_pGMD:
	.int32	"symbolic Say______pG 4main5ShapeP"-$sSay4main5Shape_pGMD
	.int32	4294967285                      # 0xfffffff5
	.size	$sSay4main5Shape_pGMD, 8

	.hidden	$sSay4main5Shape_pGSayxGSlsWL   # @"$sSay4main5Shape_pGSayxGSlsWL"
	.type	$sSay4main5Shape_pGSayxGSlsWL,@object
	.section	".bss.$sSay4main5Shape_pGSayxGSlsWL","G",@,"$sSay4main5Shape_pGSayxGSlsWL",comdat
	.weak	$sSay4main5Shape_pGSayxGSlsWL
	.p2align	2, 0x0
$sSay4main5Shape_pGSayxGSlsWL:
	.int32	0
	.size	$sSay4main5Shape_pGSayxGSlsWL, 4

	.type	.Lgot.$ss16IndexingIteratorVMn,@object # @"got.$ss16IndexingIteratorVMn"
	.section	".data.rel.ro..Lgot.$ss16IndexingIteratorVMn","",@
	.p2align	2, 0x0
.Lgot.$ss16IndexingIteratorVMn:
	.int32	$ss16IndexingIteratorVMn
	.size	.Lgot.$ss16IndexingIteratorVMn, 4

	.hidden	"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP" # @"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP"
	.type	"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP",@object
	.section	swift5_typeref,"G",@,"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP",comdat
	.weak	"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP"
	.p2align	1, 0x0
"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP":
	.int8	2                               # 0x2
	.int32	.Lgot.$ss16IndexingIteratorVMn-"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP"-1
	.ascii	"ySay"
	.int8	2                               # 0x2
	.int32	.Lgot.$s4main5ShapeMp-"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP"-10
	.ascii	"_pGG"
	.int8	0                               # 0x0
	.size	"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP", 19

	.hidden	$ss16IndexingIteratorVySay4main5Shape_pGGMD # @"$ss16IndexingIteratorVySay4main5Shape_pGGMD"
	.type	$ss16IndexingIteratorVySay4main5Shape_pGGMD,@object
	.section	".data.$ss16IndexingIteratorVySay4main5Shape_pGGMD","G",@,"$ss16IndexingIteratorVySay4main5Shape_pGGMD",comdat
	.weak	$ss16IndexingIteratorVySay4main5Shape_pGGMD
	.p2align	3, 0x0
$ss16IndexingIteratorVySay4main5Shape_pGGMD:
	.int32	"symbolic _____ySay______pGG s16IndexingIteratorV 4main5ShapeP"-$ss16IndexingIteratorVySay4main5Shape_pGGMD
	.int32	4294967278                      # 0xffffffee
	.size	$ss16IndexingIteratorVySay4main5Shape_pGGMD, 8

	.type	".L.str.11.total area ",@object # @".str.11.total area "
	.section	".rodata..L.str.11.total area ","S",@
".L.str.11.total area ":
	.asciz	"total area "
	.size	".L.str.11.total area ", 12

	.type	.L.str.0.,@object               # @.str.0.
	.section	.rodata..L.str.0.,"S",@
.L.str.0.:
	.skip	1
	.size	.L.str.0., 1

	.type	l_entry_point,@object           # @"\01l_entry_point"
	.section	swift5_entry,"R",@
	.p2align	2, 0x0
l_entry_point:
	.int32	__main_argc_argv
	.int32	0                               # 0x0
	.size	l_entry_point, 8

	.type	".L.str.1.\n",@object           # @".str.1.\0A"
	.section	".rodata..L.str.1.
","S",@
".L.str.1.\n":
	.asciz	"\n"
	.size	".L.str.1.\n", 2

	.type	".L.str.1. ",@object            # @".str.1. "
	.section	".rodata..L.str.1. ","S",@
".L.str.1. ":
	.asciz	" "
	.size	".L.str.1. ", 2

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
	.asciz	"-lswiftSwiftOnoneSupport\000-lswiftCore\000-lswift_Concurrency\000-lswift_StringProcessing\000-lswift_RegexParser"
	.size	.L_swift1_autolink_entries, 102

	.no_dead_strip	$s4main6shapesSayAA5Shape_pGvp
	.no_dead_strip	$s4main5totalSdvp
	.no_dead_strip	__main_argc_argv
	.no_dead_strip	l__swift5_reflection_descriptor
	.no_dead_strip	l__swift5_reflection_descriptor.1
	.no_dead_strip	l_entry_point
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
	.ascii	"\345\177"                      # DW_AT_APPLE_major_runtime_vers
	.int8	11                              # DW_FORM_data1
	.int8	17                              # DW_AT_low_pc
	.int8	1                               # DW_FORM_addr
	.int8	85                              # DW_AT_ranges
	.int8	23                              # DW_FORM_sec_offset
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	2                               # Abbreviation Code
	.int8	30                              # DW_TAG_module
	.int8	0                               # DW_CHILDREN_no
	.int8	3                               # DW_AT_name
	.int8	14                              # DW_FORM_strp
	.ascii	"\200|"                         # DW_AT_LLVM_include_path
	.int8	14                              # DW_FORM_strp
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	3                               # Abbreviation Code
	.int8	58                              # DW_TAG_imported_module
	.int8	0                               # DW_CHILDREN_no
	.int8	24                              # DW_AT_import
	.int8	19                              # DW_FORM_ref4
	.int8	0                               # EOM(1)
	.int8	0                               # EOM(2)
	.int8	4                               # Abbreviation Code
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
	.int8	1                               # Abbrev [1] 0xb:0x75 DW_TAG_compile_unit
	.int32	.Linfo_string0                  # DW_AT_producer
	.int16	30                              # DW_AT_language
	.int32	.Linfo_string1                  # DW_AT_name
	.int32	.Linfo_string2                  # DW_AT_LLVM_sysroot
	.int32	.Lline_table_start0             # DW_AT_stmt_list
	.int32	.Linfo_string3                  # DW_AT_comp_dir
	.int8	6                               # DW_AT_APPLE_major_runtime_vers
	.int32	0                               # DW_AT_low_pc
	.int32	.Ldebug_ranges0                 # DW_AT_ranges
	.int8	2                               # Abbrev [2] 0x2b:0x9 DW_TAG_module
	.int32	.Linfo_string4                  # DW_AT_name
	.int32	.Linfo_string5                  # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x34:0x5 DW_TAG_imported_module
	.int32	43                              # DW_AT_import
	.int8	2                               # Abbrev [2] 0x39:0x9 DW_TAG_module
	.int32	.Linfo_string6                  # DW_AT_name
	.int32	.Linfo_string7                  # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x42:0x5 DW_TAG_imported_module
	.int32	57                              # DW_AT_import
	.int8	2                               # Abbrev [2] 0x47:0x9 DW_TAG_module
	.int32	.Linfo_string8                  # DW_AT_name
	.int32	.Linfo_string9                  # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x50:0x5 DW_TAG_imported_module
	.int32	71                              # DW_AT_import
	.int8	2                               # Abbrev [2] 0x55:0x9 DW_TAG_module
	.int32	.Linfo_string10                 # DW_AT_name
	.int32	.Linfo_string11                 # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x5e:0x5 DW_TAG_imported_module
	.int32	85                              # DW_AT_import
	.int8	2                               # Abbrev [2] 0x63:0x9 DW_TAG_module
	.int32	.Linfo_string12                 # DW_AT_name
	.int32	.Linfo_string13                 # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x6c:0x5 DW_TAG_imported_module
	.int32	99                              # DW_AT_import
	.int8	2                               # Abbrev [2] 0x71:0x9 DW_TAG_module
	.int32	.Linfo_string14                 # DW_AT_name
	.int32	.Linfo_string15                 # DW_AT_LLVM_include_path
	.int8	3                               # Abbrev [3] 0x7a:0x5 DW_TAG_imported_module
	.int32	113                             # DW_AT_import
	.int8	0                               # End Of Children Mark
.Ldebug_info_end0:
.Lcu_begin1:
	.int32	.Ldebug_info_end1-.Ldebug_info_start1 # Length of Unit
.Ldebug_info_start1:
	.int16	4                               # DWARF version number
	.int32	.debug_abbrev0                  # Offset Into Abbrev. Section
	.int8	4                               # Address Size (in bytes)
	.int8	4                               # Abbrev [4] 0xb:0x1f DW_TAG_compile_unit
	.int32	.Linfo_string0                  # DW_AT_producer
	.int16	12                              # DW_AT_language
	.int32	.Linfo_string10                 # DW_AT_name
	.int32	.Lline_table_start0             # DW_AT_stmt_list
	.int32	.Linfo_string11                 # DW_AT_comp_dir
                                        # DW_AT_APPLE_optimized
	.int64	6027681238906438627             # DW_AT_GNU_dwo_id
	.int32	.Linfo_string16                 # DW_AT_GNU_dwo_name
.Ldebug_info_end1:
	.section	.debug_ranges,"",@
.Ldebug_ranges0:
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
	.int32	.Lfunc_begin7
	.int32	.Lfunc_end7
	.int32	.Lfunc_begin8
	.int32	.Lfunc_end8
	.int32	.Lfunc_begin9
	.int32	.Lfunc_end9
	.int32	.Lfunc_begin10
	.int32	.Lfunc_end10
	.int32	.Lfunc_begin11
	.int32	.Lfunc_end11
	.int32	.Lfunc_begin12
	.int32	.Lfunc_end12
	.int32	.Lfunc_begin13
	.int32	.Lfunc_end13
	.int32	.Lfunc_begin14
	.int32	.Lfunc_end14
	.int32	.Lfunc_begin15
	.int32	.Lfunc_end15
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
	.asciz	"main"                          # string offset=88
.Linfo_string5:
	.asciz	"/workspace"                    # string offset=93
.Linfo_string6:
	.asciz	"Swift"                         # string offset=104
.Linfo_string7:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/Swift.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=110
.Linfo_string8:
	.asciz	"_StringProcessing"             # string offset=199
.Linfo_string9:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/_StringProcessing.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=217
.Linfo_string10:
	.asciz	"_SwiftConcurrencyShims"        # string offset=318
.Linfo_string11:
	.asciz	"/sysroot/swift/lib/swift_static/shims" # string offset=341
.Linfo_string12:
	.asciz	"_Concurrency"                  # string offset=379
.Linfo_string13:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/_Concurrency.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=392
.Linfo_string14:
	.asciz	"SwiftOnoneSupport"             # string offset=488
.Linfo_string15:
	.asciz	"/sysroot/swift/lib/swift_static/wasi/SwiftOnoneSupport.swiftmodule/wasm32-unknown-wasip1.swiftmodule" # string offset=506
.Linfo_string16:
	.asciz	"/tmp/module-cache/212M2AB45HF5T/_SwiftConcurrencyShims-31O3Y2F55MJEQ.pcm" # string offset=607
	.section	.debug_names,"",@
	.int32	.Lnames_end0-.Lnames_start0     # Header: unit length
.Lnames_start0:
	.int16	5                               # Header: version
	.int16	0                               # Header: padding
	.int32	2                               # Header: compilation unit count
	.int32	0                               # Header: local type unit count
	.int32	0                               # Header: foreign type unit count
	.int32	1                               # Header: bucket count
	.int32	0                               # Header: name count
	.int32	.Lnames_abbrev_end0-.Lnames_abbrev_start0 # Header: abbreviation table size
	.int32	8                               # Header: augmentation string size
	.ascii	"LLVM0700"                      # Header: augmentation string
	.int32	.Lcu_begin0                     # Compilation unit 0
	.int32	.Lcu_begin1                     # Compilation unit 1
	.int32	0                               # Bucket 0
.Lnames_abbrev_start0:
	.int8	0                               # End of abbrev list
.Lnames_abbrev_end0:
.Lnames_entries0:
	.p2align	2, 0x0
.Lnames_end0:
	.no_dead_strip	__indirect_function_table
	.size	$s4main5ShapeMp, 56
	.size	$s4main6CircleVN, 4
	.size	$s4main6CircleVAA5ShapeAAWP, 4
	.size	$s4main6SquareVN, 4
	.size	$s4main6SquareVAA5ShapeAAWP, 4
	.size	$sSayxGSlsMc, 16
	.size	$sSdN, 4
	.size	$sSds23CustomStringConvertiblesWP, 4
	.size	$sSds20TextOutputStreamablesWP, 4
	.size	$sSSN, 4
	.size	$sypN, 8
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
