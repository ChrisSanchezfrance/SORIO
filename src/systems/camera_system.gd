class_name GameCamera
extends Camera2D
## Camera de jeu : zone morte, anticipation et tremblement (B.10).
##
## Zone morte : la camera ne bouge pas tant que SORIO reste dans une boite
## centrale. Sans elle, le moindre pas fait glisser tout l'ecran et la lecture
## du niveau devient fatigante — c'est l'un des defauts les plus courants des
## jeux de plateforme mobiles.
##
## Le tremblement est desactivable (C.7) : le reglage est verifie ici, une
## fois, plutot que dans chaque appelant.

## Fraction de l'ecran ou SORIO peut bouger sans deplacer la camera.
const DEAD_ZONE_RATIO: Vector2 = Vector2(0.18, 0.22)
## Anticipation : la camera regarde legerement devant SORIO.
const LOOK_AHEAD_PIXELS: float = 90.0
const LOOK_AHEAD_SMOOTHING: float = 3.0
## Vitesse de rattrapage de la camera vers sa cible.
const FOLLOW_SMOOTHING: float = 6.0
## Le tremblement retombe a zero avec cette vivacite.
const SHAKE_DECAY: float = 6.0

## Cible suivie. Injectee par le niveau, jamais cherchee dans l'arbre.
var target: Node2D = null

var _look_ahead: float = 0.0
var _shake_strength: float = 0.0
var _shake_timer: float = 0.0
var _base_offset: Vector2 = Vector2.ZERO


func _ready() -> void:
	# Godot fournit deja une zone morte sous forme de marges de glissement :
	# on s'en sert plutot que de reimplementer un suivi a la main.
	position_smoothing_enabled = false
	drag_horizontal_enabled = true
	drag_vertical_enabled = true
	drag_left_margin = DEAD_ZONE_RATIO.x
	drag_right_margin = DEAD_ZONE_RATIO.x
	drag_top_margin = DEAD_ZONE_RATIO.y
	drag_bottom_margin = DEAD_ZONE_RATIO.y
	EventBus.screen_shake_requested.connect(_on_shake_requested)


## Definit la cible et les limites du niveau. Les limites empechent la
## camera de montrer le vide au-dela des bords.
func setup(followed: Node2D, level_bounds: Rect2i = Rect2i()) -> void:
	assert(followed != null, "GameCamera.setup avec une cible nulle")
	target = followed
	if level_bounds.size != Vector2i.ZERO:
		limit_left = level_bounds.position.x
		limit_top = level_bounds.position.y
		limit_right = level_bounds.position.x + level_bounds.size.x
		limit_bottom = level_bounds.position.y + level_bounds.size.y


func _physics_process(delta: float) -> void:
	if target == null:
		return
	_update_look_ahead(delta)
	_update_shake(delta)
	global_position = global_position.lerp(
		target.global_position, clampf(FOLLOW_SMOOTHING * delta, 0.0, 1.0)
	)
	offset = _base_offset + Vector2(_look_ahead, 0.0) + _shake_offset()


## Decale progressivement le cadrage dans le sens de la course : le joueur
## voit ce qui arrive plutot que ce qu'il vient de quitter.
func _update_look_ahead(delta: float) -> void:
	var facing: float = 0.0
	if target is Player:
		facing = float((target as Player).facing)
	var desired: float = facing * LOOK_AHEAD_PIXELS
	_look_ahead = move_toward(
		_look_ahead, desired, LOOK_AHEAD_SMOOTHING * LOOK_AHEAD_PIXELS * delta
	)


func _on_shake_requested(strength: float, duration: float) -> void:
	if not Settings.get_bool(&"display", &"screen_shake"):
		return
	# Une secousse en cours n'est jamais ecrasee par une plus faible.
	_shake_strength = maxf(_shake_strength, strength)
	_shake_timer = maxf(_shake_timer, duration)


func _update_shake(delta: float) -> void:
	if _shake_timer <= 0.0:
		_shake_strength = 0.0
		return
	_shake_timer -= delta
	_shake_strength = move_toward(_shake_strength, 0.0, SHAKE_DECAY * delta)


func _shake_offset() -> Vector2:
	if _shake_strength <= 0.0:
		return Vector2.ZERO
	return Vector2(
		randf_range(-_shake_strength, _shake_strength),
		randf_range(-_shake_strength, _shake_strength)
	)
