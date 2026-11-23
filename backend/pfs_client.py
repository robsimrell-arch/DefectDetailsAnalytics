"""
TestLink (PFS) TLS 1.2 Socket Client and Serial Number Route Analyzer.
Communicates with Benchmark Electronics' TestLink server over TCP port 50000.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import re
import socket
import ssl
import time

DEFAULT_PFS_PORT = 50000
DEFAULT_PFS_TIMEOUT = 60
DEFAULT_SITE_KEY = "huntsville"
RETURN_DELIMITER = ";"

PFS_SITES = [
    {"key": "huntsville", "name": "Huntsville", "database": "PFSHSP4", "host": "pfs-gw-hsp4.corp.bench.com", "port": 50000},
    {"key": "almelo", "name": "Almelo", "database": "PFSALP4", "host": "pfs-gw-alp4.corp.bench.com", "port": 50000},
    {"key": "angleton", "name": "Angleton", "database": "PFSTXP4", "host": "pfs-gw-txp4.corp.bench.com", "port": 50000},
    {"key": "austin", "name": "Austin", "database": "PFSATP4", "host": "pfs-gw-atp4.corp.bench.com", "port": 50000},
    {"key": "ayuthaya", "name": "Ayuthaya", "database": "PFSTHP4", "host": "pfs-gw-thp4.corp.bench.com", "port": 50000},
    {"key": "brasov", "name": "Brasov", "database": "PFSROP4", "host": "pfs-gw-rop4.corp.bench.com", "port": 50000},
    {"key": "dunseith", "name": "Dunseith", "database": "PFSDNP4", "host": "pfs-gw-dnp4.corp.bench.com", "port": 50000},
    {"key": "guadalajara", "name": "Guadalajara", "database": "PFSMXP4", "host": "pfs-gw-mxp4.corp.bench.com", "port": 50000},
    {"key": "moorpark", "name": "Moorpark", "database": "PFSMPP4", "host": "pfs-gw-mpp4.corp.bench.com", "port": 50000},
    {"key": "nashua", "name": "Nashua", "database": "PFSHDP4", "host": "pfs-gw-hdp4.corp.bench.com", "port": 50000},
    {"key": "penang", "name": "Penang", "database": "PFSMYP4", "host": "pfs-gw-myp4.corp.bench.com", "port": 50000},
    {"key": "phoenix", "name": "Phoenix", "database": "PFSPHP4", "host": "pfs-gw-php4.corp.bench.com", "port": 50000},
    {"key": "precision_tech", "name": "Precision Technologies", "database": "PFSPTP4", "host": "pfs-gw-ptp4.corp.bench.com", "port": 50000},
    {"key": "rochester", "name": "Rochester", "database": "PFSMNP4", "host": "pfs-gw-mnp4.corp.bench.com", "port": 50000},
    {"key": "san_jose", "name": "San Jose", "database": "PFSSJP4", "host": "pfs-gw-sjp4.corp.bench.com", "port": 50000},
    {"key": "santa_anna", "name": "Santa Anna", "database": "PFSSAP4", "host": "pfs-gw-sap4.corp.bench.com", "port": 50000},
    {"key": "scottsdale", "name": "Scottsdale AZ IoT Group", "database": "PFSSZP4", "host": "pfs-gw-szp4.corp.bench.com", "port": 50000},
    {"key": "suzhou", "name": "Suzhou", "database": "PFSCHP4", "host": "pfs-gw-chp4.corp.bench.com", "port": 50000},
    {"key": "tijuana", "name": "Tijuana", "database": "PFSTIP4", "host": "pfs-gw-tip4.corp.bench.com", "port": 50000},
    {"key": "tijuana_filtros", "name": "Tijuana (Filtros)", "database": "PFSFLP4", "host": "pfs-gw-flp4.corp.bench.com", "port": 50000},
    {"key": "winona", "name": "Winona", "database": "PFSMNP4", "host": "pfs-gw-mnp4.corp.bench.com", "port": 50000},
]

_PO_FIELDS = [
    "COMP_ITEM_NUMBER",
    "CUST_ITEM_REV",
    "QUANTITY",
    "CREATE_DATE",
    "RELEASE_DATE",
    "COMPLETION_DATE",
    "WORK_ORDER",
    "STOP_PRODUCTION",
    "STOP_PRODUCTION_OPCODE",
    "STOP_SHIP",
    "STOP_PRODUCTION_COMMENT",
    "STOP_PRODUCTION_OPCODE_COMMENT",
    "STOP_SHIP_COMMENT",
]

_ROUTE_FIELDS = [
    "OPERATION_CODE",
    "OPERATION_DESC",
    "OPERATION_TYPE",
    "STATION_TYPE",
    "STEP_TYPE",
    "STEP_ORDER",
    "ROUTE_VERIFICATION",
]

_HISTORY_FIELDS = [
    "CREATE_DATE",
    "SRC_PRODUCTION_ORDER",
    "SRC_OPERATION_CODE",
    "PASS_FAIL",
    "WORK_CENTER",
    "OPERATOR_ID",
    "HIST_ITEM_NUMBER",
    "HISTORY_COMMENT",
]

_STATUS_FIELDS = [
    "STATUS",
    "ITEM_NUMBER",
    "PRODUCTION_ORDER",
    "OPERATION_CODE",
    "DATE",
    "USER",
    "COMMENTS",
]

_DEFECT_FIELDS = [
    "SRC_OPERATION_CODE",
    "SRC_PRODUCTION_ORDER",
    "FAILURE_CODE",
    "FAILURE_ORIGIN",
    "REF_DES",
    "COMP_ITEM_NUMBER",
    "DEFECT_CODE",
    "DEFECT_QUANTITY",
    "IS_REPAIRED",
    "REPAIR_CODE",
    "DEBUG_TECH",
    "REPAIR_TECH",
    "FAILURE_COMMENT",
    "DEBUG_COMMENT",
    "REPAIR_COMMENT",
]

_AUTH_KEYWORDS = (
    "password",
    "user_id",
    "user id",
    "userid",
    "invalid user",
    "login",
    "not authorized",
    "unauthorized",
    "authentication",
    "credentials",
)


class PfsConnectionError(Exception):
    """Raised when TCP/TLS communication with the TestLink server fails."""


class PfsProtocolError(Exception):
    """Raised when a TestLink response cannot be interpreted."""


def _encode_value(val):
    """Encodes a parameter value into single-line ASCII for TestLink."""
    text = str(val)
    text = text.replace("\r\n", "&nl;").replace("\n", "&nl;").replace("\r", "&nl;")
    return text.encode("ascii", "replace").decode("ascii")


def _decode_field(val):
    """Decodes TestLink response placeholders and encoded newlines."""
    if val is None:
        return ""
    text = str(val).strip()
    if text in ("<blank>", "<not found>", "<blank line>"):
        return ""
    text = text.replace("<blank line>", "")
    text = text.replace("<blank>", "")
    text = text.replace("<not found>", "")
    text = text.replace("&nl;", "\n")
    return text


def _coalesce_multiline_rows(lines, delimiter, total_delims, min_start_delims):
    """Reassembles logical TestLink records split by literal newlines inside comment fields."""
    non_empty = [line for line in (lines or []) if line is not None and line != ""]
    if not non_empty or min_start_delims <= 0 or total_delims <= 0:
        return non_empty
    merged = []
    for line in non_empty:
        if not merged:
            merged.append(line)
            continue
        if merged[-1].count(delimiter) < total_delims or line.count(delimiter) < min_start_delims:
            merged[-1] = merged[-1] + "\n" + line
        else:
            merged.append(line)
    return merged


def _parse_delimited_rows(
    lines,
    fields,
    delimiter=RETURN_DELIMITER,
    maxsplit_last=False,
    min_start_delims=0,
):
    """Parses delimited TestLink data lines into dicts keyed by field names."""
    rows = []
    non_empty = [line for line in (lines or []) if line is not None and line != ""]
    if not non_empty:
        return rows
    batch_delim = (
        ";"
        if (delimiter != ";" and all(delimiter not in l for l in non_empty) and any(";" in l for l in non_empty))
        else delimiter
    )
    if min_start_delims > 0 and len(fields) > 1:
        logical_lines = _coalesce_multiline_rows(non_empty, batch_delim, len(fields) - 1, min_start_delims)
    else:
        logical_lines = non_empty
    split_limit = len(fields) - 1 if maxsplit_last and len(fields) > 1 else -1
    for line in logical_lines:
        active_delim = ";" if (batch_delim != ";" and batch_delim not in line and ";" in line) else batch_delim
        parts = line.split(active_delim, split_limit) if split_limit > 0 else line.split(active_delim)
        if len(parts) < len(fields):
            parts.extend([""] * (len(fields) - len(parts)))
        row = {fields[i]: _decode_field(parts[i]) for i in range(len(fields))}
        rows.append(row)
    return rows


def _normalize_op_key(op_code):
    """Normalizes operation codes for matching across route, history, and PfsQuery."""
    return re.sub(r"\s+", " ", str(op_code or "").strip()).upper()


def _is_auth_error(message):
    msg_lower = (message or "").lower()
    return any(kw in msg_lower for kw in _AUTH_KEYWORDS)


def _is_truthy_flag(val):
    return str(val or "").strip().upper() in ("Y", "YES", "TRUE", "T", "1")


def _is_defect_repaired(is_rep_raw, repair_code):
    """Returns True if IS_REPAIRED is truthy or a non-placeholder REPAIR_CODE is assigned."""
    if _is_truthy_flag(is_rep_raw):
        return True
    cleaned_code = str(repair_code or "").strip()
    if cleaned_code and cleaned_code.upper() not in ("NONE", "N/A", "OPEN", "UNREPAIRED"):
        return True
    return False


def _step_sort_key(row, original_idx):
    raw = str(row.get("STEP_ORDER", "")).strip()
    if raw:
        try:
            return (0, float(raw), original_idx)
        except ValueError:
            match = re.search(r"-?\d+(?:\.\d+)?", raw)
            if match:
                return (0, float(match.group(0)), original_idx)
    return (1, float(original_idx), original_idx)


def _normalize_pass_fail(raw_val):
    cleaned = str(raw_val or "").strip().upper()
    if cleaned in ("P", "PASS", "PASSED"):
        return "Pass"
    if cleaned in ("F", "FAIL", "FAILED"):
        return "Fail"
    return "Visited"


class PfsClient:
    """Stateless TLS 1.2 RPC client for Benchmark TestLink."""

    def __init__(self, host, database, user_id, password, port=DEFAULT_PFS_PORT, timeout=DEFAULT_PFS_TIMEOUT):
        self.host = str(host or "").strip()
        self.database = str(database or "").strip()
        self.user_id = str(user_id or "").strip()
        self.password = str(password or "")
        self.port = int(port or DEFAULT_PFS_PORT)
        self.timeout = float(timeout or DEFAULT_PFS_TIMEOUT)

    def __repr__(self):
        return (
            f"PfsClient(host={self.host!r}, port={self.port!r}, "
            f"database={self.database!r}, user_id={self.user_id!r}, password='***')"
        )

    def _build_ssl_context(self):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        return ctx

    def _redact_secret(self, text):
        if self.password and self.password in text:
            return text.replace(self.password, "***")
        return text

    def send_request(self, request_type, params=None, retries=1):
        """Executes a single TestLink RPC request on a fresh TLS 1.2 socket."""
        if not self.host:
            raise PfsConnectionError("TestLink host is required.")
        if not self.database:
            raise PfsConnectionError("TestLink database is required.")

        fields = {
            "REQUEST_TYPE": request_type,
            "DATABASE": self.database,
            "USER_ID": self.user_id,
            "PASSWORD": self.password,
        }
        if params:
            for k, v in params.items():
                if v is not None:
                    fields[k] = v

        payload_str = "".join(f"{k}={_encode_value(v)}\r\n" for k, v in fields.items()) + "\r\n"
        payload_bytes = payload_str.encode("ascii")

        ssl_ctx = self._build_ssl_context()
        raw_lines = []
        last_exc = None

        for attempt in range(retries + 1):
            raw_sock = None
            ssl_sock = None
            sock_file = None
            sent = False
            try:
                raw_sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
                ssl_sock = ssl_ctx.wrap_socket(raw_sock)
                ssl_sock.settimeout(self.timeout)
                sent = True
                ssl_sock.sendall(payload_bytes)

                sock_file = ssl_sock.makefile("rb")
                raw_lines = []
                while True:
                    line_bytes = sock_file.readline()
                    if not line_bytes:
                        break
                    decoded = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
                    if decoded == "":
                        break
                    raw_lines.append(decoded)
                last_exc = None
                break
            except (socket.timeout, TimeoutError, OSError, ssl.SSLError) as exc:
                last_exc = exc
                if attempt < retries and not sent:
                    time.sleep(0.5)
                    continue
                break
            finally:
                if sock_file is not None:
                    try:
                        sock_file.close()
                    except Exception:
                        pass
                if ssl_sock is not None:
                    try:
                        ssl_sock.close()
                    except Exception:
                        pass
                elif raw_sock is not None:
                    try:
                        raw_sock.close()
                    except Exception:
                        pass

        if last_exc is not None:
            safe_err = self._redact_secret(f"{type(last_exc).__name__}: {last_exc}")
            raise PfsConnectionError(f"TestLink connection failed ({self.host}:{self.port}): {safe_err}") from last_exc

        if not raw_lines:
            return {"status": "Error", "message": "Empty response from TestLink server", "lines": []}

        line0 = raw_lines[0].strip()
        if line0 == "OK":
            return {"status": "OK", "message": "", "lines": raw_lines[1:]}
        if "Warning:" in line0:
            return {"status": "Warning", "message": line0, "lines": raw_lines[1:]}
        if "Failure:" in line0:
            return {"status": "Failure", "message": line0, "lines": raw_lines[1:]}
        if "Error:" in line0:
            return {"status": "Error", "message": line0, "lines": raw_lines[1:]}
        return {"status": "Error", "message": line0 or "Empty response from TestLink server", "lines": raw_lines[1:]}


def _full_response_message(resp):
    parts = [p for p in [resp.get("message", "")] + list(resp.get("lines") or []) if p]
    return " | ".join(parts)


def verify_credentials(host, database, user_id, password, port=DEFAULT_PFS_PORT, timeout=DEFAULT_PFS_TIMEOUT):
    """Validates PFS operator credentials using PfsVerifyUserInput."""
    client = PfsClient(host, database, user_id, password, port=port, timeout=timeout)
    resp = client.send_request("PfsVerifyUserInput")
    ok = resp["status"] in ("OK", "Warning")
    details = [p for p in [resp["message"]] + list(resp.get("lines") or []) if p]
    full_message = "\n".join(details)
    return {
        "ok": ok,
        "status": resp["status"],
        "message": full_message or ("Credentials verified" if ok else "Verification failed"),
    }


def _fetch_po_rows(client, serial_number, item_number="", production_order="", force_fresh=False):
    """Attempts to resolve Production Order info rows for a serial number."""
    warnings = []
    resolved_sn = serial_number
    last_failure_msg = ""
    po_return_values = RETURN_DELIMITER.join(_PO_FIELDS)
    cache_flag = "FALSE" if force_fresh else None

    def _call_po(params):
        if cache_flag is not None:
            params["USE_CACHED_INFO"] = cache_flag
        return client.send_request("PfsGetProductionOrderInfo", params)

    def _check_error(resp):
        full_msg = _full_response_message(resp)
        if resp["status"] == "Error":
            return {"ok": False, "authError": _is_auth_error(full_msg), "found": False, "error": full_msg, "status": resp["status"]}
        if resp["status"] == "Failure" and _is_auth_error(full_msg):
            return {"ok": False, "authError": True, "found": False, "error": full_msg, "status": resp["status"]}
        return None

    po_rows = []
    requested_po = (production_order or "").strip()

    if requested_po:
        resp = _call_po({
            "PRODUCTION_ORDER": requested_po,
            "RETURN_VALUES": po_return_values,
        })
        err = _check_error(resp)
        if err:
            return None, resolved_sn, warnings, err
        if resp["status"] in ("OK", "Warning"):
            if resp["status"] == "Warning" and resp["message"]:
                warnings.append(_full_response_message(resp))
            po_rows = _parse_delimited_rows(
                resp["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
            )
        elif resp["message"]:
            last_failure_msg = _full_response_message(resp)

    if not po_rows and item_number:
        resp = _call_po({
            "ITEM_NUMBER": item_number,
            "SERIAL_NUMBER": resolved_sn,
            "RETURN_VALUES": po_return_values,
        })
        err = _check_error(resp)
        if err:
            return None, resolved_sn, warnings, err
        if resp["status"] in ("OK", "Warning"):
            if resp["status"] == "Warning" and resp["message"]:
                warnings.append(_full_response_message(resp))
            po_rows = _parse_delimited_rows(
                resp["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
            )
        elif resp["message"]:
            last_failure_msg = _full_response_message(resp)

    if not po_rows:
        resp = _call_po({
            "SERIAL_NUMBER": resolved_sn,
            "RETURN_VALUES": po_return_values,
        })
        err = _check_error(resp)
        if err:
            return None, resolved_sn, warnings, err
        if resp["status"] in ("OK", "Warning"):
            if resp["status"] == "Warning" and resp["message"]:
                warnings.append(_full_response_message(resp))
            po_rows = _parse_delimited_rows(
                resp["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
            )
        elif resp["message"]:
            last_failure_msg = _full_response_message(resp)

    if not po_rows:
        find_params = {
            "SERIAL_NUMBER": serial_number,
            "RETURN_VALUES": "PFS_SERIAL_NUMBER",
        }
        if item_number:
            find_params["ITEM_NUMBER"] = item_number
        if requested_po:
            find_params["PRODUCTION_ORDER"] = requested_po
        find_resp = client.send_request("PfsFindSerialNumber", find_params)
        err = _check_error(find_resp)
        if err:
            return None, resolved_sn, warnings, err
        if find_resp["status"] in ("OK", "Warning") and find_resp["lines"]:
            candidate_sn = _decode_field(find_resp["lines"][0].split(RETURN_DELIMITER)[0])
            if candidate_sn and candidate_sn != resolved_sn:
                resolved_sn = candidate_sn
                if item_number:
                    retry_item = _call_po({
                        "ITEM_NUMBER": item_number,
                        "SERIAL_NUMBER": resolved_sn,
                        "RETURN_VALUES": po_return_values,
                    })
                    err = _check_error(retry_item)
                    if err:
                        return None, resolved_sn, warnings, err
                    if retry_item["status"] in ("OK", "Warning"):
                        po_rows = _parse_delimited_rows(
                            retry_item["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
                        )
                    elif retry_item["message"]:
                        last_failure_msg = _full_response_message(retry_item)
                if not po_rows:
                    retry_sn = _call_po({
                        "SERIAL_NUMBER": resolved_sn,
                        "RETURN_VALUES": po_return_values,
                    })
                    err = _check_error(retry_sn)
                    if err:
                        return None, resolved_sn, warnings, err
                    if retry_sn["status"] in ("OK", "Warning"):
                        po_rows = _parse_delimited_rows(
                            retry_sn["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
                        )
                    elif retry_sn["message"]:
                        last_failure_msg = _full_response_message(retry_sn)

    # Deduplicate identical PO info rows while preserving order
    deduped = []
    seen_sigs = set()
    for row in po_rows:
        sig = tuple(row.get(f, "") for f in _PO_FIELDS)
        if sig not in seen_sigs:
            seen_sigs.add(sig)
            deduped.append(row)

    if not deduped:
        return [], resolved_sn, warnings, {
            "ok": True,
            "found": False,
            "serialNumber": serial_number,
            "resolvedSerialNumber": resolved_sn,
            "error": last_failure_msg or "Serial number not found in PFS",
        }

    return deduped, resolved_sn, warnings, None


def analyze_serial_number(
    host,
    database,
    user_id,
    password,
    serial_number,
    item_number="",
    production_order="",
    force_fresh=False,
    port=DEFAULT_PFS_PORT,
    timeout=DEFAULT_PFS_TIMEOUT,
):
    """Fetches full PFS route, history, status, defects, and live PfsQuery eligibility for a serial number."""
    sn_clean = str(serial_number or "").strip()
    if not sn_clean:
        return {"ok": False, "found": False, "error": "Serial number is required."}

    item_clean = str(item_number or "").strip()
    po_clean = str(production_order or "").strip()
    client = PfsClient(host, database, user_id, password, port=port, timeout=timeout)

    # Step A: Resolve Production Order info & item number (and canonical SN if aliased)
    po_rows, resolved_sn, warnings, early_exit = _fetch_po_rows(
        client, sn_clean, item_number=item_clean, production_order=po_clean, force_fresh=force_fresh
    )
    if early_exit is not None:
        return early_exit

    selected_po = po_rows[0] if po_rows else {}
    effective_item_number = selected_po.get("COMP_ITEM_NUMBER", "").strip() or item_clean

    # Step B: Fetch live SN History, SN Status, and SN Defects in parallel (always bypass cache)
    if po_clean:
        base_selector = {"PRODUCTION_ORDER": po_clean, "SERIAL_NUMBER": resolved_sn}
    elif effective_item_number:
        base_selector = {"ITEM_NUMBER": effective_item_number, "SERIAL_NUMBER": resolved_sn}
    else:
        base_selector = {"SERIAL_NUMBER": resolved_sn}

    def _get_history(sel=base_selector):
        params = dict(sel)
        params["RETURN_VALUES"] = RETURN_DELIMITER.join(_HISTORY_FIELDS)
        params["USE_CACHED_INFO"] = "FALSE"
        return client.send_request("PfsGetSnHistory", params)

    def _get_status(sel=base_selector):
        if "PRODUCTION_ORDER" not in sel and "ITEM_NUMBER" not in sel:
            return {"status": "Failure", "message": "", "lines": []}
        params = dict(sel)
        params["RETURN_VALUES"] = RETURN_DELIMITER.join(_STATUS_FIELDS)
        params["USE_CACHED_INFO"] = "FALSE"
        return client.send_request("PfsGetSnStatus", params)

    def _get_defects(sel=base_selector):
        if "PRODUCTION_ORDER" not in sel and "ITEM_NUMBER" not in sel:
            return {"status": "Failure", "message": "", "lines": []}
        params = dict(sel)
        params["RETURN_VALUES"] = RETURN_DELIMITER.join(_DEFECT_FIELDS)
        params["USE_CACHED_INFO"] = "FALSE"
        return client.send_request("PfsGetSnDefects", params)

    with ThreadPoolExecutor(max_workers=3) as pool:
        hist_future = pool.submit(_get_history)
        status_future = pool.submit(_get_status)
        defects_future = pool.submit(_get_defects)
        hist_resp = hist_future.result()
        status_resp = status_future.result()
        defects_resp = defects_future.result()

    # Parse SN History
    raw_history = []
    if hist_resp["status"] in ("OK", "Warning"):
        if hist_resp["status"] == "Warning" and hist_resp["message"]:
            warnings.append(_full_response_message(hist_resp))
        raw_history = _parse_delimited_rows(
            hist_resp["lines"], _HISTORY_FIELDS, maxsplit_last=True, min_start_delims=7
        )
    elif hist_resp["status"] == "Error":
        warnings.append(_full_response_message(hist_resp))

    # Parse SN Status (Warning means no inactivation statuses assigned — normal active unit)
    sn_statuses = []
    if status_resp["status"] == "OK":
        parsed_statuses = _parse_delimited_rows(
            status_resp["lines"], _STATUS_FIELDS, maxsplit_last=True, min_start_delims=6
        )
        for st in parsed_statuses:
            sn_statuses.append({
                "status": st.get("STATUS", ""),
                "itemNumber": st.get("ITEM_NUMBER", ""),
                "productionOrder": st.get("PRODUCTION_ORDER", ""),
                "operationCode": st.get("OPERATION_CODE", ""),
                "date": st.get("DATE", ""),
                "user": st.get("USER", ""),
                "comments": st.get("COMMENTS", ""),
            })
    elif status_resp["status"] == "Error":
        warnings.append(_full_response_message(status_resp))

    # Parse SN Defects
    defects = []
    if defects_resp["status"] in ("OK", "Warning"):
        if defects_resp["status"] == "Warning" and defects_resp["message"]:
            warnings.append(_full_response_message(defects_resp))
        parsed_defects = _parse_delimited_rows(
            defects_resp["lines"], _DEFECT_FIELDS, maxsplit_last=True, min_start_delims=12
        )
        for df in parsed_defects:
            is_rep_raw = df.get("IS_REPAIRED", "").strip()
            repair_code = df.get("REPAIR_CODE", "")
            defects.append({
                "srcOperationCode": df.get("SRC_OPERATION_CODE", ""),
                "srcProductionOrder": df.get("SRC_PRODUCTION_ORDER", ""),
                "failureCode": df.get("FAILURE_CODE", ""),
                "failureOrigin": df.get("FAILURE_ORIGIN", ""),
                "refDes": df.get("REF_DES", ""),
                "compItemNumber": df.get("COMP_ITEM_NUMBER", ""),
                "defectCode": df.get("DEFECT_CODE", ""),
                "defectQuantity": df.get("DEFECT_QUANTITY", ""),
                "isRepaired": _is_defect_repaired(is_rep_raw, repair_code),
                "isRepairedRaw": is_rep_raw,
                "repairCode": repair_code,
                "debugTech": df.get("DEBUG_TECH", ""),
                "repairTech": df.get("REPAIR_TECH", ""),
                "failureComment": df.get("FAILURE_COMMENT", ""),
                "debugComment": df.get("DEBUG_COMMENT", ""),
                "repairComment": df.get("REPAIR_COMMENT", ""),
            })
    elif defects_resp["status"] == "Error":
        warnings.append(_full_response_message(defects_resp))

    # Discover Production Order(s) & backfill Item Number from live responses
    if not effective_item_number:
        for h in raw_history:
            hist_item = h.get("HIST_ITEM_NUMBER", "").strip()
            if hist_item:
                effective_item_number = hist_item
                break
    if not effective_item_number and sn_statuses:
        effective_item_number = sn_statuses[0].get("itemNumber", "").strip()

    discovered_pos = []
    seen_pos = set()

    def _add_po(candidate):
        val = str(candidate or "").strip()
        if val and val.upper() not in seen_pos:
            seen_pos.add(val.upper())
            discovered_pos.append(val)

    if po_clean:
        _add_po(po_clean)
    for h in raw_history:
        _add_po(h.get("SRC_PRODUCTION_ORDER", ""))
    for st in sn_statuses:
        _add_po(st.get("productionOrder", ""))
    for df in defects:
        _add_po(df.get("srcProductionOrder", ""))

    # If status/defects were skipped earlier because neither PO nor Item was known, fetch now if discovered
    if "PRODUCTION_ORDER" not in base_selector and "ITEM_NUMBER" not in base_selector:
        fallback_sel = None
        if po_clean or discovered_pos:
            fallback_sel = {"PRODUCTION_ORDER": po_clean or discovered_pos[0], "SERIAL_NUMBER": resolved_sn}
        elif effective_item_number:
            fallback_sel = {"ITEM_NUMBER": effective_item_number, "SERIAL_NUMBER": resolved_sn}
        if fallback_sel:
            with ThreadPoolExecutor(max_workers=2) as pool:
                st_f = pool.submit(_get_status, fallback_sel)
                df_f = pool.submit(_get_defects, fallback_sel)
                st_r = st_f.result()
                df_r = df_f.result()
            if st_r["status"] == "OK":
                for st in _parse_delimited_rows(
                    st_r["lines"], _STATUS_FIELDS, maxsplit_last=True, min_start_delims=6
                ):
                    sn_statuses.append({
                        "status": st.get("STATUS", ""),
                        "itemNumber": st.get("ITEM_NUMBER", ""),
                        "productionOrder": st.get("PRODUCTION_ORDER", ""),
                        "operationCode": st.get("OPERATION_CODE", ""),
                        "date": st.get("DATE", ""),
                        "user": st.get("USER", ""),
                        "comments": st.get("COMMENTS", ""),
                    })
                    _add_po(st.get("productionOrder", ""))
            if df_r["status"] in ("OK", "Warning"):
                for df in _parse_delimited_rows(
                    df_r["lines"], _DEFECT_FIELDS, maxsplit_last=True, min_start_delims=12
                ):
                    is_rep_raw = df.get("IS_REPAIRED", "").strip()
                    repair_code = df.get("REPAIR_CODE", "")
                    defects.append({
                        "srcOperationCode": df.get("SRC_OPERATION_CODE", ""),
                        "srcProductionOrder": df.get("SRC_PRODUCTION_ORDER", ""),
                        "failureCode": df.get("FAILURE_CODE", ""),
                        "failureOrigin": df.get("FAILURE_ORIGIN", ""),
                        "refDes": df.get("REF_DES", ""),
                        "compItemNumber": df.get("COMP_ITEM_NUMBER", ""),
                        "defectCode": df.get("DEFECT_CODE", ""),
                        "defectQuantity": df.get("DEFECT_QUANTITY", ""),
                        "isRepaired": _is_defect_repaired(is_rep_raw, repair_code),
                        "isRepairedRaw": is_rep_raw,
                        "repairCode": repair_code,
                        "debugTech": df.get("DEBUG_TECH", ""),
                        "repairTech": df.get("REPAIR_TECH", ""),
                        "failureComment": df.get("FAILURE_COMMENT", ""),
                        "debugComment": df.get("DEBUG_COMMENT", ""),
                        "repairComment": df.get("REPAIR_COMMENT", ""),
                    })
                    _add_po(df.get("srcProductionOrder", ""))

    verified_po = po_clean or (discovered_pos[0] if discovered_pos else "")

    if verified_po and (po_clean or not po_rows or len(po_rows) > 1):
        po_refresh_params = {
            "PRODUCTION_ORDER": verified_po,
            "RETURN_VALUES": RETURN_DELIMITER.join(_PO_FIELDS),
        }
        if force_fresh:
            po_refresh_params["USE_CACHED_INFO"] = "FALSE"
        po_refresh = client.send_request("PfsGetProductionOrderInfo", po_refresh_params)
        if po_refresh["status"] in ("OK", "Warning") and po_refresh["lines"]:
            refreshed = _parse_delimited_rows(
                po_refresh["lines"], _PO_FIELDS, maxsplit_last=True, min_start_delims=10
            )
            if refreshed:
                selected_po = refreshed[0]
                effective_item_number = selected_po.get("COMP_ITEM_NUMBER", "").strip() or effective_item_number

    if discovered_pos:
        production_orders_list = []
        for po_num in discovered_pos:
            if po_num == verified_po:
                entry = dict(selected_po)
                entry["PRODUCTION_ORDER"] = po_num
                if not entry.get("COMP_ITEM_NUMBER"):
                    entry["COMP_ITEM_NUMBER"] = effective_item_number
                production_orders_list.append(entry)
            else:
                production_orders_list.append({
                    "PRODUCTION_ORDER": po_num,
                    "COMP_ITEM_NUMBER": effective_item_number,
                })
    else:
        display_entry = dict(selected_po)
        display_entry["PRODUCTION_ORDER"] = selected_po.get("WORK_ORDER", "").strip()
        if not display_entry.get("COMP_ITEM_NUMBER"):
            display_entry["COMP_ITEM_NUMBER"] = effective_item_number
        production_orders_list = (
            [display_entry]
            if (display_entry.get("PRODUCTION_ORDER") or display_entry.get("COMP_ITEM_NUMBER"))
            else []
        )

    selected_po_num = verified_po or selected_po.get("WORK_ORDER", "").strip()

    # Step C: Fetch ordered route operations
    route_rv = RETURN_DELIMITER.join(_ROUTE_FIELDS)
    route_used_po = False
    route_resp = None

    if verified_po:
        op_params = {
            "PRODUCTION_ORDER": verified_po,
            "RETURN_VALUES": route_rv,
        }
        if force_fresh:
            op_params["USE_CACHED_INFO"] = "FALSE"
        route_resp = client.send_request("PfsGetOperationCodes", op_params)
        if route_resp["status"] in ("OK", "Warning"):
            route_used_po = True

    if (route_resp is None or route_resp["status"] == "Failure") and effective_item_number:
        op_params = {
            "ITEM_NUMBER": effective_item_number,
            "SERIAL_NUMBER": resolved_sn,
            "RETURN_VALUES": route_rv,
        }
        if force_fresh:
            op_params["USE_CACHED_INFO"] = "FALSE"
        route_resp = client.send_request("PfsGetOperationCodes", op_params)
        route_used_po = False

    if route_resp is None:
        raw_route = []
    elif route_resp["status"] == "Error":
        err_msg = _full_response_message(route_resp)
        return {"ok": False, "authError": _is_auth_error(err_msg), "found": False, "error": err_msg}
    elif route_resp["status"] == "Failure":
        err_msg = _full_response_message(route_resp)
        if _is_auth_error(err_msg):
            return {"ok": False, "authError": True, "found": False, "error": err_msg}
        warnings.append(err_msg or f"No route steps returned for PO {selected_po_num or resolved_sn}")
        raw_route = []
    else:
        if route_resp["status"] == "Warning" and route_resp["message"]:
            warnings.append(_full_response_message(route_resp))
        raw_route = _parse_delimited_rows(route_resp["lines"], _ROUTE_FIELDS)

    indexed_route = sorted(enumerate(raw_route), key=lambda pair: _step_sort_key(pair[1], pair[0]))
    ordered_route = [pair[1] for pair in indexed_route]

    # Step D: Parallel PfsQuery across non-serialization route operations with OVERRIDE_OK=FALSE
    unique_op_codes = []
    ops_to_query = []
    seen_ops = set()
    query_map = {}
    for step in ordered_route:
        op_code = step.get("OPERATION_CODE", "").strip()
        op_key = _normalize_op_key(op_code)
        if op_key and op_key not in seen_ops:
            seen_ops.add(op_key)
            unique_op_codes.append(op_code)
            station_type = step.get("STATION_TYPE", "").strip().upper()
            op_type = step.get("OPERATION_TYPE", "").strip().upper()
            if station_type == "SER" or op_type == "SERIALIZE":
                query_map[op_key] = {
                    "queryStatus": "Skipped",
                    "queryMessage": "Not applicable for Serialization (SER) station.",
                    "isActive": False,
                }
            else:
                ops_to_query.append(op_code)

    if verified_po and route_used_po:
        query_base = {"PRODUCTION_ORDER": verified_po, "SERIAL_NUMBER": resolved_sn}
    elif effective_item_number:
        query_base = {"ITEM_NUMBER": effective_item_number, "SERIAL_NUMBER": resolved_sn}
    else:
        query_base = {"SERIAL_NUMBER": resolved_sn}

    if ops_to_query:
        def _probe_op(op_code):
            q_params = dict(query_base)
            q_params["OPERATION_CODE"] = op_code
            q_params["OVERRIDE_OK"] = "FALSE"
            resp = client.send_request("PfsQuery", q_params)
            return op_code, resp

        with ThreadPoolExecutor(max_workers=min(6, len(ops_to_query))) as pool:
            for op_code, q_resp in pool.map(_probe_op, ops_to_query):
                query_map[_normalize_op_key(op_code)] = {
                    "queryStatus": q_resp["status"],
                    "queryMessage": _full_response_message(q_resp),
                    "isActive": q_resp["status"] in ("OK", "Warning"),
                }

    # Step E: Map history to route steps and classify each operation
    route_op_set = {_normalize_op_key(op) for op in unique_op_codes}
    history_by_op = {}
    all_history = []
    off_route_history = []

    for h in raw_history:
        src_op = h.get("SRC_OPERATION_CODE", "").strip()
        src_op_key = _normalize_op_key(src_op)
        src_po = h.get("SRC_PRODUCTION_ORDER", "").strip()
        matches_po = (not verified_po) or (not src_po) or (src_po.upper() == verified_po.upper())
        on_route = (src_op_key in route_op_set) and matches_po
        outcome = _normalize_pass_fail(h.get("PASS_FAIL", ""))
        entry = {
            "createDate": h.get("CREATE_DATE", ""),
            "srcProductionOrder": src_po,
            "srcOperationCode": src_op,
            "passFailRaw": h.get("PASS_FAIL", ""),
            "outcome": outcome,
            "workCenter": h.get("WORK_CENTER", ""),
            "operatorId": h.get("OPERATOR_ID", ""),
            "historyComment": h.get("HISTORY_COMMENT", ""),
            "onCurrentRoute": on_route,
            "matchesSelectedPo": matches_po,
        }
        all_history.append(entry)
        if on_route:
            history_by_op.setdefault(src_op_key, []).append(entry)
        else:
            off_route_history.append(entry)

    pre_steps = []
    for idx, step in enumerate(ordered_route):
        op_code = step.get("OPERATION_CODE", "").strip()
        op_key = _normalize_op_key(op_code)
        step_type = step.get("STEP_TYPE", "").strip()
        is_optional = step_type.upper().startswith("MAY_")
        is_required = not is_optional

        visits = history_by_op.get(op_key, [])
        pass_count = sum(1 for v in visits if v["outcome"] in ("Pass", "Visited"))
        fail_count = sum(1 for v in visits if v["outcome"] == "Fail")
        latest_visit = visits[0] if visits else None

        if latest_visit is None:
            latest_outcome = "unvisited"
        elif latest_visit["outcome"] == "Fail":
            latest_outcome = "failed"
        else:
            latest_outcome = "passed"

        prior_fail_count = 0
        if latest_outcome == "passed" and len(visits) > 1:
            prior_fail_count = sum(1 for v in visits[1:] if v["outcome"] == "Fail")

        q_info = query_map.get(op_key, {"queryStatus": "Error", "queryMessage": "", "isActive": False})

        pre_steps.append({
            "index": idx,
            "stepOrder": step.get("STEP_ORDER", "").strip() or str(idx + 1),
            "operationCode": op_code,
            "operationDesc": step.get("OPERATION_DESC", ""),
            "operationType": step.get("OPERATION_TYPE", ""),
            "stationType": step.get("STATION_TYPE", ""),
            "stepType": step_type,
            "routeVerification": step.get("ROUTE_VERIFICATION", ""),
            "isOptional": is_optional,
            "isRequired": is_required,
            "latestOutcome": latest_outcome,
            "isActive": q_info["isActive"],
            "queryStatus": q_info["queryStatus"],
            "queryMessage": q_info["queryMessage"],
            "passCount": pass_count,
            "failCount": fail_count,
            "priorFailCount": prior_fail_count,
            "latestVisit": latest_visit,
            "visits": visits,
        })

    # Compute furthest progress index to label earlier unvisited MAY_VISIT steps as "skipped"
    progress_indices = [
        s["index"] for s in pre_steps
        if s["latestOutcome"] in ("passed", "failed") or (s["isActive"] and s["isRequired"])
    ]
    if progress_indices:
        max_progress_idx = max(progress_indices)
    else:
        any_active_indices = [s["index"] for s in pre_steps if s["isActive"]]
        max_progress_idx = max(any_active_indices) if any_active_indices else -1

    route_steps = []
    passed_steps = []
    failed_steps = []
    primary_active_steps = []
    optional_active_steps = []
    remaining_required_steps = []
    remaining_optional_steps = []
    skipped_optional_steps = []

    for s in pre_steps:
        if s["latestOutcome"] == "passed":
            classification = "passed"
            passed_steps.append(s["operationCode"])
        elif s["latestOutcome"] == "failed":
            classification = "failed"
            failed_steps.append(s["operationCode"])
        elif s["isActive"]:
            classification = "active"
        elif s["isOptional"] and s["index"] < max_progress_idx:
            classification = "skipped"
            skipped_optional_steps.append(s["operationCode"])
        else:
            classification = "remaining"
            if s["isRequired"]:
                remaining_required_steps.append(s["operationCode"])
            else:
                remaining_optional_steps.append(s["operationCode"])

        if s["isActive"]:
            if s["isRequired"]:
                primary_active_steps.append(s["operationCode"])
            else:
                optional_active_steps.append(s["operationCode"])

        s["classification"] = classification
        route_steps.append(s)

    open_defect_count = sum(1 for d in defects if not d["isRepaired"])
    repaired_defect_count = sum(1 for d in defects if d["isRepaired"])

    stop_prod = _is_truthy_flag(selected_po.get("STOP_PRODUCTION", "")) or bool(
        selected_po.get("STOP_PRODUCTION_OPCODE", "").strip()
    )
    stop_ship = _is_truthy_flag(selected_po.get("STOP_SHIP", ""))

    if sn_statuses:
        overall_status = "INACTIVE"
    elif stop_prod:
        overall_status = "PO_HOLD"
    elif (primary_active_steps or optional_active_steps) and failed_steps:
        overall_status = "ACTIVE_WITH_FAILURE"
    elif primary_active_steps or optional_active_steps:
        overall_status = "ACTIVE"
    elif not failed_steps and not remaining_required_steps and passed_steps:
        overall_status = "COMPLETE"
    else:
        overall_status = "BLOCKED"

    po_info_enriched = dict(selected_po)
    if selected_po_num:
        po_info_enriched["PRODUCTION_ORDER"] = selected_po_num
    po_info_enriched["stopProductionFlag"] = stop_prod
    po_info_enriched["stopShipFlag"] = stop_ship

    return {
        "ok": True,
        "found": True,
        "serialNumber": sn_clean,
        "resolvedSerialNumber": resolved_sn,
        "itemNumber": effective_item_number,
        "database": client.database,
        "host": client.host,
        "port": client.port,
        "selectedProductionOrder": selected_po_num,
        "productionOrders": production_orders_list,
        "poInfo": po_info_enriched,
        "overallStatus": overall_status,
        "summary": {
            "totalSteps": len(route_steps),
            "passedCount": len(passed_steps),
            "passedSteps": passed_steps,
            "failedCount": len(failed_steps),
            "failedSteps": failed_steps,
            "primaryActiveSteps": primary_active_steps,
            "optionalActiveSteps": optional_active_steps,
            "activeCount": len(primary_active_steps) + len(optional_active_steps),
            "remainingRequiredSteps": remaining_required_steps,
            "remainingOptionalSteps": remaining_optional_steps,
            "remainingRequiredCount": len(remaining_required_steps),
            "remainingOptionalCount": len(remaining_optional_steps),
            "remainingCount": len(remaining_required_steps) + len(remaining_optional_steps),
            "skippedOptionalCount": len(skipped_optional_steps),
            "skippedOptionalSteps": skipped_optional_steps,
            "openDefectCount": open_defect_count,
            "repairedDefectCount": repaired_defect_count,
            "totalDefectCount": len(defects),
        },
        "routeSteps": route_steps,
        "history": all_history,
        "offRouteHistory": off_route_history,
        "snStatuses": sn_statuses,
        "defects": defects,
        "warnings": warnings,
        "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "cacheBypassed": bool(force_fresh),
    }
