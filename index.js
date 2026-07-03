"use strict";

const axios = require("axios").default;

const PLUGIN_NAME = "homebridge-meraki-mt-sensor-ng";
const PLUGIN_VERSION = require("./package.json").version.replace(/-.*$/, "");
const PLATFORM_NAME = "MerakiMT";

//Meraki metrics requested for each sensor type
const METRICS_BY_TYPE = {
  tempSensor: ["temperature"],
  humiditySensor: ["humidity"],
  doorSensor: ["door"],
  co2Sensor: ["co2"],
  qualitySensor: ["indoorAirQuality", "pm25", "tvoc"],
};

//CO2 concentration (ppm) from which CarbonDioxideDetected reports an alert
const CO2_ALERT_PPM = 2000;

let Characteristic, Service, UUID, HapStatusError, HAPStatus;

module.exports = (api) => {
  Characteristic = api.hap.Characteristic;
  Service = api.hap.Service;
  UUID = api.hap.uuid;
  HapStatusError = api.hap.HapStatusError;
  HAPStatus = api.hap.HAPStatus;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MerakiMTPlatform);
};

//map the Meraki indoor air quality score (100 = best) to HomeKit AirQuality (1 = excellent, 5 = poor)
function toAirQuality(score) {
  if (score >= 93) {
    return 1;
  } else if (score >= 80) {
    return 2;
  } else if (score >= 60) {
    return 3;
  } else if (score >= 40) {
    return 4;
  }
  return 5;
}

class MerakiMTPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.accessories = [];

    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log("No configuration found for %s", PLUGIN_NAME);
      return;
    }
    this.devices = config.devices;

    this.api.on("didFinishLaunching", () => {
      this.log.debug("didFinishLaunching");
      this.discoverDevices();
    });
  }

  //called by homebridge for every accessory restored from cache
  configureAccessory(platformAccessory) {
    this.log.debug(
      "Loading accessory from cache: %s",
      platformAccessory.displayName,
    );
    this.accessories.push(platformAccessory);
  }

  discoverDevices() {
    const configuredUUIDs = new Set();

    for (const device of this.devices) {
      if (!device.name) {
        this.log.warn("Device Name Missing");
        continue;
      }
      if (!device.serial) {
        this.log.warn("Device: %s, Serial Number Missing", device.name);
        continue;
      }

      //seed the UUID from serial and type so renaming a sensor keeps its pairing
      const uuid = UUID.generate(
        PLUGIN_NAME + ":" + device.serial + ":" + device.type,
      );
      configuredUUIDs.add(uuid);

      let accessory = this.accessories.find((a) => a.UUID === uuid);
      if (accessory) {
        this.log.debug(
          "Restoring accessory from cache: %s",
          accessory.displayName,
        );
        accessory.context.device = device;
        this.api.updatePlatformAccessories([accessory]);
      } else {
        this.log.info("Adding new accessory: %s", device.name);
        accessory = new this.api.platformAccessory(device.name, uuid);
        accessory.context.device = device;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
          accessory,
        ]);
        this.accessories.push(accessory);
      }

      new MerakiMTDevice(this.log, device, accessory);
    }

    //remove cached accessories that are no longer in the config
    const staleAccessories = this.accessories.filter(
      (accessory) => !configuredUUIDs.has(accessory.UUID),
    );
    if (staleAccessories.length > 0) {
      for (const accessory of staleAccessories) {
        this.log.info(
          "Removing accessory no longer configured: %s",
          accessory.displayName,
        );
      }
      this.api.unregisterPlatformAccessories(
        PLUGIN_NAME,
        PLATFORM_NAME,
        staleAccessories,
      );
      this.accessories = this.accessories.filter((accessory) =>
        configuredUUIDs.has(accessory.UUID),
      );
    }
  }
}

class MerakiMTDevice {
  constructor(log, config, accessory) {
    this.log = log;
    this.accessory = accessory;

    //device configuration
    this.name = config.name;
    this.networkId = config.networkId;
    this.type = config.type;
    this.metrics = METRICS_BY_TYPE[this.type];
    this.refreshInterval = config.refreshInterval || 60;

    //accessory information; the model is resolved from the Meraki API unless configured
    this.manufacturer = config.manufacturer || "Cisco Meraki";
    this.modelName = config.modelName || "MT Sensor";
    this.modelKnown = Boolean(config.modelName);
    this.serialNumber = config.serial;
    this.firmwareRevision = config.firmwareRevision || PLUGIN_VERSION;

    //Meraki API endpoints
    this.devicesUrl =
      config.host + "/api/v1/networks/" + this.networkId + "/devices";
    this.mtStatsUrl =
      "https://api.meraki.com/api/v1/organizations/" +
      config.organizationId +
      "/sensor/readings/latest";

    this.meraki = axios.create({
      baseURL: config.host,
      headers: {
        "X-Cisco-Meraki-API-Key": config.apiKey,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
    });

    this.pollingEnabled = false;
    this.prepareInformationService();
    this.prepareSensorService();
    this.getDeviceInfo();

    //poll the Meraki API and push fresh readings to HomeKit
    setInterval(() => {
      if (this.pollingEnabled) {
        this.updateDeviceState().catch((error) => {
          this.log.debug(
            "Device: %s, periodic update error: %s",
            this.name,
            error.message,
          );
        });
      }
    }, this.refreshInterval * 1000);
  }

  //Prepare information service
  prepareInformationService() {
    this.informationService = this.accessory.getService(
      Service.AccessoryInformation,
    );
    this.informationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.modelName)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(
        Characteristic.FirmwareRevision,
        this.firmwareRevision,
      );
  }

  //Expose the HomeKit service and characteristics matching the sensor type
  prepareSensorService() {
    try {
      switch (this.type) {
        case "tempSensor":
          this.sensorService = this.getOrAddService(Service.TemperatureSensor);
          this.sensorService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({ minValue: -100, maxValue: 100 })
            .onGet(this.getTemperature.bind(this));
          break;

        case "humiditySensor":
          this.sensorService = this.getOrAddService(Service.HumiditySensor);
          this.sensorService
            .getCharacteristic(Characteristic.CurrentRelativeHumidity)
            .setProps({ minValue: 0, maxValue: 100 })
            .onGet(this.getHumidity.bind(this));
          break;

        case "doorSensor":
          this.sensorService = this.getOrAddService(Service.ContactSensor);
          this.sensorService
            .getCharacteristic(Characteristic.ContactSensorState)
            .onGet(this.getContactState.bind(this));
          break;

        case "co2Sensor":
          this.sensorService = this.getOrAddService(
            Service.CarbonDioxideSensor,
          );
          this.sensorService
            .getCharacteristic(Characteristic.CarbonDioxideDetected)
            .onGet(this.getCo2Detected.bind(this));
          this.sensorService
            .getCharacteristic(Characteristic.CarbonDioxideLevel)
            .onGet(this.getCo2.bind(this));
          break;

        case "qualitySensor":
          this.sensorService = this.getOrAddService(Service.AirQualitySensor);
          this.sensorService
            .getCharacteristic(Characteristic.AirQuality)
            .onGet(this.getQuality.bind(this));
          this.sensorService
            .getCharacteristic(Characteristic.PM2_5Density)
            .onGet(this.getPm25.bind(this));
          //Meraki reports TVOC in µg/m³ which can exceed the HAP default maximum of 1000
          this.sensorService
            .getCharacteristic(Characteristic.VOCDensity)
            .setProps({ minValue: 0, maxValue: 10000 })
            .onGet(this.getVoc.bind(this));
          break;

        default:
          this.log.warn(
            "Device: %s, unknown sensor type: %s",
            this.name,
            this.type,
          );
          return;
      }
      this.pollingEnabled = true;
    } catch (error) {
      this.log.error(
        "Device: %s, failed to set up HomeKit service: %s",
        this.name,
        error.message,
      );
    }
  }

  //Reuse the sensor service on a cache-restored accessory or add it on a new one
  getOrAddService(serviceType) {
    return (
      this.accessory.getServiceById(serviceType, "merakiService1") ||
      this.accessory.addService(serviceType, this.name, "merakiService1")
    );
  }

  //Fetch the latest readings of all metrics for this sensor from the Meraki API
  async fetchLatestReadings() {
    const response = await this.meraki.get(this.mtStatsUrl, {
      params: { metrics: this.metrics, serials: [this.serialNumber] },
    });
    const sensor = response.data.find((s) => s.serial === this.serialNumber);
    if (!sensor) {
      throw new Error("no readings for serial " + this.serialNumber);
    }
    this.latestReadings = {};
    for (const reading of sensor.readings) {
      this.latestReadings[reading.metric] = reading[reading.metric];
    }
    return this.latestReadings;
  }

  //Return the cached reading of a metric, refreshing the cache if it is empty
  async getLatestReading(metric) {
    const readings = this.latestReadings || (await this.fetchLatestReadings());
    const reading = readings[metric];
    if (reading === undefined) {
      throw new Error(
        "no " + metric + " reading for serial " + this.serialNumber,
      );
    }
    return reading;
  }

  //Log the device banner and fetch the initial state
  getDeviceInfo() {
    this.log("-------- %s --------", this.name);
    this.log("Manufacturer: %s", this.manufacturer);
    this.log("Model: %s", this.modelName);
    this.log("Serial: %s", this.serialNumber);
    this.log("Firmware: %s", this.firmwareRevision);
    this.log("Type: %s", this.type);
    this.log("----------------------------------");
    this.updateDeviceState().catch((error) => {
      this.log.error(
        "Device: %s, initial update error: %s",
        this.name,
        error.message,
      );
    });
  }

  logReading(metric, value) {
    this.log.debug(
      "Network ID: %s, Sensor: %s %s: %s",
      this.networkId,
      this.name,
      metric,
      value,
    );
  }

  //Poll the Meraki API and push the readings to HomeKit
  async updateDeviceState() {
    try {
      if (!this.sensorService) {
        return;
      }
      await this.fetchLatestReadings();

      switch (this.type) {
        case "tempSensor": {
          const value = (await this.getLatestReading("temperature")).celsius;
          this.logReading("temperature", value);
          this.sensorService.updateCharacteristic(
            Characteristic.CurrentTemperature,
            value,
          );
          break;
        }
        case "humiditySensor": {
          const value = (await this.getLatestReading("humidity"))
            .relativePercentage;
          this.logReading("humidity", value);
          this.sensorService.updateCharacteristic(
            Characteristic.CurrentRelativeHumidity,
            value,
          );
          break;
        }
        case "doorSensor": {
          const value = (await this.getLatestReading("door")).open ? 1 : 0;
          this.logReading("door", value);
          this.sensorService.updateCharacteristic(
            Characteristic.ContactSensorState,
            value,
          );
          break;
        }
        case "co2Sensor": {
          const ppm = (await this.getLatestReading("co2")).concentration;
          this.logReading("co2", ppm);
          this.sensorService.updateCharacteristic(
            Characteristic.CarbonDioxideLevel,
            ppm,
          );
          this.sensorService.updateCharacteristic(
            Characteristic.CarbonDioxideDetected,
            ppm < CO2_ALERT_PPM ? 0 : 1,
          );
          break;
        }
        case "qualitySensor": {
          const score = (await this.getLatestReading("indoorAirQuality"))
            .score;
          const pm25 = (await this.getLatestReading("pm25")).concentration;
          const tvoc = (await this.getLatestReading("tvoc")).concentration;
          this.logReading("indoorAirQuality", score);
          this.logReading("pm25", pm25);
          this.logReading("tvoc", tvoc);
          this.sensorService.updateCharacteristic(
            Characteristic.AirQuality,
            toAirQuality(score),
          );
          this.sensorService.updateCharacteristic(
            Characteristic.PM2_5Density,
            pm25,
          );
          this.sensorService.updateCharacteristic(
            Characteristic.VOCDensity,
            tvoc,
          );
          break;
        }
      }

      if (!this.modelKnown) {
        await this.updateModelFromApi();
      }
    } catch (error) {
      this.log.error(
        "Device: %s, update status error: %s",
        this.name,
        error.message,
      );
    }
  }

  //Resolve the sensor model from the network device list once
  async updateModelFromApi() {
    const response = await this.meraki.get(this.devicesUrl);
    const device = response.data.find((d) => d.serial === this.serialNumber);
    if (device && device.model) {
      this.modelName = device.model;
      this.modelKnown = true;
      this.informationService.setCharacteristic(
        Characteristic.Model,
        this.modelName,
      );
      this.log.info(
        "%s: updated model to: %s",
        this.serialNumber,
        this.modelName,
      );
    } else {
      this.log.debug(
        "Device: %s, serial %s not found in network %s",
        this.name,
        this.serialNumber,
        this.networkId,
      );
    }
  }

  //Shared onGet wrapper: read from the cache and translate failures into HAP errors
  async handleGet(read) {
    try {
      return await read();
    } catch (error) {
      this.log.debug(
        "Device: %s, Serial: %s get state error: %s",
        this.name,
        this.serialNumber,
        error.message,
      );
      throw new HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  getTemperature() {
    return this.handleGet(
      async () => (await this.getLatestReading("temperature")).celsius,
    );
  }

  getHumidity() {
    return this.handleGet(
      async () => (await this.getLatestReading("humidity")).relativePercentage,
    );
  }

  getContactState() {
    return this.handleGet(async () =>
      (await this.getLatestReading("door")).open ? 1 : 0,
    );
  }

  getQuality() {
    return this.handleGet(async () =>
      toAirQuality((await this.getLatestReading("indoorAirQuality")).score),
    );
  }

  getVoc() {
    return this.handleGet(
      async () => (await this.getLatestReading("tvoc")).concentration,
    );
  }

  getCo2() {
    return this.handleGet(
      async () => (await this.getLatestReading("co2")).concentration,
    );
  }

  getCo2Detected() {
    return this.handleGet(async () =>
      (await this.getLatestReading("co2")).concentration < CO2_ALERT_PPM
        ? 0
        : 1,
    );
  }

  getPm25() {
    return this.handleGet(
      async () => (await this.getLatestReading("pm25")).concentration,
    );
  }
}
