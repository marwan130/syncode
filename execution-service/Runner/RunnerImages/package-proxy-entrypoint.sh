#!/bin/bash
set -eu

dnsmasq --keep-in-foreground --conf-file=/etc/dnsmasq.conf &
dns_pid=$!
squid -N -f /etc/squid/squid.conf &
squid_pid=$!
set +e
wait -n "$dns_pid" "$squid_pid"
status=$?
kill "$dns_pid" "$squid_pid" 2>/dev/null
wait "$dns_pid" 2>/dev/null
wait "$squid_pid" 2>/dev/null
exit "$status"
