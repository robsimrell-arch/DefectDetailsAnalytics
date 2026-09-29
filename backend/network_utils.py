"""
Network and storage resolution utilities for local and UNC network paths.
"""
import os
import time
import json
import gzip
import threading
from .config import APP_DIR, get_config
from .backup import create_rotating_backup

dataset_lock = threading.Lock()
annotations_lock = threading.Lock()

_cached_network_share_dir = None
_last_network_check_time = 0
_network_share_lock = threading.Lock()

dataset_cache_records = None
dataset_cache_mtime = 0
dataset_cache_json_bytes = None
dataset_cache_gzip_bytes = None
dataset_cache_lock = threading.Lock()

def get_dataset_cache_mtime():
    return dataset_cache_mtime

def update_dataset_cache(records, compact_json_bytes, mtime=None):
    global dataset_cache_records, dataset_cache_json_bytes, dataset_cache_gzip_bytes, dataset_cache_mtime
    if mtime is None:
        mtime = int(time.time())
    with dataset_cache_lock:
        dataset_cache_records = records
        dataset_cache_json_bytes = compact_json_bytes
        dataset_cache_gzip_bytes = gzip.compress(compact_json_bytes, compresslevel=6)
        dataset_cache_mtime = mtime
        print(f"[RAM CACHE REFRESHED] {len(records)} records (mtime={dataset_cache_mtime})")


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
