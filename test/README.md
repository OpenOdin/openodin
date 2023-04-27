To also run the PostgreSQL tests these env variables need to be set,
and a PG server needs to be running. The server must have the password set to `THIS-WILL-DESTROY-ALL-YOUR-DATA`;

If these env variables are not set then all PG tests will be skipped.

```sh
PGHOST="127.0.0.1" PGUSER=postgres PGPORT=5432 npm run test
```

This is an example of how to start a Postgres server.

Connecting to existing containers network:
```sh
docker run --rm --name some-postgres -e POSTGRES_PASSWORD="THIS-WILL-DESTROY-ALL-YOUR-DATA" --network container:universe postgres
```

Exposing the port:
```sh
docker run --rm --name some-postgres -e POSTGRES_PASSWORD="THIS-WILL-DESTROY-ALL-YOUR-DATA" -p 5432:5432 postgres
```
