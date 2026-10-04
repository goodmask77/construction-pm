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

- `?ccdone=` 行 1859
- `?ccinbox=` 行 1853
- `?warm=` 行 1846

## api/mail-sync.js（115 個口）

- `?abatt=` 行 2940
- `?abscan=` 行 1646
- `?absinc=` 行 1890
- `?aliasget=` 行 1369
- `?aliasset=` 行 1374
- `?bindcard=` 行 3180
- `?bindcode=` 行 424
- `?bossprobe=` 行 3162
- `?buy=` 行 3546
- `?buyadd=` 行 3554
- `?buyop=` 行 3573
- `?catprobe=` 行 873
- `?debug=` 行 3740
- `?delday=` 行 819
- `?dinefill=` 行 1335
- `?docgrep=` 行 839
- `?errlog=` 行 1601
- `?errs=` 行 1635
- `?fb=` 行 1790
- `?fbj=` 行 1807
- `?fbset=` 行 1830
- `?fc=` 行 1483
- `?fcadj=` 行 1569
- `?fcrun=` 行 1591
- `?fcso=` 行 1524
- `?fcsp=` 行 1549
- `?gdrole=` 行 1460, 2631
- `?gdstaff=` 行 1431
- `?hrdocdel=` 行 3007
- `?hrdocup=` 行 2964
- `?hrdocurl=` 行 2990
- `?hridlock=` 行 2642
- `?hrmaster=` 行 2810
- `?hrmasterset=` 行 3062
- `?hrmasterup=` 行 3024
- `?ichefpurge=` 行 1453
- `?ingest=` 行 459
- `?inv=` 行 2308
- `?invcount=` 行 2337
- `?invset=` 行 2315
- `?kvproxy=` 行 942
- `?labor=` 行 3101
- `?laborset=` 行 3107
- `?lb=` 行 2546
- `?liffauth=` 行 2795
- `?manifest=` 行 407
- `?meet=` 行 1907
- `?meetping=` 行 2708
- `?meetset=` 行 1918
- `?menu=` 行 1713
- `?menuen=` 行 593
- `?menuimgset=` 行 1739
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3697
- `?menuset=` 行 1761
- `?notifycfg=` 行 1407
- `?notifyset=` 行 1415
- `?ntf=` 行 2773
- `?ntfping=` 行 2782
- `?ntfread=` 行 2761
- `?opsboard=` 行 1077
- `?payset=` 行 3085
- `?phingest=` 行 645
- `?poshide=` 行 1694
- `?prepact=` 行 3244
- `?prepapply=` 行 2611
- `?prepfav=` 行 3310
- `?prephide=` 行 3294
- `?preplog=` 行 3286
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3200
- `?preppermset=` 行 2654
- `?priceset=` 行 1352
- `?punchfix=` 行 2007
- `?punchme=` 行 1996
- `?pushsub=` 行 2741
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3669
- `?shift=` 行 2025
- `?shiftcolor=` 行 2170
- `?shiftdedup=` 行 2204
- `?shiftfill=` 行 2182
- `?shiftset=` 行 2221
- `?sop=` 行 2354
- `?sopdone=` 行 3325
- `?sopedit=` 行 3367
- `?sopfull=` 行 3601
- `?sopissue=` 行 3472
- `?soprate=` 行 2588
- `?sopref=` 行 1869
- `?sopreport=` 行 3412
- `?sopresolve=` 行 3440
- `?sopreview=` 行 3649
- `?sopset=` 行 3353
- `?sopsign=` 行 3400
- `?sopst=` 行 2399
- `?sopstamp=` 行 1855
- `?sopsugset=` 行 2494
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1672
- `?tabset=` 行 1678
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1034
- `?txprobe=` 行 441
- `?vgo=` 行 2833
- `?viomgrs=` 行 2839
- `?vionotify=` 行 2856
- `?vioresset=` 行 2908
- `?webpushcfg=` 行 2736
- `?whoami=` 行 1064
