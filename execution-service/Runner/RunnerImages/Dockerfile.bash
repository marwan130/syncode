FROM node:24.22.1-bookworm-slim AS node-runtime
FROM rust:1.99.1-bookworm AS rust-runtime
FROM gradle:9.8.2-jdk21 AS gradle-runtime
FROM maven:3.10.0-eclipse-temurin-21-noble AS maven-runtime
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble

ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1 \
    GRADLE_HOME=/opt/gradle \
    MAVEN_HOME=/usr/share/maven \
    PATH=/deps/npm-global/bin:/opt/gradle/bin:/opt/conan/bin:/usr/local/cargo/bin:/usr/share/maven/bin:/usr/local/bin:/usr/bin:/bin

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=rust-runtime /usr/local/cargo /usr/local/cargo
COPY --from=rust-runtime /usr/local/rustup /usr/local/rustup
COPY --from=gradle-runtime /opt/gradle /opt/gradle
COPY --from=maven-runtime /usr/share/maven /usr/share/maven
COPY entrypoint.sh /usr/local/bin/syncode-runner
COPY sync-workspace.py /usr/local/bin/syncode-sync-workspace

ENV RUSTUP_HOME=/usr/local/rustup \
    TMPDIR=/runner/tmp

RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --no-install-recommends -y \
        bash build-essential ca-certificates cmake coreutils curl findutils git grep \
        ninja-build openjdk-21-jdk-headless passwd python3 python3-pip python3-venv \
        sed util-linux \
    && npm install --global --ignore-scripts pnpm@12.15.0 yarn@1.22.22 typescript@6.0.2 @types/node@24.13.3 \
    && python3 -m venv /opt/conan \
    && /opt/conan/bin/pip install --no-cache-dir conan==2.33.0 \
    && rm -rf /var/lib/apt/lists/*

RUN /usr/sbin/groupadd --system --gid 10001 runner \
    && /usr/sbin/useradd --system --uid 10001 --gid runner --no-create-home --shell /usr/sbin/nologin runner \
    && mkdir -p /workspace \
    && chown runner:runner /workspace \
    && chmod 0555 /usr/local/bin/syncode-runner

WORKDIR /workspace
USER 10001:10001
