# How to bump version

    1. Update CHANGELOG.md
    2. Update package.json to new version
    3. Run `npm i` to update package-lock.json
    4. Run `npm run build` to build
    5. Run `npm test`
    6. Run `npx ts-node ./test/integration/chat/Chat.ts`
    7. Commit changes
    8. Tag commit with new version
    9. Push to remote
    10. Publish to the npm registry
    11. Done
