# TestLink Developer's Guide

## 1. Overview & Architecture

TestLink is a stateless client/server interface designed for automated production clients (ICT, functional test, AOI, barcode stations) to communicate with Benchmark Electronics' Shop Floor System (PFS) via Remote Procedure Calls (RPC).

* **Statelessness:** Each request must supply all parameters required to execute the transaction.
* **Session Lifecycle:** 
  1. Client establishes a TCP connection to the server on port `50000`.
  2. Client negotiates a TLS 1.2 handshake.
  3. Client sends a formatted ASCII request ending with a blank line (`\r\n\r\n`).
  4. Server processes the request, sends the response back over the socket ending with a blank line, and closes the connection.
* **Encoding:** Standard ASCII (characters > 0x7F and binary data are unsupported).
* **Line Delimiter:** All message lines must end with CRLF (`\r\n`, `0x0D 0x0A`).
* **Caching:** Server caches PFS operational data for 10 minutes from last access.

---

## 2. Request & Response Formats

### Client Request Structure
```text
REQUEST_TYPE=<procedure name>\r\n
<parameter name>=<parameter value>\r\n
<parameter name>=<parameter value>\r\n
\r\n
```

* **Parameter Rules:**
  * One parameter per line. No newlines inside values; if a value requires a newline, encode it as `&nl;`.
  * Format: `NAME=VALUE` (no spaces around `=` unless intended as part of key/value).
  * Parameter names are **case-sensitive**. Parameter values are generally case-insensitive (unless specified, such as custom test data keys).
  * Request termination: An empty line (two consecutive CRLF delimiters: `\r\n\r\n`).

### Server Response Structure
Responses begin with one of four statuses:

1. **Success (`OK`):**
   ```text
   OK\r\n
   <optional returned data>\r\n
   \r\n
   ```
2. **Warning:**
   ```text
   <procedure name> Warning: <description>\r\n
   <optional additional lines>\r\n
   \r\n
   ```
3. **Failure:** (Process logic error, e.g., board out of route or bad password)
   ```text
   <procedure name> Failure: <description>\r\n
   \r\n
   ```
4. **Error:** (Fatal request formatting error or unreachable database)
   ```text
   <procedure name> Error: <description>\r\n
   \r\n
   ```

#### Response Data Placeholders
To guarantee that data lines do not emit premature blank lines, the server replaces special values:
* Empty string: `<blank>`
* Value not found: `<not found>`
* Blank line within text: `<blank line>`

---

## 3. Delimiter Handling

Delimited lists default to using the semicolon (`;`).

* **Restricted Delimiter Characters:** Letters (`A-Z`, `a-z`), digits (`0-9`), underscore (`_`), space (` `), and brackets (`[` and `]`) **cannot** be used as delimiters.
* **Custom Delimiters:**
  * For requests using `RETURN_VALUES`, the first allowed delimiter character in that parameter defines the list delimiter for both request and response.
  * For `PfsSendResults`, the delimiter character used in `DEFECT_FIELDS` defines the delimiter.
  * To force a custom delimiter without multiple values, append the character: `RETURN_VALUES=VALUE,` or pass `RETURN_VALUES=,`.

---

## 4. Common Parameters

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `REQUEST_TYPE` | Required | Name of the procedure to invoke (e.g., `PfsQuery`). |
| `DATABASE` | Required | Target PFS database alias (e.g., `PFSHSP4`, `PFSMNP4`). |
| `USER_ID` | Required | PFS operator login ID. |
| `PASSWORD` | Required | PFS operator password. |
| `PRODUCTION_ORDER` | Optional/Req | Active production order. Groups assemblies and binds to a routing. |
| `OPERATION_CODE` | Optional/Req | Station operation code along the routing (e.g., `FCT_1`). |
| `WORK_CENTER` | Optional | Logical or physical work center name. |
| `SERIAL_NUMBER` | Optional/Req | Unit Under Test (UUT) serial number. Supports delimited lists for panels. |
| `PASS_FAIL` | Condition | Overall status: `P` (Pass) or `F` (Fail). Supports delimited lists for panels. |
| `RETURN_VALUES` | Optional/Req | Delimited list of requested field names for `Get` procedures. |
| `HISTORY_COMMENT` | Optional | Free-form text (up to 4000 characters) recorded in unit station visit history. |
| `OVERRIDE_OK` | Optional | `TRUE` or `FALSE`. If `TRUE` and operator has permissions, forces unit route move. |
| `MULTIPLE_PO` | Optional | `TRUE` or `FALSE`. Resolves PO individually for panelized serial number lists. |
| `CHECK_ALARMS` | Optional | `TRUE` or `FALSE`. Overrides default yield alarm checking behavior. |

---

## 5. Primary Production Procedures

### `PfsVerifyUserInput`
Validates operator credentials, production order, work center, and operation code before initiating a test cycle.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`
* **Optional Parameters:** `PRODUCTION_ORDER`, `OPERATION_CODE`, `WI_OPERATION`, `ITEM_NUMBER`, `WORK_CENTER`
* *Note:* Verifying `OPERATION_CODE` requires `PRODUCTION_ORDER`.

### `PfsQuery`
Verifies whether a serial number is currently eligible to be processed at the specified operation.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `OPERATION_CODE`, `SERIAL_NUMBER`
* **Optional Parameters:** `PRODUCTION_ORDER`, `ITEM_NUMBER`, `RETURN_VALUES`, `OVERRIDE_OK`, `MULTIPLE_PO`, `CHECK_ALARMS`
* *Allowed `RETURN_VALUES`:* `PFS_SERIAL_NUMBER`

### `PfsSendResults`
Records Pass/Fail status, defect details, and parametric test measurements for serialized or batch units.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `OPERATION_CODE`, `SERIAL_NUMBER` (or `QUANTITY`), `PASS_FAIL`
* **Optional Parameters:** `PRODUCTION_ORDER`, `ITEM_NUMBER`, `WORK_CENTER`, `HISTORY_COMMENT`, `ALT_SERIAL_NUMBER`, `OVERRIDE_OK`, `MULTIPLE_PO`, `CHECK_ALARMS`
* **Defect Parameters (if `PASS_FAIL=F`):** `FAIL_REQUIRES_DEFECT`, `DEFECT_FIELDS`, `DEFECTS`
  * Allowed `DEFECT_FIELDS`: `FAILURE_CODE`, `FAILURE_COMMENT`, `FAILURE_ORIGIN`, `REF_DES`, `DEFECT_CODE`, `DEFECT_QUANTITY`, `DEBUG_COMMENT`, `REPAIR_CODE`, `REPAIR_COMMENT`
  * `DEFECTS` syntax: Enclosed in square brackets, separated by spaces: `DEFECTS=[U1;PCAC08] [U2;PCAC08]`
* **Parametric Test Data:** Any unrecognized `KEY=VALUE` parameter pair passed to `PfsSendResults` is stored in PFS as parametric test data (key max 30 chars, value max 200 chars).

### `PfsSendSignoff`
Used specifically for signoff operations.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `OPERATION_CODE`, `SERIAL_NUMBER`
* **Optional Parameters:** `PRODUCTION_ORDER`, `ITEM_NUMBER`, `WORK_CENTER`, `HISTORY_COMMENT`, `ALT_SERIAL_NUMBER`, `OVERRIDE_OK`, `MULTIPLE_PO`

### `PfsPanelize`
Assigns serial numbers to a common panel identifier at a Panelize operation.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `PRODUCTION_ORDER` (or `ITEM_NUMBER`), `OPERATION_CODE`, `SERIAL_NUMBER`
* **Optional Parameters:** `PANEL_NUMBER`, `PANEL_NUMBER_COMMENT`, `WORK_CENTER`, `HISTORY_COMMENT`, `RETURN_VALUES` (`PANEL_NUMBER`)

### `PfsLinkCompData`
Links sub-assembly serial numbers, components, or tracking values to a parent assembly.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `PRODUCTION_ORDER` (or `ITEM_NUMBER`), `OPERATION_CODE`, `SERIAL_NUMBER`, `REF_DES`, `COMP_SERIAL_NUMBER`
* **Optional Parameters:** `COMP_ITEM_NUMBER`, `COMP_ITEM_REVISION`, `COUNTRY_OF_ORIGIN`, `WORK_CENTER`, `HISTORY_COMMENT`, `OVERRIDE_OK`

### `PfsFindSerialNumber`
Resolves an alternate serial number or raw barcode scan to the primary PFS serial number using Route- or Station-level barcode parsers.
* **Required Parameters:** `REQUEST_TYPE`, `DATABASE`, `USER_ID`, `PASSWORD`, `SERIAL_NUMBER`
* **Optional Parameters:** `PRODUCTION_ORDER`, `ITEM_NUMBER`, `OPERATION_CODE`

---

## 6. Information Query Procedures ("Get" Calls)

* `PfsGetOperationCodes`: Returns route steps or all opcode definitions.
* `PfsGetWorkCenters`: Returns available work centers (`WORK_CENTER`, `WORK_CENTER_DESC`).
* `PfsGetItemInfo`: Resolves customer part numbers, revisions, and descriptions (`COMP_ITEM_NUMBER`, `COMP_ITEM_DESC`, `CUST_ASSEMBLY_NUM`, `CUST_ASSEMBLY_REV`).
* `PfsGetProductionOrderInfo`: Retrieves order quantity, release dates, hold status (`STOP_PRODUCTION`), and references.
* `PfsGetDefectCodes`: Returns allowed defect codes for a production order/operation.
* `PfsGetRepairCodes`: Returns valid repair codes.
* `PfsGetSnHistory`: Retrieves previous station visits and parametric test data (`TEST_DATA_KEY`, `TEST_DATA_VALUE`).
* `PfsGetSnLinkedData`: Returns linked components or custom `SnDetail` / `SnHistoryDetail` keys by `REF_DES`.
* `PfsGetBomItems` / `PfsGetUsageItems`: Fetches Bill of Material items and expected reference designators.

---

## 7. Deprecated Procedures (Legacy Reference Only)

* `PfsLogin` $\rightarrow$ Replaced by `PfsVerifyUserInput`
* `PfsGetItemNumber`, `PfsGetItemRevision`, `PfsGetItemDescription` $\rightarrow$ Replaced by `PfsGetItemInfo`
* `PfsGetRouteSteps` $\rightarrow$ Replaced by `PfsGetOperationCodes`
* `PfsGetLinkStationData` $\rightarrow$ Replaced by `PfsGetSnLinkedData`
* `PfsGetTestResultData` $\rightarrow$ Replaced by `PfsGetSnHistory`