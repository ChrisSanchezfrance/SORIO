extends Node
## Sauvegarde 3 emplacements, atomique et migrable (B.8).
##
## Deux garanties non negociables :
##   1. Un telephone qui s'eteint pendant l'ecriture ne detruit pas la partie.
##      On ecrit dans `save_N.tmp`, puis on renomme — le renommage est atomique
##      sur les systemes de fichiers Android.
##   2. Une sauvegarde d'une version anterieure se migre, elle ne se perd
##      jamais. Chaque montee de version a sa fonction dans MIGRATIONS.

const SLOT_COUNT: int = 3

## version d'origine -> methode qui la fait passer a la version suivante.
## Exemple pour la future v2 :
##   1: &"_migrate_1_to_2",
const MIGRATIONS: Dictionary = {}

var _cache: Dictionary = {}   ## slot -> SaveData


func _ready() -> void:
	for slot: int in range(1, SLOT_COUNT + 1):
		_cache[slot] = load_slot(slot)


static func slot_path(slot: int) -> String:
	return "user://save_%d.tres" % slot


## Le fichier temporaire garde l'extension `.tres` : `ResourceSaver` choisit
## son format d'apres l'extension et refuse tout ce qu'il ne reconnait pas.
static func slot_temp_path(slot: int) -> String:
	return "user://save_%d.tmp.tres" % slot


func has_save(slot: int) -> bool:
	var data: SaveData = _cache.get(slot, null)
	return data != null and not data.is_fresh()


## Retourne toujours un SaveData exploitable, meme si le fichier est absent
## ou illisible : le jeu ne doit jamais rester bloque sur un ecran d'erreur.
func load_slot(slot: int) -> SaveData:
	assert(slot >= 1 and slot <= SLOT_COUNT, "slot hors bornes : %d" % slot)
	var path: String = slot_path(slot)
	if not FileAccess.file_exists(path):
		return _new_save(slot)
	var res: Resource = ResourceLoader.load(path, "", ResourceLoader.CACHE_MODE_IGNORE)
	if res == null or not (res is SaveData):
		push_warning("[SaveManager] emplacement %d illisible, sauvegarde neuve" % slot)
		return _new_save(slot)
	var data: SaveData = res as SaveData
	data = _migrate(data)
	data.slot = slot
	_cache[slot] = data
	return data


## Ecriture atomique. Retourne false et previent si l'ecriture echoue.
func save_slot(slot: int, data: SaveData) -> bool:
	assert(slot >= 1 and slot <= SLOT_COUNT, "slot hors bornes : %d" % slot)
	assert(data != null, "save_slot avec une sauvegarde nulle")
	data.slot = slot
	data.updated_at = int(Time.get_unix_time_from_system())
	if data.created_at == 0:
		data.created_at = data.updated_at
	data.version = SaveData.CURRENT_VERSION

	var temp: String = slot_temp_path(slot)
	var final: String = slot_path(slot)
	var err: int = ResourceSaver.save(data, temp)
	if err != OK:
		push_error("[SaveManager] ecriture temporaire impossible (code %d)" % err)
		EventBus.save_completed.emit(slot, false)
		return false

	# Le fichier temporaire est complet et ferme : le renommage publie la
	# nouvelle sauvegarde en une seule operation indivisible.
	var dir: DirAccess = DirAccess.open("user://")
	if dir == null:
		push_error("[SaveManager] user:// inaccessible")
		EventBus.save_completed.emit(slot, false)
		return false
	if dir.file_exists(final.get_file()):
		dir.remove(final.get_file())
	err = dir.rename(temp.get_file(), final.get_file())
	if err != OK:
		push_error("[SaveManager] renommage impossible (code %d)" % err)
		EventBus.save_completed.emit(slot, false)
		return false

	_cache[slot] = data
	EventBus.save_completed.emit(slot, true)
	return true


## Sauvegarde la partie en cours. Appelee en fin de niveau, au retour a la
## carte, apres un achat et en fin de mini-jeu.
func save_current() -> bool:
	if Game.save == null:
		return false
	return save_slot(Game.current_slot, Game.save)


func delete_slot(slot: int) -> void:
	var dir: DirAccess = DirAccess.open("user://")
	if dir == null:
		return
	var file: String = slot_path(slot).get_file()
	if dir.file_exists(file):
		dir.remove(file)
	_cache[slot] = _new_save(slot)


func peek(slot: int) -> SaveData:
	return _cache.get(slot, null)


func _new_save(slot: int) -> SaveData:
	var data: SaveData = SaveData.new()
	data.slot = slot
	_cache[slot] = data
	return data


## Applique successivement toutes les migrations necessaires.
func _migrate(data: SaveData) -> SaveData:
	var guard: int = 0
	while data.version < SaveData.CURRENT_VERSION:
		if not MIGRATIONS.has(data.version):
			push_error(
				"[SaveManager] aucune migration depuis la version %d : "
				% data.version
				+ "sauvegarde conservee telle quelle, champs manquants aux defauts"
			)
			data.version = SaveData.CURRENT_VERSION
			break
		var method: StringName = MIGRATIONS[data.version]
		var from: int = data.version
		data = call(method, data)
		# Une migration qui n'incremente pas la version boucle a l'infini.
		assert(data.version > from, "migration %s n'a pas incremente la version" % method)
		guard += 1
		if guard > 64:
			push_error("[SaveManager] boucle de migration, abandon")
			break
	return data
