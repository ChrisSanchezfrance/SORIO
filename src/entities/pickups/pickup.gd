class_name Pickup
extends Area2D
## Objet qui sort d'un Cadeau Surprise et rejoint SORIO tout seul.
##
## Ecart assume avec A.6, qui faisait flotter l'objet 10 s avant qu'il
## disparaisse. Sur telephone, courir apres un objet qui va expirer est une
## source de frustration pure : le pouce est deja occupe a courir et sauter,
## et un enfant qui voit sa recompense s'evaporer ne comprend pas ce qu'il a
## mal fait. L'objet vient donc a lui, toujours, et il l'absorbe.
##
## Deux temps, parce qu'un objet qui fonce immediatement sur le joueur ne se
## lit pas : il faut d'abord VOIR ce qu'on a gagne.
##   1. il jaillit du cadeau et retombe un court instant ;
##   2. il fonce sur SORIO en accelerant, et se fait absorber.

enum Phase { POP, SEEK, ABSORBED, RESTING }

## Jaillissement : assez haut pour sortir franchement du cadeau.
const POP_VELOCITY: Vector2 = Vector2(0.0, -520.0)
const POP_SECONDS: float = 0.30
const POP_GRAVITY: float = 1700.0

## Poursuite : l'objet accelere, donc il rattrape SORIO meme s'il court.
const SEEK_ACCELERATION: float = 3200.0
const SEEK_MAX_SPEED: float = 1500.0
## Distance a laquelle l'objet est considere absorbe.
const ABSORB_DISTANCE: float = 34.0
## Rayon de ramassage d'un ambre pose dans le niveau.
const REST_PICKUP_RADIUS: float = 52.0
## Filet de securite : un objet ne poursuit jamais indefiniment.
const MAX_LIFETIME_SECONDS: float = 6.0

## Oscillation verticale des ramassables (A.7).
const BOB_AMPLITUDE: float = 4.0
const BOB_SPEED: float = 6.0

@export var item_id: StringName = &"amber"
@export var amber_value: int = 10

## Pouvoir transporte. Nul pour un simple ramassage d'ambre.
var power: PowerData = null
## Couleur de l'objet, prise sur le pouvoir qu'il contient.
var tint: Color = Color.WHITE

## Cible injectee a la creation. Jamais cherchee dans l'arbre (D.2.4).
var target: Node2D = null

var _phase: Phase = Phase.POP
var _velocity: Vector2 = POP_VELOCITY
var _elapsed: float = 0.0
var _bob_time: float = 0.0
## Decalage vertical de l'oscillation, applique au dessin.
var _bob: float = 0.0


func _ready() -> void:
	collision_layer = CollisionLayers.PICKUP
	collision_mask = 0
	monitoring = false
	monitorable = false
	queue_redraw()


## Appele par le cadeau qui vient de s'ouvrir.
func launch(from: Vector2, toward: Node2D, sideways: float = 0.0) -> void:
	global_position = from
	queue_redraw()
	target = toward
	_velocity = POP_VELOCITY + Vector2(sideways, 0.0)
	_phase = Phase.POP
	_elapsed = 0.0


## Ambre pose dans le niveau : il ne poursuit pas, il attend. Un objet
## place par le level designer doit rester ou il est, sinon la trajectoire
## qu'on a dessinee pour le joueur ne veut plus rien dire.
func rest_at(where: Vector2, toward: Node2D) -> void:
	global_position = where
	target = toward
	_phase = Phase.RESTING
	queue_redraw()


func _physics_process(delta: float) -> void:
	_elapsed += delta
	_bob_time += delta

	if _phase == Phase.RESTING:
		_bob = sin(_bob_time * BOB_SPEED) * BOB_AMPLITUDE
		queue_redraw()
		if target != null and is_instance_valid(target) \
				and global_position.distance_to(target.global_position + Vector2(0, -64)) \
					<= REST_PICKUP_RADIUS:
			_absorb()
		return

	match _phase:
		Phase.POP:
			_velocity.y += POP_GRAVITY * delta
			global_position += _velocity * delta
			if _elapsed >= POP_SECONDS:
				_phase = Phase.SEEK
		Phase.SEEK:
			_seek(delta)
		Phase.ABSORBED:
			return

	# Oscillation verticale : la grammaire des ramassables de A.7.
	_bob = sin(_bob_time * BOB_SPEED) * BOB_AMPLITUDE
	queue_redraw()

	# Sans cible ou apres trop longtemps, on se ramasse tout seul plutot que
	# de laisser un objet fantome vivre dans le niveau.
	if _phase != Phase.RESTING and _elapsed > MAX_LIFETIME_SECONDS:
		_absorb()


func _seek(delta: float) -> void:
	if target == null or not is_instance_valid(target):
		_absorb()
		return
	# Vise le torse plutot que les pieds : l'objet doit sembler absorbe par
	# SORIO, pas par le sol.
	var to_target: Vector2 = target.global_position + Vector2(0.0, -64.0) - global_position
	var distance: float = to_target.length()
	if distance <= ABSORB_DISTANCE:
		_absorb()
		return

	# On vise une VITESSE VOULUE, on n'accelere pas aveuglement vers la
	# cible. Une poursuite par acceleration pure depasse le joueur, doit
	# faire demi-tour, le depasse a nouveau, et se met a tourner autour de
	# lui sans jamais l'atteindre — c'est exactement ce qu'un test a
	# attrape ici.
	#
	# Le plafond `distance / delta` garantit en plus qu'un objet ne parcourt
	# jamais plus que la distance restante en une frame : aucun depassement
	# n'est possible, meme a pleine vitesse.
	var desired: Vector2 = to_target / distance * minf(SEEK_MAX_SPEED, distance / delta)
	_velocity = _velocity.move_toward(desired, SEEK_ACCELERATION * delta)
	global_position += _velocity * delta


func _absorb() -> void:
	if _phase == Phase.ABSORBED:
		return
	_phase = Phase.ABSORBED
	if amber_value > 0:
		Game.add_amber(amber_value)
	# Le pouvoir est remis a SORIO, qui change aussitot d'apparence.
	if power != null and target != null and is_instance_valid(target):
		var system: PowerSystem = target.get(&"power_system") as PowerSystem
		if system != null:
			system.grant(power)
	Haptics.pulse(&"power_pickup")
	_play_absorb_effect()


## Petit gonflement puis disparition : l'absorption doit se voir, sinon
## l'objet semble avoir disparu tout seul.
func _play_absorb_effect() -> void:
	set_physics_process(false)
	var tween: Tween = create_tween().set_parallel(true)
	tween.tween_property(self, "scale", Vector2(1.6, 1.6), 0.12)
	tween.tween_property(self, "modulate:a", 0.0, 0.12)
	tween.chain().tween_callback(queue_free)


# --- Dessin -----------------------------------------------------------------

## Un cristal en losange, de la COULEUR DE SON POUVOIR. La forme dit "objet
## precieux" et la couleur dit lequel : on sait ce qu'on va gagner avant
## meme de l'avoir touche, sans lire une seule ligne.
##
## Le halo clair et l'oscillation verticale sont la grammaire des
## ramassables de A.7 — tout ce qui se ramasse la porte, sans exception.

const CRYSTAL_HEIGHT: float = 30.0
const CRYSTAL_WIDTH: float = 19.0
## Hauteur de l'arete du haut, qui donne la facette superieure.
const CREST_RATIO: float = 0.34
const OUTLINE: Color = Color(0.12, 0.10, 0.16)
const OUTLINE_WIDTH: float = 2.5
const HALO_ALPHA: float = 0.22


func _draw() -> void:
	var center: Vector2 = Vector2(0.0, _bob)
	var top: Vector2 = center + Vector2(0.0, -CRYSTAL_HEIGHT)
	var bottom: Vector2 = center + Vector2(0.0, CRYSTAL_HEIGHT)
	var left: Vector2 = center + Vector2(-CRYSTAL_WIDTH, -CRYSTAL_HEIGHT * CREST_RATIO)
	var right: Vector2 = center + Vector2(CRYSTAL_WIDTH, -CRYSTAL_HEIGHT * CREST_RATIO)

	# Halo : on le voit de loin, meme sur un fond charge.
	var halo: Color = tint
	halo.a = HALO_ALPHA
	draw_circle(center, CRYSTAL_HEIGHT * 1.15, halo)

	# Le losange, en deux facettes : claire a gauche, sombre a droite. C'est
	# ce contraste qui fait lire "cristal" plutot que "losange plat".
	draw_colored_polygon(
		PackedVector2Array([top, left, bottom]), tint.lightened(0.28)
	)
	draw_colored_polygon(
		PackedVector2Array([top, right, bottom]), tint.darkened(0.22)
	)
	# Facette superieure, plus claire encore : le point de lumiere.
	draw_colored_polygon(
		PackedVector2Array([top, left, center, right]), tint.lightened(0.45)
	)

	draw_polyline(PackedVector2Array([
		top, left, bottom, right, top,
	]), OUTLINE, OUTLINE_WIDTH)
	# Arete centrale : elle separe les deux facettes et acheve le volume.
	draw_line(top, bottom, OUTLINE, OUTLINE_WIDTH * 0.7)
