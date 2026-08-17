class_name Player
extends CharacterBody2D
## SORIO (B.4).
##
## Ce fichier ne decide de rien : il applique la physique et expose des aides.
## Les decisions ("je saute", "je tombe") appartiennent aux etats.
##
## CHOIX D'IMPLEMENTATION — coyote time et jump buffer sont des compteurs
## flottants, pas des noeuds `Timer`. Deux raisons : un `Timer` s'evalue sur
## la boucle de rendu et introduit jusqu'a une frame d'imprecision sur une
## fenetre de 0,10 s, ce qui est exactement ce qu'on essaie de maitriser ; et
## un compteur est directement testable sans arbre de scenes (voir
## `tests/player_physics_test.gd`).

## Chemin de la configuration par defaut. Le panneau F1 la modifie en direct.
const DEFAULT_CONFIG_PATH: String = "res://resources/player/player_config.tres"

## Ecrasement/etirement au saut et a l'atterrissage (B.10).
const SQUASH_SCALE: Vector2 = Vector2(0.9, 1.1)
const STRETCH_SCALE: Vector2 = Vector2(1.1, 0.9)
const SQUASH_SECONDS: float = 0.08
## En dessous de cette vitesse de chute, l'atterrissage ne merite pas d'effet.
const LANDING_EFFECT_MIN_SPEED: float = 400.0

## Coup porte au bouton B. Court et repetable : c'est l'attaque de base,
## pas un pouvoir. La duree est celle pendant laquelle la boite fait mal.
const ATTACK_ACTIVE_SECONDS: float = 0.16
## Delai avant de pouvoir refrapper. Assez court pour marteler, assez long
## pour que ce ne soit pas un bouclier permanent.
const ATTACK_COOLDOWN_SECONDS: float = 0.30
## Distance de la boite de coup devant SORIO.
const ATTACK_REACH: float = 46.0

## Accroupi : la capsule de collision se raccourcit, ce qui permettra de
## passer sous les obstacles bas des mondes suivants.
const STAND_CAPSULE_HEIGHT: float = 112.0
const CROUCH_CAPSULE_HEIGHT: float = 64.0

## Couleur de l'echarpe selon les PV restants (A.3) : rouge, orange, blanche.
const SCARF_COLORS: Array[Color] = [
	Color(1.0, 1.0, 1.0),
	Color(1.0, 0.55, 0.15),
	Color(0.90, 0.18, 0.15),
]

@export var config: PlayerConfig = null

@onready var sprite: AnimatedSprite2D = $Sprite
@onready var scarf: Polygon2D = $Scarf
@onready var collision: CollisionShape2D = $Collision
@onready var hurtbox: Area2D = $Hurtbox
@onready var stomp_box: Area2D = $StompBox
@onready var power_anchor: Node2D = $PowerAnchor
@onready var attack_box: Area2D = $AttackBox
@onready var state_machine: PlayerStateMachine = $StateMachine

# --- Etat de la frame -------------------------------------------------------

## Direction demandee ce tour-ci, -1, 0 ou +1. Remplie par `_read_input`.
var input_axis: float = 0.0
var jump_just_pressed: bool = false
var jump_held: bool = false
## Bas du stick : s'accroupir. Le stick NE SAUTE PAS — le saut est au
## bouton A et nulle part ailleurs, pour qu'un enfant n'ait jamais deux
## facons contradictoires de faire la meme chose.
var input_down: bool = false
var attack_just_pressed: bool = false

## Sens du regard, +1 a droite. Pilote l'orientation de l'echarpe.
var facing: int = 1

## Fenetres de confort (B.4). Publiques : les tests les lisent directement.
var coyote_timer: float = 0.0
var jump_buffer_timer: float = 0.0
var invincibility_timer: float = 0.0
## Temps restant pendant lequel le coup fait mal, puis avant de repouvoir
## frapper.
var attack_active_timer: float = 0.0
var attack_cooldown_timer: float = 0.0

## Multiplicateur de friction du sol : 1.0 partout, 0.25 sur la glace (monde 4).
var friction_factor: float = 1.0
## true tant que le joueur monte sur une impulsion qu'il peut encore couper.
var is_jump_cuttable: bool = false

var _was_on_floor: bool = false
var _squash_tween: Tween = null


func _ready() -> void:
	if config == null:
		config = _load_default_config()
	var problems: PackedStringArray = config.validate()
	for problem: String in problems:
		push_error("[Player] configuration invalide : %s" % problem)
	assert(problems.is_empty(), "PlayerConfig invalide")

	collision_layer = CollisionLayers.PLAYER
	collision_mask = CollisionLayers.WORLD | CollisionLayers.ONE_WAY | CollisionLayers.BREAKABLE
	# `floor_snap_length` evite de decoller sur les pentes descendantes ;
	# sans lui, courir sur une pente declenche des faux "en l'air".
	floor_snap_length = 8.0
	motion_mode = CharacterBody2D.MOTION_MODE_GROUNDED

	attack_box.collision_layer = CollisionLayers.PLAYER_PROJECTILE
	attack_box.collision_mask = CollisionLayers.ENEMY | CollisionLayers.BREAKABLE
	attack_box.monitoring = false

	state_machine.setup(self)
	# L'animation suit l'etat : aucun etat n'appelle `play()` lui-meme, donc
	# il est impossible d'oublier une animation en ajoutant un etat.
	state_machine.state_changed.connect(_on_state_changed)
	_play_state_animation()
	_update_scarf()
	EventBus.player_damaged.connect(_on_health_changed)
	EventBus.player_healed.connect(_on_health_changed)


func _load_default_config() -> PlayerConfig:
	var loaded: Resource = ResourceLoader.load(DEFAULT_CONFIG_PATH)
	if loaded is PlayerConfig:
		return loaded as PlayerConfig
	push_warning("[Player] PlayerConfig introuvable, valeurs par defaut de B.4")
	return PlayerConfig.new()


func _physics_process(delta: float) -> void:
	_read_input()
	_update_timers(delta)
	state_machine.physics_update(delta)
	move_and_slide()
	_update_ground_state()
	_update_facing()


# --- Entrees ----------------------------------------------------------------

## Le tactile et le clavier passent par les MEMES actions Godot : les
## controles a l'ecran appellent `Input.action_press()`. Rien a brancher ici.
func _read_input() -> void:
	input_axis = Input.get_axis(&"move_left", &"move_right")
	jump_just_pressed = Input.is_action_just_pressed(&"jump")
	jump_held = Input.is_action_pressed(&"jump")
	input_down = Input.is_action_pressed(&"move_down")
	attack_just_pressed = Input.is_action_just_pressed(&"attack")
	if attack_just_pressed:
		try_attack()
	if jump_just_pressed:
		# Le saut est memorise meme si SORIO est encore en l'air : c'est le
		# jump buffer. Il sera consomme des le contact avec le sol.
		jump_buffer_timer = config.jump_buffer


func _update_timers(delta: float) -> void:
	coyote_timer = maxf(0.0, coyote_timer - delta)
	jump_buffer_timer = maxf(0.0, jump_buffer_timer - delta)
	invincibility_timer = maxf(0.0, invincibility_timer - delta)
	attack_cooldown_timer = maxf(0.0, attack_cooldown_timer - delta)
	if attack_active_timer > 0.0:
		attack_active_timer = maxf(0.0, attack_active_timer - delta)
		if attack_active_timer <= 0.0:
			attack_box.monitoring = false


## Ouvre la fenetre de coyote au moment precis ou SORIO quitte le sol sans
## avoir saute. Sauter la referme : sinon on obtiendrait un double saut.
func _update_ground_state() -> void:
	var on_floor: bool = is_on_floor()
	if _was_on_floor and not on_floor and velocity.y >= 0.0:
		coyote_timer = config.coyote_time
	if on_floor:
		coyote_timer = 0.0
	_was_on_floor = on_floor


func _update_facing() -> void:
	if absf(input_axis) > 0.1:
		facing = signi(int(signf(input_axis)))
	if sprite != null:
		sprite.flip_h = facing < 0
	# L'echarpe flotte derriere SORIO : elle suit le sens du regard.
	if scarf != null:
		scarf.scale.x = float(facing)
	# Le coup part toujours devant, jamais dans le dos.
	if attack_box != null:
		attack_box.position.x = ATTACK_REACH * float(facing)


# --- Aides de physique, utilisees par les etats ------------------------------

func apply_gravity(delta: float) -> void:
	velocity.y = minf(velocity.y + config.gravity * delta, config.max_fall_speed)


## Acceleration horizontale. `control` vaut 1.0 au sol, `air_control` en l'air.
func apply_horizontal(delta: float, control: float = 1.0) -> void:
	var target: float = input_axis * config.run_speed
	if absf(input_axis) > 0.01:
		velocity.x = move_toward(
			velocity.x, target, config.run_acceleration * control * delta
		)
	else:
		# Aucune direction tenue : la friction ramene a l'arret. Sur la glace,
		# `friction_factor` la divise par 4 (monde 4).
		velocity.x = move_toward(
			velocity.x, 0.0, config.run_friction * friction_factor * control * delta
		)


## true si SORIO a le droit de sauter : au sol, ou dans la fenetre de coyote.
func can_jump() -> bool:
	return is_on_floor() or coyote_timer > 0.0


## Consomme un saut si les conditions sont reunies. Retourne true si le saut
## a bien eu lieu, ce qui permet a l'etat d'enchainer sur Jump.
func try_jump() -> bool:
	if not can_jump():
		return false
	if jump_buffer_timer <= 0.0 and not jump_just_pressed:
		return false
	var was_coyote: bool = not is_on_floor()
	velocity.y = config.jump_velocity
	# Les deux fenetres se referment : un saut ne doit jamais en declencher
	# un second dans la foulee.
	jump_buffer_timer = 0.0
	coyote_timer = 0.0
	is_jump_cuttable = true
	squash(STRETCH_SCALE)
	Haptics.pulse(&"jump")
	EventBus.player_jumped.emit(was_coyote)
	return true


## Relacher le bouton coupe la montee : saut a hauteur variable (B.4).
func cut_jump() -> void:
	if not is_jump_cuttable or velocity.y >= 0.0:
		return
	velocity.y *= config.jump_cut_multiplier
	is_jump_cuttable = false


func bounce(strength: float = 0.0) -> void:
	velocity.y = strength if strength < 0.0 else config.stomp_bounce
	is_jump_cuttable = false
	squash(STRETCH_SCALE)


# --- Coup porte (bouton B) --------------------------------------------------

func is_attacking() -> bool:
	return attack_active_timer > 0.0


func can_attack() -> bool:
	return attack_cooldown_timer <= 0.0 and state_machine.current_name != &"dead"


## Declenche un coup. Utilisable dans TOUS les etats — au sol, en l'air, en
## chute : un enfant qui appuie sur B doit voir SORIO frapper, pas se faire
## refuser l'action parce qu'il n'avait pas les pieds au sol.
func try_attack() -> bool:
	if not can_attack():
		return false
	attack_active_timer = ATTACK_ACTIVE_SECONDS
	attack_cooldown_timer = ATTACK_COOLDOWN_SECONDS
	attack_box.monitoring = true
	sprite.play(&"cast")
	Haptics.pulse(&"stomp")
	return true


# --- Accroupi (bas du stick) ------------------------------------------------

## Raccourcit ou restaure la capsule de collision.
func set_crouched(crouched: bool) -> void:
	var shape: Shape2D = collision.shape
	if not (shape is CapsuleShape2D):
		return
	var capsule: CapsuleShape2D = shape as CapsuleShape2D
	var height: float = CROUCH_CAPSULE_HEIGHT if crouched else STAND_CAPSULE_HEIGHT
	capsule.height = height
	# Le repere de SORIO est a ses pieds : la capsule reste posee au sol.
	collision.position.y = -height / 2.0


# --- Degats et sante --------------------------------------------------------

func is_invincible() -> bool:
	return invincibility_timer > 0.0


## Point d'entree unique des degats. Retourne true si SORIO est mort.
func take_damage(amount: int, cause: StringName = &"unknown") -> bool:
	if is_invincible() or not state_machine.can_take_damage():
		return false
	invincibility_timer = config.invincibility_time
	Haptics.pulse(&"damage")
	EventBus.screen_shake_requested.emit(6.0, 0.2)
	var died: bool = Game.damage(amount, cause)
	state_machine.change_state(&"dead" if died else &"hurt")
	return died


func _on_health_changed(_remaining: int, _cause: StringName = &"") -> void:
	_update_scarf()


## L'echarpe rouge est le repere visuel de SORIO : elle change de couleur
## avec les PV plutot que d'ajouter un compteur a lire (A.3). On teinte
## l'echarpe SEULE — teinter tout le sprite rendrait SORIO illisible et
## ferait disparaitre l'information au lieu de la porter.
func _update_scarf() -> void:
	if scarf == null:
		return
	var index: int = clampi(Game.health - 1, 0, SCARF_COLORS.size() - 1)
	scarf.color = SCARF_COLORS[index]


# --- Animation --------------------------------------------------------------

func _on_state_changed(_from: StringName, _to: StringName) -> void:
	_play_state_animation()


func _play_state_animation() -> void:
	if sprite == null or state_machine.current == null:
		return
	var animation: StringName = state_machine.current.get_animation()
	if sprite.sprite_frames != null and sprite.sprite_frames.has_animation(animation):
		sprite.play(animation)


# --- Retour visuel ----------------------------------------------------------

## Ecrasement/etirement (B.10). Revient toujours a l'echelle 1 : deux appels
## qui se chevauchent ne laissent pas SORIO deforme.
func squash(target: Vector2) -> void:
	if sprite == null:
		return
	if _squash_tween != null and _squash_tween.is_valid():
		_squash_tween.kill()
	sprite.scale = target
	_squash_tween = create_tween()
	_squash_tween.tween_property(sprite, "scale", Vector2.ONE, SQUASH_SECONDS)


func on_landed(fall_speed: float) -> void:
	if fall_speed > LANDING_EFFECT_MIN_SPEED:
		squash(SQUASH_SCALE)
		EventBus.player_landed.emit(fall_speed)
