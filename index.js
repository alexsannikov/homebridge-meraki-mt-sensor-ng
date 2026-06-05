"use strict";

const axios = require("axios").default;
const fs = require("fs");
const path = require("path");

const PLUGIN_NAME = "homebridge-meraki-mt-sensor-ng";
const PLATFORM_NAME = "MerakiMT";

let Accessory, Characteristic, Service, Categories, UUID;

module.exports = (api) => {
  Accessory = api.platformAccessory;
  Characteristic = api.hap.Characteristic;
  Service = api.hap.Service;
  Categories = api.hap.Categories;
  UUID = api.hap.uuid;
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, merakiMTPlatform);
};

class merakiMTPlatform {
  constructor(log, config, api) {
    // only load if configured
    if (!config || !Array.isArray(config.devices)) {
      log("No configuration found for %s", PLUGIN_NAME);
      return;
    }
    this.log = log;
    this.config = config;
    this.api = api;
    this.devices = config.devices || [];

    this.api.on("didFinishLaunching", () => {
      this.log.debug("didFinishLaunching");
      for (let i = 0, len = this.devices.length; i < len; i++) {
        let device = this.devices[i];
        if (!device.name) {
          this.log.warn("Device Name Missing");
        } else {
          new merakiMTDevice(this.log, device, this.api);
        }
      }
    });
  }

  configureAccessory(platformAccessory) {
    this.log.debug("configurePlatformAccessory");
  }

  removeAccessory(platformAccessory) {
    this.log.debug("removePlatformAccessory");
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      platformAccessory,
    ]);
  }
}

class merakiMTDevice {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.config = config;

    //network configuration
    this.name = config.name;
    this.host = config.host;
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    this.networkId = config.networkId;
    this.type = config.type;
    this.refreshInterval = config.refreshInterval || 10;

    //get Device info
    this.manufacturer = config.manufacturer || "Cisco Meraki";
    this.modelName = config.modelName || "-";
    this.serialNumber = config.serial || "-";
    this.firmwareRevision = config.firmwareRevision || "-";

    //setup variables
    this.checkDeviceState = false;
    this.prefDir = path.join(api.user.storagePath(), "meraki");
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

    //check if the directory exists, if not then create it
    if (!fs.existsSync(this.prefDir)) {
      fs.mkdirSync(this.prefDir, { recursive: true });
      this.log.debug(
        "Device: %s , create directory successful: %s",
        this.name,
        this.prefDir,
      );
    }

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

    this.prepareAccessory();
  }

  //Prepare accessory
  prepareAccessory() {
    this.log.debug("prepareAccessory");
    const accessoryName = this.name;
    const accessoryUUID = UUID.generate(accessoryName);
    const accessoryCategory = Categories.AIRPORT;
    this.accessory = new Accessory(
      accessoryName,
      accessoryUUID,
      accessoryCategory,
    );

    this.prepareInformationService();
    this.prepareMerakiService();

    this.log.debug(
      "Device: %s %s, publishExternalAccessories.",
      this.host,
      accessoryName,
    );
    this.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  //Prepare information service
  prepareInformationService() {
    this.log.debug("prepareInformationService");
    this.getDeviceInfo();

    this.accessory.removeService(
      this.accessory.getService(Service.AccessoryInformation),
    );
    this.informationService = new Service.AccessoryInformation();
    this.informationService
      .setCharacteristic(Characteristic.Name, this.name)
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.modelName)
      .setCharacteristic(Characteristic.SerialNumber, this.serialNumber)
      .setCharacteristic(
        Characteristic.FirmwareRevision,
        this.firmwareRevision,
      );

    this.accessory.addService(this.informationService);
  }

  //Prepare service
  async prepareMerakiService() {
    this.log.debug("prepareMerakiService");
    try {
      if (this.type == "tempSensor") {
        this.merakiService1 = new Service.TemperatureSensor(
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
        this.merakiService1 = new Service.HumiditySensor(
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
        this.merakiService1 = new Service.ContactSensor(
          this.name,
          "merakiService1",
        );
        this.merakiService1
          .getCharacteristic(Characteristic.ContactSensorState)
          .onGet(this.getContactState.bind(this));
      }

      if (this.type == "co2Sensor") {
        this.merakiService1 = new Service.CarbonDioxideSensor(
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
        this.merakiService1 = new Service.AirQualitySensor(
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

      this.accessory.addService(this.merakiService1);
      this.checkDeviceState = true;
    } catch (error) {
      this.log.debug(
        "Device: %s, state Offline, read Device error: %s",
        this.name,
        error.message,
      );
    }
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
      if (this.type == "tempSensor") {
        if (this.merakiService1) {
          const response = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=temperature",
            { data: { serials: [this.serialNumber] } },
          );
          let value = response.data[0]["readings"][0]["temperature"]["celsius"];
          this.log.info(
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
          const humresponse = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=humidity",
            { data: { serials: [this.serialNumber] } },
          );
          let humvalue =
            humresponse.data[0]["readings"][0]["humidity"][
              "relativePercentage"
            ];
          this.log.info(
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
          const response = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=co2",
            { data: { serials: [this.serialNumber] } },
          );
          let value = response.data[0]["readings"][0]["co2"]["concentration"];
          this.log.info(
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
          const response = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=door",
            { data: { serials: [this.serialNumber] } },
          );
          let value = response.data[0]["readings"][0]["door"]["open"];
          this.log.info("got response %s", value);
          this.log.info(
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
          const response = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=indoorAirQuality",
            { data: { serials: [this.serialNumber] } },
          );
          let value =
            response.data[0]["readings"][0]["indoorAirQuality"]["score"];
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
          this.log.info(
            "Network ID: %s, Sensor: %s Value: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.AirQuality,
            value,
          );
          const response2 = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=pm25",
            { data: { serials: [this.serialNumber] } },
          );
          value = response2.data[0]["readings"][0]["pm25"]["concentration"];
          this.log.info(
            "Network ID: %s, Sensor: %s PM2.5: %s",
            this.networkId,
            this.name,
            value,
          );
          this.merakiService1.updateCharacteristic(
            Characteristic.PM2_5Density,
            value,
          );
          const response3 = await this.meraki.get(
            this.mtStatsUrl + "?metrics[]=tvoc",
            { data: { serials: [this.serialNumber] } },
          );
          value = response3.data[0]["readings"][0]["tvoc"]["concentration"];
          this.log.info(
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
        var picked = response.data.find((o) => o.serial === this.serialNumber);
        this.informationService.setCharacteristic(
          Characteristic.Model,
          picked["model"],
        );
        this.modelName = picked["model"];
        this.log.info(
          "%s: updated model to: %s",
          this.serialNumber,
          this.modelName,
        );
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
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=temperature",
        { data: { serials: [this.serialNumber] } },
      );
      let value = response.data[0]["readings"][0]["temperature"]["celsius"];
      this.log.info(
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
      return null;
    }
  }

  async getHumidity() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=humidity",
        { data: { serials: [this.serialNumber] } },
      );
      let value =
        response.data[0]["readings"][0]["humidity"]["relativePercentage"];
      this.log.info(
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
      return null;
    }
  }

  async getContactState() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=door",
        {
          data: { serials: [this.serialNumber] },
        },
      );
      let value = response.data[0]["readings"][0]["door"]["open"];
      this.log.info(
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
      return null;
    }
  }

  async getQuality() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=indoorAirQuality",
        { data: { serials: [this.serialNumber] } },
      );
      let value = response.data[0]["readings"][0]["indoorAirQuality"]["score"];
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
      this.log.info(
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
      return null;
    }
  }

  async getVoc() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=tvoc",
        {
          data: { serials: [this.serialNumber] },
        },
      );
      let value = response.data[0]["readings"][0]["tvoc"]["concentration"];
      this.log.info(
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
      return null;
    }
  }

  async getCo2() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=co2",
        {
          data: { serials: [this.serialNumber] },
        },
      );
      let value = response.data[0]["readings"][0]["co2"]["concentration"];
      this.log.info(
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
      return null;
    }
  }

  async getCo2Safe() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=co2",
        {
          data: { serials: [this.serialNumber] },
        },
      );
      let value = response.data[0]["readings"][0]["co2"]["concentration"];
      if (value < 2000) {
        value = 0;
      } else {
        value = 1;
      }
      this.log.info(
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
      return null;
    }
  }

  async getPm25() {
    try {
      const response = await this.meraki.get(
        this.mtStatsUrl + "?metrics[]=pm25",
        {
          data: { serials: [this.serialNumber] },
        },
      );
      let value = response.data[0]["readings"][0]["pm25"]["concentration"];
      this.log.info(
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
      return null;
    }
  }
}
