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
- `?dry=` 行 372
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

- `?ccdone=` 行 1935
- `?ccinbox=` 行 1913
- `?ccstart=` 行 1927
- `?warm=` 行 1906

## api/mail-sync.js（122 個口）

- `?abatt=` 行 3154
- `?abmod=` 行 3098
- `?abmodset=` 行 3108
- `?abscan=` 行 1735
- `?absinc=` 行 1987
- `?aliasget=` 行 1448
- `?aliasset=` 行 1453
- `?animpref=` 行 1107
- `?animprefset=` 行 1115
- `?bindcard=` 行 3394
- `?bindcode=` 行 425
- `?bossprobe=` 行 3376
- `?buy=` 行 3766
- `?buyadd=` 行 3774
- `?buyop=` 行 3793
- `?catprobe=` 行 874
- `?debug=` 行 3960
- `?delday=` 行 820
- `?dinefill=` 行 1414
- `?docgrep=` 行 840
- `?errlog=` 行 1690
- `?errs=` 行 1724
- `?fb=` 行 1887
- `?fbj=` 行 1904
- `?fbset=` 行 1927
- `?fc=` 行 1572
- `?fcadj=` 行 1658
- `?fcrun=` 行 1680
- `?fcso=` 行 1613
- `?fcsp=` 行 1638
- `?gdrole=` 行 1549, 2800
- `?gdstaff=` 行 1520
- `?hrdocdel=` 行 3221
- `?hrdocup=` 行 3178
- `?hrdocurl=` 行 3204
- `?hridlock=` 行 2811
- `?hrmaster=` 行 3000
- `?hrmasterset=` 行 3276
- `?hrmasterup=` 行 3238
- `?ichefpurge=` 行 1542
- `?ingest=` 行 460
- `?inv=` 行 2464
- `?invcount=` 行 2493
- `?invset=` 行 2471
- `?kvproxy=` 行 943
- `?labor=` 行 3315
- `?laborset=` 行 3321
- `?lb=` 行 2702
- `?liffauth=` 行 2985
- `?manifest=` 行 408
- `?meet=` 行 2004
- `?meetping=` 行 2877
- `?meetset=` 行 2015
- `?menu=` 行 1802
- `?menuen=` 行 594
- `?menuimgset=` 行 1828
- `?menumv=` 行 626
- `?menunote=` 行 611
- `?menuprobe=` 行 3917
- `?menuset=` 行 1850
- `?notifyadmin=` 行 1495
- `?notifycfg=` 行 1486
- `?notifyset=` 行 1504
- `?ntf=` 行 2942
- `?ntfpin=` 行 2955
- `?ntfping=` 行 2972
- `?ntfread=` 行 2930
- `?opsboard=` 行 1142
- `?payset=` 行 3299
- `?phingest=` 行 646
- `?poshide=` 行 1783
- `?prepact=` 行 3458
- `?prepapply=` 行 2780
- `?prepfav=` 行 3524
- `?prephide=` 行 3508
- `?preplog=` 行 3500
- `?prepmigrate=` 行 907
- `?prepperm=` 行 3414
- `?preppermset=` 行 2823
- `?priceset=` 行 1431
- `?punchfix=` 行 2153
- `?punchme=` 行 2142
- `?pushsub=` 行 2910
- `?revprobe=` 行 863
- `?rosterprobe=` 行 887
- `?rosterset=` 行 3889
- `?shift=` 行 2171
- `?shiftcolor=` 行 2326
- `?shiftdedup=` 行 2360
- `?shiftfill=` 行 2338
- `?shiftset=` 行 2377
- `?sop=` 行 2510
- `?sopdone=` 行 3539
- `?sopedit=` 行 3581
- `?sopfull=` 行 3821
- `?sopissue=` 行 3692
- `?soprate=` 行 2757
- `?sopref=` 行 1966
- `?sopreport=` 行 3626
- `?sopresolve=` 行 3660
- `?sopreview=` 行 3869
- `?sopset=` 行 3567
- `?sopsign=` 行 3614
- `?sopst=` 行 2555
- `?sopstamp=` 行 1952
- `?sopsugset=` 行 2650
- `?supplyingest=` 行 674
- `?supplyreset=` 行 535
- `?tabcfg=` 行 1761
- `?tabset=` 行 1767
- `?taskadmin=` 行 1034
- `?taskfill=` 行 495
- `?taskmove=` 行 474
- `?tasknotify=` 行 974
- `?twhol=` 行 1077
- `?txprobe=` 行 442
- `?vgo=` 行 3023
- `?viomgrs=` 行 3029
- `?vionotify=` 行 3046
- `?vioresset=` 行 3122
- `?webpushcfg=` 行 2905
- `?whoami=` 行 1129
