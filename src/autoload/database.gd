extends Node
## Index de tout le contenu du jeu (B.3).
##
## Charge tous les `.tres` de `res://resources/` au demarrage et les indexe par
## leur `id`. Le reste du jeu n'ecrit jamais `load("res://resources/...")` :
## il ecrit `Database.power(&"eclair")`.
##
## Regle D.2.10 : un `id` en double est une erreur bloquante, detectee au
## demarrage et non trois heures plus tard dans un niveau.

## Dossier scanne -> nom de la categorie interne.
const CATEGORIES: Dictionary = {
	"powers": "res://resources/powers",
	"enemies": "res://resources/enemies",
	"bosses": "res://resources/bosses",
	"worlds": "res://resources/worlds",
	"items": "res://resources/items",
	"minigames": "res://resources/minigames",
	"runner_segments": "res://resources/runner_segments",
}

## categorie -> { id: Resource }
var _index: Dictionary = {}
## Erreurs rencontrees au chargement, lues par validate_project.gd.
var load_errors: PackedStringArray = PackedStringArray()

var _loaded: bool = false


func _ready() -> void:
	load_all()


## (Re)construit l'index complet. Idempotent : appelable depuis les outils.
func load_all() -> void:
	_index.clear()
	load_errors.clear()
	for category: String in CATEGORIES:
		_index[category] = {}
		_scan_directory(category, String(CATEGORIES[category]))
	_loaded = true
	if not load_errors.is_empty():
		for message: String in load_errors:
			push_error("[Database] %s" % message)


func _scan_directory(category: String, path: String) -> void:
	if not DirAccess.dir_exists_absolute(path):
		# Un dossier absent n'est pas une erreur : le contenu arrive passe
		# apres passe. Un dossier present mais illisible en est une.
		return
	var dir: DirAccess = DirAccess.open(path)
	if dir == null:
		load_errors.append("dossier illisible : %s" % path)
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var full: String = path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				_scan_directory(category, full)
		elif _is_resource_file(entry):
			# `.remap` marque une ressource deplacee par l'export : le chemin
			# a charger est celui SANS le suffixe.
			_register(category, full.trim_suffix(".remap"))
		entry = dir.get_next()
	dir.list_dir_end()


## Reconnait une ressource, quel que soit son etat apres export.
##
## PIEGE MAJEUR : a l'export, Godot convertit les ressources texte en binaire
## et les renomme en `.res`, parfois accompagnees d'un `.remap`. Une
## recherche limitee a `.tres` trouvait donc 36 pouvoirs en developpement et
## ZERO dans le jeu livre — un cadeau ouvert ne donnait rien, et rien ne le
## signalait. Le bug n'existait que dans le build.
static func _is_resource_file(entry: String) -> bool:
	return entry.ends_with(".tres") \
		or entry.ends_with(".res") \
		or entry.ends_with(".tres.remap") \
		or entry.ends_with(".res.remap")


func _register(category: String, path: String) -> void:
	var res: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_REUSE)
	if res == null:
		load_errors.append("chargement impossible : %s" % path)
		return
	var raw_id: Variant = res.get(&"id")
	if raw_id == null:
		load_errors.append("ressource sans champ `id` : %s" % path)
		return
	var id: StringName = StringName(raw_id)
	if String(id).is_empty():
		load_errors.append("`id` vide : %s" % path)
		return
	var bucket: Dictionary = _index[category]
	if bucket.has(id):
		load_errors.append(
			"id en double `%s` dans %s : %s et %s"
			% [id, category, bucket[id].resource_path, path]
		)
		return
	bucket[id] = res


# --- Acces typiques ---------------------------------------------------------

func power(id: StringName) -> Resource:
	return _fetch("powers", id)


func enemy(id: StringName) -> Resource:
	return _fetch("enemies", id)


func boss(id: StringName) -> Resource:
	return _fetch("bosses", id)


func world(id: StringName) -> Resource:
	return _fetch("worlds", id)


func item(id: StringName) -> Resource:
	return _fetch("items", id)


func minigame(id: StringName) -> Resource:
	return _fetch("minigames", id)


func runner_segment(id: StringName) -> Resource:
	return _fetch("runner_segments", id)


func _fetch(category: String, id: StringName) -> Resource:
	assert(_loaded, "Database interrogee avant load_all()")
	var bucket: Dictionary = _index.get(category, {})
	if not bucket.has(id):
		push_error("[Database] %s introuvable dans %s" % [id, category])
		return null
	return bucket[id]


# --- Parcours ---------------------------------------------------------------

## Toutes les ressources d'une categorie, ordre non garanti.
func all(category: String) -> Array[Resource]:
	var out: Array[Resource] = []
	var bucket: Dictionary = _index.get(category, {})
	for id: StringName in bucket:
		out.append(bucket[id])
	return out


## Tous les identifiants d'une categorie, tries pour un affichage stable.
func ids(category: String) -> Array[StringName]:
	var out: Array[StringName] = []
	var bucket: Dictionary = _index.get(category, {})
	for id: StringName in bucket:
		out.append(id)
	out.sort()
	return out


func count(category: String) -> int:
	return (_index.get(category, {}) as Dictionary).size()


func has(category: String, id: StringName) -> bool:
	return (_index.get(category, {}) as Dictionary).has(id)


## Resume lisible, affiche par validate_project.gd.
func summary() -> String:
	var parts: PackedStringArray = PackedStringArray()
	for category: String in CATEGORIES:
		parts.append("%s=%d" % [category, count(category)])
	return "  ".join(parts)
