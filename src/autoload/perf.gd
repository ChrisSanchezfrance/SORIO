extends Node
## Paliers de qualite automatiques (B.11).
##
## Regle de conception : on descend vite, on ne remonte jamais tout seul
## pendant un niveau. Les allers-retours de qualite sont plus desagreables
## qu'un palier bas assume.

enum Tier { LOW = 1, MEDIUM = 2, HIGH = 3 }

## Palier -> reglages appliques.
const TIER_SETTINGS: Dictionary = {
	Tier.LOW: {
		"particle_ratio": 0.25,
		"parallax_layers": 2,
		"lights_2d": false,
		"render_scale": 0.75,
		"target_fps": 30,
	},
	Tier.MEDIUM: {
		"particle_ratio": 0.5,
		"parallax_layers": 3,
		"lights_2d": false,
		"render_scale": 1.0,
		"target_fps": 60,
	},
	Tier.HIGH: {
		"particle_ratio": 1.0,
		"parallax_layers": 4,
		"lights_2d": true,
		"render_scale": 1.0,
		"target_fps": 60,
	},
}

## Mesure initiale sur les 5 premieres secondes de jeu reel (B.11).
const WARMUP_SECONDS: float = 5.0
## On descend d'un palier si le fps reste sous ce seuil pendant DROP_DELAY.
const LOW_FPS_THRESHOLD: float = 50.0
const DROP_DELAY: float = 3.0

var current_tier: Tier = Tier.HIGH
## true quand le joueur a force un palier dans les options : on ne touche plus a rien.
var is_forced: bool = false

var _sampling: bool = false
var _warmup_left: float = 0.0
var _low_fps_timer: float = 0.0
var _frame_accumulator: float = 0.0
var _frame_count: int = 0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	set_process(false)
	apply_user_tier(Settings.get_int_option(&"display", &"quality_tier"))


## 0 = automatique, 1/2/3 = palier force par le joueur (C.7 Affichage).
func apply_user_tier(value: int) -> void:
	if value == 0:
		is_forced = false
		_apply(current_tier)
		return
	is_forced = true
	set_process(false)
	_apply(value as Tier)


## Demarre la mesure. Appelee a l'entree d'un niveau, pas dans les menus :
## un menu ne represente pas la charge reelle du jeu.
func begin_sampling() -> void:
	if is_forced:
		return
	_sampling = true
	_warmup_left = WARMUP_SECONDS
	_low_fps_timer = 0.0
	_frame_accumulator = 0.0
	_frame_count = 0
	set_process(true)


func end_sampling() -> void:
	_sampling = false
	set_process(false)


func _process(delta: float) -> void:
	if not _sampling or is_forced:
		return
	var fps: float = Engine.get_frames_per_second()
	_frame_accumulator += fps
	_frame_count += 1

	if _warmup_left > 0.0:
		_warmup_left -= delta
		if _warmup_left <= 0.0:
			_settle_initial_tier()
		return

	# Surveillance continue : trois secondes sous le seuil font descendre.
	if fps < LOW_FPS_THRESHOLD:
		_low_fps_timer += delta
		if _low_fps_timer >= DROP_DELAY:
			_low_fps_timer = 0.0
			drop_one_tier()
	else:
		_low_fps_timer = 0.0


func _settle_initial_tier() -> void:
	if _frame_count == 0:
		return
	var average: float = _frame_accumulator / float(_frame_count)
	var chosen: Tier = Tier.HIGH
	if average < 35.0:
		chosen = Tier.LOW
	elif average < LOW_FPS_THRESHOLD:
		chosen = Tier.MEDIUM
	if chosen != current_tier:
		_apply(chosen)


func drop_one_tier() -> void:
	if current_tier <= Tier.LOW:
		return
	_apply((current_tier - 1) as Tier)


func _apply(tier: Tier) -> void:
	current_tier = tier
	var config: Dictionary = TIER_SETTINGS[tier]
	Engine.max_fps = int(config["target_fps"])
	var scale: float = float(config["render_scale"])
	# Le rendu 2D en gl_compatibility se met a l'echelle par le viewport racine.
	var window: Window = get_window()
	if window != null and scale < 1.0:
		window.scaling_3d_scale = scale
	EventBus.quality_tier_changed.emit(int(tier))


# --- Lecture par les systemes de rendu --------------------------------------

func particle_ratio() -> float:
	var base: float = float(TIER_SETTINGS[current_tier]["particle_ratio"])
	# Le reglage utilisateur "particules" module encore le palier (C.7).
	match Settings.get_int_option(&"display", &"particles"):
		0:
			return base * 0.5
		2:
			return minf(1.0, base * 1.5)
		_:
			return base


func parallax_layers() -> int:
	return int(TIER_SETTINGS[current_tier]["parallax_layers"])


func lights_enabled() -> bool:
	return bool(TIER_SETTINGS[current_tier]["lights_2d"])


func tier_name() -> String:
	match current_tier:
		Tier.LOW:
			return "1 - Bas"
		Tier.MEDIUM:
			return "2 - Moyen"
		_:
			return "3 - Haut"
