# TestLink Client Integration and Workflow

## 1. Operational Execution Loop

TestLink clients interacting with automated test stations or barcode scanners should implement the standard five-step execution cycle:

```
┌────────────────────────────────────────────────────────┐
│ 1. Startup & Config Load (Read INI / User Settings)    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 2. Operator Session Validation (PfsVerifyUserInput)    │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 3. Scan Serial Number & Verify Route (PfsQuery)        │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 4. Execute Test / Hardware Process                     │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 5. Post Status & Measurements (PfsSendResults)         │
└──────────────────────────┬─────────────────────────────┘
                           │
               (Repeat to Step 3 for next unit)
```

---

## 2. Step-by-Step Implementation Details

### Step 1: Configuration (`.ini`) Initialization
Load persistent site and hardware settings without requiring hardcoded builds:
* `DATABASE`: Facility database alias (e.g., `PFSHSP4`).
* `SERVER`: Hostname DNS alias (e.g., `pfs-gw-hsp4.corp.bench.com`).
* `PORT`: `50000`.
* `WORK_CENTER`: Assigned station identifier (can be left blank if managed automatically by PFS).
* `TIMEOUT`: Minimum 30 seconds (`30000` ms).

### Step 2: Operator Authentication (`PfsVerifyUserInput`)
Prompt the operator once at shift start or order change:
* Gather `USER_ID`, `PASSWORD`, `PRODUCTION_ORDER`, and `OPERATION_CODE`.
* Send `PfsVerifyUserInput`.
* *Failure Handling:* Display the error and allow re-entry. Do not proceed to test execution until verified.
* *Performance Rule:* **Do not call `PfsVerifyUserInput` for every board.** Call it only once per batch/operator change.

### Step 3: Barcode Scan & Eligibility Query (`PfsQuery`)
* Capture the serial number from the barcode scanner (USB HID, virtual COM port, or manual entry).
* Send `PfsQuery`.
* *Evaluation:*
  * `OK`: Proceed to Step 4.
  * `PfsQuery Warning:` Display warning message; prompt operator whether to continue.
  * `PfsQuery Failure:` Unit is out of sequence (e.g., previous step missed) or held. Alert operator, abort the test cycle, and prompt for the next unit.
  * `Error:` Display network/server error; advise operator to contact engineering.

### Step 4: Test Execution
Execute the automated test or functional inspection sequence on the hardware.

### Step 5: Post Results (`PfsSendResults`)
* Send `PASS_FAIL=P` or `PASS_FAIL=F`.
* Include any custom parametric test measurements as top-level `KEY=VALUE` pairs.
* If failed, provide `DEFECT_FIELDS` and formatted `DEFECTS=[...]` strings if supported by the station.
* Close the loop and return to Step 3 for the next barcode scan.

---

## 3. Communication Guidelines & Best Practices

1. **Socket Timeout:** Always configure client socket read/write timeouts to **at least 30 seconds**. The TestLink server interacts with back-end database stored procedures that may experience load delays; short client timeouts result in false disconnection errors.
2. **Connection Reuse:** Open a fresh socket connection per RPC call. TestLink is explicitly designed for the server to terminate the connection upon sending the terminating blank line of its response.
3. **Line Endings:** Enforce strict `\r\n` line endings on every line, and append `\r\n\r\n` to mark the end of the request.
4. **Barcode Delimiters:** If parsing complex 2D DataMatrix labels containing semicolons, define an alternate delimiter in the request using `RETURN_VALUES` or `DEFECT_FIELDS`.