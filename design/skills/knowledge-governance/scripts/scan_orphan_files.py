"""Reusable read-only orphan-file inventory for knowledge governance.

Project content and module definitions are never modified. Only timestamped
evidence is written. Scope prose is deliberately not treated as an ownership DSL.
"""
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from contextlib import closing
import argparse
import os, sys, json, sqlite3, csv, hashlib, stat, time

# Reuse the project's authoritative discovery and path-normalization helpers.
sys.path.insert(0, str(Path(__file__).resolve().parents[3]/'scripts'))
from ignore_rules import IgnoreRules, source_key
from maintain_registries import discover, read_json
from skill_runtime import record_dir


def scan(root):
    root = Path(root).resolve(strict=True)
    if not (root/'.cbim/workspace').is_dir():
        raise ValueError('项目根下缺少 .cbim/workspace')
    record = record_dir(root, 'orphan-file-scan')
    started = datetime.now().astimezone().isoformat()
    rules = IgnoreRules(root)
    directory_sources = defaultdict(list)
    file_sources = defaultdict(list)
    sources, definitions, errors, skipped = [], [], [], []
    for p in discover(root, '.cbim/workspace', 'module.json', apply_ignore=False):
        d = read_json(p)
        definitions.append({'path':p.relative_to(root).as_posix(), 'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
        backup = record/'baseline'/p.relative_to(root)
        backup.parent.mkdir(parents=True,exist_ok=True)
        backup.write_bytes(p.read_bytes())
        for index, s in enumerate(d['sources']):
            item = dict(s, module=d['id'], index=index)
            try:
                key = source_key(root,s['location'])
                physical = root/s['location']
                kind = 'directory' if physical.is_dir() else 'file' if physical.is_file() else 'missing'
                item.update(key=key, kind=kind)
                if kind == 'directory': directory_sources[key].append(item)
                elif kind == 'file': file_sources[key].append(item)
            except (OSError,ValueError,RuntimeError) as exc:
                item.update(kind='invalid',error=str(exc))
            sources.append(item)
    if not definitions:
        raise ValueError('未找到模块定义，不能执行有效覆盖检查')
    (record/'sources.json').write_text(json.dumps(sources,ensure_ascii=False,indent=2),encoding='utf-8')

    with closing(sqlite3.connect(record/'inventory.sqlite')) as db:
        db.execute('CREATE TABLE files(path TEXT PRIMARY KEY, absolute_path TEXT, parent TEXT, top TEXT, status TEXT, reason TEXT, ignored TEXT, candidates TEXT, legacy TEXT)')
        counts = defaultdict(int, files=0, orphan=0, scope_review=0)

        def candidates_for(relative):
            parts = relative.casefold().split('/')
            matches=[]
            for n in range(1,len(parts)):
                matches.extend(directory_sources.get('/'.join(parts[:n]),[]))
            return matches

        def excluded(relative, source):
            # Only explicit path exclusions are evaluated, never infer semantic ownership
            # from an extension or interpret arbitrary prose as a complete rule language.
            tail = relative.casefold()[len(source['key']):].strip('/')
            scope = source['scope']
            parts = tail.split('/')
            if ('不含 bin/obj' in scope or 'bin/obj 不作为' in scope) and any(p in ('bin','obj') for p in parts[:-1]):
                return 'scope 明确排除 bin/obj'
            return None

        def add_file(relative, absolute):
            candidates = candidates_for(relative)
            legacy = file_sources.get(relative.casefold(),[])
            active = [s for s in candidates if not excluded(relative,s)]
            if active:
                status,reason = 'scope_review','目录路径已命中；自然语言 scope 与文件职责需复核'
            elif candidates:
                status,reason = 'orphan','全部候选目录 source 的显式路径排除规则均排除此文件'
            elif legacy:
                status,reason = 'orphan','仅有文件级 source；违反仅允许目录 source 的新规范，尚未迁移'
            else:
                status,reason = 'orphan','没有任何目录 source 覆盖'
            ignored = rules.match(relative)
            parent = relative.rpartition('/')[0] or '.'
            top = relative.split('/')[0] if '/' in relative else '(项目根文件)'
            db.execute('INSERT INTO files VALUES (?,?,?,?,?,?,?,?,?)',(
                relative,str(absolute),parent,top,status,reason,
                json.dumps(ignored,ensure_ascii=False) if ignored else '',
                json.dumps([{'module':s['module'],'source':s['location'],'scope':s['scope'],'excluded':excluded(relative,s)} for s in candidates],ensure_ascii=False),
                json.dumps([{'module':s['module'],'source':s['location']} for s in legacy],ensure_ascii=False) if legacy else ''))
            counts[status]+=1
            counts['files']+=1

        visited_directories = set()
        stack = [root]
        last = time.monotonic()
        while stack:
            folder = stack.pop()
            try:
                with os.scandir(folder) as entries:
                    visited_directories.add(folder)
                    for entry in entries:
                        path = Path(entry.path)
                        relative = path.relative_to(root).as_posix()
                        if path == record:
                            skipped.append({'path':relative,'reason':'本次扫描新生成的证据目录，不属于扫描开始时的项目文件'})
                            continue
                        try:
                            info=entry.stat(follow_symlinks=False)
                            reparse=bool(getattr(info,'st_file_attributes',0) & getattr(stat,'FILE_ATTRIBUTE_REPARSE_POINT',1024))
                            if entry.is_symlink() or reparse:
                                skipped.append({'path':relative,'reason':'符号链接或重解析点；未跟随，避免越界和循环'})
                            elif entry.is_dir(follow_symlinks=False):
                                stack.append(path)
                            elif entry.is_file(follow_symlinks=False):
                                add_file(relative,path)
                            else:
                                skipped.append({'path':relative,'reason':'非普通文件或目录'})
                        except (OSError,ValueError) as exc:
                            errors.append({'path':relative,'error':str(exc)})
            except OSError as exc:
                errors.append({'path':str(folder),'error':str(exc)})
            if time.monotonic()-last > 15:
                db.commit();print(json.dumps(dict(counts)),flush=True);last=time.monotonic()
        db.commit()
        db.execute('CREATE INDEX by_status_directory ON files(status,parent,path)')

        def export_csv(name,query,headings):
            with (record/name).open('w',encoding='utf-8-sig',newline='') as f:
                writer=csv.writer(f);writer.writerow(headings);writer.writerows(db.execute(query))
        export_csv('orphan_files.csv',"SELECT absolute_path,path,parent,reason,ignored,legacy FROM files WHERE status='orphan' ORDER BY parent,path",['完整路径','项目相对路径','所在目录','游离原因','忽略规则','历史文件级source'])
        export_csv('directory_summary.csv',"SELECT parent,count(*),sum(ignored!=''),sum(legacy!='') FROM files WHERE status='orphan' GROUP BY parent ORDER BY parent",['目录','游离文件数','命中忽略规则数','仅有历史文件级source数'])
        export_csv('scope_review.csv',"SELECT absolute_path,path,candidates,ignored FROM files WHERE status='scope_review' ORDER BY parent,path",['完整路径','项目相对路径','候选模块与scope','忽略规则'])
        top = list(db.execute("SELECT top,count(*),sum(ignored!=''),sum(legacy!='') FROM files WHERE status='orphan' GROUP BY top ORDER BY count(*) DESC"))
        report_files=[]
        for i,(name,count,ignored,legacy) in enumerate(top):
            report_name=f'orphan_paths_{i+1:02d}.md'
            report_files.append({'top':name,'count':count,'ignored':ignored,'legacy_file_only':legacy,'report':report_name})
            with (record/report_name).open('w',encoding='utf-8') as f:
                f.write(f'# {name}：游离文件完整路径\n\n共 {count} 个，含忽略项 {ignored} 个、仅有历史文件级 source {legacy} 个。\n')
                previous=None
                for parent,absolute in db.execute("SELECT parent,absolute_path FROM files WHERE status='orphan' AND top=? ORDER BY parent,path",(name,)):
                    if parent!=previous:
                        if previous is not None:f.write('```\n')
                        f.write(f'\n## {parent}\n\n```text\n');previous=parent
                    f.write(absolute+'\n')
                if previous is not None:f.write('```\n')
        summary={'root':str(root),'started':started,'finished':datetime.now().astimezone().isoformat(),'modules':len(definitions),'sources':len(sources),'source_kinds':{k:sum(s['kind']==k for s in sources) for k in ('directory','file','missing','invalid')},'counts':dict(counts),'errors':errors,'skipped':skipped,'top_directories':report_files,'definition_hashes':definitions,'ignore_config':rules.status(),'scope_assessment':'All directory-matched files remain scope_review; only explicit bin/obj exclusions evaluated; other natural-language exclusions require review. No semantic full-coverage claim.'}
        (record/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        with (record/'report.md').open('w',encoding='utf-8') as f:
            f.write(f'# 全项目游离文件扫描\n\n扫描根：`{root}`\n\n开始：{started}\n\n扫描 {len(definitions)} 个模块、{len(sources)} 条 source，共 {counts["files"]:,} 个文件。目录 source 未覆盖 {counts["orphan"]:,} 个；目录命中但 scope 待核实 {counts["scope_review"]:,} 个。\n\n')
            f.write('文件级 source 尚未迁移，按新规范不算有效目录覆盖；对应文件另有标记，不自动扩展为父目录。隐藏文件、未跟踪文件、构建产物、治理文件与旧任务记录均纳入，忽略规则不用于过滤。\n\n')
            f.write('目录命中只证明路径覆盖，不证明 scope 语义覆盖。待核实清单可能包含进一步的游离文件；本报告不宣称所有文件归属均已核实。\n\n')
            f.write('| 顶层目录 | 游离文件 | 其中忽略项 | 仅有文件级 source | 完整路径清单 |\n|---|---:|---:|---:|---|\n')
            for item in report_files:f.write(f'| {item["top"]} | {item["count"]} | {item["ignored"]} | {item["legacy_file_only"]} | [按目录展开]({item["report"]}) |\n')
            f.write('\n[全部游离文件 CSV](orphan_files.csv) · [逐目录汇总 CSV](directory_summary.csv) · [scope 待核实 CSV](scope_review.csv) · [完整扫描回执](summary.json)\n\n## 扫描缺口\n\n')
            for item in errors+skipped:f.write('- '+json.dumps(item,ensure_ascii=False)+'\n')
            if not errors and len(skipped)==1:f.write('\n除本次新生成的证据目录外，无读取错误或跳过目录。\n')

        aliases = []
        unresolved = []
        for item in skipped:
            if item['path'] == record.relative_to(root).as_posix():
                item['status'] = 'scan_output'
                continue
            try:
                path = (root/item['path']).resolve(strict=True)
                if not path.is_relative_to(root) or path == root or path == record or record in path.parents:
                    raise ValueError('链接目标在扫描边界之外或构成循环')
                rel = path.relative_to(root).as_posix()
                if path.is_dir():
                    # Prefix comparison avoids SQL LIKE wildcards in real filenames.
                    prefix = rel+'/'
                    total = db.execute('SELECT count(*) FROM files WHERE substr(path,1,?)=?', (len(prefix),prefix)).fetchone()[0]
                    if path not in visited_directories:
                        raise ValueError('链接目标目录未完整遍历')
                else:
                    total = db.execute('SELECT count(*) FROM files WHERE path=?',(rel,)).fetchone()[0]
                    if not total:
                        raise ValueError('链接目标文件未纳入清单')
                item.update(status='alias', resolved_target=rel, physical_files_already_scanned=total)
                aliases.append(item)
            except (OSError,ValueError,RuntimeError) as exc:
                item.update(status='unresolved', detail=str(exc))
                unresolved.append(item)
        summary['aliases'] = aliases
        summary['unresolved_paths'] = unresolved
        summary['physical_scan_complete'] = not errors and not unresolved
        summary['orphan_directories'] = db.execute("SELECT count(DISTINCT parent) FROM files WHERE status='orphan'").fetchone()[0]
        summary['orphan_ignored'] = db.execute("SELECT count(*) FROM files WHERE status='orphan' AND ignored!=''").fetchone()[0]
        summary['orphan_legacy_only'] = db.execute("SELECT count(*) FROM files WHERE status='orphan' AND legacy!=''").fetchone()[0]
        with (record/'alias_directories.csv').open('w',encoding='utf-8-sig',newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['别名路径','实际目标','已扫描实体文件数'])
            for item in aliases:
                writer.writerow([item['path'],item['resolved_target'],item['physical_files_already_scanned']])
        if db.execute('SELECT count(*) FROM files').fetchone()[0] != counts['files'] or counts['orphan']+counts['scope_review'] != counts['files']:
            errors.append({'code':'count_mismatch','error':'文件计数核对失败'})
        with (record/'orphan_files.csv').open(encoding='utf-8-sig',newline='') as f:
            reader=csv.reader(f);next(reader)
            if sum(1 for _ in reader) != counts['orphan']:
                errors.append({'code':'export_mismatch','error':'完整路径导出行数不一致'})
        with (record/'directory_summary.csv').open(encoding='utf-8-sig',newline='') as f:
            reader=csv.reader(f);next(reader)
            if sum(int(row[1]) for row in reader) != counts['orphan']:
                errors.append({'code':'export_mismatch','error':'目录汇总计数不一致'})
        for definition in definitions:
            try:
                if hashlib.sha256((root/definition['path']).read_bytes()).hexdigest() != definition['sha256']:
                    raise ValueError('扫描期间模块定义发生变化')
            except (OSError, ValueError) as exc:
                errors.append({'path':definition['path'],'error':str(exc)})
        if errors:
            summary['physical_scan_complete'] = False
        summary['verification'] = {'counts_and_exports_match':not any(e.get('code') in ('count_mismatch','export_mismatch') for e in errors), 'definitions_unchanged':not any('path' in e and e['path'].endswith('module.json') for e in errors)}
        summary['exit_code'] = 1 if errors or unresolved or any(s['kind']=='invalid' for s in sources) else 2 if counts['orphan'] or counts['scope_review'] or any(s['kind'] in ('file','missing') for s in sources) else 0
        summary['record'] = str(record)
        (record/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
        with (record/'report.md').open('a',encoding='utf-8') as f:
            f.write('\n## 扫描复核结果\n\n')
            f.write(f"实体遍历完整：{summary['physical_scan_complete']}；已解析别名 {len(aliases)} 个，未解析路径 {len(unresolved)} 个。\n\n")
            f.write('[别名映射](alias_directories.csv) · [source 类型及缺失路径](sources.json)\n\n')
            f.write(f"source 类型：{summary['source_kinds']}；退出码：{summary['exit_code']}。\n")
        return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description='扫描未被目录 source 覆盖的文件，按目录导出完整路径')
    parser.add_argument('--root',type=Path,default=Path.cwd(),help='项目根目录；默认使用当前工作目录')
    args = parser.parse_args(argv)
    try:
        result = scan(args.root)
    except (OSError, ValueError, RuntimeError, sqlite3.Error, KeyError, TypeError) as exc:
        print(json.dumps({'error':str(exc),'complete':False},ensure_ascii=False),file=sys.stderr)
        return 1
    print(json.dumps({key:result[key] for key in ('record','counts','source_kinds','physical_scan_complete','exit_code')},ensure_ascii=False),flush=True)
    return result['exit_code']


if __name__ == '__main__':
    raise SystemExit(main())
