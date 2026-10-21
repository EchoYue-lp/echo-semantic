"""日常完成验证的范围与证据回归。"""

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFLIGHT = ROOT / "skills/semantic-preflight/scripts/preflight.py"
VERIFIER = ROOT / "skills/semantic-contract/scripts/verify_semantic.py"


class TaskValidationTests(unittest.TestCase):
    def run_command(self, root, command):
        return subprocess.run(
            command, cwd=root, capture_output=True, text=True, check=False
        )

    def test_scan_report_as_evidence_does_not_expand_embedded_candidates(self):
        with tempfile.TemporaryDirectory(prefix="echo-task-report-") as temporary:
            root = Path(temporary)
            for args in [
                ("init", "-q"),
                ("config", "user.email", "fixture@example.com"),
                ("config", "user.name", "Fixture"),
            ]:
                self.assertEqual(self.run_command(root, ["git", *args]).returncode, 0)
            (root / "target.py").write_text("def Shared():\n    return 1\n")
            (root / "unrelated.py").write_text("def Shared():\n    return 3\n")
            self.run_command(root, ["git", "add", "."])
            self.run_command(
                root, ["git", "-c", "commit.gpgsign=false", "commit", "-qm", "source"]
            )
            inventory = ROOT / "skills/semantic-discover/scripts/inventory.py"
            result = self.run_command(
                root, ["uv", "run", str(inventory), "--root", str(root), "--write"]
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            report = json.loads(result.stdout)
            path = Path(report["report_path"]).relative_to(root.resolve()).as_posix()
            self.run_command(root, ["git", "add", ".echo-semantic"])
            self.run_command(
                root,
                [
                    "git",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-qm",
                    "candidate report",
                ],
            )
            base = self.run_command(root, ["git", "rev-parse", "HEAD"]).stdout.strip()
            result = self.run_command(
                root,
                [
                    "python3",
                    str(PREFLIGHT),
                    "record",
                    "--root",
                    str(root),
                    "--task-id",
                    "task",
                    "--kind",
                    "bugfix",
                    "--risk",
                    "low",
                    "--allow",
                    "target.py",
                    "--search",
                    ".",
                    "--reuse-decision",
                    "new",
                    "--reuse",
                    "历史报告只用于定位",
                    "--evidence",
                    path,
                    "--verify",
                    "定向行为验证",
                    "--reuse-existing-boundary",
                    "现有边界",
                ],
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            (root / "target.py").write_text("def Shared():\n    return 2\n")
            program = """
import importlib.util,sys,json
from pathlib import Path
spec=importlib.util.spec_from_file_location('verifier',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
original=module.source_bytes
def bounded(root,path,*args,**kwargs):
    assert path != 'unrelated.py','不能从报告展开全仓源码'
    return original(root,path,*args,**kwargs)
module.source_bytes=bounded
errors,report=module.validate_task(Path(sys.argv[2]),sys.argv[3],'task')
assert not errors,errors
assert 'unrelated.py' not in report['evidencePaths']
print(json.dumps(report))
"""
            result = self.run_command(
                root,
                [
                    "uv",
                    "run",
                    "--with",
                    "PyYAML>=6.0,<7",
                    "python",
                    "-c",
                    program,
                    str(VERIFIER),
                    str(root),
                    base,
                ],
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_no_baseline_local_validation_and_out_of_scope_detection(self):
        with tempfile.TemporaryDirectory(prefix="echo-task-verify-") as temporary:
            root = Path(temporary)
            for args in [
                ("init", "-q"),
                ("config", "user.email", "fixture@example.com"),
                ("config", "user.name", "Fixture"),
            ]:
                self.assertEqual(self.run_command(root, ["git", *args]).returncode, 0)
            (root / "target.txt").write_text("before\n")
            (root / "unrelated.bin").write_bytes(b"x" * 1024 * 1024)
            self.run_command(root, ["git", "add", "."])
            self.run_command(
                root, ["git", "-c", "commit.gpgsign=false", "commit", "-qm", "source"]
            )
            base = self.run_command(root, ["git", "rev-parse", "HEAD"]).stdout.strip()
            result = self.run_command(
                root,
                [
                    "python3",
                    str(PREFLIGHT),
                    "record",
                    "--root",
                    str(root),
                    "--task-id",
                    "task",
                    "--kind",
                    "bugfix",
                    "--risk",
                    "low",
                    "--allow",
                    "target.txt",
                    "--search",
                    ".",
                    "--reuse-decision",
                    "new",
                    "--reuse",
                    "相关搜索没有匹配能力",
                    "--verify",
                    "定向行为验证",
                    "--reuse-existing-boundary",
                    "现有边界",
                ],
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            (root / "target.txt").write_text("after\n")
            # 无关的失效材料不应进入局部闭包。
            semantic = root / ".echo-semantic/rules"
            semantic.mkdir()
            (semantic / "rule.unrelated.md").write_text("invalid material\n")
            self.run_command(root, ["git", "add", ".echo-semantic/rules"])
            self.run_command(
                root,
                [
                    "git",
                    "-c",
                    "commit.gpgsign=false",
                    "commit",
                    "-qm",
                    "unrelated material",
                ],
            )
            # HEAD 改变必须重新建立任务依据。
            record = json.loads((root / ".echo-semantic/preflight.json").read_text())
            base = self.run_command(root, ["git", "rev-parse", "HEAD"]).stdout.strip()
            record["baseRevision"] = base
            (root / ".echo-semantic/preflight.json").write_text(json.dumps(record))
            command = [
                "uv",
                "run",
                str(VERIFIER),
                "--root",
                str(root),
                "--task-scope",
                "--task-id",
                "task",
                "--base",
                base,
                "--require-change-evidence",
            ]
            result = self.run_command(root, command)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertEqual(report["scope"], "task")
            self.assertEqual(report["globalClosure"], "not_checked")
            self.assertEqual(report["evidencePaths"], ["target.txt"])
            (root / "unexpected.txt").write_text("outside\n")
            result = self.run_command(root, command)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("超出预检允许路径", result.stderr)


HISTORICAL_REFERENCE_FIXTURE = r"""
import hashlib,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('verifier',sys.argv[1])
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
scenario=sys.argv[2]
scope='repository' if scenario.startswith('repository') else 'task'
def git(root,*args):
    result=subprocess.run(['git','-C',str(root),*args],capture_output=True,text=True)
    assert result.returncode==0,result.stderr
    return result.stdout.strip()
def commit(root):
    git(root,'add','-A');git(root,'-c','commit.gpgsign=false','commit','-qm','fixture')
    return git(root,'rev-parse','HEAD')
with tempfile.TemporaryDirectory(prefix='echo-task-history-') as temporary:
    root=Path(temporary)
    git(root,'init','-q');git(root,'config','user.email','fixture@example.com');git(root,'config','user.name','Fixture')
    (root/'target.txt').write_text('fixture before\n')
    old=root/'retired.txt';old.write_text('retired_one\n');first=commit(root)
    old.write_text('retired_two\n');second=commit(root)
    if scenario=='task_current_collision':old.write_text('current_only\n')
    else:old.unlink()
    semantic=root/'.echo-semantic'
    for directory in v.REQUIRED_DIRECTORIES:(semantic/directory).mkdir(parents=True,exist_ok=True)
    (semantic/'README.md').write_text('# 历史引用夹具\n')
    evidence=[]
    grouped=scenario.startswith('task_audit_') or scenario=='task_map_observation'
    for name,revision,anchor in [('one',first,'retired_one'),('two',second,'retired_two')]:
        if scenario=='task_invalid_revision' and name=='one':revision='f'*40
        if scenario=='task_invalid_anchor' and name=='one':anchor='missing_anchor'
        if scenario=='task_current_missing' and name=='one':revision='source:'+'0'*64
        if scenario=='task_consumer_current_missing' and name=='one':revision='source:'+'0'*64
        path=semantic/'assets'/('asset.'+name+'.md')
        refs=[] if grouped else ['retired.txt#'+anchor]
        consumer=scenario.startswith('task_consumer_')
        v.write_document(path,{'schema_version':1,'id':'asset.'+name,'kind':'asset','title':'历史资产','asset_type':'file','status':'deprecated','risk':'low','observed_at':revision,'boundary_refs':[],'code_refs':[] if consumer else refs,'consumer_refs':refs if consumer else [],'behavior_refs':[],'rule_refs':[],'evidence_refs':[],'finding_refs':[]},v.REQUIRED_HEADINGS['asset'])
        evidence.append(path.relative_to(root).as_posix())
    path=semantic/'evidence/evidence.history.md'
    v.write_document(path,{'schema_version':1,'id':'evidence.history','kind':'evidence','observed_at':first,'source_refs':['target.txt#fixture'] if grouped or scenario.startswith('task_consumer_') else ['retired.txt#retired_one'],'supports':[],'limitations':['只证明历史内容']},v.REQUIRED_HEADINGS['evidence'])
    evidence.append(path.relative_to(root).as_posix())
    if grouped:
        map_data={'schema_version':1,'id':'map.history','kind':'capability_map','title':'历史观察范围','risk':'low','observed_at':first,'boundary_refs':['boundary.history'],'behavior_refs':[],'rule_refs':[],'evidence_refs':[],'finding_refs':[],'audit_refs':[],'related_map_refs':[],'scenarios':{}}
        if scenario=='task_map_observation':
            map_data['scenarios']={'historical':{'status':'needs_review','unknown':'只检查历史来源','next_step':'后续人工审查','revision':second,'source_refs':['retired.txt#retired_one']}}
        else:
            challenges={'one':{'revision':first,'source_refs':['retired.txt#retired_one'],'evidence_refs':['evidence.history']},'two':{'source_refs':['retired.txt#retired_two'],'evidence_refs':['evidence.history']}}
            if scenario=='task_audit_nested_revision':
                challenges['one']['details']={'revision':second,'source_refs':['retired.txt#retired_one']}
            if scenario in {'task_audit_null','task_audit_empty'}:
                challenges['one']['revision']=None if scenario=='task_audit_null' else ''
            path=semantic/'audits/audit.history.md'
            v.write_document(path,{'schema_version':1,'id':'audit.history','kind':'audit','boundary_ref':'boundary.history','lens':'state_authority','freshness':'examined','revision':second,'challenges':challenges,'finding_refs':[]},v.REQUIRED_HEADINGS['audit'])
            evidence.append(path.relative_to(root).as_posix())
        path=semantic/'maps/map.history.md'
        v.write_document(path,map_data,v.REQUIRED_HEADINGS['capability_map'])
        evidence.append(path.relative_to(root).as_posix())
    regions=[{'path':'target.txt','status':'supporting'}]
    if old.exists():regions.append({'path':'retired.txt','status':'supporting'})
    v.write_document(semantic/'baseline.md',{'schema_version':1,'id':'baseline.repository','kind':'baseline','source_snapshot':{'base_revision':second,'content_digest':v.source_digest(root)},'inventory_closure':'open','behavior_model_closure':'open','map_refs':[],'regions':regions,'boundaries':[],'coverage':[]},v.REQUIRED_HEADINGS['baseline'])
    base=commit(root)
    command=['python3',str(Path(sys.argv[1]).parents[2]/'semantic-preflight/scripts/preflight.py'),'record','--root',str(root),'--task-id','historical-task','--kind','bugfix','--risk','low','--verification-scope',scope,'--allow','target.txt','--mutable-evidence','target.txt','--search','target.txt','--reuse-decision','extend','--reuse','复用历史引用权威','--candidate',json.dumps({'path':'target.txt','symbol':'fixture','selected':True,'reason':'当前任务来源'}),'--verify','定向测试','--reuse-existing-boundary','历史引用与当前文件身份继续分开']
    if scope=='repository':command+=['--allow','.echo-semantic/baseline.md']
    for item in evidence:command+=['--evidence',item]
    if scenario.startswith('task_hook_'):
        hook=Path(sys.argv[1]).parents[3]/'hooks/entry.mjs'
        def invoke(event,extra=None):
            data={'cwd':str(root),'session_id':'history-hook','source':'startup'};data.update(extra or {})
            return subprocess.run(['node',str(hook),'codex',event],cwd=root,input=json.dumps(data),text=True,capture_output=True)
        started=invoke('session-start');assert started.returncode==0,started.stderr
    recorded=subprocess.run(command,capture_output=True,text=True)
    assert recorded.returncode==0,recorded.stdout+recorded.stderr
    (root/'target.txt').write_text('fixture after\n')
    if scope=='repository':
        baseline=semantic/'baseline.md';data,body=v.parse_document_text(baseline.read_text(),str(baseline),[])
        data['source_snapshot']['content_digest']=v.source_digest(root)
        v.write_document(baseline,data,v.REQUIRED_HEADINGS['baseline'])
    if scenario=='task_unauthorized_delete':
        state_path=semantic/'preflight.json';state=json.loads(state_path.read_text());state['deletePaths']=['retired.txt'];state['repairRefs']=[];state_path.write_text(json.dumps(state))
    errors,report=v.validate_task(root,base,'historical-task',repository_scope=scope=='repository')
    negative={'task_invalid_revision':'f'*40,'task_invalid_anchor':'锚点','task_current_missing':'retired.txt','task_consumer_current_missing':'retired.txt','task_unauthorized_delete':'删除变化','task_audit_null':'revision','task_audit_empty':'revision'}
    if scenario in negative:
        assert errors,(scenario,report)
        assert negative[scenario].lower() in '\n'.join(errors).lower(),errors
    else:
        assert not errors,errors
        assert report['scope']==scope
        assert 'retired.txt' not in report['evidencePaths'],report
        references=report['referenceDigests']
        first_key=json.dumps([first,'retired.txt'],ensure_ascii=False)
        second_key=json.dumps([second,'retired.txt'],ensure_ascii=False)
        if scenario!='task_map_observation':assert references[first_key]!=references[second_key],references
        assert references[first_key]==hashlib.sha256(v.content_at_revision(root,first,'retired.txt')).hexdigest()
        if scenario.startswith('task_hook_'):
            first_stop=invoke('stop');assert first_stop.returncode==0,first_stop.stderr
            replay_stop=invoke('stop');assert replay_stop.returncode==0,replay_stop.stderr
            if scenario=='task_hook_legacy_missing':
                route_path=semantic/'route.json';route=json.loads(route_path.read_text());route['verificationReceipt'].pop('referenceDigests',None);route_path.write_text(json.dumps(route))
            else:git(root,'replace',first,second)
            rejected=invoke('stop');assert rejected.returncode==2,(rejected.stdout,rejected.stderr)
            assert '没有有效 semantic-preflight' in rejected.stderr,rejected.stderr
        if scope=='repository':
            payload=report['taskEvidenceDigests']
            replay_errors,replay=v.repository_receipt_report(root,payload)
            assert not replay_errors,replay_errors
            assert replay['repositoryContentDigest']==report['repositoryContentDigest']
            if scenario=='repository_current_drift':
                (root/'target.txt').write_text('unexpected drift\n')
                try:v.repository_receipt_report(root,payload)
                except (ValueError,RuntimeError) as error:assert '变化' in str(error),str(error)
                else:raise AssertionError('当前任务依据漂移必须拒绝')
            if scenario=='repository_historical_drift':
                git(root,'replace',first,second)
                try:v.repository_receipt_report(root,payload)
                except (ValueError,RuntimeError) as error:assert '历史' in str(error) or '引用' in str(error),str(error)
                else:raise AssertionError('同revision历史blob被替换必须拒绝')
    print(json.dumps({'scenario':scenario,'scope':scope,'errors':errors,'passed':True},ensure_ascii=False))
"""


class TaskHistoricalReferenceTests(unittest.TestCase):
    """真实Git历史与任务收据组合，不能拿当前文件替代已退役引用。"""

    def scenario(self, name):
        result = subprocess.run(
            [
                "uv",
                "run",
                "--with",
                "PyYAML>=6.0,<7",
                "python",
                "-c",
                HISTORICAL_REFERENCE_FIXTURE,
                str(VERIFIER),
                name,
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_task_deleted_historical_refs(self):
        self.scenario("task_deleted")

    def test_repository_deleted_historical_refs_and_replay(self):
        self.scenario("repository_deleted")

    def test_same_path_different_revisions_do_not_borrow_current_content(self):
        self.scenario("task_current_collision")

    def test_invalid_historical_revision_is_rejected(self):
        self.scenario("task_invalid_revision")

    def test_historical_anchor_is_checked_in_its_own_revision(self):
        self.scenario("task_invalid_anchor")

    def test_current_missing_reference_is_not_blanket_ignored(self):
        self.scenario("task_current_missing")

    def test_historical_refs_do_not_grant_delete_authority(self):
        self.scenario("task_unauthorized_delete")

    def test_repository_receipt_rejects_current_file_drift(self):
        self.scenario("repository_current_drift")

    def test_repository_receipt_rejects_historical_blob_drift(self):
        self.scenario("repository_historical_drift")

    def test_task_stop_replay_rejects_historical_blob_drift(self):
        self.scenario("task_hook_replay")

    def test_legacy_task_receipt_without_historical_identity_is_not_reused(self):
        self.scenario("task_hook_legacy_missing")

    def test_historical_consumer_only_refs_produce_revision_digests(self):
        self.scenario("task_consumer_only")

    def test_missing_current_consumer_is_rejected(self):
        self.scenario("task_consumer_current_missing")

    def test_audit_challenge_revisions_and_missing_key_inheritance(self):
        self.scenario("task_audit_grouped")

    def test_nested_audit_metadata_cannot_override_challenge_revision(self):
        self.scenario("task_audit_nested_revision")

    def test_explicit_null_audit_revision_is_rejected(self):
        self.scenario("task_audit_null")

    def test_explicit_empty_audit_revision_is_rejected(self):
        self.scenario("task_audit_empty")

    def test_map_scenario_uses_map_observation(self):
        self.scenario("task_map_observation")
