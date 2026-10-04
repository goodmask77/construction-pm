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

- `?abatt=` 行 3070
- `?abmod=` 行 3014
- `?abmodset=` 行 3024
- `?abscan=` 行 1710
- `?absinc=` 行 1954
- `?aliasget=` 行 1433
- `?aliasset=` 行 1438
- `?animpref=` 行 1106
- `?animprefset=` 行 1114
- `?bindcard=` 行 3310
- `?bindcode=` 行 424
- `?bossprobe=` 行 3292
- `?buy=` 行 3676
- `?buyadd=` 行 3684
- `?buyop=` 行 3703
- `?catprobe=` 行 873
- `?debug=` 行 3870
- `?delday=` 行 819
- `?dinefill=` 行 1399
- `?docgrep=` 行 839
- `?errlog=` 行 1665
- `?errs=` 行 1699
- `?fb=` 行 1854
- `?fbj=` 行 1871
- `?fbset=` 行 1894
- `?fc=` 行 1547
- `?fcadj=` 行 1633
- `?fcrun=` 行 1655
- `?fcso=` 行 1588
- `?fcsp=` 行 1613
- `?gdrole=` 行 1524, 2737
- `?gdstaff=` 行 1495
- `?hrdocdel=` 行 3137
- `?hrdocup=` 行 3094
- `?hrdocurl=` 行 3120
- `?hridlock=` 行 2748
- `?hrmaster=` 行 2916
- `?hrmasterset=` 行 3192
- `?hrmasterup=` 行 3154
- `?ichefpurge=` 行 1517
- `?ingest=` 行 459
- `?inv=` 行 2401
- `?invcount=` 行 2430
- `?invset=` 行 2408
- `?kvproxy=` 行 942
- `?labor=` 行 3231
- `?laborset=` 行 3237
- `?lb=` 行 2639
- `?liffauth=` 行 2901
- `?manifest=` 行 407
- `?meet=` 行 1971
- `?meetping=` 行 2814
- `?meetset=` 行 1982
- `?menu=` 行 1777
- `?menuen=` 行 593
- `?menuimgset=` 行 1803
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3827
- `?menuset=` 行 1825
- `?notifycfg=` 行 1471
- `?notifyset=` 行 1479
- `?ntf=` 行 2879
- `?ntfping=` 行 2888
- `?ntfread=` 行 2867
- `?opsboard=` 行 1141
- `?payset=` 行 3215
- `?phingest=` 行 645
- `?poshide=` 行 1758
- `?prepact=` 行 3374
- `?prepapply=` 行 2717
- `?prepfav=` 行 3440
- `?prephide=` 行 3424
- `?preplog=` 行 3416
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3330
- `?preppermset=` 行 2760
- `?priceset=` 行 1416
- `?punchfix=` 行 2090
- `?punchme=` 行 2079
- `?pushsub=` 行 2847
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3799
- `?shift=` 行 2108
- `?shiftcolor=` 行 2263
- `?shiftdedup=` 行 2297
- `?shiftfill=` 行 2275
- `?shiftset=` 行 2314
- `?sop=` 行 2447
- `?sopdone=` 行 3455
- `?sopedit=` 行 3497
- `?sopfull=` 行 3731
- `?sopissue=` 行 3602
- `?soprate=` 行 2694
- `?sopref=` 行 1933
- `?sopreport=` 行 3542
- `?sopresolve=` 行 3570
- `?sopreview=` 行 3779
- `?sopset=` 行 3483
- `?sopsign=` 行 3530
- `?sopst=` 行 2492
- `?sopstamp=` 行 1919
- `?sopsugset=` 行 2587
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1736
- `?tabset=` 行 1742
- `?taskadmin=` 行 1033
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1076
- `?txprobe=` 行 441
- `?vgo=` 行 2939
- `?viomgrs=` 行 2945
- `?vionotify=` 行 2962
- `?vioresset=` 行 3038
- `?webpushcfg=` 行 2842
- `?whoami=` 行 1128
