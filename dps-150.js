async function sleep(n) {
	return new Promise((resolve) => {
		setTimeout(resolve, n);
	});
}

const HEADER_INPUT  = 0xf0; // 240
const HEADER_OUTPUT = 0xf1; // 241

const CMD_GET     = 0xa1; // 161
const CMD_BAUD    = 0xb0; // 176
const CMD_SET     = 0xb1; // 177
const CMD_SESSION = 0xc1; // 193

// float
export const VOLTAGE_SET = 193;
export const CURRENT_SET = 194;

export const GROUP1_VOLTAGE_SET = 197;
export const GROUP1_CURRENT_SET = 198;
export const GROUP2_VOLTAGE_SET = 199;
export const GROUP2_CURRENT_SET = 200;
export const GROUP3_VOLTAGE_SET = 201;
export const GROUP3_CURRENT_SET = 202;
export const GROUP4_VOLTAGE_SET = 203;
export const GROUP4_CURRENT_SET = 204;
export const GROUP5_VOLTAGE_SET = 205;
export const GROUP5_CURRENT_SET = 206;
export const GROUP6_VOLTAGE_SET = 207;
export const GROUP6_CURRENT_SET = 208;

export const OVP = 209;
export const OCP = 210;
export const OPP = 211;
export const OTP = 212;
export const LVP = 213;

const METERING_ENABLE = 216;
const OUTPUT_ENABLE = 219;

// byte
export const BRIGHTNESS = 214;
export const VOLUME = 215;

const MODEL_NAME = 222;
const HARDWARE_VERSION = 223;
const FIRMWARE_VERSION = 224;
const ALL = 255;

const PROTECTION_STATES = [
	"",
	"OVP",
	"OCP",
	"OPP",
	"OTP",
	"LVP",
	"REP",
];

export class DPS150 {


	constructor(port, callback) {
		this.port = port;
		this.callback = callback;
	}

	async start() {
		console.log('start', this.port);
		await this.port.open({
			baudRate: 115200,
			bufferSize: 1024,
			dataBits: 8,
			stopBits: 1,
			flowControl: 'hardware',
			parity: 'none'
		});
		this.startReader();
		await this.initCommand();
	}

	async stop() {
		console.log('stop');
		await this.sendCommand(HEADER_OUTPUT, CMD_SESSION, 0, 0);
		await this.reader.cancel();
		await this.port.close();
	
	}

	async startReader() {
		console.log('reading...');
		let buffer = new Uint8Array();
		while (this.port.readable) {
			const reader = this.port.readable.getReader();
			this.reader = reader;
			try {
				while (true) {
					const { value, done } = await reader.read();
					if (done) {
						console.log('done');
						return;
					}
					let b = new Uint8Array(buffer.length + value.length);
					b.set(buffer);
					b.set(value, buffer.length);
					buffer = b;
					for (let i = 0; i < buffer.length - 6; i++) {
						if (buffer[i] === 0xf0 && buffer[i+1] === 0xa1) {
							const c1 = buffer[i];
							const c2 = buffer[i+1];
							const c3 = buffer[i+2];
							const c4 = buffer[i+3];
							if (i+c4 >= buffer.length) {
								break
							}
							const c5 = new Uint8Array(buffer.subarray(i+4, i+4+c4));
							const c6 = buffer[i+4+c4];

							let s6 = c3 + c4;
							for (let j = 0; j < c4; j++) {
								s6 += c5[j];
							};
							s6 %= 0x100;
							buffer = buffer.subarray(i+4+c4);
							if (s6 != c6) {
								// console.log('checksum error', s6, c6, Array.from(c5).map(v => v.toString(16)).join(" "));
								continue;
							}
							// console.log('readData', c1, c2, c3, c4, Array.from(c5).map(v => v.toString(16)).join(" "), c6, '==', s6);
							this.parseData(c1, c2, c3, c4, c5, c6);
						}
					}
					// console.log('parseData', Array.from(buffer).map(v => v.toString(16)).join(" "));
					// this.parseData(value);
				}
			} catch (error) {
				console.log(error);
			} finally {
				reader.releaseLock();
			}
		}
	}

	async initCommand() {
		await this.sendCommand(HEADER_OUTPUT, CMD_SESSION, 0, 1); // CMD_1
		// new int[5] { 9600, 19200, 38400, 57600, 115200 };
		await this.sendCommand(HEADER_OUTPUT, CMD_BAUD, 0, [9600, 19200, 38400, 57600, 115200].indexOf(115200) + 1); // CMD_13

		await this.sendCommand(HEADER_OUTPUT, CMD_GET, MODEL_NAME, 0); // get model name
		await this.sendCommand(HEADER_OUTPUT, CMD_GET, HARDWARE_VERSION, 0); // get hardware version
		await this.sendCommand(HEADER_OUTPUT, CMD_GET, FIRMWARE_VERSION, 0); // get firmware version
		await this.getAll();
	}

	async sendCommand(c1, c2, c3, c5) {
		/**
		 * c1: 0xf0 (in) or 0xf1 (out)
		 * c2: command
		 *   177: set
		 *   161: get
		 * 
		 *
		 */

		if (typeof c5 === 'number') {
			c5 = [ c5 ];
		}

		const c4 = c5.length;
		let c6 = c3 + c4;
		for (let i = 0; i < c4; i++) {
			c6 += c5[i];
		}
		const c = new Uint8Array(c5.length + 5);
		c[0] = c1;
		c[1] = c2;
		c[2] = c3;
		c[3] = c4;
		for (let i = 0; i < c4; i++) {
			c[4 + i] = c5[i];
		}
		c[c.length - 1] = c6;
		await this.sendCommandRaw(c);
	}

	async sendCommandFloat(c1, c2, c3, c5) {
		const v = new DataView(new ArrayBuffer(4));
		v.setFloat32(0, c5, true);
		await this.sendCommand(c1, c2, c3, new Uint8Array(v.buffer));
	}

	async sendCommandRaw(command) {
		// console.log('sendCommand', Array.from(command).map(v => v.toString(16)).join(" "));
		const writer = this.port.writable.getWriter();
		try {
			await writer.write(command);
			await sleep(50);
		} finally{
			writer.releaseLock();
		}
	}

	parseData(c1, c2, c3, c4, c5) {
		const { callback } = this;
		const view = new DataView(c5.buffer);
		let v1, v2, v3;
		switch (c3) {
			case 192: // input voltage
				callback({ inputVoltage: view.getFloat32(0, true) });
				break;
			case 195: // output voltage, current, power
				callback({
					outputVoltage: view.getFloat32(0, true),
					outputCurrent: view.getFloat32(4, true),
					outputPower: view.getFloat32(8, true),
				});
				break;
			case 196: // temperature
				callback({ temperature: view.getFloat32(0, true) });
				break;
			case 217: // output capacity
				callback({ outputCapacity: view.getFloat32(0, true) });
				break;
			case 218: // output energery
				callback({ outputEnergy: view.getFloat32(0, true) });
				break;
			case 219: // output closed?
				callback({ outputClosed: c5[0] === 1 });
				break;
			case 220: // protection
				let d31 = c5[0];
				callback({ protectionState: PROTECTION_STATES[d31] });
				break;
			case 221: // cc=0 or cv=1
				callback({ mode: c5[0] === 0 ? "CC" : "CV" });
				break;
			case 222: // model name
				// d33
				callback({ modelName: String.fromCharCode(...c5) });
				break;
			case 223: // hardware version
				// d34
				callback({ hardwareVersion: String.fromCharCode(...c5) });
				break;
			case 224: // firmware version
				// d35
				callback({ firmwareVersion: String.fromCharCode(...c5) });
				break;
			case 225: // ???
				// d36
				console.log(c3, c5[0]);
				break;
			case 226: // upper limit voltage
				callback({ upperLimitVoltage: view.getFloat32(0, true) });
				break;
			case 227: // upper limit current
				callback({ upperLimitCurrent: view.getFloat32(0, true) });
				break;
			case 255:
				// set all
				{
					const d1 = view.getFloat32(0, true); // input voltage
					const d2 = view.getFloat32(4, true); // vset
					const d3 = view.getFloat32(8, true); // cset
					const d4 = view.getFloat32(12, true); // output voltage
					const d5 = view.getFloat32(16, true); // output current
					const d6 = view.getFloat32(20, true); // output power
					const d7 = view.getFloat32(24, true); // temperature
					const d8 = view.getFloat32(28, true); // group 1 vset
					const d9 = view.getFloat32(32, true); // group 1 cset
					const d10 = view.getFloat32(36, true); // group 2 vset
					const d11 = view.getFloat32(40, true); // group 2 cset
					const d12 = view.getFloat32(44, true); // group 3 vset
					const d13 = view.getFloat32(48, true); // group 3 cset
					const d14 = view.getFloat32(52, true); // group 4 vset
					const d15 = view.getFloat32(56, true); // group 4 cset
					const d16 = view.getFloat32(60, true); // group 5 vset
					const d17 = view.getFloat32(64, true); // group 5 cset
					const d18 = view.getFloat32(68, true); // group 6 vset
					const d19 = view.getFloat32(72, true); // group 6 cset
					const d20 = view.getFloat32(76, true); // ovp
					const d21 = view.getFloat32(80, true); // ocp
					const d22 = view.getFloat32(84, true); // opp
					const d23 = view.getFloat32(88, true); // otp
					const d24 = view.getFloat32(92, true); // lvp
					const d25 = c5[96]; // brightness
					const d26 = c5[97]; // volume
					const d27 = c5[98]; // metering open=0 or close=1
					const d28 = view.getFloat32(99, true);  // output capacity [Ah]
					const d29 = view.getFloat32(103, true); // output energery [Wh]
					const d30 = c5[107]; // output closed?
					const d31 = c5[108]; // protection OVP=1, OCP=2, OPP=3, OTP=4, LVP=5
					const d32 = c5[109]; // cc=0 or cv=1
					const d33 = c5[110]; // ?

					const d37 = view.getFloat32(111, true); // upper limit voltage
					const d38 = view.getFloat32(115, true); // upper limit current
					const d39 = view.getFloat32(119, true); // ??? voltage
					const d40 = view.getFloat32(123, true); // ??? current
					const d41 = view.getFloat32(127, true);
					const d42 = view.getFloat32(131, true);
					const d43 = view.getFloat32(135, true);
					/*
					console.log({
						d1, d2, d3, d4, d5, d6, d7, d8, d9, d10,
						d11, d12, d13, d14, d15, d16, d17, d18, d19, d20,
						d21, d22, d23, d24, d25, d26, d27, d28, d29, d30,
						d31, d32, d37, d38, d39, d40, d41, d42, d43
					});
					*/
					// dump unknwon data
					console.log(c5.length, {
						d31, d33, d39, d40, d41, d42, d43
					});

					callback({
						inputVoltage: d1,
						setVoltage: d2,
						setCurrent: d3,
						outputVoltage: d4,
						outputCurrent: d5,
						outputPower: d6,
						temperature: d7,

						group1setVoltage: d8,
						group1setCurrent: d9,
						group2setVoltage: d10,
						group2setCurrent: d11,
						group3setVoltage: d12,
						group3setCurrent: d13,
						group4setVoltage: d14,
						group4setCurrent: d15,
						group5setVoltage: d16,
						group5setCurrent: d17,
						group6setVoltage: d18,
						group6setCurrent: d19,

						overVoltageProtection: d20,
						overCurrentProtection: d21,
						overPowerProtection: d22,
						overTemperatureProtection: d23,
						lowVoltageProtection: d24,

						brightness: d25,
						volume: d26,
						meteringClosed: d27 === 0,

						outputCapacity: d28,
						outputEnergy: d29,

						outputClosed: d30 === 1,
						protectionState: PROTECTION_STATES[d31],
						mode: d32 === 0 ? "CC" : "CV",

						upperLimitVoltage: d37,
						upperLimitCurrent: d38,
					});
				}
				break;
		}
	}


	async getAll() {
		await this.sendCommand(HEADER_OUTPUT, CMD_GET, ALL, 0); // get all
	}

	async setFloatValue(type, value) {
		await this.sendCommandFloat(HEADER_OUTPUT, CMD_SET, type, value);
	}

	async setByteValue(type, value) {
		await this.sendCommand(HEADER_OUTPUT, CMD_SET, type, value);
	}

	async enable() {
		await this.setByteValue(OUTPUT_ENABLE, 1);
	}

	async disable() {
		await this.setByteValue(OUTPUT_ENABLE, 0);
	}

	async startMetering() {
		await this.setByteValue(METERING_ENABLE, 1);
	}

	async stopMetering() {
		await this.setByteValue(METERING_ENABLE, 0);
	}
}
