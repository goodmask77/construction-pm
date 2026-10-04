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

## api/line-webhook.js（3 個口）

- `?ccdone=` 行 1884
- `?ccinbox=` 行 1878
- `?warm=` 行 1871

## api/mail-sync.js（118 個口）

- `?abatt=` 行 3024
- `?abmod=` 行 2969
- `?abmodset=` 行 2978
- `?abscan=` 行 1684
- `?absinc=` 行 1928
- `?aliasget=` 行 1407
- `?aliasset=` 行 1412
- `?bindcard=` 行 3264
- `?bindcode=` 行 424
- `?bossprobe=` 行 3246
- `?buy=` 行 3630
- `?buyadd=` 行 3638
- `?buyop=` 行 3657
- `?catprobe=` 行 873
- `?debug=` 行 3824
- `?delday=` 行 819
- `?dinefill=` 行 1373
- `?docgrep=` 行 839
- `?errlog=` 行 1639
- `?errs=` 行 1673
- `?fb=` 行 1828
- `?fbj=` 行 1845
- `?fbset=` 行 1868
- `?fc=` 行 1521
- `?fcadj=` 行 1607
- `?fcrun=` 行 1629
- `?fcso=` 行 1562
- `?fcsp=` 行 1587
- `?gdrole=` 行 1498, 2692
- `?gdstaff=` 行 1469
- `?hrdocdel=` 行 3091
- `?hrdocup=` 行 3048
- `?hrdocurl=` 行 3074
- `?hridlock=` 行 2703
- `?hrmaster=` 行 2871
- `?hrmasterset=` 行 3146
- `?hrmasterup=` 行 3108
- `?ichefpurge=` 行 1491
- `?ingest=` 行 459
- `?inv=` 行 2356
- `?invcount=` 行 2385
- `?invset=` 行 2363
- `?kvproxy=` 行 942
- `?labor=` 行 3185
- `?laborset=` 行 3191
- `?lb=` 行 2594
- `?liffauth=` 行 2856
- `?manifest=` 行 407
- `?meet=` 行 1945
- `?meetping=` 行 2769
- `?meetset=` 行 1956
- `?menu=` 行 1751
- `?menuen=` 行 593
- `?menuimgset=` 行 1777
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3781
- `?menuset=` 行 1799
- `?notifycfg=` 行 1445
- `?notifyset=` 行 1453
- `?ntf=` 行 2834
- `?ntfping=` 行 2843
- `?ntfread=` 行 2822
- `?opsboard=` 行 1115
- `?payset=` 行 3169
- `?phingest=` 行 645
- `?poshide=` 行 1732
- `?prepact=` 行 3328
- `?prepapply=` 行 2672
- `?prepfav=` 行 3394
- `?prephide=` 行 3378
- `?preplog=` 行 3370
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3284
- `?preppermset=` 行 2715
- `?priceset=` 行 1390
- `?punchfix=` 行 2045
- `?punchme=` 行 2034
- `?pushsub=` 行 2802
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3753
- `?shift=` 行 2063
- `?shiftcolor=` 行 2218
- `?shiftdedup=` 行 2252
- `?shiftfill=` 行 2230
- `?shiftset=` 行 2269
- `?sop=` 行 2402
- `?sopdone=` 行 3409
- `?sopedit=` 行 3451
- `?sopfull=` 行 3685
- `?sopissue=` 行 3556
- `?soprate=` 行 2649
- `?sopref=` 行 1907
- `?sopreport=` 行 3496
- `?sopresolve=` 行 3524
- `?sopreview=` 行 3733
- `?sopset=` 行 3437
- `?sopsign=` 行 3484
- `?sopst=` 行 2447
- `?sopstamp=` 行 1893
- `?sopsugset=` 行 2542
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1710
- `?tabset=` 行 1716
- `?taskadmin=` 行 1033
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1072
- `?txprobe=` 行 441
- `?vgo=` 行 2894
- `?viomgrs=` 行 2900
- `?vionotify=` 行 2917
- `?vioresset=` 行 2992
- `?webpushcfg=` 行 2797
- `?whoami=` 行 1102
