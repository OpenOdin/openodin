![Continuous integration: main branch](https://github.com/universe-ai/universe/actions/workflows/ci.yml/badge.svg?branch=main)

# The UniverseAI Protocol

![UniverseAI logo](https://universe.ai/logo4.svg)

The UniverseAI Protocol is an interoperable application and data sharing protocol where each party keep ownership and control over their data. The protocol and this implementation is developed by The UniverseAI Foundation.

Users are not required to host their own data but can let services host data while users can at any time sync home their data, or sync their data to another service.  

UniverseAI is a graph of data which is cryptographically signed by each user creating data. Data is either public, private or licensed. Users issue licenses on their licensed data towards other users for specific time ranges, for a specific intent and for how many times a license can be "extented" towards other users.  

All communication between peers are encrypted. 

This repo is a production intended reference implementation of the UniverseAI protocol bundled with an SDK and licensed with the Apache license version 2.  

This implementation is written in TypeScript meaning it can also be run in the browser. It uses relatively few dependencies.  

Use this repo to:

    - build decentralized applications using nothing else than UniverseAI as backend, or
    - use UniverseAI as part of your applications backend and storage strategy
    - create interoperable applications
        - Move data between similar applications
        - Sync data in near realtime to **complementing** applications to enrich your current dataset
    - setup data lakes for data sharing amongst participants

## Roadmap
This repo follows the semver versioning schema, however breaking changes are expected for any new version below 1.0.0.  

## Status
The project is currently (2023-09-19) going through a wrapping up phase together with the Data Wallet browser extension ([https://github.com/universe-ai/datawallet](https://github.com/universe-ai/datawallet)) and the Web Chat application ([https://github.com/universe-ai/webchat/](https://github.com/universe-ai/webchat/)) in preparation for a stable release.  

## Documentation
Documentation is found at [https://universe.ai/docs/](https://universe.ai/docs/).  

## NPM
This project is released on NPM as [https://www.npmjs.com/package/universeai](https://www.npmjs.com/package/universeai).  

## Test
```sh
npm i
npm test
```

See also the chat integration test below.

## Base setup
```
npm i
```

## Build
```
npm run build
```

## Test
```
npm run test
```

## Chat reference example

### Node.js
```
npx ts-node ./test/integration/chat/Chat.ts
```

Expected output:
```
2023-07-24T17:24:29 [ℹ INFO ] [Main  ] Init Chat Server
2023-07-24T17:24:29 [ℹ INFO ] [Main  ] Storage connected, send message from Server side
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Init Chat Client
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Connection connected to server
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Connection connected to client, send message from Client side
2023-07-24T17:24:30 [ℹ INFO ] [Server] Hello from Server
2023-07-24T17:24:30 [ℹ INFO ] [Client] Hello from Client
2023-07-24T17:24:30 [ℹ INFO ] [Client] Hello from Server
2023-07-24T17:24:31 [ℹ INFO ] [Server] Hello from Client
2023-07-24T17:24:31 [ℹ INFO ] [Server] Downloaded blob
2023-07-24T17:24:31 [✓ ACED ] [Main  ] All messages transferred, closing Server and Client
2023-07-24T17:24:31 [ℹ INFO ] [Service] Database connection closed
2023-07-24T17:24:31 [ℹ INFO ] [Service] Database connection closed
```

### Browser
Build and test in browser.  

```
npm run c
cp ./src/datamodel/decoder/thread.js ./build/src/datamodel/decoder/.
npm run browser
cp ./build/browser/Chat.js <dest>
cp ./build/src/datamodel/decoder/thread.js <dest>
cp ./test/integration/chat/index.html <dest>
```

Double click index.html to run it locally.

Expected output:
```
2023-07-24T17:24:29 [ℹ INFO ] [Main  ] Init Chat Server
2023-07-24T17:24:29 [ℹ INFO ] [Main  ] Storage connected, send message from Server side
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Init Chat Client
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Connection connected to server
2023-07-24T17:24:30 [ℹ INFO ] [Main  ] Connection connected to client, send message from Client side
2023-07-24T17:24:30 [ℹ INFO ] [Server] Hello from Server
2023-07-24T17:24:30 [ℹ INFO ] [Client] Hello from Client
2023-07-24T17:24:30 [ℹ INFO ] [Client] Hello from Server
2023-07-24T17:24:31 [ℹ INFO ] [Server] Hello from Client
2023-07-24T17:24:31 [ℹ INFO ] [Server] Downloaded blob
2023-07-24T17:24:31 [✓ ACED ] [Main  ] All messages transferred, closing Server and Client
2023-07-24T17:24:31 [ℹ INFO ] [Service] Database connection closed
2023-07-24T17:24:31 [ℹ INFO ] [Service] Database connection closed
```
