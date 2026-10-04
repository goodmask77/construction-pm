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
- `?dry=` 行 370
- `?viotest=` 行 204

## api/hr.js（2 個口）

- `?payroll=` 行 190
- `?shifts=` 行 197

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

## api/line-webhook.js（4 個口）

- `?ccdone=` 行 1900
- `?ccinbox=` 行 1878
- `?ccstart=` 行 1892
- `?warm=` 行 1871

## api/mail-sync.js（120 個口）

- `?abatt=` 行 3047
- `?abmod=` 行 2991
- `?abmodset=` 行 3001
- `?abscan=` 行 1706
- `?absinc=` 行 1950
- `?aliasget=` 行 1429
- `?aliasset=` 行 1434
- `?animpref=` 行 1102
- `?animprefset=` 行 1110
- `?bindcard=` 行 3287
- `?bindcode=` 行 424
- `?bossprobe=` 行 3269
- `?buy=` 行 3653
- `?buyadd=` 行 3661
- `?buyop=` 行 3680
- `?catprobe=` 行 873
- `?debug=` 行 3847
- `?delday=` 行 819
- `?dinefill=` 行 1395
- `?docgrep=` 行 839
- `?errlog=` 行 1661
- `?errs=` 行 1695
- `?fb=` 行 1850
- `?fbj=` 行 1867
- `?fbset=` 行 1890
- `?fc=` 行 1543
- `?fcadj=` 行 1629
- `?fcrun=` 行 1651
- `?fcso=` 行 1584
- `?fcsp=` 行 1609
- `?gdrole=` 行 1520, 2714
- `?gdstaff=` 行 1491
- `?hrdocdel=` 行 3114
- `?hrdocup=` 行 3071
- `?hrdocurl=` 行 3097
- `?hridlock=` 行 2725
- `?hrmaster=` 行 2893
- `?hrmasterset=` 行 3169
- `?hrmasterup=` 行 3131
- `?ichefpurge=` 行 1513
- `?ingest=` 行 459
- `?inv=` 行 2378
- `?invcount=` 行 2407
- `?invset=` 行 2385
- `?kvproxy=` 行 942
- `?labor=` 行 3208
- `?laborset=` 行 3214
- `?lb=` 行 2616
- `?liffauth=` 行 2878
- `?manifest=` 行 407
- `?meet=` 行 1967
- `?meetping=` 行 2791
- `?meetset=` 行 1978
- `?menu=` 行 1773
- `?menuen=` 行 593
- `?menuimgset=` 行 1799
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3804
- `?menuset=` 行 1821
- `?notifycfg=` 行 1467
- `?notifyset=` 行 1475
- `?ntf=` 行 2856
- `?ntfping=` 行 2865
- `?ntfread=` 行 2844
- `?opsboard=` 行 1137
- `?payset=` 行 3192
- `?phingest=` 行 645
- `?poshide=` 行 1754
- `?prepact=` 行 3351
- `?prepapply=` 行 2694
- `?prepfav=` 行 3417
- `?prephide=` 行 3401
- `?preplog=` 行 3393
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3307
- `?preppermset=` 行 2737
- `?priceset=` 行 1412
- `?punchfix=` 行 2067
- `?punchme=` 行 2056
- `?pushsub=` 行 2824
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3776
- `?shift=` 行 2085
- `?shiftcolor=` 行 2240
- `?shiftdedup=` 行 2274
- `?shiftfill=` 行 2252
- `?shiftset=` 行 2291
- `?sop=` 行 2424
- `?sopdone=` 行 3432
- `?sopedit=` 行 3474
- `?sopfull=` 行 3708
- `?sopissue=` 行 3579
- `?soprate=` 行 2671
- `?sopref=` 行 1929
- `?sopreport=` 行 3519
- `?sopresolve=` 行 3547
- `?sopreview=` 行 3756
- `?sopset=` 行 3460
- `?sopsign=` 行 3507
- `?sopst=` 行 2469
- `?sopstamp=` 行 1915
- `?sopsugset=` 行 2564
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1732
- `?tabset=` 行 1738
- `?taskadmin=` 行 1033
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1072
- `?txprobe=` 行 441
- `?vgo=` 行 2916
- `?viomgrs=` 行 2922
- `?vionotify=` 行 2939
- `?vioresset=` 行 3015
- `?webpushcfg=` 行 2819
- `?whoami=` 行 1124
