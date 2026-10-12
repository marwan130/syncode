FROM alpine:3.22

RUN apk add --no-cache bash coreutils findutils grep sed util-linux-misc
RUN addgroup -S -g 10001 runner \
    && adduser -S -D -H -u 10001 -G runner runner \
    && mkdir -p /workspace \
    && chown runner:runner /workspace

WORKDIR /workspace
USER 10001:10001
