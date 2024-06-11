# How to bump OpenOdin version

    1. Update CHANGELOG.md
    2. Update ./types.ts `Version` field to new version
    3. Update package.json to new version
    4. Run `npm i` to update package-lock.json
    5. Run `npm run build` to build
    6. Run `npm test`
    7. Run `npx ts-node ./test/integration/chat/Chat.ts`
    8. Commit changes
    9. Tag commit with new version
    10. Push to remote
    11. Publish to the npm registry
    12. Done
