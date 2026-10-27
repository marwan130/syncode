#!/bin/sh
set -eu

launcher="$(find /opt/jdtls/plugins -maxdepth 1 -type f -name 'org.eclipse.equinox.launcher_*.jar' -print -quit)"
test -n "$launcher"

exec java \
    -Declipse.application=org.eclipse.jdt.ls.core.id1 \
    -Dosgi.bundles.defaultStartLevel=4 \
    -Declipse.product=org.eclipse.jdt.ls.core.product \
    -Xmx640m \
    --add-modules=ALL-SYSTEM \
    --add-opens java.base/java.util=ALL-UNNAMED \
    --add-opens java.base/java.lang=ALL-UNNAMED \
    -jar "$launcher" \
    -configuration /opt/jdtls/config_linux \
    "$@"
