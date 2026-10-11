#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  printf '%s\n' 'Runner images do not accept command arguments.' >&2
  exit 64
fi

case "${RUNNER_RUNTIME:-}" in
  node)
    [ -f /workspace/main.js ] && [ -r /workspace/main.js ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    exec node /workspace/main.js
    ;;
  typescript)
    [ -f /workspace/main.ts ] && [ -r /workspace/main.ts ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/out
    tsc --target ES2022 --module node16 --moduleResolution node16 --skipLibCheck \
      --typeRoots /usr/local/lib/node_modules/@types --outDir /runner/out /workspace/main.ts
    exec node /runner/out/main.js
    ;;
  python)
    [ -f /workspace/main.py ] && [ -r /workspace/main.py ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    exec python3 /workspace/main.py
    ;;
  csharp)
    [ -f /workspace/Program.cs ] && [ -r /workspace/Program.cs ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/dotnet
    cp /workspace/Program.cs /runner/Program.cs
    cat > /runner/main.csproj <<'EOF'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <NuGetAudit>false</NuGetAudit>
  </PropertyGroup>
</Project>
EOF
    cat > /runner/NuGet.Config <<'EOF'
<configuration><packageSources><clear /></packageSources></configuration>
EOF
    dotnet restore /runner/main.csproj --configfile /runner/NuGet.Config
    dotnet build /runner/main.csproj --no-restore --configuration Release --output /runner/out
    exec dotnet /runner/out/main.dll
    ;;
  c)
    [ -f /workspace/main.c ] && [ -r /workspace/main.c ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    gcc -std=c17 -O0 -pipe /workspace/main.c -o /runner/main
    exec /runner/main
    ;;
  cpp)
    [ -f /workspace/main.cpp ] && [ -r /workspace/main.cpp ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    g++ -std=c++20 -O0 -pipe /workspace/main.cpp -o /runner/main
    exec /runner/main
    ;;
  rust)
    [ -f /workspace/main.rs ] && [ -r /workspace/main.rs ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    rustc --edition=2024 /workspace/main.rs -o /runner/main
    exec /runner/main
    ;;
  java)
    [ -f /workspace/Main.java ] && [ -r /workspace/Main.java ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/classes
    javac -d /runner/classes /workspace/Main.java
    exec java -Djava.io.tmpdir=/runner/tmp -cp /runner/classes Main
    ;;
  *)
    printf '%s\n' 'RUNNER_RUNTIME must name a supported language.' >&2
    exit 64
    ;;
esac
