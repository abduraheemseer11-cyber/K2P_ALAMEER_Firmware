Loop-guard functional test (needs root, gcc, `unshare`):
  gcc -O2 -o /tmp/mkveth tests/mkveth.c
  gcc -O2 -o /tmp/lg package/wrtmax/wrtmax-loopguard/src/loopguard.c
  cp tests/loopguard-netns-test.sh /tmp/lgtest.sh; cp tests/run-in-netns.sh /tmp/run.sh
  unshare -mn sh /tmp/run.sh
