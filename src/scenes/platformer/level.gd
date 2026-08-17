class_name Level
extends Node2D
## Un niveau jouable, construit depuis un fichier ASCII (B.6).
##
## Debut, fin, ennemis, cadeaux, plateformes : tout vient du `.txt`. Cette
## scene ne fait qu'assembler et gerer la partie — mort, point de controle,
## drapeau, passage au niveau suivant.

const LEVEL_ROOT: String = "res://levels"
## Niveau charge par defaut quand on arrive depuis le menu.
const FIRST_LEVEL: String = "res://levels/world_01/level_01.txt"

const TILE_COLOR: Color = Color(0.34, 0.24, 0.16)
const TILE_TOP_COLOR: Color = Color(0.36, 0.66, 0.28)
const ONE_WAY_COLOR: Color = Color(0.52, 0.38, 0.24)
const SPIKE_COLOR: Color = Color(0.62, 0.66, 0.70)
const TILE_TOP_HEIGHT: float = 8.0
## Bord superieur en pointilles des plateformes traversables (C.8).
const DASH_LENGTH: float = 14.0

## Chute au-dela du niveau : on meurt, comme dans tout jeu de plateforme.
const FALL_MARGIN: float = 260.0

@export var level_path: String = FIRST_LEVEL

var result: LevelBuilder.Result = null

var _player: Player = null
var _camera: GameCamera = null
var _flag: Area2D = null
var _last_checkpoint: Vector2 = Vector2.ZERO
var _finished: bool = false


func _ready() -> void:
	RenderingServer.set_default_clear_color(Color(0.62, 0.85, 0.90))
	add_child(ParallaxBackdrop.new())
	_spawn_player()

	result = LevelBuilder.build(level_path, self, _player)
	if not result.errors.is_empty():
		# `assert` disparait dans un build de release : sans ce garde-fou,
		# un niveau introuvable donnait un ecran vide et SORIO tombait dans
		# le neant, sans un mot d'explication. On le dit, maintenant.
		for message: String in result.errors:
			push_error("[Level] %s : %s" % [level_path, message])
		_show_load_failure()
		return

	_player.global_position = result.spawn
	_last_checkpoint = result.spawn
	_build_flag()
	_setup_camera()
	_attach_interface()

	EventBus.player_died.connect(_on_player_died)
	Game.begin_level(
		int(result.header.get("world", "1")),
		int(result.header.get("level", "1")),
		float(result.header.get("time_limit", "120"))
	)
	Perf.begin_sampling()
	queue_redraw()


func _spawn_player() -> void:
	_player = (load("res://src/entities/player/player.tscn") as PackedScene) \
		.instantiate() as Player
	add_child(_player)


## Le drapeau de fin. Une zone large : on ne rate pas la fin d'un niveau
## parce qu'on est passe trois pixels a cote.
func _build_flag() -> void:
	_flag = Area2D.new()
	_flag.name = "Flag"
	_flag.collision_layer = CollisionLayers.TRIGGER
	_flag.collision_mask = CollisionLayers.PLAYER_HURTBOX
	_flag.position = result.flag + Vector2(0.0, -64.0)
	var shape: CollisionShape2D = CollisionShape2D.new()
	var box: RectangleShape2D = RectangleShape2D.new()
	box.size = Vector2(72.0, 160.0)
	shape.shape = box
	_flag.add_child(shape)
	_flag.area_entered.connect(_on_flag_reached)
	add_child(_flag)


func _setup_camera() -> void:
	_camera = GameCamera.new()
	add_child(_camera)
	_camera.setup(_player, Rect2i(
		0, -400,
		int(result.width_pixels()), int(result.height_pixels()) + 400
	))
	_camera.global_position = _player.global_position
	_camera.make_current()


func _attach_interface() -> void:
	add_child(load("res://src/scenes/ui/touch_controls.tscn").instantiate())
	var hud: Node = load("res://src/scenes/ui/power_hud.tscn").instantiate()
	add_child(hud)
	hud.call(&"setup", _player.power_system)
	var panel: Node = load("res://src/scenes/ui/debug_panel.tscn").instantiate()
	add_child(panel)
	panel.call(&"attach", _player)


func _physics_process(_delta: float) -> void:
	if _finished or _player == null:
		return
	# Tomber hors du niveau tue, comme partout dans le genre.
	if _player.global_position.y > result.height_pixels() + FALL_MARGIN:
		_respawn()


# --- Points de controle et mort ---------------------------------------------

func _on_player_died(_cause: StringName) -> void:
	# On reprend au dernier point de controle, jamais au debut du monde
	# (A.11). Court delai pour laisser voir la chute.
	await get_tree().create_timer(0.9).timeout
	_respawn()


func _respawn() -> void:
	if _finished or _player == null:
		return
	_player.global_position = _last_checkpoint
	_player.velocity = Vector2.ZERO
	_player.collision_mask = CollisionLayers.WORLD | CollisionLayers.ONE_WAY \
		| CollisionLayers.BREAKABLE
	_player.state_machine.change_state(&"idle")
	Game.health = Game.max_health
	EventBus.player_respawned.emit(0)


# --- Fin de niveau ----------------------------------------------------------

func _on_flag_reached(_area: Area2D) -> void:
	if _finished:
		return
	_finished = true
	Haptics.pulse(&"crystal")
	var stars: int = Game.compute_stars(true, 0)
	Game.end_level(stars)
	_show_completion()


func _show_completion() -> void:
	var layer: CanvasLayer = CanvasLayer.new()
	layer.layer = 60
	add_child(layer)

	var panel: ColorRect = ColorRect.new()
	panel.color = Color(0.05, 0.12, 0.10, 0.82)
	panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(panel)

	var label: Label = Label.new()
	label.text = tr("LEVEL_COMPLETE")
	label.add_theme_font_size_override("font_size", 64)
	label.add_theme_color_override("font_color", Color(1.0, 0.86, 0.30))
	label.set_anchors_preset(Control.PRESET_FULL_RECT)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	panel.add_child(label)

	await get_tree().create_timer(2.0).timeout
	_go_to_next()


func _go_to_next() -> void:
	var next: String = String(result.header.get("next", "")).strip_edges()
	if next.is_empty():
		# Dernier niveau du monde : retour au titre en attendant la carte
		# du monde et le Village (passe 7).
		Transition.go_to(&"title", false)
		return
	var folder: String = level_path.get_base_dir()
	Transition.go_to_path_with_level("%s/%s.txt" % [folder, next])


## Ecran d'echec explicite. Mieux vaut un message clair qu'un vide muet.
func _show_load_failure() -> void:
	_player.queue_free()
	_player = null
	set_physics_process(false)

	var layer: CanvasLayer = CanvasLayer.new()
	layer.layer = 80
	add_child(layer)
	var panel: ColorRect = ColorRect.new()
	panel.color = Color(0.10, 0.06, 0.08, 0.94)
	panel.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(panel)

	var label: Label = Label.new()
	label.text = "%s\n\n%s\n\n%s" % [
		tr("LEVEL_LOAD_FAILED"), level_path, "  ".join(result.errors)
	]
	label.add_theme_font_size_override("font_size", 26)
	label.add_theme_color_override("font_color", Color(1.0, 0.72, 0.62))
	label.set_anchors_preset(Control.PRESET_FULL_RECT)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	panel.add_child(label)


# --- Rendu du terrain -------------------------------------------------------

func _draw() -> void:
	if result == null:
		return
	for rect: Rect2 in result.solids:
		draw_rect(rect, TILE_COLOR)
		draw_rect(Rect2(rect.position, Vector2(rect.size.x, TILE_TOP_HEIGHT)), TILE_TOP_COLOR)

	# Plateformes traversables : bord superieur en pointilles (C.8), pour
	# qu'on sache d'un coup d'oeil qu'on peut passer au travers.
	for rect: Rect2 in result.one_ways:
		draw_rect(rect, ONE_WAY_COLOR)
		var x: float = rect.position.x
		while x < rect.position.x + rect.size.x:
			var length: float = minf(DASH_LENGTH, rect.position.x + rect.size.x - x)
			draw_rect(Rect2(x, rect.position.y, length, 5.0), TILE_TOP_COLOR)
			x += DASH_LENGTH * 2.0

	# Pics : des triangles, pas un rectangle. La forme dit le danger avant
	# la couleur (C.8).
	for rect: Rect2 in result.spikes:
		var base: float = rect.position.y + rect.size.y
		for i: int in range(3):
			var left: float = rect.position.x + rect.size.x * float(i) / 3.0
			var width: float = rect.size.x / 3.0
			draw_colored_polygon(PackedVector2Array([
				Vector2(left, base),
				Vector2(left + width * 0.5, rect.position.y + rect.size.y * 0.25),
				Vector2(left + width, base),
			]), SPIKE_COLOR)

	# Drapeau d'arrivee : haut, contraste, visible de loin.
	var pole: Vector2 = result.flag
	draw_rect(Rect2(pole.x - 5.0, pole.y - 190.0, 10.0, 190.0), Color(0.85, 0.85, 0.88))
	draw_colored_polygon(PackedVector2Array([
		Vector2(pole.x + 5.0, pole.y - 186.0),
		Vector2(pole.x + 95.0, pole.y - 150.0),
		Vector2(pole.x + 5.0, pole.y - 114.0),
	]), Color(1.0, 0.82, 0.22))
