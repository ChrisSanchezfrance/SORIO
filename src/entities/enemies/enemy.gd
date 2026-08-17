class_name Enemy
extends CharacterBody2D
## Ennemi generique, pilote par un `EnemyData` (A.7).
##
## Une seule scene pour tous : le comportement vient de la donnee, pas d'une
## classe par ennemi. Ajouter le 18e ennemi ne demande qu'un `.tres`.
##
## Regle de lisibilite absolue de A.7 : tout ce qui est dangereux porte un
## contour sombre ET un lisere rouge. C'est dessine ici, pour tous, donc
## aucun ennemi ne peut y echapper par oubli.

const GRAVITY: float = 2200.0
const MAX_FALL_SPEED: float = 1200.0
## Rebond du joueur quand il ecrase l'ennemi.
const STOMP_BOUNCE: float = -760.0
## Duree du clignotement quand l'ennemi encaisse sans mourir.
const HURT_FLASH_SECONDS: float = 0.14

## Epaisseur du contour et du lisere (A.7).
const OUTLINE_WIDTH: float = 5.0
const RIM_WIDTH: float = 3.0
const RIM_COLOR: Color = Color(0.94, 0.16, 0.14)
const OUTLINE_COLOR: Color = Color(0.08, 0.06, 0.09)

signal died(enemy: Enemy)

@export var data: EnemyData = null

## Position de depart, memorisee pour les comportements qui oscillent.
var origin: Vector2 = Vector2.ZERO
var facing: int = -1
var health: int = 1
var is_dead: bool = false

var _behavior: EnemyBehavior = null
var _flash: float = 0.0

@onready var _body: CollisionShape2D = $Collision
@onready var _hitbox: Area2D = $Hitbox
@onready var _stomp_zone: Area2D = $StompZone


func _ready() -> void:
	assert(data != null, "Enemy sans EnemyData")
	if data == null:
		queue_free()
		return

	origin = global_position
	health = data.max_health

	collision_layer = CollisionLayers.ENEMY
	collision_mask = CollisionLayers.WORLD | CollisionLayers.BREAKABLE

	# La boite qui blesse le joueur.
	_hitbox.collision_layer = CollisionLayers.ENEMY
	_hitbox.collision_mask = CollisionLayers.PLAYER_HURTBOX | CollisionLayers.PLAYER_PROJECTILE
	_hitbox.area_entered.connect(_on_area_entered)

	# La zone du dessus : c'est elle qui rend l'ecrasement possible.
	_stomp_zone.collision_layer = CollisionLayers.ENEMY
	_stomp_zone.collision_mask = CollisionLayers.PLAYER_HURTBOX

	_resize_shapes()
	_attach_behavior()
	Game.discover_enemy(data.id)
	EventBus.enemy_spawned.emit(data.id)
	queue_redraw()


func _resize_shapes() -> void:
	var box: RectangleShape2D = RectangleShape2D.new()
	box.size = data.size
	_body.shape = box
	_body.position = Vector2(0.0, -data.size.y * 0.5)

	var hurt: RectangleShape2D = RectangleShape2D.new()
	hurt.size = data.size * 0.92
	($Hitbox/Shape as CollisionShape2D).shape = hurt
	($Hitbox/Shape as CollisionShape2D).position = _body.position

	# Bande fine sur le dessus : sauter dessus doit etre franc, sans exiger
	# une precision au pixel.
	var top: RectangleShape2D = RectangleShape2D.new()
	top.size = Vector2(data.size.x * 0.9, 18.0)
	($StompZone/Shape as CollisionShape2D).shape = top
	($StompZone/Shape as CollisionShape2D).position = Vector2(0.0, -data.size.y + 6.0)


func _attach_behavior() -> void:
	_behavior = EnemyBehavior.create(data.behavior)
	if _behavior == null:
		return
	_behavior.enemy = self
	add_child(_behavior)
	_behavior.enter()


func _physics_process(delta: float) -> void:
	if is_dead:
		return
	if _flash > 0.0:
		_flash = maxf(0.0, _flash - delta)
		if _flash <= 0.0:
			queue_redraw()
	if _behavior != null:
		_behavior.update(delta)
	move_and_slide()


## Gravite standard, utilisee par la plupart des comportements.
func apply_gravity(delta: float) -> void:
	velocity.y = minf(velocity.y + GRAVITY * delta, MAX_FALL_SPEED)


## true s'il n'y a plus de sol devant : sert au demi-tour au bord (A.7).
func is_at_ledge() -> bool:
	var probe: RayCast2D = $LedgeProbe
	probe.position.x = float(facing) * (data.size.x * 0.5 + 4.0)
	probe.force_raycast_update()
	return not probe.is_colliding()


func turn_around() -> void:
	facing = -facing
	queue_redraw()


# --- Degats -----------------------------------------------------------------

func _on_area_entered(area: Area2D) -> void:
	var owner_node: Node = area.get_parent()
	# Un coup du joueur (bouton B) ou un projectile de pouvoir.
	if area.collision_layer & CollisionLayers.PLAYER_PROJECTILE:
		take_damage(1, &"attack")
		return
	# Sinon c'est la hurtbox du joueur : on regarde s'il nous ecrase.
	if owner_node is Player:
		_resolve_player_contact(owner_node as Player)


func _resolve_player_contact(player: Player) -> void:
	if is_dead:
		return
	# Ecrasement : le joueur doit tomber ET arriver par le dessus.
	var from_above: bool = player.global_position.y < global_position.y - data.size.y * 0.4
	if data.stompable and player.velocity.y > 0.0 and from_above:
		stomped_by(player)
		return
	player.take_damage(data.contact_damage, data.id)


## Ecrase par le joueur : il rebondit, l'ennemi meurt.
func stomped_by(player: Player) -> void:
	player.bounce(STOMP_BOUNCE)
	Haptics.pulse(&"stomp")
	EventBus.player_stomped_enemy.emit(data.id, 1)
	take_damage(data.max_health, &"stomp")


func take_damage(amount: int, cause: StringName) -> void:
	if is_dead:
		return
	health -= amount
	EventBus.enemy_damaged.emit(data.id, amount, health)
	if health > 0:
		_flash = HURT_FLASH_SECONDS
		queue_redraw()
		return
	die(cause)


func die(cause: StringName) -> void:
	if is_dead:
		return
	is_dead = true
	Game.add_amber(data.amber_reward)
	EventBus.enemy_died.emit(data.id, cause)
	died.emit(self)
	set_deferred(&"collision_layer", 0)
	_hitbox.set_deferred(&"monitoring", false)
	_stomp_zone.set_deferred(&"monitoring", false)

	var tween: Tween = create_tween().set_parallel(true)
	tween.tween_property(self, "scale", Vector2(1.2, 0.2), 0.14)
	tween.tween_property(self, "modulate:a", 0.0, 0.2)
	tween.chain().tween_callback(queue_free)


# --- Rendu ------------------------------------------------------------------

## Chaque famille a SA silhouette. Des rectangles identiques ne se
## distinguaient que par la couleur — or un enfant doit reconnaitre un
## raptor d'une plante carnivore en une demi-seconde, meme en plein soleil
## (A.7). La forme porte l'information, la couleur la confirme.
##
## Le contour sombre et le lisere rouge de A.7 sont appliques ici, pour tous
## a la fois : aucun ennemi ne peut y echapper par oubli.
func _draw() -> void:
	if data == null:
		return
	var fill: Color = Color.WHITE if _flash > 0.0 else data.color
	var dark: Color = fill.darkened(0.30)
	var w: float = data.size.x
	var h: float = data.size.y
	var f: float = float(facing)

	match data.behavior:
		EnemyData.Behavior.BITER:
			_draw_plant(fill, dark, w, h)
		EnemyData.Behavior.DIVER:
			_draw_flyer(fill, dark, w, h, f)
		EnemyData.Behavior.CHARGER:
			_draw_charger(fill, dark, w, h, f)
		EnemyData.Behavior.JUMPER:
			_draw_bulb(fill, dark, w, h)
		_:
			_draw_raptor(fill, dark, w, h, f)


## Petit raptor : corps trapu, museau en avant, queue en arriere, deux
## pattes. La pose dit tout de suite dans quel sens il court.
func _draw_raptor(fill: Color, dark: Color, w: float, h: float, f: float) -> void:
	# Queue.
	_shape(PackedVector2Array([
		Vector2(-f * w * 0.42, -h * 0.52),
		Vector2(-f * w * 0.95, -h * 0.28),
		Vector2(-f * w * 0.40, -h * 0.30),
	]), dark)
	# Pattes.
	for side: float in [-0.22, 0.20]:
		_shape(PackedVector2Array([
			Vector2(f * w * side - w * 0.09, -h * 0.34),
			Vector2(f * w * side + w * 0.09, -h * 0.34),
			Vector2(f * w * side + w * 0.11, 0.0),
			Vector2(f * w * side - w * 0.13, 0.0),
		]), dark)
	# Corps.
	_shape(_rounded(Vector2(0.0, -h * 0.58), w * 0.40, h * 0.30), fill)
	# Tete et museau.
	_shape(_rounded(Vector2(f * w * 0.30, -h * 0.80), w * 0.24, h * 0.20), fill)
	_shape(PackedVector2Array([
		Vector2(f * w * 0.42, -h * 0.86),
		Vector2(f * w * 0.66, -h * 0.74),
		Vector2(f * w * 0.42, -h * 0.68),
	]), fill)
	_eyes(Vector2(f * w * 0.30, -h * 0.84), w * 0.10, f)


## Plante carnivore : tige, calice et deux machoires garnies de dents.
func _draw_plant(fill: Color, dark: Color, w: float, h: float) -> void:
	_shape(PackedVector2Array([
		Vector2(-w * 0.12, 0.0), Vector2(w * 0.12, 0.0),
		Vector2(w * 0.09, -h * 0.52), Vector2(-w * 0.09, -h * 0.52),
	]), dark)
	# Deux feuilles a la base.
	for side: float in [-1.0, 1.0]:
		_shape(PackedVector2Array([
			Vector2(side * w * 0.10, -h * 0.16),
			Vector2(side * w * 0.52, -h * 0.30),
			Vector2(side * w * 0.12, -h * 0.34),
		]), dark)
	# Machoires : la forme en pince dit "ca mord" avant toute couleur.
	for direction: float in [-1.0, 1.0]:
		var lip: float = -h * 0.58 + direction * h * 0.16
		_shape(PackedVector2Array([
			Vector2(-w * 0.34, lip),
			Vector2(w * 0.34, lip),
			Vector2(w * 0.22, lip + direction * h * 0.26),
			Vector2(-w * 0.22, lip + direction * h * 0.26),
		]), fill)
		# Dents.
		for i: int in range(4):
			var x: float = lerpf(-w * 0.24, w * 0.24, float(i) / 3.0)
			_shape(PackedVector2Array([
				Vector2(x - w * 0.05, lip),
				Vector2(x + w * 0.05, lip),
				Vector2(x, lip - direction * h * 0.12),
			]), Color(1, 1, 1))
	_eyes(Vector2(0.0, -h * 0.80), w * 0.10, 0.0)


## Ptero : corps fusele et deux ailes en delta qui battent avec le vol.
func _draw_flyer(fill: Color, dark: Color, w: float, h: float, f: float) -> void:
	var flap: float = sin(float(Time.get_ticks_msec()) * 0.006) * h * 0.16
	for side: float in [-1.0, 1.0]:
		_shape(PackedVector2Array([
			Vector2(0.0, -h * 0.58),
			Vector2(side * w * 0.62, -h * 0.62 - flap),
			Vector2(side * w * 0.30, -h * 0.34),
		]), dark if side * f < 0.0 else fill)
	_shape(_rounded(Vector2(0.0, -h * 0.52), w * 0.20, h * 0.22), fill)
	# Bec long et pointu.
	_shape(PackedVector2Array([
		Vector2(f * w * 0.14, -h * 0.62),
		Vector2(f * w * 0.60, -h * 0.52),
		Vector2(f * w * 0.14, -h * 0.44),
	]), dark)
	# Crete a l'arriere du crane.
	_shape(PackedVector2Array([
		Vector2(-f * w * 0.10, -h * 0.66),
		Vector2(-f * w * 0.34, -h * 0.86),
		Vector2(-f * w * 0.04, -h * 0.60),
	]), dark)
	_eyes(Vector2(f * w * 0.06, -h * 0.60), w * 0.09, f)


## Tricератops : masse basse, collerette et corne. Sa silhouette large dit
## qu'on ne lui passe pas dessus.
func _draw_charger(fill: Color, dark: Color, w: float, h: float, f: float) -> void:
	for side: float in [-0.28, 0.24]:
		_shape(PackedVector2Array([
			Vector2(f * w * side - w * 0.08, -h * 0.30),
			Vector2(f * w * side + w * 0.08, -h * 0.30),
			Vector2(f * w * side + w * 0.09, 0.0),
			Vector2(f * w * side - w * 0.10, 0.0),
		]), dark)
	_shape(_rounded(Vector2(-f * w * 0.06, -h * 0.56), w * 0.40, h * 0.28), fill)
	# Collerette.
	_shape(PackedVector2Array([
		Vector2(f * w * 0.14, -h * 0.92),
		Vector2(f * w * 0.40, -h * 0.78),
		Vector2(f * w * 0.40, -h * 0.34),
		Vector2(f * w * 0.14, -h * 0.24),
	]), dark)
	_shape(_rounded(Vector2(f * w * 0.32, -h * 0.56), w * 0.16, h * 0.20), fill)
	# Corne.
	_shape(PackedVector2Array([
		Vector2(f * w * 0.42, -h * 0.72),
		Vector2(f * w * 0.72, -h * 0.60),
		Vector2(f * w * 0.42, -h * 0.52),
	]), Color(0.94, 0.92, 0.86))
	_eyes(Vector2(f * w * 0.30, -h * 0.66), w * 0.08, f)


## Bulbe bondissant : corps rond et deux feuilles dressees.
func _draw_bulb(fill: Color, dark: Color, w: float, h: float) -> void:
	for side: float in [-1.0, 1.0]:
		_shape(PackedVector2Array([
			Vector2(side * w * 0.10, -h * 0.72),
			Vector2(side * w * 0.44, -h * 1.06),
			Vector2(side * w * 0.16, -h * 0.62),
		]), dark)
	_shape(_rounded(Vector2(0.0, -h * 0.44), w * 0.42, h * 0.42), fill)
	# Sourire en dents de scie : mignon et menacant a la fois.
	for i: int in range(4):
		var x: float = lerpf(-w * 0.20, w * 0.20, float(i) / 3.0)
		_shape(PackedVector2Array([
			Vector2(x - w * 0.05, -h * 0.30),
			Vector2(x + w * 0.05, -h * 0.30),
			Vector2(x, -h * 0.18),
		]), Color(1, 1, 1))
	_eyes(Vector2(0.0, -h * 0.58), w * 0.11, 0.0)


# --- Primitives de dessin ---------------------------------------------------

## Une forme pleine, cernee de sombre puis souligne de rouge : la grammaire
## du danger de A.7, appliquee a chaque piece de chaque ennemi.
func _shape(points: PackedVector2Array, color: Color) -> void:
	draw_colored_polygon(points, color)
	var closed: PackedVector2Array = points.duplicate()
	closed.append(points[0])
	draw_polyline(closed, OUTLINE_COLOR, OUTLINE_WIDTH)
	draw_polyline(closed, RIM_COLOR, RIM_WIDTH)


## Un octogone : plus doux qu'un rectangle, moins couteux qu'un cercle.
func _rounded(center: Vector2, half_w: float, half_h: float) -> PackedVector2Array:
	var points: PackedVector2Array = PackedVector2Array()
	for i: int in range(8):
		var angle: float = TAU * float(i) / 8.0 + PI / 8.0
		points.append(center + Vector2(cos(angle) * half_w, sin(angle) * half_h))
	return points


## Gros yeux (B.10) : c'est ce qui rend une silhouette vivante en petit.
func _eyes(center: Vector2, radius: float, facing_sign: float) -> void:
	var shift: float = facing_sign * radius * 0.5
	for side: float in [-1.0, 1.0]:
		var eye: Vector2 = center + Vector2(side * radius * 1.3 + shift, 0.0)
		draw_circle(eye, radius, Color.WHITE)
		draw_circle(eye + Vector2(shift * 0.4, 0.0), radius * 0.52, OUTLINE_COLOR)
