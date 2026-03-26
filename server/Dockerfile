FROM golang:1.25.7-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /build/server ./cmd/web


FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata

RUN adduser -D -u 1000 appuser

WORKDIR /app

COPY --from=builder /build/server .

COPY --from=builder /build/templates ./templates
COPY --from=builder /build/static ./static
COPY --from=builder /build/migrations ./migrations

RUN chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

ENTRYPOINT ["./server"]
