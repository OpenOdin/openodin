To also run the PostgreSQL tests these env variables need to be set,
and a PG server needs to be running. The server must have the password set to `THIS-WILL-DESTROY-ALL-YOUR-DATA`;

If these env variables are not set then all PG tests will be skipped.

```sh
PGHOST="127.0.0.1" PGUSER=postgres PGPORT=5432 npm run test
```

This is an example of how to start a Postgres server.

Connecting to existing containers network:
```sh
docker run --rm --name some-postgres -e POSTGRES_PASSWORD="THIS-WILL-DESTROY-ALL-YOUR-DATA" --network container:openodin postgres
```

Exposing the port:
```sh
docker run --rm --name some-postgres -e POSTGRES_PASSWORD="THIS-WILL-DESTROY-ALL-YOUR-DATA" -p 5432:5432 postgres
```

## 20250219
As for now with postgrejs 2.22.3 and Postgresql 17 the following lines need to be added to `node_modules/postgrejs/cjs/connection/portal.js` at line 121 before the `default:` case.

```js
case protocol_js_1.Protocol.BackendMessageCode.CloseComplete:
case protocol_js_1.Protocol.BackendMessageCode.ParseComplete:
case protocol_js_1.Protocol.BackendMessageCode.ReadyForQuery:
```

Without these lines cursors are not working with Postgres.
