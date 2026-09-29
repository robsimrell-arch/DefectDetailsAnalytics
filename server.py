"""
Defect Details Analytics - Local Backend Server
Orchestrator and entry point for backend HTTP services.
"""
import os
import sys
import threading
import socketserver

from backend.config import APP_DIR, DEFAULT_PORT, CONFIG_FILE, get_config, NullWriter
from backend.backup import create_rotating_backup
from backend.network_utils import (
    dataset_lock,
    annotations_lock,
    check_path_fast,
    find_network_share_data_dir,
    get_master_data_dir,
    get_all_candidate_data_dirs,
    get_data_dir,
    find_best_dataset_file,
    get_cached_dataset_body
)
from backend.handlers import LocalHostServerHandler

os.chdir(APP_DIR)

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
