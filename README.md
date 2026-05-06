# HTTP webhook

A simple Express webhook receiver that records incoming requests and displays request/response details at `/admin`.

## Run

```sh
npm install
npm start
```

Open `http://localhost:3000/admin` to view webhook traffic.

## Docker

```sh
docker build -t http-webhook .
docker run --rm -p 3000:3000 http-webhook
```

Open `http://localhost:3000/admin` to view webhook traffic.

Useful environment variables:

- `PORT`: server port, defaults to `3000`
- `HOST`: bind address, defaults to `127.0.0.1` locally and `0.0.0.0` in Docker
- `MAX_REQUESTS`: number of newest requests kept in memory, defaults to `500`
- `BODY_LIMIT`: maximum request body size accepted by Express, defaults to `2mb`

## Test webhook

```sh
curl -i -X POST http://localhost:3000/example \
  -H 'Content-Type: application/json' \
  -d '{"hello":"world"}'
```

This is intentionally a local development utility. The `/admin` route has no authentication, so do not expose it directly to the public internet.
