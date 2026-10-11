FROM eclipse-temurin:21-jdk-alpine

ENV RUNNER_RUNTIME=java \
    JAVA_TOOL_OPTIONS=-Djava.io.tmpdir=/runner/tmp \
    TMPDIR=/runner/tmp \
    TMP=/runner/tmp \
    TEMP=/runner/tmp

RUN addgroup -S -g 10001 runner \
    && adduser -S -D -H -u 10001 -G runner runner \
    && mkdir -p /workspace \
    && chown runner:runner /workspace

COPY entrypoint.sh /usr/local/bin/runner-entrypoint
RUN chmod 0555 /usr/local/bin/runner-entrypoint

WORKDIR /workspace
USER 10001:10001

ENTRYPOINT ["/usr/local/bin/runner-entrypoint"]
