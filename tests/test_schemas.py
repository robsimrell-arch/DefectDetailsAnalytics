"""
Schema and data integrity tests for Defect Details Analytics.
"""
import os
import json
import gzip
import unittest

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

class TestDataSchemas(unittest.TestCase):
    def test_shared_config(self):
        cfg_path = os.path.join(PROJECT_ROOT, 'data', 'shared_config.json')
        self.assertTrue(os.path.exists(cfg_path), "shared_config.json must exist")
        with open(cfg_path, 'r', encoding='utf-8-sig') as f:
            cfg = json.load(f)
        self.assertIsInstance(cfg, dict)
        self.assertIn('port', cfg)

    def test_fix_annotations_json(self):
        ann_path = os.path.join(PROJECT_ROOT, 'data', 'fix_annotations.json')
        if os.path.exists(ann_path):
            with open(ann_path, 'r', encoding='utf-8-sig') as f:
                data = json.load(f)
            self.assertIsInstance(data, dict)
            for k, v in list(data.items())[:20]:
                self.assertIn('_', k, f"Annotation key should be formatted as serialNo_faDate: {k}")
                self.assertIsInstance(v, dict)
                self.assertTrue('confirmedFix' in v or 'fixComment' in v)

    def test_defect_details_data(self):
        json_gz_path = os.path.join(PROJECT_ROOT, 'data', 'defect_details.json.gz')
        json_path = os.path.join(PROJECT_ROOT, 'data', 'defect_details.json')
        if os.path.exists(json_gz_path):
            with gzip.open(json_gz_path, 'rt', encoding='utf-8') as f:
                records = json.load(f)
            self.assertIsInstance(records, list)
            if records:
                self.assertIsInstance(records[0], dict)
        elif os.path.exists(json_path):
            with open(json_path, 'r', encoding='utf-8-sig') as f:
                records = json.load(f)
            self.assertIsInstance(records, list)

if __name__ == '__main__':
    unittest.main()
