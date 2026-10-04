# API 端點目錄（自動產生，別手改）

`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。

## api/boss-sync.js（5 個口）

- `?bosspeek=` 行 68
- `?bossraw=` 行 80
- `?fillpos=` 行 105
- `?histfill=` 行 93
- `?ping=` 行 62

## api/cron-daily.js（1 個口）

- `?dry=` 行 241

## api/hr.js（1 個口）

- `?shifts=` 行 163

## api/inline-sync.js（8 個口）

- `?backfill=` 行 307
- `?custbuild=` 行 254
- `?custdb=` 行 231
- `?custfind=` 行 245
- `?custinsights=` 行 239
- `?custtop=` 行 267
- `?kwsearch=` 行 260
- `?probe=` 行 224

## api/line-webhook.js（3 個口）

- `?ccdone=` 行 1858
- `?ccinbox=` 行 1852
- `?warm=` 行 1845

## api/mail-sync.js（110 個口）

- `?abscan=` 行 1636
- `?absinc=` 行 1880
- `?aliasget=` 行 1359
- `?aliasset=` 行 1364
- `?bindcard=` 行 3026
- `?bindcode=` 行 424
- `?bossprobe=` 行 3008
- `?buy=` 行 3392
- `?buyadd=` 行 3400
- `?buyop=` 行 3419
- `?catprobe=` 行 873
- `?debug=` 行 3586
- `?delday=` 行 819
- `?dinefill=` 行 1325
- `?docgrep=` 行 839
- `?errlog=` 行 1591
- `?errs=` 行 1625
- `?fb=` 行 1780
- `?fbj=` 行 1797
- `?fbset=` 行 1820
- `?fc=` 行 1473
- `?fcadj=` 行 1559
- `?fcrun=` 行 1581
- `?fcso=` 行 1514
- `?fcsp=` 行 1539
- `?gdrole=` 行 1450, 2620
- `?gdstaff=` 行 1421
- `?hrdocdel=` 行 2866
- `?hrdocup=` 行 2824
- `?hrdocurl=` 行 2850
- `?hridlock=` 行 2631
- `?hrmaster=` 行 2799
- `?hrmasterset=` 行 2921
- `?hrmasterup=` 行 2883
- `?ichefpurge=` 行 1443
- `?ingest=` 行 459
- `?inv=` 行 2297
- `?invcount=` 行 2326
- `?invset=` 行 2304
- `?kvproxy=` 行 942
- `?labor=` 行 2947
- `?laborset=` 行 2953
- `?lb=` 行 2535
- `?liffauth=` 行 2784
- `?manifest=` 行 407
- `?meet=` 行 1897
- `?meetping=` 行 2697
- `?meetset=` 行 1908
- `?menu=` 行 1703
- `?menuen=` 行 593
- `?menuimgset=` 行 1729
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3543
- `?menuset=` 行 1751
- `?notifycfg=` 行 1397
- `?notifyset=` 行 1405
- `?ntf=` 行 2762
- `?ntfping=` 行 2771
- `?ntfread=` 行 2750
- `?opsboard=` 行 1067
- `?payset=` 行 2931
- `?phingest=` 行 645
- `?poshide=` 行 1684
- `?prepact=` 行 3090
- `?prepapply=` 行 2600
- `?prepfav=` 行 3156
- `?prephide=` 行 3140
- `?preplog=` 行 3132
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3046
- `?preppermset=` 行 2643
- `?priceset=` 行 1342
- `?punchfix=` 行 1997
- `?punchme=` 行 1986
- `?pushsub=` 行 2730
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3515
- `?shift=` 行 2015
- `?shiftcolor=` 行 2159
- `?shiftdedup=` 行 2193
- `?shiftfill=` 行 2171
- `?shiftset=` 行 2210
- `?sop=` 行 2343
- `?sopdone=` 行 3171
- `?sopedit=` 行 3213
- `?sopfull=` 行 3447
- `?sopissue=` 行 3318
- `?soprate=` 行 2577
- `?sopref=` 行 1859
- `?sopreport=` 行 3258
- `?sopresolve=` 行 3286
- `?sopreview=` 行 3495
- `?sopset=` 行 3199
- `?sopsign=` 行 3246
- `?sopst=` 行 2388
- `?sopstamp=` 行 1845
- `?sopsugset=` 行 2483
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1662
- `?tabset=` 行 1668
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1025
- `?txprobe=` 行 441
- `?webpushcfg=` 行 2725
- `?whoami=` 行 1054
