# FNIRSI DPS-150 – Reverse‑Engineered USB Protocol
*A complete developer‑oriented reference for automation, scripting and custom GUIs*

---

## ⚠️ Disclaimer
This protocol description is **not official**.  
It was reverse‑engineered by USB sniffing of the official FNIRSI software and validated by live testing on real DPS‑150 hardware.

Nevertheless, the protocol is **stable, deterministic and fully usable** for production tools.

---

## 1. Device Overview

- Device: **FNIRSI DPS‑150**
- Type: Programmable DC power supply
- Control interface: **USB CDC (Virtual COM port)**
- Control model: **Memory‑mapped registers**

The DPS‑150 does **not** use textual commands or request/response semantics.  
Instead, the device exposes an internal memory map where:

- Writing a register **immediately changes behavior**
- Reading a register returns **current internal state**
- Periodic telemetry is **pushed by the device**

---

## 2. Transport Layer

| Parameter | Value |
|--------|------|
| Interface | USB CDC (COM port) |
| Baudrate | 115200 |
| Data bits | 8 |
| Parity | None |
| Stop bits | 1 |
| Flow control | None |
| Endianness | Little‑endian |

All floating‑point values are **IEEE‑754 float32**.

---

## 3. Frame Structure

### 3.1 Register Frames (main protocol)

```
TX: F1 <GROUP> <REG> <LEN> <DATA…> <CHK>
RX: F0 <GROUP> <REG> <LEN> <DATA…> <CHK>
```

| Field | Meaning |
|----|----|
| `F1 / F0` | Direction (TX / RX) |
| `GROUP` | B1 = write, A1 = read/response |
| `REG` | Register address |
| `LEN` | Length of DATA |
| `DATA` | Payload |
| `CHK` | Checksum |

### 3.2 Checksum Rule

```
CHK = (REG + LEN + sum(DATA)) & 0xFF
```

- GROUP byte is **not included**
- Used consistently across all register writes and reads

---

## 4. Session Control (mandatory)

Before accessing any registers, communication must be enabled.

| Function | TX Frame | Notes |
|------|---------|------|
| Enable session | `F1 C1 00 01 01 02` | Must be sent once |
| Disable session | `F1 C1 00 01 00 01` | Graceful close |
| Start telemetry | `F1 B0 00 01 05 06` | Enables periodic RX |
| Stop telemetry | `F1 B0 00 01 00 01` | Optional |

---

## 5. Active Output Control

### 5.1 Voltage Setpoint (C1)

- Type: float32
- Unit: volts

**Example: set 12.3 V**
```
TX: F1 B1 C1 04 CD CC 44 41 E3
RX: F0 A1 C1 04 CD CC 44 41 E3
```

### 5.2 Current Limit (C2)

- Type: float32
- Unit: amperes

**Example: set 0.5 A**
```
TX: F1 B1 C2 04 FD FF FF 3E FF
```

⚠️ Writing C1/C2 works even when output is OFF.

---

## 6. Output Enable (RUN / STOP)

| Register | Description | Type |
|------|-------------|----|
| DB | Output relay state | u8 |

| Value | Meaning |
|----|----|
| 0 | STOP |
| 1 | RUN |

**RUN**
```
TX: F1 B1 DB 01 01 DD
RX: F0 A1 DB 01 01 DD
```

**STOP**
```
TX: F1 B1 DB 01 00 DC
RX: F0 A1 DB 01 00 DC
```

---

## 7. Preset Memory (M1–M6)

Each preset consists of **Voltage + Current** registers.

| Preset | Voltage | Current |
|------|--------|---------|
| M1 | C5 | C6 |
| M2 | C7 | C8 |
| M3 | C9 | CA |
| M4 | CB | CC |
| M5 | CD | CE |
| M6 | CF | D0 |

### Example – Program M2 = 5.5 V / 0.5 A
```
TX: F1 B1 C7 04 00 00 B0 40 BB
TX: F1 B1 C8 04 FD FF FF 3E 05
```

When selecting a preset via UI, FNIRSI software:
1. Writes preset registers
2. Mirrors values into C1/C2

---

## 8. Protection Settings

| Register | Protection | Unit |
|------|-------------|------|
| D1 | OVP | V |
| D2 | OCP | A |
| D3 | OPP | W |
| D4 | OTP | °C |
| D5 | LVP | V |

### Example – Change OTP from 75 → 64 °C
```
TX: F1 B1 D4 04 00 00 80 42 9A
```

All protection writes are followed by:
```
TX: F1 A1 FF 01 00 00
```
(request full state refresh)

---

## 9. UI / System Settings

| Register | Function | Type |
|------|----------|----|
| D6 | Brightness | u8 |
| D7 | Volume | u8 |

**Brightness 11 → 12**
```
TX: F1 B1 D6 01 0C E3
```

**Volume 10 → 9**
```
TX: F1 B1 D7 01 09 E1
```

---

## 10. Telemetry (RX only)

When streaming is enabled, DPS‑150 periodically transmits telemetry.

| Register | Meaning | Type |
|------|---------|----|
| C0 | Measured voltage | float32 |
| E2 | Measured current | float32 |
| E3 | Output power | float32 |
| C4 | Internal temperature | float32 |
| C3 | Status struct | 12 bytes |

Telemetry frames are **unsolicited** and **must not be acknowledged**.

---

## 11. Full Memory Dump

The entire internal state can be requested explicitly.

```
TX: F1 A1 FF 01 00 00
RX: F0 A1 FF 8B <139 bytes> <CHK>
```

Contains:
- Active setpoints
- Presets M1–M6
- Protection thresholds
- UI settings
- Status flags

FNIRSI software issues this **after every write**.

---

## 12. Recommended Control Sequence

```text
1. Enable session
2. Start telemetry (optional)
3. Write C1 / C2
4. Write DB = RUN
5. Monitor telemetry
6. Write DB = STOP
7. Disable session
```

---

## 13. Notes for Implementers

- No timing‑critical delays required
- Writes are idempotent
- Protocol is endian‑safe
- Device ignores unknown registers
- Ideal for scripting, CI test rigs, production fixtures

---

## 14. Project Status

✔ Core protocol understood  
✔ All known registers mapped  
✔ Suitable for open‑source libraries  

Future work:
- Bit‑level decode of C3 status
- Offset map of FF dump
- Error condition simulation

---

**End of document**
