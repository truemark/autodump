# AutoDump

This cdk project automates creation of services that dump a database to S3.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

-   `npm run build` compile typescript to js
-   `npm run watch` watch for changes and compile
-   `npm run test` perform the jest unit tests
-   `cdk deploy` deploy this stack to your default AWS account/region
-   `cdk diff` compare deployed stack with current state
-   `cdk synth` emits the synthesized CloudFormation template

Install dependencies with pnpm. Example below

```agsl
bash-5.2$ pnpm add @aws-sdk/client-sfn
 WARN  Moving @types/node that was installed by a different package manager to "node_modules/.ignored"
 WARN  Moving aws-cdk that was installed by a different package manager to "node_modules/.ignored"
 WARN  Moving ts-jest that was installed by a different package manager to "node_modules/.ignored"
 WARN  Moving ts-node that was installed by a different package manager to "node_modules/.ignored"
 WARN  Moving jest that was installed by a different package manager to "node_modules/.ignored"
 WARN  6 other warnings

   ╭──────────────────────────────────────────────────────────────────╮
   │                                                                  │
   │                Update available! 8.6.12 → 8.12.1.                │
   │   Changelog: https://github.com/pnpm/pnpm/releases/tag/v8.12.1   │
   │                Run "pnpm add -g pnpm" to update.                 │
   │                                                                  │
   │      Follow @pnpmjs for updates: https://twitter.com/pnpmjs      │
   │                                                                  │
   ╰──────────────────────────────────────────────────────────────────╯

Packages: +381
++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
Packages are hard linked from the content-addressable store to the virtual store.
  Content-addressable store is at: /Users/lisakoivu/Library/pnpm/store/v3
  Virtual store is at:             node_modules/.pnpm
Progress: resolved 381, reused 280, downloaded 101, added 381, done

dependencies:
+ @aws-sdk/client-sfn 3.476.0
+ @aws-sdk/util-arn-parser 3.465.0
+ aws-cdk-lib 2.92.0
+ constructs 10.3.0
+ source-map-support 0.5.21

devDependencies:
+ @types/jest 29.5.11
+ @types/node 20.4.10 (20.5.1 is available)
+ aws-cdk 2.92.0
+ jest 29.7.0
+ ts-jest 29.1.1
+ ts-node 10.9.2
+ typescript 5.1.6 (5.3.3 is available)

The integrity of 1110 files was checked. This might have caused installation to take longer.
Done in 7.5s

```

# A Note on Linting

ESLint is configured within this project. The rules are configured this way for a reason. The content of the following files are not to be modified without consulting Erik.

-   .eslintignore
-   .eslintrc.json
-   .prettierignore

# Reference

This [article](https://medium.com/tysonworks/manage-batch-jobs-with-aws-batch-1f91229b1b6e) has a largish code example. The full example is behind a Medium paywall.
