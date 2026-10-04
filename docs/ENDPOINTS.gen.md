# API 端點目錄（自動產生，別手改）

`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。

## api/boss-sync.js（5 個口）

- `?bosspeek=` 行 89
- `?bossraw=` 行 101
- `?fillpos=` 行 126
- `?histfill=` 行 114
- `?ping=` 行 83

## api/cron-daily.js（3 個口）

- `?bdaytest=` 行 244
- `?dry=` 行 361
- `?viotest=` 行 204

## api/hr.js（1 個口）

- `?shifts=` 行 163

## api/inline-sync.js（9 個口）

- `?backfill=` 行 326
- `?custbuild=` 行 273
- `?custdb=` 行 242
- `?custfind=` 行 264
- `?custinsights=` 行 250
- `?custnr=` 行 256
- `?custtop=` 行 286
- `?kwsearch=` 行 279
- `?probe=` 行 235

## api/line-webhook.js（3 個口）

- `?ccdone=` 行 1884
- `?ccinbox=` 行 1878
- `?warm=` 行 1871

## api/mail-sync.js（118 個口）

- `?abatt=` 行 3013
- `?abmod=` 行 2958
- `?abmodset=` 行 2967
- `?abscan=` 行 1683
- `?absinc=` 行 1927
- `?aliasget=` 行 1406
- `?aliasset=` 行 1411
- `?bindcard=` 行 3253
- `?bindcode=` 行 424
- `?bossprobe=` 行 3235
- `?buy=` 行 3619
- `?buyadd=` 行 3627
- `?buyop=` 行 3646
- `?catprobe=` 行 873
- `?debug=` 行 3813
- `?delday=` 行 819
- `?dinefill=` 行 1372
- `?docgrep=` 行 839
- `?errlog=` 行 1638
- `?errs=` 行 1672
- `?fb=` 行 1827
- `?fbj=` 行 1844
- `?fbset=` 行 1867
- `?fc=` 行 1520
- `?fcadj=` 行 1606
- `?fcrun=` 行 1628
- `?fcso=` 行 1561
- `?fcsp=` 行 1586
- `?gdrole=` 行 1497, 2681
- `?gdstaff=` 行 1468
- `?hrdocdel=` 行 3080
- `?hrdocup=` 行 3037
- `?hrdocurl=` 行 3063
- `?hridlock=` 行 2692
- `?hrmaster=` 行 2860
- `?hrmasterset=` 行 3135
- `?hrmasterup=` 行 3097
- `?ichefpurge=` 行 1490
- `?ingest=` 行 459
- `?inv=` 行 2345
- `?invcount=` 行 2374
- `?invset=` 行 2352
- `?kvproxy=` 行 942
- `?labor=` 行 3174
- `?laborset=` 行 3180
- `?lb=` 行 2583
- `?liffauth=` 行 2845
- `?manifest=` 行 407
- `?meet=` 行 1944
- `?meetping=` 行 2758
- `?meetset=` 行 1955
- `?menu=` 行 1750
- `?menuen=` 行 593
- `?menuimgset=` 行 1776
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3770
- `?menuset=` 行 1798
- `?notifycfg=` 行 1444
- `?notifyset=` 行 1452
- `?ntf=` 行 2823
- `?ntfping=` 行 2832
- `?ntfread=` 行 2811
- `?opsboard=` 行 1114
- `?payset=` 行 3158
- `?phingest=` 行 645
- `?poshide=` 行 1731
- `?prepact=` 行 3317
- `?prepapply=` 行 2661
- `?prepfav=` 行 3383
- `?prephide=` 行 3367
- `?preplog=` 行 3359
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3273
- `?preppermset=` 行 2704
- `?priceset=` 行 1389
- `?punchfix=` 行 2044
- `?punchme=` 行 2033
- `?pushsub=` 行 2791
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3742
- `?shift=` 行 2062
- `?shiftcolor=` 行 2207
- `?shiftdedup=` 行 2241
- `?shiftfill=` 行 2219
- `?shiftset=` 行 2258
- `?sop=` 行 2391
- `?sopdone=` 行 3398
- `?sopedit=` 行 3440
- `?sopfull=` 行 3674
- `?sopissue=` 行 3545
- `?soprate=` 行 2638
- `?sopref=` 行 1906
- `?sopreport=` 行 3485
- `?sopresolve=` 行 3513
- `?sopreview=` 行 3722
- `?sopset=` 行 3426
- `?sopsign=` 行 3473
- `?sopst=` 行 2436
- `?sopstamp=` 行 1892
- `?sopsugset=` 行 2531
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1709
- `?tabset=` 行 1715
- `?taskadmin=` 行 1033
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1071
- `?txprobe=` 行 441
- `?vgo=` 行 2883
- `?viomgrs=` 行 2889
- `?vionotify=` 行 2906
- `?vioresset=` 行 2981
- `?webpushcfg=` 行 2786
- `?whoami=` 行 1101
