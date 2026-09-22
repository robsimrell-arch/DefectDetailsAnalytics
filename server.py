import http.server
import socketserver
import json
import os
import sys
import threading
import gzip
import time
import subprocess
import traceback
import shutil
from datetime import datetime

def create_rotating_backup(filepath, max_backups=10):
    """Creates a timestamped backup of filepath in a 'backups' subdirectory, retaining max_backups."""
    try:
        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) <= 2:
            return None
        file_dir = os.path.dirname(os.path.abspath(filepath))
        backup_dir = os.path.join(file_dir, 'backups')
        os.makedirs(backup_dir, exist_ok=True)

        base_name = os.path.basename(filepath)
        name_part, ext_part = os.path.splitext(base_name)
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"{name_part}_{timestamp_str}{ext_part}"
        backup_path = os.path.join(backup_dir, backup_filename)

        shutil.copy2(filepath, backup_path)
        print(f"[BACKUP CREATED] {backup_path} ({os.path.getsize(backup_path)} bytes)")

        # Prune old backups if count > max_backups
        prefix = f"{name_part}_"
        existing = []
        for fn in os.listdir(backup_dir):
            if fn.startswith(prefix) and fn.endswith(ext_part):
                full_fn = os.path.join(backup_dir, fn)
                try:
                    existing.append((os.path.getmtime(full_fn), full_fn))
                except Exception:
                    pass
        existing.sort(key=lambda x: x[0])
        while len(existing) > max_backups:
            oldest_time, oldest_path = existing.pop(0)
            try:
                os.remove(oldest_path)
                print(f"[BACKUP PRUNED] Removed old backup: {oldest_path}")
            except Exception as ePrune:
                print(f"[BACKUP PRUNE WARNING] Could not remove {oldest_path}: {ePrune}")

        return backup_path
    except Exception as e:
        print(f"[BACKUP ERROR] Failed to create backup of {filepath}: {e}")
        return None

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

def get_master_data_dir():
    net_data = find_network_share_data_dir()
    if net_data and os.path.exists(net_data):
        return net_data
    in_place_data = os.path.join(APP_DIR, 'data')
    if os.path.exists(in_place_data):
        return in_place_data
    return os.path.join(APP_DIR, 'data')

def get_all_candidate_data_dirs():
    dirs = []
    master = get_master_data_dir()
    if master and master not in dirs:
        dirs.append(master)
    in_place = os.path.join(APP_DIR, 'data')
    if in_place and in_place not in dirs:
        dirs.append(in_place)
    local_app_dir = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'DefectAnalysisApp', 'data')
    if local_app_dir and local_app_dir not in dirs:
        dirs.append(local_app_dir)
    return dirs

def get_data_dir():
    return get_master_data_dir()

dataset_cache_records = None
dataset_cache_mtime = 0
dataset_cache_json_bytes = None
dataset_cache_gzip_bytes = None
dataset_cache_lock = threading.Lock()

def find_best_dataset_file():
    candidates = []

    def check_dir(d, priority_score):
        if not d or not os.path.exists(d): return
        gz_path = os.path.join(d, 'defect_details.json.gz')
        json_path = os.path.join(d, 'defect_details.json')

        if os.path.exists(gz_path):
            try:
                sz = os.path.getsize(gz_path)
                mt = int(os.path.getmtime(gz_path))
                if sz > 100:
                    candidates.append((gz_path, sz, mt, True, priority_score))
            except Exception:
                pass

        if os.path.exists(json_path):
            try:
                sz = os.path.getsize(json_path)
                mt = int(os.path.getmtime(json_path))
                if sz > 100:
                    candidates.append((json_path, sz, mt, False, priority_score))
            except Exception:
                pass

    # 1. Local in-place data (priority 20)
    check_dir(os.path.join(APP_DIR, 'data'), priority_score=20)

    # 2. LocalAppData directory (priority 25 - fast local SSD)
    local_app_dir = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'DefectAnalysisApp', 'data')
    if local_app_dir and os.path.abspath(local_app_dir) != os.path.abspath(os.path.join(APP_DIR, 'data')):
        check_dir(local_app_dir, priority_score=25)

    # 3. Master / Network Share (priority 10)
    master_dir = get_master_data_dir()
    if master_dir and not any(os.path.abspath(master_dir) == os.path.abspath(os.path.dirname(c[0])) for c in candidates):
        check_dir(master_dir, priority_score=10)

    if candidates:
        def sort_key(c):
            path, sz, mt, is_gz, prio = c
            # Bucket mtime by 5s to treat close timestamps across SMB/local as matching
            bucketed_mtime = mt // 5
            return (bucketed_mtime, prio, 1 if is_gz else 0, sz)

        best = max(candidates, key=sort_key)
        return best[0], best[1], best[2], best[3]

    return os.path.join(APP_DIR, 'data', 'defect_details.json'), -1, -1, False

def get_cached_dataset_body(accept_gzip=False):
    global dataset_cache_records, dataset_cache_mtime, dataset_cache_json_bytes, dataset_cache_gzip_bytes
    ds_file, best_size, current_mtime, is_source_gz = find_best_dataset_file()

    if not ds_file or not os.path.exists(ds_file):
        return b'[]', 0, False

    with dataset_cache_lock:
        if dataset_cache_json_bytes is not None and abs(current_mtime - dataset_cache_mtime) <= 2 and len(dataset_cache_json_bytes) > 2:
            if accept_gzip and dataset_cache_gzip_bytes:
                return dataset_cache_gzip_bytes, dataset_cache_mtime, True
            return dataset_cache_json_bytes, dataset_cache_mtime, False

        try:
            t0 = time.time()
            if is_source_gz:
                with open(ds_file, 'rb') as f:
                    gzip_bytes = f.read()
                compact_bytes = gzip.decompress(gzip_bytes)
                records = json.loads(compact_bytes.decode('utf-8-sig', errors='ignore'))
            else:
                with open(ds_file, 'rb') as f:
                    raw_bytes = f.read()
                records = json.loads(raw_bytes.decode('utf-8-sig', errors='ignore'))
                compact_bytes = json.dumps(records).encode('utf-8')
                gzip_bytes = gzip.compress(compact_bytes, compresslevel=6)

            dataset_cache_records = records
            dataset_cache_mtime = current_mtime
            dataset_cache_json_bytes = compact_bytes
            dataset_cache_gzip_bytes = gzip_bytes
            t_elapsed = time.time() - t0
            print(f"[RAM CACHE READY in {t_elapsed:.2f}s] {len(records)} records (raw={len(compact_bytes)/1024/1024:.1f}MB, gzip={len(gzip_bytes)/1024/1024:.1f}MB) from {ds_file}")

            def _async_sync(t_dirs, src_file, data_bytes, gz_bytes, rec_count):
                for td in t_dirs:
                    target_file = os.path.join(td, 'defect_details.json')
                    target_gz = os.path.join(td, 'defect_details.json.gz')
                    try:
                        os.makedirs(td, exist_ok=True)
                        if not os.path.exists(target_gz) or os.path.getsize(target_gz) < len(gz_bytes):
                            tmp_gz = target_gz + '.tmp'
                            with open(tmp_gz, 'wb') as f_gz:
                                f_gz.write(gz_bytes)
                            os.replace(tmp_gz, target_gz)
                        if not os.path.exists(target_file) or os.path.getsize(target_file) < len(data_bytes):
                            tmp_file = target_file + '.tmp'
                            with open(tmp_file, 'wb') as f_out:
                                f_out.write(data_bytes)
                            os.replace(tmp_file, target_file)
                    except Exception as eSync:
                        print(f"[AUTO-SYNC WARNING] Could not sync to {td}: {eSync}")

            threading.Thread(target=_async_sync, args=(get_all_candidate_data_dirs(), ds_file, compact_bytes, gzip_bytes, len(records)), daemon=True).start()

            if accept_gzip:
                return gzip_bytes, current_mtime, True
            return compact_bytes, current_mtime, False
        except Exception as eLoad:
            print(f"[CACHE LOAD ERROR] {eLoad}")
            return b'[]', 0, False
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
        if origin and origin != 'null':
            self.send_header('Access-Control-Allow-Origin', origin)
        else:
            self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, If-None-Match, If-Modified-Since')
        self.send_header('Access-Control-Expose-Headers', 'ETag, Last-Modified, Content-Length')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        if not getattr(self, '_custom_cache_control', False):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

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
            if dataset_cache_mtime > 0:
                mtime = dataset_cache_mtime
            else:
                best_file = find_best_dataset_file()
                mtime = best_file[2] if best_file else 0

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
            with annotations_lock:
                target_dirs = get_all_candidate_data_dirs()
                annotations = {}
                mtime = 0
                for td in target_dirs:
                    anns_file = os.path.join(td, 'fix_annotations.json')
                    if os.path.exists(anns_file):
                        try:
                            file_mtime = int(os.path.getmtime(anns_file))
                            if file_mtime > mtime:
                                mtime = file_mtime
                            with open(anns_file, 'r', encoding='utf-8-sig') as f:
                                loaded = json.load(f)
                                if isinstance(loaded, dict):
                                    for k, v in loaded.items():
                                        if isinstance(v, dict):
                                            if k not in annotations:
                                                annotations[k] = v
                                            else:
                                                active_fixes = ('Yes', 'No', 'False Fail', 'Possible False Fail')
                                                if v.get('confirmedFix') in active_fixes and annotations[k].get('confirmedFix') not in active_fixes:
                                                    annotations[k] = v
                                                elif v.get('fixComment') and not annotations[k].get('fixComment'):
                                                    annotations[k]['fixComment'] = v.get('fixComment')
                        except Exception as e:
                            print(f"[ERROR] Failed reading {anns_file}: {e}")

                body = json.dumps(annotations).encode('utf-8')
                etag = f'"{mtime}-{len(body)}"'
                if_none_match = self.headers.get('If-None-Match', '').strip()
                if if_none_match:
                    tags = [t.strip().strip('W/') for t in if_none_match.split(',')]
                    if '*' in tags or etag.strip('W/') in tags:
                        self._custom_cache_control = True
                        self.send_response(304)
                        self.send_header('ETag', etag)
                        self.send_header('Last-Modified', str(mtime))
                        self.send_header('Content-Length', '0')
                        self.send_header('Cache-Control', 'no-cache')
                        self.end_headers()
                        return

                self._custom_cache_control = True
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.send_header('ETag', etag)
                self.send_header('Last-Modified', str(mtime))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(body)
                return

        if clean_path == '/api/dataset':
            accept_enc = self.headers.get('Accept-Encoding', '')
            use_gzip = 'gzip' in accept_enc.lower()
            body, mtime, is_gzipped = get_cached_dataset_body(accept_gzip=use_gzip)
            etag = f'"{mtime}-{len(body)}"'
            if_none_match = self.headers.get('If-None-Match', '').strip()
            if_modified_since = self.headers.get('If-Modified-Since', '').strip()

            is_not_modified = False
            if if_none_match:
                tags = [t.strip().strip('W/') for t in if_none_match.split(',')]
                target_tag = etag.strip('W/')
                if '*' in tags or target_tag in tags:
                    is_not_modified = True
            elif if_modified_since and mtime > 0:
                try:
                    if if_modified_since == str(mtime):
                        is_not_modified = True
                    else:
                        import email.utils
                        parsed_time = email.utils.parsedate_to_datetime(if_modified_since).timestamp()
                        if int(parsed_time) >= int(mtime):
                            is_not_modified = True
                except Exception:
                    pass

            self._custom_cache_control = True
            if is_not_modified:
                self.send_response(304)
                self.send_header('ETag', etag)
                self.send_header('Last-Modified', str(mtime))
                self.send_header('Content-Length', '0')
                self.send_header('Cache-Control', 'public, max-age=60')
                self.end_headers()
                return

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            if is_gzipped:
                self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('ETag', etag)
            self.send_header('Last-Modified', str(mtime))
            self.send_header('Cache-Control', 'public, max-age=60')
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
                key = payload.get('key')
                if key:
                    with annotations_lock:
                        target_dirs = get_all_candidate_data_dirs()
                        annotations = {}
                        for td in target_dirs:
                            ann_file_read = os.path.join(td, 'fix_annotations.json')
                            if os.path.exists(ann_file_read):
                                try:
                                    with open(ann_file_read, 'r', encoding='utf-8-sig') as f:
                                        loaded = json.load(f)
                                        if isinstance(loaded, dict):
                                            for k, v in loaded.items():
                                                if isinstance(v, dict) and k not in annotations:
                                                    annotations[k] = v
                                except Exception:
                                    pass

                        annotations[key] = payload
                        
                        # Write to all candidate dirs (master network share first, then local cache)
                        for td in target_dirs:
                            try:
                                os.makedirs(td, exist_ok=True)
                                ann_file = os.path.join(td, 'fix_annotations.json')
                                ann_js_file = os.path.join(td, 'fix_annotations.js')
                                if os.path.exists(ann_file) and os.path.getsize(ann_file) > 2:
                                    create_rotating_backup(ann_file, max_backups=10)

                                with open(ann_file, 'w', encoding='utf-8') as f:
                                    json.dump(annotations, f, indent=2)

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
            if content_length > 200 * 1024 * 1024 or content_length <= 0:
                self.send_response(413)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"error":"Dataset payload must be <= 200MB"}')
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
                    compact_json_bytes = json.dumps(records).encode('utf-8')
                    safe_dataset_js = compact_json_bytes.replace(b'<', b'\\u003c').replace(b'>', b'\\u003e')
                    safe_js_bytes = b"window.SHARED_DEFECT_DATA = " + safe_dataset_js + b";\n"

                    local_dirs = [d for d in target_dirs if not d.startswith(r'\\')]
                    network_dirs = [d for d in target_dirs if d.startswith(r'\\')]

                    def _save_to_dir(td, make_backup=True):
                        try:
                            os.makedirs(td, exist_ok=True)
                            ds_file = os.path.join(td, 'defect_details.json')
                            ds_gz_file = os.path.join(td, 'defect_details.json.gz')
                            ds_js_file = os.path.join(td, 'defect_details.js')
                            if make_backup and os.path.exists(ds_file) and os.path.getsize(ds_file) > 2:
                                create_rotating_backup(ds_file, max_backups=10)

                            pid = os.getpid()
                            tid = threading.get_ident()
                            tmp_json = f"{ds_file}.tmp.{pid}_{tid}"
                            tmp_gz = f"{ds_gz_file}.tmp.{pid}_{tid}"
                            tmp_js = f"{ds_js_file}.tmp.{pid}_{tid}"

                            compact_gz_bytes = gzip.compress(compact_json_bytes, compresslevel=6)

                            # Atomic save: Write to unique .tmp first, then replace on disk
                            with open(tmp_json, 'wb') as f:
                                f.write(compact_json_bytes)
                                f.truncate()

                            with open(tmp_gz, 'wb') as f:
                                f.write(compact_gz_bytes)
                                f.truncate()

                            with open(tmp_js, 'wb') as f:
                                f.write(safe_js_bytes)
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

                            if os.path.exists(tmp_gz):
                                try:
                                    os.replace(tmp_gz, ds_gz_file)
                                except Exception:
                                    with open(tmp_gz, 'rb') as f_src:
                                        content_bytes = f_src.read()
                                    with open(ds_gz_file, 'wb') as f_dst:
                                        f_dst.write(content_bytes)
                                        f_dst.truncate()
                                    try: os.remove(tmp_gz)
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

                            print(f"[DATASET DIRECTORY SAVED] {td}")
                        except Exception as eSave:
                            print(f"[DATASET SAVE WARNING] Could not write to {td}: {eSave}")

                    # 1. Fast local SSD save (<0.2s)
                    for ld in local_dirs:
                        _save_to_dir(ld, make_backup=True)

                    # 2. Refresh in-memory RAM cache immediately
                    with dataset_cache_lock:
                        dataset_cache_records = records
                        dataset_cache_json_bytes = compact_json_bytes
                        dataset_cache_gzip_bytes = gzip.compress(compact_json_bytes, compresslevel=6)
                        dataset_cache_mtime = int(time.time())
                        print(f"[RAM CACHE REFRESHED] {len(records)} records (mtime={dataset_cache_mtime})")

                    # 3. Stream to network share asynchronously in background thread so client never times out
                    if network_dirs:
                        def _bg_network_save(net_dirs):
                            print(f"[BACKGROUND SYNC STARTED] Replicating {len(records)} records to {len(net_dirs)} network share(s)...")
                            for nd in net_dirs:
                                _save_to_dir(nd, make_backup=True)
                            print(f"[BACKGROUND SYNC COMPLETED] Network share update complete.")

                        threading.Thread(target=_bg_network_save, args=(network_dirs,), daemon=True).start()

                print(f"[DATASET SUCCESS] Saved {len(records)} records locally and queued network sync")
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

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == '__main__':
    try:
        cfg = get_config()
        desired_port = cfg.get('port', DEFAULT_PORT)
        active_data = get_data_dir()

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
