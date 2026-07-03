"use strict";

const axios = require("axios").default;

const PLUGIN_NAME = "homebridge-meraki-mt-sensor-ng";
const PLATFORM_NAME = "MerakiMT";

const METRICS_BY_TYPE = {
  tempSensor: ["temperature"],
  humiditySensor: ["humidity"],
  doorSensor: ["door"],
  co2Sensor: ["co2"],
  qualitySensor: ["indoorAirQuality", "pm25", "tvoc"],
};

let Characteristic, Service, UUID, HapStatusError, HAPStatus;

module.exports = (api) => {
  Characteristic = api.hap.Characteristic;
  Service = api.hap.Service;
  UUID = api.hap.uuid;
  HapStatusError = api.hap.HapStatusError;
  HAPStatus = api.hap.HAPStatus;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, MerakiMTPlatform);
};

class MerakiMTPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
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

      new MerakiMTDevice(this.log, device, this.api, accessory);
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
  constructor(log, config, api, accessory) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.accessory = accessory;

    //network configuration
    this.name = config.name;
    this.host = config.host;
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    this.networkId = config.networkId;
    this.type = config.type;
    this.metrics = METRICS_BY_TYPE[this.type];
    this.refreshInterval = config.refreshInterval || 60;

    //get Device info
    this.manufacturer = config.manufacturer || "Cisco Meraki";
    this.modelName = config.modelName || "-";
    this.serialNumber = config.serial || "-";
    this.firmwareRevision = config.firmwareRevision || "-";

    //setup variables
    this.checkDeviceState = false;
    this.devicesUrl =
      this.host + "/api/v1/networks/" + this.networkId + "/devices";
    this.mtStatsUrl =
      "https://api.meraki.com/api/v1/organizations/" +
      this.organizationId +
      "/sensor/readings/latest";

    this.meraki = axios.create({
      baseURL: this.host,
      headers: {
        "X-Cisco-Meraki-API-Key": this.apiKey,
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json",
      },
    });

    //Check device state
    setInterval(() => {
      if (this.checkDeviceState) {
        this.updateDeviceState().catch((error) => {
          this.log.debug(
            "Device: %s, periodic update error: %s",
            this.name,
            error.message,
          );
        });
      }
    }, this.refreshInterval * 1000);

    this.prepareInformationService();
    this.prepareMerakiService();
  }

  //Prepare information service
  prepareInformationService() {
    this.log.debug("prepareInformationService");
    this.getDeviceInfo();

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

  //Prepare service
  async prepareMerakiService() {
    this.log.debug("prepareMerakiService");
    try {
      if (this.type == "tempSensor") {
        this.merakiService1 =
          this.accessory.getServiceById(
            Service.TemperatureSensor,
            "merakiService1",
          ) ||
          this.accessory.addService(
            Service.TemperatureSensor,
            this.name,
            "merakiService1",
          );
        this.merakiService1
          .getCharacteristic(Characteristic.CurrentTemperature)
          .setProps({
            minValue: -100,
            maxValue: 100,
          })
          .onGet(this.getTemperature.bind(this));
      }

      if (this.type == "humiditySensor") {
        this.merakiService1 =
          this.accessory.getServiceById(
            Service.HumiditySensor,
            "merakiService1",
          ) ||
          this.accessory.addService(
            Service.HumiditySensor,
            this.name,
            "merakiService1",
          );
        this.merakiService1
          .getCharacteristic(Characteristic.CurrentRelativeHumidity)
          .setProps({
            minValue: 0,
            maxValue: 100,
          })
          .onGet(this.getHumidity.bind(this));
      }

      if (this.type == "doorSensor") {
        this.merakiService1 =
          this.accessory.getServiceById(
            Service.ContactSensor,
            "merakiService1",
          ) ||
          this.accessory.addService(
            Service.ContactSensor,
            this.name,
            "merakiService1",
          );
        this.merakiService1
          .getCharacteristic(Characteristic.ContactSensorState)
          .onGet(this.getContactState.bind(this));
      }

      if (this.type == "co2Sensor") {
        this.merakiService1 =
          this.accessory.getServiceById(
            Service.CarbonDioxideSensor,
            "merakiService1",
          ) ||
          this.accessory.addService(
            Service.CarbonDioxideSensor,
            this.name,
            "merakiService1",
          );
        this.merakiService1
          .getCharacteristic(Characteristic.CarbonDioxideDetected)
          .onGet(this.getCo2Safe.bind(this));
        this.merakiService1
          .getCharacteristic(Characteristic.CarbonDioxideLevel)
          .onGet(this.getCo2.bind(this));
      }

      if (this.type == "qualitySensor") {
        this.merakiService1 =
          this.accessory.getServiceById(
            Service.AirQualitySensor,
            "merakiService1",
          ) ||
          this.accessory.addService(
            Service.AirQualitySensor,
            this.name,
            "merakiService1",
          );
        this.merakiService1
          .getCharacteristic(Characteristic.AirQuality)
          .onGet(this.getQuality.bind(this));
        this.merakiService1
          .getCharacteristic(Characteristic.PM2_5Density)
          .onGet(this.getPm25.bind(this));
        this.merakiService1
          .getCharacteristic(Characteristic.VOCDensity)
          .onGet(this.getVoc.bind(this));
      }

      if (!this.merakiService1) {
        this.log.warn(
          "Device: %s, unknown sensor type: %s",
          this.name,
          this.type,
        );
        return;
      }
      this.checkDeviceState = true;
    } catch (error) {
      this.log.debug(
        "Device: %s, state Offline, read Device error: %s",
        this.name,
        error.message,
      );
    }
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

  async getDeviceInfo() {
    try {
      this.log.info("Device: %s, state: Online.", this.name);
      this.log("-------- %s --------", this.name);
      this.log("Manufacturer: %s", this.manufacturer);
      this.log("Model: %s", this.modelName);
      this.log("Serial: %s", this.serialNumber);
      this.log("Firmware: %s", this.firmwareRevision);
      this.log("Type: %s", this.type);
      this.log("----------------------------------");
      await this.updateDeviceState();
    } catch (error) {
      this.log.error(
        "Device: %s, getDeviceInfo error: %s",
        this.name,
        error.message,
      );
    }
  }

  async updateDeviceState() {
    try {
      if (!this.metrics) {
        return;
      }
      await this.fetchLatestReadings();

      if (this.type == "tempSensor") {
        if (this.merakiService1) {
          const value = (await this.getLatestReading("temperature")).celsius;
          this.log.debug(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.CurrentTemperature,
            value,
          );
        }
      }

      if (this.type == "humiditySensor") {
        if (this.merakiService1) {
          const humvalue = (await this.getLatestReading("humidity"))
            .relativePercentage;
          this.log.debug(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            humvalue,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.CurrentRelativeHumidity,
            humvalue,
          );
        }
      }

      if (this.type == "co2Sensor") {
        if (this.merakiService1) {
          let value = (await this.getLatestReading("co2")).concentration;
          this.log.debug(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.CarbonDioxideLevel,
            value,
          );
          if (value < 2000) {
            value = 0;
          } else {
            value = 1;
          }
          this.merakiService1.updateCharacteristic(
            Characteristic.CarbonDioxideDetected,
            value,
          );
        }
      }

      if (this.type == "doorSensor") {
        if (this.merakiService1) {
          const value = (await this.getLatestReading("door")).open ? 1 : 0;
          this.log.debug(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.ContactSensorState,
            value,
          );
        }
      }

      if (this.type == "qualitySensor") {
        if (this.merakiService1) {
          let value = (await this.getLatestReading("indoorAirQuality")).score;
          if (value >= 93) {
            value = 1;
          } else if (value >= 80) {
            value = 2;
          } else if (value >= 60) {
            value = 3;
          } else if (value >= 40) {
            value = 4;
          } else {
            value = 5;
          }
          this.log.debug(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.AirQuality,
            value,
          );
          value = (await this.getLatestReading("pm25")).concentration;
          this.log.debug(
            "Network ID: %s, Sensor: %s PM2.5: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.PM2_5Density,
            value,
          );
          value = (await this.getLatestReading("tvoc")).concentration;
          this.log.debug(
            "Network ID: %s, Sensor: %s VOC: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.VOCDensity,
            value,
          );
        }
      }

      if (this.serialNumber != "-" && this.modelName == "-") {
        // go get model numbers for devices we have serials for
        const response = await this.meraki.get(this.devicesUrl);
        const picked = response.data.find(
          (o) => o.serial === this.serialNumber,
        );
        if (picked && picked.model) {
          this.informationService.setCharacteristic(
            Characteristic.Model,
            picked.model,
          );
          this.modelName = picked.model;
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
    } catch (error) {
      this.log.error(
        "UpdateDeviceState() - Device: %s, update status error: %s, state: Offline",
        this.name,
        error.message,
      );
    }
  }

  async getTemperature() {
    try {
      const value = (await this.getLatestReading("temperature")).celsius;
      this.log.debug(
        "getTemperature() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getHumidity() {
    try {
      const value = (await this.getLatestReading("humidity"))
        .relativePercentage;
      this.log.debug(
        "getHumidity() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getContactState() {
    try {
      const value = (await this.getLatestReading("door")).open ? 1 : 0;
      this.log.debug(
        "getContactState() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getQuality() {
    try {
      let value = (await this.getLatestReading("indoorAirQuality")).score;
      if (value >= 93) {
        value = 1;
      } else if (value >= 80) {
        value = 2;
      } else if (value >= 60) {
        value = 3;
      } else if (value >= 40) {
        value = 4;
      } else {
        value = 5;
      }
      this.log.debug(
        "getQuality() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getVoc() {
    try {
      const value = (await this.getLatestReading("tvoc")).concentration;
      this.log.debug(
        "getVoc() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getCo2() {
    try {
      const value = (await this.getLatestReading("co2")).concentration;
      this.log.debug(
        "getCo2() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getCo2Safe() {
    try {
      let value = (await this.getLatestReading("co2")).concentration;
      if (value < 2000) {
        value = 0;
      } else {
        value = 1;
      }
      this.log.debug(
        "getCo2Safe() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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

  async getPm25() {
    try {
      const value = (await this.getLatestReading("pm25")).concentration;
      this.log.debug(
        "getPm25() - Network ID: %s, Sensor: %s Value: %s",
        this.networkId,
        this.name,
        value,
      );
      return value;
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
}
