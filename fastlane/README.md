fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

## Android

### android push_metadata

```sh
[bundle exec] fastlane android push_metadata
```

Push store metadata (title, description) to Google Play

### android push_screenshots

```sh
[bundle exec] fastlane android push_screenshots
```

Upload screenshots to Google Play

### android set_rollout

```sh
[bundle exec] fastlane android set_rollout
```

Set production rollout percentage

### android push_all

```sh
[bundle exec] fastlane android push_all
```

Push everything (metadata + screenshots)

### android deploy_aab

```sh
[bundle exec] fastlane android deploy_aab
```

Upload AAB to Google Play internal track

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
