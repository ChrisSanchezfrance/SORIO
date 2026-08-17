extends Node
## Options du joueur, persistees dans `user://settings.cfg` (C.7).
##
## Toute option est appliquee immediatement, sans redemarrage. Ecrire une
## option passe toujours par `set_option()` : c'est le seul endroit qui
## sauvegarde, applique et previent le reste du jeu.

const CONFIG_PATH: String = "user://settings.cfg"

## Valeurs par defaut, section par section. Sert aussi de schema : une cle
## absente d'ici est refusee, ce qui evite les fautes de frappe silencieuses.
const DEFAULTS: Dictionary = {
	"audio": {
		"music": 80,
		"sfx": 90,
		"voice": 90,
		"mute_all": false,
	},
	"controls": {
		"scheme": "stick",          # "stick" ou "dpad"
		"button_scale": 1.0,        # 0.85 / 1.0 / 1.25 / 1.5
		"left_handed": false,       # C.9 : miroir complet de l'interface
		"dead_zone": 0.2,
		"dynamic_stick": true,      # le stick apparait sous le pouce
		"vibration": true,
		"swipe_jump": false,        # controles simplifies
	},
	"display": {
		"quality_tier": 0,          # 0 = auto, sinon 1 / 2 / 3
		"target_fps": 60,
		"screen_shake": true,
		"flashes": true,
		"particles": 1,             # 0 peu / 1 normal / 2 beaucoup
	},
	"accessibility": {
		"colorblind_mode": "none",  # none / protanopia / deuteranopia / tritanopia
		"high_contrast": false,
		"text_size": 1,             # 0 petit / 1 moyen / 2 grand
		"subtitles": true,
		"assist_mode": false,       # C.10
		"tutorial_enabled": true,
	},
	"language": {
		"locale": "fr",
	},
}

## Bornes de validation : cle -> [minimum, maximum]. Les booleens et les
## chaines a choix restreint sont valides par `_ALLOWED`.
const _RANGES: Dictionary = {
	"audio/music": [0, 100],
	"audio/sfx": [0, 100],
	"audio/voice": [0, 100],
	"controls/button_scale": [0.85, 1.5],
	"controls/dead_zone": [0.05, 0.5],
	"display/quality_tier": [0, 3],
	"display/particles": [0, 2],
	"accessibility/text_size": [0, 2],
}

const _ALLOWED: Dictionary = {
	"controls/scheme": ["stick", "dpad"],
	"display/target_fps": [30, 60],
	"accessibility/colorblind_mode": ["none", "protanopia", "deuteranopia", "tritanopia"],
	"language/locale": ["fr", "en"],
}

var _values: Dictionary = {}
var _config: ConfigFile = ConfigFile.new()


func _ready() -> void:
	_load()
	apply_all()


## Lecture typee. `section` et `key` doivent exister dans DEFAULTS.
func get_option(section: StringName, key: StringName) -> Variant:
	var path: String = "%s/%s" % [section, key]
	assert(_values.has(path), "Option inconnue : %s" % path)
	return _values.get(path, null)


func get_bool(section: StringName, key: StringName) -> bool:
	return bool(get_option(section, key))


func get_int_option(section: StringName, key: StringName) -> int:
	return int(get_option(section, key))


func get_float_option(section: StringName, key: StringName) -> float:
	return float(get_option(section, key))


func get_string(section: StringName, key: StringName) -> String:
	return String(get_option(section, key))


## Ecriture : valide, applique, sauvegarde et previent via EventBus.
func set_option(section: StringName, key: StringName, value: Variant) -> void:
	var path: String = "%s/%s" % [section, key]
	assert(_values.has(path), "Option inconnue : %s" % path)
	if not _values.has(path):
		return
	var clean: Variant = _sanitize(path, value)
	if _values[path] == clean:
		return
	_values[path] = clean
	_config.set_value(String(section), String(key), clean)
	_save()
	_apply_one(section, key)
	EventBus.settings_changed.emit(section, key)


## Remet toutes les options a leur valeur d'usine.
func reset_to_defaults() -> void:
	_values.clear()
	_config.clear()
	_fill_defaults()
	_save()
	apply_all()


func _fill_defaults() -> void:
	for section: String in DEFAULTS:
		var entries: Dictionary = DEFAULTS[section]
		for key: String in entries:
			_values["%s/%s" % [section, key]] = entries[key]


func _load() -> void:
	_fill_defaults()
	var err: int = _config.load(CONFIG_PATH)
	if err != OK:
		# Premier lancement : on ecrit le fichier tel quel.
		_save()
		return
	for section: String in DEFAULTS:
		var entries: Dictionary = DEFAULTS[section]
		for key: String in entries:
			if not _config.has_section_key(section, key):
				continue
			var path: String = "%s/%s" % [section, key]
			var stored: Variant = _config.get_value(section, key, entries[key])
			# Un fichier corrompu ou edite a la main ne doit jamais casser le jeu :
			# une valeur du mauvais type retombe sur la valeur par defaut.
			if typeof(stored) != typeof(entries[key]):
				stored = entries[key]
			_values[path] = _sanitize(path, stored)


func _save() -> void:
	for section: String in DEFAULTS:
		var entries: Dictionary = DEFAULTS[section]
		for key: String in entries:
			_config.set_value(section, key, _values["%s/%s" % [section, key]])
	var err: int = _config.save(CONFIG_PATH)
	if err != OK:
		push_warning("Impossible d'ecrire %s (code %d)" % [CONFIG_PATH, err])


## Ramene une valeur dans son domaine autorise.
func _sanitize(path: String, value: Variant) -> Variant:
	if _RANGES.has(path):
		var bounds: Array = _RANGES[path]
		if typeof(value) == TYPE_FLOAT:
			return clampf(float(value), float(bounds[0]), float(bounds[1]))
		return clampi(int(value), int(bounds[0]), int(bounds[1]))
	if _ALLOWED.has(path):
		var allowed: Array = _ALLOWED[path]
		if not allowed.has(value):
			return allowed[0]
	return value


## Applique la totalite des options a l'etat courant du moteur.
func apply_all() -> void:
	for section: String in DEFAULTS:
		var entries: Dictionary = DEFAULTS[section]
		for key: String in entries:
			_apply_one(StringName(section), StringName(key))


func _apply_one(section: StringName, key: StringName) -> void:
	match "%s/%s" % [section, key]:
		"language/locale":
			TranslationServer.set_locale(get_string(&"language", &"locale"))
		"display/target_fps":
			Engine.max_fps = get_int_option(&"display", &"target_fps")
		"audio/music", "audio/sfx", "audio/voice", "audio/mute_all":
			# AudioManager peut ne pas etre pret pendant le tout premier _ready().
			if is_instance_valid(AudioManager) and AudioManager.has_method(&"apply_volumes"):
				AudioManager.apply_volumes()
		"display/quality_tier":
			if is_instance_valid(Perf) and Perf.has_method(&"apply_user_tier"):
				Perf.apply_user_tier(get_int_option(&"display", &"quality_tier"))
		_:
			pass
