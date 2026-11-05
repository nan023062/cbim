"""Regression tests for file inventory, evidence and conservative scope handling."""
import csv
from contextlib import closing
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('orphan_scan',Path(__file__).with_name('scan_orphan_files.py'))
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class OrphanScanTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.module = self.root/'.cbim/workspace/game/module.json'
        self.module.parent.mkdir(parents=True)
        self.save([])

    def save(self,sources):
        self.module.write_text(json.dumps({'id':'.cbim/workspace/game','sources':sources}),encoding='utf-8')

    def file(self,name):
        p=self.root/name
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text('fixture',encoding='utf-8')
        return p

    def rows(self,result):
        with closing(sqlite3.connect(Path(result['record'])/'inventory.sqlite')) as db:
            return {row[0]:row[1:] for row in db.execute('SELECT path,status,ignored,legacy FROM files')}

    def test_hidden_ignored_and_unregistered_files_remain_visible(self):
        self.file('.hidden/file.txt')
        self.file('unknown/asset.meta')
        self.file('src/a.cs')
        self.file('src_extra/b.cs')
        (self.root/'.cbim/.cbimignore').write_text('*.meta\n',encoding='utf-8')
        self.save([{'location':'src','scope':'代码'}])
        before=self.module.read_bytes()
        result=scanner.scan(self.root)
        rows=self.rows(result)
        self.assertEqual(rows['.hidden/file.txt'][0],'orphan')
        self.assertEqual(rows['unknown/asset.meta'][0],'orphan')
        self.assertIn('*.meta',rows['unknown/asset.meta'][1])
        self.assertEqual(rows['src/a.cs'][0],'scope_review')
        self.assertEqual(rows['src_extra/b.cs'][0],'orphan')
        self.assertEqual(self.module.read_bytes(),before)
        self.assertTrue(result['physical_scan_complete'])
        self.assertEqual(result['exit_code'],2)
        self.assertFalse(any(result['record'] in str(self.root/p) for p in rows))

    def test_legacy_files_missing_paths_and_explicit_exclusions(self):
        self.file('src/bin/a.dll')
        self.file('src/obj/b.cs')
        self.file('single.txt')
        self.save([{'location':'src','scope':'代码；不含 bin/obj。'},
                   {'location':'single.txt','scope':'旧文件'},
                   {'location':'missing','scope':'待同步目录'}])
        result=scanner.scan(self.root)
        rows=self.rows(result)
        self.assertEqual(rows['src/bin/a.dll'][0],'orphan')
        self.assertEqual(rows['src/obj/b.cs'][0],'orphan')
        self.assertEqual(rows['single.txt'][0],'orphan')
        self.assertTrue(rows['single.txt'][2])
        self.assertEqual(result['source_kinds'],{'directory':1,'file':1,'missing':1,'invalid':0})

    def test_other_owner_can_cover_excluded_path(self):
        self.file('src/bin/a.dll')
        self.save([{'location':'src','scope':'不含 bin/obj'},
                   {'location':'src/bin','scope':'构建产物'}])
        result=scanner.scan(self.root)
        self.assertEqual(self.rows(result)['src/bin/a.dll'][0],'scope_review')

    def test_exports_and_repeated_runs_have_unique_records(self):
        self.file('a/b.txt')
        first=scanner.scan(self.root)
        second=scanner.scan(self.root)
        self.assertNotEqual(first['record'],second['record'])
        with (Path(first['record'])/'orphan_files.csv').open(encoding='utf-8-sig',newline='') as f:
            rows=list(csv.reader(f))[1:]
        self.assertEqual(len(rows),first['counts']['orphan'])
        self.assertTrue(all(Path(row[0]).is_absolute() for row in rows))
        self.assertTrue(first['verification']['counts_and_exports_match'])

    def test_invalid_source_fails_closed_and_empty_definitions_rejected(self):
        self.save([{'location':'../outside','scope':'invalid'}])
        result=scanner.scan(self.root)
        self.assertEqual(result['exit_code'],1)
        self.assertEqual(result['source_kinds']['invalid'],1)
        self.module.unlink()
        with self.assertRaises(ValueError):scanner.scan(self.root)

    def test_directory_alias_deduplicates_internal_target(self):
        self.file('real/file.txt')
        try:
            os.symlink(self.root/'real',self.root/'alias',target_is_directory=True)
        except OSError:
            self.skipTest('当前环境无创建符号链接权限')
        result=scanner.scan(self.root)
        self.assertEqual(len(result['aliases']),1)
        self.assertEqual(result['aliases'][0]['resolved_target'],'real')
        self.assertNotIn('alias/file.txt',self.rows(result))
        self.assertTrue(result['physical_scan_complete'])

    def test_unreadable_directory_is_reported_as_incomplete(self):
        self.file('blocked/file.txt')
        scandir = scanner.os.scandir
        def fail_on_blocked(path):
            if Path(path).name == 'blocked':
                raise PermissionError('fixture denied')
            return scandir(path)
        with patch.object(scanner.os,'scandir',side_effect=fail_on_blocked):
            result=scanner.scan(self.root)
        self.assertEqual(result['exit_code'],1)
        self.assertFalse(result['physical_scan_complete'])
        self.assertTrue(result['errors'])

    def test_cli_uses_explicit_root_from_another_working_directory(self):
        self.file('unowned.txt')
        command=[sys.executable,'-B',str(Path(scanner.__file__).resolve()),'--root',str(self.root)]
        result=subprocess.run(command,cwd=self.root.parent,capture_output=True,
                              env=dict(os.environ,PYTHONIOENCODING='utf-8'))
        self.assertEqual(result.returncode,2,result.stderr.decode('utf-8'))
        receipt=json.loads(result.stdout.decode('utf-8').splitlines()[-1])
        self.assertTrue(Path(receipt['record']).is_relative_to(self.root))
        self.assertTrue(receipt['physical_scan_complete'])


if __name__=='__main__':
    unittest.main()
