# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - (2026/05/25)

### Added

- Published package as `homebridge-meraki-mt-sensor-ng`.
- Added support for Homebridge 2.x while preserving compatibility with current Homebridge 1.x installations.
- Added project lineage and credits for the original MIT-licensed work and maintained forks.

### Changed

- Preserved the Homebridge platform name `MerakiMT` for existing configuration compatibility.
- Updated Homebridge platform registration to the current API style.
- Modernized read-only HomeKit characteristic handlers from callback-based `.on('get')` / `.on('set')` usage to `.onGet()`.
- Updated `axios` dependency to `^1.16.1`.
- Updated package metadata, repository links, README, npm badges, and npm package name.

### Fixed

- Removed npm audit vulnerabilities from the dependency tree.
- Removed write handlers from read-only sensor characteristics.

### Tested

- Tested successfully with Homebridge 1.8.1.
- Tested successfully with Homebridge 2.0.2.
- Tested with Node.js 22.22.3.

## [1.0.3] - (2022/10/02)

## Changes

- bumped dependencies
- added CI/CD pipeline

## [1.0.2] - (2022/10/02)

## Changes

- Updated readme

## [1.0.1] - (2022/10/02)

## Changes

- Fixed config schema
- Updated sample config

## [1.0.0] - (2022/10/02)

## Changes

- Initial published version
