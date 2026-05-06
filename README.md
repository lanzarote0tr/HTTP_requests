# HTTP Request Recorder

A simple Express server that records incoming HTTP requests and displays request/response details at `/admin`, similar to a lightweight mitmproxy event list.

## Run

```sh
npm install
npm start
```

Open `http://localhost:3000/admin` to view captured traffic.

## Docker

```sh
docker build -t http-request-recorder .
docker run --rm -p 3000:3000 http-request-recorder
```

Open `http://localhost:3000/admin` to view captured traffic.

Useful environment variables:

- `PORT`: server port, defaults to `3000`
- `HOST`: bind address, defaults to `127.0.0.1` locally and `0.0.0.0` in Docker
- `MAX_REQUESTS`: number of newest requests kept in memory, defaults to `500`
- `BODY_LIMIT`: maximum request body size accepted by Express, defaults to `2mb`

## Test request

```sh
curl -i -X POST http://localhost:3000/example \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
```

This is intentionally a local development utility. The `/admin` route has no authentication, so do not expose it directly to the public internet.
