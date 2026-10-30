#!/bin/sh
set -eu

if [ "$#" -eq 2 ]; then
  export RUNNER_RUNTIME="$1"
  export SYNCODE_SOURCE_PATH="$2"
  shift 2
fi

if [ "$#" -ne 0 ]; then
  printf '%s\n' 'Runner images do not accept command arguments.' >&2
  exit 64
fi

# Copy workspace files to a target directory, excluding mounted dependency paths
copy_workspace_to() {
  mkdir -p "$1"
  tar -c -C /workspace --exclude node_modules -f - . | tar -x -C "$1" -f -
}

# Extract a fully-qualified Java class name from a source file
resolve_java_class() {
  _pkg=$(grep '^package ' "$1" 2>/dev/null | sed 's/package *//;s/ *;.*//' || true)
  _cls=$(basename "$1" .java)
  if [ -n "$_pkg" ]; then
    printf '%s.%s' "$_pkg" "$_cls"
  else
    printf '%s' "$_cls"
  fi
}

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
    mkdir -p /runner/tmp /runner/dotnet /runner/runtime /runner/nuget
    chmod 700 /runner/runtime

    # Walk from the source directory toward the workspace root looking for a .csproj
    csproj_file=""
    csproj_dir=$(dirname "/workspace/$source_path")
    while true; do
      found=$(find "$csproj_dir" -maxdepth 1 -name '*.csproj' -print -quit 2>/dev/null || true)
      if [ -n "$found" ]; then
        csproj_file="$found"
        break
      fi
      [ "$csproj_dir" = "/workspace" ] && break
      csproj_dir=$(dirname "$csproj_dir")
    done

    if [ -n "$csproj_file" ]; then
      # Project-aware build using NuGet packages cached by the terminal
      mkdir -p /runner/project
      copy_workspace_to /runner/project
      rel_csproj="${csproj_file#/workspace/}"
      runner_csproj="/runner/project/$rel_csproj"
      cat > /runner/NuGet.Config <<'NUGETEOF'
<configuration>
  <packageSources><clear /></packageSources>
  <fallbackPackageFolders>
    <add key="terminal-cache" value="/deps/nuget" />
  </fallbackPackageFolders>
</configuration>
NUGETEOF
      export NUGET_PACKAGES=/runner/nuget
      dotnet restore "$runner_csproj" --configfile /runner/NuGet.Config --disable-parallel
      dotnet build "$runner_csproj" --no-restore --configuration Release --output /runner/out -m:1 -p:UseSharedCompilation=false
      dll_name=$(basename "$rel_csproj" .csproj)
      exec dotnet "/runner/out/$dll_name.dll"
    fi

    # Standalone single-file path
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

    if [ -f /workspace/CMakeLists.txt ]; then
      # Project-aware build with CMake
      mkdir -p /runner/project /runner/build
      copy_workspace_to /runner/project
      cmake -DCMAKE_BUILD_TYPE=Release -S /runner/project -B /runner/build
      cmake --build /runner/build
      binary=$(find /runner/build -maxdepth 2 -type f -executable ! -name '*.cmake' ! -name 'Makefile' -print -quit 2>/dev/null || true)
      [ -n "$binary" ] && [ -x "$binary" ] || { printf '%s\n' 'Could not find the built binary.' >&2; exit 70; }
      exec "$binary"
    fi

    if [ -f /workspace/Makefile ]; then
      mkdir -p /runner/project
      copy_workspace_to /runner/project
      make -C /runner/project
      binary=$(find /runner/project -maxdepth 1 -type f -executable ! -name 'Makefile' ! -name '*.c' ! -name '*.h' -print -quit 2>/dev/null || true)
      [ -n "$binary" ] || binary="/runner/project/a.out"
      [ -x "$binary" ] || { printf '%s\n' 'Could not find the built binary.' >&2; exit 70; }
      exec "$binary"
    fi

    # Standalone single-file path
    find /workspace -type f -name '*.c' ! -path "/workspace/$source_path" -print0 |
      xargs -0 gcc -std=c17 -O0 -pipe -o /runner/main "/workspace/$source_path"
    chmod 700 /runner/main
    exec /runner/main
    ;;
  cpp)
    source_path="${SYNCODE_SOURCE_PATH:-main.cpp}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp

    if [ -f /workspace/CMakeLists.txt ]; then
      mkdir -p /runner/project /runner/build
      copy_workspace_to /runner/project
      cmake -DCMAKE_BUILD_TYPE=Release -S /runner/project -B /runner/build
      cmake --build /runner/build
      binary=$(find /runner/build -maxdepth 2 -type f -executable ! -name '*.cmake' ! -name 'Makefile' -print -quit 2>/dev/null || true)
      [ -n "$binary" ] && [ -x "$binary" ] || { printf '%s\n' 'Could not find the built binary.' >&2; exit 70; }
      exec "$binary"
    fi

    if [ -f /workspace/Makefile ]; then
      mkdir -p /runner/project
      copy_workspace_to /runner/project
      make -C /runner/project
      binary=$(find /runner/project -maxdepth 1 -type f -executable ! -name 'Makefile' ! -name '*.cpp' ! -name '*.cc' ! -name '*.cxx' ! -name '*.h' ! -name '*.hpp' -print -quit 2>/dev/null || true)
      [ -n "$binary" ] || binary="/runner/project/a.out"
      [ -x "$binary" ] || { printf '%s\n' 'Could not find the built binary.' >&2; exit 70; }
      exec "$binary"
    fi

    # Standalone single-file path
    find /workspace -type f \( -name '*.cpp' -o -name '*.cc' -o -name '*.cxx' \) ! -path "/workspace/$source_path" -print0 |
      xargs -0 g++ -std=c++20 -O0 -pipe -o /runner/main "/workspace/$source_path"
    chmod 700 /runner/main
    exec /runner/main
    ;;
  rust)
    source_path="${SYNCODE_SOURCE_PATH:-main.rs}"
    [ -f "/workspace/$source_path" ] && [ -r "/workspace/$source_path" ] || {
      printf '%s\n' 'The mounted source file is missing or unreadable.' >&2
      exit 66
    }
    mkdir -p /runner/tmp

    if [ -f /workspace/Cargo.toml ]; then
      # Project-aware build using crates cached by the terminal
      mkdir -p /runner/cargo-home /runner/target /runner/project
      if [ -d /deps/cargo-home/registry ]; then
        cp -a /deps/cargo-home/registry /runner/cargo-home/
      fi
      copy_workspace_to /runner/project
      export CARGO_HOME=/runner/cargo-home
      export CARGO_TARGET_DIR=/runner/target
      cd /runner/project
      cargo build --offline
      bin_name=$(sed -n '/^\[package\]/,/^\[/{s/^name *= *"\([^"]*\)".*/\1/p;}' /runner/project/Cargo.toml | head -1)
      if [ -z "$bin_name" ]; then
        bin_name="main"
      fi
      binary="/runner/target/debug/$bin_name"
      if [ ! -x "$binary" ]; then
        binary=$(find /runner/target/debug -maxdepth 1 -type f -executable ! -name '*.d' -print -quit 2>/dev/null || true)
      fi
      [ -n "$binary" ] && [ -x "$binary" ] || { printf '%s\n' 'Could not find the built binary.' >&2; exit 70; }
      exec "$binary"
    fi

    # Standalone single-file path
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

    if [ -f /workspace/pom.xml ]; then
      # Maven project build using cached local repository from the terminal
      mkdir -p /runner/project /runner/mvn-repo
      copy_workspace_to /runner/project
      if [ -d /deps/maven ]; then
        cp -a /deps/maven/. /runner/mvn-repo/ 2>/dev/null || true
      fi
      export MAVEN_OPTS="-Dmaven.repo.local=/runner/mvn-repo -Djava.io.tmpdir=/runner/tmp"
      cd /runner/project
      mvn -o compile -q
      full_class=$(resolve_java_class "/runner/project/$source_path")
      exec java -Djava.io.tmpdir=/runner/tmp -cp target/classes "$full_class"
    fi

    if [ -f /workspace/build.gradle ] || [ -f /workspace/build.gradle.kts ]; then
      # Gradle project build using cached dependencies from the terminal
      mkdir -p /runner/project /runner/gradle-home
      copy_workspace_to /runner/project
      if [ -d /deps/gradle ]; then
        cp -a /deps/gradle/. /runner/gradle-home/ 2>/dev/null || true
      fi
      export GRADLE_USER_HOME=/runner/gradle-home
      cd /runner/project
      gradle --offline compileJava -q
      full_class=$(resolve_java_class "/runner/project/$source_path")
      exec java -Djava.io.tmpdir=/runner/tmp -cp build/classes/java/main "$full_class"
    fi

    # Standalone single-file path
    javac -sourcepath /workspace -d /runner/classes "/workspace/$source_path"
    exec java -Djava.io.tmpdir=/runner/tmp -cp /runner/classes Main
    ;;
  *)
    printf '%s\n' 'RUNNER_RUNTIME must name a supported language.' >&2
    exit 64
    ;;
esac
