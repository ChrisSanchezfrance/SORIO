extends Node
## Runner de tests maison (repli valide a la place de GUT).
##
##   godot --headless --path . res://src/tools/run_tests.tscn
##
## Decouvre `res://tests/**/*_test.gd`, instancie chaque classe qui etend
## `TestCase`, execute ses methodes `test_*` et sort en code 1 si un seul cas
## echoue. Aucune dependance externe.

const TESTS_ROOT: String = "res://tests"
const TEST_SUFFIX: String = "_test.gd"
## Un test qui n'assure rien passe "au vert" pour de mauvaises raisons.
const WARN_ON_EMPTY_ASSERTIONS: bool = true

var _total: int = 0
var _passed: int = 0
var _failed: int = 0
var _failure_report: PackedStringArray = PackedStringArray()


func _ready() -> void:
	print("=== Tests SORIO ===")
	var files: PackedStringArray = PackedStringArray()
	_collect(TESTS_ROOT, files)
	files.sort()
	if files.is_empty():
		print("(aucun fichier de test)")
		get_tree().quit(0)
		return
	for path: String in files:
		_run_file(path)
	_report()


func _collect(path: String, out: PackedStringArray) -> void:
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full: String = path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				_collect(full, out)
		elif entry.ends_with(TEST_SUFFIX):
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()


func _run_file(path: String) -> void:
	var script: Resource = ResourceLoader.load(path, "Script", ResourceLoader.CACHE_MODE_IGNORE)
	if script == null:
		_failed += 1
		_failure_report.append("%s : ne compile pas" % path)
		return
	var gd_script: GDScript = script as GDScript
	var probe: Variant = gd_script.new()
	if not (probe is TestCase):
		_failure_report.append("%s : n'etend pas TestCase, ignore" % path)
		return

	var suite_name: String = path.get_file().replace(TEST_SUFFIX, "")
	var methods: Array[String] = _test_methods(gd_script)
	print("- %s (%d cas)" % [suite_name, methods.size()])

	for method: String in methods:
		_run_case(gd_script, suite_name, method)


func _test_methods(gd_script: GDScript) -> Array[String]:
	var names: Array[String] = []
	for entry: Dictionary in gd_script.get_script_method_list():
		var method_name: String = String(entry["name"])
		if method_name.begins_with("test_"):
			names.append(method_name)
	names.sort()
	return names


func _run_case(gd_script: GDScript, suite_name: String, method: String) -> void:
	_total += 1
	# Une instance neuve par cas : aucun test ne peut en polluer un autre.
	var instance: TestCase = gd_script.new() as TestCase
	instance.tree = get_tree()

	instance.before_each()
	instance.call(method)
	instance.after_each()

	if instance.failures.is_empty():
		_passed += 1
		if WARN_ON_EMPTY_ASSERTIONS and instance.assertion_count == 0:
			print("    ~ %s : aucune assertion" % method)
		return

	_failed += 1
	for failure: String in instance.failures:
		_failure_report.append("%s :: %s -> %s" % [suite_name, method, failure])


func _report() -> void:
	print("- total : %d   reussis : %d   echoues : %d" % [_total, _passed, _failed])
	if _failed == 0 and _failure_report.is_empty():
		print("=== OK : tous les tests passent ===")
		get_tree().quit(0)
		return
	printerr("=== %d ECHEC(S) ===" % _failure_report.size())
	for line: String in _failure_report:
		printerr("  * %s" % line)
	get_tree().quit(1)
