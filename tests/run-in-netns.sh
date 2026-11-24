mount -t sysfs none /sys 2>&1 || { echo "sysfs mount failed"; exit 1; }
sh /tmp/lgtest.sh
