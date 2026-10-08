# API 端點目錄（自動產生，別手改）

`node scripts/check-endpoints.mjs` 產生；加新端點前先搜這份，撞名=build 直接擋。

## api/boss-sync.js（5 個口）

- `?bosspeek=` 行 89
- `?bossraw=` 行 101
- `?fillpos=` 行 126
- `?histfill=` 行 114
- `?ping=` 行 83

## api/cron-daily.js（3 個口）

- `?bdaytest=` 行 246
- `?dry=` 行 376
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

## api/mail-sync.js（136 個口）

- `?abatt=` 行 3717
- `?abmod=` 行 3661
- `?abmodset=` 行 3671
- `?abscan=` 行 1774
- `?absinc=` 行 2132
- `?aliasget=` 行 1459
- `?aliasset=` 行 1464
- `?animpref=` 行 1118
- `?animprefset=` 行 1126
- `?bindcard=` 行 3957
- `?bindcode=` 行 435
- `?bossprobe=` 行 3939
- `?buy=` 行 4333
- `?buyadd=` 行 4341
- `?buyop=` 行 4361
- `?catprobe=` 行 884
- `?ddmsg=` 行 1506
- `?ddmsgset=` 行 1514
- `?debug=` 行 4528
- `?delday=` 行 830
- `?dinefill=` 行 1425
- `?docgrep=` 行 850
- `?errlog=` 行 1729
- `?errs=` 行 1763
- `?fb=` 行 1928
- `?fbassign=` 行 2069
- `?fbdims=` 行 2048
- `?fbj=` 行 1984
- `?fbset=` 行 2007
- `?fc=` 行 1611
- `?fcadj=` 行 1697
- `?fcrun=` 行 1719
- `?fcso=` 行 1652
- `?fcsp=` 行 1677
- `?gdrole=` 行 1588, 3363
- `?gdstaff=` 行 1559
- `?hrdocdel=` 行 3784
- `?hrdocup=` 行 3741
- `?hrdocurl=` 行 3767
- `?hridlock=` 行 3374
- `?hrmaster=` 行 3563
- `?hrmasterset=` 行 3839
- `?hrmasterup=` 行 3801
- `?ichefpurge=` 行 1581
- `?ingest=` 行 470
- `?inv=` 行 2839
- `?invcount=` 行 2868
- `?invset=` 行 2846
- `?kvproxy=` 行 953
- `?labor=` 行 3878
- `?laborset=` 行 3884
- `?lb=` 行 3078
- `?ledger=` 行 3305
- `?liffauth=` 行 3548
- `?manifest=` 行 418
- `?meet=` 行 2149
- `?meetping=` 行 3440
- `?meetset=` 行 2166
- `?menu=` 行 1841
- `?menuen=` 行 604
- `?menuimgset=` 行 1867
- `?menumv=` 行 636
- `?menunote=` 行 621
- `?menuprobe=` 行 4485
- `?menuset=` 行 1889
- `?notifyadmin=` 行 1534
- `?notifycfg=` 行 1497
- `?notifyset=` 行 1543
- `?ntf=` 行 3505
- `?ntfpin=` 行 3518
- `?ntfping=` 行 3535
- `?ntfread=` 行 3493
- `?opsboard=` 行 1153
- `?payset=` 行 3862
- `?phingest=` 行 656
- `?pointscfg=` 行 3171
- `?poshide=` 行 1822
- `?prepact=` 行 4021
- `?prepapply=` 行 3343
- `?prepfav=` 行 4087
- `?prephide=` 行 4071
- `?preplog=` 行 4063
- `?prepmigrate=` 行 917
- `?prepperm=` 行 3977
- `?preppermset=` 行 3386
- `?priceset=` 行 1442
- `?punchadmin=` 行 2448
- `?punchedit=` 行 2498
- `?punchfix=` 行 2528
- `?punchmakeup=` 行 2383
- `?punchmakeups=` 行 2410
- `?punchmakeupset=` 行 2425
- `?punchme=` 行 2351
- `?punchstat=` 行 2364
- `?pushsub=` 行 3473
- `?redeem=` 行 3242
- `?revprobe=` 行 873
- `?rewardset=` 行 3215
- `?rosterprobe=` 行 897
- `?rosterset=` 行 4457
- `?shift=` 行 2546
- `?shiftcolor=` 行 2701
- `?shiftdedup=` 行 2735
- `?shiftfill=` 行 2713
- `?shiftset=` 行 2752
- `?sop=` 行 2886
- `?sopdone=` 行 4102
- `?sopedit=` 行 4145
- `?sopfull=` 行 4389
- `?sopissue=` 行 4257
- `?soprate=` 行 3320
- `?sopref=` 行 2111
- `?sopreport=` 行 4190
- `?sopresolve=` 行 4225
- `?sopreview=` 行 4437
- `?sopset=` 行 4131
- `?sopsign=` 行 4178
- `?sopst=` 行 2931
- `?sopstamp=` 行 2097
- `?sopsugset=` 行 3026
- `?supplyingest=` 行 684
- `?supplyreset=` 行 545
- `?tabcfg=` 行 1800
- `?tabset=` 行 1806
- `?taskadmin=` 行 1045
- `?taskfill=` 行 505
- `?taskmove=` 行 484
- `?tasknotify=` 行 984
- `?twhol=` 行 1088
- `?txprobe=` 行 452
- `?vgo=` 行 3586
- `?viomgrs=` 行 3592
- `?vionotify=` 行 3609
- `?vioresset=` 行 3685
- `?webpushcfg=` 行 3468
- `?whoami=` 行 1140
