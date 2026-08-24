import http.server
import socketserver
import json
import os
import sys
import threading
import gzip

class NullWriter:
    def write(self, s): pass
    def flush(self): pass

if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()

dataset_lock = threading.Lock()
annotations_lock = threading.Lock()

if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))

os.chdir(APP_DIR)

DEFAULT_PORT = 8080
CONFIG_FILE = os.path.join(APP_DIR, 'data', 'shared_config.json')

def get_config():
    cfg = {'shared_data_dir': '', 'port': DEFAULT_PORT}
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r', encoding='utf-8-sig') as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    cfg.update(loaded)
        except Exception as e:
            print(f"[CONFIG WARNING] Could not parse shared_config.json: {e}")
    return cfg

_cached_network_share_dir = None
_last_network_check_time = 0
_network_share_lock = threading.Lock()

def check_path_fast(path, timeout=1.5):
    """Fast check for path accessibility with timeout to prevent blocking on dead UNC shares."""
    if not path:
        return False
    if not path.startswith(r"\\"):
        return os.path.exists(path)
    
    result = [False]
    def _worker():
        try:
            if os.path.exists(path):
                result[0] = True
        except Exception:
            pass
    
    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout)
    return result[0]

def find_network_share_data_dir():
    global _cached_network_share_dir, _last_network_check_time
    now = time.time()
    
    # If cached and checked within last 30s, return cached path
    with _network_share_lock:
        if _cached_network_share_dir and (now - _last_network_check_time < 30):
            return _cached_network_share_dir
        
        # Don't hammer failing network share more than once every 5 seconds
        if not _cached_network_share_dir and (now - _last_network_check_time < 5):
            return None

        _last_network_check_time = now
        
        cfg = get_config()
        target_dir = cfg.get('shared_data_dir', '').strip()
        if target_dir:
            exp = os.path.expandvars(target_dir)
            if exp and check_path_fast(exp, timeout=1.5):
                _cached_network_share_dir = exp
                return exp

        net_share = cfg.get('network_share_dir', '').strip()
        if net_share:
            net_data = os.path.join(net_share, 'data')
            if check_path_fast(net_data, timeout=1.5):
                _cached_network_share_dir = net_data
                return net_data

        prod_share = r"\\bench.com\cuidata\HSV\TestENG\CUSTOMER_FVT\DefectAnalysis\data"
        if check_path_fast(prod_share, timeout=1.5):
            _cached_network_share_dir = prod_share
            return prod_share

        _cached_network_share_dir = None
        return None

def get_all_candidate_data_dirs():
    dirs = []
    # 1. In-Place APP_DIR data directory (Always primary wherever the folder is located or moved)
    in_place_data = os.path.join(APP_DIR, 'data')
    if os.path.exists(in_place_data):
        dirs.append(in_place_data)

    # 2. Configured Shared Network Drive (If explicitly configured in shared_config.json)
    net_data = find_network_share_data_dir()
    if net_data and net_data not in dirs:
        dirs.append(net_data)

    return dirs if dirs else [os.path.join(APP_DIR, 'data')]

def get_data_dir():
    dirs = get_all_candidate_data_dirs()
    return dirs[0] if dirs else os.path.join(APP_DIR, 'data')

dataset_cache_records = None
dataset_cache_mtime = 0
dataset_cache_json_bytes = None
dataset_cache_gzip_bytes = None
dataset_cache_lock = threading.Lock()

def find_best_dataset_file():
    local_path = os.path.join(APP_DIR, 'data', 'defect_details.json')
    local_exists = os.path.exists(local_path)
    local_size = os.path.getsize(local_path) if local_exists else -1
    local_mtime = int(os.path.getmtime(local_path)) if local_exists else -1

    # Check network share if distinct from local
    net_data = find_network_share_data_dir()
    if net_data and os.path.abspath(net_data) != os.path.abspath(os.path.join(APP_DIR, 'data')):
        net_path = os.path.join(net_data, 'defect_details.json')
        if check_path_fast(net_path, timeout=0.3):
            try:
                net_size = os.path.getsize(net_path)
                net_mtime = int(os.path.getmtime(net_path))
                # If network file is newer or larger than local, prioritize central network file
                if net_size > local_size or (net_size == local_size and net_mtime > local_mtime + 5):
                    return net_path, net_size, net_mtime
            except Exception:
                pass

    if local_exists and local_size > 0:
        return local_path, local_size, local_mtime

    return local_path, local_size, local_mtime

def get_cached_dataset_body(accept_gzip=False):
    global dataset_cache_records, dataset_cache_mtime, dataset_cache_json_bytes, dataset_cache_gzip_bytes
    ds_file, best_size, current_mtime = find_best_dataset_file()

    if not ds_file or not os.path.exists(ds_file):
        return b'[]', 0, False

    with dataset_cache_lock:
        if dataset_cache_json_bytes is not None and current_mtime == dataset_cache_mtime and len(dataset_cache_json_bytes) > 2:
            if accept_gzip and dataset_cache_gzip_bytes:
                return dataset_cache_gzip_bytes, dataset_cache_mtime, True
            return dataset_cache_json_bytes, dataset_cache_mtime, False

        try:
            fd = os.open(ds_file, os.O_RDONLY | os.O_BINARY)
            try:
                chunks = []
                while True:
                    chunk = os.read(fd, 65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                raw_bytes = b''.join(chunks)
                records = json.loads(raw_bytes.decode('utf-8-sig', errors='ignore'))
                compact_bytes = json.dumps(records).encode('utf-8')
                gzip_bytes = gzip.compress(compact_bytes, compresslevel=6)
                
                dataset_cache_records = records
                dataset_cache_mtime = current_mtime
                dataset_cache_json_bytes = compact_bytes
                dataset_cache_gzip_bytes = gzip_bytes
                print(f"[RAM CACHE READY] {len(records)} records (raw={len(compact_bytes)/1024/1024:.1f}MB, gzip={len(gzip_bytes)/1024/1024:.1f}MB) from {ds_file}")

                # Auto-sync best dataset to all candidate directories if missing or smaller
                target_dirs = get_all_candidate_data_dirs()
                for td in target_dirs:
                    target_file = os.path.join(td, 'defect_details.json')
                    if target_file != ds_file:
                        try:
                            if not os.path.exists(target_file) or os.path.getsize(target_file) < len(compact_bytes):
                                os.makedirs(td, exist_ok=True)
                                with open(target_file, 'wb') as f_out:
                                    f_out.write(compact_bytes)
                                    f_out.truncate()
                                print(f"[AUTO-SYNC SUCCESS] Synced {len(records)} records to {target_file}")
                        except Exception as eSync:
                            print(f"[AUTO-SYNC WARNING] Could not sync to {target_file}: {eSync}")

                if accept_gzip:
                    return gzip_bytes, current_mtime, True
                return compact_bytes, current_mtime, False
            finally:
                os.close(fd)
        except Exception as e:
            print(f"[CACHE READ ERROR] {ds_file}: {e}")
            if accept_gzip and dataset_cache_gzip_bytes:
                return dataset_cache_gzip_bytes, dataset_cache_mtime, True
            if dataset_cache_json_bytes is not None:
                return dataset_cache_json_bytes, dataset_cache_mtime, False
            return b'[]', 0, False

class LocalHostServerHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        try:
            if sys.stderr and hasattr(sys.stderr, 'write'):
                sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format%args))
        except Exception:
            pass

    def translate_path(self, path):
        # Restrict static file serving: block hidden files and sensitive script/config source files
        clean = path.split('?')[0].split('#')[0]
        segments = [s for s in clean.split('/') if s]
        if any(seg.startswith('.') for seg in segments):
            return os.path.join(APP_DIR, '__blocked__')
        ext = os.path.splitext(clean)[1].lower()
        if ext in ('.py', '.log', '.bat', '.ps1', '.vbs', '.cmd', '.url', '.git'):
            return os.path.join(APP_DIR, '__blocked__')
        return super().translate_path(path)

    def end_headers(self):
        origin = self.headers.get('Origin', '')
        cfg = get_config()
        port = cfg.get('port', DEFAULT_PORT)
        allowed = {f'http://127.0.0.1:{port}', f'http://localhost:{port}', 'http://127.0.0.1:8080', 'http://localhost:8080'}
        if origin in allowed:
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', f'http://127.0.0.1:{port}')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Vary', 'Origin')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        clean_path = self.path.split('?')[0]

        if clean_path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return

        if clean_path == '/api/status':
            data_dir = get_data_dir()
            cfg = get_config()
            is_shared = os.path.exists(os.path.join(data_dir, 'defect_details.json'))
            _, mtime, _ = get_cached_dataset_body()

            res = {
                "status": "online",
                "active_data_dir": data_dir,
                "is_shared_drive": is_shared,
                "sync_mode": "onedrive_shared_drive" if is_shared else "local_data_dir",
                "port": cfg.get('port', DEFAULT_PORT),
                "dataset_updated_at": str(mtime)
            }
            body = json.dumps(res, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if clean_path == '/api/annotations':
            target_dirs = get_all_candidate_data_dirs()
            annotations = {}
            for td in target_dirs:
                anns_file = os.path.join(td, 'fix_annotations.json')
                if os.path.exists(anns_file):
                    try:
                        with open(anns_file, 'r', encoding='utf-8-sig') as f:
                            data = json.load(f)
                            if isinstance(data, dict):
                                for k, v in data.items():
                                    if k not in annotations:
                                        annotations[k] = v
                                    else:
                                        t_cur = annotations[k].get('updatedAt', '')
                                        t_new = v.get('updatedAt', '')
                                        if t_new >= t_cur:
                                            annotations[k] = v
                    except Exception as e:
                        print(f"[ERROR] Failed reading {anns_file}: {e}")
            body = json.dumps(annotations).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        if clean_path == '/api/dataset':
            accept_enc = self.headers.get('Accept-Encoding', '')
            use_gzip = 'gzip' in accept_enc.lower()
            body, mtime, is_gzipped = get_cached_dataset_body(accept_gzip=use_gzip)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            if is_gzipped:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Last-Modified', str(mtime))
            self.end_headers()
            self.wfile.write(body)
            return

        super().do_GET()

    def do_POST(self):
        clean_path = self.path.split('?')[0]
        content_length = int(self.headers.get('Content-Length', 0))

        if clean_path == '/api/restart':
            origin = self.headers.get('Origin', '')
            if origin and not (origin.startswith('http://127.0.0.1:') or origin.startswith('http://localhost:')):
                self.send_response(403)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error":"Forbidden"}')
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"status":"restarting"}')

            def do_restart():
                import time, subprocess
                time.sleep(0.3)
                try:
                    server_exe = os.path.join(APP_DIR, 'server.exe')
                    if os.path.exists(server_exe):
                        subprocess.Popen([server_exe], cwd=APP_DIR, creationflags=0x08000000)
                    else:
                        subprocess.Popen([sys.executable, 'server.py'], cwd=APP_DIR, creationflags=0x08000000)
                except Exception as e:
                    print("Restart error:", e)
                os._exit(0)

            threading.Thread(target=do_restart, daemon=True).start()
            return

        if clean_path == '/api/annotations':
            if content_length > 1024 * 1024 or content_length <= 0:
                self.send_response(413)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error":"Payload size must be between 1 and 1MB"}')
                return

            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode('utf-8'))
                target_dirs = get_all_candidate_data_dirs()

                key = payload.get('key')
                if key:
                    for td in target_dirs:
                        try:
                            os.makedirs(td, exist_ok=True)
                            ann_file = os.path.join(td, 'fix_annotations.json')
                            ann_js_file = os.path.join(td, 'fix_annotations.js')
                            annotations = {}
                            if os.path.exists(ann_file):
                                try:
                                    with open(ann_file, 'r', encoding='utf-8') as f:
                                        annotations = json.load(f)
                                except Exception:
                                    pass
                            annotations[key] = payload
                            with open(ann_file, 'w', encoding='utf-8') as f:
                                json.dump(annotations, f, indent=2)

                            # Safe script escaping: Neutralize script closing tags inside JSON string
                            safe_js_json = json.dumps(annotations, indent=2).replace('<', '\\u003c').replace('>', '\\u003e')
                            with open(ann_js_file, 'w', encoding='utf-8') as f:
                                f.write("window.SHARED_FIX_ANNOTATIONS = " + safe_js_json + ";\n")
                        except Exception as eSave:
                            print(f"[SAVE WARNING] Could not write to {td}: {eSave}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                return
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
                return

        if clean_path == '/api/dataset':
            if content_length > 60 * 1024 * 1024 or content_length <= 0:
                self.send_response(413)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error":"Dataset payload must be <= 60MB"}')
                return

            bytes_remaining = content_length
            chunks = []
            chunk_size = 65536
            while bytes_remaining > 0:
                to_read = min(chunk_size, bytes_remaining)
                chunk = self.rfile.read(to_read)
                if not chunk:
                    break
                chunks.append(chunk)
                bytes_remaining -= len(chunk)

            post_data = b''.join(chunks)
            try:
                records = json.loads(post_data.decode('utf-8'))
                if not isinstance(records, list) or len(records) == 0:
                    raise ValueError("Dataset payload must be a non-empty list of records")

                with dataset_lock:
                    target_dirs = get_all_candidate_data_dirs()

                    for td in target_dirs:
                        try:
                            os.makedirs(td, exist_ok=True)
                            ds_file = os.path.join(td, 'defect_details.json')
                            ds_js_file = os.path.join(td, 'defect_details.js')
                            pid = os.getpid()
                            tid = threading.get_ident()
                            tmp_json = f"{ds_file}.tmp.{pid}_{tid}"
                            tmp_js = f"{ds_js_file}.tmp.{pid}_{tid}"

                            # Atomic save: Write to unique .tmp first, then replace on disk
                            compact_json_bytes = json.dumps(records).encode('utf-8')
                            with open(tmp_json, 'wb') as f:
                                f.write(compact_json_bytes)
                                f.truncate()

                            # Safe script escaping: Neutralize script closing tags inside JS companion bundle
                            safe_dataset_js = compact_json_bytes.replace(b'<', b'\\u003c').replace(b'>', b'\\u003e')
                            with open(tmp_js, 'wb') as f:
                                f.write(b"window.SHARED_DEFECT_DATA = " + safe_dataset_js + b";\n")
                                f.truncate()

                            if os.path.exists(tmp_json):
                                try:
                                    os.replace(tmp_json, ds_file)
                                except Exception:
                                    with open(tmp_json, 'rb') as f_src:
                                        content_bytes = f_src.read()
                                    with open(ds_file, 'wb') as f_dst:
                                        f_dst.write(content_bytes)
                                        f_dst.truncate()
                                    try: os.remove(tmp_json)
                                    except Exception: pass

                            if os.path.exists(tmp_js):
                                try:
                                    os.replace(tmp_js, ds_js_file)
                                except Exception:
                                    with open(tmp_js, 'rb') as f_src_js:
                                        content_js_bytes = f_src_js.read()
                                    with open(ds_js_file, 'wb') as f_dst_js:
                                        f_dst_js.write(content_js_bytes)
                                        f_dst_js.truncate()
                                    try: os.remove(tmp_js)
                                    except Exception: pass

                        except Exception as eSave:
                            print(f"[DATASET SAVE WARNING] Could not write to {td}: {eSave}")

                print(f"[DATASET SUCCESS] Saved {len(records)} records across all data directories")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status":"ok"}')
                return
            except Exception as e:
                print(f"[DATASET ERROR] Failed processing /api/dataset POST: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                err_msg = json.dumps({"error": str(e)}).encode('utf-8')
                self.wfile.write(err_msg)
                return

        super().do_POST()

if __name__ == '__main__':
    try:
        cfg = get_config()
        desired_port = cfg.get('port', DEFAULT_PORT)
        active_data = get_data_dir()

        class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
            allow_reuse_address = True
            daemon_threads = True

        httpd = None
        selected_port = desired_port

        try:
            httpd = ThreadedTCPServer(("127.0.0.1", desired_port), LocalHostServerHandler)
        except Exception:
            # Port is already bound by an existing running server; exit cleanly without creating duplicates
            sys.exit(0)

        print(f"============================================================")
        print(f"  Defect Analytics Dashboard Local Backend Server")
        print(f"  Local Loopback URL: http://127.0.0.1:{selected_port}")
        print(f"  Active Data Directory: {active_data}")
        print(f"============================================================")

        # Pre-warm RAM cache in background daemon thread on startup
        threading.Thread(target=get_cached_dataset_body, daemon=True).start()

        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        if 'httpd' in locals() and httpd:
            httpd.server_close()
    except Exception as err:
        print(f"\n[SERVER FATAL ERROR] {err}")
        import traceback
        traceback.print_exc()
        try:
            with open(os.path.join(APP_DIR, 'server_error.log'), 'a', encoding='utf-8') as f:
                f.write(f"\n--- {err} ---\n")
                traceback.print_exc(file=f)
        except Exception:
            pass
        print("\nPress Enter to close this window...")
        input()
