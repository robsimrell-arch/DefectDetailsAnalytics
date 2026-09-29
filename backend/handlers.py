"""
HTTP request handlers and REST routing for Defect Details Analytics.
"""
import os
import sys
import json
import gzip
import time
import threading
import subprocess
import http.server

from .config import APP_DIR, DEFAULT_PORT, get_config
from .backup import create_rotating_backup
from .network_utils import (
    get_data_dir,
    get_all_candidate_data_dirs,
    find_best_dataset_file,
    get_cached_dataset_body,
    get_dataset_cache_mtime,
    update_dataset_cache,
    dataset_lock,
    annotations_lock
)

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
            cache_mtime = get_dataset_cache_mtime()
            if cache_mtime > 0:
                mtime = cache_mtime
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
                    update_dataset_cache(records, compact_json_bytes)

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
