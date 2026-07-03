# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - (2026-07-03)

### Changed

- **Migration note**: sensors are now exposed as bridged accessories of a dynamic platform instead of externally published accessories. After updating, remove the previously paired standalone sensor accessories from the Home app once — the sensors appear under the Homebridge bridge automatically, no manual pairing needed.
- Accessory UUIDs are derived from the sensor serial number and type, so renaming a sensor no longer breaks the HomeKit pairing.
- Sensor readings are requested with `serials[]`/`metrics[]` query parameters, so the plugin reads the configured sensor instead of the first sensor of the organization.
- All metrics of a sensor are fetched in a single API request per refresh interval and HomeKit reads are served from cached readings, greatly reducing Meraki API traffic.
- Default refresh interval aligned with the settings UI: 60 seconds (was 10).
- Periodic sensor readings are logged at debug level to keep the Homebridge log quiet.
- `VOCDensity` maximum raised to 10000 µg/m³ — Meraki TVOC readings can exceed the HAP default of 1000.
- Internal refactor: deduplicated the HomeKit getter handlers and service setup, extracted the air-quality and CO2 mapping helpers, removed unused fields and the misleading "state: Online" startup log line.
- Removed the leftover GitLab CI config; releases are published to npm manually.

### Fixed

- Read errors report `SERVICE_COMMUNICATION_FAILURE` to HomeKit instead of returning `null`, removing "illegal value" characteristic warnings.
- `ContactSensorState` receives `0`/`1` instead of a boolean.
- Accessory information defaults no longer use single-character placeholders, fixing the "Model characteristic must have a length of more than 1 character" HAP warning. The model defaults to "MT Sensor" until it is resolved from the Meraki API; the firmware revision defaults to the plugin version.
- Model lookup no longer throws when the configured serial number is not found in the network.
- Config schema: the Serial Number field title displays correctly; added a minimum refresh interval of 5 seconds.
- Devices without a serial number are skipped with a warning.
- Accessories removed from the config are now unregistered from the bridge.

### Removed

- Removed the unused `meraki` preferences directory creation — the plugin no longer writes to disk.

## [2.0.1] - (2026-05-25)

### Changed

- Updated npm badges in `README.md` to use Shields.io.
- Updated `CHANGELOG.md` with release notes for the 2.0.1 maintenance release.

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
