#!/bin/sh
# Starts the second (userspace) tailscaled for dsh-monitor and re-applies the port forward.
# Idempotent: safe to run at WSL boot and by hand. Install to /usr/local/sbin/dsh-monitor-net.sh.
SOCK=/var/run/tailscale-monitor.sock
STATE=/var/lib/tailscale-monitor/tailscaled.state
mkdir -p /var/lib/tailscale-monitor
if ! pgrep -f 'tailscaled.*tailscale-monitor\.sock' >/dev/null 2>&1; then
  rm -f "$SOCK"
  nohup tailscaled --tun=userspace-networking --socket="$SOCK" --state="$STATE" --port=41642 \
    >>/var/log/tailscaled-monitor.log 2>&1 &
fi
i=0; while [ ! -S "$SOCK" ] && [ $i -lt 30 ]; do sleep 1; i=$((i+1)); done
# the saved node key reconnects on its own; only (re)publish the forward
/usr/bin/tailscale --socket="$SOCK" serve --bg --tcp=3090 tcp://127.0.0.1:3090 >>/var/log/tailscaled-monitor.log 2>&1
exit 0
