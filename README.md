<p align="center">
  <a href="https://github.com/alexsannikov/homebridge-meraki-mt-sensor-ng"><img src="graphics/meraki.png" height="140"></a>
</p>

<span align="center">

# Homebridge Meraki MT Sensor NG

[![npm](https://img.shields.io/npm/dt/homebridge-meraki-mt-sensor-ng.svg)](https://www.npmjs.com/package/homebridge-meraki-mt-sensor-ng) [![npm](https://img.shields.io/npm/v/homebridge-meraki-mt-sensor-ng.svg)](https://www.npmjs.com/package/homebridge-meraki-mt-sensor-ng)

Next Generation fork of the Homebridge plugin for Meraki MT sensors, with Homebridge v2 support.

</span>

## Info

This plugin enables you to monitor Meraki MT sensor data in Homebridge, and thus in the Apple Home app.

## Compatibility

This fork targets current Homebridge 1.x and Homebridge 2.x installations.
The Homebridge platform name remains `MerakiMT`, so existing configurations can continue to use:

```json
{
  "platform": "MerakiMT"
}
```

## Migrating from 2.0.x

Since v2.1.0, sensors are exposed as bridged accessories of a dynamic platform instead of separately paired external accessories. After updating, remove the previously paired standalone sensor accessories from the Home app once — the sensors will appear under your Homebridge bridge automatically, no manual pairing needed.

## Installation

1. Follow the step-by-step instructions on the [Homebridge Wiki](https://github.com/homebridge/homebridge/wiki) for how to install Homebridge.
2. Follow the step-by-step instructions on the [Homebridge UI](https://github.com/oznu/homebridge-config-ui-x/wiki) for how to install Homebridge UI.
3. Install homebridge-meraki-mt-sensor-ng using: `npm install -g homebridge-meraki-mt-sensor-ng` or search for `meraki mt` in Homebridge UI.

## Configuration

Use [Homebridge UI](https://github.com/oznu/homebridge-config-ui-x) to configure the plugin (strongly recomended), or update your configuration file manually. See `sample-config.json` in this repository for a sample or add the bottom example to your config.json file.

## Whats new:

See [CHANGELOG.md](CHANGELOG.md).

## Project lineage and credits

`homebridge-meraki-mt-sensor-ng` is a Next Generation fork of:
https://github.com/AustinJMann/homebridge-meraki-mt-sensor

The project lineage appears to include:

- Original MIT-licensed work credited to Grzegorz
- GitLab continuation/fork by Alex Houlton
- GitHub fork/extended version by AustinJMann

This fork preserves the original MIT license notice and adds Homebridge v2 support.

## Development

- Pull request and help in development highly appreciated.
