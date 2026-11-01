FROM gradle:9.8.0-jdk21-corretto AS gradle-runtime
FROM maven:3.10.0-eclipse-temurin-21-noble AS maven-runtime
FROM alpine:3.24.3 AS jdtls-runtime

ARG JDTLS_VERSION=1.64.0-202610221949

RUN apk add --no-cache curl \
    && set -eu \
    && base_url="https://download.eclipse.org/jdtls/snapshots" \
    && archive="jdt-language-server-${JDTLS_VERSION}.tar.gz" \
    && curl -fsSL "${base_url}/${archive}" -o "/tmp/${archive}" \
    && curl -fsSL "${base_url}/${archive}.sha256" -o "/tmp/${archive}.sha256" \
    && expected="$(awk '{print $1}' "/tmp/${archive}.sha256")" \
    && actual="$(sha256sum "/tmp/${archive}" | awk '{print $1}')" \
    && test "$actual" = "$expected" \
    && mkdir -p /opt/jdtls \
    && tar -xzf "/tmp/${archive}" -C /opt/jdtls \
    && rm -f "/tmp/${archive}" "/tmp/${archive}.sha256"

FROM eclipse-temurin:21-jdk-alpine-3.24

ENV RUNNER_RUNTIME=java \
    GRADLE_HOME=/opt/gradle \
    MAVEN_HOME=/usr/share/maven \
    JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=/runner/tmp \
    TMPDIR=/runner/tmp \
    TMP=/runner/tmp \
    TEMP=/runner/tmp

ENV PATH=/opt/gradle/bin:/usr/share/maven/bin:$PATH

COPY --from=gradle-runtime /opt/gradle /opt/gradle
COPY --from=maven-runtime /usr/share/maven /usr/share/maven
COPY --from=jdtls-runtime /opt/jdtls /opt/jdtls

COPY jdtls-entrypoint.sh /usr/local/bin/jdtls

RUN addgroup -S -g 10001 runner \
    && adduser -S -D -H -u 10001 -G runner runner \
    && chmod 0555 /usr/local/bin/jdtls \
    && mkdir -p /workspace \
    && chown runner:runner /workspace

COPY entrypoint.sh /usr/local/bin/runner-entrypoint
RUN chmod 0555 /usr/local/bin/runner-entrypoint

WORKDIR /workspace
USER 10001:10001

ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
