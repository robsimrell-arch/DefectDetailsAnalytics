"""
Configuration and runtime environment utilities for Defect Details Analytics.
"""
import os
import sys
import json

class NullWriter:
    def write(self, s): pass
    def flush(self): pass

if sys.stdout is None:
    sys.stdout = NullWriter()
if sys.stderr is None:
    sys.stderr = NullWriter()

if getattr(sys, 'frozen', False):
    APP_DIR = os.path.dirname(sys.executable)
else:
    # Go one level up from backend/ directory to project root
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULT_PORT = 8080
CONFIG_FILE = os.path.join(APP_DIR, 'data', 'shared_config.json')

def get_config():
    """Loads runtime configuration from shared_config.json, with defaults."""
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
