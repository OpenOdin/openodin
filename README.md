![Continuous integration: main branch](https://github.com/universe-ai/universe/actions/workflows/ci.yml/badge.svg?branch=main)

# The UniverseAI Protocol

![UniverseAI logo](https://universe.ai/logo4.svg)

The UniverseAI protocol is a data sharing protocol used to share data between users and services but where each party keep the ownership over their own data.  

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
npm run c
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
[Main  ]  Init Chat Server
[Main  ]  Init Chat Client
[Main  ]  Send message from Server side
[Main  ]  Send message from Client side
[Server]  Peer connected.
[Client]  Peer connected.
[Server]  Hello from Server
[Client]  Hello from Client
[Client]  Hello from Server
[Server]  Hello from Client
[Main  ]  Closing Server and Client
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
[Main  ]  Init Chat Server
[Main  ]  Init Chat Client
[Main  ]  Send message from Server side
[Main  ]  Send message from Client side
[Server]  Peer connected.
[Client]  Peer connected.
[Server]  Hello from Server
[Client]  Hello from Client
[Client]  Hello from Server
[Server]  Hello from Client
[Main  ]  Closing Server and Client
```
