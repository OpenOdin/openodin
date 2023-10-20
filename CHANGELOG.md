# CHANGELOG: universeai

Note that any version below 1.0.0 can have breaking changes.  

## [0.7.1] - 20231020
Fix bug in db connection synchronization.  

## [0.7.0] - 20231016
BREAKING CHANGES.  
Improve blob syncing, add max auto sync size, allow apps to request blobs not synced.  
Improve Thread API, support multiple post/postLicense in same Thead.  
Refactor some names for better readability.  
Add Node params isPrivate flag as a convenience.  
Fix initial instability when opening SQLite in WAL-mode.  
Address all linting errors.  

## [0.6.8] - 20231011
Bug fix in AlgoRefId.  

## [0.6.7] - 20231010
BREAKING CHANGES.  
Improve DataStreamers. Fix bugs. Add new Buffer streamers.  
Improve Transformer. Add fossil-delta for diff.  
Fix expired example certs.  

## [0.6.6] - 20230925

BREAKING CHANGE: Make Universe RPC client work with multiple instances on the same port.  
Add Service.addThreadSync().  
Better cleanup of RPC resources.  

## [0.6.5] - 20230919
BREAKING CHANGE: Update Service constructor to also take WalletConf argument.  
Fix serialization bugs in RPC.  
Add ThreadResponseAPI and improved types.  
Remove AppConfig in favor of the UniverseConf custom field.  

## [0.6.4] - 20230911
BREAKING CHANGE: Request Types updated and more.  
Refactor request types to use sourcePublicKey and targetPublicKey.
Add Thread template postLicense.targets field.  
Simplify test/integration/chat conf files.  
Make integration chat test not use RPC anymore.  
Refactor GetResponse.onReply argument order so response comes first.  
Secure SignatureOffloaderRPC.  
Add Decoder.Decode() to decode node or cert as generic DataModelInterface.  
Implement the new universe.json config schema.  
Refactor DATANODE\_TYPE to DATA\_NODE\_TYPE.  
Add Thread usage in Service.  
Fix shared factory stats bug in Service.  
Add Thread functionality.  
Delete AppLib and SimpleChat sample.  
Reassign variables back to Buffer in case of running in browser.  
Export util/BrowserUtil.  
Fix bug in BlobDriver.  
Allow data stream writers to decide chunk size.  

## [0.6.3] - 20230808
BREAKING CHANGE: ./app replaced with ./service/lib.  
Add TransformerCache to be used as mirror data model of transformer.  
Add AppConfig.  
Add SimpleChat usable sample app.  

## [0.6.2] - 20230731
First release.  
