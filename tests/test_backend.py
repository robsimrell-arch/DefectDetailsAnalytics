"""
Backend unit and integration tests for Defect Details Analytics.
"""
import os
import sys
import json
import time
import shutil
import tempfile
import threading
import urllib.request
import urllib.error
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

import server

class TestBackupRotation(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="defect_test_backup_")
        self.sample_file = os.path.join(self.test_dir, "test_data.json")
        with open(self.sample_file, "w") as f:
            f.write(json.dumps({"key": "val1"}))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_rotating_backup_creation_and_pruning(self):
        max_b = 3
        # Directly test create_rotating_backup
        backup_dir = os.path.join(self.test_dir, "backups")
        os.makedirs(backup_dir, exist_ok=True)
        # Create dummy old backups
        for i in range(5):
            fn = f"test_data_2026010{i}_120000.json"
            fp = os.path.join(backup_dir, fn)
            with open(fp, "w") as f:
                f.write("old")
            # set mtime in past
            os.utime(fp, (1700000000 + i * 100, 1700000000 + i * 100))

        # Now call create_rotating_backup
        p = server.create_rotating_backup(self.sample_file, max_backups=max_b)
        self.assertIsNotNone(p)
        self.assertTrue(os.path.exists(p))

        remaining = [f for f in os.listdir(backup_dir) if f.startswith("test_data_")]
        self.assertLessEqual(len(remaining), max_b, f"Backups should be pruned to {max_b}, found {len(remaining)}")

class TestServerEndpoints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Bind on ephemeral port
        cls.httpd = server.ThreadedTCPServer(('127.0.0.1', 0), server.LocalHostServerHandler)
        cls.port = cls.httpd.server_address[1]
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def test_get_status(self):
        url = f"{self.base_url}/api/status"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode('utf-8'))
            self.assertEqual(data.get('status'), 'online')
            self.assertIn('active_data_dir', data)
            self.assertIn('port', data)

    def test_get_annotations(self):
        url = f"{self.base_url}/api/annotations"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode('utf-8'))
            self.assertIsInstance(data, dict)

    def test_status_reports_fresh_dataset_mtime(self):
        url = f"{self.base_url}/api/status"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as resp:
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read().decode('utf-8'))
            self.assertIn('dataset_updated_at', data)
            # mtime should be a non-empty string representing timestamp
            self.assertTrue(len(data['dataset_updated_at']) > 0)

    def test_post_dataset_validation(self):
        url = f"{self.base_url}/api/dataset"
        # Test empty body rejection
        req = urllib.request.Request(url, data=b"[]", headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.fail("Server should reject empty dataset")
        except urllib.error.HTTPError as e:
            self.assertEqual(e.code, 500)

        # Test direct cache status function
        from backend.network_utils import get_latest_dataset_status
        mtime = get_latest_dataset_status()
        self.assertGreater(mtime, 0)

    def test_static_index_html(self):
        url = f"{self.base_url}/index.html"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=3) as resp:
            self.assertEqual(resp.status, 200)
            content = resp.read().decode('utf-8')
            self.assertIn("Defect Details", content)

if __name__ == '__main__':
    unittest.main()
