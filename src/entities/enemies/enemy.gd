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

## Dessin direct : les ennemis sont des formes colorees etiquetees tant que
## les vrais sprites n'existent pas, et la grammaire de A.7 est appliquee ici
## pour tous a la fois — contour sombre plus lisere rouge.
func _draw() -> void:
	if data == null:
		return
	var rect: Rect2 = Rect2(-data.size * 0.5, data.size)
	rect.position.y = -data.size.y

	var fill: Color = data.color
	if _flash > 0.0:
		fill = Color.WHITE
	draw_rect(rect, fill)
	draw_rect(rect.grow(-RIM_WIDTH), fill, false, RIM_WIDTH)
	draw_rect(rect, RIM_COLOR, false, RIM_WIDTH)
	draw_rect(rect.grow(RIM_WIDTH * 0.5), OUTLINE_COLOR, false, OUTLINE_WIDTH)

	# Deux yeux tournes dans le sens de marche : la silhouette se lit et on
	# devine tout de suite ou l'ennemi va.
	var eye_y: float = -data.size.y * 0.62
	var spread: float = data.size.x * 0.17
	var shift: float = float(facing) * data.size.x * 0.06
	for side: float in [-1.0, 1.0]:
		draw_circle(Vector2(side * spread + shift, eye_y), data.size.x * 0.09, Color.WHITE)
		draw_circle(Vector2(side * spread + shift, eye_y), data.size.x * 0.05, OUTLINE_COLOR)
