"""
Unit and integration tests for TestLink (PFS) client, route analyzer, and HTTP proxy endpoints.
Uses an ephemeral self-signed TLS 1.2 certificate generated via .NET + pure-Python DER/PEM
and a mock TLS 1.2 TestLink socket server.
"""
import base64
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import server
from backend.config import APP_VERSION
from backend.pfs_client import (
    PFS_SITES,
    PfsClient,
    PfsConnectionError,
    RETURN_DELIMITER,
    analyze_serial_number,
    verify_credentials,
)


def _der_len(n):
    if n < 0x80:
        return bytes([n])
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([0x80 | len(raw)]) + raw


def _der_int_bytes(raw_bytes):
    trimmed = raw_bytes.lstrip(b"\x00") or b"\x00"
    if trimmed[0] & 0x80:
        trimmed = b"\x00" + trimmed
    return b"\x02" + _der_len(len(trimmed)) + trimmed


def _to_pem(label, der_bytes):
    b64 = base64.encodebytes(der_bytes).decode("ascii")
    return f"-----BEGIN {label}-----\n{b64}-----END {label}-----\n"


def generate_ephemeral_tls_cert(temp_dir):
    """Generates a temporary self-signed cert.pem and key.pem for localhost TLS 1.2 testing."""
    ps_script = (
        "$rsa=[System.Security.Cryptography.RSA]::Create(2048); "
        "$req=[System.Security.Cryptography.X509Certificates.CertificateRequest]::new("
        "'CN=localhost',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,"
        "[System.Security.Cryptography.RSASignaturePadding]::Pkcs1); "
        "$cert=$req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1),[DateTimeOffset]::UtcNow.AddDays(1)); "
        "$p=$rsa.ExportParameters($true); "
        "$obj=@{"
        "cert=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert));"
        "n=[Convert]::ToBase64String($p.Modulus);"
        "e=[Convert]::ToBase64String($p.Exponent);"
        "d=[Convert]::ToBase64String($p.D);"
        "p=[Convert]::ToBase64String($p.P);"
        "q=[Convert]::ToBase64String($p.Q);"
        "dp=[Convert]::ToBase64String($p.DP);"
        "dq=[Convert]::ToBase64String($p.DQ);"
        "qinv=[Convert]::ToBase64String($p.InverseQ)"
        "}; "
        "$obj | ConvertTo-Json -Compress"
    )
    proc = subprocess.run(
        ["powershell", "-NoProfile", "-Command", ps_script],
        capture_output=True,
        text=True,
        check=True,
    )
    data = json.loads(proc.stdout.strip())
    cert_der = base64.b64decode(data["cert"])

    integers = b"".join([
        _der_int_bytes(b"\x00"),
        _der_int_bytes(base64.b64decode(data["n"])),
        _der_int_bytes(base64.b64decode(data["e"])),
        _der_int_bytes(base64.b64decode(data["d"])),
        _der_int_bytes(base64.b64decode(data["p"])),
        _der_int_bytes(base64.b64decode(data["q"])),
        _der_int_bytes(base64.b64decode(data["dp"])),
        _der_int_bytes(base64.b64decode(data["dq"])),
        _der_int_bytes(base64.b64decode(data["qinv"])),
    ])
    pkcs1_der = b"\x30" + _der_len(len(integers)) + integers

    cert_path = os.path.join(temp_dir, "cert.pem")
    key_path = os.path.join(temp_dir, "key.pem")
    with open(cert_path, "w", encoding="ascii") as f:
        f.write(_to_pem("CERTIFICATE", cert_der))
    with open(key_path, "w", encoding="ascii") as f:
        f.write(_to_pem("RSA PRIVATE KEY", pkcs1_der))
    return cert_path, key_path


class MockTestLinkServer:
    """Thread-safe mock TestLink server over TLS 1.2 on TCP 127.0.0.1."""

    def __init__(self, cert_path, key_path, handler):
        self.handler = handler
        self.recorded_requests = []
        self._lock = threading.Lock()
        self._stop_event = threading.Event()

        self.ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        self.ssl_ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        self.ssl_ctx.load_cert_chain(certfile=cert_path, keyfile=key_path)

        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.port = self.sock.getsockname()[1]
        self.sock.listen(32)
        self.sock.settimeout(0.25)

        self._thread = threading.Thread(target=self._serve_loop, daemon=True)
        self._thread.start()

    def _serve_loop(self):
        while not self._stop_event.is_set():
            try:
                client_sock, _ = self.sock.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            threading.Thread(target=self._handle_conn, args=(client_sock,), daemon=True).start()

    def _handle_conn(self, client_sock):
        tls_sock = None
        f = None
        try:
            tls_sock = self.ssl_ctx.wrap_socket(client_sock, server_side=True)
            tls_sock.settimeout(5.0)
            f = tls_sock.makefile("rb")
            req = {}
            while True:
                line_b = f.readline()
                if not line_b:
                    break
                line = line_b.decode("utf-8", errors="replace").rstrip("\r\n")
                if line == "":
                    break
                if "=" in line:
                    k, v = line.split("=", 1)
                    req[k] = v

            with self._lock:
                self.recorded_requests.append(req)

            if req.get("REQUEST_TYPE") == "PfsGetProductionOrderInfo":
                rv_fields, _ = _extract_fields_and_delim(req)
                if "PRODUCTION_ORDER" in rv_fields:
                    resp_text = (
                        "PfsGetProductionOrderInfo Error: Invalid request parameter value(s)\r\n"
                        "Unrecognized RETURN_VALUES value - PRODUCTION_ORDER\r\n\r\n"
                    )
                else:
                    resp_text = self.handler(req)
            else:
                resp_text = self.handler(req)
            if not resp_text.endswith("\r\n\r\n"):
                resp_text = resp_text.rstrip("\r\n") + "\r\n\r\n"
            tls_sock.sendall(resp_text.encode("utf-8"))
        except Exception:
            pass
        finally:
            if f is not None:
                try:
                    f.close()
                except Exception:
                    pass
            if tls_sock is not None:
                try:
                    tls_sock.close()
                except Exception:
                    pass
            else:
                try:
                    client_sock.close()
                except Exception:
                    pass

    def clear_requests(self):
        with self._lock:
            self.recorded_requests.clear()

    def get_requests(self):
        with self._lock:
            return list(self.recorded_requests)

    def close(self):
        self._stop_event.set()
        try:
            self.sock.close()
        except Exception:
            pass
        self._thread.join(timeout=2.0)


def _format_rows(rows, fields, delim=RETURN_DELIMITER):
    lines = ["OK"]
    for r in rows:
        vals = [r.get(f, "<blank>") for f in fields]
        lines.append(delim.join(vals))
    return "\r\n".join(lines) + "\r\n\r\n"


def _extract_fields_and_delim(req):
    rv = req.get("RETURN_VALUES", "")
    delim = ";"
    for ch in rv:
        if not (ch.isalnum() or ch in "_ []"):
            delim = ch
            break
    fields = [p for p in rv.split(delim) if p]
    return fields, delim


class TestPfsIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp(prefix="pfs_test_tls_")
        cls.cert_path, cls.key_path = generate_ephemeral_tls_cert(cls.temp_dir)
        cls.mock_handler = lambda req: "PfsError Error: No handler\r\n\r\n"
        cls.pfs_server = MockTestLinkServer(cls.cert_path, cls.key_path, lambda req: cls.mock_handler(req))

        cls.httpd = server.ThreadedTCPServer(("127.0.0.1", 0), server.LocalHostServerHandler)
        cls.http_port = cls.httpd.server_address[1]
        cls.http_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.http_thread.start()
        cls.http_base = f"http://127.0.0.1:{cls.http_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.pfs_server.close()
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def setUp(self):
        self.pfs_server.clear_requests()

    def test_verify_credentials_success_and_failure_and_redaction(self):
        def handler(req):
            if req.get("REQUEST_TYPE") == "PfsVerifyUserInput":
                if req.get("USER_ID") == "jdoe" and req.get("PASSWORD") == "TopSecret!99":
                    return "OK\r\n\r\n"
                return "PfsVerifyUserInput Failure: Login validation failed\r\nInvalid password for operator\r\n\r\n"
            return "Error: Unknown\r\n\r\n"

        self.__class__.mock_handler = handler

        ok_res = verify_credentials("127.0.0.1", "PFSHSP4", "jdoe", "TopSecret!99", port=self.pfs_server.port)
        self.assertTrue(ok_res["ok"])
        self.assertEqual(ok_res["status"], "OK")

        bad_res = verify_credentials("127.0.0.1", "PFSHSP4", "jdoe", "WrongPass", port=self.pfs_server.port)
        self.assertFalse(bad_res["ok"])
        self.assertEqual(bad_res["status"], "Failure")
        self.assertIn("Login validation failed", bad_res["message"])
        self.assertIn("Invalid password for operator", bad_res["message"])
        self.assertNotIn("WrongPass", json.dumps(bad_res))

        client = PfsClient("127.0.0.1", "PFSHSP4", "jdoe", "TopSecret!99", port=self.pfs_server.port)
        self.assertNotIn("TopSecret!99", repr(client))

    def test_analyze_sn_passed_prior_fail_active_remaining_and_skipped_optional(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)

            if rt == "PfsGetProductionOrderInfo":
                return _format_rows([{
                    "PRODUCTION_ORDER": "PO-1001",
                    "COMP_ITEM_NUMBER": "SFN214-010190-004",
                    "CUST_ITEM_REV": "C",
                    "QUANTITY": "100",
                    "CREATE_DATE": "2026-10-01",
                    "RELEASE_DATE": "2026-10-02",
                    "COMPLETION_DATE": "<not found>",
                    "WORK_ORDER": "WO-900",
                    "STOP_PRODUCTION": "N",
                    "STOP_PRODUCTION_COMMENT": "<blank>",
                    "STOP_PRODUCTION_OPCODE": "<blank>",
                    "STOP_PRODUCTION_OPCODE_COMMENT": "<blank>",
                    "STOP_SHIP": "N",
                    "STOP_SHIP_COMMENT": "<blank>",
                }], fields, delim)

            if rt == "PfsGetOperationCodes":
                route = [
                    {"OPERATION_CODE": "PACK_SHIP", "OPERATION_DESC": "Pack & Ship", "OPERATION_TYPE": "PACK", "STATION_TYPE": "Signoff", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "60", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "SMT_AOI", "OPERATION_DESC": "SMT Optical Inspection", "OPERATION_TYPE": "INSPECT", "STATION_TYPE": "Inspection", "STEP_TYPE": "MUST_VISIT_ONCE", "STEP_ORDER": "10", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "QC  AUDIT", "OPERATION_DESC": "QC Audit", "OPERATION_TYPE": "INSPECT", "STATION_TYPE": "Inspection", "STEP_TYPE": "MUST_PASS_ONCE", "STEP_ORDER": "15", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "OPT_XRAY", "OPERATION_DESC": "Optional X-Ray", "OPERATION_TYPE": "INSPECT", "STATION_TYPE": "Inspection", "STEP_TYPE": "MAY_VISIT_ONCE", "STEP_ORDER": "20", "ROUTE_VERIFICATION": "N"},
                    {"OPERATION_CODE": "ICT_TEST", "OPERATION_DESC": "In-Circuit Test", "OPERATION_TYPE": "TEST", "STATION_TYPE": "Test", "STEP_TYPE": "MUST_PASS_ONCE", "STEP_ORDER": "30", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "FCT_TEST", "OPERATION_DESC": "Functional Test", "OPERATION_TYPE": "TEST", "STATION_TYPE": "Test", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "40", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "OPT_BURN", "OPERATION_DESC": "Optional Burn-In", "OPERATION_TYPE": "TEST", "STATION_TYPE": "Test", "STEP_TYPE": "MAY_VISIT", "STEP_ORDER": "50", "ROUTE_VERIFICATION": "N"},
                ]
                return _format_rows(route, fields, delim)

            if rt == "PfsGetSnHistory":
                hist = [
                    {"CREATE_DATE": "2026-11-19 10:15:00", "SRC_PRODUCTION_ORDER": "PO-1001", "SRC_OPERATION_CODE": "ICT_TEST", "PASS_FAIL": "P", "WORK_CENTER": "WC-ICT2", "OPERATOR_ID": "tech2", "HIST_ITEM_NUMBER": "SFN214-010190-004", "HISTORY_COMMENT": "Retest passed; checked U14; verified&nl;Line2<blank line>"},
                    {"CREATE_DATE": "2026-11-19 08:30:00", "SRC_PRODUCTION_ORDER": "PO-1001", "SRC_OPERATION_CODE": "ICT_TEST", "PASS_FAIL": "F", "WORK_CENTER": "WC-ICT1", "OPERATOR_ID": "tech1", "HIST_ITEM_NUMBER": "SFN214-010190-004", "HISTORY_COMMENT": "Pin 3 open; sent to debug"},
                    {"CREATE_DATE": "2026-11-18 16:00:00", "SRC_PRODUCTION_ORDER": "PO-1001", "SRC_OPERATION_CODE": "QC AUDIT", "PASS_FAIL": "P", "WORK_CENTER": "WC-QC1", "OPERATOR_ID": "qc1", "HIST_ITEM_NUMBER": "SFN214-010190-004", "HISTORY_COMMENT": "<blank>"},
                    {"CREATE_DATE": "2026-11-18 14:00:00", "SRC_PRODUCTION_ORDER": "PO-1001", "SRC_OPERATION_CODE": "SMT_AOI", "PASS_FAIL": "P", "WORK_CENTER": "WC-AOI1", "OPERATOR_ID": "aoi", "HIST_ITEM_NUMBER": "SFN214-010190-004", "HISTORY_COMMENT": "<blank>"},
                ]
                return _format_rows(hist, fields, delim)

            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: No status assigned to serial number\r\n\r\n"

            if rt == "PfsGetSnDefects":
                defs = [
                    {"SRC_OPERATION_CODE": "ICT_TEST", "SRC_PRODUCTION_ORDER": "PO-1001", "FAILURE_CODE": "OPEN", "FAILURE_ORIGIN": "SMT_PLACE", "REF_DES": "U14", "COMP_ITEM_NUMBER": "COMP-1", "DEFECT_CODE": "SOL01", "DEFECT_QUANTITY": "1", "IS_REPAIRED": "Y", "REPAIR_CODE": "RESOLDER", "DEBUG_TECH": "dbg1", "REPAIR_TECH": "rep1", "FAILURE_COMMENT": "Open pin 3", "DEBUG_COMMENT": "Confirmed cold joint", "REPAIR_COMMENT": "Reflowed U14"},
                    {"SRC_OPERATION_CODE": "FCT_TEST", "SRC_PRODUCTION_ORDER": "PO-1001", "FAILURE_CODE": "BOOT", "FAILURE_ORIGIN": "FCT_TEST", "REF_DES": "J2", "COMP_ITEM_NUMBER": "COMP-2", "DEFECT_CODE": "CON02", "DEFECT_QUANTITY": "1", "IS_REPAIRED": "N", "REPAIR_CODE": "<blank>", "DEBUG_TECH": "dbg2", "REPAIR_TECH": "<blank>", "FAILURE_COMMENT": "No link", "DEBUG_COMMENT": "Inspecting connector", "REPAIR_COMMENT": "<blank>"},
                ]
                return _format_rows(defs, fields, delim)

            if rt == "PfsQuery":
                op = req.get("OPERATION_CODE")
                if op in ("FCT_TEST", "OPT_BURN"):
                    return "OK\r\n\r\n"
                return f"PfsQuery Failure: Unit must complete FCT_TEST before {op}\r\n\r\n"

            return "Error: Unexpected request\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number(
            host="127.0.0.1",
            port=self.pfs_server.port,
            database="PFSHSP4",
            user_id="jdoe",
            password="pw",
            serial_number="PB296423",
            item_number="SFN214-010190-004",
        )

        self.assertTrue(res["ok"])
        self.assertTrue(res["found"])
        self.assertEqual(res["overallStatus"], "ACTIVE")

        summary = res["summary"]
        self.assertEqual(summary["passedSteps"], ["SMT_AOI", "QC  AUDIT", "ICT_TEST"])
        self.assertEqual(summary["failedSteps"], [])
        self.assertEqual(summary["primaryActiveSteps"], ["FCT_TEST"])
        self.assertEqual(summary["optionalActiveSteps"], ["OPT_BURN"])
        self.assertEqual(summary["remainingRequiredSteps"], ["PACK_SHIP"])
        self.assertEqual(summary["remainingOptionalSteps"], [])
        self.assertEqual(summary["skippedOptionalSteps"], ["OPT_XRAY"])
        self.assertEqual(summary["openDefectCount"], 1)
        self.assertEqual(summary["repairedDefectCount"], 1)

        by_op = {s["operationCode"]: s for s in res["routeSteps"]}
        self.assertEqual(by_op["SMT_AOI"]["classification"], "passed")
        self.assertEqual(by_op["QC  AUDIT"]["classification"], "passed")
        self.assertEqual(by_op["OPT_XRAY"]["classification"], "skipped")
        self.assertEqual(by_op["ICT_TEST"]["classification"], "passed")
        self.assertEqual(by_op["ICT_TEST"]["priorFailCount"], 1)
        self.assertEqual(len(by_op["ICT_TEST"]["visits"]), 2)
        self.assertEqual(by_op["ICT_TEST"]["visits"][0]["historyComment"], "Retest passed; checked U14; verified\nLine2")
        self.assertEqual(by_op["FCT_TEST"]["classification"], "active")
        self.assertEqual(by_op["OPT_BURN"]["classification"], "active")
        self.assertEqual(by_op["PACK_SHIP"]["classification"], "remaining")

        # Verify protocol flags sent
        reqs = self.pfs_server.get_requests()
        pfs_queries = [r for r in reqs if r.get("REQUEST_TYPE") == "PfsQuery"]
        self.assertEqual(len(pfs_queries), 7)
        self.assertTrue(all(r.get("OVERRIDE_OK") == "FALSE" for r in pfs_queries))

        for rt_fresh in ("PfsGetSnHistory", "PfsGetSnStatus", "PfsGetSnDefects"):
            matching = [r for r in reqs if r.get("REQUEST_TYPE") == rt_fresh]
            self.assertEqual(len(matching), 1)
            self.assertEqual(matching[0].get("USE_CACHED_INFO"), "FALSE")

    def test_analyze_sn_multi_po_selection_and_switching(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsGetProductionOrderInfo":
                po = req.get("PRODUCTION_ORDER")
                if po == "PO-OLD":
                    return _format_rows([{"COMP_ITEM_NUMBER": "ITEM-1", "RELEASE_DATE": "2026-09-01", "WORK_ORDER": "WO-OLD"}], fields, delim)
                return _format_rows([
                    {"COMP_ITEM_NUMBER": "ITEM-1", "RELEASE_DATE": "2026-11-01", "WORK_ORDER": "WO-NEW"},
                    {"COMP_ITEM_NUMBER": "ITEM-1", "RELEASE_DATE": "2026-09-01", "WORK_ORDER": "WO-OLD"},
                ], fields, delim)
            if rt == "PfsGetOperationCodes":
                po = req.get("PRODUCTION_ORDER")
                op = "NEW_FINAL" if po == "PO-NEW" else "OLD_LEGACY"
                return _format_rows([{"OPERATION_CODE": op, "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "10"}], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt == "PfsGetSnHistory":
                po = req.get("PRODUCTION_ORDER")
                rows = [
                    {"CREATE_DATE": "2026-11-10", "SRC_PRODUCTION_ORDER": "PO-NEW", "SRC_OPERATION_CODE": "NEW_INIT", "PASS_FAIL": "P", "HIST_ITEM_NUMBER": "ITEM-1"},
                    {"CREATE_DATE": "2026-09-10", "SRC_PRODUCTION_ORDER": "PO-OLD", "SRC_OPERATION_CODE": "OLD_INIT", "PASS_FAIL": "P", "HIST_ITEM_NUMBER": "ITEM-1"},
                ]
                if po:
                    rows = [r for r in rows if r["SRC_PRODUCTION_ORDER"] == po]
                return _format_rows(rows, fields, delim)
            if rt == "PfsGetSnDefects":
                return "PfsGetSnDefects Failure: No records\r\n\r\n"
            if rt == "PfsQuery":
                return "OK\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res1 = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "SN123", port=self.pfs_server.port)
        self.assertEqual(res1["selectedProductionOrder"], "PO-NEW")
        self.assertEqual(len(res1["productionOrders"]), 2)
        self.assertEqual(res1["summary"]["primaryActiveSteps"], ["NEW_FINAL"])

        res2 = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "SN123", production_order="PO-OLD", port=self.pfs_server.port)
        self.assertEqual(res2["selectedProductionOrder"], "PO-OLD")
        self.assertEqual(res2["poInfo"]["WORK_ORDER"], "WO-OLD")
        self.assertEqual(res2["summary"]["primaryActiveSteps"], ["OLD_LEGACY"])

    def test_analyze_sn_inactive_status_and_po_hold(self):
        status_mode = {"inactive": True}

        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsGetProductionOrderInfo":
                stop_flag = "N" if status_mode["inactive"] else "Y"
                return _format_rows([{
                    "PRODUCTION_ORDER": "PO-HOLD-1",
                    "COMP_ITEM_NUMBER": "ITEM-H",
                    "STOP_PRODUCTION": stop_flag,
                    "STOP_PRODUCTION_COMMENT": "ECO hold active",
                }], fields, delim)
            if rt == "PfsGetOperationCodes":
                return _format_rows([{"OPERATION_CODE": "ICT", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "10"}], fields, delim)
            if rt == "PfsGetSnStatus":
                if status_mode["inactive"]:
                    return _format_rows([{"STATUS": "SCRAPPED", "OPERATION_CODE": "ICT", "DATE": "2026-11-10", "USER": "qa", "COMMENTS": "Damaged PCB"}], fields, delim)
                return "PfsGetSnStatus Warning: No status\r\n\r\n"
            if rt in ("PfsGetSnHistory", "PfsGetSnDefects"):
                return f"{rt} Failure: No records\r\n\r\n"
            if rt == "PfsQuery":
                return "PfsQuery Failure: On hold\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res_inactive = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "SN-SCRAP", port=self.pfs_server.port)
        self.assertEqual(res_inactive["overallStatus"], "INACTIVE")
        self.assertEqual(len(res_inactive["snStatuses"]), 1)
        self.assertEqual(res_inactive["snStatuses"][0]["status"], "SCRAPPED")

        status_mode["inactive"] = False
        res_hold = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "SN-HOLD", port=self.pfs_server.port)
        self.assertEqual(res_hold["overallStatus"], "PO_HOLD")
        self.assertTrue(res_hold["poInfo"]["stopProductionFlag"])

    def test_analyze_sn_route_complete(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsGetProductionOrderInfo":
                return _format_rows([{"PRODUCTION_ORDER": "PO-DONE", "COMP_ITEM_NUMBER": "ITEM-D"}], fields, delim)
            if rt == "PfsGetOperationCodes":
                return _format_rows([
                    {"OPERATION_CODE": "AOI", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "10"},
                    {"OPERATION_CODE": "PACK", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "20"},
                ], fields, delim)
            if rt == "PfsGetSnHistory":
                return _format_rows([
                    {"CREATE_DATE": "2026-11-20 11:00:00", "SRC_PRODUCTION_ORDER": "PO-DONE", "SRC_OPERATION_CODE": "PACK", "PASS_FAIL": "P"},
                    {"CREATE_DATE": "2026-11-20 10:00:00", "SRC_PRODUCTION_ORDER": "PO-DONE", "SRC_OPERATION_CODE": "AOI", "PASS_FAIL": "P"},
                ], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt == "PfsGetSnDefects":
                return "PfsGetSnDefects Failure: None\r\n\r\n"
            if rt == "PfsQuery":
                return "PfsQuery Failure: Route complete\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "SN-DONE", port=self.pfs_server.port)
        self.assertEqual(res["overallStatus"], "COMPLETE")
        self.assertEqual(res["summary"]["passedSteps"], ["AOI", "PACK"])
        self.assertEqual(res["summary"]["remainingRequiredSteps"], [])

    def test_analyze_sn_find_serial_number_fallback(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            sn = req.get("SERIAL_NUMBER")
            if rt == "PfsGetProductionOrderInfo":
                if sn == "RAW-SCAN-001":
                    return "PfsGetProductionOrderInfo Failure: SN not found\r\n\r\n"
                if sn == "CANON-001":
                    return _format_rows([{"COMP_ITEM_NUMBER": "ITEM-F", "WORK_ORDER": "WO-FIND"}], fields, delim)
            if rt == "PfsFindSerialNumber":
                return "OK\r\nCANON-001\r\n\r\n"
            if rt == "PfsGetOperationCodes":
                self.assertEqual(req.get("ITEM_NUMBER"), "ITEM-F")
                self.assertEqual(req.get("SERIAL_NUMBER"), "CANON-001")
                return _format_rows([{"OPERATION_CODE": "OP1", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "10"}], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt in ("PfsGetSnHistory", "PfsGetSnDefects"):
                return f"{rt} Failure: None\r\n\r\n"
            if rt == "PfsQuery":
                return "OK\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "RAW-SCAN-001", port=self.pfs_server.port)
        self.assertTrue(res["ok"])
        self.assertTrue(res["found"])
        self.assertEqual(res["serialNumber"], "RAW-SCAN-001")
        self.assertEqual(res["resolvedSerialNumber"], "CANON-001")
        self.assertEqual(res["itemNumber"], "ITEM-F")
        self.assertEqual(res["selectedProductionOrder"], "WO-FIND")
        self.assertEqual(res["summary"]["primaryActiveSteps"], ["OP1"])

    def test_analyze_sn_not_found_and_connection_error(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            return f"{rt} Failure: Serial number does not exist\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "MISSING-99", port=self.pfs_server.port)
        self.assertTrue(res["ok"])
        self.assertFalse(res["found"])

        # Bind & close an ephemeral port so connection is guaranteed refused
        tmp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tmp_sock.bind(("127.0.0.1", 0))
        closed_port = tmp_sock.getsockname()[1]
        tmp_sock.close()

        with self.assertRaises(PfsConnectionError) as ctx:
            analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "SecretPw123!", "SN1", port=closed_port, timeout=1)
        self.assertNotIn("SecretPw123!", str(ctx.exception))

    def test_http_endpoints_sites_verify_and_sn_route(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsVerifyUserInput":
                return "OK\r\n\r\n"
            if rt == "PfsGetProductionOrderInfo":
                return _format_rows([{"COMP_ITEM_NUMBER": "ITEM-HTTP", "WORK_ORDER": "WO-HTTP"}], fields, delim)
            if rt == "PfsGetOperationCodes":
                return _format_rows([{"OPERATION_CODE": "FCT", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "10"}], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt in ("PfsGetSnHistory", "PfsGetSnDefects"):
                return f"{rt} Failure: None\r\n\r\n"
            if rt == "PfsQuery":
                return "OK\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        # 1. GET /api/status and GET /api/pfs/sites
        with urllib.request.urlopen(f"{self.http_base}/api/status", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            status_payload = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(status_payload.get("pfs_enabled"))
            self.assertEqual(status_payload.get("app_version"), APP_VERSION)

        with urllib.request.urlopen(f"{self.http_base}/api/pfs/sites", timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            sites_payload = json.loads(resp.read().decode("utf-8"))
            self.assertEqual(sites_payload["defaultSiteKey"], "huntsville")
            self.assertEqual(len(sites_payload["sites"]), len(PFS_SITES))
            self.assertEqual(sites_payload["sites"][0]["database"], "PFSHSP4")

        # 2. POST /api/pfs/verify
        verify_req = urllib.request.Request(
            f"{self.http_base}/api/pfs/verify",
            data=json.dumps({
                "host": "127.0.0.1",
                "port": self.pfs_server.port,
                "database": "PFSHSP4",
                "userId": "jdoe",
                "password": "pw",
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(verify_req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            v_data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(v_data["ok"])

        # 3. POST /api/pfs/sn-route (brand-new unvisited unit via ITEM_NUMBER + SERIAL_NUMBER)
        route_req = urllib.request.Request(
            f"{self.http_base}/api/pfs/sn-route",
            data=json.dumps({
                "host": "127.0.0.1",
                "port": self.pfs_server.port,
                "database": "PFSHSP4",
                "userId": "jdoe",
                "password": "pw",
                "serialNumber": "SN-HTTP-1",
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(route_req, timeout=5) as resp:
            self.assertEqual(resp.status, 200)
            r_data = json.loads(resp.read().decode("utf-8"))
            self.assertTrue(r_data["ok"])
            self.assertEqual(r_data["itemNumber"], "ITEM-HTTP")
            self.assertEqual(r_data["selectedProductionOrder"], "WO-HTTP")
            self.assertEqual(r_data["summary"]["primaryActiveSteps"], ["FCT"])

        # 4. 400 validation error
        bad_req = urllib.request.Request(
            f"{self.http_base}/api/pfs/sn-route",
            data=json.dumps({"host": "127.0.0.1", "port": 99999, "database": "PFSHSP4", "userId": "jdoe", "password": "pw", "serialNumber": "SN1"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as http_err:
            urllib.request.urlopen(bad_req, timeout=5)
        self.assertEqual(http_err.exception.code, 400)

        # 5. 502 connection error on unreachable port
        tmp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        tmp_sock.bind(("127.0.0.1", 0))
        dead_port = tmp_sock.getsockname()[1]
        tmp_sock.close()
        dead_req = urllib.request.Request(
            f"{self.http_base}/api/pfs/verify",
            data=json.dumps({"host": "127.0.0.1", "port": dead_port, "database": "PFSHSP4", "userId": "jdoe", "password": "pw"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as http_err2:
            urllib.request.urlopen(dead_req, timeout=10)
        self.assertEqual(http_err2.exception.code, 502)

        # 6. Unknown POST endpoint returns JSON 404 instead of dropping connection
        unknown_req = urllib.request.Request(
            f"{self.http_base}/api/nonexistent",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as http_err3:
            urllib.request.urlopen(unknown_req, timeout=5)
        self.assertEqual(http_err3.exception.code, 404)
        err_body = json.loads(http_err3.exception.read().decode("utf-8"))
        self.assertFalse(err_body.get("ok"))

    def test_analyze_sn_skips_pfs_query_on_serialization_station(self):
        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsGetProductionOrderInfo":
                return _format_rows([{"COMP_ITEM_NUMBER": "BAE12276880", "WORK_ORDER": "MP0044414"}], fields, delim)
            if rt == "PfsGetOperationCodes":
                return _format_rows([
                    {"OPERATION_CODE": "SER", "OPERATION_DESC": "SERIALIZATION", "OPERATION_TYPE": "SERIALIZE", "STATION_TYPE": "SER", "STEP_TYPE": "MUST_VISIT", "STEP_ORDER": "10", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "SER_ALT", "OPERATION_DESC": "ALT SER", "OPERATION_TYPE": "SERIALIZE", "STATION_TYPE": "OTHER", "STEP_TYPE": "MUST_VISIT", "STEP_ORDER": "15", "ROUTE_VERIFICATION": "Y"},
                    {"OPERATION_CODE": "FVT_1", "OPERATION_DESC": "FUNCTIONAL TEST #1", "OPERATION_TYPE": "TEST", "STATION_TYPE": "Test", "STEP_TYPE": "MUST_PASS", "STEP_ORDER": "30", "ROUTE_VERIFICATION": "Y"},
                ], fields, delim)
            if rt == "PfsGetSnHistory":
                return _format_rows([
                    {"CREATE_DATE": "2025-11-06T13:13:37", "SRC_PRODUCTION_ORDER": "MP0044414", "SRC_OPERATION_CODE": "SER", "PASS_FAIL": "P", "WORK_CENTER": "HJA100", "OPERATOR_ID": "BEI\\shawst", "HIST_ITEM_NUMBER": "BAE12276880", "HISTORY_COMMENT": "<blank>"},
                ], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt == "PfsGetSnDefects":
                return "PfsGetSnDefects Failure: None\r\n\r\n"
            if rt == "PfsQuery":
                if req.get("OPERATION_CODE") in ("SER", "SER_ALT"):
                    return "PfsQuery Failure: Should not probe SER station!\r\n\r\n"
                return "OK\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "BH4325BAE0027", port=self.pfs_server.port)
        self.assertTrue(res["ok"])
        self.assertTrue(res["found"])
        by_op = {s["operationCode"]: s for s in res["routeSteps"]}
        self.assertEqual(by_op["SER"]["classification"], "passed")
        self.assertEqual(by_op["SER"]["queryStatus"], "Skipped")
        self.assertEqual(by_op["SER"]["queryMessage"], "Not applicable for Serialization (SER) station.")
        self.assertFalse(by_op["SER"]["isActive"])
        self.assertEqual(by_op["SER_ALT"]["queryStatus"], "Skipped")
        self.assertFalse(by_op["SER_ALT"]["isActive"])
        self.assertEqual(by_op["FVT_1"]["classification"], "active")
        self.assertEqual(by_op["FVT_1"]["queryStatus"], "OK")

        queried_ops = [r.get("OPERATION_CODE") for r in self.pfs_server.get_requests() if r.get("REQUEST_TYPE") == "PfsQuery"]
        self.assertEqual(queried_ops, ["FVT_1"])

    def test_multiline_defect_comments_and_repaired_status(self):
        u49_debug = (
            "FAILURE MODE CHANGE: Y\r\n"
            "FAILURE DESCRIPTION: 28V/0 In All High Mode,\r\n"
            "(28V_DISC_IN_2, 5, 25 and 42\r\n"
            "FA:\r\n"
            "<blank line>\r\n"
            "ROOT CAUSE: Suspect U49, U51, U74 and U106 are defective.\r\n"
            "R207 reads open\r\n"
            "NOTE:\r\n"
            "REWORK INSTRUCTION: Replace U49, U51, U74, U106 and R207"
        )
        multiline_failure = "Channel A timeout\r\nNo 28V rail detected"
        multiline_repair = "Replaced R480 and reflowed pins\r\nVerified under microscope"
        multiline_hist = "Unit failed functional step 3\r\nSent to debug bench"

        def handler(req):
            rt = req.get("REQUEST_TYPE")
            fields, delim = _extract_fields_and_delim(req)
            if rt == "PfsGetProductionOrderInfo":
                return _format_rows([{"COMP_ITEM_NUMBER": "BAE12276880", "WORK_ORDER": "MP0049999"}], fields, delim)
            if rt == "PfsGetOperationCodes":
                return _format_rows([
                    {"OPERATION_CODE": "BASY_TEST_DBG", "OPERATION_DESC": "Debug", "OPERATION_TYPE": "DEBUG", "STATION_TYPE": "Debug", "STEP_TYPE": "MUST_VISIT", "STEP_ORDER": "10"},
                ], fields, delim)
            if rt == "PfsGetSnHistory":
                return _format_rows([
                    {
                        "CREATE_DATE": "2026-11-20T10:00:00",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "PASS_FAIL": "F",
                        "WORK_CENTER": "HJA10",
                        "OPERATOR_ID": "tech1",
                        "HIST_ITEM_NUMBER": "BAE12276880",
                        "HISTORY_COMMENT": multiline_hist,
                    },
                ], fields, delim)
            if rt == "PfsGetSnStatus":
                return "PfsGetSnStatus Warning: None\r\n\r\n"
            if rt == "PfsGetSnDefects":
                defs = [
                    {
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "FAILURE_CODE": "FAIL28V",
                        "FAILURE_ORIGIN": "SMT",
                        "REF_DES": "U49",
                        "COMP_ITEM_NUMBER": "CMP-U49",
                        "DEFECT_CODE": "EET001",
                        "DEFECT_QUANTITY": "1",
                        "IS_REPAIRED": "True",
                        "REPAIR_CODE": "REPAIRED",
                        "DEBUG_TECH": "meherd",
                        "REPAIR_TECH": "rtech1",
                        "FAILURE_COMMENT": "<blank>",
                        "DEBUG_COMMENT": u49_debug,
                        "REPAIR_COMMENT": "<blank>",
                    },
                    {
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "FAILURE_CODE": "COAT",
                        "FAILURE_ORIGIN": "COAT",
                        "REF_DES": "Q52",
                        "COMP_ITEM_NUMBER": "CMP-Q52",
                        "DEFECT_CODE": "EET001",
                        "DEFECT_QUANTITY": "1",
                        "IS_REPAIRED": "1",
                        "REPAIR_CODE": "REPAIRED",
                        "DEBUG_TECH": "meherd",
                        "REPAIR_TECH": "rtech2",
                        "FAILURE_COMMENT": "<blank>",
                        "DEBUG_COMMENT": "Reapply coating to Q52 area and to R480",
                        "REPAIR_COMMENT": "<blank>",
                    },
                    {
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "FAILURE_CODE": "OPEN_R",
                        "FAILURE_ORIGIN": "SMT",
                        "REF_DES": "R480",
                        "COMP_ITEM_NUMBER": "CMP-R480",
                        "DEFECT_CODE": "PCAC10",
                        "DEFECT_QUANTITY": "1",
                        "IS_REPAIRED": "<blank>",
                        "REPAIR_CODE": "REPAIRED",
                        "DEBUG_TECH": "meherd",
                        "REPAIR_TECH": "rtech3",
                        "FAILURE_COMMENT": multiline_failure,
                        "DEBUG_COMMENT": "FAILURE MODE CHANGE: Y",
                        "REPAIR_COMMENT": multiline_repair,
                    },
                    {
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "FAILURE_CODE": "OPEN_C1",
                        "FAILURE_ORIGIN": "SMT",
                        "REF_DES": "C10",
                        "COMP_ITEM_NUMBER": "CMP-C10",
                        "DEFECT_CODE": "EET002",
                        "DEFECT_QUANTITY": "1",
                        "IS_REPAIRED": "False",
                        "REPAIR_CODE": "<blank>",
                        "DEBUG_TECH": "meherd",
                        "REPAIR_TECH": "<blank>",
                        "FAILURE_COMMENT": "Shorted cap",
                        "DEBUG_COMMENT": "Replace C10",
                        "REPAIR_COMMENT": "<blank>",
                    },
                    {
                        "SRC_OPERATION_CODE": "BASY_TEST_DBG",
                        "SRC_PRODUCTION_ORDER": "MP0049999",
                        "FAILURE_CODE": "OPEN_R2",
                        "FAILURE_ORIGIN": "SMT",
                        "REF_DES": "R203",
                        "COMP_ITEM_NUMBER": "CMP-R203",
                        "DEFECT_CODE": "EET003",
                        "DEFECT_QUANTITY": "1",
                        "IS_REPAIRED": "N",
                        "REPAIR_CODE": "NONE",
                        "DEBUG_TECH": "meherd",
                        "REPAIR_TECH": "<blank>",
                        "FAILURE_COMMENT": "Open resistor",
                        "DEBUG_COMMENT": "Replace R203 and R208",
                        "REPAIR_COMMENT": "<blank>",
                    },
                ]
                return _format_rows(defs, fields, delim)
            if rt == "PfsQuery":
                return "PfsQuery Failure: Open defect\r\n\r\n"
            return "Error: Unexpected\r\n\r\n"

        self.__class__.mock_handler = handler

        res = analyze_serial_number("127.0.0.1", "PFSHSP4", "u", "p", "BH3925BAE0590", port=self.pfs_server.port)
        self.assertTrue(res["ok"])
        self.assertTrue(res["found"])
        self.assertEqual(res["summary"]["totalDefectCount"], 5)
        self.assertEqual(res["summary"]["repairedDefectCount"], 3)
        self.assertEqual(res["summary"]["openDefectCount"], 2)

        defects = res["defects"]
        self.assertEqual(len(defects), 5)

        u49 = defects[0]
        self.assertEqual(u49["refDes"], "U49")
        self.assertTrue(u49["isRepaired"])
        self.assertEqual(
            u49["debugComment"],
            "FAILURE MODE CHANGE: Y\n"
            "FAILURE DESCRIPTION: 28V/0 In All High Mode,\n"
            "(28V_DISC_IN_2, 5, 25 and 42\n"
            "FA:\n\n"
            "ROOT CAUSE: Suspect U49, U51, U74 and U106 are defective.\n"
            "R207 reads open\n"
            "NOTE:\n"
            "REWORK INSTRUCTION: Replace U49, U51, U74, U106 and R207",
        )

        q52 = defects[1]
        self.assertEqual(q52["refDes"], "Q52")
        self.assertTrue(q52["isRepaired"])

        r480 = defects[2]
        self.assertEqual(r480["refDes"], "R480")
        self.assertTrue(r480["isRepaired"])
        self.assertEqual(r480["failureComment"], "Channel A timeout\nNo 28V rail detected")
        self.assertEqual(r480["repairComment"], "Replaced R480 and reflowed pins\nVerified under microscope")

        self.assertFalse(defects[3]["isRepaired"])
        self.assertFalse(defects[4]["isRepaired"])

        self.assertEqual(len(res["history"]), 1)
        self.assertEqual(res["history"][0]["historyComment"], "Unit failed functional step 3\nSent to debug bench")


if __name__ == "__main__":
    unittest.main()
