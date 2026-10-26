#!/bin/sh
set -eu

if [ "$#" -ne 0 ]; then
  printf '%s\n' 'Runner images do not accept command arguments.' >&2
  exit 64
fi

case "${RUNNER_RUNTIME:-}" in
  node)
    source_path="${SYNCODE_SOURCE_PATH:-main.js}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    exec node "/workspace/$source_path"
    ;;
  typescript)
    source_path="${SYNCODE_SOURCE_PATH:-main.ts}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/out
    tsc --target ES2022 --module node16 --moduleResolution node16 --skipLibCheck \
      --typeRoots /usr/local/lib/node_modules/@types --rootDir /workspace --outDir /runner/out "/workspace/$source_path"
    output_path="${source_path%.ts}.js"
    exec node "/runner/out/$output_path"
    ;;
  python)
    source_path="${SYNCODE_SOURCE_PATH:-main.py}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    exec python3 "/workspace/$source_path"
    ;;
  csharp)
    source_path="${SYNCODE_SOURCE_PATH:-Program.cs}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/dotnet /runner/runtime
    chmod 700 /runner/runtime
    find /workspace -type f -name '*.cs' ! -path "/workspace/$source_path" ! -path /workspace/Program.cs -exec cp --parents {} /runner \;
    cp "/workspace/$source_path" /runner/Program.cs
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
    dotnet restore /runner/main.csproj --configfile /runner/NuGet.Config --disable-parallel
    dotnet build /runner/main.csproj --no-restore --configuration Release --output /runner/out -m:1 -p:UseSharedCompilation=false
    exec dotnet /runner/out/main.dll
    ;;
  c)
    source_path="${SYNCODE_SOURCE_PATH:-main.c}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    find /workspace -type f -name '*.c' ! -path "/workspace/$source_path" -print0 |
      xargs -0 gcc -std=c17 -O0 -pipe -o /runner/main "/workspace/$source_path"
    exec /runner/main
    ;;
  cpp)
    source_path="${SYNCODE_SOURCE_PATH:-main.cpp}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    find /workspace -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) ! -path "/workspace/$source_path" -print0 |
      xargs -0 g++ -std=c++20 -O0 -pipe -o /runner/main "/workspace/$source_path"
    exec /runner/main
    ;;
  rust)
    source_path="${SYNCODE_SOURCE_PATH:-main.rs}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp
    rustc --edition=2024 "/workspace/$source_path" -o /runner/main
    exec /runner/main
    ;;
  java)
    source_path="${SYNCODE_SOURCE_PATH:-Main.java}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp /runner/classes
    javac -sourcepath /workspace -d /runner/classes "/workspace/$source_path"
    exec java -Djava.io.tmpdir=/runner/tmp -cp /runner/classes Main
    ;;
  *)
    printf '%s\n' 'RUNNER_RUNTIME must name a supported language.' >&2
    exit 64
    ;;
esac
