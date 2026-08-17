extends Node
## Validation headless du projet (D.3).
##
##   godot --headless --path . res://src/tools/validate_project.tscn
##
## Charge TOUTES les scenes, ressources et scripts du projet et sort en code 1
## a la moindre erreur. Regle D.2.9 : aucun `.tscn` n'est livre sans etre passe
## par ici.
##
## NOTE D'ARCHITECTURE : cet outil est une SCENE et non un script `--script`.
## Godot ne cree pas les autoloads quand on lance `--script`, or la moitie du
## projet reference `EventBus` ou `Settings` : valider sans autoloads ferait
## echouer tous les fichiers pour une mauvaise raison. Tous les outils de
## `src/tools/` suivent donc la meme forme.

## Dossiers parcourus recursivement.
const SCAN_ROOTS: Array[String] = [
	"res://src",
	"res://resources",
	"res://assets",
	"res://tests",
]

## Les 9 autoloads de B.3.
const REQUIRED_AUTOLOADS: Array[String] = [
	"EventBus", "Settings", "Database", "SaveManager",
	"Game", "AudioManager", "Haptics", "Perf", "Transition",
]

var _errors: PackedStringArray = PackedStringArray()
var _scene_count: int = 0
var _resource_count: int = 0
var _script_count: int = 0


func _ready() -> void:
	print("=== Validation du projet SORIO ===")
	_check_autoloads()
	_check_collision_layers()
	for path: String in SCAN_ROOTS:
		_scan(path)
	_check_database()
	_check_levels()
	_report()


func _check_autoloads() -> void:
	var present: int = 0
	for autoload_name: String in REQUIRED_AUTOLOADS:
		if get_tree().root.has_node(NodePath(autoload_name)):
			present += 1
		else:
			_errors.append("autoload manquant : %s" % autoload_name)
	print("- autoloads : %d/%d" % [present, REQUIRED_AUTOLOADS.size()])


func _check_collision_layers() -> void:
	# Empeche project.godot et CollisionLayers de diverger en silence.
	for bit: int in CollisionLayers.NAMES:
		var index: int = int(round(log(float(bit)) / log(2.0))) + 1
		var declared: String = String(ProjectSettings.get_setting(
			"layer_names/2d_physics/layer_%d" % index, ""
		))
		var expected: String = String(CollisionLayers.NAMES[bit])
		if declared != expected:
			_errors.append(
				"couche %d : project.godot dit '%s', CollisionLayers dit '%s'"
				% [index, declared, expected]
			)
	print("- couches de physique : %d verifiees" % CollisionLayers.NAMES.size())


func _scan(path: String) -> void:
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full: String = path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				_scan(full)
		else:
			_check_file(full, entry)
		entry = dir.get_next()
	dir.list_dir_end()


func _check_file(full: String, entry: String) -> void:
	if entry.ends_with(".tscn"):
		_check_scene(full)
	elif entry.ends_with(".tres"):
		_resource_count += 1
		if ResourceLoader.load(full, "", ResourceLoader.CACHE_MODE_REUSE) == null:
			_errors.append("ressource illisible : %s" % full)
	elif entry.ends_with(".gd"):
		_script_count += 1
		var script: Resource = ResourceLoader.load(full, "Script", ResourceLoader.CACHE_MODE_REUSE)
		if script == null:
			_errors.append("script qui ne compile pas : %s" % full)


func _check_scene(full: String) -> void:
	_scene_count += 1
	var packed: Resource = ResourceLoader.load(full, "PackedScene", ResourceLoader.CACHE_MODE_REUSE)
	if packed == null:
		_errors.append("scene illisible : %s" % full)
		return
	# Charger ne suffit pas : une scene peut charger puis exploser a
	# l'instanciation (script absent, propriete inconnue, @onready manquant).
	var instance: Node = (packed as PackedScene).instantiate()
	if instance == null:
		_errors.append("scene non instanciable : %s" % full)
		return
	instance.free()


func _check_database() -> void:
	if not get_tree().root.has_node(^"Database"):
		return
	Database.load_all()
	for message: String in Database.load_errors:
		_errors.append("Database : %s" % message)
	print("- contenu : %s" % Database.summary())


## Chaque fichier de niveau doit s'analyser sans erreur — depart, drapeau,
## caracteres connus. C'est ce controle qui manquait quand les niveaux se
## sont retrouves absents du build : rien ne le signalait.
func _check_levels() -> void:
	var files: PackedStringArray = PackedStringArray()
	_collect_levels("res://levels", files)
	files.sort()
	for path: String in files:
		var parsed: LevelBuilder.Result = LevelBuilder.parse(path)
		if parsed.grid.is_empty():
			_errors.append("niveau vide ou illisible : %s" % path)
			continue
		LevelBuilder._scan_cells(parsed)
		for message: String in parsed.errors:
			_errors.append("%s : %s" % [path.get_file(), message])
		_check_gaps(path, parsed)
	print("- niveaux : %d verifies" % files.size())


## Regle 5 de B.6, appliquee a TOUS les niveaux.
##
## Cette verification n'existait que dans le niveau de test : les vrais
## niveaux, tapes a la main, comportaient des trous de 5 et 7 tuiles pour
## une portee de 4,7 — infranchissables. Elle vit ici desormais, donc aucun
## niveau ne peut plus etre livre injouable.
const MAX_GAP_RATIO: float = 0.70

func _check_gaps(path: String, parsed: LevelBuilder.Result) -> void:
	var config: PlayerConfig = load(Player.DEFAULT_CONFIG_PATH) as PlayerConfig
	if config == null or parsed.grid.is_empty():
		return
	var budget: float = config.max_jump_distance_tiles() * MAX_GAP_RATIO

	# Ce qui compte, c'est le GOUFFRE : une colonne ou il n'y a rien, nulle
	# part, sur toute la hauteur. Un ecart entre deux plateformes flottantes
	# n'est pas un danger — on retombe simplement au sol entre les deux.
	var width: int = 0
	for line: String in parsed.grid:
		width = maxi(width, line.length())

	var run: int = 0
	var seen_ground: bool = false
	for column: int in range(width + 1):
		var has_floor: bool = column < width and _column_has_floor(parsed, column)
		if has_floor:
			if seen_ground and float(run) > budget:
				_errors.append(
					"%s : gouffre de %d tuiles a la colonne %d, maximum %.1f"
					% [path.get_file(), run, column - run, budget]
				)
			seen_ground = true
			run = 0
		elif seen_ground:
			run += 1


static func _column_has_floor(parsed: LevelBuilder.Result, column: int) -> bool:
	for line: String in parsed.grid:
		if column < line.length() and (line[column] == "#" or line[column] == "="):
			return true
	return false


func _collect_levels(path: String, out: PackedStringArray) -> void:
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full: String = path.path_join(entry)
		if dir.current_is_dir():
			_collect_levels(full, out)
		elif entry.ends_with(".txt"):
			out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()


func _report() -> void:
	print("- scenes : %d   ressources : %d   scripts : %d"
		% [_scene_count, _resource_count, _script_count])
	if _errors.is_empty():
		print("=== OK : aucune erreur ===")
		get_tree().quit(0)
		return
	printerr("=== %d ERREUR(S) ===" % _errors.size())
	for message: String in _errors:
		printerr("  * %s" % message)
	get_tree().quit(1)
