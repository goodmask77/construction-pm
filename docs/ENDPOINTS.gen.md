# API 端點目錄（自動產生，別手改）

`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。

## api/boss-sync.js（5 個口）

- `?bosspeek=` 行 68
- `?bossraw=` 行 80
- `?fillpos=` 行 105
- `?histfill=` 行 93
- `?ping=` 行 62

## api/cron-daily.js（3 個口）

- `?bdaytest=` 行 217
- `?dry=` 行 334
- `?viotest=` 行 177

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

## api/mail-sync.js（111 個口）

- `?abatt=` 行 2832
- `?abscan=` 行 1646
- `?absinc=` 行 1890
- `?aliasget=` 行 1369
- `?aliasset=` 行 1374
- `?bindcard=` 行 3071
- `?bindcode=` 行 424
- `?bossprobe=` 行 3053
- `?buy=` 行 3437
- `?buyadd=` 行 3445
- `?buyop=` 行 3464
- `?catprobe=` 行 873
- `?debug=` 行 3631
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
- `?gdrole=` 行 1460, 2630
- `?gdstaff=` 行 1431
- `?hrdocdel=` 行 2898
- `?hrdocup=` 行 2856
- `?hrdocurl=` 行 2882
- `?hridlock=` 行 2641
- `?hrmaster=` 行 2809
- `?hrmasterset=` 行 2953
- `?hrmasterup=` 行 2915
- `?ichefpurge=` 行 1453
- `?ingest=` 行 459
- `?inv=` 行 2307
- `?invcount=` 行 2336
- `?invset=` 行 2314
- `?kvproxy=` 行 942
- `?labor=` 行 2992
- `?laborset=` 行 2998
- `?lb=` 行 2545
- `?liffauth=` 行 2794
- `?manifest=` 行 407
- `?meet=` 行 1907
- `?meetping=` 行 2707
- `?meetset=` 行 1918
- `?menu=` 行 1713
- `?menuen=` 行 593
- `?menuimgset=` 行 1739
- `?menumv=` 行 625
- `?menunote=` 行 610
- `?menuprobe=` 行 3588
- `?menuset=` 行 1761
- `?notifycfg=` 行 1407
- `?notifyset=` 行 1415
- `?ntf=` 行 2772
- `?ntfping=` 行 2781
- `?ntfread=` 行 2760
- `?opsboard=` 行 1077
- `?payset=` 行 2976
- `?phingest=` 行 645
- `?poshide=` 行 1694
- `?prepact=` 行 3135
- `?prepapply=` 行 2610
- `?prepfav=` 行 3201
- `?prephide=` 行 3185
- `?preplog=` 行 3177
- `?prepmigrate=` 行 906
- `?prepperm=` 行 3091
- `?preppermset=` 行 2653
- `?priceset=` 行 1352
- `?punchfix=` 行 2007
- `?punchme=` 行 1996
- `?pushsub=` 行 2740
- `?revprobe=` 行 862
- `?rosterprobe=` 行 886
- `?rosterset=` 行 3560
- `?shift=` 行 2025
- `?shiftcolor=` 行 2169
- `?shiftdedup=` 行 2203
- `?shiftfill=` 行 2181
- `?shiftset=` 行 2220
- `?sop=` 行 2353
- `?sopdone=` 行 3216
- `?sopedit=` 行 3258
- `?sopfull=` 行 3492
- `?sopissue=` 行 3363
- `?soprate=` 行 2587
- `?sopref=` 行 1869
- `?sopreport=` 行 3303
- `?sopresolve=` 行 3331
- `?sopreview=` 行 3540
- `?sopset=` 行 3244
- `?sopsign=` 行 3291
- `?sopst=` 行 2398
- `?sopstamp=` 行 1855
- `?sopsugset=` 行 2493
- `?supplyingest=` 行 673
- `?supplyreset=` 行 534
- `?tabcfg=` 行 1672
- `?tabset=` 行 1678
- `?taskfill=` 行 494
- `?taskmove=` 行 473
- `?tasknotify=` 行 973
- `?twhol=` 行 1034
- `?txprobe=` 行 441
- `?webpushcfg=` 行 2735
- `?whoami=` 行 1064
