#!/usr/bin/env python3
"""BHA-CI-FAST-001: run the backend integration tests in several CI jobs, and prove that nothing was lost.

  filter <index>   the `dotnet test --filter` expression of shard <index> (1-based), from integration-shards.json
  verify           the gate behind the required "Backend" check
  selftest         asserts the logic of the two above (run by the gate before it trusts itself)

Shards 1..len(shards) run the classes named in the config; the last shard runs every class that is NOT named, so a new
test class is never skipped. The gate does not trust that: it compares what the shards actually ran (their TRX files)
with the unfiltered `dotnet test --list-tests` of each test project, name by name, as a multiset.
"""
import argparse
import collections
import json
import pathlib
import sys
import tempfile
import xml.etree.ElementTree as ET

CONFIG = pathlib.Path(__file__).with_name("integration-shards.json")
TRX = {"t": "http://microsoft.com/schemas/VisualStudio/TeamTest/2010"}


def load_config(path=CONFIG):
    config = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    named = [c for shard in config["shards"] for c in shard]
    duplicated = sorted(c for c, n in collections.Counter(named).items() if n > 1)
    if duplicated:
        raise SystemExit(f"integration-shards.json names a class in two shards: {', '.join(duplicated)}")
    return config


def shard_count(config):
    return len(config["shards"]) + 1


def vstest_filter(config, index):
    """Contains-match on 'Namespace.Class.' (the trailing dot keeps 'BlogMedia' from also catching 'BlogMediaMigrationTests')."""
    prefix = config["namespace"] + "."
    if not 1 <= index <= shard_count(config):
        raise SystemExit(f"shard {index} does not exist (1..{shard_count(config)})")
    if index <= len(config["shards"]):
        return "|".join(f"FullyQualifiedName~{prefix}{c}." for c in config["shards"][index - 1])
    return "&".join(f"FullyQualifiedName!~{prefix}{c}." for shard in config["shards"] for c in shard)


def listed(path):
    """The names `dotnet test --list-tests` prints, one per line indented by four spaces (a theory case is one name per data row)."""
    with open(path, encoding="utf-8") as handle:
        return collections.Counter(line.strip() for line in handle if line.startswith("    ") and line.strip())


def trx_results(path):
    root = ET.parse(path).getroot()
    results = [(r.get("testName"), r.get("outcome")) for r in root.iterfind(".//t:UnitTestResult", TRX)]
    counters = root.find(".//t:ResultSummary/t:Counters", TRX)
    return results, (counters.attrib if counters is not None else {})


def describe(names, limit=3):
    shown = ", ".join(sorted(names)[:limit])
    return f"{len(names)} ({shown}{', ...' if len(names) > limit else ''})"


def check_trx(path, label, problems):
    """Every result of one TRX file; returns the Counter of the names that ran."""
    if not path.is_file():
        problems.append(f"{label}: result file {path.name} is missing")
        return collections.Counter()
    results, counters = trx_results(path)
    if not results:
        problems.append(f"{label}: {path.name} holds no test results")
    bad = [name for name, outcome in results if outcome != "Passed"]
    if bad:
        problems.append(f"{label}: {describe(bad)} did not pass")
    if counters.get("notExecuted", "0") != "0" or counters.get("executed") != counters.get("total"):
        problems.append(f"{label}: tests were not executed (total={counters.get('total')}, executed={counters.get('executed')}, notExecuted={counters.get('notExecuted')})")
    return collections.Counter(name for name, _ in results)


def compare(expected, ran, label, problems):
    missing, extra = expected - ran, ran - expected
    if missing:
        problems.append(f"{label}: {describe(missing)} listed by the build but never run")
    if extra:
        problems.append(f"{label}: {describe(extra)} ran more often than the build lists them (a test in two shards, or a name not in the list)")


def verify(artifacts, shards, needs, config=None):
    """Returns (problems, summary lines). Any problem fails the gate."""
    problems, summary = [], []
    artifacts = pathlib.Path(artifacts)
    config = config or load_config()
    if shards != shard_count(config):
        problems.append(f"the workflow runs {shards} shards but integration-shards.json defines {shard_count(config)}")

    for job, info in sorted(needs.items()):
        if info.get("result") != "success":
            problems.append(f"job '{job}' finished as '{info.get('result')}' (only 'success' passes: a skipped or cancelled job is not a pass)")

    lists, ran_total = [], collections.Counter()
    for shard in range(1, shards + 1):
        label = f"integration shard {shard}"
        list_file = artifacts / f"list-integration-{shard}.txt"
        if list_file.is_file():
            lists.append(listed(list_file))
        else:
            problems.append(f"{label}: {list_file.name} is missing")
        ran = check_trx(artifacts / f"integration-{shard}.trx", label, problems)
        ran_total.update(ran)
        summary.append(f"{label}: {sum(ran.values())} tests ran")
    if lists:
        if any(other != lists[0] for other in lists[1:]):
            problems.append("the shards built different sets of tests (their --list-tests outputs differ)")
        compare(lists[0], ran_total, "integration tests", problems)
        summary.append(f"integration: {sum(lists[0].values())} listed, {sum(ran_total.values())} ran")

    unit_list = artifacts / "list-unit.txt"
    if unit_list.is_file():
        unit_ran = check_trx(artifacts / "unit.trx", "unit tests", problems)
        compare(listed(unit_list), unit_ran, "unit tests", problems)
        summary.append(f"unit: {sum(listed(unit_list).values())} listed, {sum(unit_ran.values())} ran")
    else:
        problems.append("unit tests: list-unit.txt is missing")

    named = {c for shard in config["shards"] for c in shard}
    if lists:
        known = {name.split("(", 1)[0].rsplit(".", 1)[0].removeprefix(config["namespace"] + ".") for name in lists[0]}
        stale = sorted(named - known)
        if stale:
            summary.append(f"note: integration-shards.json names classes that no longer exist: {', '.join(stale)}")
    return problems, summary


def run_verify(args):
    needs = json.loads(args.needs_json)
    problems, summary = verify(args.artifacts, args.shards, needs)
    print("\n".join(summary))
    if problems:
        print("\nBACKEND GATE FAILED:")
        print("\n".join(f" - {p}" for p in problems))
        return 1
    print("\nBackend gate: every listed test ran exactly once and passed.")
    return 0


# --- self-test -----------------------------------------------------------------------------------------------------

def _matches(expression, name):
    """Just enough of the VSTest filter to evaluate the two forms vstest_filter writes."""
    if "&" in expression:
        return all(part.split("!~", 1)[1] not in name for part in expression.split("&"))
    return any(part.split("~", 1)[1] in name for part in expression.split("|"))


def _write_trx(path, names, outcome="Passed", not_executed=0):
    results = "".join(f'<UnitTestResult testName="{n.replace(chr(34), "&quot;")}" outcome="{outcome}"/>' for n in names)
    counters = f'<Counters total="{len(names)}" executed="{len(names) - not_executed}" notExecuted="{not_executed}"/>'
    path.write_text(f'<TestRun xmlns="{TRX["t"]}"><Results>{results}</Results><ResultSummary>{counters}</ResultSummary></TestRun>', encoding="utf-8")


def _write_list(path, names):
    path.write_text("The following Tests are available:\n" + "".join(f"    {n}\n" for n in names), encoding="utf-8")


def selftest():
    ns = "TheBha.IntegrationTests"
    config = {"namespace": ns, "shards": [["A", "B"], ["C"]]}
    assert shard_count(config) == 3
    names = [f"{ns}.{c}.{m}" for c in ("A", "B", "C", "D", "E", "BMigration") for m in ("one", "two")]
    names += [f'{ns}.A.theory(origin: "https://x.example?y=z", n: 1)', f'{ns}.A.theory(origin: "https://x.example?y=z", n: 1)']  # a duplicated theory row
    # every test lands in exactly one shard, and a class that is a prefix of another is not confused with it
    for name in names:
        assert sum(_matches(vstest_filter(config, i), name) for i in (1, 2, 3)) == 1, name
    assert _matches(vstest_filter(config, 3), f"{ns}.BMigration.one") and not _matches(vstest_filter(config, 1), f"{ns}.BMigration.one")
    assert _matches(vstest_filter(config, 3), f"{ns}.NewClass.fresh"), "a class nobody named runs in the last shard"
    try:
        load_config_from = pathlib.Path(tempfile.mkdtemp()) / "c.json"
        load_config_from.write_text(json.dumps({"namespace": ns, "shards": [["A"], ["A"]]}), encoding="utf-8")
        load_config(load_config_from)
        raise AssertionError("a class named in two shards must be refused")
    except SystemExit:
        pass

    split = {1: names[0:6], 2: names[6:10], 3: names[10:]}
    unit = ["U.one", "U.two"]
    ok_needs = {"backend-tests": {"result": "success"}}

    def scenario(change=None, needs=ok_needs, shards=3):
        with tempfile.TemporaryDirectory() as folder:
            d = pathlib.Path(folder)
            for i in (1, 2, 3):
                _write_list(d / f"list-integration-{i}.txt", names)
                _write_trx(d / f"integration-{i}.trx", split[i])
            _write_list(d / "list-unit.txt", unit)
            _write_trx(d / "unit.trx", unit)
            if change:
                change(d)
            return verify(d, shards, needs, config)[0]

    assert scenario() == [], "all shards pass"
    assert scenario(needs={"backend-tests": {"result": "failure"}}), "a failed job"
    assert scenario(needs={"backend-tests": {"result": "cancelled"}}), "a cancelled job"
    assert scenario(needs={"backend-tests": {"result": "skipped"}}), "a skipped job"
    assert scenario(lambda d: (d / "integration-2.trx").unlink()), "a shard's result file is missing"
    assert scenario(lambda d: (d / "list-integration-3.txt").unlink()), "a shard's test list is missing"
    assert scenario(lambda d: _write_trx(d / "integration-1.trx", split[1], outcome="Failed")), "a failing test"
    assert scenario(lambda d: _write_trx(d / "integration-1.trx", split[1], not_executed=1)), "a test that did not execute"
    assert scenario(lambda d: _write_trx(d / "integration-2.trx", split[2][:-1])), "a test is missing from the results"
    assert scenario(lambda d: _write_trx(d / "integration-2.trx", split[2] + [names[0]])), "a test ran in two shards"
    assert scenario(lambda d: _write_list(d / "list-integration-2.txt", names[:-1])), "shards built different test sets"
    assert scenario(lambda d: (d / "unit.trx").unlink()), "the unit results are missing"
    assert scenario(lambda d: _write_trx(d / "unit.trx", unit[:1])), "a unit test is missing"
    assert scenario(shards=4), "the workflow and the config disagree on the shard count"
    print("selftest: ok")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("selftest")
    flt = commands.add_parser("filter")
    flt.add_argument("index", type=int)
    gate = commands.add_parser("verify")
    gate.add_argument("--artifacts", required=True)
    gate.add_argument("--shards", type=int, required=True)
    gate.add_argument("--needs-json", required=True, help="the workflow's toJSON(needs)")
    args = parser.parse_args()
    if args.command == "selftest":
        selftest()
    elif args.command == "filter":
        print(vstest_filter(load_config(), args.index))
    else:
        sys.exit(run_verify(args))


if __name__ == "__main__":
    main()
