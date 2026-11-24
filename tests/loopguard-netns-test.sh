M=/tmp/mkveth; LG=/tmp/lg
st(){ $LG -c status | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ports:',[(p['name'],p['role'],'ISOLATED' if p['isolated'] else 'ok') for p in d['ports']],'loops:',d['loops']);[print('   event:',e['msg']) for e in d['events'][-int('$1'):]]"; }
$M p1 p2; $M p3 p4; $M p5 p6; $M up p1 p2 p3 p4 p5 p6
mkdir -p /var/etc
printf 'enabled 1\ninterval_ms 50\nstorm_pps 20000\nport p1 downlink\nport p2 downlink\nport p3 uplink\nport p4 uplink\nport p5 downlink\n' > /var/etc/wrtmax-loopguard.conf
$LG & PID=$!; sleep 0.8
echo "A) cable p1<->p2 (both downlink), p3<->p4 (BOTH UPLINK loop), p5 reflecting nothing:"; st 4
echo "B) reset all -> physical loop still there -> exactly one port must be isolated again:"
$LG -c reset all; sleep 0.5; st 2
echo "C) hot-reload config: make p3 downlink -> uplink-loop now isolates:"
sed -i 's/port p3 uplink/port p3 downlink/' /var/etc/wrtmax-loopguard.conf; $LG -c reload; sleep 0.8; st 2
kill $PID; wait $PID 2>/dev/null
echo "D) after SIGTERM all isolated ports are released:"; for i in p1 p2 p3 p4; do $M state $i; done
