"""
Rotating backup manager for dataset and annotation files.
"""
import os
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
