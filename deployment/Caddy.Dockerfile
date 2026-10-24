FROM golang:1.26.10-alpine3.24 AS builder
RUN apk add --no-cache git
WORKDIR /src
RUN git clone --depth 1 --branch v2.11.7 https://github.com/caddyserver/caddy.git .
# Keep the Caddy build on the patched Go toolchain and fixed x/net release.
RUN go mod edit -require=golang.org/x/net@v0.60.0 \
    && go mod tidy \
    && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/caddy ./cmd/caddy

FROM alpine:3.24
RUN apk upgrade --no-cache && apk add --no-cache ca-certificates tzdata
COPY --from=builder /out/caddy /usr/bin/caddy
EXPOSE 80 443 443/udp
VOLUME ["/data", "/config"]
ENTRYPOINT ["/usr/bin/caddy"]
CMD ["run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
